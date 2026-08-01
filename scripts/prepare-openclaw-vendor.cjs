const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const { tmpdir } = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const vendorRoot = path.resolve(process.env.DYSTOPAI_OPENCLAW_VENDOR_ROOT || path.join(root, 'vendor', 'openclaw'))
const packageJsonPath = path.join(vendorRoot, 'package.json')
const shrinkwrapPath = path.join(vendorRoot, 'npm-shrinkwrap.json')
const nodeModulesRoot = path.join(vendorRoot, 'node_modules')
const metadataPath = path.join(nodeModulesRoot, '.dystopai-openclaw-vendor-deps.json')
const cacheRoot = path.join(root, '.cache', 'openclaw-vendor')
const refresh = /^(1|true|yes)$/i.test(process.env.DYSTOPAI_REFRESH_OPENCLAW_VENDOR_DEPS || '')

const DEFAULT_OPENCLAW_PACKAGE_VERSION = '2026.7.1-2'
const DEFAULT_OPENCLAW_PACKAGE_TARBALL = 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz'
const DEFAULT_OPENCLAW_PACKAGE_INTEGRITY = 'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g=='

const installArgs = [
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]

const fallbackInstallArgs = [
  'install',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--package-lock=false',
]

const requiredRuntimePackages = [
  '@modelcontextprotocol/sdk',
  'express',
  'json5',
  'openai',
  'ws',
  'zod',
]

const requiredPackageArtifacts = [
  path.join('dist', 'entry.js'),
  path.join('dist', 'index.js'),
  path.join('dist', 'plugin-sdk', 'index.js'),
  path.join('dist', 'extensions', 'browser', 'index.js'),
  path.join('dist', 'extensions', 'memory-wiki', 'skills', 'wiki-maintainer', 'SKILL.md'),
  path.join('dist', 'extensions', 'open-prose', 'skills', 'prose', 'SKILL.md'),
  path.join('scripts', 'lib', 'official-external-plugin-catalog.json'),
  path.join('scripts', 'lib', 'official-external-provider-catalog.json'),
  path.join('scripts', 'lib', 'official-external-channel-catalog.json'),
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function sriSha512File(filePath) {
  const hash = createHash('sha512')
  hash.update(fs.readFileSync(filePath))
  return `sha512-${hash.digest('base64')}`
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
        reject(new Error(`[openclaw-vendor] HTTP ${status} while downloading ${url}`))
        return
      }
      const file = fs.createWriteStream(targetPath)
      file.on('error', reject)
      file.on('finish', () => file.close(resolve))
      response.pipe(file)
    })
    request.on('timeout', () => request.destroy(new Error(`[openclaw-vendor] Download timed out: ${url}`)))
    request.on('error', reject)
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`[openclaw-vendor] ${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function npmCommandSpec() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, prefix: [process.env.npm_execpath], shell: false }
  }
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      prefix: ['/d', '/s', '/c', 'npm.cmd'],
      shell: false,
    }
  }
  return {
    command: 'npm',
    prefix: [],
    shell: false,
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

function lockHasPackage(lock, packageName) {
  return Boolean(lock?.packages?.[`node_modules/${packageName}`])
}

function needsProductionOnlyPackageManifest(packageJson, lock) {
  const devDependencies = Object.keys(packageJson.devDependencies || {})
  return devDependencies.some((packageName) => !lockHasPackage(lock, packageName))
}

function runNpmCiWithFallback(primaryMode) {
  try {
    runNpm(installArgs)
    return primaryMode
  } catch (error) {
    console.warn(
      `[openclaw-vendor] npm ci rejected the published shrinkwrap (${error.message}); retrying without rewriting npm-shrinkwrap.json`,
    )
    fs.rmSync(nodeModulesRoot, { recursive: true, force: true })
    runNpm(fallbackInstallArgs)
    return `${primaryMode}-fallback-unlocked-install`
  }
}

function runNpmInstall(packageJson, lock) {
  if (!needsProductionOnlyPackageManifest(packageJson, lock)) {
    return runNpmCiWithFallback('npm-ci-omit-dev')
  }

  const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8')
  const productionPackageJson = { ...packageJson }
  delete productionPackageJson.devDependencies

  console.log('[openclaw-vendor] published shrinkwrap is production-scoped; using temporary production-only package manifest')
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(productionPackageJson, null, 2)}\n`)
  try {
    return runNpmCiWithFallback('npm-ci-omit-dev-production-manifest')
  } finally {
    fs.writeFileSync(packageJsonPath, originalPackageJson)
  }
}

function resolvePackageTarball(packageJson) {
  const tarball = String(
    process.env.DYSTOPAI_OPENCLAW_PACKAGE_TARBALL ||
    (packageJson.version === DEFAULT_OPENCLAW_PACKAGE_VERSION ? DEFAULT_OPENCLAW_PACKAGE_TARBALL : ''),
  ).trim()
  const integrity = String(
    process.env.DYSTOPAI_OPENCLAW_PACKAGE_INTEGRITY ||
    (packageJson.version === DEFAULT_OPENCLAW_PACKAGE_VERSION ? DEFAULT_OPENCLAW_PACKAGE_INTEGRITY : ''),
  ).trim()

  if (!tarball || !integrity) {
    throw new Error(
      `[openclaw-vendor] Set DYSTOPAI_OPENCLAW_PACKAGE_TARBALL and DYSTOPAI_OPENCLAW_PACKAGE_INTEGRITY for OpenClaw ${packageJson.version}`,
    )
  }
  if (!/^sha512-[A-Za-z0-9+/=]+$/.test(integrity)) {
    throw new Error('[openclaw-vendor] DYSTOPAI_OPENCLAW_PACKAGE_INTEGRITY must be an npm sha512 integrity value')
  }
  return { tarball, integrity }
}

