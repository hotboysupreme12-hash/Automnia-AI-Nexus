import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginToggleRequiresGatewayRestart } from '../server/services/plugins/pluginRestartPolicy'

test('Codex plugin toggles always require a gateway restart', () => {
  assert.equal(pluginToggleRequiresGatewayRestart('codex'), true)
  assert.equal(pluginToggleRequiresGatewayRestart(' CODEX '), true)
})

test('ordinary plugin toggles keep their existing hot-reload behavior', () => {
  assert.equal(pluginToggleRequiresGatewayRestart('telegram'), false)
  assert.equal(pluginToggleRequiresGatewayRestart('clawtalk'), false)
})
