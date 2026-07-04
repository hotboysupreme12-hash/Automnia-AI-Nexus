import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf-8')
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`${label} is missing: ${needle}`)
  }
}

function assertNotIncludes(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`${label} must not include: ${needle}`)
  }
}

function assertRegex(text, pattern, label) {
  if (!pattern.test(text)) {
    throw new Error(`${label} did not match ${pattern}`)
  }
}

function sectionBetween(text, startNeedle, endNeedle, label) {
  const start = text.indexOf(startNeedle)
  if (start === -1) throw new Error(`${label} start is missing: ${startNeedle}`)
  const end = text.indexOf(endNeedle, start + startNeedle.length)
  if (end === -1) throw new Error(`${label} end is missing: ${endNeedle}`)
  return text.slice(start, end)
}

function assertOrderedIncludes(text, needles, label) {
  let cursor = -1
  for (const needle of needles) {
    const index = text.indexOf(needle, cursor + 1)
    if (index === -1) {
      throw new Error(`${label} is missing ordered token after ${cursor}: ${needle}`)
    }
    cursor = index
  }
}

const server = read('server/controlPlane.ts')
const runtimeRoutes = read('server/routes/runtimeRoutes.ts')
const routingHelpers = read('server/integrations/agentRoutingHelpers.ts')
const gatewayLifecycleService = read('server/services/gateway/gatewayLifecycleService.ts')
const gatewayLogService = read('server/services/gateway/gatewayLogService.ts')
const gatewayChatService = read('server/services/gateway/gatewayChatService.ts')
const gatewayAgentTurnService = read('server/services/agents/gatewayAgentTurnService.ts')
const runtimeStatusService = read('server/services/runtime/runtimeStatusService.ts')
const runtimeActionService = read('server/services/runtime/runtimeActionService.ts')
const agentTurnRoutes = read('server/routes/agentTurnRoutes.ts')
const agentRuntimeService = read('server/services/agents/agentRuntimeService.ts')
const runtimeLedger = read('server/runtimeLedger.ts')
const runtimeLedgerStore = read('server/state/runtimeLedgerStore.ts')
const runtimeHook = read('src/hooks/useRuntimeStatus.ts')
const nexusStore = read('src/store/nexusStore.ts')
const agentTurnsApi = read('src/api/agentTurns.ts')
const commandConsole = read('src/components/monitor/AgentResponseConsole.tsx')
const liveOperationMonitor = read('src/components/monitor/LiveOperationMonitor.tsx')
const diagnosticRedaction = read('src/utils/diagnosticRedaction.ts')
const finalOverrides = read('src/styles/dystopai-theme/50-final-overrides.css')
const uiSmoke = read('scripts/smoke-ui-render.mjs')
const agentTurnStreamSmoke = read('scripts/smoke-agent-turn-stream.ts')
const sseStream = read('src/utils/sseStream.ts')
const packageJson = read('package.json')
const gatewayProtocolDocs = read('docs/openclaw-latest/pages/gateway/protocol.md')
const commandConsoleGuide = read('docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md')

assertIncludes(runtimeLedger, 'readGatewayEventLedgerTail', 'gateway event ledger reader')
assertIncludes(runtimeLedger, 'readDiagnosticRunLedgerTail', 'diagnostic run ledger reader')
assertIncludes(runtimeLedgerStore, 'export function createRuntimeLedgerStore', 'runtime ledger state store factory')
assertIncludes(runtimeLedgerStore, 'readGatewayEvents', 'runtime ledger store gateway event reader')
assertIncludes(runtimeLedgerStore, 'readDiagnosticRuns', 'runtime ledger store diagnostic run reader')
assertIncludes(runtimeRoutes, "app.get('/api/openclaw/runtime/summary'", 'runtime summary endpoint')
assertIncludes(server, 'registerRuntimeRoutes(app, {', 'runtime routes are extracted from server/index.ts')
assertIncludes(runtimeHook, 'useRuntimeSummaryStatus', 'runtime summary hook')
assertIncludes(server, 'readGatewayLedgerSnapshot', 'ledger-backed gateway log status path')

