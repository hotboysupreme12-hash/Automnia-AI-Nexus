import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test from 'node:test'
import { patchRelayThoughtSignatureSource } from '../scripts/lib/relay-thought-signature-patch.cjs'

test('signature patch is idempotent and rejects incompatible runtime updates', () => {
  const source = 'arguments: JSON.stringify(toolCall.arguments)'
  const patched = patchRelayThoughtSignatureSource(source)
  assert.equal(patchRelayThoughtSignatureSource(patched), patched)
  assert.throws(() => patchRelayThoughtSignatureSource('changed serializer'), /serializer changed/)
})

test('bundled serializer preserves Gemini signature and tool result across multiple tool steps', async () => {
  const root = new URL('../vendor/openclaw/node_modules/@openclaw/ai/dist/', import.meta.url)
  const name = readdirSync(root).find((entry) => /^openai-completions-stream-.*\.mjs$/.test(entry))
  assert.ok(name)
  const { g: convertMessages } = await import(new URL(name, root).href)
  const model = { id: 'gemini-3.8-flash', provider: 'automnia-cloud', api: 'openai-completions', input: ['text'], reasoning: true }
  const messages = [{ role: 'user', content: 'Run a diagnostic', timestamp: 1 }]
  for (let step = 0; step < 2; step++) {
    messages.push({ role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [{ type: 'toolCall', id: `call_${step}`, name: 'exec', arguments: { command: 'pwd' }, thoughtSignature: `opaque-signature-${step}==` }],
      stopReason: 'toolUse', timestamp: 2 + step * 2 })
    messages.push({ role: 'toolResult', toolCallId: `call_${step}`, toolName: 'exec', content: [{ type: 'text', text: '/workspace' }], isError: false, timestamp: 3 + step * 2 })
  }
  const converted = convertMessages(model, { messages }, {})
  const calls = converted.flatMap((message) => message.tool_calls || [])
  assert.deepEqual(calls.map((call) => call.function.thought_signature), ['opaque-signature-0==', 'opaque-signature-1=='])
  assert.deepEqual(converted.filter((message) => message.role === 'tool').map((message) => message.tool_call_id), ['call_0', 'call_1'])
})
