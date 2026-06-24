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

const server = read('server/index.ts')
const runtimeLedger = read('server/runtimeLedger.ts')
const runtimeHook = read('src/hooks/useRuntimeStatus.ts')
const nexusStore = read('src/store/nexusStore.ts')
const commandConsole = read('src/components/monitor/AgentResponseConsole.tsx')
const liveOperationMonitor = read('src/components/monitor/LiveOperationMonitor.tsx')
const diagnosticRedaction = read('src/utils/diagnosticRedaction.ts')
const finalOverrides = read('src/styles/dystopai-theme/50-final-overrides.css')
const uiSmoke = read('scripts/smoke-ui-render.mjs')
const agentTurnStreamSmoke = read('scripts/smoke-agent-turn-stream.ts')
const sseStream = read('src/utils/sseStream.ts')
const packageJson = read('package.json')
const gatewayChatSchema = read('vendor/openclaw/dist/plugin-sdk/packages/gateway-protocol/src/schema/logs-chat.d.ts')

assertIncludes(runtimeLedger, 'readGatewayEventLedgerTail', 'gateway event ledger reader')
assertIncludes(runtimeLedger, 'readDiagnosticRunLedgerTail', 'diagnostic run ledger reader')
assertIncludes(server, "app.get('/api/openclaw/runtime/summary'", 'runtime summary endpoint')
assertIncludes(runtimeHook, 'useRuntimeSummaryStatus', 'runtime summary hook')
assertIncludes(server, 'readGatewayLedgerLogEntries', 'ledger-backed gateway log status path')