assertIncludes(gatewayChatService, "clientName: 'gateway-client'", 'Gateway backend client id')
assertIncludes(gatewayChatService, "mode: 'backend'", 'Gateway backend client mode')
assertIncludes(gatewayChatService, "'operator.talk.secrets'", 'Talk secret scope')
assertIncludes(gatewayChatService, 'class LightweightGatewayClient implements GatewayClientLike', 'Command Console uses lightweight Gateway protocol client')
assertIncludes(gatewayChatService, "this.request('connect'", 'Lightweight Gateway client performs documented connect handshake')
assertIncludes(gatewayChatService, "this.sendFrame({ type: 'req', id, method", 'Lightweight Gateway client sends documented request frames')
assertIncludes(gatewayChatService, "if (frame.type === 'event')", 'Lightweight Gateway client forwards documented event frames')
assertNotIncludes(gatewayChatService, 'gateway-runtime.js', 'Command Console hot path avoids heavy Gateway runtime import')
assertIncludes(gatewayChatService, 'waitForGatewayClientConnect(gatewayClientConnectPromise, signal)', 'Gateway chat client request abort isolation')
assertIncludes(gatewayChatService, 'function stopStaleClient', 'Gateway chat client poisoned startup reset')
assertIncludes(gatewayLifecycleService, 'if (await isGatewayHealthy()) {', 'Gateway startup skips repair work when already healthy')
const gatewayClientStartup = sectionBetween(
  gatewayChatService,
  'async function startClient(): Promise<GatewayClientState> {',
  'async function ensureClient(signal?: AbortSignal): Promise<GatewayClientState> {',
  'Gateway chat client startup',
)
assertOrderedIncludes(gatewayClientStartup, [
  'startGatewayHealthMonitor()',
  'if (!(await options.isGatewayHealthy())) {',
  'await options.ensureGatewayRunning()',
  'if (!(await options.isGatewayHealthy())) {',
  'throw new Error(`gateway not healthy on port ${options.gatewayHttpPort}`)',
  'stopStaleClient()',
], 'Gateway chat client only runs startup when health probe fails')
assertIncludes(gatewayAgentTurnService, "gateway agent run aborted before Gateway dispatch", 'Command Console Gateway abort checkpoint')
assertIncludes(server, 'runtimeLedgerStore.appendRuntimeRun(openClawRunLedgerPayload(record), { mirrorJsonl: false })', 'Runtime run hot path writes SQLite-primary state through the store')
assertIncludes(server, 'appendGatewayLogEntry: (entry) => runtimeLedgerStore.appendGatewayEvent(entry, { sqlite: false })', 'Gateway log ledger append remains mirrored through the service store boundary')
assertIncludes(gatewayLogService, 'void Promise.resolve(options.appendGatewayLogEntry({', 'Gateway log hot path starts async ledger mirroring')
assertIncludes(gatewayLogService, '})).catch(() => undefined)', 'Gateway log hot path avoids synchronous SQLite')
assertIncludes(gatewayLogService, 'function isNodeDeprecationWarningLine', 'Gateway monitor filters Node deprecation warning noise')
assertIncludes(gatewayLogService, '\\[DEP\\d+\\]', 'Gateway monitor filters Node DEP warning codes')
assertIncludes(gatewayLogService, '--trace-deprecation', 'Gateway monitor filters Node trace-deprecation helper lines')
assertIncludes(gatewayLogService, 'function isGatewayFailoverDecisionNoise', 'Gateway monitor filters internal failover decision noise')
assertIncludes(gatewayLogService, 'model fallback decision', 'Gateway monitor suppresses model fallback decision chatter')
assertIncludes(gatewayLogService, 'embedded run failover decision', 'Gateway monitor suppresses embedded failover decision chatter')
assertIncludes(gatewayLogService, 'function summarizeGatewayAuthRefreshFailure', 'Gateway monitor summarizes auth refresh timeout failures')
assertIncludes(gatewayLogService, 'Model auth refresh timed out after 10s', 'Gateway monitor shows actionable auth refresh timeout copy')
assertIncludes(runtimeStatusService, 'readRuntimeGatewayLedgerSnapshot(48)', 'Runtime summary avoids synchronous Gateway log SQLite reads')
assertIncludes(runtimeStatusService, 'readDoctorDiagnosticsSummary(false, { sqlite: false })', 'Runtime summary avoids synchronous diagnostic SQLite reads')
assertIncludes(runtimeStatusService, 'runtimeLedgerStatus({ sqlite: false })', 'Runtime health/status avoids synchronous ledger SQLite opens')
assertIncludes(runtimeStatusService, 'listActiveCronJobViews({ sqlite: false })', 'Runtime status summaries avoid synchronous cron SQLite reads')
assertIncludes(runtimeLedger, 'runtimeLedgerStatus(options: LedgerReadOptions = {})', 'Runtime ledger status can skip synchronous SQLite')
assertIncludes(runtimeLedgerStore, 'status: (options?: RuntimeLedgerReadOptions) => runtimeLedgerStatus(options)', 'Runtime ledger store exposes non-blocking status reads')
assertIncludes(gatewayAgentTurnService, 'const gatewayMessage = options.composeAgentDoctrinePrompt(', 'Command Console Gateway chat message composition')
assertIncludes(agentTurnRoutes, "const forcedGatewayConsoleTurn = parsed.data.forceOpenClawRuntime && parsed.data.source !== 'clawtalk'", 'Command Console forced Gateway fast path')
assertIncludes(agentTurnRoutes, "if (!forcedGatewayConsoleTurn)", 'Command Console skips heavy route preflight for forced Gateway turns')
assertIncludes(gatewayAgentTurnService, 'if (isClawTalkRoute)', 'ClawTalk keeps channel-specific runtime preflight')
assertIncludes(gatewayChatService, "request('chat.send'", 'Gateway chat.send call')
assertNotIncludes(gatewayChatService, 'deliver: false', 'Command Console chat.send leaves WebChat delivery semantics to Gateway')
assertNotIncludes(gatewayChatService, 'suppressCommandInterpretation: true', 'Command Console chat.send keeps Gateway command semantics')
assertIncludes(gatewayChatService, "request('chat.history'", 'Gateway chat.history call')
assertIncludes(gatewayChatService, "request('chat.message.get'", 'Gateway chat.message.get call')
assertIncludes(gatewayChatService, "request('chat.abort'", 'Gateway chat.abort call')
assertIncludes(gatewayChatService, 'idempotencyKey', 'Gateway chat idempotency key')
assertIncludes(gatewayChatService, 'isGatewayProtocolStatusText(finalText)', 'Gateway status text is not treated as assistant reply')
assertIncludes(gatewayChatService, 'without a visible assistant transcript', 'Gateway terminal status without assistant text surfaces as error')
assertIncludes(gatewayChatService, 'void finalPromise.catch(() => undefined)', 'Gateway final waiter early rejection guard')
assertIncludes(gatewayChatService, 'toolsEffectiveDiagnostic', 'tools.effective diagnostic gate')
assertIncludes(agentTurnRoutes, 'CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK', 'Command Console stream smoke mock gate')
assertIncludes(agentTurnRoutes, "req.get('x-control-center-stream-smoke')", 'Command Console stream smoke mock header gate')
assertIncludes(agentTurnRoutes, "streamSmokeMode === 'abort'", 'Command Console stream smoke abort mode')
assertIncludes(agentTurnRoutes, 'agent-turn-stream-smoke-abort.json', 'Command Console stream smoke abort marker')
assertIncludes(agentTurnRoutes, "reason: closed ? 'client-close' : 'timeout'", 'Command Console abort marker reason')
assertIncludes(agentTurnRoutes, 'Command accepted; opening the Gateway-backed OpenClaw session.', 'Command Console early Gateway ACK')
assertIncludes(agentTurnRoutes, 'Runtime ready; dispatching through Gateway chat.', 'Command Console runtime ready progress')
assertIncludes(nexusStore, 'commandConsoleSessionKey', 'Command Console stable session key')
assertIncludes(nexusStore, 'forceOpenClawRuntime: true', 'Command Console forced OpenClaw runtime route')
assertIncludes(nexusStore, 'const gatewayChatMessage = options.freshSession', 'Command Console frontend plain Gateway chat message')
assertIncludes(nexusStore, 'const outboundMessage = preferOpenClawRuntime ? gatewayChatMessage : composed', 'Command Console frontend bypasses context wrapper for Gateway chat')
assertIncludes(nexusStore, 'control-center.client.gateway_runtime', 'Command Console client Gateway runtime progress')
assertIncludes(nexusStore, 'activeAgentTurnControllers', 'Command Console active request controller registry')
assertIncludes(nexusStore, 'operatorCancelledAgentTurns', 'Command Console operator cancellation marker')
assertIncludes(diagnosticRedaction, "'sessionKey'", 'Command Console preserves Gateway session key in activity payloads')
assertIncludes(nexusStore, 'if (controller.signal.aborted) throw streamError', 'Command Console stream abort does not retry fallback')
assertIncludes(nexusStore, 'return await sendStreamingAgentTurn', 'Command Console keeps stream controller active until SSE drains')
assertIncludes(agentTurnsApi, "fetch(apiUrl('/api/openclaw/agent-turn/stream')", 'Command Console stream transport lives in renderer API helper')
assertIncludes(nexusStore, 'stopActiveAgentRuns', 'Command Console stop active runs action')
assertIncludes(nexusStore, 'cancelled: cancelledByOperator', 'Command Console returns operator cancellation state')
assertIncludes(nexusStore, 'if (result?.cancelled) break', 'Command Console stops queued sequential lanes after cancel')
assertIncludes(nexusStore, "from '../utils/diagnosticRedaction'", 'Command Console activity uses shared diagnostic redaction utility')
assertIncludes(server, "from '../src/utils/diagnosticRedaction'", 'Gateway runtime monitor uses shared diagnostic redaction utility')
assertIncludes(server, 'applyDiagnosticRedactions(stripAnsi(value || \'\'))', 'Gateway runtime monitor sensitive text redaction uses shared utility')
assertIncludes(gatewayLogService, 'const masked = options.applyDiagnosticRedactions(normalized)', 'Gateway log compactor uses shared diagnostic redaction utility')
assertIncludes(runtimeHook, 'sessionLockCleanup?:', 'Runtime monitor clear hook preserves session lock cleanup summary')
assertIncludes(liveOperationMonitor, 'RuntimeMonitorClearResult', 'Live monitor types Clean Slate clear result')
assertIncludes(liveOperationMonitor, 'setCleanSlateResult(result)', 'Live monitor surfaces Clean Slate success result')
assertIncludes(liveOperationMonitor, 'Clean Slate complete.', 'Live monitor announces Clean Slate completion')
assertIncludes(liveOperationMonitor, 'active Gateway work were preserved', 'Live monitor documents active Gateway work preservation after Clean Slate')
assertIncludes(commandConsole, 'className="dy-command-busy-status', 'Command Console running status wrapper')
assertIncludes(commandConsole, 'role="status"', 'Command Console running status accessibility role')
assertIncludes(commandConsole, 'showInlineThinking', 'Command Console renders live Gateway thinking inline')
assertIncludes(commandConsole, 'data-body-state={bodyState}', 'Command Console marks inline thinking body state')
assertIncludes(commandConsole, 'dy-command-thinking-dots', 'Command Console inline thinking keeps animated dots')
assertNotIncludes(commandConsole, 'latestRunTrace', 'Command Console should not render run/session trace metadata')
assertNotIncludes(commandConsole, 'writeClipboardText', 'Command Console should not expose trace metadata copy')
assertNotIncludes(commandConsole, 'dy-command-evidence-preview', 'Command Console Evidence disclosure is removed')
assertNotIncludes(commandConsole, 'data-evidence-key', 'Command Console evidence rows are removed')
assertNotIncludes(commandConsole, 'dy-command-trace-copy-status', 'Command Console trace copy live status is removed')
assertIncludes(diagnosticRedaction, 'applyDiagnosticRedactions', 'Shared diagnostic raw redaction utility')
assertIncludes(diagnosticRedaction, 'safeDiagnosticPayload', 'Shared diagnostic payload allowlist utility')
assertIncludes(diagnosticRedaction, '[redacted-phone]', 'Shared diagnostic redaction redacts phone-like identifiers')
assertIncludes(diagnosticRedaction, 'SAFE_DIAGNOSTIC_PAYLOAD_KEYS', 'Shared diagnostic payload allowlist key set')
assertIncludes(commandConsole, 'className="dy-command-stop-run"', 'Command Console stop button')
assertIncludes(commandConsole, 'Stop ${busyAgents.length} running Command Console', 'Command Console stop button accessible label')
assertIncludes(finalOverrides, '.dy-command-busy-dot', 'Command Console running indicator dot styling')
assertIncludes(finalOverrides, '.dy-command-stop-run', 'Command Console stop button styling')
assertNotIncludes(finalOverrides, '.dy-command-evidence-preview', 'Command Console trace evidence preview styling is removed')
assertIncludes(uiSmoke, "requestPath === '/api/openclaw/agent-turn/stream'", 'UI smoke active Command Console stream route')
assertIncludes(uiSmoke, "requestPath === '/api/ui-smoke/agent-turn-stream-stats'", 'UI smoke active stream stats route')
assertIncludes(uiSmoke, 'seedRunningCommandConsole', 'UI smoke seeds running Command Console state')
assertIncludes(uiSmoke, 'stopRunningCommandConsole', 'UI smoke clicks Command Console stop button')
assertIncludes(uiSmoke, 'stopButtonPresent', 'UI smoke checks Command Console stop button')
assertIncludes(uiSmoke, 'busyStatusAriaLabel', 'UI smoke checks Command Console running status label')
assertIncludes(uiSmoke, '!agentsNavItem.commandConsole.traceChipPresent', 'UI smoke verifies Command Console trace chip is absent')
assertIncludes(uiSmoke, '!agentsNavItem.commandConsole.evidencePreviewPresent', 'UI smoke verifies Command Console evidence preview is absent')
assertIncludes(uiSmoke, 'thinkingBodyPresent', 'UI smoke verifies inline Command Console thinking body')
assertIncludes(uiSmoke, '!agentsNavItem.commandConsole.gatewayAcceptedVisible', 'UI smoke verifies Gateway acceptance copy is replaced by inline thinking')
assertIncludes(uiSmoke, '!agentsNavItem.commandConsole.runTraceVisible', 'UI smoke verifies run id trace chip text is absent')
assertIncludes(packageJson, 'smoke-diagnostic-redaction.ts', 'OpenClaw smoke includes diagnostic redaction utility checks')
assertNotIncludes(uiSmoke, 'copyCommandConsoleTrace', 'UI smoke should not click removed trace copy button')
assertIncludes(uiSmoke, "requestPath === '/api/openclaw/runtime/monitor/clear'", 'UI smoke serves Clean Slate monitor clear endpoint')
assertIncludes(uiSmoke, "requestPath === '/api/ui-smoke/runtime-monitor-clear-mode'", 'UI smoke can force Clean Slate monitor clear failures')
assertIncludes(uiSmoke, 'ui_smoke_monitor_clear_failed', 'UI smoke uses explicit Clean Slate failure fixture')
assertIncludes(uiSmoke, 'cleanSlateMonitor', 'UI smoke clicks Monitor Clean Slate')
assertIncludes(uiSmoke, 'Clean Slate complete\\.', 'UI smoke verifies Clean Slate completion status')
assertIncludes(uiSmoke, 'active Gateway work were preserved', 'UI smoke verifies Clean Slate active Gateway preservation copy')
assertIncludes(uiSmoke, 'without stopping active Gateway runs', 'UI smoke verifies Clean Slate active-run-safe tooltip')
assertIncludes(uiSmoke, 'monitorCleanSlateFailure', 'UI smoke verifies Monitor Clean Slate failure path')
assertIncludes(uiSmoke, "monitorCleanSlateFailure.statusRole === 'alert'", 'UI smoke verifies Clean Slate failure alert role')
assertIncludes(uiSmoke, '!monitorCleanSlateFailure.successTextStillPresent', 'UI smoke verifies Clean Slate failure clears stale success text')
assertIncludes(uiSmoke, 'streamClosed', 'UI smoke verifies Command Console stream closes after stop')
assertIncludes(agentTurnStreamSmoke, "assert.equal(abortMarker.runId, abortStatus.runId)", 'Agent turn stream smoke checks abort run id continuity')
assertIncludes(agentTurnStreamSmoke, "assert.equal(abortMarker.reason, 'client-close')", 'Agent turn stream smoke checks abort close reason')

