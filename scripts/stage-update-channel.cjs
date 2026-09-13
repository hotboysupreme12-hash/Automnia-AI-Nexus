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
for (const source of candidates) {
  const target = path.join(outputRoot, path.basename(source))
  if (fs.existsSync(target)) {
    if (sha256(source) !== sha256(target)) throw new Error(`Conflicting staged update filename: ${path.basename(source)}`)
    continue
  }
  fs.copyFileSync(source, target)
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

console.log(`[update-stage] staged ${fs.readdirSync(outputRoot).length} files for version ${metadataVersion} and a signed ${rolloutPercentage}% rollout policy`)
