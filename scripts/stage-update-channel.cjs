#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const root = path.resolve(__dirname, '..')
const inputRoot = path.resolve(process.env.AUTOMNIA_UPDATE_STAGE_INPUT || path.join(root, 'release-downloads'))
const outputRoot = path.resolve(process.env.AUTOMNIA_UPDATE_STAGE_OUTPUT || path.join(root, 'release', 'update-channel'))
const rolloutPercentage = Number(process.env.AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE || 100)
const expectedVersion = String(process.env.AUTOMNIA_RELEASE_VERSION || '').trim().replace(/^v/, '')
const allowedExtensions = ['.exe', '.dmg', '.zip', '.appimage', '.deb', '.rpm', '.blockmap', '.yml']

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(filePath) : entry.isFile() ? [filePath] : []
  })
}

if (!Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
  throw new Error('AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE must be between 0 and 100')
}
if (inputRoot === outputRoot || outputRoot.startsWith(`${inputRoot}${path.sep}`)) {
  throw new Error('Update staging output must not be inside its input tree')
}

const candidates = walk(inputRoot).filter((filePath) => {
  const lower = filePath.toLowerCase()
  const relative = path.relative(inputRoot, filePath).replace(/\\/g, '/').toLowerCase()
  if (
    path.basename(relative) === 'builder-debug.yml' ||
    relative.includes('/evidence/') ||
    relative.includes('/updates/') ||
    relative.includes('/win-unpacked/') ||
    relative.includes('/linux-unpacked/') ||
    relative.includes('/mac/') ||
    /(^|\/)uninstall[^/]*\.exe$/.test(relative)
  ) return false
  return allowedExtensions.some((extension) => lower.endsWith(extension))
})
if (!candidates.length) throw new Error(`No update artifacts found under ${inputRoot}`)

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })
const isProviderMetadata = (filePath) => /^latest(?:-[a-z0-9._-]+)?\.yml$/i.test(path.basename(filePath))
const artifactCandidates = candidates.filter((filePath) => !isProviderMetadata(filePath))
const metadataCandidates = candidates.filter(isProviderMetadata)

for (const source of artifactCandidates) {
  const target = path.join(outputRoot, path.basename(source))
  if (fs.existsSync(target)) {
    if (sha256(source) !== sha256(target)) throw new Error(`Conflicting staged update filename: ${path.basename(source)}`)
    continue
  }
  fs.copyFileSync(source, target)
}

const metadataByName = new Map()
for (const source of metadataCandidates) {
  const name = path.basename(source)
  const key = name.toLowerCase()
  const sources = metadataByName.get(key) || []
  sources.push(source)
  metadataByName.set(key, sources)
}

for (const [key, sources] of metadataByName) {
  const target = path.join(outputRoot, path.basename(sources[0]))
  const documents = sources.map((source) => {
    const document = yaml.load(fs.readFileSync(source, 'utf8'))
    if (!document || typeof document !== 'object' || Array.isArray(document) || !document.version) {
      throw new Error(`Invalid updater metadata: ${source}`)
    }
    return { source, document }
  })
  const versions = new Set(documents.map(({ document }) => String(document.version).trim()))
  if (versions.size !== 1) throw new Error(`Updater metadata versions disagree for ${path.basename(target)}`)

  let merged = documents[0].document
  if (documents.length > 1) {
    if (key !== 'latest-mac.yml') {
      const firstHash = sha256(sources[0])
      if (sources.some((source) => sha256(source) !== firstHash)) {
        throw new Error(`Conflicting staged update metadata: ${path.basename(target)}`)
      }
    } else {
      const x64Source = documents.find(({ source }) => {
        const relative = path.relative(inputRoot, source).replace(/\\/g, '/').toLowerCase()
        return relative.startsWith('macos/') && !relative.startsWith('macos-arm64/')
      })
      if (x64Source) merged = x64Source.document

      const filesByUrl = new Map()
      for (const { document } of documents) {
        const entries = Array.isArray(document.files) && document.files.length
          ? document.files
          : typeof document.path === 'string'
            ? [{ url: document.path, sha512: document.sha512, size: fs.statSync(path.join(outputRoot, path.basename(document.path))).size }]
            : []
        for (const entry of entries) {
          if (!entry || typeof entry.url !== 'string' || !entry.url.trim()) {
            throw new Error(`Invalid macOS updater file entry in ${path.basename(target)}`)
          }
          const url = entry.url.trim()
          const existing = filesByUrl.get(url)
          if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
            throw new Error(`Conflicting macOS updater metadata for ${url}`)
          }
          filesByUrl.set(url, entry)
        }
      }
      merged = { ...merged, files: [...filesByUrl.values()] }
    }
  }

  fs.writeFileSync(target, yaml.dump(merged, { lineWidth: 120, noRefs: true }), 'utf8')
}

