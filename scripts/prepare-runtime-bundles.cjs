const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bundleRoot = path.join(root, '.cache', 'runtime-bundles')
const bundledNodeRoot = path.join(bundleRoot, 'toolchains', 'node')
const bundledCodexRoot = path.join(bundleRoot, 'openclaw-codex', 'codex')
const downloadsRoot = path.join(bundleRoot, '.downloads')
const installWorkRoot = path.join(bundleRoot, '.work')

const RUNTIME_BUNDLE_METADATA_FILE = '.dystopai-runtime-bundle.json'
const DEFAULT_BUNDLED_NODE_VERSION = 'v24.16.0'
const DEFAULT_BUNDLED_CODEX_VERSION = '2026.6.10'
const DEFAULT_BUNDLED_CODEX_SPEC = `@openclaw/codex@${DEFAULT_BUNDLED_CODEX_VERSION}`
const DEFAULT_BUNDLED_CODEX_INTEGRITY = 'sha512-0M5FsRb3IxsJ/xb2U1eMOZL/7w9W27tnzhSANY7JbbCRhz1+v7WUE6uS3YRWoTKv/9sNx9MAJXFntCK8MpWKYQ=='
const DEFAULT_BUNDLED_CODEX_TARBALL = 'https://registry.npmjs.org/@openclaw/codex/-/codex-2026.6.10.tgz'

function normalizeExactNodeVersion(value) {
  const raw = String(value || '').trim().replace(/^node-/, '')
  if (!/^v\d+\.\d+\.\d+$/.test(raw)) {
    throw new Error(`DYSTOPAI_BUNDLED_NODE_VERSION must be an exact Node.js version like v24.16.0; received ${JSON.stringify(value)}`)
  }
  return raw
}

function parseExactCodexSpec(spec) {
  const raw = String(spec || '').trim()
  const match = /^@openclaw\/codex@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw)
  if (!match) {
    throw new Error(`DYSTOPAI_BUNDLED_CODEX_SPEC must pin an exact @openclaw/codex version; received ${JSON.stringify(spec)}`)
  }
  return { spec: raw, version: match[1] }
}

const bundledNodeVersion = normalizeExactNodeVersion(process.env.DYSTOPAI_BUNDLED_NODE_VERSION || DEFAULT_BUNDLED_NODE_VERSION)
const bundledCodex = parseExactCodexSpec(process.env.DYSTOPAI_BUNDLED_CODEX_SPEC || DEFAULT_BUNDLED_CODEX_SPEC)
const bundledCodexIntegrity = String(
  process.env.DYSTOPAI_BUNDLED_CODEX_INTEGRITY ||
  (bundledCodex.spec === DEFAULT_BUNDLED_CODEX_SPEC ? DEFAULT_BUNDLED_CODEX_INTEGRITY : ''),
).trim()
const bundledCodexTarball = String(
  process.env.DYSTOPAI_BUNDLED_CODEX_TARBALL ||
  (bundledCodex.spec === DEFAULT_BUNDLED_CODEX_SPEC ? DEFAULT_BUNDLED_CODEX_TARBALL : ''),
).trim()
const refresh = /^(1|true|yes)$/i.test(process.env.DYSTOPAI_REFRESH_RUNTIME_BUNDLES || '')

if (!/^sha512-[A-Za-z0-9+/=]+$/.test(bundledCodexIntegrity)) {
  throw new Error('DYSTOPAI_BUNDLED_CODEX_INTEGRITY must be provided as the expected sha512 npm integrity for the pinned Codex package.')
}

function platformArchive() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') return { ext: 'zip', name: `node-${bundledNodeVersion}-win-${arch}` }
  if (process.platform === 'darwin') return { ext: 'tar.gz', name: `node-${bundledNodeVersion}-darwin-${arch}` }
  if (process.platform === 'linux') return { ext: 'tar.xz', name: `node-${bundledNodeVersion}-linux-${arch}` }
  throw new Error(`Unsupported platform for bundled Node.js: ${process.platform}/${process.arch}`)
}

