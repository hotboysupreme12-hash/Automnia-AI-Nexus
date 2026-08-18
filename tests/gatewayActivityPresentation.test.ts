import assert from 'node:assert/strict'
import test from 'node:test'
import { projectGatewayLogEntriesForSurface } from '../src/utils/gatewayActivityPresentation'
import type { GatewayLogEntry } from '../src/hooks/useRuntimeStatus'

const diagnostic: GatewayLogEntry = {
  id: 1,
  timestamp: '2026-08-17T17:38:12.000Z',
  stream: 'channel',
  channel: 'telegram',
  direction: 'outbound',
  message: 'telegram sendRichMessage ok chat=[redacted] message=4956',
}

test('raw Gateway output is never projected into the user activity surface', () => {
  assert.deepEqual(projectGatewayLogEntriesForSurface([diagnostic], 'user'), [])
})

test('operators can explicitly request raw Gateway diagnostics', () => {
  assert.deepEqual(projectGatewayLogEntriesForSurface([diagnostic], 'operator'), [diagnostic])
})