assertIncludes(server, "clientName: 'gateway-client'", 'Gateway backend client id')
assertIncludes(server, "mode: 'backend'", 'Gateway backend client mode')
assertIncludes(server, "'operator.talk.secrets'", 'Talk secret scope')
assertIncludes(server, 'class LightweightGatewayClient implements GatewayClientLike', 'Command Console uses lightweight Gateway protocol client')
assertIncludes(server, "this.request('connect'", 'Lightweight Gateway client performs documented connect handshake')
assertIncludes(server, "this.sendFrame({ type: 'req', id, method", 'Lightweight Gateway client sends documented request frames')
assertIncludes(server, "if (frame.type === 'event')", 'Lightweight Gateway client forwards documented event frames')
assertNotIncludes(server, 'gateway-runtime.js', 'Command Console hot path avoids heavy Gateway runtime import')
assertIncludes(server, 'waitForGatewayClientConnect(gatewayClientConnectPromise, signal)', 'Gateway chat client request abort isolation')
assertIncludes(server, 'stopStaleControlCenterGatewayClient', 'Gateway chat client poisoned startup reset')
assertIncludes(server, 'if (await isGatewayHealthy()) return', 'Gateway startup skips repair work when already healthy')
const gatewayClientStartup = sectionBetween(
  server,
  'async function startControlCenterGatewayClient(): Promise<GatewayClientState> {',
  'async function ensureControlCenterGatewayClient(signal?: AbortSignal): Promise<GatewayClientState> {',
  'Gateway chat client startup',
)
assertOrderedIncludes(gatewayClientStartup, [
  'startGatewayHealthMonitor()',
  'if (!(await isGatewayHealthy())) {',
  'await ensureGatewayRunning()',
  'if (!(await isGatewayHealthy())) {',
  'throw new Error(`gateway not healthy on port ${GATEWAY_HTTP_PORT}`)',
  'stopStaleControlCenterGatewayClient()',
], 'Gateway chat client only runs startup when health probe fails')
assertIncludes(server, "gateway agent run aborted before Gateway dispatch", 'Command Console Gateway abort checkpoint')
assertIncludes(server, 'appendRuntimeRunLedger(openClawRunLedgerPayload(record), { sqlite: false })', 'Runtime run hot path avoids synchronous SQLite')
assertIncludes(server, 'appendGatewayEventLedger({', 'Gateway log ledger append remains mirrored')
assertIncludes(server, '}, { sqlite: false }).catch', 'Gateway log hot path avoids synchronous SQLite')
assertIncludes(server, 'readGatewayLedgerLogEntries(48, { sqlite: false })', 'Runtime summary avoids synchronous Gateway log SQLite reads')
assertIncludes(server, 'readDoctorDiagnosticsSummary(false, { sqlite: false })', 'Runtime summary avoids synchronous diagnostic SQLite reads')
assertIncludes(server, 'runtimeLedgerStatus({ sqlite: false })', 'Runtime health/status avoids synchronous ledger SQLite opens')
assertIncludes(server, 'listActiveCronJobViews({ sqlite: false })', 'Runtime status summaries avoid synchronous cron SQLite reads')
assertIncludes(runtimeLedger, 'runtimeLedgerStatus(options: LedgerReadOptions = {})', 'Runtime ledger status can skip synchronous SQLite')
assertIncludes(server, 'const gatewayMessage = isClawTalkRoute ? composedPrompt : effectiveMessage', 'Command Console plain Gateway chat message')
assertIncludes(server, "const forcedGatewayConsoleTurn = parsed.data.forceOpenClawRuntime && parsed.data.source !== 'clawtalk'", 'Command Console forced Gateway fast path')
assertIncludes(server, "if (!forcedGatewayConsoleTurn)", 'Command Console skips heavy route preflight for forced Gateway turns')
assertIncludes(server, 'if (isClawTalkRoute)', 'ClawTalk keeps channel-specific runtime preflight')
assertIncludes(server, "request('chat.send'", 'Gateway chat.send call')
assertNotIncludes(server, 'deliver: false', 'Command Console chat.send leaves WebChat delivery semantics to Gateway')
assertNotIncludes(server, 'suppressCommandInterpretation: true', 'Command Console chat.send keeps Gateway command semantics')
assertIncludes(server, "request('chat.history'", 'Gateway chat.history call')
assertIncludes(server, "request('chat.message.get'", 'Gateway chat.message.get call')
assertIncludes(server, "request('chat.abort'", 'Gateway chat.abort call')
assertIncludes(server, 'idempotencyKey', 'Gateway chat idempotency key')
assertIncludes(server, 'isGatewayProtocolStatusText(finalText)', 'Gateway status text is not treated as assistant reply')
assertIncludes(server, 'without a visible assistant transcript', 'Gateway terminal status without assistant text surfaces as error')
assertIncludes(server, 'void finalPromise.catch(() => undefined)', 'Gateway final waiter early rejection guard')
assertIncludes(server, 'CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC', 'tools.effective diagnostic gate')
assertIncludes(server, 'CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK', 'Command Console stream smoke mock gate')
assertIncludes(server, "req.get('x-control-center-stream-smoke')", 'Command Console stream smoke mock header gate')
assertIncludes(server, "streamSmokeMode === 'abort'", 'Command Console stream smoke abort mode')
assertIncludes(server, 'agent-turn-stream-smoke-abort.json', 'Command Console stream smoke abort marker')
assertIncludes(server, "reason: closed ? 'client-close' : 'timeout'", 'Command Console abort marker reason')
assertIncludes(server, 'Command accepted; opening the Gateway-backed OpenClaw session.', 'Command Console early Gateway ACK')
assertIncludes(server, 'Runtime ready; dispatching through Gateway chat.', 'Command Console runtime ready progress')
assertIncludes(nexusStore, 'commandConsoleSessionKey', 'Command Console stable session key')
assertIncludes(nexusStore, 'forceOpenClawRuntime: true', 'Command Console forced OpenClaw runtime route')
assertIncludes(nexusStore, 'const gatewayChatMessage = options.freshSession', 'Command Console frontend plain Gateway chat message')
assertIncludes(nexusStore, 'const outboundMessage = preferOpenClawRuntime ? gatewayChatMessage : composed', 'Command Console frontend bypasses context wrapper for Gateway chat')
assertIncludes(nexusStore, 'control-center.client.gateway_runtime', 'Command Console client Gateway runtime progress')
assertIncludes(nexusStore, 'activeAgentTurnControllers', 'Command Console active request controller registry')
assertIncludes(nexusStore, 'operatorCancelledAgentTurns', 'Command Console operator cancellation marker')
assertIncludes(diagnosticRedaction, "'sessionKey'", 'Command Console preserves Gateway session key in activity payloads')
assertIncludes(nexusStore, 'if (controller.signal.aborted) throw streamError', 'Command Console stream abort does not retry fallback')
assertIncludes(nexusStore, 'return await parseControlStream(res)', 'Command Console keeps stream controller active until SSE drains')
assertIncludes(nexusStore, 'stopActiveAgentRuns', 'Command Console stop active runs action')
assertIncludes(nexusStore, 'cancelled: cancelledByOperator', 'Command Console returns operator cancellation state')
assertIncludes(nexusStore, 'if (result?.cancelled) break', 'Command Console stops queued sequential lanes after cancel')
assertIncludes(nexusStore, "from '../utils/diagnosticRedaction'", 'Command Console activity uses shared diagnostic redaction utility')
assertIncludes(server, "from '../src/utils/diagnosticRedaction'", 'Gateway runtime monitor uses shared diagnostic redaction utility')
assertIncludes(server, 'applyDiagnosticRedactions(stripAnsi(value || \'\'))', 'Gateway runtime monitor sensitive text redaction uses shared utility')
assertIncludes(server, 'const masked = applyDiagnosticRedactions(normalized)', 'Gateway log compactor uses shared diagnostic redaction utility')
assertIncludes(runtimeHook, 'sessionLockCleanup?:', 'Runtime monitor clear hook preserves session lock cleanup summary')
assertIncludes(liveOperationMonitor, 'RuntimeMonitorClearResult', 'Live monitor types Clean Slate clear result')
assertIncludes(liveOperationMonitor, 'setCleanSlateResult(result)', 'Live monitor surfaces Clean Slate success result')
assertIncludes(liveOperationMonitor, 'Clean Slate complete.', 'Live monitor announces Clean Slate completion')
assertIncludes(liveOperationMonitor, 'active Gateway work were preserved', 'Live monitor documents active Gateway work preservation after Clean Slate')
assertIncludes(commandConsole, 'className="dy-command-busy-status', 'Command Console running status wrapper')
assertIncludes(commandConsole, 'role="status"', 'Command Console running status accessibility role')
assertIncludes(commandConsole, 'latestRunTrace', 'Command Console renders run/session trace metadata')
assertIncludes(commandConsole, 'writeClipboardText', 'Command Console trace metadata is copyable')
assertIncludes(commandConsole, 'redactDiagnosticText', 'Command Console trace evidence has final redaction boundary')
assertIncludes(commandConsole, "from '../../utils/diagnosticRedaction'", 'Command Console trace evidence uses shared diagnostic redaction utility')
assertIncludes(diagnosticRedaction, 'applyDiagnosticRedactions', 'Shared diagnostic raw redaction utility')
assertIncludes(diagnosticRedaction, 'safeDiagnosticPayload', 'Shared diagnostic payload allowlist utility')
assertIncludes(diagnosticRedaction, '[redacted-phone]', 'Shared diagnostic redaction redacts phone-like identifiers')
assertIncludes(diagnosticRedaction, 'SAFE_DIAGNOSTIC_PAYLOAD_KEYS', 'Shared diagnostic payload allowlist key set')
assertIncludes(commandConsole, 'dy-command-trace-copy-status', 'Command Console trace copy live status')
assertIncludes(commandConsole, 'dy-command-evidence-preview', 'Command Console trace evidence preview disclosure')
assertIncludes(commandConsole, 'data-evidence-key', 'Command Console trace evidence rows are smoke-test addressable')
assertIncludes(commandConsole, "'Content', 'omitted'", 'Command Console trace evidence preview omits transcript content')
assertIncludes(commandConsole, 'className="dy-command-stop-run"', 'Command Console stop button')
assertIncludes(commandConsole, 'Stop ${busyAgents.length} running Command Console', 'Command Console stop button accessible label')
assertIncludes(finalOverrides, '.dy-command-busy-dot', 'Command Console running indicator dot styling')
assertIncludes(finalOverrides, '.dy-command-stop-run', 'Command Console stop button styling')
assertIncludes(finalOverrides, '.dy-command-evidence-preview', 'Command Console trace evidence preview styling')
assertIncludes(uiSmoke, "requestPath === '/api/openclaw/agent-turn/stream'", 'UI smoke active Command Console stream route')
assertIncludes(uiSmoke, "requestPath === '/api/ui-smoke/agent-turn-stream-stats'", 'UI smoke active stream stats route')
assertIncludes(uiSmoke, 'seedRunningCommandConsole', 'UI smoke seeds running Command Console state')
assertIncludes(uiSmoke, 'stopRunningCommandConsole', 'UI smoke clicks Command Console stop button')
assertIncludes(uiSmoke, 'stopButtonPresent', 'UI smoke checks Command Console stop button')
assertIncludes(uiSmoke, 'busyStatusAriaLabel', 'UI smoke checks Command Console running status label')
assertIncludes(uiSmoke, 'traceChipTitle', 'UI smoke checks Command Console run/session trace chip')
assertIncludes(uiSmoke, 'evidencePreviewPresent', 'UI smoke checks Command Console trace evidence preview')
assertIncludes(uiSmoke, "row.key === 'content' && /omitted/.test(row.text)", 'UI smoke checks trace evidence preview omits transcript content')
assertIncludes(uiSmoke, '!/sk-ui-smoke-secret/.test(commandConsoleTraceCopy.copiedText)', 'UI smoke rejects raw secret marker in copied trace evidence')
assertIncludes(uiSmoke, '!/\\+15555550123/.test(commandConsoleTraceCopy.copiedText)', 'UI smoke rejects raw phone marker in copied trace evidence')
assertIncludes(packageJson, 'smoke-diagnostic-redaction.ts', 'OpenClaw smoke includes diagnostic redaction utility checks')
assertIncludes(uiSmoke, 'copyCommandConsoleTrace', 'UI smoke clicks Command Console trace copy button')
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
assertIncludes(uiSmoke, 'runId=ui-smoke-run', 'UI smoke verifies copied Command Console run id')
assertIncludes(uiSmoke, 'content=omitted', 'UI smoke verifies copied Command Console evidence omits transcript content')
assertIncludes(uiSmoke, 'streamClosed', 'UI smoke verifies Command Console stream closes after stop')
assertIncludes(agentTurnStreamSmoke, "assert.equal(abortMarker.runId, abortStatus.runId)", 'Agent turn stream smoke checks abort run id continuity')
assertIncludes(agentTurnStreamSmoke, "assert.equal(abortMarker.reason, 'client-close')", 'Agent turn stream smoke checks abort close reason')