const agentTurnStreamRoute = sectionBetween(
  agentTurnRoutes,
  "app.post('/api/openclaw/agent-turn/stream'",
  "app.post('/api/openclaw/agent-turn'",
  'Command Console stream route',
)
const agentRuntimeTurn = sectionBetween(
  agentRuntimeService,
  'async function runControlCenterAgentRuntimeTurn',
  'return { runControlCenterAgentRuntimeTurn }',
  'Command Console runtime fallback ladder',
)

assertIncludes(server, "'Content-Type': 'text/event-stream; charset=utf-8'", 'SSE content type')
assertIncludes(server, "'Cache-Control': 'no-cache, no-transform'", 'SSE cache guard')
assertIncludes(server, "'X-Accel-Buffering': 'no'", 'SSE proxy buffering guard')
assertIncludes(server, "res.write(': connected\\n\\n')", 'SSE connection comment')

assertOrderedIncludes(agentTurnStreamRoute, [
  'initializeSseResponse(res)',
  "emit('status'",
  'Command accepted; opening the Gateway-backed OpenClaw session.',
  "emit('progress'",
  'Opening Gateway chat session.',
  "if (!forcedGatewayConsoleTurn)",
  'await ensureOpenclawAgentRunConfigDefaults()',
  "emit('progress'",
  'Runtime ready; dispatching through Gateway chat.',
  'const payload = await streamProviderAgentTurn',
  "emit('final'",
], 'Command Console stream SSE startup order')