function npmCommandSpec() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, prefix: [process.env.npm_execpath], shell: false }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    prefix: [],
    shell: process.platform === 'win32',
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: options.shell || false,
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true,
  })
  if (result.status !== 0) {
    if (options.allowFailure) return result
    throw new Error([
      `${command} ${args.join(' ')} exited ${result.status}`,
      result.stdout || '',
      result.stderr || '',
      result.error ? String(result.error) : '',
    ].filter(Boolean).join('\n'))
  }
  return result
}

function runNpm(args, options = {}) {
  const npm = npmCommandSpec()
  return run(npm.command, [...npm.prefix, ...args], { ...options, shell: npm.shell })
}

function downloadFile(url, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 180_000 }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        downloadFile(new URL(response.headers.location, url).toString(), targetPath).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`HTTP ${status} from ${url}`))
        return
      }
      const file = fs.createWriteStream(targetPath)
      file.on('error', reject)
      file.on('finish', () => file.close(resolve))
      response.pipe(file)
    })
    request.on('timeout', () => request.destroy(new Error(`Download timed out: ${url}`)))
    request.on('error', reject)
  })
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function parseShasumsForArchive(content, archiveFileName) {
  for (const line of content.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim())
    if (match && path.basename(match[2]) === archiveFileName) return match[1]
  }
  throw new Error(`Node.js SHASUMS256.txt does not contain ${archiveFileName}`)
}

async function verifyNodeArchiveChecksum(archive, archiveFile) {
  const archiveFileName = `${archive.name}.${archive.ext}`
  const shasumsFile = path.join(downloadsRoot, `${bundledNodeVersion}-SHASUMS256.txt`)
  const shasumsUrl = `https://nodejs.org/dist/${bundledNodeVersion}/SHASUMS256.txt`
  if (refresh || !fs.existsSync(shasumsFile)) await downloadFile(shasumsUrl, shasumsFile)

  const expected = parseShasumsForArchive(fs.readFileSync(shasumsFile, 'utf8'), archiveFileName)
  const actual = sha256File(archiveFile)
  if (actual !== expected) {
    throw new Error(`Node.js archive checksum mismatch for ${archiveFileName}: expected ${expected}, got ${actual}`)
  }
  console.log(`[runtime-bundles] verified Node/npm archive checksum: ${archiveFileName}`)
  return { sha256: actual, shasumsUrl }
}

function expandArchive(archivePath, destination) {
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  if (process.platform === 'win32' && archivePath.endsWith('.zip')) {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    run(ps, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ])
    return
  }
  run('tar', ['-xf', archivePath, '-C', destination])
}

function executableExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function nodeBinFor(dir) {
  return process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
}

function npmBinFor(dir) {
  return process.platform === 'win32' ? path.join(dir, 'npm.cmd') : path.join(dir, 'bin', 'npm')
}

function validateBundledNode(dir) {
  return executableExists(nodeBinFor(dir)) && executableExists(npmBinFor(dir))
}

function runtimeMetadataPath(dir) {
  return path.join(dir, RUNTIME_BUNDLE_METADATA_FILE)
}

function readRuntimeMetadata(dir) {
  try {
    return readJson(runtimeMetadataPath(dir))
  } catch {
    return null
  }
}

function writeRuntimeMetadata(dir, metadata) {
  fs.writeFileSync(runtimeMetadataPath(dir), `${JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    ...metadata,
  }, null, 2)}\n`)
}

function hasExpectedNodeMetadata(dir, archive) {
  const metadata = readRuntimeMetadata(dir)
  return Boolean(
    metadata?.node &&
    metadata.node.version === bundledNodeVersion &&
    metadata.node.archive === `${archive.name}.${archive.ext}` &&
    typeof metadata.node.sha256 === 'string' &&
    metadata.node.shasumsUrl === `https://nodejs.org/dist/${bundledNodeVersion}/SHASUMS256.txt`
  )
}

