import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelReasoningDefaultCache } from '../server/services/providers/modelReasoningDefaultCache'

test('reasoning default cache keys normalized provider/model and recomputes on metadata changes', () => {
  const cache = createModelReasoningDefaultCache(2)
  let resolutions = 0
  const resolver = () => {
    resolutions += 1
    return 'low' as const
  }

  assert.equal(cache.resolve(' GOOGLE ', 'Gemini-X', { reasoning: true }, resolver), 'low')
  assert.equal(cache.resolve('google', 'gemini-x', { reasoning: true }, resolver), 'low')
  assert.equal(resolutions, 1)
  assert.equal(cache.resolve('google', 'gemini-x', { reasoning: false }, resolver), 'low')
  assert.equal(resolutions, 2)
})

test('reasoning default cache evicts least-recently-used provider/model entries at its bound', () => {
  const cache = createModelReasoningDefaultCache(2)
  let resolutions = 0
  const resolve = () => {
    resolutions += 1
    return 'medium' as const
  }

  cache.resolve('google', 'one', {}, resolve)
  cache.resolve('google', 'two', {}, resolve)
  cache.resolve('google', 'one', {}, resolve)
  cache.resolve('google', 'three', {}, resolve)
  assert.equal(cache.size, 2)
  cache.resolve('google', 'two', {}, resolve)
  assert.equal(resolutions, 4)
})
