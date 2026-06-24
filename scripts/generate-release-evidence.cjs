const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.resolve(process.env.DYSTOPAI_RELEASE_EVIDENCE_DIR || path.join(root, 'release', 'evidence'))
const artifactRoot = path.resolve(process.env.DYSTOPAI_RELEASE_ARTIFACT_ROOT || path.join(root, 'release'))
const runtimeBundleRoot = path.resolve(process.env.DYSTOPAI_RUNTIME_BUNDLE_ROOT || path.join(root, '.cache', 'runtime-bundles'))
const runtimeMetadataFileName = '.dystopai-runtime-bundle.json'

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function relativePath(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/')
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const bytes = fs.readFileSync(filePath)
  hash.update(bytes)
  return hash.digest('hex')
}

function walkFiles(dirPath, options = {}) {
  const files = []
  if (!dirExists(dirPath)) return files
  const ignore = options.ignore || (() => false)
  const stack = [dirPath]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (ignore(fullPath, entry)) continue
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }
  return files.sort((a, b) => relativePath(a).localeCompare(relativePath(b)))
}

function encodePurlName(name) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/')
    return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName || '')}`
  }
  return encodeURIComponent(name)
}

function lockPackageName(packagePath, entry) {
  if (entry.name && typeof entry.name === 'string') return entry.name
  const normalized = packagePath.replace(/\\/g, '/')
  const segments = normalized.split('/node_modules/')
  const last = segments[segments.length - 1] || normalized.replace(/^node_modules\//, '')
  return last
}

function componentRef(name, version) {
  return `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version || '0.0.0')}`
}

function componentFromLockEntry(packagePath, entry) {
  const name = lockPackageName(packagePath, entry)
  const version = String(entry.version || '0.0.0')
  const component = {
    type: 'library',
    'bom-ref': componentRef(name, version),
    name,
    version,
    purl: componentRef(name, version),
    properties: [
      { name: 'npm:path', value: packagePath },
      { name: 'npm:dev', value: String(Boolean(entry.dev)) },
    ],
  }
  if (entry.license) component.licenses = [{ license: { name: String(entry.license) } }]
  if (entry.integrity) component.properties.push({ name: 'npm:integrity', value: String(entry.integrity) })
  if (entry.resolved) {
    component.externalReferences = [{ type: 'distribution', url: String(entry.resolved) }]
  }
  return component
}

function packageLockComponents(lockPath) {
  const lock = readJson(lockPath)
  const packages = lock.packages && typeof lock.packages === 'object' ? lock.packages : {}
  const components = []
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!packagePath || !packagePath.startsWith('node_modules/') || !entry || typeof entry !== 'object') continue
    if (!entry.version) continue
    components.push(componentFromLockEntry(packagePath, entry))
  }
  return components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
}

function runtimeMetadataFiles() {
  return walkFiles(runtimeBundleRoot).filter((filePath) => path.basename(filePath) === runtimeMetadataFileName)
}

function runtimeComponents(metadataFiles) {
  const components = []
  for (const filePath of metadataFiles) {
    const metadata = readJson(filePath)
    if (metadata.node) {
      components.push({
        type: 'application',
        'bom-ref': `pkg:generic/node@${encodeURIComponent(metadata.node.version)}`,
        name: 'node',
        version: metadata.node.version,
        hashes: [{ alg: 'SHA-256', content: metadata.node.sha256 }],
        properties: [
          { name: 'dystopai:runtimeMetadata', value: relativePath(filePath) },
          { name: 'node:archive', value: metadata.node.archive },
          { name: 'node:shasumsUrl', value: metadata.node.shasumsUrl },
        ],
      })
    }
    if (metadata.codex) {
      components.push({
        type: 'application',
        'bom-ref': `pkg:npm/%40openclaw/codex@${encodeURIComponent(metadata.codex.version)}`,
        name: '@openclaw/codex',
        version: metadata.codex.version,
        purl: `pkg:npm/%40openclaw/codex@${encodeURIComponent(metadata.codex.version)}`,
        externalReferences: metadata.codex.tarball ? [{ type: 'distribution', url: metadata.codex.tarball }] : undefined,
        properties: [
          { name: 'dystopai:runtimeMetadata', value: relativePath(filePath) },
          { name: 'npm:integrity', value: metadata.codex.integrity },
          { name: 'npm:spec', value: metadata.codex.spec },
          ...(metadata.codex.lockfile ? [{ name: 'npm:lockfile', value: metadata.codex.lockfile }] : []),
        ],
      })
      const dependencies = metadata.codex.dependencies && typeof metadata.codex.dependencies === 'object'
        ? metadata.codex.dependencies
        : {}
      for (const [name, dependency] of Object.entries(dependencies)) {
        if (!dependency || typeof dependency !== 'object') continue
        components.push({
          type: 'library',
          'bom-ref': componentRef(name, dependency.version),
          name,
          version: dependency.version,
          purl: componentRef(name, dependency.version),
          properties: [
            { name: 'dystopai:runtimeDependency', value: '@openclaw/codex' },
            { name: 'npm:integrity', value: dependency.integrity },
          ],
        })
      }
    }
  }
  return components
}

function dedupeComponents(components) {
  const byRef = new Map()
  for (const component of components) {
    const ref = component['bom-ref'] || `${component.name}@${component.version}`
    if (!byRef.has(ref)) byRef.set(ref, component)
  }
  return [...byRef.values()].sort((a, b) => String(a['bom-ref']).localeCompare(String(b['bom-ref'])))
}

function releaseArtifactFiles() {
  const evidenceRootForIgnore = path.resolve(evidenceDir)
  return walkFiles(artifactRoot, {
    ignore(filePath) {
      const resolved = path.resolve(filePath)
      return resolved === evidenceRootForIgnore || resolved.startsWith(`${evidenceRootForIgnore}${path.sep}`)
    },
  })
}

function checksumInputFiles(runtimeMetadata) {
  const candidates = [
    'package.json',
    'package-lock.json',
    'electron/main.cjs',
    'electron/preload.cjs',
    'scripts/package-desktop.cjs',
    'scripts/prepare-runtime-bundles.cjs',
    'scripts/generate-release-evidence.cjs',
    'dist/index.html',
    'dist-server/index.cjs',
  ].map((entry) => path.join(root, entry))
  return [...new Set([
    ...candidates.filter(fileExists),
    ...runtimeMetadata,
    ...releaseArtifactFiles(),
  ])].sort((a, b) => relativePath(a).localeCompare(relativePath(b)))
}

function checksumManifest(files) {
  return files
    .map((filePath) => `${sha256File(filePath)}  ${relativePath(filePath)}`)
    .join('\n') + '\n'
}

function buildSbom(runtimeMetadata) {
  const packageJson = readJson(path.join(root, 'package.json'))
  const lockPath = path.join(root, 'package-lock.json')
  const generatedAt = new Date().toISOString()
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: generatedAt,
      tools: [{
        vendor: 'DystopAI',
        name: 'generate-release-evidence',
        version: '1',
      }],
      component: {
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
      },
      properties: [
        { name: 'dystopai:artifactRoot', value: relativePath(artifactRoot) },
        { name: 'dystopai:runtimeBundleRoot', value: relativePath(runtimeBundleRoot) },
        { name: 'dystopai:runtimeMetadataFiles', value: String(runtimeMetadata.length) },
        { name: 'dystopai:platform', value: `${process.platform}/${process.arch}` },
        { name: 'dystopai:node', value: process.version },
        { name: 'dystopai:hostname', value: os.hostname() },
      ],
    },
    components: dedupeComponents([
      ...packageLockComponents(lockPath),
      ...runtimeComponents(runtimeMetadata),
    ]),
  }
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const runtimeMetadata = runtimeMetadataFiles()
  const sbom = buildSbom(runtimeMetadata)
  const sbomPath = path.join(evidenceDir, 'dystopai-sbom.cdx.json')
  fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)

  const checksumFiles = checksumInputFiles(runtimeMetadata)
  const checksumsPath = path.join(evidenceDir, 'checksums.sha256')
  fs.writeFileSync(checksumsPath, checksumManifest([...checksumFiles, sbomPath]))

  const summaryPath = path.join(evidenceDir, 'release-evidence.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    schema: 1,
    generatedAt: sbom.metadata.timestamp,
    evidenceDir,
    artifactRoot,
    runtimeBundleRoot,
    sbom: sbomPath,
    checksums: checksumsPath,
    componentCount: sbom.components.length,
    checksumCount: checksumFiles.length + 1,
    runtimeMetadataCount: runtimeMetadata.length,
  }, null, 2)}\n`)

  console.log(`[release-evidence] wrote ${relativePath(sbomPath)}`)
  console.log(`[release-evidence] wrote ${relativePath(checksumsPath)}`)
  console.log(`[release-evidence] wrote ${relativePath(summaryPath)}`)
}

main()
