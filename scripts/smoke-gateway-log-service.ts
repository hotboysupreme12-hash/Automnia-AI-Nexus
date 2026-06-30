import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const controlPlane = readWorkspaceFile('server/controlPlane.ts')
const gatewayLogService = readWorkspaceFile('server/services/gateway/gatewayLogService.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

assert.match(
  gatewayLogService,
  /export function createGatewayLogService/,
  'Gateway log service should expose a testable factory',
)
assert.match(
  gatewayLogService,
  /client\.request\('logs\.tail'/,
  'Gateway log service should own logs.tail RPC fallback',
)
assert.match(
  gatewayLogService,
  /async function discoverGatewayFileLogPaths/,
  'Gateway log service should own file-log discovery',
)
assert.match(
  gatewayLogService,
  /async function readGatewayFileLogEntries/,
  'Gateway log service should own file-tail snapshots',
)
assert.match(
  gatewayLogService,
  /function parseClawTalkWsLogLine/,
  'Gateway log service should own channel activity parsing',
)
assert.match(
  gatewayLogService,
  /function dedupeGatewayLogEntries/,
  'Gateway log service should own Gateway log dedupe',
)
assert.match(
  gatewayLogService,
  /function summarizeGatewayActivity/,
  'Gateway log service should own Gateway activity summaries',
)
assert.match(
  gatewayLogService,
  /options\.applyDiagnosticRedactions\(normalized\)/,
  'Gateway log service should use the shared diagnostic redaction boundary',
)
assert.match(
  gatewayLogService,
  /void Promise\.resolve\(options\.appendGatewayLogEntry\(\{/,
  'Gateway log service should mirror log entries through the injected ledger append boundary',
)
assert.match(
  gatewayLogService,
  /\}\)\)\.catch\(\(\) => undefined\)/,
  'Gateway log service should keep ledger mirroring off the hot path',
)
assert.match(
  controlPlane,
  /const gatewayLogService = createGatewayLogService\(\{/,
  'controlPlane.ts should compose the Gateway log service',
)
assert.match(
  controlPlane,
  /appendGatewayLogEntry: \(entry\) => runtimeLedgerStore\.appendGatewayEvent\(entry, \{ sqlite: false \}\)/,
  'controlPlane.ts should inject async JSONL-only Gateway log ledger mirroring',
)
assert.match(
  controlPlane,
  /function pushGatewayLog\(stream: GatewayLogEntry\['stream'], message: string, level\?: string\) \{\s*gatewayLogService\.pushGatewayLog\(stream, message, level\)/,
  'controlPlane.ts should delegate pushGatewayLog to the Gateway log service',
)
assert.match(
  controlPlane,
  /readExternalGatewayLogEntries\(limit = 80\): Promise<GatewayLogEntry\[]> \{\s*return gatewayLogService\.readExternalGatewayLogEntries\(limit\)/,
  'controlPlane.ts should delegate external Gateway log reads to the Gateway log service',
)
assert.match(
  controlPlane,
  /summarizeGatewayActivity\(entries: GatewayLogEntry\[], activeWindowMs = 10 \* 60 \* 1000\): GatewayActivitySummary \{\s*return gatewayLogService\.summarizeGatewayActivity\(entries, activeWindowMs\)/,
  'controlPlane.ts should delegate Gateway activity summaries to the Gateway log service',
)
assert.doesNotMatch(
  controlPlane,
  /function readGatewayFileLogEntries/,
  'controlPlane.ts should not own Gateway file-tail reading',
)
assert.doesNotMatch(
  controlPlane,
  /function parseGatewayFileLogLine/,
  'controlPlane.ts should not own Gateway log parsing',
)
assert.doesNotMatch(
  controlPlane,
  /function isNodeDeprecationWarningLine/,
  'controlPlane.ts should not own Gateway monitor noise filtering',
)
assert.equal(
  packageJson.scripts?.['smoke:gateway-logs'],
  'tsx scripts/smoke-gateway-log-service.ts',
  'package.json should expose smoke:gateway-logs',
)
assert.match(
  packageJson.scripts?.['test:ci'] || '',
  /npm run smoke:gateway-logs/,
  'test:ci should run the Gateway log smoke',
)

console.log('gateway log service contract ok')
