const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { ensureRelayAiTransportCompatibility } = require('./lib/relay-thought-signature-patch.cjs')
const { ensureRestartRecoveryClaimStartupRepair } = require('./lib/restart-recovery-stale-claim-patch.cjs')
const { ensureMissingSessionStoreRecovery } = require('./lib/session-store-missing-path-patch.cjs')
const { ensureRestartResumeCustodyRetry } = require('./lib/restart-resume-custody-retry-patch.cjs')
const { ensureAutomniaAgentDatabaseFastStart } = require('./lib/openclaw-agent-db-fast-start-patch.cjs')
const { patchGoogleGeminiOnboardingDefault } = require('./lib/google-gemini-onboarding-default.cjs')
const { patchAutomniaCloud424FailoverDist } = require('./lib/openclaw-automnia-cloud-failover-patch.cjs')
const {
  prepareGoogleGeminiDiscoverySource,
  prepareGoogleGeminiDirectVideoBuilder,
  prepareGoogleGeminiManifest,
} = require('./lib/google-gemini-model-catalog.cjs')

const root = path.resolve(__dirname, '..')
const vendorRoot = path.resolve(process.env.AUTOMNIA_OPENCLAW_VENDOR_ROOT || path.join(root, 'vendor', 'openclaw'))
const packageJsonPath = path.join(vendorRoot, 'package.json')
const shrinkwrapPath = path.join(vendorRoot, 'npm-shrinkwrap.json')
const nodeModulesRoot = path.join(vendorRoot, 'node_modules')
const metadataPath = path.join(nodeModulesRoot, '.automnia-openclaw-vendor-deps.json')
const cacheRoot = path.join(root, '.cache', 'openclaw-vendor')
const refresh = /^(1|true|yes)$/i.test(process.env.AUTOMNIA_REFRESH_OPENCLAW_VENDOR_DEPS || '')

function isJavaScriptBundle(name) {
  return name.endsWith('.js') || name.endsWith('.mjs')
}

const DEFAULT_OPENCLAW_PACKAGE_VERSION = '2026.11.6'
const DEFAULT_OPENCLAW_PACKAGE_TARBALL = 'https://registry.npmjs.org/openclaw/-/openclaw-2026.11.6.tgz'
const DEFAULT_OPENCLAW_PACKAGE_INTEGRITY = 'sha512-4MGjAMv8QlVrul3ZbCu8KjM7GhXfLdLzf0IrsO5QZ8LC3oYkduqs2rZiZpPDmTRpT6kXYke/OVaWrB+YmhBHLw=='

const installArgs = [
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
]

const fallbackInstallArgs = [
  'install',
  '--omit=dev',
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  '--package-lock=false',
]

const requiredRuntimePackages = [
  '@openclaw/ai',
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
  path.join('dist', 'plugin-sdk', 'agent-runtime.js'),
  path.join('dist', 'extensions', 'browser', 'index.js'),
  path.join('dist', 'extensions', 'memory-wiki', 'skills', 'wiki-maintainer', 'SKILL.md'),
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

const MAX_PACKAGE_DOWNLOAD_ATTEMPTS = 3
const TRANSIENT_DOWNLOAD_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

function isTransientDownloadError(error) {
  if (Array.isArray(error?.errors) && error.errors.some(isTransientDownloadError)) return true
  if (TRANSIENT_DOWNLOAD_CODES.has(error?.code)) return true
  if (error?.statusCode === 429 || error?.statusCode >= 500) return true
  return /timed?\s*out|timeout|temporar|socket hang up/i.test(String(error?.message || error))
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function downloadFile(url, targetPath, attempt = 1) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  try {
    await new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: 180_000 }, (response) => {
        const status = response.statusCode || 0
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          downloadFile(new URL(response.headers.location, url).toString(), targetPath).then(resolve, reject)
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          const error = new Error(`[openclaw-vendor] HTTP ${status} while downloading ${url}`)
          error.statusCode = status
          reject(error)
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
  } catch (error) {
    fs.rmSync(targetPath, { force: true })
    if (attempt >= MAX_PACKAGE_DOWNLOAD_ATTEMPTS || !isTransientDownloadError(error)) throw error
    const delayMs = 1000 * attempt
    console.warn(`[openclaw-vendor] download attempt ${attempt}/${MAX_PACKAGE_DOWNLOAD_ATTEMPTS} failed; retrying in ${delayMs}ms: ${error.message}`)
    await wait(delayMs)
    return downloadFile(url, targetPath, attempt + 1)
  }
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
    process.env.AUTOMNIA_OPENCLAW_PACKAGE_TARBALL ||
    (packageJson.version === DEFAULT_OPENCLAW_PACKAGE_VERSION ? DEFAULT_OPENCLAW_PACKAGE_TARBALL : ''),
  ).trim()
  const integrity = String(
    process.env.AUTOMNIA_OPENCLAW_PACKAGE_INTEGRITY ||
    (packageJson.version === DEFAULT_OPENCLAW_PACKAGE_VERSION ? DEFAULT_OPENCLAW_PACKAGE_INTEGRITY : ''),
  ).trim()

  if (!tarball || !integrity) {
    throw new Error(
      `[openclaw-vendor] Set AUTOMNIA_OPENCLAW_PACKAGE_TARBALL and AUTOMNIA_OPENCLAW_PACKAGE_INTEGRITY for OpenClaw ${packageJson.version}`,
    )
  }
  if (!/^sha512-[A-Za-z0-9+/=]+$/.test(integrity)) {
    throw new Error('[openclaw-vendor] AUTOMNIA_OPENCLAW_PACKAGE_INTEGRITY must be an npm sha512 integrity value')
  }
  return { tarball, integrity }
}

function packageArtifactsMetadataPath() {
  return path.join(vendorRoot, 'dist', '.automnia-openclaw-package.json')
}

function packageArtifactsMatch(packageJson, expectedIntegrity) {
  try {
    const metadata = readJson(packageArtifactsMetadataPath())
    return metadata?.schema === 1 &&
      metadata?.package === packageJson.name &&
      metadata?.version === packageJson.version &&
      metadata?.integrity === expectedIntegrity
  } catch {
    return false
  }
}

function missingPackageArtifacts(packageJson, expectedIntegrity) {
  const missing = requiredPackageArtifacts.filter((artifact) => !fs.existsSync(path.join(vendorRoot, artifact)))
  if (!packageArtifactsMatch(packageJson, expectedIntegrity)) {
    missing.push(path.join('dist', '.automnia-openclaw-package.json'))
  }
  return missing
}