assertIncludes(agentTurnStreamRoute, "transport: parsed.data.forceOpenClawRuntime ? 'gateway-chat' : 'control-center-sse'", 'Command Console stream transport metadata')
assertIncludes(agentTurnStreamRoute, 'liveTokens: parsed.data.forceOpenClawRuntime', 'Command Console stream live-token metadata')
assertIncludes(agentTurnStreamRoute, 'splitTextForSse(text)', 'Command Console stream delta chunking')
assertIncludes(agentTurnStreamRoute, 'if (!closed) res.end()', 'Command Console stream response cleanup')
assertIncludes(agentRuntimeTurn, "if (params.signal?.aborted) throw error", 'Command Console abort avoids transport fallback catch')
assertIncludes(agentRuntimeTurn, "throw Object.assign(new Error('gateway agent run aborted before fallback'), { name: 'AbortError' })", 'Command Console abort avoids local fallback')

assertOrderedIncludes(sseStream, [
  'export function createSseFrameParser()',
  "buffer = `${buffer}${chunk}`.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n')",
  "const boundary = buffer.indexOf('\\n\\n')",
  "if (line.startsWith('event:')) event = line.slice(6).trim() || 'message'",
  "if (line.startsWith('data:')) data.push(line.slice(5).trimStart())",
  "if (data.length) frames.push({ event, data: data.join('\\n') })",
  "flush: () => push('\\n\\n')",
], 'Command Console shared SSE parser')

