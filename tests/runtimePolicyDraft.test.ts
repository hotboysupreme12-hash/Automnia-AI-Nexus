import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRuntimePolicyPatch, mixedRuntimeFields, type RuntimeDefaultsDraft } from '../src/components/settings/runtimePolicyDraft'

const defaults: RuntimeDefaultsDraft = { heartbeatSeconds: 30, idleTimeoutSeconds: 60, continuous: false, recoveryMode: true, timeoutMinutes: 12, thinkingDefault: 'minimal', fastModeDefault: 'auto', parallelPreferred: false }

test('bulk policy changes preserve differing unedited target values', () => {
  const other = { ...defaults, thinkingDefault: 'high' as const, continuous: true }
  assert.deepEqual([...mixedRuntimeFields([defaults, other])].sort(), ['continuous', 'thinkingDefault'])
  const patch = buildRuntimePolicyPatch({ ...defaults, timeoutMinutes: 5 }, ['timeoutMinutes'])
  assert.deepEqual(patch.heartbeat, {})
  assert.deepEqual(patch.runtimePolicy, { timeoutSeconds: 300 })
  assert.deepEqual({ thinkingDefault: other.thinkingDefault, ...patch.runtimePolicy }, { thinkingDefault: 'high', timeoutSeconds: 300 })
  assert.deepEqual(buildRuntimePolicyPatch(defaults, []), { heartbeat: {}, runtimePolicy: {} })
})

test('explicit runtime replacement includes every field and bounds durations', () => {
  const patch = buildRuntimePolicyPatch({ ...defaults, heartbeatSeconds: 5000, timeoutMinutes: 500 }, Object.keys(defaults) as Array<keyof RuntimeDefaultsDraft>)
  assert.equal(patch.heartbeat.tickIntervalMs, 1_800_000)
  assert.equal(patch.runtimePolicy.timeoutSeconds, 7200)
  assert.equal(patch.runtimePolicy.thinkingDefault, 'minimal')
})
