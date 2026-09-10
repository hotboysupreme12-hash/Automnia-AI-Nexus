import assert from 'node:assert/strict'
import test from 'node:test'
import { c as compact, l as controls, x as catalogRef } from '../vendor/openclaw/dist/local-model-lean-B52ThaBJ.js'

test('bundled runtime defers schemas, discovers and executes an authorized tool, rejects missing tools', async () => {
  const config = { tools: { toolSearch: { enabled: true, mode: 'tools', searchDefaultLimit: 3, maxSearchLimit: 8 } } }
  const ref = catalogRef()
  const bridge = controls({ config, catalogRef: ref })
  let calls = 0
  const tool = { name: 'automnia_test_lookup', label: 'Test lookup', description: 'Look up a harmless test value', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, execute: async (_id, args) => { calls++; return { content: [{ type: 'text', text: args.key }] } } }
  const result = compact({ config, catalogRef: ref, tools: [...bridge, tool] })
  assert.equal(result.compacted, true)
  assert.equal(result.tools.some(t => t.name === tool.name), false)
  assert.deepEqual(result.tools.map(t => t.name), ['tool_search', 'tool_describe', 'tool_call'])
  const search = await bridge.find(t => t.name === 'tool_search').execute('search', { query: tool.name })
  assert.match(JSON.stringify(search), /automnia_test_lookup/)
  const schema = await bridge.find(t => t.name === 'tool_describe').execute('describe', { id: tool.name })
  assert.match(JSON.stringify(schema), /required/)
  const call = bridge.find(t => t.name === 'tool_call')
  await call.execute('call', { id: tool.name, args: { key: 'verified' } })
  assert.equal(calls, 1)
  await assert.rejects(() => call.execute('denied', { id: 'not_authorized', args: {} }))
  assert.equal(calls, 1)
})
