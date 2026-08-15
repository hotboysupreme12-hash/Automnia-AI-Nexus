import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyGoogleVertexModelLimits,
  GOOGLE_VERTEX_CONTEXT_TOKENS,
  GOOGLE_VERTEX_MAX_OUTPUT_TOKENS,
} from '../server/services/providers/googleVertexModelPolicy'

test('Vertex model metadata exposes the large context and safe output ceiling', () => {
  const provider = {
    models: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', maxTokens: 102400 },
      { id: 'gemini-3.7-pro', name: 'Gemini 3.7 Pro', maxTokens: 32000 },
    ],
  }

  assert.equal(applyGoogleVertexModelLimits(provider), true)
  assert.deepEqual(provider.models, [
    {
      id: 'gemini-3.5-flash',
      name: 'Gemini 3.5 Flash',
      contextWindow: GOOGLE_VERTEX_CONTEXT_TOKENS,
      contextTokens: GOOGLE_VERTEX_CONTEXT_TOKENS,
      maxTokens: GOOGLE_VERTEX_MAX_OUTPUT_TOKENS,
    },
    {
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      maxTokens: GOOGLE_VERTEX_MAX_OUTPUT_TOKENS,
      contextWindow: GOOGLE_VERTEX_CONTEXT_TOKENS,
      contextTokens: GOOGLE_VERTEX_CONTEXT_TOKENS,
    },
    {
      id: 'gemini-3.7-pro',
      name: 'Gemini 3.7 Pro',
      maxTokens: 32000,
      contextWindow: GOOGLE_VERTEX_CONTEXT_TOKENS,
      contextTokens: GOOGLE_VERTEX_CONTEXT_TOKENS,
    },
  ])
  assert.equal(applyGoogleVertexModelLimits(provider), false)
})

test('Vertex policy ignores malformed catalogs and normalizes non-finite limits', () => {
  assert.equal(applyGoogleVertexModelLimits({}), false)

  const provider = {
    models: [
      null,
      [],
      {},
      { id: '  ' },
      { id: 'gemini-invalid-max', maxTokens: Number.NaN },
      { id: 'gemini-infinite-max', maxTokens: Number.POSITIVE_INFINITY },
    ],
  }

  assert.equal(applyGoogleVertexModelLimits(provider), true)
  assert.equal((provider.models[4] as Record<string, unknown>).maxTokens, GOOGLE_VERTEX_MAX_OUTPUT_TOKENS)
  assert.equal((provider.models[5] as Record<string, unknown>).maxTokens, GOOGLE_VERTEX_MAX_OUTPUT_TOKENS)
})