async function prepareNodeBundle() {
  const archive = platformArchive()
  const finalDir = path.join(bundledNodeRoot, archive.name)
  if (!refresh && validateBundledNode(finalDir) && hasExpectedNodeMetadata(finalDir, archive)) {
    console.log(`[runtime-bundles] Node/npm already prepared: ${finalDir}`)
    return
  }

  const archiveFile = path.join(downloadsRoot, `${archive.name}.${archive.ext}`)
  const extractDir = path.join(downloadsRoot, `extract-node-${process.pid}-${Date.now()}`)
  const url = `https://nodejs.org/dist/${bundledNodeVersion}/${archive.name}.${archive.ext}`
  console.log(`[runtime-bundles] downloading Node/npm: ${url}`)
  if (refresh || !fs.existsSync(archiveFile)) await downloadFile(url, archiveFile)
  const verifiedArchive = await verifyNodeArchiveChecksum(archive, archiveFile)
  expandArchive(archiveFile, extractDir)

  const extracted = path.join(extractDir, archive.name)
  if (!validateBundledNode(extracted)) throw new Error(`Downloaded Node.js archive is missing node/npm binaries: ${archive.name}`)
  fs.rmSync(finalDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(finalDir), { recursive: true })
  fs.renameSync(extracted, finalDir)
  writeRuntimeMetadata(finalDir, {
    node: {
      version: bundledNodeVersion,
      archive: `${archive.name}.${archive.ext}`,
      sha256: verifiedArchive.sha256,
      shasumsUrl: verifiedArchive.shasumsUrl,
    },
  })
  fs.rmSync(extractDir, { recursive: true, force: true })
  console.log(`[runtime-bundles] prepared Node/npm -> ${finalDir}`)
}

function codexNativePackageName() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') return `codex-win32-${arch}`
  if (process.platform === 'linux') return `codex-linux-${arch}`
  if (process.platform === 'darwin') return `codex-darwin-${arch}`
  return ''
}

function codexTargetTriple() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  return ''
}

