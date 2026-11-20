import assert from 'node:assert/strict'
import test from 'node:test'
import { activityTypeFromGatewayFrame } from '../src/store/runtimeActivity'

test('gateway tool frame status maps to the correct activity type', () => {
  assert.equal(activityTypeFromGatewayFrame({ toolName: 'browser', status: 'running' }, 'Opening page', 'progress'), 'tool.started')
  assert.equal(activityTypeFromGatewayFrame({ toolName: 'browser', status: 'failed' }, 'Opening page', 'progress'), 'tool.error')
  assert.equal(activityTypeFromGatewayFrame({}, 'Context compaction started', 'progress'), 'run.compacting_context')
})

test('explicit gateway activity type takes precedence over inferred tool state', () => {
  assert.equal(activityTypeFromGatewayFrame({ activityType: 'approval.pending', toolName: 'browser', status: 'running' }, 'Opening page', 'progress'), 'approval.pending')
})
