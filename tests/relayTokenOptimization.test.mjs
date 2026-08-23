import assert from 'node:assert/strict'
import test from 'node:test'

import {
  automniaRelayTokenOptimization,
  compactOpenAiMessages,
  compactOpenAiTools,
  estimateRelayTokens,
  resolveRelayOutputTokenBudget,
} from '../infra/gcloud/service/tokenOptimization.js'

test('hosted relay compacts history, tool output, and repeated inline images while preserving the active turn', () => {
  const huge = 'x'.repeat(30_000)
  const messages = [
    { role: 'system', content: 'System rules '.repeat(2_000) },
    ...Array.from({ length: 18 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `history-${index} ${huge}` })),
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"README.md"}' } }],
    },
    { role: 'tool', tool_call_id: 'call_1', content: huge },
    { role: 'user', content: [{ type: 'text', text: 'Finish the task.' }, { type: 'input_image', image_url: 'https://example.test/one.png' }, { type: 'input_image', image_url: 'https://example.test/two.png' }, { type: 'input_image', image_url: 'https://example.test/three.png' }] },
  ]

  const compacted = compactOpenAiMessages(messages)
  const serialized = JSON.stringify(compacted.messages)
  assert.ok(compacted.stats.changed)
  assert.ok(compacted.stats.removedMessages > 0)
  assert.ok(compacted.stats.truncatedMessages > 0)
  assert.equal(compacted.stats.droppedImages, 2)
  assert.equal(compacted.stats.oversizedImages, 0)
  assert.ok(serialized.length <= automniaRelayTokenOptimization.maxInputTokens * 4 + 5_000)
  assert.match(serialized, /Finish the task\./)
  assert.match(serialized, /call_1/)
  assert.ok(compacted.stats.compactedChars < compacted.stats.originalChars)
  assert.ok(estimateRelayTokens(compacted.messages) > 0)
})

test('hosted relay keeps tool names and required schema fields but drops verbose schema metadata', () => {
  const compacted = compactOpenAiTools([{
    type: 'function',
    function: {
      name: 'write',
      description: 'd'.repeat(1_000),
      parameters: {
        type: 'object',
        title: 'Verbose title that is not needed by the model',
        properties: {
          path: { type: 'string', description: 'p'.repeat(1_000), default: 'README.md', format: 'path' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  }])

  const schema = compacted.tools[0].function.parameters
  assert.equal(compacted.tools[0].function.name, 'write')
  assert.ok(compacted.stats.compactedChars < compacted.stats.originalChars)
  assert.equal(schema.title, undefined)
  assert.equal(schema.properties.path.default, undefined)
  assert.deepEqual(schema.required, ['path', 'content'])
  assert.ok(schema.properties.path.description.length <= 100)
})

test('hosted relay applies a bounded tool-schema budget while preserving active calls', () => {
  const tools = [
    ...Array.from({ length: 40 }, (_, index) => ({
      type: 'function',
      function: {
        name: `verbose_tool_${index}`,
        description: 'd'.repeat(4_000),
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
      },
    })),
    {
      type: 'function',
      function: {
        name: 'active_tool',
        description: 'active',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    },
  ]
  const compacted = compactOpenAiTools(tools, {
    maxToolTokens: 1_024,
    maxTools: 32,
    requiredToolNames: ['active_tool'],
  })

  assert.ok(compacted.stats.droppedTools > 0)
  assert.ok(compacted.tools.some((tool) => tool.function.name === 'active_tool'))
  assert.ok(compacted.stats.estimatedToolTokens <= 1_024 + 1_100)
})

test('hosted relay keeps every required argument even when optional schema fields are capped', () => {
  const properties = Object.fromEntries([
    ...Array.from({ length: 20 }, (_, index) => [`required_${index}`, { type: 'string', description: 'x'.repeat(300) }]),
    ...Array.from({ length: 8 }, (_, index) => [`optional_${index}`, { type: 'string' }]),
  ])
  const required = Array.from({ length: 20 }, (_, index) => `required_${index}`)
  const compacted = compactOpenAiTools([{
    type: 'function',
    function: {
      name: 'required_args_tool',
      parameters: { type: 'object', properties, required },
    },
  }])

  const schema = compacted.tools[0].function.parameters
  assert.deepEqual(schema.required, required)
  assert.deepEqual(Object.keys(schema.properties).slice(0, required.length), required)
  assert.equal(schema.properties.optional_0, undefined)
})

test('hosted relay replaces an oversized base64 image with an actionable marker', () => {
  const compacted = compactOpenAiMessages([
    { role: 'user', content: [{ type: 'input_image', source: { type: 'base64', media_type: 'image/png', data: 'a'.repeat(1_600_000) } }] },
  ])
  assert.equal(compacted.stats.oversizedImages, 1)
  assert.match(JSON.stringify(compacted.messages), /large inline image omitted/)
})

test('hosted relay enforces the aggregate input budget after system and current-turn compaction', () => {
  const compacted = compactOpenAiMessages([
    { role: 'system', content: 'system guidance '.repeat(4_000) },
    { role: 'user', content: 'old request '.repeat(2_000) },
    { role: 'assistant', content: 'old answer '.repeat(2_000) },
    { role: 'user', content: 'current request '.repeat(4_000) },
  ], {
    maxInputTokens: 2_000,
    maxSystemChars: 6_000,
    maxMessageChars: 12_000,
    maxHistoryMessages: 8,
  })

  const serialized = JSON.stringify(compacted.messages)
  assert.ok(serialized.length <= 8_000, `compacted request exceeded budget: ${serialized.length}`)
  assert.match(serialized, /current context shortened|current request/)
  assert.ok(compacted.stats.truncatedMessages > 0)
})

test('hosted relay chooses a smaller automatic output budget and honors explicit bounded budgets', () => {
  assert.deepEqual(resolveRelayOutputTokenBudget({}), { maxOutputTokens: 1_536, source: 'automnia_auto', explicit: false })
  assert.equal(resolveRelayOutputTokenBudget({}, { hasTools: true }).maxOutputTokens, 2_048)
  assert.equal(resolveRelayOutputTokenBudget({ reasoning_effort: 'high' }, { hasTools: true }).maxOutputTokens, 3_072)
  assert.deepEqual(resolveRelayOutputTokenBudget({ max_tokens: 20_000 }), { maxOutputTokens: 3_072, source: 'caller', explicit: true })
})