function validateCodexBundle(rootDir) {
  const nativePackage = codexNativePackageName()
  const triple = codexTargetTriple()
  const nativeBin = path.join(
    rootDir,
    'node_modules',
    '@openai',
    nativePackage,
    'vendor',
    triple,
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  )
  return (
    fs.existsSync(path.join(rootDir, 'package.json')) &&
    fs.existsSync(path.join(rootDir, 'openclaw.plugin.json')) &&
    fs.existsSync(path.join(rootDir, 'dist', 'index.js')) &&
    fs.existsSync(path.join(rootDir, 'node_modules', '@openai', 'codex', 'package.json')) &&
    fs.existsSync(path.join(rootDir, 'node_modules', '@openai', nativePackage, 'package.json')) &&
    executableExists(nativeBin)
  )
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function packageLockEntry(lockPath, packagePath) {
  const lock = readJson(lockPath)
  return lock?.packages?.[`node_modules/${packagePath}`] || null
}

function verifyPackageLockPackage(lockPath, packagePath, expected) {
  const entry = packageLockEntry(lockPath, packagePath)
  if (!entry) throw new Error(`Package lock ${lockPath} is missing node_modules/${packagePath}`)
  if (expected.version && entry.version !== expected.version) {
    throw new Error(`Package lock ${packagePath} version mismatch: expected ${expected.version}, got ${entry.version}`)
  }
  if (expected.integrity && entry.integrity !== expected.integrity) {
    throw new Error(`Package lock ${packagePath} integrity mismatch.`)
  }
  if (expected.tarball && entry.resolved !== expected.tarball) {
    throw new Error(`Package lock ${packagePath} tarball mismatch: expected ${expected.tarball}, got ${entry.resolved}`)
  }
  if (!entry.integrity) throw new Error(`Package lock ${packagePath} is missing npm integrity metadata.`)
  return entry
}

function packageLockPathFor(rootDir) {
  for (const fileName of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const candidate = path.join(rootDir, fileName)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Missing npm lockfile in ${rootDir}`)
}

function hasExpectedCodexMetadata(rootDir) {
  const metadata = readRuntimeMetadata(rootDir)
  return Boolean(
    metadata?.codex &&
    metadata.codex.spec === bundledCodex.spec &&
    metadata.codex.version === bundledCodex.version &&
    metadata.codex.integrity === bundledCodexIntegrity &&
    (!bundledCodexTarball || metadata.codex.tarball === bundledCodexTarball)
  )
}

function removeNestedBundledPackage(rootDir) {
  fs.rmSync(path.join(rootDir, 'node_modules', '@openclaw', 'codex'), { recursive: true, force: true })
  try {
    const scopeDir = path.join(rootDir, 'node_modules', '@openclaw')
    if (fs.existsSync(scopeDir) && fs.readdirSync(scopeDir).length === 0) fs.rmdirSync(scopeDir)
  } catch {
    // Best effort cleanup only.
  }
}

async function prepareCodexBundle() {
  if (!refresh && validateCodexBundle(bundledCodexRoot) && hasExpectedCodexMetadata(bundledCodexRoot)) {
    const version = readJson(path.join(bundledCodexRoot, 'package.json')).version || 'unknown'
    console.log(`[runtime-bundles] Codex plugin already prepared: ${version}`)
    return
  }

  const workDir = path.join(installWorkRoot, 'codex')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(path.join(workDir, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`)

  console.log(`[runtime-bundles] installing ${bundledCodex.spec} for bundled Codex runtime`)
  runNpm(['install', '--prefix', workDir, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=true', '--save-exact', bundledCodex.spec], {
    stdio: 'inherit',
  })

  const source = path.join(workDir, 'node_modules', '@openclaw', 'codex')
  if (!fs.existsSync(source)) throw new Error(`npm install did not produce ${source}`)
  const installedPackage = readJson(path.join(source, 'package.json'))
  if (installedPackage.name !== '@openclaw/codex' || installedPackage.version !== bundledCodex.version) {
    throw new Error(`npm install produced unexpected Codex package ${installedPackage.name}@${installedPackage.version}`)
  }
  const installLock = packageLockPathFor(workDir)
  const sourceDependencyLock = packageLockPathFor(source)
  verifyPackageLockPackage(installLock, '@openclaw/codex', {
    version: bundledCodex.version,
    integrity: bundledCodexIntegrity,
    ...(bundledCodexTarball ? { tarball: bundledCodexTarball } : {}),
  })
  const nativePackage = codexNativePackageName()
  const openaiCodexEntry = verifyPackageLockPackage(sourceDependencyLock, '@openai/codex', {})
  const nativeCodexEntry = verifyPackageLockPackage(sourceDependencyLock, `@openai/${nativePackage}`, {})

  fs.rmSync(bundledCodexRoot, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(bundledCodexRoot), { recursive: true })
  fs.cpSync(source, bundledCodexRoot, { recursive: true })

  console.log('[runtime-bundles] copying locked Codex plugin dependencies into bundle root')
  fs.cpSync(path.join(source, 'node_modules'), path.join(bundledCodexRoot, 'node_modules'), { recursive: true })
  removeNestedBundledPackage(bundledCodexRoot)
  fs.copyFileSync(sourceDependencyLock, path.join(bundledCodexRoot, '.dystopai-runtime-package-lock.json'))

  if (!validateCodexBundle(bundledCodexRoot)) {
    throw new Error(`Prepared Codex plugin bundle is incomplete for ${process.platform}/${process.arch}: ${bundledCodexRoot}`)
  }

  const version = readJson(path.join(bundledCodexRoot, 'package.json')).version || 'unknown'
  writeRuntimeMetadata(bundledCodexRoot, {
    codex: {
      package: '@openclaw/codex',
      spec: bundledCodex.spec,
      version,
      integrity: bundledCodexIntegrity,
      ...(bundledCodexTarball ? { tarball: bundledCodexTarball } : {}),
      lockfile: '.dystopai-runtime-package-lock.json',
      dependencies: {
        '@openai/codex': {
          version: openaiCodexEntry.version,
          integrity: openaiCodexEntry.integrity,
        },
        [`@openai/${nativePackage}`]: {
          version: nativeCodexEntry.version,
          integrity: nativeCodexEntry.integrity,
        },
      },
    },
  })
  console.log(`[runtime-bundles] prepared Codex plugin ${version} -> ${bundledCodexRoot}`)
}

async function main() {
  fs.mkdirSync(bundleRoot, { recursive: true })
  await prepareNodeBundle()
  await prepareCodexBundle()
}

main().catch((error) => {
  console.error(`[runtime-bundles] ${error.stack || error.message || error}`)
  process.exit(1)
})
