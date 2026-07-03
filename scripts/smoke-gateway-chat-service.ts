import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const controlPlane = readWorkspaceFile('server/controlPlane.ts')
const gatewayChatService = readWorkspaceFile('server/services/gateway/gatewayChatService.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

assert.match(
  gatewayChatService,
  /export function createGatewayChatService/,
  'Gateway chat service should expose a testable factory',
)
assert.match(
  gatewayChatService,
  /export class LightweightGatewayClient implements GatewayClientLike/,
  'Gateway chat service should own the lightweight Gateway protocol client',
)
assert.match(
  gatewayChatService,
  /clientName: 'gateway-client'/,
  'Gateway chat service should connect with the backend gateway-client id',
)
assert.match(
  gatewayChatService,
  /mode: 'backend'/,
  'Gateway chat service should connect in backend mode',
)
assert.match(
  gatewayChatService,
  /'operator\.talk\.secrets'/,
  'Gateway chat service should request Talk secret scope for Control Center backend chat',
)
assert.match(
  gatewayChatService,
  /this\.request\('connect'/,
  'Gateway chat service should perform the documented connect handshake',
)
assert.match(
  gatewayChatService,
  /this\.sendFrame\(\{ type: 'req', id, method/,
  'Gateway chat service should send documented Gateway request frames',
)
assert.match(
  gatewayChatService,
  /if \(frame\.type === 'event'\)/,
  'Gateway chat service should consume documented Gateway event frames',
)
assert.doesNotMatch(
  gatewayChatService,
  /gateway-runtime\.js/,
  'Gateway chat service hot path should avoid importing the heavy Gateway runtime',
)
assert.match(
  gatewayChatService,
  /waitForGatewayClientConnect\(gatewayClientConnectPromise, signal\)/,
  'Gateway chat service should isolate request aborts from persistent startup',
)
assert.match(
  gatewayChatService,
  /function stopStaleClient/,
  'Gateway chat service should reset poisoned startup clients',
)
assert.match(
  gatewayChatService,
  /request\('chat\.send'/,
  'Gateway chat service should own chat.send',
)
assert.match(
  gatewayChatService,
  /request\('chat\.history'/,
  'Gateway chat service should own chat.history',
)
assert.match(
  gatewayChatService,
  /request\('chat\.message\.get'/,
  'Gateway chat service should own chat.message.get fallback',
)
assert.match(
  gatewayChatService,
  /request\('chat\.abort'/,
  'Gateway chat service should own chat.abort',
)
assert.match(
  gatewayChatService,
  /idempotencyKey: runId/,
  'Gateway chat service should use the run id as the chat idempotency key',
)
assert.match(
  gatewayChatService,
  /isGatewayProtocolStatusText\(finalText\)/,
  'Gateway chat service should not treat protocol status text as an assistant reply',
)
assert.match(
  gatewayChatService,
  /without a visible assistant transcript/,
  'Gateway chat service should surface terminal status without assistant text as an error',
)
assert.match(
  gatewayChatService,
  /void finalPromise\.catch\(\(\) => undefined\)/,
  'Gateway chat service should observe early final waiter rejection',
)
assert.match(
  gatewayChatService,
  /toolsEffectiveDiagnostic/,
  'Gateway chat service should keep tools.effective behind a diagnostic gate',
)
assert.match(
  controlPlane,
  /const MACOS_LOCAL_AGENT_RUNTIME_DEFAULT = process\.platform === 'darwin'/,
  'macOS should default away from Gateway chat when local runtime is safer',
)
assert.match(
  controlPlane,
  /CONTROL_CENTER_GATEWAY_AGENT_SESSIONS \|\| \(MACOS_LOCAL_AGENT_RUNTIME_DEFAULT \? '0' : '1'\)/,
  'macOS Gateway agent sessions should default off unless explicitly enabled',
)
assert.match(
  controlPlane,
  /CONTROL_CENTER_FORCE_LOCAL_AGENT_RUNTIME \|\| \(MACOS_LOCAL_AGENT_RUNTIME_DEFAULT \? '1' : ''\)/,
  'macOS should default to the local agent runtime unless explicitly overridden',
)
assert.match(
  gatewayChatService,
  /function redactedGatewayErrorText/,
  'Gateway chat service should redact request failures before surfacing them',
)
assert.match(
  gatewayChatService,
  /function redactedGatewayDiagnosticValue/,
  'Gateway chat service should redact returned diagnostic payloads',
)
assert.doesNotMatch(
  gatewayChatService,
  /deliver: false/,
  'Gateway chat service should leave WebChat delivery semantics to Gateway',
)
assert.doesNotMatch(
  gatewayChatService,
  /suppressCommandInterpretation: true/,
  'Gateway chat service should keep Gateway command semantics',
)

assert.match(
  controlPlane,
  /const gatewayChatService = createGatewayChatService\(\{/,
  'controlPlane.ts should compose the Gateway chat service',
)
assert.match(
  controlPlane,
  /getGatewayDiagnosticsClient = \(\) => gatewayChatService\.getReadyClient\(\)/,
  'controlPlane.ts should expose the service client to diagnostics/log services',
)
assert.match(
  controlPlane,
  /function runControlCenterGatewayChatTurn[\s\S]*return gatewayChatService\.runTurn\(params\)/,
  'controlPlane.ts should delegate Gateway chat turns to the service',
)
assert.match(
  controlPlane,
  /function stopControlCenterGatewayClient[\s\S]*gatewayChatService\.stopClient\(reason\)/,
  'controlPlane.ts should delegate Gateway client shutdown to the service',
)
assert.match(
  controlPlane,
  /function registerGatewayChatStreamObserver[\s\S]*gatewayChatService\.registerStreamObserver\(emit, signal\)/,
  'controlPlane.ts should delegate Gateway stream observers to the service',
)
assert.doesNotMatch(
  controlPlane,
  /class LightweightGatewayClient implements GatewayClientLike/,
  'controlPlane.ts should not own the lightweight Gateway client',
)
assert.doesNotMatch(
  controlPlane,
  /function gatewayPayloadChatState/,
  'controlPlane.ts should not own Gateway chat state parsing',
)
assert.doesNotMatch(
  controlPlane,
  /const gatewayChatRunWaiters = new Map/,
  'controlPlane.ts should not own Gateway chat waiter state',
)
assert.doesNotMatch(
  controlPlane,
  /request\('chat\.send'/,
  'controlPlane.ts should not issue chat.send directly',
)
assert.equal(
  packageJson.scripts?.['smoke:gateway-chat'],
  'tsx scripts/smoke-gateway-chat-service.ts',
  'package.json should expose smoke:gateway-chat',
)
assert.match(
  packageJson.scripts?.['test:ci'] || '',
  /npm run smoke:gateway-chat/,
  'test:ci should run the Gateway chat smoke',
)

console.log('gateway chat service contract ok')
