import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { useAgentVoiceStore } from '../src/speech/agentVoiceStore'

beforeEach(() => useAgentVoiceStore.getState().reset())

test('retains the requested recipient while the console mounts and rejects competing requests', () => {
  assert.equal(useAgentVoiceStore.getState().request('agent-a'), true)
  assert.equal(useAgentVoiceStore.getState().request('agent-b'), false)
  assert.equal(useAgentVoiceStore.getState().request('agent-a'), false)
  assert.equal(useAgentVoiceStore.getState().pendingAgentId, 'agent-a')
  assert.equal(useAgentVoiceStore.getState().agentId, 'agent-a')
})

test('only the recording agent can stop the microphone without changing its recipient', () => {
  useAgentVoiceStore.getState().request('agent-a')
  useAgentVoiceStore.setState({ pendingAgentId: null, phase: 'recording' })
  assert.equal(useAgentVoiceStore.getState().request('agent-b'), false)
  assert.equal(useAgentVoiceStore.getState().stopRequested, false)
  assert.equal(useAgentVoiceStore.getState().request('agent-a'), true)
  assert.equal(useAgentVoiceStore.getState().stopRequested, true)
  assert.equal(useAgentVoiceStore.getState().agentId, 'agent-a')
})

test('transcription and composer dictation exclude new card recordings', () => {
  useAgentVoiceStore.setState({ phase: 'processing', agentId: 'agent-a' })
  assert.equal(useAgentVoiceStore.getState().request('agent-b'), false)
  useAgentVoiceStore.setState({ phase: 'recording', agentId: null })
  assert.equal(useAgentVoiceStore.getState().request('agent-a'), false)
})

test('cleanup releases the microphone controls for another agent', () => {
  useAgentVoiceStore.getState().request('agent-a')
  useAgentVoiceStore.getState().reset()
  assert.equal(useAgentVoiceStore.getState().request('agent-b'), true)
  assert.equal(useAgentVoiceStore.getState().agentId, 'agent-b')
  assert.equal(useAgentVoiceStore.getState().stopRequested, false)
})
