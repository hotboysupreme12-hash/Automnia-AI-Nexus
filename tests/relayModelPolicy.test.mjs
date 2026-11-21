import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automniaRelayFallbackModels,
  automniaRelayModel,
  automniaRelayModels,
  automniaRelayModelsForRequest,
  automniaRelaySelectableModels,
  isAutomniaRelayModelAllowed,
  resolveAutomniaRelayModel,
} from '../infra/gcloud/service/relayModelPolicy.js'

test('Automnia relay exposes a bounded primary plus hosted fallbacks', () => {
  assert.equal(automniaRelayModel, 'gemini-4-hydrogen')
  assert.deepEqual(automniaRelayFallbackModels, ['gemini-3.8-flash'])
  assert.deepEqual(automniaRelayModels, [automniaRelayModel, ...automniaRelayFallbackModels])
  assert.deepEqual(automniaRelaySelectableModels.slice(0, 4), [
    'gemini-4-carbon',
    'gemini-4-neon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
  ])
})

test('relay model resolution accepts only bare or qualified hosted IDs', () => {
  assert.equal(resolveAutomniaRelayModel(), 'gemini-4-hydrogen')
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/gemini-3.8-flash'), 'gemini-3.8-flash')
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/gemini-4-hydrogen'), 'gemini-4-hydrogen')
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/gemini-3.7-flash'), null)
  assert.equal(resolveAutomniaRelayModel('google-vertex/gemini-3.8-flash'), null)
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/unknown'), null)
  assert.equal(isAutomniaRelayModelAllowed('gemini-2.5-flash'), false)
  assert.equal(isAutomniaRelayModelAllowed('gemini-3.8-flash'), true)
  assert.equal(isAutomniaRelayModelAllowed('gemini-4-neon'), true)
  assert.equal(resolveAutomniaRelayModel('gemini-4-argon'), 'gemini-4-hydrogen')
  assert.equal(isAutomniaRelayModelAllowed('gemini-4-carbon'), true)
  assert.deepEqual(automniaRelayModelsForRequest('gemini-3.8-flash'), ['gemini-3.8-flash', 'gemini-4-hydrogen'])
  assert.deepEqual(automniaRelayModelsForRequest('gemini-4-carbon'), [
    'gemini-4-carbon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
  ])
  assert.deepEqual(automniaRelayModelsForRequest('gemini-4-neon'), [
    'gemini-4-neon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
  ])
  assert.deepEqual(automniaRelayModelsForRequest('gemini-4-argon'), ['gemini-4-hydrogen', 'gemini-3.8-flash'])
})