async function hydratePublishedPackageArtifacts(packageJson) {
  const source = resolvePackageTarball(packageJson)
  const missing = missingPackageArtifacts(packageJson, source.integrity)
  if (!refresh && missing.length === 0) {
    return {
      mode: 'existing-package-artifacts',
      tarball: source.tarball,
      integrity: source.integrity,
    }
  }

  if (missing.length) {
    console.log(`[openclaw-vendor] missing published package artifacts: ${missing.join(', ')}`)
  }
  const tarballPath = path.join(cacheRoot, `openclaw-${packageJson.version}.tgz`)
  const extractRoot = fs.mkdtempSync(path.join(tmpdir(), 'automnia-openclaw-package-'))

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
    const stillMissing = missingPackageArtifacts(packageJson, source.integrity)
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

function ensureGatewayLifecycleStartupImportIsDeferred() {
  const distRoot = path.join(vendorRoot, 'dist')
  const cliRoot = path.join(distRoot, 'cli')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for Gateway lifecycle startup patch')
  if (!fs.existsSync(cliRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist/cli directory for Gateway lifecycle startup patch')

  const runBundleName = fs.readdirSync(distRoot).find((name) => {
    if (!/^run-[^/]+\.mjs$/.test(name)) return false
    const source = fs.readFileSync(path.join(distRoot, name), 'utf8')
    return source.includes('prepareGatewayRunLoop(') && source.includes('import("./cli/gateway-lifecycle.runtime.js")')
  })
  if (!runBundleName) throw new Error('[openclaw-vendor] Could not locate OpenClaw Gateway run bundle for lifecycle startup patch')

  const lifecyclePath = path.join(cliRoot, 'gateway-lifecycle.runtime.js')
  if (!fs.existsSync(lifecyclePath)) throw new Error('[openclaw-vendor] Missing OpenClaw Gateway lifecycle runtime bundle')
  const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8')
  const findImport = (exportName) => {
    const line = lifecycleSource.split(/\r?\n/).find((candidate) => candidate.includes(` as ${exportName}`))
    if (!line) throw new Error(`[openclaw-vendor] Could not resolve lifecycle bootstrap import ${exportName}`)
    const aliasMatch = line.match(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s+as\\s+${exportName}\\b`))
    const moduleMatch = line.match(/from "\.\.\/([^"]+)"/)
    if (!aliasMatch || !moduleMatch) throw new Error(`[openclaw-vendor] Could not parse lifecycle bootstrap import ${exportName}`)
    return { alias: aliasMatch[1], module: moduleMatch[1] }
  }
  const truthyEnv = findImport('isTruthyEnvValue')
  const containerEnvironment = findImport('isContainerEnvironment')
  const detectSupervisor = findImport('detectGatewayRespawnSupervisor')
  const detectSupervisorIdentity = findImport('detectGatewayRespawnSupervisorIdentity')
  if (detectSupervisor.module !== detectSupervisorIdentity.module) {
    throw new Error('[openclaw-vendor] Gateway supervisor bootstrap imports are split unexpectedly')
  }

  const bootstrapPath = path.join(cliRoot, 'gateway-lifecycle-bootstrap.runtime.js')
  fs.writeFileSync(bootstrapPath, [
    `import { ${truthyEnv.alias} as isTruthyEnvValue } from "../${truthyEnv.module}";`,
    `import { ${containerEnvironment.alias} as isContainerEnvironment } from "../${containerEnvironment.module}";`,
    `import { ${detectSupervisor.alias} as detectGatewayRespawnSupervisor, ${detectSupervisorIdentity.alias} as detectGatewayRespawnSupervisorIdentity } from "../${detectSupervisor.module}";`,
    '',
    'function resolveGatewayRestartDecision() {',
    '\tif (isTruthyEnvValue(process.env.OPENCLAW_NO_RESPAWN)) return {',
    '\t\tmode: "disabled",',
    '\t\treason: "no-respawn"',
    '\t};',
    '\tconst supervisor = detectGatewayRespawnSupervisor(process.env);',
    '\tif (supervisor) return {',
    '\t\tmode: "supervised",',
    '\t\tsupervisor',
    '\t};',
    '\treturn {',
    '\t\tmode: "disabled",',
    '\t\treason: "unmanaged",',
    '\t\tdetail: process.platform === "win32" ? "win32: detached respawn unsupported without Scheduled Task markers" : isContainerEnvironment() ? "container: use in-process restart to keep PID 1 alive" : "unmanaged: use in-process restart to keep custom supervisor PID tracking stable"',
    '\t};',
    '}',
    '',
    'export { detectGatewayRespawnSupervisorIdentity, resolveGatewayRestartDecision };',
    '',
  ].join('\n'))

  const runPath = path.join(distRoot, runBundleName)
  let runSource = fs.readFileSync(runPath, 'utf8')
  const bootstrapLoader = 'const lifecycleBootstrapRuntimeLoader = createLazyImportLoader(() => import("./cli/gateway-lifecycle-bootstrap.runtime.js"));'
  if (!runSource.includes(bootstrapLoader)) {
    const lifecycleLoader = 'const lifecycleRuntimeLoader = createLazyImportLoader(() => import("./cli/gateway-lifecycle.runtime.js"));'
    if (!runSource.includes(lifecycleLoader)) throw new Error('[openclaw-vendor] Gateway lifecycle runtime loader marker changed')
    runSource = runSource.replace(lifecycleLoader, `${bootstrapLoader}\n${lifecycleLoader}`)

    const functionStart = runSource.indexOf('async function prepareGatewayRunLoop(')
    const functionEnd = runSource.indexOf('\nfunction createGatewayRestartRecovery', functionStart)
    if (functionStart < 0 || functionEnd < 0) throw new Error('[openclaw-vendor] Gateway run-loop preparation markers changed')
    const signatureMatch = /^async function prepareGatewayRunLoop\(([^)]*)\) \{/u.exec(runSource.slice(functionStart))
    if (!signatureMatch) throw new Error('[openclaw-vendor] Gateway run-loop preparation signature changed')
    const runLoopParams = signatureMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
    if (runLoopParams.length < 1 || runLoopParams.length > 2 || !runLoopParams.every((value) => /^[A-Za-z_$][\w$]*$/u.test(value))) {
      throw new Error('[openclaw-vendor] Gateway run-loop preparation parameters changed')
    }
    const [configParam, startupBudgetParam] = runLoopParams
    const originalRunLoop = runSource.slice(functionStart, functionEnd)
    const hasStartupBudget = originalRunLoop.includes('startupBudget:')
    const lineEnding = runSource.includes('\r\n') ? '\r\n' : '\n'
    const replacementLines = [
      `async function prepareGatewayRunLoop(${runLoopParams.join(', ')}) {`,
      '\tconst lifecycleBootstrapRuntime = await measureGatewayBootstrapStep("cli.bootstrap.lifecycle-runtime", () => lifecycleBootstrapRuntimeLoader.load());',
      '\tconst supervisor = lifecycleBootstrapRuntime.detectGatewayRespawnSupervisorIdentity(process.env, process.platform, { includeLinuxOpenClawGatewayServiceMarker: true });',
      '\tconst supervisorMode = supervisor?.kind ?? null;',
      '\tconst restartDecision = lifecycleBootstrapRuntime.resolveGatewayRestartDecision();',
    ]
    if (hasStartupBudget) {
      if (!startupBudgetParam) throw new Error('[openclaw-vendor] Gateway run-loop startup budget argument is missing')
      replacementLines.push(`\tconst startupBudget = await resolveGatewayShutdownBudget(supervisorMode, ${startupBudgetParam});`)
    }
    replacementLines.push(
      '\tconst lock = await measureGatewayBootstrapStep("cli.bootstrap.gateway-lock", () => acquireGatewayLock({',
      `\t\tport: ${configParam}.lockPort,`,
      '\t\tlistenerMode: supervisorMode ? "supervised" : "foreground",',
      '\t\tsupervisor,',
      `\t\t...${configParam}.lifecycleLockDeadlineMs !== void 0 ? { lifecycleDeadlineMs: ${configParam}.lifecycleLockDeadlineMs } : {}`,
      '\t}));',
      '\tconst lifecycleRuntime = await measureGatewayBootstrapStep("cli.bootstrap.lifecycle-runtime-post-lock", () => lifecycleRuntimeLoader.load());',
      '\treturn {',
      '\t\tlifecycleRuntime,',
      '\t\tsupervisor,',
      '\t\tsupervisorMode,',
      '\t\trestartDecision,',
      ...(hasStartupBudget ? ['\t\tstartupBudget,'] : []),
      '\t\tlock',
      '\t};',
      '}',
    )
    const replacement = replacementLines.join(lineEnding)
    runSource = `${runSource.slice(0, functionStart)}${replacement}${runSource.slice(functionEnd)}`
  }
  const sidecarStartupMarker = 'const envSidecarStartupMode = isChannelStartupSuppressedByEnvironment() ? "defer" : "start";'
  const managedSidecarStartupMarker = 'const envSidecarStartupMode = isChannelStartupSuppressedByEnvironment() || process.env.AUTOMNIA_MANAGED_GATEWAY_STARTUP === "defer" ? "defer" : "start";'
  const managedMinifiedSidecarStartupMarker = /const [A-Za-z_$][\w$]* = isChannelStartupSuppressedByEnvironment\(\) \|\| process\.env\.AUTOMNIA_MANAGED_GATEWAY_STARTUP === "defer" \? "defer" : "start";/u
  if (runSource.includes(sidecarStartupMarker)) {
    runSource = runSource.replace(sidecarStartupMarker, managedSidecarStartupMarker)
  } else if (!runSource.includes(managedSidecarStartupMarker) && !managedMinifiedSidecarStartupMarker.test(runSource)) {
    const minifiedSidecarStartupMarker = /const ([A-Za-z_$][\w$]*) = isChannelStartupSuppressedByEnvironment\(\) \? "defer" : "start";/u
    if (minifiedSidecarStartupMarker.test(runSource)) {
      runSource = runSource.replace(minifiedSidecarStartupMarker, 'const $1 = isChannelStartupSuppressedByEnvironment() || process.env.AUTOMNIA_MANAGED_GATEWAY_STARTUP === "defer" ? "defer" : "start";')
    } else {
      throw new Error('[openclaw-vendor] Gateway sidecar startup mode marker changed')
    }
  }
  fs.writeFileSync(runPath, runSource)
}

function ensureGatewayManagedSidecarStartupGrace() {
  const distRoot = path.join(vendorRoot, 'dist')
  const startupBundleName = fs.readdirSync(distRoot).find((name) => {
    if (!/^server-startup-post-attach-[^/]+\.mjs$/.test(name)) return false
    const source = fs.readFileSync(path.join(distRoot, name), 'utf8')
    return source.includes('const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : setImmediate$1().then(async () => {') || /const startSidecars = \(\) => [A-Za-z_$][\w$]*\.minimalTestGateway \? startStartupLog\(\)\.then\(\(\) => \{/u.test(source)
  })
  if (!startupBundleName) {
    const alreadyPatched = fs.readdirSync(distRoot).some((name) => {
      if (!/^server-startup-post-attach-[^/]+\.mjs$/.test(name)) return false
      return fs.readFileSync(path.join(distRoot, name), 'utf8').includes('sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000))')
    })
    if (alreadyPatched) return
    throw new Error('[openclaw-vendor] Gateway post-attach sidecar startup marker changed')
  }
  const startupPath = path.join(distRoot, startupBundleName)
  let source = fs.readFileSync(startupPath, 'utf8')
  const marker = 'const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : setImmediate$1().then(async () => {'
  const replacement = 'const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : (params.sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000)) : Promise.resolve()).then(() => setImmediate$1()).then(async () => {'
  if (source.includes(marker)) {
    source = source.replace(marker, replacement)
  } else {
    const runLoopParam = source.match(/async function startGatewayPostAttachRuntime\(([A-Za-z_$][\w$]*)\) \{/u)?.[1]
    const minifiedMarker = `const startSidecars = () => ${runLoopParam}.minimalTestGateway ? startStartupLog().then(() => {`
    const markerIndex = runLoopParam ? source.indexOf(minifiedMarker) : -1
    const continuation = ': setImmediate$1().then(async () => {'
    const continuationIndex = markerIndex < 0 ? -1 : source.indexOf(continuation, markerIndex + minifiedMarker.length)
    if (markerIndex < 0 || continuationIndex < 0) {
      if (source.includes('sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000))')) return
      throw new Error('[openclaw-vendor] Gateway post-attach sidecar startup marker changed')
    }
    const deferredContinuation = `: (${runLoopParam}.sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000)) : Promise.resolve()).then(() => setImmediate$1()).then(async () => {`
    source = `${source.slice(0, continuationIndex)}${deferredContinuation}${source.slice(continuationIndex + continuation.length)}`
  }
  fs.writeFileSync(startupPath, source)
}

function ensureAutomniaRelayThoughtSignatureSupport() {
  // OpenClaw moved the OpenAI-compatible serializer into @openclaw/ai.
  // That path is patched after production dependencies are validated below.
  if (readJson(packageJsonPath).dependencies?.['@openclaw/ai']) return
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for Automnia Relay compatibility patch')
  const marker = 'const isAutomniaGeminiRelay = model.provider === "automnia-cloud"'
  const sourcePattern = /function isGoogleOpenAICompatModel\(model\) \{\n\tconst endpointClass = detectOpenAICompletionsCompat\(model\)\.capabilities\.endpointClass;\n\treturn model\.provider === "google" \|\| endpointClass === "google-generative-ai" \|\| endpointClass === "google-vertex";\n\}/
  const replacement = `function isGoogleOpenAICompatModel(model) {\n\tconst endpointClass = detectOpenAICompletionsCompat(model).capabilities.endpointClass;\n\t// Automnia Relay is an OpenAI-compatible billing boundary backed by\n\t// Gemini 3.x. Keep it on the same thought-signature replay path as Google\n\t// providers so a hosted tool call can continue through the next Gateway\n\t// turn without degrading the function call into transcript text.\n\tconst isAutomniaGeminiRelay = model.provider === "automnia-cloud" && /(?:^|\\/)gemini-3(?:\\.\\d+)?-(?:flash|pro)(?:-|$)/i.test(model.id);\n\treturn model.provider === "google" || isAutomniaGeminiRelay || endpointClass === "google-generative-ai" || endpointClass === "google-vertex";\n}`
  let patched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    if (source.includes(marker)) {
      patched = true
      continue
    }
    if (!sourcePattern.test(source)) continue
    fs.writeFileSync(filePath, source.replace(sourcePattern, replacement))
    patched = true
  }
  if (!patched) throw new Error('[openclaw-vendor] Could not install Automnia Relay thought-signature compatibility patch')
}

function ensureAutomniaRelayRetrySafetySupport() {
  // Modern OpenClaw keeps the OpenAI-compatible transport in @openclaw/ai;
  // its SDK retry guard and stable Relay idempotency key are patched there.
  if (readJson(packageJsonPath).dependencies?.['@openclaw/ai']) return
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for Automnia Relay retry-safety patch')

  const sdkOptionsPattern = /function buildOpenAISdkClientOptions\(model\) \{\n\tconst timeout = resolveOpenAISdkTimeoutMs\(model\);\n\treturn timeout === void 0 \? \{\} : \{ timeout \};\n\}/
  const sdkOptionsReplacement = `function buildOpenAISdkClientOptions(model) {
\tconst timeout = resolveOpenAISdkTimeoutMs(model);
\t// Automnia Relay is a metered billing boundary. The relay owns its
\t// bounded upstream retry policy; repeating the same OpenAI-compatible
\t// request here can charge the upstream model more than once.
\treturn {
\t\t...timeout !== void 0 ? { timeout } : {},
\t\t...(model.provider === "automnia-cloud" ? { maxRetries: 0 } : {})
\t};
}`
  const headerImportPattern = /import \{ randomUUID \} from "node:crypto";/
  const headerImportReplacement = `import { createHash, randomUUID } from "node:crypto";`
  const headerFunctionPattern = /function buildOpenAIClientHeaders\(model, context, optionHeaders, turnHeaders, sessionId\) \{([\s\S]*?)\n\treturn resolvedHeaders;\n\}/
  const headerFunctionReplacement = `function buildOpenAIClientHeaders(model, context, optionHeaders, turnHeaders, sessionId) {$1
\tif (model.provider === "automnia-cloud" && !Object.keys(resolvedHeaders).some((key) => ["idempotency-key", "x-request-id"].includes(normalizeLowercaseStringOrEmpty(key)))) {
\t\tconst requestSeed = JSON.stringify({
\t\t\tsessionId: sessionId ?? "",
\t\t\tmodel: model.id,
\t\t\tsystemPrompt: context.systemPrompt ?? "",
\t\t\tmessages: context.messages ?? []
\t\t});
\t\tresolvedHeaders["Idempotency-Key"] = \`automnia-\${createHash("sha256").update(requestSeed).digest("hex")}\`;
\t}
\treturn resolvedHeaders;
}`
  const completionsClientPattern = /function createOpenAICompletionsClient\(model, context, apiKey, optionHeaders\) \{\n\tconst clientConfig = buildOpenAICompletionsClientConfig\(model, context, optionHeaders\);/
  const completionsClientReplacement = `function createOpenAICompletionsClient(model, context, apiKey, optionHeaders, sessionId) {
\tconst clientConfig = buildOpenAICompletionsClientConfig(model, context, optionHeaders, sessionId);`
  const completionsConfigPattern = /function buildOpenAICompletionsClientConfig\(model, context, optionHeaders\) \{\n\tconst headers = buildOpenAIClientHeaders\(model, context, optionHeaders\);/
  const completionsConfigReplacement = `function buildOpenAICompletionsClientConfig(model, context, optionHeaders, sessionId) {
\tconst headers = buildOpenAIClientHeaders(model, context, optionHeaders, void 0, sessionId);`
  const completionsCallPattern = /createOpenAICompletionsClient\(model, context, options\?\.apiKey \|\| getEnvApiKey\(model\.provider\) \|\| "", options\?\.headers\)/
  const completionsCallReplacement = `createOpenAICompletionsClient(model, context, options?.apiKey || getEnvApiKey(model.provider) || "", options?.headers, options?.sessionId)`

  let sdkPatched = false
  let headersPatched = false
  let completionsPatched = false
  let agentRunnerPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    let source = fs.readFileSync(filePath, 'utf8')
    let next = source

    if (sdkOptionsPattern.test(next)) {
      next = next.replace(sdkOptionsPattern, sdkOptionsReplacement)
      sdkPatched = true
    } else if (next.includes('...(model.provider === "automnia-cloud" ? { maxRetries: 0 } : {})')) {
      sdkPatched = true
    }

    if (name.startsWith('openai-transport-stream-')) {
      if (headerImportPattern.test(next)) {
        next = next.replace(headerImportPattern, headerImportReplacement)
        headersPatched = true
      } else if (next.includes('createHash, randomUUID')) {
        headersPatched = true
      }
      if (headerFunctionPattern.test(next)) {
        next = next.replace(headerFunctionPattern, headerFunctionReplacement)
        headersPatched = true
      } else if (next.includes('resolvedHeaders["Idempotency-Key"] = `automnia-${createHash')) {
        headersPatched = true
      }
      if (completionsClientPattern.test(next)) {
        next = next.replace(completionsClientPattern, completionsClientReplacement)
        completionsPatched = true
      } else if (next.includes('function createOpenAICompletionsClient(model, context, apiKey, optionHeaders, sessionId)')) {
        completionsPatched = true
      }
      if (completionsConfigPattern.test(next)) {
        next = next.replace(completionsConfigPattern, completionsConfigReplacement)
        completionsPatched = true
      } else if (next.includes('function buildOpenAICompletionsClientConfig(model, context, optionHeaders, sessionId)')) {
        completionsPatched = true
      }
      if (completionsCallPattern.test(next)) {
        next = next.replace(completionsCallPattern, completionsCallReplacement)
        completionsPatched = true
      } else if (next.includes('options?.headers, options?.sessionId')) {
        completionsPatched = true
      }
    }

    if (name.startsWith('agent-runner.runtime-')) {
      const transientMarker = 'const isAutomniaHostedRelay = attemptedRuntimeProvider === "automnia-cloud";'
      if (next.includes('const isTransientHttp = isTransientHttpError(message);') && !next.includes(transientMarker)) {
        next = next.replace(
          'const isTransientHttp = isTransientHttpError(message);',
          `const isTransientHttp = isTransientHttpError(message);
\t\tconst isAutomniaHostedRelay = attemptedRuntimeProvider === "automnia-cloud";`,
        )
        next = next.replace(
          'if (isTransientHttp && consumeTransientHttpRetry()) {',
          'if (!isAutomniaHostedRelay && isTransientHttp && consumeTransientHttpRetry()) {',
        )
        agentRunnerPatched = true
      } else if (next.includes('if (!isAutomniaHostedRelay && isTransientHttp && consumeTransientHttpRetry()) {')) {
        agentRunnerPatched = true
      }
    }

    if (next !== source) fs.writeFileSync(filePath, next)
  }

  if (!sdkPatched) throw new Error('[openclaw-vendor] Could not install Automnia Relay SDK retry guard')
  if (!headersPatched || !completionsPatched) throw new Error('[openclaw-vendor] Could not install Automnia Relay idempotency-key patch')
  if (!agentRunnerPatched) throw new Error('[openclaw-vendor] Could not install Automnia Relay embedded retry guard')
}

function ensureAutomniaRelayCompactContextSupport() {
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for token-efficient context patch')

  // This is intentionally provider/model agnostic. The same OpenClaw prompt
  // surface and short rolling history should protect Luna, hosted Gemini,
  // Anthropic, OpenRouter, and every other configured model from replaying a
  // six-figure transcript on every turn.
  const promptMarker = 'const isTokenEfficientPromptMode = true;'
  const promptPattern = /const effectivePromptMode = params\.toolsAllow\?\.length \? "minimal" : promptMode;\n\t\tconst effectiveSkillsPrompt = params\.toolsAllow\?\.length \? void 0 : skillsPrompt;/
  const currentPromptPattern = /const effectivePromptMode = toolPolicyRestricted \? "minimal" : promptMode;\n\tconst effectiveSkillsPrompt = toolPolicyRestricted \? void 0 : params\.skillsPrompt;/
  const currentRuntimePromptPattern = /const _ = !isHostSystemTurn\(n\) && toolPolicyRestrictsTools\(\{ allow: n\.toolsAllow \}\) \? "minimal" : h;/
  const promptReplacement = `${promptMarker}\n\t\tconst effectivePromptMode = isTokenEfficientPromptMode || params.toolsAllow?.length ? "minimal" : promptMode;\n\t\tconst effectiveSkillsPrompt = isTokenEfficientPromptMode || params.toolsAllow?.length ? void 0 : skillsPrompt;`
  const legacyPromptPattern = /const isAutomniaCompactPromptProvider = params\.provider === "automnia-cloud";\n\t\tconst effectivePromptMode = isAutomniaCompactPromptProvider \|\| params\.toolsAllow\?\.length \? "minimal" : promptMode;\n\t\tconst effectiveSkillsPrompt = isAutomniaCompactPromptProvider \|\| params\.toolsAllow\?\.length \? void 0 : skillsPrompt;/
  const historyMarker = 'const historyLimit = Math.min(4, Math.max(1, getHistoryLimitFromSessionKey(params.sessionKey, params.config)));'
  const legacyHistoryMarker = 'const historyLimit = params.provider === "automnia-cloud" ? 1 : getHistoryLimitFromSessionKey(params.sessionKey, params.config);'
  const selectionHistoryPattern = /const truncated = limitHistoryTurns\(filterHeartbeatTranscriptArtifacts\(validated, heartbeatSummary\?\.ackMaxChars, heartbeatSummary\?\.prompt\), getHistoryLimitFromSessionKey\(params\.sessionKey, params\.config\)\);/
  const selectionHistoryReplacement = `${historyMarker}\n\t\t\t\t\tconst truncated = limitHistoryTurns(filterHeartbeatTranscriptArtifacts(validated, heartbeatSummary?.ackMaxChars, heartbeatSummary?.prompt), historyLimit);`
  const compactHistoryPattern = /const truncated = limitHistoryTurns\(session\.messages, getHistoryLimitFromSessionKey\(params\.sessionKey, params\.config\)\);/
  const compactHistoryReplacement = `${historyMarker}\n\t\t\tconst truncated = limitHistoryTurns(session.messages, historyLimit);`
  const currentCompactHistoryPattern = /limitHistoryTurns\(session\.messages, (getHistoryLimitFromSessionKey\(params\.sessionKey, params\.config, \{[\s\S]*?\}\))\)/

  let promptPatched = false
  let selectionHistoryPatched = false
  let compactHistoryPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    let next = source

    if (legacyPromptPattern.test(next)) {
      next = next.replace(legacyPromptPattern, promptReplacement)
      promptPatched = true
    } else if (promptPattern.test(next)) {
      next = next.replace(promptPattern, promptReplacement)
      promptPatched = true
    } else if (currentPromptPattern.test(next)) {
      next = next.replace(currentPromptPattern, `const isTokenEfficientPromptMode = true;\n\tconst effectivePromptMode = isTokenEfficientPromptMode || toolPolicyRestricted ? "minimal" : promptMode;\n\tconst effectiveSkillsPrompt = isTokenEfficientPromptMode || toolPolicyRestricted ? void 0 : params.skillsPrompt;`)
      promptPatched = true
    } else if (currentRuntimePromptPattern.test(next)) {
      next = next.replace(currentRuntimePromptPattern, `const isTokenEfficientPromptMode = true;\n\t\tconst _ = isHostSystemTurn(n) || h === "none" ? h : isTokenEfficientPromptMode ? "minimal" : h;`)
      promptPatched = true
    } else if (next.includes(promptMarker)) {
      promptPatched = true
    }

    if (next.includes(legacyHistoryMarker)) {
      next = next.replaceAll(legacyHistoryMarker, historyMarker)
      if (name.startsWith('selection-')) selectionHistoryPatched = true
      if (name.startsWith('compact-')) compactHistoryPatched = true
    }

    if (selectionHistoryPattern.test(next)) {
      next = next.replace(selectionHistoryPattern, selectionHistoryReplacement)
      selectionHistoryPatched = true
    } else if (name.startsWith('selection-') && next.includes(historyMarker)) {
      selectionHistoryPatched = true
    }

    if (compactHistoryPattern.test(next)) {
      next = next.replace(compactHistoryPattern, compactHistoryReplacement)
      compactHistoryPatched = true
    } else if (currentCompactHistoryPattern.test(next)) {
      next = next.replace(currentCompactHistoryPattern, (_match, historyCall) =>
        `limitHistoryTurns(session.messages, Math.min(4, Math.max(1, Number(${historyCall} ?? 4))))`)
      compactHistoryPatched = true
    } else if (name.startsWith('compact-') && next.includes(historyMarker)) {
      compactHistoryPatched = true
    }

    if (next !== source) fs.writeFileSync(filePath, next)
  }

  // OpenClaw 2026.9 moved history selection into the compaction module and
  // no longer ships the old selection-* bundles. The native compaction replay
  // window remains an equivalent bounded history path, so accept that layout
  // instead of failing startup while looking for retired source patterns.
  if (!selectionHistoryPatched) {
    const hasLegacySelectionPattern = fs.readdirSync(distRoot)
      .filter((name) => name.startsWith('selection-') && isJavaScriptBundle(name))
      .some((name) => selectionHistoryPattern.test(fs.readFileSync(path.join(distRoot, name), 'utf8')))
    if (!hasLegacySelectionPattern) selectionHistoryPatched = true
  }
  if (!compactHistoryPatched) {
    compactHistoryPatched = fs.readdirSync(distRoot)
      .filter((name) => name.startsWith('compact-') && isJavaScriptBundle(name))
      .some((name) => {
        const source = fs.readFileSync(path.join(distRoot, name), 'utf8')
        return source.includes('preserveCompactionReplayWindow') || /limitHistoryTurns\(session\.messages, Math\.min\(4, Math\.max\(1, Number\(/.test(source)
      })
  }

  if (!promptPatched) throw new Error('[openclaw-vendor] Could not force token-efficient minimal system prompt mode')
  if (!selectionHistoryPatched) throw new Error('[openclaw-vendor] Could not cap token-efficient session history')
  if (!compactHistoryPatched) throw new Error('[openclaw-vendor] Could not cap token-efficient compaction history')
}

function ensureAutomniaRelayToolResultBudgetSupport() {
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for bounded prompt tool-result patch')

  // A 1M-token model must not replay half a million tokens of old tool output
  // alongside the conversation. Keep this projection budget near 5% of the
  // context window; the full tool results remain persisted in the transcript.
  const aggregateMarker = /function resolveLiveToolResultAggregateMaxChars\([A-Za-z_$][\w$]*\) \{/u
  const legacyBudgetPattern = /const PROMPT_TOOL_RESULT_AGGREGATE_CAP_MULTIPLIER = 4;\r?\nconst AGGREGATE_TOOL_RESULT_CONTEXT_SHARE = \.5;/
  const boundedBudgetPattern = /const PROMPT_TOOL_RESULT_AGGREGATE_CAP_MULTIPLIER = 2;\r?\nconst AGGREGATE_TOOL_RESULT_CONTEXT_SHARE = \.05;/
  let patched = false

  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    if (!aggregateMarker.test(source)) continue

    let next = source
    if (legacyBudgetPattern.test(next)) {
      next = next.replace(legacyBudgetPattern, 'const PROMPT_TOOL_RESULT_AGGREGATE_CAP_MULTIPLIER = 2;\nconst AGGREGATE_TOOL_RESULT_CONTEXT_SHARE = .05;')
    }
    if (boundedBudgetPattern.test(next)) {
      patched = true
      if (next !== source) fs.writeFileSync(filePath, next)
      break
    }
  }

  if (!patched) throw new Error('[openclaw-vendor] Could not install bounded prompt tool-result budget')
}

function ensureAutomniaRelayPayloadCompactionSupport() {
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for token-efficient provider payload patch')

  // The hosted relay performs a second safety compaction, but shrinking
  // descriptive schema metadata before the request leaves less JSON to parse,
  // transmit, and count on every provider call. Tool names and required fields
  // remain intact; only descriptions, enum hints, and optional properties are
  // bounded. This patch is source-driven so a vendor refresh cannot silently
  // remove the optimization.
  const payloadMarker = 'function compactAutomniaRelayToolSchemas(tools) {'
  const payloadHelper = String.raw`function compactAutomniaRelaySchema(value, depth = 0) {
	if (!value || typeof value !== "object" || Array.isArray(value) || depth > 8) return value;
	const schema = {};
	for (const key of ["type", "nullable", "additionalProperties"]) if (value[key] !== void 0) schema[key] = value[key];
	if (Array.isArray(value.enum)) schema.enum = value.enum.slice(0, 12);
	if (typeof value.description === "string" && value.description.trim()) schema.description = value.description.trim().slice(0, 64);
	if (value.items && typeof value.items === "object") schema.items = compactAutomniaRelaySchema(value.items, depth + 1);
	for (const branch of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(value[branch])) schema[branch] = value[branch].slice(0, 8).map((entry) => compactAutomniaRelaySchema(entry, depth + 1));
	if (value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)) {
		const names = Object.keys(value.properties);
		const required = Array.isArray(value.required) ? value.required.filter((name) => typeof name === "string" && names.includes(name)) : [];
		const ordered = [...required, ...names.filter((name) => !required.includes(name)).slice(0, Math.max(0, 16 - required.length))];
		schema.properties = {};
		for (const name of ordered) schema.properties[name] = compactAutomniaRelaySchema(value.properties[name], depth + 1);
		if (required.length > 0) schema.required = required;
	}
	return schema;
}
function compactAutomniaRelayToolSchemas(tools) {
	if (!Array.isArray(tools)) return tools;
	return tools.map((tool) => {
		if (!tool || typeof tool !== "object" || !tool.function || typeof tool.function !== "object") return tool;
		const fn = { ...tool.function };
		if (typeof fn.description === "string") fn.description = fn.description.trim().slice(0, 96);
		if (fn.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)) fn.parameters = compactAutomniaRelaySchema(fn.parameters);
		return { ...tool, function: fn };
	});
}`
  const convertToolsPattern = /function convertTools\(tools, compat, model\) \{\n\tconst projection = projectOpenAITools\(tools\);/
  const convertToolsReplacement = `${payloadHelper}\nfunction convertTools(tools, compat, model) {\n\tconst sourceTools = model.provider === "automnia-cloud" ? compactAutomniaRelayToolSchemas(tools) : tools;\n\tconst projection = projectOpenAITools(sourceTools);`

  let patched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    let next = source
    if (convertToolsPattern.test(next)) {
      next = next.replace(convertToolsPattern, convertToolsReplacement)
      patched = true
    } else if (next.includes(payloadMarker)) {
      patched = true
    }
    if (next !== source) fs.writeFileSync(filePath, next)
  }

  // Newer OpenClaw bundles own provider schema projection in provider-tools.
  // There is no convertTools hook to patch in that layout; accept the native
  // projection so vendor preparation remains compatible with the bundled
  // runtime while the request-level recovery budget still applies.
  if (!patched) {
    const hasNativeProviderProjection = fs.readdirSync(distRoot)
      .some((name) => name.startsWith('provider-tools-') && isJavaScriptBundle(name))
    if (hasNativeProviderProjection) patched = true
  }
  if (!patched) throw new Error('[openclaw-vendor] Could not install Automnia Relay provider payload compaction patch')
}

function ensureAutomniaSettledTurnFinalizationSupport() {
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for settled-turn finalization patch')

  // A tool turn can finish with a valid result while the provider emits one
  // more tool-shaped response during the isolated, tool-disabled recovery
  // pass. OpenClaw records those rejected calls as capability activity and
  // currently discards the recovery answer as a result. Keep the strict
  // guard for real side effects, but allow rejected calls that are explicitly
  // marked as errors and have no replay/delivery evidence.
  const capabilityCondition = 'result.toolMetas.length > 0 || result.itemLifecycle.startedCount > 0 || result.itemLifecycle.completedCount > 0 || result.itemLifecycle.activeCount > 0 || result.replayMetadata.hadPotentialSideEffects || !result.replayMetadata.replaySafe || result.currentAttemptReplayMetadata?.hadPotentialSideEffects || result.currentAttemptReplayMetadata && !result.currentAttemptReplayMetadata.replaySafe || (result.clientToolCalls?.length ?? 0) > 0 || (result.acceptedSessionSpawns?.length ?? 0) > 0 || result.didSendViaMessagingTool || result.didDeliverSourceReplyViaMessageTool || result.didSendDeterministicApprovalPrompt || result.messagingToolSentTexts.length > 0 || result.messagingToolSentMediaUrls.length > 0 || result.messagingToolSentTargets.length > 0 || (result.messagingToolSourceReplyPayloads?.length ?? 0) > 0 || result.heartbeatToolResponse || (result.toolMediaUrls?.length ?? 0) > 0 || (result.hostOwnedToolMediaUrls?.length ?? 0) > 0 || result.toolAudioAsVoice || result.toolTrustedLocalMedia || result.hasToolMediaBlockReply || result.lastToolError || (result.successfulCronAdds ?? 0) > 0 || result.yieldDetected'
  const strictGuard = `if (${capabilityCondition}) throw new Error("Settled-turn finalization attempt reported capability activity");`
  const safeRecoveryHelper = String.raw`function isSafeRejectedToolOnlyFinalization(result) {
	const toolMetas = Array.isArray(result.toolMetas) ? result.toolMetas : [];
	if (toolMetas.length === 0 || toolMetas.some((meta) => meta?.isError !== true || meta?.replaySafe === false || meta?.asyncStarted === true)) return false;
	if (result.itemLifecycle?.activeCount > 0 || result.replayMetadata?.hadPotentialSideEffects || result.replayMetadata?.replaySafe === false || result.currentAttemptReplayMetadata?.hadPotentialSideEffects || result.currentAttemptReplayMetadata?.replaySafe === false) return false;
	if ((result.clientToolCalls?.length ?? 0) > 0 || (result.acceptedSessionSpawns?.length ?? 0) > 0 || result.didSendViaMessagingTool || result.didDeliverSourceReplyViaMessageTool || result.didSendDeterministicApprovalPrompt || (result.messagingToolSentTexts?.length ?? 0) > 0 || (result.messagingToolSentMediaUrls?.length ?? 0) > 0 || (result.messagingToolSentTargets?.length ?? 0) > 0 || (result.messagingToolSourceReplyPayloads?.length ?? 0) > 0 || result.heartbeatToolResponse || (result.toolMediaUrls?.length ?? 0) > 0 || (result.hostOwnedToolMediaUrls?.length ?? 0) > 0 || result.toolAudioAsVoice || result.toolTrustedLocalMedia || result.hasToolMediaBlockReply || (result.successfulCronAdds ?? 0) > 0 || result.yieldDetected) return false;
	return true;
}`
  const guardedReplacement = `${safeRecoveryHelper}
	if ((${capabilityCondition}) && !isSafeRejectedToolOnlyFinalization(result)) throw new Error("Settled-turn finalization attempt reported capability activity");`

  let resultPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!/^settled-turn-finalization-result-.*\.(?:m?js)$/.test(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    let next = source
    if (next.includes('function isSafeRejectedToolOnlyFinalization(result)')) {
      const legacyGuardedReplacement = `if (${capabilityCondition} && !isSafeRejectedToolOnlyFinalization(result)) throw new Error("Settled-turn finalization attempt reported capability activity");`
      if (next.includes(legacyGuardedReplacement)) next = next.replace(legacyGuardedReplacement, `if ((${capabilityCondition}) && !isSafeRejectedToolOnlyFinalization(result)) throw new Error("Settled-turn finalization attempt reported capability activity");`)
      resultPatched = true
    } else if (next.includes(strictGuard)) {
      next = next.replace(strictGuard, guardedReplacement)
      resultPatched = true
    } else {
      const signature = /function projectSettledTurnFinalizationAttemptResult\(([A-Za-z_$][\w$]*)\) \{/u.exec(next)
      if (!signature) throw new Error(`[openclaw-vendor] Settled-turn finalization guard changed; cannot patch ${name}`)
      const param = signature[1]
      const functionStart = signature.index
      const bodyStart = functionStart + signature[0].length
      const bodyEnd = next.indexOf('\n}', bodyStart)
      if (bodyEnd < 0) throw new Error(`[openclaw-vendor] Settled-turn finalization body changed; cannot patch ${name}`)
      const body = next.slice(bodyStart, bodyEnd)
      const activityGuard = /if \([^;\n]*\) throw new Error\("Settled-turn finalization attempt reported capability activity"\);/u
      if (!activityGuard.test(body)) throw new Error(`[openclaw-vendor] Settled-turn finalization capability guard changed; cannot patch ${name}`)
      const conditionForParam = capabilityCondition.replaceAll('result.', `${param}.`)
      const replacement = `\n\tif ((${conditionForParam}) && !isSafeRejectedToolOnlyFinalization(${param})) throw new Error("Settled-turn finalization attempt reported capability activity");`
      const patchedBody = body.replace(activityGuard, replacement)
      next = `${next.slice(0, functionStart)}${safeRecoveryHelper}\n${next.slice(functionStart, bodyStart)}${patchedBody}${next.slice(bodyEnd)}`
      resultPatched = true
    }
    if (next !== source) fs.writeFileSync(filePath, next)
  }
  if (!resultPatched) throw new Error('[openclaw-vendor] Missing OpenClaw settled-turn finalization result bundle')

  const continuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "The previous assistant turn completed its tool calls but did not produce a user-visible answer. Continue from the current transcript and produce the final user-visible answer now. Do not repeat completed tool calls or restart from scratch.";'
  const currentContinuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "The previous assistant turn completed its tool calls but did not produce a user-visible answer. Continue from the current transcript and produce the final user-visible answer now. Do not repeat completed tool calls or restart from scratch. Tools are unavailable in this step: it is a text-only pass, so reply with plain text and do not attempt any tool call.";'
  const latestContinuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "Your turn ended without a final reply. If the user still needs a reply, write it now. If your completed actions already answered the request, answer exactly NO_REPLY. Continue from the current transcript. Do not repeat completed tool calls or restart from scratch. Do not call tools in this step. Summarize the recorded results in plain text.";'
  const patchedContinuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "Your turn ended without a final reply. If the user still needs a reply, write it now. If your completed actions already answered the request, answer exactly NO_REPLY. Continue from the current transcript. Do not repeat completed tool calls or restart from scratch. This is a tool-disabled recovery pass: return plain user-visible text only; never emit tool calls, exec, tool_call, or any new action. Use only evidence already present in the transcript.";'
  let continuationPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    let next = source
    if (next.includes(patchedContinuationInstruction)) {
      continuationPatched = true
    } else if (next.includes(continuationInstruction)) {
      next = next.replace(continuationInstruction, patchedContinuationInstruction)
      continuationPatched = true
    } else if (next.includes(currentContinuationInstruction)) {
      next = next.replace(currentContinuationInstruction, patchedContinuationInstruction)
      continuationPatched = true
    } else if (next.includes(latestContinuationInstruction)) {
      next = next.replace(latestContinuationInstruction, patchedContinuationInstruction)
      continuationPatched = true
    } else {
      continue
    }
    if (next !== source) fs.writeFileSync(filePath, next)
  }
  if (!continuationPatched) throw new Error('[openclaw-vendor] Missing OpenClaw built-in harness bundle for settled-turn continuation patch')
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
      missing.push(`${packageName} (expected ${expected.version}, found ${installed.version})`)
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

function metadataMatches(metadata, packageJson, shrinkwrapSha256, packageArtifacts) {
  return Boolean(
    metadata?.schema === 1 &&
    metadata.openclaw?.version === packageJson.version &&
    metadata.openclaw?.shrinkwrapSha256 === shrinkwrapSha256 &&
    metadata.openclaw?.packageArtifacts?.integrity === packageArtifacts?.integrity &&
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

function findMatchingBracket(source, openIndex, openChar, closeChar) {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === openChar) depth += 1
    else if (char === closeChar && --depth === 0) return index
  }
  return -1
}

function prepareGoogleGemini4AudioCatalogSupport(distRoot) {
  const catalogTypeFiles = fs.readdirSync(distRoot)
    .filter((name) => name.startsWith('model-catalog-types-') && name.endsWith('.mjs'))
  if (catalogTypeFiles.length !== 1) {
    throw new Error(`[openclaw-vendor] Expected one model-catalog-types bundle, found ${catalogTypeFiles.length}`)
  }
  const filePath = path.join(distRoot, catalogTypeFiles[0])
  const source = fs.readFileSync(filePath, 'utf8')
  const marker = 'const MODEL_CATALOG_INPUTS = ['
  const modelInputsStart = source.indexOf(marker)
  if (modelInputsStart < 0) throw new Error('[openclaw-vendor] OpenClaw model catalog input modality list changed')
  const openIndex = source.indexOf('[', modelInputsStart)
  const closeIndex = findMatchingBracket(source, openIndex, '[', ']')
  if (closeIndex < 0) throw new Error('[openclaw-vendor] OpenClaw model catalog input modality list is malformed')
  const inputList = source.slice(openIndex, closeIndex + 1)
  if (/"audio"/.test(inputList)) return { filePath, source }
  const modalityPattern = /(const MODEL_CATALOG_INPUTS = \[\r?\n)([ \t]*)"text",\r?\n\2"image",\r?\n\2"video",/
  if (!modalityPattern.test(source)) {
    throw new Error('[openclaw-vendor] OpenClaw model catalog input list has an unexpected shape; refusing to add audio support')
  }
  const patched = source.replace(modalityPattern, (_match, prefix, indent) =>
    `${prefix}${indent}"text",\n${indent}"image",\n${indent}"audio",\n${indent}"video",`)
  return { filePath, source: patched }
}

function ensureGoogleGeminiHydrogenOnboardingDefault(distRoot) {
  const onboardingFiles = fs.readdirSync(distRoot)
    .filter((name) => name.startsWith('onboard-') && name.endsWith('.mjs'))
    .map((name) => path.join(distRoot, name))
  const matches = onboardingFiles.filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8')
    return source.includes('const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-4-argon";')
      || source.includes('const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-4-hydrogen";')
  })
  if (matches.length !== 1) {
    throw new Error(`[openclaw-vendor] Expected one Google onboarding default bundle, found ${matches.length}`)
  }

  const filePath = matches[0]
  const source = fs.readFileSync(filePath, 'utf8')
  try {
    return { filePath, source: patchGoogleGeminiOnboardingDefault(source) }
  } catch (error) {
    throw new Error(`[openclaw-vendor] ${String(error)}`)
  }
}

function ensureGoogleGemini4Models() {
  const googleDistRoot = path.join(vendorRoot, 'dist', 'extensions', 'google')
  const discoveryPath = path.join(googleDistRoot, 'provider-discovery.js')
  const manifestPath = path.join(googleDistRoot, 'openclaw.plugin.json')
  if (!fs.existsSync(discoveryPath) || !fs.existsSync(manifestPath)) {
    throw new Error('[openclaw-vendor] OpenClaw Google plugin catalog files are missing')
  }

  let discovery = fs.readFileSync(discoveryPath, 'utf8')
  const previousDiscovery = discovery
  discovery = prepareGoogleGeminiDiscoverySource(discovery)
  discovery = prepareGoogleGeminiDirectVideoBuilder(discovery)
  const directEndpointMarker = '"baseUrl": "https://generativelanguage.googleapis.com/v1beta"'
  const vertexEndpointMarker = 'const GOOGLE_VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";'
  if (!discovery.includes(directEndpointMarker) || !discovery.includes(vertexEndpointMarker) || !discovery.includes('api: "google-vertex"')) {
    throw new Error('[openclaw-vendor] Google direct/Vertex provider endpoint contract changed; refusing model-catalog patch')
  }

  let pluginManifest
  try {
    pluginManifest = readJson(manifestPath)
  } catch (error) {
    throw new Error(`[openclaw-vendor] Google plugin manifest is invalid JSON: ${String(error)}`)
  }
  const normalizedManifest = prepareGoogleGeminiManifest(pluginManifest)
  pluginManifest = normalizedManifest.manifest

  const transportFile = fs.readdirSync(path.join(vendorRoot, 'dist'))
    .find((name) => name.startsWith('transport-stream-') && name.endsWith('.mjs'))
  if (!transportFile) throw new Error('[openclaw-vendor] Google provider transport bundle is missing')
  const transportSource = fs.readFileSync(path.join(vendorRoot, 'dist', transportFile), 'utf8')
  if (!transportSource.includes('const GOOGLE_VERTEX_DEFAULT_API_VERSION = "v1";') ||
    !transportSource.includes('${GOOGLE_VERTEX_DEFAULT_API_VERSION}/projects/${e}/locations/${t}/publishers/google/models/${n}:streamGenerateContent?alt=sse') ||
    !transportSource.includes('${normalizeGoogleApiBaseUrl(i.baseUrl)}/${resolveGoogleModelPath(i.id)}:streamGenerateContent?alt=sse')) {
    throw new Error('[openclaw-vendor] Google Generative Language / Vertex v1 request routes changed; refusing model-catalog patch')
  }
  const catalogTypePatch = prepareGoogleGemini4AudioCatalogSupport(path.join(vendorRoot, 'dist'))
  const onboardingDefaultPatch = ensureGoogleGeminiHydrogenOnboardingDefault(path.join(vendorRoot, 'dist'))

  if (discovery !== previousDiscovery) fs.writeFileSync(discoveryPath, discovery)
  if (normalizedManifest.changed) fs.writeFileSync(manifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`)
  if (catalogTypePatch.source !== fs.readFileSync(catalogTypePatch.filePath, 'utf8')) {
    fs.writeFileSync(catalogTypePatch.filePath, catalogTypePatch.source)
  }
  if (onboardingDefaultPatch.source !== fs.readFileSync(onboardingDefaultPatch.filePath, 'utf8')) {
    fs.writeFileSync(onboardingDefaultPatch.filePath, onboardingDefaultPatch.source)
  }
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
  ensureGatewayLifecycleStartupImportIsDeferred()
  ensureGatewayManagedSidecarStartupGrace()
  ensureAutomniaRelayThoughtSignatureSupport()
  ensureAutomniaRelayRetrySafetySupport()
  ensureAutomniaRelayCompactContextSupport()
  ensureAutomniaRelayToolResultBudgetSupport()
  ensureAutomniaRelayPayloadCompactionSupport()
  ensureAutomniaSettledTurnFinalizationSupport()
  ensureRestartRecoveryClaimStartupRepair(vendorRoot)
  ensureMissingSessionStoreRecovery(vendorRoot)
  ensureRestartResumeCustodyRetry(vendorRoot)
  ensureAutomniaAgentDatabaseFastStart(vendorRoot)
  patchAutomniaCloud424FailoverDist(path.join(vendorRoot, 'dist'))
  ensureGoogleGemini4Models()

  if (!refresh && fs.existsSync(nodeModulesRoot)) {
    const missing = validateInstalledPackages(lock)
    const metadata = readMetadata()
    if (missing.length === 0 && metadataMatches(metadata, packageJson, shrinkwrapSha256, packageArtifacts)) {
      if (packageJson.dependencies?.['@openclaw/ai']) ensureRelayAiTransportCompatibility(vendorRoot)
      console.log(`[openclaw-vendor] OpenClaw ${packageJson.version} production dependencies already prepared`)
      return
    }
    if (missing.length === 0) {
      if (packageJson.dependencies?.['@openclaw/ai']) ensureRelayAiTransportCompatibility(vendorRoot)
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
  if (packageJson.dependencies?.['@openclaw/ai']) ensureRelayAiTransportCompatibility(vendorRoot)
  console.log(`[openclaw-vendor] prepared OpenClaw ${packageJson.version} production dependencies`)
}

main().catch((error) => {
  console.error(error.stack || error.message || error)
  process.exit(1)
})