function packageArtifactsMetadataPath() {
  return path.join(vendorRoot, 'dist', '.dystopai-openclaw-package.json')
}

function packageArtifactsMatch(packageJson) {
  try {
    const metadata = readJson(packageArtifactsMetadataPath())
    return metadata?.schema === 1 &&
      metadata?.package === packageJson.name &&
      metadata?.version === packageJson.version
  } catch {
    return false
  }
}

function missingPackageArtifacts(packageJson) {
  const missing = requiredPackageArtifacts.filter((artifact) => !fs.existsSync(path.join(vendorRoot, artifact)))
  if (!packageArtifactsMatch(packageJson)) {
    missing.push(path.join('dist', '.dystopai-openclaw-package.json'))
  }
  return missing
}

async function hydratePublishedPackageArtifacts(packageJson) {
  const missing = missingPackageArtifacts(packageJson)
  if (!refresh && missing.length === 0) {
    return { mode: 'existing-package-artifacts' }
  }

  if (missing.length) {
    console.log(`[openclaw-vendor] missing published package artifacts: ${missing.join(', ')}`)
  }
  const source = resolvePackageTarball(packageJson)
  const tarballPath = path.join(cacheRoot, `openclaw-${packageJson.version}.tgz`)
  const extractRoot = fs.mkdtempSync(path.join(tmpdir(), 'dystopai-openclaw-package-'))

  try {
    if (refresh || !fs.existsSync(tarballPath)) {
      console.log(`[openclaw-vendor] downloading OpenClaw package payload: ${source.tarball}`)
      await downloadFile(source.tarball, tarballPath)
    }
    const actualIntegrity = sriSha512File(tarballPath)
    if (actualIntegrity !== source.integrity) {
      throw new Error(
        `[openclaw-vendor] OpenClaw package tarball integrity mismatch: expected ${source.integrity}, got ${actualIntegrity}`,
      )
    }

    run('tar', ['-xzf', tarballPath, '-C', extractRoot])
    const packageRoot = path.join(extractRoot, 'package')
    const packageDist = path.join(packageRoot, 'dist')
    if (!fs.existsSync(path.join(packageRoot, 'package.json')) || !fs.existsSync(packageDist)) {
      throw new Error('[openclaw-vendor] OpenClaw package tarball did not contain package/dist')
    }
    const publishedPackage = readJson(path.join(packageRoot, 'package.json'))
    if (publishedPackage.name !== packageJson.name || publishedPackage.version !== packageJson.version) {
      throw new Error(
        `[openclaw-vendor] OpenClaw package tarball mismatch: expected ${packageJson.name}@${packageJson.version}, got ${publishedPackage.name}@${publishedPackage.version}`,
      )
    }

    fs.rmSync(path.join(vendorRoot, 'dist'), { recursive: true, force: true })
    fs.cpSync(packageDist, path.join(vendorRoot, 'dist'), { recursive: true })
    fs.writeFileSync(packageArtifactsMetadataPath(), `${JSON.stringify({
      schema: 1,
      package: publishedPackage.name,
      version: publishedPackage.version,
      tarball: source.tarball,
      integrity: source.integrity,
    }, null, 2)}\n`)
    const stillMissing = missingPackageArtifacts(packageJson)
    if (stillMissing.length) {
      throw new Error(`[openclaw-vendor] OpenClaw package payload is missing required artifacts: ${stillMissing.join(', ')}`)
    }
    console.log(`[openclaw-vendor] hydrated OpenClaw ${packageJson.version} package payload from npm tarball`)
    return {
      mode: 'npm-package-tarball',
      tarball: source.tarball,
      integrity: source.integrity,
    }
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true })
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

function writeMetadata(packageJson, shrinkwrapSha256, mode, packageArtifacts) {
  const args = mode.includes('fallback-unlocked-install') ? fallbackInstallArgs : installArgs
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
      packageArtifacts,
    },
    install: {
      command: 'npm',
      args,
      ignoreScripts: true,
      omitDev: true,
      shrinkwrapPreserved: true,
    },
    requiredRuntimePackages,
  }, null, 2)}\n`)
}

async function main() {
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
  const packageArtifacts = await hydratePublishedPackageArtifacts(packageJson)

  if (!refresh && fs.existsSync(nodeModulesRoot)) {
    const missing = validateInstalledPackages(lock)
    const metadata = readMetadata()
    if (missing.length === 0 && metadataMatches(metadata, packageJson, shrinkwrapSha256)) {
      console.log(`[openclaw-vendor] OpenClaw ${packageJson.version} production dependencies already prepared`)
      return
    }
    if (missing.length === 0) {
      writeMetadata(packageJson, shrinkwrapSha256, 'validated-existing-node-modules', packageArtifacts)
      console.log(`[openclaw-vendor] validated existing OpenClaw ${packageJson.version} production dependencies`)
      return
    }
    console.log(`[openclaw-vendor] missing production dependencies: ${missing.join(', ')}`)
  }

  console.log(`[openclaw-vendor] installing OpenClaw ${packageJson.version} production dependencies from npm-shrinkwrap.json`)
  const installMode = runNpmInstall(packageJson, lock)
  const missing = validateInstalledPackages(lock)
  if (missing.length) {
    throw new Error(`[openclaw-vendor] npm ci completed but runtime dependencies are still missing: ${missing.join(', ')}`)
  }
  writeMetadata(packageJson, shrinkwrapSha256, installMode, packageArtifacts)
  console.log(`[openclaw-vendor] prepared OpenClaw ${packageJson.version} production dependencies`)
}

main().catch((error) => {
  console.error(error.stack || error.message || error)
  process.exit(1)
})
