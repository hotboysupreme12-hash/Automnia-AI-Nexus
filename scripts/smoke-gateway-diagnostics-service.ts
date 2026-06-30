import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const controlPlane = readWorkspaceFile('server/controlPlane.ts')
const diagnosticsService = readWorkspaceFile('server/services/gateway/gatewayDiagnosticsService.ts')
const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { scripts?: Record<string, string> }

assert.match(
  diagnosticsService,
  /export function createGatewayDiagnosticsService/,
  'Gateway diagnostics service should expose a testable factory',
)
assert.match(
  diagnosticsService,
  /fetchGatewayHealthPayload/,
  'Gateway diagnostics service should own /health probing',
)
assert.match(
  diagnosticsService,
  /fetchGatewayReadinessPayload/,
  'Gateway diagnostics service should own /readyz probing',
)
assert.match(
  diagnosticsService,
  /client\.request\('diagnostics\.stability'/,
  'Gateway diagnostics service should own diagnostics.stability RPC reads',
)
assert.match(
  diagnosticsService,
  /redactSensitiveText\(String\(error\)\)/,
  'Gateway diagnostics service should redact stability request failures',
)
assert.match(
  controlPlane,
  /const gatewayDiagnostics = createGatewayDiagnosticsService\(\{/,
  'controlPlane.ts should compose the Gateway diagnostics service',
)
assert.match(
  controlPlane,
  /fetchGatewayHealthPayload\(\) \{\s*return gatewayDiagnostics\.fetchGatewayHealthPayload\(\)/,
  'controlPlane.ts should delegate Gateway health probing to the diagnostics service',
)
assert.match(
  controlPlane,
  /readGatewayStabilitySnapshot\(limit = 12\) \{\s*return gatewayDiagnostics\.readGatewayStabilitySnapshot\(limit\)/,
  'controlPlane.ts should delegate Gateway stability reads to the diagnostics service',
)
assert.doesNotMatch(
  controlPlane,
  /fetch\(`http:\/\/127\.0\.0\.1:\$\{GATEWAY_HTTP_PORT\}\/(?:health|readyz)`/,
  'controlPlane.ts should not inline Gateway health/readiness HTTP probes',
)
assert.doesNotMatch(
  controlPlane,
  /function normalizeGatewayStabilityPayload/,
  'controlPlane.ts should not own Gateway stability normalization',
)
assert.equal(
  packageJson.scripts?.['smoke:gateway-diagnostics'],
  'tsx scripts/smoke-gateway-diagnostics-service.ts',
  'package.json should expose smoke:gateway-diagnostics',
)
assert.match(
  packageJson.scripts?.['test:ci'] || '',
  /npm run smoke:gateway-diagnostics/,
  'test:ci should run the Gateway diagnostics smoke',
)

console.log('gateway diagnostics service contract ok')
