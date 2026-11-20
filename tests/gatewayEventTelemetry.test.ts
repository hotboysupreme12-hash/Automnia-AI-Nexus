import assert from 'node:assert/strict'
import test from 'node:test'
import { isGatewayRunStatusTelemetry } from '../src/utils/gatewayEventTelemetry'

test('internal Gateway run_status frames are identified at the top level or under data', () => {
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'agent', stream: 'run_status' }), true)
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'agent', data: { stream: 'run_status' } }), true)
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'agent', phase: ' RUN_STATUS ' }), true)
})

test('visible Gateway work and non-agent events are not filtered as run_status telemetry', () => {
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'agent', stream: 'assistant' }), false)
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'agent', data: { stream: 'tool' } }), false)
  assert.equal(isGatewayRunStatusTelemetry({ gatewayEvent: 'chat', stream: 'run_status' }), false)
})
