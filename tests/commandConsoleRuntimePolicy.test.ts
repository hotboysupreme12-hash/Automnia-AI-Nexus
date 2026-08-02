import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveInteractiveConsoleThinking } from '../src/store/commandConsoleRuntimePolicy'

test('interactive Command Console keeps routine chat fast while preserving low reasoning for involved work', () => {
  assert.equal(resolveInteractiveConsoleThinking('Give me a concise summary of our last reply.'), 'off')
  assert.equal(resolveInteractiveConsoleThinking('Inspect the gateway logs, find the timeout cause, and fix it.'), 'low')
  assert.equal(resolveInteractiveConsoleThinking('Review this plan:\n- inspect the API\n- update the client\n- run tests'), 'low')
})
