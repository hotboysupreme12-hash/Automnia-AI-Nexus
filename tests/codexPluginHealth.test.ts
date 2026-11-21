import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  codexPluginAvailableForRuntime,
  codexPluginNeedsRepair,
  codexPluginVersionNeedsUpdate,
  codexProjectsNeedUpdate,
  evaluateCodexDoctorRouteCheck,
  newerInstalledCodexVersion,
  requireGatewayForCodexPreflight,
  selectedModelsNeedCodexRuntime,
  OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC,
} from '../server/services/plugins/codexPluginHealth'
import type { PluginControlEntry } from '../server/services/plugins/pluginInventoryService'

function plugin(overrides: Partial<PluginControlEntry> = {}): PluginControlEntry {
  return {
    id: 'codex',
    name: 'Codex',
    description: 'Codex',
    origin: 'openclaw',
    status: 'loaded',
    enabled: true,
    configuredEnabled: true,
    runtimeLoaded: true,
    category: 'providers',
    commands: [],
    providers: [],
    channels: [],
    missingDependencies: [],
    configFields: [],
    guidance: [],
    needsSetup: false,
    restartRequired: false,
    ...overrides,
  }
}

test('marks degraded Codex entries for automatic repair', () => {
  assert.equal(codexPluginNeedsRepair(plugin({ status: 'degraded', runtimeLoaded: false })), true)
  assert.equal(codexPluginNeedsRepair(plugin({ missingDependencies: ['ws'] })), true)
  assert.equal(codexPluginNeedsRepair(plugin()), false)
})

test('repairs a loaded Codex plugin when the installed release is older than the pin', () => {
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.4' })), true)
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.6' })), false)
  assert.equal(codexPluginNeedsRepair(plugin({ version: '2026.11.7' })), false)
  assert.equal(codexPluginVersionNeedsUpdate('unrecognized', '2026.11.6'), false)
  assert.equal(codexProjectsNeedUpdate(['2026.11.4'], '2026.11.6'), true)
  assert.equal(codexProjectsNeedUpdate(['2026.11.4', '2026.11.6'], '2026.11.6'), false)
  assert.equal(codexProjectsNeedUpdate(['unrecognized'], '2026.11.6'), false)
})

test('waits for Gateway startup before inspecting or repairing Codex', async () => {
  let waits = 0
  await requireGatewayForCodexPreflight({
    isHealthy: async () => false,
    waitForStartup: async () => { waits += 1; return { waited: true, healthy: true } },
  })
  assert.equal(waits, 1)
})

test('defers Codex repair when Gateway startup has not succeeded', async () => {
  await assert.rejects(requireGatewayForCodexPreflight({
    isHealthy: async () => false,
    waitForStartup: async () => ({ waited: true, healthy: false }),
  }), /repair was deferred/)
})

test('does not wait when the Gateway is already healthy', async () => {
  await requireGatewayForCodexPreflight({
    isHealthy: async () => true,
    waitForStartup: async () => { throw new Error('must not wait') },
  })
})

test('protects a newer or unrecognized installed version from automatic downgrade', () => {
  assert.equal(newerInstalledCodexVersion(['2026.11.7'], '2026.11.6'), '2026.11.7')
  assert.equal(newerInstalledCodexVersion(['2026.11.6', '2026.9.2'], '2026.11.6'), undefined)
  assert.equal(newerInstalledCodexVersion(['2026.11.7-rc.1'], '2026.11.6'), '2026.11.7-rc.1')
  assert.equal(newerInstalledCodexVersion(['2026.11.6'], ''), '2026.11.6')
})

test('does not treat a degraded installed entry as runtime-ready', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'error', runtimeLoaded: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ status: 'loaded' }), ''), true)
  assert.equal(codexPluginAvailableForRuntime(undefined, 'C:\\bundled\\codex'), true)
})

test('requires enabled state before declaring Codex available', () => {
  assert.equal(codexPluginAvailableForRuntime(plugin({ enabled: false }), 'C:\\bundled\\codex'), false)
  assert.equal(codexPluginAvailableForRuntime(plugin({ configuredEnabled: false }), 'C:\\bundled\\codex'), false)
})

test('accepts a clean Codex doctor report when non-route recovery inventory is partial', () => {
  const result = evaluateCodexDoctorRouteCheck({
    code: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      ok: true,
      checksRun: 1,
      checksSkipped: 73,
      findings: [],
      recoveryCopies: { measurement: 'partial', incomplete: true },
    }),
    stderr: '',
  })

  assert.equal(result.ok, true)
  assert.equal(result.verified, true)
  assert.equal(result.findingCount, 0)
})

