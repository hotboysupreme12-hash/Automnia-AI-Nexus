export function isGatewayRunStatusTelemetry(data: Record<string, unknown>): boolean {
  if (typeof data.gatewayEvent !== 'string' || data.gatewayEvent.trim().toLowerCase() !== 'agent') return false
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : {}
  const stream = [data.stream, data.phase, data.type, nested.stream, nested.phase, nested.type]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return stream?.trim().toLowerCase() === 'run_status'
}
