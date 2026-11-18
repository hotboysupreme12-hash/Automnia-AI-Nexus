import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginLoaderDoctorProjection, projectPluginLoaderFailures } from '../server/services/plugins/pluginLoaderHealth'

test('plugin loader health projects enabled failures into credential-free Doctor findings', () => {
  const failures = projectPluginLoaderFailures([
    {
      id: 'codex',
      enabled: true,
      status: 'failed',
      loaderErrorSummary: 'token=super-secret-value',
      missingDependencies: [],
      recoveryHint: 'raw recovery with secret=other-secret',
    },
    { id: 'disabled-plugin', enabled: false, status: 'failed', loaderErrorSummary: 'disabled failure' },
  ])
  assert.equal(failures.length, 1)
  assert.deepEqual(failures[0], {
    pluginId: 'codex',
    failureClass: 'loader_error',
    summary: 'Plugin codex reported a loader failure before activation.',
    recoveryHint: 'Open Plugins, inspect this plugin runtime, and use its targeted loader repair action; rerun Doctor to verify recovery.',
    missingDependencyCount: 0,
  })
  const doctor = pluginLoaderDoctorProjection(failures)
  assert.equal(doctor.ok, false)
  assert.match(doctor.evidence, /Plugin codex reported a loader failure/)
  assert.match(doctor.repairAction || '', /targeted loader repair/)
  assert.doesNotMatch(JSON.stringify({ failures, doctor }), /super-secret-value|other-secret/)
})

test('plugin dependency failures are bounded and avoid returning dependency strings', () => {
  const failures = projectPluginLoaderFailures([{
    id: 'google',
    enabled: true,
    status: 'enabled',
    missingDependencies: ['token=secret', 'path=C:/private', 'another'],
    loaderErrorSummary: 'private registry response with bearer token',
  }])
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.missingDependencyCount, 3)
  assert.equal(failures[0]?.summary, 'Plugin google failed to load; 3 declared dependencies are unavailable.')
  assert.match(failures[0]?.recoveryHint || '', /verified source/)
  assert.doesNotMatch(JSON.stringify(failures), /secret|private|bearer|token=|C:\\private/)
})

test('plugin loader projection ignores invalid ids, disabled plugins, and caps findings', () => {
  const failures = projectPluginLoaderFailures([
    { id: '../private', enabled: true, status: 'failed' },
    ...Array.from({ length: 20 }, (_, index) => ({ id: `plugin-${index}`, enabled: true, status: 'failed' })),
  ])
  assert.equal(failures.length, 12)
  assert.equal(failures[0]?.pluginId, 'plugin-0')
  assert.equal(failures.at(-1)?.pluginId, 'plugin-11')
})