test('uses the healthy targeted report if the CLI wrapper reports an unrelated nonzero exit', () => {
  const result = evaluateCodexDoctorRouteCheck({
    code: 2,
    stdout: JSON.stringify({ schemaVersion: 1, ok: true, checksRun: 1, checksSkipped: 73, findings: [] }),
    stderr: JSON.stringify({ ok: false, error: { type: 'cli_error', message: 'exit 0' } }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.verified, true)
  assert.match(result.warning || '', /healthy Codex route report but exited 2/)
})

test('keeps real Codex route findings and skipped checks blocking', () => {
  const finding = evaluateCodexDoctorRouteCheck({
    code: 1,
    stdout: JSON.stringify({ schemaVersion: 1, ok: false, checksRun: 1, checksSkipped: 73, findings: [{ checkId: 'core/doctor/codex-session-routes' }] }),
    stderr: '',
  })
  const skipped = evaluateCodexDoctorRouteCheck({
    code: 0,
    stdout: JSON.stringify({ schemaVersion: 1, ok: true, checksRun: 0, checksSkipped: 74, findings: [] }),
    stderr: '',
  })

  assert.equal(finding.ok, false)
  assert.equal(finding.findingCount, 1)
  assert.equal(skipped.ok, false)
  assert.equal(skipped.findingCount, 1)
})

test('does not require the Codex plugin for an agent routed only to hosted Gemini', () => {
  assert.equal(selectedModelsNeedCodexRuntime(
    ['automnia-cloud/gemini-4-hydrogen'],
    { openAiProviderRuntime: 'codex' },
  ), false)
})

test('requires the Codex plugin for selected OpenAI Codex routes and fallbacks', () => {
  assert.equal(selectedModelsNeedCodexRuntime(
    ['openai/gpt-5.1-codex'],
    { openAiProviderRuntime: 'codex' },
  ), true)
  assert.equal(selectedModelsNeedCodexRuntime(
    ['automnia-cloud/gemini-4-hydrogen', 'openai/gpt-5.1-codex'],
    { openAiModels: [{ id: 'gpt-5.1-codex', agentRuntime: { id: 'codex' } }] },
  ), true)
})

test('scopes Codex repair and health failures to agents routed through Codex', () => {
  const controlPlaneSource = readFileSync(new URL('../server/controlPlane.ts', import.meta.url), 'utf8')
  const agentTurnRoutesSource = readFileSync(new URL('../server/routes/agentTurnRoutes.ts', import.meta.url), 'utf8')

  assert.match(controlPlaneSource, /const codexRuntimeRequired = agentUsesCodexRuntime\(config, agentId\)/)
  assert.match(controlPlaneSource, /const routeCheck = evaluateCodexDoctorRouteCheck\(doctor\)/)
  assert.match(controlPlaneSource, /await ensureCodexPluginInstalledForOpenAiRuntime\(config, agentId\)/)
  assert.match(controlPlaneSource, /if \(!agentId \|\| !agentUsesCodexRuntime\(config, agentId\)\) return/)
  assert.match(controlPlaneSource, /function ensureOpenclawAgentRunConfigDefaults\(agentId\?: string\)[\s\S]*ensureCodexPluginInstalledForOpenAiRuntime\(config, agentId\)/)
  assert.match(agentTurnRoutesSource, /checkBrowserPreflight\(streamAgent\)/)
  assert.match(agentTurnRoutesSource, /checkBrowserPreflight\(agent\)/)
})

test('automatic Codex installation uses the exact official package supported by this OpenClaw runtime', () => {
  const readinessSource = readFileSync(new URL('../scripts/post-upgrade-openclaw-readiness.mjs', import.meta.url), 'utf8')
  const releaseVersion = /export const CODEX_PLUGIN_VERSION = '([^']+)'/.exec(readinessSource)?.[1]
  const controlPlaneSource = readFileSync(new URL('../server/controlPlane.ts', import.meta.url), 'utf8')

  assert.ok(releaseVersion, 'post-upgrade readiness must pin the Codex plugin release')
  assert.equal(OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC, `npm:@openclaw/codex@${releaseVersion}`)
  assert.match(controlPlaneSource, /spec:\s*bundledCodexSource\s*\|\|\s*OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC/)
  assert.match(controlPlaneSource, /codexProjectsNeedUpdate\(packageVersions, repairVersion\)/)
  assert.match(controlPlaneSource, /installedVersions\.includes\(repairVersion\)/)
  assert.doesNotMatch(controlPlaneSource, /spec:\s*bundledCodexSource\s*\|\|\s*'codex'/)
})
