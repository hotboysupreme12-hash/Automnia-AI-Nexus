const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bundleRoot = path.join(root, '.cache', 'runtime-bundles')
const bundledNodeRoot = path.join(bundleRoot, 'toolchains', 'node')
const bundledCodexRoot = path.join(bundleRoot, 'openclaw-codex', 'codex')
const downloadsRoot = path.join(bundleRoot, '.downloads')
const installWorkRoot = path.join(bundleRoot, '.work')

const bundledNodeVersion = (process.env.DYSTOPAI_BUNDLED_NODE_VERSION || 'v24.16.0').replace(/^node-/, '')
const bundledCodexSpec = process.env.DYSTOPAI_BUNDLED_CODEX_SPEC || '@openclaw/codex@latest'
const refresh = /^(1|true|yes)$/i.test(process.env.DYSTOPAI_REFRESH_RUNTIME_BUNDLES || '')

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

async function prepareNodeBundle() {
  const archive = platformArchive()
  const finalDir = path.join(bundledNodeRoot, archive.name)
  if (!refresh && validateBundledNode(finalDir)) {
    console.log(`[runtime-bundles] Node/npm already prepared: ${finalDir}`)
    return
  }

  const archiveFile = path.join(downloadsRoot, `${archive.name}.${archive.ext}`)
  const extractDir = path.join(downloadsRoot, `extract-node-${process.pid}-${Date.now()}`)
  const url = `https://nodejs.org/dist/${bundledNodeVersion}/${archive.name}.${archive.ext}`
  console.log(`[runtime-bundles] downloading Node/npm: ${url}`)
  if (refresh || !fs.existsSync(archiveFile)) await downloadFile(url, archiveFile)
  expandArchive(archiveFile, extractDir)

  const extracted = path.join(extractDir, archive.name)
  if (!validateBundledNode(extracted)) throw new Error(`Downloaded Node.js archive is missing node/npm binaries: ${archive.name}`)
  fs.rmSync(finalDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(finalDir), { recursive: true })
  fs.renameSync(extracted, finalDir)
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
  if (!refresh && validateCodexBundle(bundledCodexRoot)) {
    const version = readJson(path.join(bundledCodexRoot, 'package.json')).version || 'unknown'
    console.log(`[runtime-bundles] Codex plugin already prepared: ${version}`)
    return
  }

  const workDir = path.join(installWorkRoot, 'codex')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(path.join(workDir, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`)

  console.log(`[runtime-bundles] installing ${bundledCodexSpec} for bundled Codex runtime`)
  runNpm(['install', '--prefix', workDir, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', bundledCodexSpec], {
    stdio: 'inherit',
  })

  const source = path.join(workDir, 'node_modules', '@openclaw', 'codex')
  if (!fs.existsSync(source)) throw new Error(`npm install did not produce ${source}`)

  fs.rmSync(bundledCodexRoot, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(bundledCodexRoot), { recursive: true })
  fs.cpSync(source, bundledCodexRoot, { recursive: true })

  console.log('[runtime-bundles] hydrating Codex plugin dependencies inside bundle root')
  const hydration = runNpm(['install', '--prefix', bundledCodexRoot, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    allowFailure: true,
  })
  removeNestedBundledPackage(bundledCodexRoot)

  if (!validateCodexBundle(bundledCodexRoot)) {
    if (hydration.status !== 0) {
      console.warn('[runtime-bundles] Codex dependency hydration output was nonzero; validation will report the missing runtime file.')
    }
    throw new Error(`Prepared Codex plugin bundle is incomplete for ${process.platform}/${process.arch}: ${bundledCodexRoot}`)
  }
  if (hydration.status !== 0) {
    console.warn('[runtime-bundles] npm reported a nonzero dependency hydration exit, but the bundled Codex runtime files validated.')
  }

  const version = readJson(path.join(bundledCodexRoot, 'package.json')).version || 'unknown'
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