const metadataFiles = fs.readdirSync(outputRoot).filter((name) => /^latest(?:-[a-z0-9._-]+)?\.yml$/i.test(name))
if (!metadataFiles.length) throw new Error('No electron-updater latest*.yml metadata was produced')
const stagedNames = fs.readdirSync(outputRoot)
const requiredMetadata = [
  [stagedNames.some((name) => /\.exe$/i.test(name)), 'latest.yml'],
  [stagedNames.some((name) => /\.dmg$/i.test(name)), 'latest-mac.yml'],
  [stagedNames.some((name) => /\.appimage$/i.test(name)), 'latest-linux.yml'],
]
for (const [required, metadataName] of requiredMetadata) {
  if (required && !stagedNames.includes(metadataName)) throw new Error(`Missing required updater metadata: ${metadataName}`)
}

// The Apple silicon job's package upload may omit its own latest-mac.yml.
// electron-updater selects mac ZIPs by the architecture in the URL, so add a
// verified arm64 ZIP entry when the x64 metadata does not already contain it.
const macMetadataPath = path.join(outputRoot, 'latest-mac.yml')
if (fs.existsSync(macMetadataPath)) {
  const macMetadata = yaml.load(fs.readFileSync(macMetadataPath, 'utf8'))
  const macFiles = Array.isArray(macMetadata.files) ? [...macMetadata.files] : []
  const knownUrls = new Set(macFiles
    .map((entry) => path.basename(String(entry?.url || '').trim().split(/[?#]/, 1)[0]))
    .filter(Boolean))
  if (typeof macMetadata.path === 'string' && macMetadata.path.trim()) {
    const x64ZipName = path.basename(macMetadata.path.trim())
    const x64ZipPath = path.join(outputRoot, x64ZipName)
    if (!knownUrls.has(x64ZipName) && fs.existsSync(x64ZipPath)) {
      macFiles.push({
        url: macMetadata.path.trim(),
        sha512: macMetadata.sha512,
        size: fs.statSync(x64ZipPath).size,
      })
      knownUrls.add(x64ZipName)
    }
  }
  const arm64Zips = stagedNames.filter((name) => /-arm64\.zip$/i.test(name))
  for (const name of arm64Zips) {
    if (knownUrls.has(name)) continue
    const zipPath = path.join(outputRoot, name)
    const entry = {
      url: name,
      sha512: crypto.createHash('sha512').update(fs.readFileSync(zipPath)).digest('base64'),
      size: fs.statSync(zipPath).size,
    }
    const blockMapPath = `${zipPath}.blockmap`
    if (fs.existsSync(blockMapPath)) entry.blockMapSize = fs.statSync(blockMapPath).size
    macFiles.push(entry)
    knownUrls.add(name)
  }
  if (macFiles.length) {
    macMetadata.files = macFiles
    fs.writeFileSync(macMetadataPath, yaml.dump(macMetadata, { lineWidth: 120, noRefs: true }), 'utf8')
  }
}

const metadataVersions = new Set()
for (const metadataName of metadataFiles) {
  const metadataPath = path.join(outputRoot, metadataName)
  const document = yaml.load(fs.readFileSync(metadataPath, 'utf8'))
  if (!document || typeof document !== 'object' || !document.version) throw new Error(`Invalid updater metadata: ${metadataName}`)
  metadataVersions.add(String(document.version).trim())
  const referenced = [document.path, ...(Array.isArray(document.files) ? document.files.map((entry) => entry?.url) : [])]
    .filter(Boolean)
    .map((value) => path.basename(String(value)))
  for (const filename of referenced) {
    if (!fs.existsSync(path.join(outputRoot, filename))) throw new Error(`${metadataName} references missing artifact ${filename}`)
  }
  fs.writeFileSync(metadataPath, yaml.dump(document, { lineWidth: 120, noRefs: true }), 'utf8')
}
if (metadataVersions.size !== 1) throw new Error(`Updater metadata versions disagree: ${[...metadataVersions].join(', ')}`)
const [metadataVersion] = metadataVersions
if (expectedVersion && metadataVersion !== expectedVersion) {
  throw new Error(`Updater metadata version ${metadataVersion} does not match requested release ${expectedVersion}`)
}

// Existing stable-x64 installations ask electron-updater for channel-specific
// filenames, even though electron-builder emits latest*.yml. Keep both names.
if (String(process.env.AUTOMNIA_UPDATE_CHANNEL || 'stable').trim() === 'stable-x64') {
  for (const [source, alias] of [
    ['latest.yml', 'stable-x64.yml'],
    ['latest-mac.yml', 'stable-x64-mac.yml'],
    ['latest-linux.yml', 'stable-x64-linux.yml'],
  ]) {
    const sourcePath = path.join(outputRoot, source)
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(outputRoot, alias))
  }
}

console.log(`[update-stage] staged ${fs.readdirSync(outputRoot).length} files for version ${metadataVersion} and a signed ${rolloutPercentage}% rollout policy`)
