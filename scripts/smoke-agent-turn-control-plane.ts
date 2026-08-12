import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function routeBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `Missing route marker: ${marker}`)
  const nextCandidates = ['\napp.', '\n  app.']
    .map((needle) => source.indexOf(needle, start + marker.length))
    .filter((index) => index >= 0)
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1
  return source.slice(start, next >= 0 ? next : source.length)
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert(start >= 0, `Missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert(end >= 0, `Missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

function assertNoRawJsonResponse(name: string, source: string) {
  assert(!/\breturn\s+res\.json\s*\(/.test(source), `${name} should not return raw res.json payloads`)
  assert(!/\breturn\s+res\.status\s*\([^)]*\)\.json\s*\(/.test(source), `${name} should not return raw status JSON payloads`)
}

function assertCanonicalRoute(name: string, source: string) {
  assert(/apiSuccess\s*\(\s*res/.test(source), `${name} should return canonical success envelopes`)
  assert(/apiFailure\s*\(\s*res/.test(source), `${name} should return canonical error envelopes`)
  assertNoRawJsonResponse(name, source)
}

const server = readWorkspaceFile('server/controlPlane.ts')
const bufferedAgentTurnService = readWorkspaceFile('server/services/agents/agentTurnService.ts')
const gatewayAgentTurnService = readWorkspaceFile('server/services/agents/gatewayAgentTurnService.ts')
const agentRuntimeService = readWorkspaceFile('server/services/agents/agentRuntimeService.ts')
const agentStreamingService = readWorkspaceFile('server/services/agents/agentStreamingService.ts')
const agentTurnRoutes = readWorkspaceFile('server/routes/agentTurnRoutes.ts')
const browserRoutes = readWorkspaceFile('server/routes/browserRoutes.ts')
const clawTalkConsoleRoutes = readWorkspaceFile('server/routes/clawTalkConsoleRoutes.ts')
const controlPlaneHttp = readWorkspaceFile('server/controlPlaneHttp.ts')
const store = readWorkspaceFile('src/store/nexusStore.ts')
const agentTurnsApi = readWorkspaceFile('src/api/agentTurns.ts')
const appShell = readWorkspaceFile('src/App.tsx')
const licenseContext = readWorkspaceFile('src/context/LicenseContext.tsx')
const licenseEntitlement = readWorkspaceFile('src/utils/licenseEntitlement.ts')
const consolePanel = readWorkspaceFile('src/components/monitor/AgentResponseConsole.tsx')
const settingsPanel = readWorkspaceFile('src/components/settings/SettingsPanel.tsx')
const modelSelector = readWorkspaceFile('src/components/party/ModelSelectorModal.tsx')
const agentEditor = readWorkspaceFile('src/components/editor/AgentEditorModal.tsx')
const licenseActivation = readWorkspaceFile('src/components/auth/LicenseActivationModal.tsx')
const phaseKCommandConsoleSmoke = readWorkspaceFile('scripts/smoke-phase-k-command-console.ts')
const phaseKRedactedFailedCommandSmoke = readWorkspaceFile('scripts/smoke-phase-k-redacted-failed-command.ts')
const uiSmoke = readWorkspaceFile('scripts/smoke-ui-render.mjs')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

for (const code of ['agent_turn_failed', 'clawtalk_console_failed', 'party_handoff_failed']) {
  assert(controlPlaneHttp.includes(`| '${code}'`), `ApiErrorCode is missing ${code}`)
}

const clawTalkStreamConsoleBlock = routeBlock(clawTalkConsoleRoutes, "app.get('/api/openclaw/clawtalk-console/stream'")
const clawTalkFinalBlock = routeBlock(clawTalkConsoleRoutes, "app.post('/api/openclaw/clawtalk-console/final'")
const clawTalkRegistrationBlock = sliceBetween(
  server,
  'registerClawTalkConsoleRoutes(app, {',
  'registerBrowserRoutes(app, {',
)
const streamBlock = sliceBetween(
  agentTurnRoutes,
  "app.post('/api/openclaw/agent-turn/stream'",
  "app.post('/api/openclaw/agent-turn'",
)
const agentTurnBlock = routeBlock(agentTurnRoutes, "app.post('/api/openclaw/agent-turn'")
const browserPreflightBlock = routeBlock(browserRoutes, "app.get('/api/browser/preflight'")
const runBufferedBlock = sliceBetween(
  bufferedAgentTurnService,
  'async function runBufferedAgentTurnForStream',
  'return { runBufferedAgentTurnForStream }',
)

assert(server.includes("import { registerAgentTurnRoutes } from './routes/agentTurnRoutes'"), 'server should import agent-turn route module')
assert(server.includes("import { createBufferedAgentTurnService } from './services/agents/agentTurnService'"), 'server should import buffered agent-turn service')
assert(server.includes("import { createGatewayAgentTurnService } from './services/agents/gatewayAgentTurnService'"), 'server should import Gateway agent-turn service')
assert(server.includes("import { createAgentRuntimeService } from './services/agents/agentRuntimeService'"), 'server should import agent runtime service')
assert(server.includes("import { createAgentStreamingService } from './services/agents/agentStreamingService'"), 'server should import agent streaming service')
assert(server.includes('createBufferedAgentTurnService({'), 'server should wire buffered agent-turn service')
assert(server.includes('createGatewayAgentTurnService({'), 'server should wire Gateway agent-turn service')
assert(server.includes('createAgentRuntimeService({'), 'server should wire agent runtime service')
assert(server.includes('createAgentStreamingService({'), 'server should wire agent streaming service')
assert(gatewayAgentTurnService.includes('async function runGatewayAgentTurnForStream'), 'Gateway agent-turn service should own Gateway stream preparation')
assert(gatewayAgentTurnService.includes('runGatewayChatTurn({'), 'Gateway agent-turn service should dispatch through Gateway chat')
assert(agentRuntimeService.includes('async function runControlCenterAgentRuntimeTurn'), 'agent runtime service should own runtime fallback orchestration')
assert(agentRuntimeService.includes("throw Object.assign(new Error('gateway agent run aborted before fallback'), { name: 'AbortError' })"), 'agent runtime service should preserve abort-before-fallback behavior')
assert(agentStreamingService.includes('async function streamProviderAgentTurn'), 'agent streaming service should own direct provider streaming orchestration')
assert(agentStreamingService.includes('streamOpenAiCompatibleCompletion({'), 'agent streaming service should own provider streaming dispatch')
assert(!server.includes('async function runControlCenterAgentRuntimeTurn'), 'server should not own runtime fallback orchestration')
assert(!server.includes('async function streamProviderAgentTurn'), 'server should not own direct provider streaming orchestration')
assert(server.includes('registerAgentTurnRoutes(app, {'), 'server should register agent-turn routes')
assert(!server.includes("app.post('/api/openclaw/agent-turn/stream'"), 'server should not inline the agent-turn stream route')
assert(!server.includes("app.post('/api/openclaw/agent-turn'"), 'server should not inline the buffered agent-turn route')
assert(server.includes("import { registerClawTalkConsoleRoutes } from './routes/clawTalkConsoleRoutes'"), 'server should import the extracted ClawTalk console route module')
assert(server.includes("import { registerBrowserRoutes } from './routes/browserRoutes'"), 'control plane should import the browser route module')
assert(server.includes('registerBrowserRoutes(app, { checkBrowserPreflight })'), 'control plane should register browser preflight routes')
assert(!server.includes("app.get('/api/browser/preflight'"), 'control plane should not inline browser preflight')
assert(clawTalkRegistrationBlock.includes('clawTalkConsoleClients'), 'ClawTalk route registration should preserve live SSE clients')
assert(clawTalkRegistrationBlock.includes('clawTalkConsoleEvents'), 'ClawTalk route registration should preserve replayed SSE events')
assert(clawTalkRegistrationBlock.includes('resolveClawTalkConsoleMirrorContext'), 'ClawTalk route registration should preserve mirror context resolution')
assert(clawTalkRegistrationBlock.includes("emitClawTalkConsoleFrame('final'"), 'ClawTalk route registration should preserve final frame emission')

assert(clawTalkStreamConsoleBlock.includes('options.initializeSseResponse(res)'), 'ClawTalk console stream should remain an SSE endpoint')
assert(clawTalkStreamConsoleBlock.includes('[...options.clawTalkConsoleEvents].reverse()'), 'ClawTalk console stream should replay buffered events')
assert(clawTalkStreamConsoleBlock.includes("options.writeSseEvent(res, 'heartbeat'"), 'ClawTalk console stream should emit heartbeat events')
assert(consolePanel.includes("import { createSseFrameParser } from '../../utils/sseStream'"), 'Command Console should parse authenticated ClawTalk SSE fetches')
assert(consolePanel.includes("fetch(apiUrl('/api/openclaw/clawtalk-console/stream')"), 'Command Console should use fetch for the ClawTalk SSE stream so the auth bridge can attach bearer tokens')
assert(consolePanel.includes("headers: { Accept: 'text/event-stream' }"), 'Command Console should request ClawTalk SSE with an event-stream Accept header')
assert(consolePanel.includes('response.body.getReader()'), 'Command Console should read ClawTalk SSE frames from the fetch response body')
assert(!consolePanel.includes('new EventSource('), 'Command Console should not use EventSource because it cannot send Authorization headers')

assertCanonicalRoute('/api/openclaw/clawtalk-console/final', clawTalkFinalBlock)
assert(clawTalkFinalBlock.includes('isValidAgentId(agentId)'), 'ClawTalk final should validate agent ids')
assert(clawTalkFinalBlock.includes('isRetiredAgentId(agentId)'), 'ClawTalk final should reject retired agents')
assert(clawTalkFinalBlock.includes("'clawtalk_console_failed'"), 'ClawTalk final should use typed infrastructure errors')
assert(clawTalkFinalBlock.includes('deduped: !result.emitted'), 'ClawTalk final should preserve dedupe evidence')

assert(streamBlock.includes('initializeSseResponse(res)'), 'agent-turn stream route should remain an SSE endpoint')
assert(streamBlock.includes("emit('final'"), 'agent-turn stream route should still emit final SSE frames')
assert(!streamBlock.includes('apiSuccess(res, compactHttpJsonPayload'), 'agent-turn stream route should not become a buffered JSON route')

assertCanonicalRoute('/api/openclaw/agent-turn', agentTurnBlock)
assert(agentTurnBlock.includes("'invalid_payload'"), 'agent-turn should type invalid payload failures')
assert(agentTurnBlock.includes("'agent_turn_failed'"), 'agent-turn should type pre-reply infrastructure failures')
assert(agentTurnBlock.includes("'party_handoff_failed'"), 'agent-turn should type delegation policy failures')
assert(agentTurnBlock.includes('return apiSuccess(res, compactHttpJsonPayload({'), 'agent-turn final payload should be canonical data')
assert(agentTurnBlock.includes('return apiSuccess(res, {'), 'agent-turn compatibility branches should return canonical data')
assert(agentTurnBlock.includes('preflight,'), 'agent-turn should preserve browser preflight evidence in data')
assert(agentTurnBlock.includes('handoffOk'), 'agent-turn should preserve handoff outcome evidence')
assert(agentTurnBlock.includes('runtimeContext: agentRuntimeContextPayload(agent, context)'), 'agent-turn should preserve runtime context evidence')
assert(agentTurnBlock.includes('compactHttpJsonPayload({'), 'agent-turn should compact large diagnostics before returning them')
assert(agentTurnBlock.includes('const hostedCreditRoute = Boolean(isHostedCreditsActive?.())'), 'buffered agent turns should detect active hosted-credit licenses for every command')
assert(agentTurnBlock.includes('const hostedPayload = await streamProviderAgentTurn('), 'buffered hosted turns should use the same metered relay as streamed turns')
assert(agentTurnBlock.includes('return apiSuccess(res, compactHttpJsonPayload(hostedPayload))'), 'buffered hosted relay replies should remain canonical API data')
assert(agentTurnRoutes.includes('every message, including /runtime, /work, and /openclaw'), 'hosted billing should cover every explicit runtime command')
assert(agentStreamingService.indexOf('const hostedRelayCredentials = skipHostedRouting ? null : options.getHostedRelayCredentials?.()') < agentStreamingService.indexOf('if (runtimeShortcut) {'), 'hosted billing preference must be selected before runtime shortcut routing')
assert(agentStreamingService.includes("reason: 'automnia-cloud-local-fallback'"), 'hosted failures should use the configured local model fallback')
assert(agentStreamingService.includes("hostedRelayCredentials.usagePriority === 'provider_first'"), 'subscribers should be able to select their connected provider first')
assert(agentStreamingService.includes("reason: 'provider-to-automnia-fallback'"), 'provider-first failures should fall back to Automnia credits')
assert(agentTurnRoutes.includes("label: cloudFirst ? 'Automnia credits first' : providerFirst ? 'My provider first'"), 'stream status should label the saved subscriber priority')
assert(licenseContext.includes("apiRequest<LicenseInfo>('/api/license/usage-priority'"), 'the renderer should persist usage priority through the protected license API')
assert(settingsPanel.includes('<option value="automnia_first">Automnia credits only (no BYOK fallback)</option>'), 'Account settings should expose strict Automnia priority')
assert(settingsPanel.includes('<option value="provider_first">BYOK first + Automnia credits fallback</option>'), 'Account settings should expose provider-first priority')
assert(settingsPanel.includes('<option value="byok_only">BYOK only (bypass subscription credits)</option>'), 'Account settings should expose BYOK-only priority')
assert(modelSelector.includes("providerFirst ? 'My Provider First' : 'Automnia Credits First'"), 'model selection should label the active usage priority')
assert(agentEditor.includes("providerFirst ? 'Primary Provider Model' : 'Provider Fallback Model'"), 'agent model settings should explain primary and fallback roles')

assert(/apiSuccess\s*\(\s*res/.test(browserPreflightBlock), '/api/browser/preflight should return a canonical success envelope')
assertNoRawJsonResponse('/api/browser/preflight', browserPreflightBlock)
assert(browserPreflightBlock.includes('ok: preflight.ok'), '/api/browser/preflight should preserve preflight.ok as data')

assert(runBufferedBlock.includes('unwrapCanonicalApiPayload(JSON.parse(text) as unknown)'), 'stream fallback should unwrap canonical agent-turn data')
assert(runBufferedBlock.includes("typeof parsedPayload === 'object'"), 'stream fallback should guard parsed canonical payload shape')
assert(runBufferedBlock.includes('!Array.isArray(parsedPayload)'), 'stream fallback should reject array payloads as agent-turn data')

assert(
  agentTurnsApi.includes("apiRequest<AgentTurnPayload>('/api/openclaw/agent-turn'"),
  'renderer should call non-SSE agent-turn through the extracted agent-turn API helper',
)
assert(
  agentTurnsApi.includes('return preflightAgentRuntime(agentId)'),
  'agent prewarm should be non-generative so background startup checks never spend hosted credits',
)
assert(
  store.includes('sendBufferedAgentTurn('),
  'nexusStore should delegate non-SSE agent-turn requests to src/api/agentTurns.ts',
)
assert(
  agentTurnsApi.includes("fetch(apiUrl('/api/openclaw/agent-turn/stream')"),
  'renderer should call SSE agent-turn through the extracted agent-turn API helper',
)
assert(
  agentTurnsApi.includes('createSseFrameParser()'),
  'agent-turn API helper should own SSE frame parsing iteration',
)
assert(
  store.includes('sendStreamingAgentTurn('),
  'nexusStore should delegate SSE agent-turn transport to src/api/agentTurns.ts',
)
assert(
  !store.includes("'/api/openclaw/agent-turn/stream'") && !store.includes('"/api/openclaw/agent-turn/stream"'),
  'nexusStore should not own the SSE agent-turn endpoint literal',
)
assert(
  agentTurnsApi.includes('window.setTimeout(() => {')
    && agentTurnsApi.includes('new CustomEvent<HostedCreditBalanceUpdate>(LICENSE_STATUS_UPDATED_EVENT, { detail })'),
  'hosted-credit reconciliation should be deferred until after the final response render batch',
)
assert(
  licenseContext.includes('if (blocking) setChecking(true)')
    && !licenseContext.includes('const onHostedCreditUpdate = () =>'),
  'automatic credit updates must not re-enter the blocking license startup state',
)
assert(
  licenseContext.includes('startTransition(() => {')
    && licenseContext.includes('mergeHostedCreditBalance('),
  'automatic hosted-credit events should reconcile the in-memory balance as a low-priority transition',
)
assert(
  appShell.includes('const StableNexusShell = memo(NexusShell)')
    && appShell.includes('<StableNexusShell />'),
  'license balance changes should not rerender the whole mounted Nexus shell',
)
assert(
  licenseEntitlement.includes("starter: 'Starter Subscription'")
    && licenseEntitlement.includes("pro: 'Pro Subscription'")
    && licenseEntitlement.includes("enterprise: 'Enterprise Subscription'")
    && licenseEntitlement.includes("credit_pack_topup: 'Hosted Credit Refill'")
    && licenseEntitlement.includes("tierLabel: 'BYOK One-Time Access'"),
  'license entitlement presentation should cover every published plan and one-time BYOK access',
)
for (const [name, source] of [
  ['Settings', settingsPanel],
  ['Model selector', modelSelector],
  ['Agent editor', agentEditor],
  ['License activation', licenseActivation],
] as const) {
  assert(source.includes('resolveLicenseEntitlement('), `${name} should use the shared active-tier presentation`)
}

assert(
  packageJson.scripts?.['smoke:agent-turn-control-plane'] === 'tsx scripts/smoke-agent-turn-control-plane.ts',
  'package.json should expose smoke:agent-turn-control-plane',
)
assert(
  packageJson.scripts?.['smoke:phase-k-command-console'] === 'tsx scripts/smoke-phase-k-command-console.ts',
  'package.json should expose smoke:phase-k-command-console',
)
assert(
  packageJson.scripts?.['smoke:phase-k-redacted-failed-command'] === 'tsx scripts/smoke-phase-k-redacted-failed-command.ts',
  'package.json should expose smoke:phase-k-redacted-failed-command',
)
assert(
  packageJson.scripts?.['test:ci']?.includes('npm run smoke:agent-turn-control-plane'),
  'test:ci should run the agent-turn control-plane smoke',
)
assert(
  phaseKCommandConsoleSmoke.includes("'/api/openclaw/agent-turn/stream'"),
  'Phase K command-console smoke should send commands through the stream route',
)
assert(
  phaseKCommandConsoleSmoke.includes("'/api/files/upload'"),
  'Phase K command-console smoke should upload an attachment before the attachment command',
)
assert(
  phaseKCommandConsoleSmoke.includes("'x-control-center-stream-smoke': '1'"),
  'Phase K command-console smoke should use the deterministic stream smoke hook',
)
assert(
  phaseKCommandConsoleSmoke.includes('completedItems: [117, 118]'),
  'Phase K command-console smoke should record items 117 and 118 together',
)
assert(
  phaseKCommandConsoleSmoke.includes('evidenceHasSecretMaterial'),
  'Phase K command-console smoke should guard evidence against credential material',
)
assert(
  agentTurnRoutes.includes("streamSmokeMode === 'failure' || streamSmokeMode === 'fail'"),
  'agent-turn stream route should expose a deterministic redacted failure smoke mode',
)
assert(
  agentTurnRoutes.includes('const hostedCreditRoute = Boolean(isHostedCreditsActive?.())'),
  'agent-turn stream routes should give an active hosted entitlement priority over runtime shortcuts and the legacy forced-runtime flag',
)
assert(
  agentTurnRoutes.includes("? 'automnia-cloud-relay'"),
  'agent-turn stream failures should label Cloud Subscription failures as the Automnia credit route',
)
assert(
  agentTurnRoutes.includes("? 'gateway-chat'"),
  'agent-turn stream failures should preserve the Gateway label for BYOK requests',
)
assert(
  phaseKRedactedFailedCommandSmoke.includes("'x-control-center-stream-smoke': 'failure'"),
  'Phase K redacted failed-command smoke should use the deterministic stream failure hook',
)
assert(
  phaseKRedactedFailedCommandSmoke.includes('completedItems: [128]'),
  'Phase K redacted failed-command smoke should record item 128',
)
assert(
  phaseKRedactedFailedCommandSmoke.includes('assertRedactedCommandFailure'),
  'Phase K redacted failed-command smoke should verify redacted SSE error/final payloads',
)
assert(
  phaseKRedactedFailedCommandSmoke.includes('evidenceHasSecretMaterial'),
  'Phase K redacted failed-command smoke should guard evidence against credential material',
)
assert(
  uiSmoke.includes('seedRedactedFailedCommandConsole'),
  'UI smoke should render a redacted failed Command Console response',
)
assert(
  uiSmoke.includes('redactedFailureRawLeakAbsent') && uiSmoke.includes('redactedFailureMarkersPresent'),
  'UI smoke should assert failed-command redaction markers and raw leak absence',
)

console.log('agent-turn control-plane contract ok')
