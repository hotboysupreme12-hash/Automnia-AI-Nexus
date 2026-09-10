import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_CONTINUATION_PROMPT_PREFIX,
  AUTOMNIA_PRODUCT_IDENTITY,
  AUTOMNIA_TASK_EXECUTION_POLICY,
  composeAutomniaContinuationPrompt,
} from '../server/services/agents/promptEfficiencyPolicy'

test('continuation prompts preserve the runtime contract with a small stable prefix', () => {
  const message = 'Run the read-only verification tool and report the observed timestamp.'
  const prompt = composeAutomniaContinuationPrompt(message)

  assert.equal(prompt, `${AUTOMNIA_CONTINUATION_PROMPT_PREFIX}${message}`)
  assert.match(prompt, /same tools and permissions/)
  assert.match(prompt, /ISO-8601 timestamps/)
  assert.match(prompt, new RegExp(`${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  assert.ok(AUTOMNIA_CONTINUATION_PROMPT_PREFIX.length < 2400)
  assert.ok(prompt.includes(AUTOMNIA_TASK_EXECUTION_POLICY))
  assert.ok(prompt.startsWith(AUTOMNIA_PRODUCT_IDENTITY))
  assert.match(prompt, /You are an Automnia agent working inside Automnia/)
})