assertOrderedIncludes(agentTurnsApi, [
  "import { createSseFrameParser, type SseFrame } from '../utils/sseStream'",
  'async function readAgentTurnSseFrames',
  'const sseParser = createSseFrameParser()',
  'for (const frame of sseParser.push(decoder.decode(value, { stream: true }))) onFrame(frame)',
  'for (const frame of sseParser.push(decoder.decode())) onFrame(frame)',
  'for (const frame of sseParser.flush()) onFrame(frame)',
], 'Command Console renderer API SSE parser')

assertOrderedIncludes(nexusStore, [
  'const createControlStreamProjector = () =>',
  "if (event === 'status')",
  "if (event === 'progress')",
  "if (event === 'delta')",
  'accumulated = data.replace === true ? text : `${accumulated}${text}`',
  "if (event === 'error')",
  "if (event === 'final')",
  'onStreamComplete: streamProjector.complete',
], 'Command Console frontend SSE projection')

assertIncludes(gatewayProtocolDocs, 'Side-effecting methods require **idempotency keys**', 'Gateway protocol idempotency requirement')
assertIncludes(gatewayProtocolDocs, '`chat.history`, `chat.send`, `chat.abort`, and `chat.inject`', 'Gateway protocol chat execution methods')
assertIncludes(gatewayProtocolDocs, '`chat.message.get`', 'Gateway protocol bounded full-message reader')
assertIncludes(gatewayProtocolDocs, 'delta payloads carry `deltaText`', 'Gateway protocol chat delta text')
assertIncludes(gatewayProtocolDocs, '`runId`', 'Gateway protocol run id references')
assertIncludes(gatewayProtocolDocs, '`sessionKey`', 'Gateway protocol session key references')
assertIncludes(commandConsoleGuide, 'Stream matching `chat` `delta` events by `runId`', 'Command Console guide delta/runId contract')
assertIncludes(commandConsoleGuide, 'Use the matching `chat` `final`, `error`, or `aborted` event as the terminal', 'Command Console guide terminal chat states')
assertIncludes(commandConsoleGuide, 'Use `chat.history` for the durable final assistant text.', 'Command Console guide durable history contract')
assertIncludes(commandConsoleGuide, 'Use `chat.message.get` when a `chat.history` row is truncated', 'Command Console guide full-message fallback contract')
assertIncludes(commandConsoleGuide, 'Use `chat.abort` when the HTTP request is canceled or the run times out.', 'Command Console guide abort contract')

