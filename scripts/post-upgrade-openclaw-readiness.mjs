import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OPENCLAW_VERSION = '2026.11.6'
export const OPENCLAW_INTEGRITY = 'sha512-4MGjAMv8QlVrul3ZbCu8KjM7GhXfLdLzf0IrsO5QZ8LC3oYkduqs2rZiZpPDmTRpT6kXYke/OVaWrB+YmhBHLw=='
export const CODEX_PLUGIN_VERSION = '2026.11.6'
export const CODEX_PLUGIN_INTEGRITY = 'sha512-c9CRbWNN4R6MBvJBlrgiYJsUM7DI5aVxbLyTgf5NRKfwm9pMPd1B49bv8ttXnmgaZd5uaGzjatC2oRUGmqL53g=='
export const CODEX_HARNESS_VERSION = '0.169.0'
const SMOKE_BUDGET_MS = 180_000
const PER_SMOKE_TIMEOUT_MS = 60_000

export const BOUNDED_SMOKES = [
  { label: 'OpenClaw contract', args: ['scripts/smoke-openclaw-contracts.mjs'] },
  { label: 'settled-turn finalization', args: ['scripts/smoke-settled-turn-finalization.mjs'] },
  { label: 'diagnostic redaction', args: ['--import', 'tsx', 'scripts/smoke-diagnostic-redaction.ts'] },
  { label: 'SSE parser', args: ['--import', 'tsx', 'scripts/smoke-sse-parser.ts'] },
  { label: 'agent-turn stream', args: ['--import', 'tsx', 'scripts/smoke-agent-turn-stream.ts'] },
  { label: 'provider-auth service', args: ['--import', 'tsx', 'scripts/smoke-provider-auth-service.ts'] },
  { label: 'Gateway diagnostics', args: ['--import', 'tsx', 'scripts/smoke-gateway-diagnostics-service.ts'] },
  { label: 'Gateway chat', args: ['--import', 'tsx', 'scripts/smoke-gateway-chat-service.ts'] },
]

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function packageJsonAt(root, packageName) {
  const packagePath = path.join(root, 'node_modules', ...packageName.split('/'), 'package.json')
  return { packagePath, packageJson: existsSync(packagePath) ? readJson(packagePath) : null }
}

