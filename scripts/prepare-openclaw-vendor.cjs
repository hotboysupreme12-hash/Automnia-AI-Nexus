const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const vendorRoot = path.resolve(process.env.DYSTOPAI_OPENCLAW_VENDOR_ROOT || path.join(root, 'vendor', 'openclaw'))
const packageJsonPath = path.join(vendorRoot, 'package.json')
const shrinkwrapPath = path.join(vendorRoot, 'npm-shrinkwrap.json')
const nodeModulesRoot = path.join(vendorRoot, 'node_modules')
const metadataPath = path.join(nodeModulesRoot, '.dystopai-openclaw-vendor-deps.json')
const refresh = /^(1|true|yes)$/i.test(process.env.DYSTOPAI_REFRESH_OPENCLAW_VENDOR_DEPS || '')

const installArgs = [
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]

const requiredRuntimePackages = [
  '@modelcontextprotocol/sdk',
  'express',
  'json5',
  'openai',
  'ws',
  'zod',
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
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

function runNpm(args) {
  const npm = npmCommandSpec()
  const result = spawnSync(npm.command, [...npm.prefix, ...args], {
    cwd: vendorRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: npm.shell,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`[openclaw-vendor] npm ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function packageJsonFor(packageName) {
  return path.join(nodeModulesRoot, ...packageName.split('/'), 'package.json')
}

function lockPackage(lock, packageName) {
  const entry = lock?.packages?.[`node_modules/${packageName}`]
  if (!entry) throw new Error(`[openclaw-vendor] npm-shrinkwrap.json is missing node_modules/${packageName}`)
  if (!entry.version) throw new Error(`[openclaw-vendor] npm-shrinkwrap.json entry for ${packageName} has no version`)
  if (!entry.integrity) throw new Error(`[openclaw-vendor] npm-shrinkwrap.json entry for ${packageName} has no integrity`)
  return entry
}

function validateVendorSource(lock) {
  const packageJson = readJson(packageJsonPath)
  if (packageJson.name !== 'openclaw') {
    throw new Error(`[openclaw-vendor] Expected vendor/openclaw package name to be openclaw, got ${packageJson.name}`)
  }
  if (lock.name !== packageJson.name || lock.version !== packageJson.version) {
    throw new Error('[openclaw-vendor] npm-shrinkwrap.json does not match vendor/openclaw package metadata')
  }
}

function validateInstalledPackages(lock) {
  const missing = []
  for (const packageName of requiredRuntimePackages) {
    const installedPath = packageJsonFor(packageName)
    if (!fs.existsSync(installedPath)) {
      missing.push(packageName)
      continue
    }

    const expected = lockPackage(lock, packageName)
    const installed = readJson(installedPath)
    if (installed.version !== expected.version) {
      throw new Error(
        `[openclaw-vendor] ${packageName} version mismatch: expected ${expected.version}, got ${installed.version}`,
      )
    }
  }
  return missing
}

function readMetadata() {
  try {
    return readJson(metadataPath)
  } catch {
    return null
  }
}

function metadataMatches(metadata, packageJson, shrinkwrapSha256) {
  return Boolean(
    metadata?.schema === 1 &&
    metadata.openclaw?.version === packageJson.version &&
    metadata.openclaw?.shrinkwrapSha256 === shrinkwrapSha256 &&
    Array.isArray(metadata.requiredRuntimePackages) &&
    requiredRuntimePackages.every((packageName) => metadata.requiredRuntimePackages.includes(packageName)),
  )
}

function writeMetadata(packageJson, shrinkwrapSha256, mode) {
  fs.mkdirSync(nodeModulesRoot, { recursive: true })
  fs.writeFileSync(metadataPath, `${JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    mode,
    openclaw: {
      package: packageJson.name,
      version: packageJson.version,
      shrinkwrap: 'npm-shrinkwrap.json',
      shrinkwrapSha256,
    },
    install: {
      command: 'npm',
      args: installArgs,
      ignoreScripts: true,
      omitDev: true,
    },
    requiredRuntimePackages,
  }, null, 2)}\n`)
}

function main() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`[openclaw-vendor] Missing vendored OpenClaw package at ${packageJsonPath}`)
  }
  if (!fs.existsSync(shrinkwrapPath)) {
    throw new Error(`[openclaw-vendor] Missing vendored OpenClaw npm-shrinkwrap.json at ${shrinkwrapPath}`)
  }

  const packageJson = readJson(packageJsonPath)
  const lock = readJson(shrinkwrapPath)
  const shrinkwrapSha256 = sha256File(shrinkwrapPath)
  validateVendorSource(lock)

  if (!refresh && fs.existsSync(nodeModulesRoot)) {
    const missing = validateInstalledPackages(lock)
    const metadata = readMetadata()
    if (missing.length === 0 && metadataMatches(metadata, packageJson, shrinkwrapSha256)) {
      console.log(`[openclaw-vendor] OpenClaw ${packageJson.version} production dependencies already prepared`)
      return
    }
    if (missing.length === 0) {
      writeMetadata(packageJson, shrinkwrapSha256, 'validated-existing-node-modules')
      console.log(`[openclaw-vendor] validated existing OpenClaw ${packageJson.version} production dependencies`)
      return
    }
    console.log(`[openclaw-vendor] missing production dependencies: ${missing.join(', ')}`)
  }

  console.log(`[openclaw-vendor] installing OpenClaw ${packageJson.version} production dependencies from npm-shrinkwrap.json`)
  runNpm(installArgs)
  const missing = validateInstalledPackages(lock)
  if (missing.length) {
    throw new Error(`[openclaw-vendor] npm ci completed but runtime dependencies are still missing: ${missing.join(', ')}`)
  }
  writeMetadata(packageJson, shrinkwrapSha256, 'npm-ci-omit-dev')
  console.log(`[openclaw-vendor] prepared OpenClaw ${packageJson.version} production dependencies`)
}

try {
  main()
} catch (error) {
  console.error(error.stack || error.message || error)
  process.exit(1)
}