const agentTurnStreamRoute = sectionBetween(
  server,
  "app.post('/api/openclaw/agent-turn/stream'",
  "app.post('/api/openclaw/agent-turn'",
  'Command Console stream route',
)
const agentRuntimeTurn = sectionBetween(
  server,
  'async function runControlCenterAgentRuntimeTurn',
  'function resolveGoogleGeminiArtifactTarget',
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

assertOrderedIncludes(nexusStore, [
  "import { createSseFrameParser } from '../utils/sseStream'",
  'const parseControlStream = async',
  'const sseParser = createSseFrameParser()',
  "if (event === 'status')",
  "if (event === 'progress')",
  "if (event === 'delta')",
  'accumulated = data.replace === true ? text : `${accumulated}${text}`',
  "if (event === 'error')",
  "if (event === 'final')",
  'for (const frame of sseParser.push(decoder.decode(value, { stream: true }))) consumeFrame(frame.event, frame.data)',
  'for (const frame of sseParser.push(decoder.decode())) consumeFrame(frame.event, frame.data)',
  'for (const frame of sseParser.flush()) consumeFrame(frame.event, frame.data)',
], 'Command Console frontend SSE parser')

assertIncludes(gatewayChatSchema, 'ChatSendParamsSchema', 'Gateway chat send schema')
assertIncludes(gatewayChatSchema, 'idempotencyKey: Type.TString', 'Gateway chat.send idempotency schema')
assertIncludes(gatewayChatSchema, 'ChatDeltaEventSchema', 'Gateway chat delta schema')
assertIncludes(gatewayChatSchema, 'ChatFinalEventSchema', 'Gateway chat final schema')
assertIncludes(gatewayChatSchema, 'ChatAbortedEventSchema', 'Gateway chat aborted schema')
assertIncludes(gatewayChatSchema, 'ChatErrorEventSchema', 'Gateway chat error schema')
assertIncludes(gatewayChatSchema, 'state: Type.TLiteral<"delta">', 'Gateway chat delta state')
assertIncludes(gatewayChatSchema, 'state: Type.TLiteral<"final">', 'Gateway chat final state')
assertIncludes(gatewayChatSchema, 'state: Type.TLiteral<"aborted">', 'Gateway chat aborted state')
assertIncludes(gatewayChatSchema, 'state: Type.TLiteral<"error">', 'Gateway chat error state')
assertIncludes(gatewayChatSchema, 'runId: Type.TString', 'Gateway chat event runId')
assertIncludes(gatewayChatSchema, 'sessionKey: Type.TString', 'Gateway chat event sessionKey')
assertIncludes(gatewayChatSchema, 'deltaText: Type.TString', 'Gateway chat delta text')

assertIncludes(server, 'function gatewayPayloadRunId', 'Gateway event run id extractor')
assertIncludes(server, 'function gatewayPayloadChatState', 'Gateway chat state parser')
assertIncludes(server, "if (state === 'delta')", 'Gateway delta event handler')
assertIncludes(server, "if (state === 'final') emitGatewayChatDelta", 'Gateway final event handler')
assertIncludes(server, "const ok = finalState !== 'error' && finalState !== 'aborted'", 'Gateway terminal error/abort handling')
assertIncludes(server, "gatewayChatRunWaiters.delete(runId)", 'Gateway terminal waiter cleanup')

assertIncludes(server, 'CLAWTALK_ROUTING_PATCH_VERSION = 11', 'ClawTalk routing patch version')
assertIncludes(server, "CLAWTALK_REPAIR_SIGNATURE_VERSION = 'clawtalk-repair:v12'", 'ClawTalk repair signature version')
assertIncludes(server, 'CoreBridge patch skipped: unsupported bridge shape', 'ClawTalk bridge shape guard')
assertIncludes(server, 'delete nextConfig.apiKeyRef', 'ClawTalk unsupported apiKeyRef scrubber')
assertIncludes(server, 'delete nextConfig.apiKeyStorage', 'ClawTalk unsupported apiKeyStorage scrubber')
assertIncludes(server, 'allowExternalTakeover', 'Gateway restart ownership guard')

assertRegex(
  server,
  /tryRestartGatewayService\(\{ force: true, allowExternalTakeover: true \}\)/,
  'manual restart takeover flag',
)

console.log('OpenClaw contract smoke checks passed.')