export function verifyOfficialExtensions(extensionRoot, expectedVersion) {
  let officialExtensions = 0
  for (const entry of readdirSync(extensionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = path.join(extensionRoot, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    const extension = readJson(manifest)
    if (!String(extension.name || '').startsWith('@openclaw/')) continue
    officialExtensions += 1
    assert(extension.version === expectedVersion, `${extension.name} version ${extension.version || 'missing'} does not match the host`)
  }
  assert(officialExtensions > 0, 'bundled official OpenClaw extensions are missing')
  return officialExtensions
}

export function verifyLocalRuntimeBundles(root = ROOT) {
  const checks = []
  const pass = (label, detail) => checks.push({ ok: true, label, detail })
  const fail = (label, detail) => checks.push({ ok: false, label, detail })
  const check = (label, fn) => {
    try {
      pass(label, fn())
    } catch (error) {
      fail(label, error instanceof Error ? error.message : 'validation failed')
    }
  }

  check('OpenClaw vendor', () => {
    const vendorRoot = path.join(root, 'vendor', 'openclaw')
    const packageJson = readJson(path.join(vendorRoot, 'package.json'))
    const shrinkwrapPath = path.join(vendorRoot, 'npm-shrinkwrap.json')
    const shrinkwrap = readJson(shrinkwrapPath)
    const metadataPath = path.join(vendorRoot, 'node_modules', '.automnia-openclaw-vendor-deps.json')
    const metadata = readJson(metadataPath)
    const lockDigest = createHash('sha256').update(readFileSync(shrinkwrapPath)).digest('hex')
    assert(packageJson.version === OPENCLAW_VERSION, `package version ${packageJson.version || 'missing'}; expected ${OPENCLAW_VERSION}`)
    assert(shrinkwrap.version === OPENCLAW_VERSION && shrinkwrap.packages?.['']?.version === OPENCLAW_VERSION, 'shrinkwrap root version does not match target')
    assert(metadata.openclaw?.version === OPENCLAW_VERSION, 'prepared dependency metadata version does not match target')
    assert(metadata.openclaw?.packageArtifacts?.integrity === OPENCLAW_INTEGRITY, `prepared npm tarball integrity does not match the verified OpenClaw ${OPENCLAW_VERSION} tarball`)
    assert(metadata.openclaw?.shrinkwrapSha256 === lockDigest, 'prepared dependency metadata does not match the current shrinkwrap')
    const required = metadata.requiredRuntimePackages
    assert(Array.isArray(required) && required.length > 0, 'required runtime package inventory is missing')
    for (const name of required) {
      const { packageJson: dependency } = packageJsonAt(vendorRoot, name)
      assert(dependency?.name === name, `required dependency ${name} is not installed`)
    }
    const officialExtensions = verifyOfficialExtensions(path.join(vendorRoot, 'dist', 'extensions'), OPENCLAW_VERSION)
    return `${OPENCLAW_VERSION}; npm integrity, lock digest, ${required.length} runtime packages, and ${officialExtensions} official extensions verified`
  })

  check('Codex plugin bundle', () => {
    const codexRoot = path.join(root, '.cache', 'runtime-bundles', 'openclaw-codex', 'codex')
    const packageJson = readJson(path.join(codexRoot, 'package.json'))
    const metadata = readJson(path.join(codexRoot, '.automnia-runtime-bundle.json'))
    const codex = metadata.codex
    assert(packageJson.name === '@openclaw/codex' && packageJson.version === CODEX_PLUGIN_VERSION, 'Codex plugin package name/version mismatch')
    assert(codex?.package === '@openclaw/codex' && codex.version === CODEX_PLUGIN_VERSION, 'runtime metadata Codex plugin version mismatch')
    assert(codex.spec === `@openclaw/codex@${CODEX_PLUGIN_VERSION}`, 'Codex package spec is not exact-pinned to the target')
    assert(codex.integrity === CODEX_PLUGIN_INTEGRITY, 'Codex plugin tarball integrity mismatch')
    assert(packageJson.dependencies?.['@openai/codex'] === CODEX_HARNESS_VERSION, 'Codex package does not declare the expected app-server harness version')
    assert(codex.dependencies?.['@openai/codex']?.version === CODEX_HARNESS_VERSION, 'runtime metadata harness version mismatch')
    const { packageJson: harness } = packageJsonAt(codexRoot, '@openai/codex')
    assert(harness?.version === CODEX_HARNESS_VERSION, 'installed Codex harness package version mismatch')
    const nativeDependencies = Object.entries(codex.dependencies || {}).filter(([name]) => name.startsWith('@openai/codex-'))
    assert(nativeDependencies.length > 0, 'native Codex package is absent from runtime metadata')
    for (const [name, entry] of nativeDependencies) {
      const { packageJson: nativePackage } = packageJsonAt(codexRoot, name)
      assert(nativePackage?.version === entry.version, `native Codex package ${name} does not match its lock metadata`)
    }
    return `${CODEX_PLUGIN_VERSION}; @openai/codex ${CODEX_HARNESS_VERSION}; ${nativeDependencies.length} native package entry verified`
  })

  return checks
}

export function summarizeProviderStatuses(payload) {
  const providers = payload?.data?.providers
  if (!Array.isArray(providers)) throw new Error('provider status response has no providers array')
  return providers.map((entry) => ({
    provider: String(entry?.provider || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'unknown',
    configured: entry?.configured === true,
    mode: ['oauth', 'apiKey'].includes(entry?.mode) ? entry.mode : 'unknown',
    apiKeyConfigured: entry?.apiKey?.configured === true,
    oauthConfigured: entry?.oauth?.configured === true,
    subscriptionConfigured: entry?.subscriptionAuth?.configured === true,
    gcloudConfigured: entry?.gcloud?.configured === true,
  }))
}

function validToken(value) {
  const token = String(value || '').trim()
  return token.length >= 16 && token.length <= 512 && !/[\0\r\n]/.test(token) ? token : ''
}

export function parseTokenFileContents(contents) {
  const raw = String(contents || '').trim()
  if (!raw) return ''
  let candidate = raw
  if (raw.startsWith('{')) {
    try {
      candidate = JSON.parse(raw)?.token
    } catch {
      return ''
    }
  }
  return validToken(candidate)
}

function loadReadinessToken() {
  const fromEnvironment = validToken(process.env.AUTOMNIA_READINESS_TOKEN || process.env.CONTROL_CENTER_TOKEN)
  if (fromEnvironment) return fromEnvironment
  const userDataDir = path.resolve(process.env.AUTOMNIA_USER_DATA_DIR || path.join(os.homedir(), '.automnia-control-center'))
  const tokenFile = path.resolve(process.env.AUTOMNIA_CONTROL_CENTER_TOKEN_FILE || path.join(userDataDir, 'auth', 'control-center-token.json'))
  try {
    return parseTokenFileContents(readFileSync(tokenFile, 'utf8'))
  } catch {
    return ''
  }
}

export function loopbackBaseUrl(raw, label = 'Service') {
  const url = new URL(raw)
  assert(url.protocol === 'http:' || url.protocol === 'https:', `${label} URL must use HTTP or HTTPS`)
  assert(['127.0.0.1', 'localhost', '::1'].includes(url.hostname), `${label} URL must use a loopback host to protect local credentials`)
  assert(!url.username && !url.password && !url.search && !url.hash, `${label} URL must not contain credentials, a query, or a fragment`)
  return url.toString().replace(/\/$/, '')
}

async function getJson(url, options = {}) {
  let response
  try {
    response = await fetch(url, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
      signal: AbortSignal.timeout(options.timeoutMs || 4_000),
    })
  } catch {
    throw new Error(`${options.label || 'request'} did not respond within ${options.timeoutMs || 4_000}ms`)
  }
  if (!response.ok) throw new Error(`${options.label || 'request'} returned HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${options.label || 'request'} returned invalid JSON`)
  }
}

function envelopeData(payload, label) {
  if (payload?.ok !== true || !payload.data || typeof payload.data !== 'object') throw new Error(`${label} returned an unsuccessful API envelope`)
  return payload.data
}

function probeGatewayUrl() {
  if (process.env.AUTOMNIA_READINESS_GATEWAY_URL) return loopbackBaseUrl(process.env.AUTOMNIA_READINESS_GATEWAY_URL, 'Gateway')
  return `http://127.0.0.1:${Number(process.env.OPENCLAW_GATEWAY_PORT || 18789)}`
}

function safeSmokeOutput(output) {
  let safe = String(output || '')
  const envSecrets = Object.entries(process.env)
    .filter(([name, value]) => value && value.length >= 8 && /(KEY|TOKEN|SECRET|PASSWORD)/i.test(name))
    .map(([, value]) => value)
  for (const secret of envSecrets) safe = safe.split(secret).join('[redacted]')
  return safe
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .split(/\r?\n/).slice(-12).join('\n')
}

function report(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function runSmokes() {
  const started = Date.now()
  let failures = 0
  for (const smoke of BOUNDED_SMOKES) {
    const remaining = SMOKE_BUDGET_MS - (Date.now() - started)
    if (remaining <= 0) {
      report(false, smoke.label, 'overall smoke budget exhausted')
      failures += 1
      continue
    }
    const timeout = Math.min(PER_SMOKE_TIMEOUT_MS, remaining)
    const result = spawnSync(process.execPath, smoke.args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    })
    const ok = result.status === 0 && !result.error
    const diagnostic = ok ? `${Date.now() - started}ms elapsed` : [
      result.error?.code === 'ETIMEDOUT' ? `timed out after ${timeout}ms` : '',
      result.status !== null ? `exit ${result.status}` : '',
      safeSmokeOutput(`${result.stdout || ''}\n${result.stderr || ''}`),
    ].filter(Boolean).join('\n')
    report(ok, `smoke: ${smoke.label}`, diagnostic)
    if (!ok) failures += 1
  }
  return failures === 0
}

export async function runReadiness() {
  console.log(`OpenClaw post-upgrade readiness target ${OPENCLAW_VERSION}`)
  let failures = 0
  for (const check of verifyLocalRuntimeBundles()) {
    report(check.ok, check.label, check.detail)
    if (!check.ok) failures += 1
  }

  const apiBase = loopbackBaseUrl(
    process.env.AUTOMNIA_READINESS_API_URL || `http://127.0.0.1:${Number(process.env.CONTROL_CENTER_PORT || 4050)}`,
    'Control Center API',
  )
  const token = loadReadinessToken()
  if (!token) {
    report(false, 'Control Center auth token', 'not found; set AUTOMNIA_READINESS_TOKEN or CONTROL_CENTER_TOKEN, or persist the desktop token file')
    failures += 1
  }

  try {
    const readyPayload = await getJson(`${apiBase}/api/ready`, { label: 'Control Center /api/ready' })
    const ready = envelopeData(readyPayload, 'Control Center /api/ready')
    assert(ready.ready === true, '/api/ready did not report ready=true')
    report(true, 'Control Center API readiness', 'ready=true')
  } catch (error) {
    report(false, 'Control Center API readiness', error instanceof Error ? error.message : 'probe failed')
    failures += 1
  }

  try {
    const healthPayload = await getJson(`${apiBase}/api/health`, { label: 'Control Center /api/health' })
    const health = envelopeData(healthPayload, 'Control Center /api/health')
    assert(health.ok === true, '/api/health did not report ok=true')
    report(true, 'Control Center health', 'API health endpoint responded')
  } catch (error) {
    report(false, 'Control Center health', error instanceof Error ? error.message : 'probe failed')
    failures += 1
  }

  try {
    const gatewayBase = probeGatewayUrl()
    const gatewayPayload = await getJson(`${gatewayBase}/healthz`, { label: 'OpenClaw Gateway /healthz' })
    assert(gatewayPayload?.ok === true || String(gatewayPayload?.status || '').toLowerCase() === 'ok', 'Gateway /healthz did not report healthy')
    report(true, 'OpenClaw Gateway health', '/healthz healthy')
  } catch (error) {
    report(false, 'OpenClaw Gateway health', error instanceof Error ? error.message : 'probe failed')
    failures += 1
  }

  if (token) {
    try {
      const versionPayload = await getJson(`${apiBase}/api/runtime/version-check`, { token, label: 'runtime version check' })
      const version = envelopeData(versionPayload, 'runtime version check')
      assert(version.ok === true && version.current === OPENCLAW_VERSION && version.expected === OPENCLAW_VERSION, `live runtime version mismatch (current ${version.current || 'unknown'}, server target ${version.expected || 'unknown'}, required ${OPENCLAW_VERSION})`)
      report(true, 'Live OpenClaw runtime version', `${OPENCLAW_VERSION}`)
    } catch (error) {
      report(false, 'Live OpenClaw runtime version', error instanceof Error ? error.message : 'version check failed')
      failures += 1
    }

    try {
      const providerPayload = await getJson(`${apiBase}/api/auth/providers`, { token, label: 'provider auth status' })
      const statuses = summarizeProviderStatuses(providerPayload)
      const configuredStatuses = statuses.filter((entry) => entry.configured)
      const configured = configuredStatuses.length
      report(true, 'Provider/auth status', `${configured}/${statuses.length} providers configured; no credential values emitted`)
      for (const entry of configuredStatuses) {
        const modes = [
          entry.apiKeyConfigured && 'API key configured',
          entry.oauthConfigured && 'OAuth configured',
          entry.subscriptionConfigured && 'subscription auth configured',
          entry.gcloudConfigured && 'Google Cloud auth configured',
        ].filter(Boolean)
        console.log(`  ${entry.provider}: configured${modes.length ? ` (${modes.join(', ')})` : ''}`)
      }
      if (statuses.length === 0) console.log('  no provider statuses exposed by the current entitlement')
      else if (configured < statuses.length) console.log(`  ${statuses.length - configured} other providers not configured`)
    } catch (error) {
      report(false, 'Provider/auth status', error instanceof Error ? error.message : 'status query failed')
      failures += 1
    }
  }

  const smokesOk = await runSmokes()
  if (!smokesOk) failures += 1
  report(failures === 0, 'Post-upgrade readiness', failures === 0 ? 'all bundle, live-service, auth-status, and bounded smoke checks passed' : `${failures} readiness group(s) failed`)
  return failures === 0
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  runReadiness().then((ok) => {
    process.exitCode = ok ? 0 : 1
  }).catch((error) => {
    console.error(`FAIL Post-upgrade readiness — ${error instanceof Error ? error.message : 'unexpected failure'}`)
    process.exitCode = 1
  })
}
