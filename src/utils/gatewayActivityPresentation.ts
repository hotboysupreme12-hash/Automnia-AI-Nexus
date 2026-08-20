import type { GatewayLogEntry } from '../hooks/useRuntimeStatus'

export type GatewayActivitySurface = 'user' | 'operator'

/**
 * Raw Gateway output is operational evidence, not an assistant message.
 *
 * Keep this boundary explicit so a new activity surface cannot accidentally
 * turn stdout/stderr, channel transport acknowledgements, startup notices, or
 * hook diagnostics into something an end user is expected to read. Operators
 * can still opt into the raw rows from the dedicated internal diagnostics
 * view.
 */
export function projectGatewayLogEntriesForSurface(
  entries: readonly GatewayLogEntry[],
  surface: GatewayActivitySurface,
): GatewayLogEntry[] {
  return surface === 'operator' ? entries.slice() : []
}
