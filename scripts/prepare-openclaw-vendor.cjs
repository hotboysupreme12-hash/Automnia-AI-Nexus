const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { ensureRelayAiTransportCompatibility } = require('./lib/relay-thought-signature-patch.cjs')
const { ensureRestartRecoveryClaimStartupRepair } = require('./lib/restart-recovery-stale-claim-patch.cjs')

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

const DEFAULT_OPENCLAW_PACKAGE_VERSION = '2026.10.6'
const DEFAULT_OPENCLAW_PACKAGE_TARBALL = 'https://registry.npmjs.org/openclaw/-/openclaw-2026.10.6.tgz'
const DEFAULT_OPENCLAW_PACKAGE_INTEGRITY = 'sha512-jSpQPa2Jw5rG0J2GC07j9+qHtVYIuoHjgccU88JeS+p7188sBCnvIJeuaiNPHj1zsWkuHcBv443QiEUh7qrxwA=='

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
    missing.push(path.join('dist', '.automnia-openclaw-package.json'))
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

function ensureGatewayLifecycleStartupImportIsDeferred() {
  const distRoot = path.join(vendorRoot, 'dist')
  const cliRoot = path.join(distRoot, 'cli')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for Gateway lifecycle startup patch')
  if (!fs.existsSync(cliRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist/cli directory for Gateway lifecycle startup patch')

  const runBundleName = fs.readdirSync(distRoot).find((name) => {
    if (!/^run-[^/]+\.mjs$/.test(name)) return false
    const source = fs.readFileSync(path.join(distRoot, name), 'utf8')
    return source.includes('async function prepareGatewayRunLoop(params)') && source.includes('import("./cli/gateway-lifecycle.runtime.js")')
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

    const functionStart = runSource.indexOf('async function prepareGatewayRunLoop(params) {')
    const functionEnd = runSource.indexOf('\nfunction createGatewayRestartRecovery', functionStart)
    if (functionStart < 0 || functionEnd < 0) throw new Error('[openclaw-vendor] Gateway run-loop preparation markers changed')
    const lineEnding = runSource.includes('\r\n') ? '\r\n' : '\n'
    const replacement = [
      'async function prepareGatewayRunLoop(params) {',
      '\tconst lifecycleBootstrapRuntime = await measureGatewayBootstrapStep("cli.bootstrap.lifecycle-runtime", () => lifecycleBootstrapRuntimeLoader.load());',
      '\tconst supervisor = lifecycleBootstrapRuntime.detectGatewayRespawnSupervisorIdentity(process.env, process.platform, { includeLinuxOpenClawGatewayServiceMarker: true });',
      '\tconst supervisorMode = supervisor?.kind ?? null;',
      '\tconst restartDecision = lifecycleBootstrapRuntime.resolveGatewayRestartDecision();',
      '\tconst lock = await measureGatewayBootstrapStep("cli.bootstrap.gateway-lock", () => acquireGatewayLock({',
      '\t\tport: params.lockPort,',
      '\t\tlistenerMode: supervisorMode ? "supervised" : "foreground",',
      '\t\tsupervisor,',
      '\t\t...params.lifecycleLockDeadlineMs !== void 0 ? { lifecycleDeadlineMs: params.lifecycleLockDeadlineMs } : {}',
      '\t}));',
      '\tconst lifecycleRuntime = await measureGatewayBootstrapStep("cli.bootstrap.lifecycle-runtime-post-lock", () => lifecycleRuntimeLoader.load());',
      '\treturn {',
      '\t\tlifecycleRuntime,',
      '\t\tsupervisor,',
      '\t\tsupervisorMode,',
      '\t\trestartDecision,',
      '\t\tlock',
      '\t};',
      '}',
    ].join(lineEnding)
    runSource = `${runSource.slice(0, functionStart)}${replacement}${runSource.slice(functionEnd)}`
  }
  const sidecarStartupMarker = 'const envSidecarStartupMode = isChannelStartupSuppressedByEnvironment() ? "defer" : "start";'
  const managedSidecarStartupMarker = 'const envSidecarStartupMode = isChannelStartupSuppressedByEnvironment() || process.env.AUTOMNIA_MANAGED_GATEWAY_STARTUP === "defer" ? "defer" : "start";'
  if (runSource.includes(sidecarStartupMarker)) {
    runSource = runSource.replace(sidecarStartupMarker, managedSidecarStartupMarker)
  } else if (!runSource.includes(managedSidecarStartupMarker)) {
    throw new Error('[openclaw-vendor] Gateway sidecar startup mode marker changed')
  }
  fs.writeFileSync(runPath, runSource)
}

function ensureGatewayManagedSidecarStartupGrace() {
  const distRoot = path.join(vendorRoot, 'dist')
  const startupBundleName = fs.readdirSync(distRoot).find((name) => {
    if (!/^server-startup-post-attach-[^/]+\.mjs$/.test(name)) return false
    const source = fs.readFileSync(path.join(distRoot, name), 'utf8')
    return source.includes('const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : setImmediate$1().then(async () => {')
  })
  if (!startupBundleName) {
    const alreadyPatched = fs.readdirSync(distRoot).some((name) => {
      if (!/^server-startup-post-attach-[^/]+\.mjs$/.test(name)) return false
      return fs.readFileSync(path.join(distRoot, name), 'utf8').includes('params.sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000))')
    })
    if (alreadyPatched) return
    throw new Error('[openclaw-vendor] Gateway post-attach sidecar startup marker changed')
  }
  const startupPath = path.join(distRoot, startupBundleName)
  const source = fs.readFileSync(startupPath, 'utf8')
  const marker = 'const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : setImmediate$1().then(async () => {'
  const replacement = 'const startSidecars = () => params.minimalTestGateway ? startStartupLog().then(() => pluginRegistry) : (params.sidecarStartup === "defer" ? new Promise((resolve) => globalThis.setTimeout(resolve, 5000)) : Promise.resolve()).then(() => setImmediate$1()).then(async () => {'
  fs.writeFileSync(startupPath, source.replace(marker, replacement))
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
  const aggregateMarker = 'function resolveLiveToolResultAggregateMaxChars(params) {'
  const legacyBudgetPattern = /const PROMPT_TOOL_RESULT_AGGREGATE_CAP_MULTIPLIER = 4;\r?\nconst AGGREGATE_TOOL_RESULT_CONTEXT_SHARE = \.5;/
  const boundedBudgetPattern = /const PROMPT_TOOL_RESULT_AGGREGATE_CAP_MULTIPLIER = 2;\r?\nconst AGGREGATE_TOOL_RESULT_CONTEXT_SHARE = \.05;/
  let patched = false

  for (const name of fs.readdirSync(distRoot)) {
    if (!isJavaScriptBundle(name)) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    if (!source.includes(aggregateMarker)) continue

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
      throw new Error(`[openclaw-vendor] Settled-turn finalization guard changed; cannot patch ${name}`)
    }
    if (next !== source) fs.writeFileSync(filePath, next)
  }
  if (!resultPatched) throw new Error('[openclaw-vendor] Missing OpenClaw settled-turn finalization result bundle')

  const continuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "The previous assistant turn completed its tool calls but did not produce a user-visible answer. Continue from the current transcript and produce the final user-visible answer now. Do not repeat completed tool calls or restart from scratch.";'
  const currentContinuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "The previous assistant turn completed its tool calls but did not produce a user-visible answer. Continue from the current transcript and produce the final user-visible answer now. Do not repeat completed tool calls or restart from scratch. Tools are unavailable in this step: it is a text-only pass, so reply with plain text and do not attempt any tool call.";'
  const patchedContinuationInstruction = 'const SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION = "The previous assistant turn completed its tool calls but did not produce a user-visible answer. Continue from the current transcript and produce the final user-visible answer now. Do not repeat completed tool calls or restart from scratch. This is a tool-disabled recovery pass: return plain user-visible text only; never emit tool calls, exec, tool_call, or any new action. Use only evidence already present in the transcript.";'
  let continuationPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!/^builtin-openclaw-.*\.(?:m?js)$/.test(name)) continue
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
  ensureGatewayLifecycleStartupImportIsDeferred()
  ensureGatewayManagedSidecarStartupGrace()
  ensureAutomniaRelayThoughtSignatureSupport()
  ensureAutomniaRelayRetrySafetySupport()
  ensureAutomniaRelayCompactContextSupport()
  ensureAutomniaRelayToolResultBudgetSupport()
  ensureAutomniaRelayPayloadCompactionSupport()
  ensureAutomniaSettledTurnFinalizationSupport()
  ensureRestartRecoveryClaimStartupRepair(vendorRoot)

  if (!refresh && fs.existsSync(nodeModulesRoot)) {
    const missing = validateInstalledPackages(lock)
    const metadata = readMetadata()
    if (missing.length === 0 && metadataMatches(metadata, packageJson, shrinkwrapSha256)) {
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
