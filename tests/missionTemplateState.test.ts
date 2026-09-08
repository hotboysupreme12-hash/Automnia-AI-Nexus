import assert from 'node:assert/strict'
import test from 'node:test'
import { missionDraftFromRecord } from '../src/store/missionTemplateState'

const draft = { title: 'Review changes', description: 'Review the current implementation.', complexity: 60, riskTolerance: 20, durationMode: 'timed', durationValue: 2, durationUnit: 'hours', collaborationMode: 'parallel', missionType: 'planning', requiredEvidence: [{ kind: 'tests', label: 'Run tests', required: true, command: 'npm test' }] }
test('mission copies retain editable evidence and omit all run identity and terminal state', () => {
  const result = missionDraftFromRecord({ ...draft, id: 'old-run', status: 'completed', endedAt: 'yesterday', scheduler: { jobs: [] }, selectedAgents: ['missing'] })
  assert.deepEqual(result, draft)
  assert.notEqual(result?.requiredEvidence?.[0], draft.requiredEvidence[0])
})
test('damaged or oversized template configuration is rejected', () => {
  for (const value of [null, [], { ...draft, durationValue: NaN }, { ...draft, collaborationMode: 'future' }, { ...draft, complexity: -1 }, { ...draft, description: 'x'.repeat(100_001) }, { ...draft, requiredEvidence: [{ kind: 'tests', label: 'Test', required: 'yes' }] }]) assert.equal(missionDraftFromRecord(value), null)
})
