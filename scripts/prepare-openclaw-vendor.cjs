const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const { tmpdir } = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const vendorRoot = path.resolve(process.env.AUTOMNIA_OPENCLAW_VENDOR_ROOT || path.join(root, 'vendor', 'openclaw'))
const packageJsonPath = path.join(vendorRoot, 'package.json')
const shrinkwrapPath = path.join(vendorRoot, 'npm-shrinkwrap.json')
const nodeModulesRoot = path.join(vendorRoot, 'node_modules')
const metadataPath = path.join(nodeModulesRoot, '.automnia-openclaw-vendor-deps.json')
const cacheRoot = path.join(root, '.cache', 'openclaw-vendor')
const refresh = /^(1|true|yes)$/i.test(process.env.AUTOMNIA_REFRESH_OPENCLAW_VENDOR_DEPS || '')

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

function ensureAutomniaRelayThoughtSignatureSupport() {
  const distRoot = path.join(vendorRoot, 'dist')
  if (!fs.existsSync(distRoot)) throw new Error('[openclaw-vendor] Missing OpenClaw dist directory for Automnia Relay compatibility patch')
  const marker = 'const isAutomniaGeminiRelay = model.provider === "automnia-cloud"'
  const sourcePattern = /function isGoogleOpenAICompatModel\(model\) \{\n\tconst endpointClass = detectOpenAICompletionsCompat\(model\)\.capabilities\.endpointClass;\n\treturn model\.provider === "google" \|\| endpointClass === "google-generative-ai" \|\| endpointClass === "google-vertex";\n\}/
  const replacement = `function isGoogleOpenAICompatModel(model) {\n\tconst endpointClass = detectOpenAICompletionsCompat(model).capabilities.endpointClass;\n\t// Automnia Relay is an OpenAI-compatible billing boundary backed by\n\t// Gemini 3.x. Keep it on the same thought-signature replay path as Google\n\t// providers so a hosted tool call can continue through the next Gateway\n\t// turn without degrading the function call into transcript text.\n\tconst isAutomniaGeminiRelay = model.provider === "automnia-cloud" && /(?:^|\\/)gemini-3(?:\\.\\d+)?-(?:flash|pro)(?:-|$)/i.test(model.id);\n\treturn model.provider === "google" || isAutomniaGeminiRelay || endpointClass === "google-generative-ai" || endpointClass === "google-vertex";\n}`
  let patched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!name.endsWith('.js')) continue
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
    if (!name.endsWith('.js')) continue
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
  const promptReplacement = `${promptMarker}\n\t\tconst effectivePromptMode = isTokenEfficientPromptMode || params.toolsAllow?.length ? "minimal" : promptMode;\n\t\tconst effectiveSkillsPrompt = isTokenEfficientPromptMode || params.toolsAllow?.length ? void 0 : skillsPrompt;`
  const legacyPromptPattern = /const isAutomniaCompactPromptProvider = params\.provider === "automnia-cloud";\n\t\tconst effectivePromptMode = isAutomniaCompactPromptProvider \|\| params\.toolsAllow\?\.length \? "minimal" : promptMode;\n\t\tconst effectiveSkillsPrompt = isAutomniaCompactPromptProvider \|\| params\.toolsAllow\?\.length \? void 0 : skillsPrompt;/
  const historyMarker = 'const historyLimit = Math.min(4, Math.max(1, getHistoryLimitFromSessionKey(params.sessionKey, params.config)));'
  const legacyHistoryMarker = 'const historyLimit = params.provider === "automnia-cloud" ? 1 : getHistoryLimitFromSessionKey(params.sessionKey, params.config);'
  const selectionHistoryPattern = /const truncated = limitHistoryTurns\(filterHeartbeatTranscriptArtifacts\(validated, heartbeatSummary\?\.ackMaxChars, heartbeatSummary\?\.prompt\), getHistoryLimitFromSessionKey\(params\.sessionKey, params\.config\)\);/
  const selectionHistoryReplacement = `${historyMarker}\n\t\t\t\t\tconst truncated = limitHistoryTurns(filterHeartbeatTranscriptArtifacts(validated, heartbeatSummary?.ackMaxChars, heartbeatSummary?.prompt), historyLimit);`
  const compactHistoryPattern = /const truncated = limitHistoryTurns\(session\.messages, getHistoryLimitFromSessionKey\(params\.sessionKey, params\.config\)\);/
  const compactHistoryReplacement = `${historyMarker}\n\t\t\tconst truncated = limitHistoryTurns(session.messages, historyLimit);`

  let promptPatched = false
  let selectionHistoryPatched = false
  let compactHistoryPatched = false
  for (const name of fs.readdirSync(distRoot)) {
    if (!name.endsWith('.js')) continue
    const filePath = path.join(distRoot, name)
    const source = fs.readFileSync(filePath, 'utf8')
    let next = source

    if (legacyPromptPattern.test(next)) {
      next = next.replace(legacyPromptPattern, promptReplacement)
      promptPatched = true
    } else if (promptPattern.test(next)) {
      next = next.replace(promptPattern, promptReplacement)
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
    } else if (name.startsWith('compact-') && next.includes(historyMarker)) {
      compactHistoryPatched = true
    }

    if (next !== source) fs.writeFileSync(filePath, next)
  }

  if (!promptPatched) throw new Error('[openclaw-vendor] Could not force token-efficient minimal system prompt mode')
  if (!selectionHistoryPatched) throw new Error('[openclaw-vendor] Could not cap token-efficient session history')
  if (!compactHistoryPatched) throw new Error('[openclaw-vendor] Could not cap token-efficient compaction history')
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
  ensureAutomniaRelayThoughtSignatureSupport()
  ensureAutomniaRelayRetrySafetySupport()
  ensureAutomniaRelayCompactContextSupport()

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
