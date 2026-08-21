import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automniaRelayFallbackModels,
  automniaRelayModel,
  automniaRelayModels,
  isAutomniaRelayModelAllowed,
  resolveAutomniaRelayModel,
} from '../infra/gcloud/service/relayModelPolicy.js'

test('Automnia relay exposes a bounded primary plus hosted fallbacks', () => {
  assert.equal(automniaRelayModel, 'gemini-3.7-flash')
  assert.deepEqual(automniaRelayFallbackModels, ['gemini-3.6-flash', 'gemini-2.5-flash'])
  assert.deepEqual(automniaRelayModels, [automniaRelayModel, ...automniaRelayFallbackModels])
})

test('relay model resolution accepts only bare or qualified hosted IDs', () => {
  assert.equal(resolveAutomniaRelayModel(), 'gemini-3.7-flash')
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/gemini-3.6-flash'), 'gemini-3.6-flash')
  assert.equal(resolveAutomniaRelayModel('google-vertex/gemini-3.6-flash'), null)
  assert.equal(resolveAutomniaRelayModel('automnia-cloud/unknown'), null)
  assert.equal(isAutomniaRelayModelAllowed('gemini-2.5-flash'), true)
})

