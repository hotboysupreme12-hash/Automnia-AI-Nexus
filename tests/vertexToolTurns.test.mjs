import assert from 'node:assert/strict'
import test from 'node:test'
import { groupVertexToolResponses } from '../infra/gcloud/service/vertexToolTurns.js'

test('parallel tool responses stay together without losing ids, payloads, or images', () => {
  const ids = ['read-a', 'read-b', 'read-c', 'read-d', 'read-e', 'read-f']
  const input = [
    { role: 'user', parts: [{ text: 'Read the six files, then write the review.' }] },
    { role: 'model', parts: ids.map(id => ({ functionCall: { id, name: 'read', args: { path: id } } })) },
    ...ids.map(id => ({ role: 'user', parts: [{ functionResponse: { id, name: 'read', response: { result: id } } }] })),
  ]
  input.at(-1).parts.push({ inlineData: { mimeType: 'image/png', data: 'fixture' } })
  const before = structuredClone(input)
  const result = groupVertexToolResponses(input)
  assert.equal(result.length, 3)
  assert.deepEqual(result[2].parts.filter(part => part.functionResponse).map(part => part.functionResponse.id), ids)
  assert.deepEqual(result[2].parts.at(-1), { inlineData: { mimeType: 'image/png', data: 'fixture' } })
  assert.deepEqual(input, before)
  assert.deepEqual(groupVertexToolResponses(result), result)
})

test('sequential tool turns and actual user follow-ups remain separate', () => {
  const input = [
    { role: 'model', parts: [{ functionCall: { id: 'a', name: 'read', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { id: 'a', name: 'read', response: { result: 'first' } } }] },
    { role: 'model', parts: [{ functionCall: { id: 'b', name: 'read', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { id: 'b', name: 'read', response: { result: 'second' } } }] },
    { role: 'user', parts: [{ text: 'Now apply the first fix.' }] },
  ]
  assert.deepEqual(groupVertexToolResponses(input), input)
})