assertIncludes(gatewayChatService, 'function gatewayPayloadRunId', 'Gateway event run id extractor')
assertIncludes(gatewayChatService, 'function gatewayPayloadChatState', 'Gateway chat state parser')
assertIncludes(gatewayChatService, "if (state === 'delta')", 'Gateway delta event handler')
assertIncludes(gatewayChatService, "if (state === 'final') emitGatewayChatDelta", 'Gateway final event handler')
assertIncludes(gatewayChatService, "const ok = finalState !== 'error' && finalState !== 'aborted'", 'Gateway terminal error/abort handling')
assertIncludes(gatewayChatService, "gatewayChatRunWaiters.delete(runId)", 'Gateway terminal waiter cleanup')

assertIncludes(server, 'CLAWTALK_ROUTING_PATCH_VERSION = 11', 'ClawTalk routing patch version')
assertIncludes(server, "from './integrations/agentRoutingHelpers'", 'control plane imports isolated agent routing patch assets')
assertIncludes(routingHelpers, 'export const CLAWTALK_CORE_BRIDGE_ROUTING_HELPER', 'ClawTalk routing patch asset')
assertIncludes(routingHelpers, 'export const TELEGRAM_AGENT_ROUTING_HELPER', 'Telegram routing patch asset')
assertIncludes(routingHelpers, 'TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 5', 'Telegram routing patch version')
assertIncludes(routingHelpers, 'function resolveTelegramAgentModelRef', 'Telegram routed agent model resolver')
assertIncludes(routingHelpers, 'Active configured model', 'Telegram routed agent model context')
assertIncludes(routingHelpers, 'function parseTelegramAgentRouteAutoStart', 'Telegram natural-name fast route parser')
assertIncludes(routingHelpers, "mode: 'auto'", 'Telegram natural-name routes should stay one-shot')
assertIncludes(routingHelpers, 'function buildTelegramAgentFreshSessionKey', 'Telegram natural-name routes should use fresh sessions')
assertIncludes(routingHelpers, "reason: parsed.mode === '/' ? 'sticky' : parsed.mode === 'auto' ? 'auto-fresh' : 'one-shot-fresh'", 'Telegram named one-shot routes should avoid stale sessions')
assertIncludes(server, "CLAWTALK_REPAIR_SIGNATURE_VERSION = 'clawtalk-repair:v12'", 'ClawTalk repair signature version')
assertIncludes(server, "TELEGRAM_REPAIR_SIGNATURE_VERSION = 'telegram-routing-repair:v5'", 'Telegram repair signature version')
assertIncludes(server, "const routeApplicationMarker = 'const telegramAgentRoute = resolveTelegramAgentRouteForMessage({'", 'Telegram route application patch marker')
assertIncludes(server, "const bodyResultMarker = 'if (!bodyResult) return null;'", 'Telegram route insertion body marker')
assertIncludes(server, 'CoreBridge patch skipped: unsupported bridge shape', 'ClawTalk bridge shape guard')
assertIncludes(server, 'delete nextConfig.apiKeyRef', 'ClawTalk unsupported apiKeyRef scrubber')
assertIncludes(server, 'delete nextConfig.apiKeyStorage', 'ClawTalk unsupported apiKeyStorage scrubber')
assertIncludes(gatewayLifecycleService, 'allowExternalTakeover', 'Gateway restart ownership guard')

assertRegex(
  runtimeActionService,
  /tryRestartGatewayService\(\{\s*force: true,\s*allowExternalTakeover: true,\s*reason: 'manual gateway restart requested',\s*\}\)/,
  'manual restart takeover flag',
)

console.log('OpenClaw contract smoke checks passed.')
