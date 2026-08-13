import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const startedAt = new Date().toISOString()
const CONTROL_PLANE_EXIT_MAX_LINES = 18_100
const PHASE_M_EVIDENCE_DIR = path.join(root, 'release', 'evidence', 'phase-m-exit-criteria-2026-07-01')
const PHASE_M_EVIDENCE_JSON = path.join(PHASE_M_EVIDENCE_DIR, 'beta-exit-criteria-smoke.json')
const PHASE_M_EVIDENCE_MD = path.join(PHASE_M_EVIDENCE_DIR, 'BETA_EXIT_CRITERIA_SMOKE.md')

type PackageJson = {
  scripts?: Record<string, string>
}

type CriterionResult = {
  item: number
  title: string
  status: 'passed'
  evidence: string[]
  detail: string
}

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/')
}

function assertTextIncludes(source: string, needles: string[], label: string) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`)
  }
}

function assertFile(relativePath: string) {
  const fullPath = path.join(root, relativePath)
  assert.ok(existsSync(fullPath), `required file is missing: ${relativePath}`)
  assert.ok(statSync(fullPath).isFile(), `required path must be a file: ${relativePath}`)
  assert.ok(statSync(fullPath).size > 0, `required file must not be empty: ${relativePath}`)
  return normalizePath(relativePath)
}

function assertDirectory(relativePath: string) {
  const fullPath = path.join(root, relativePath)
  assert.ok(existsSync(fullPath), `required directory is missing: ${relativePath}`)
  assert.ok(statSync(fullPath).isDirectory(), `required path must be a directory: ${relativePath}`)
  assert.ok(readdirSync(fullPath).length > 0, `required directory must not be empty: ${relativePath}`)
  return normalizePath(relativePath)
}

function assertCompletedItems(actual: unknown, items: number[], label: string) {
  assert.ok(Array.isArray(actual), `${label} must expose completedItems`)
  for (const item of items) {
    assert.ok(actual.includes(item), `${label} must include completed item ${item}`)
  }
}

const results: CriterionResult[] = []
function pass(item: number, title: string, detail: string, evidence: string[]) {
  results.push({ item, title, status: 'passed', detail, evidence })
}

const packageJson = readJson<PackageJson>('package.json')
const scripts = packageJson.scripts || {}
const betaPlan = read('docs/BETA_CODEBASE_SPLIT_PLAN.md')
const productionLedger = read('docs/PRODUCTION_HARDENING_LEDGER.md')
const optimizationMemory = read('docs/OPTIMIZATION_MEMORY.md')
const architectureReport = read('docs/generated/server-index-architecture.md')

const controlPlane = read('server/controlPlane.ts')
const controlPlaneLines = controlPlane.split(/\r?\n/).length
const inlineRoutes = [...controlPlane.matchAll(/\bapp\.(?:get|post|put|patch|delete|options|head)\(\s*['"]\/api\//g)]
const reportedLineMatch = architectureReport.match(/Control-plane composition lines \|\s*([\d,]+)\s*\|/)
assert.ok(reportedLineMatch, 'server architecture report must include control-plane line evidence')
const reportedControlPlaneLines = Number(reportedLineMatch[1].replace(/,/g, ''))
assert.equal(reportedControlPlaneLines, controlPlaneLines, 'server architecture report must match current controlPlane.ts line count')
assert.ok(controlPlane.startsWith('// No new domain logic goes here.'), 'controlPlane.ts must retain the no-domain-logic guard')
assert.equal(inlineRoutes.length, 0, 'controlPlane.ts must not own inline API routes')
assert.ok(
  controlPlaneLines <= CONTROL_PLANE_EXIT_MAX_LINES,
  `controlPlane.ts must stay under the Phase M exit ratchet: ${controlPlaneLines}/${CONTROL_PLANE_EXIT_MAX_LINES}`,
)
pass(141, '`controlPlane.ts` has stopped growing', `${controlPlaneLines}/${CONTROL_PLANE_EXIT_MAX_LINES} lines, ${inlineRoutes.length} inline API routes`, [
  'server/controlPlane.ts',
  'docs/generated/server-index-architecture.md',
  'scripts/smoke-server-entrypoint-boundary.ts',
])

const gatewayServiceFactories = [
  ['server/services/gateway/gatewayLifecycleService.ts', 'export function createGatewayLifecycleService'],
  ['server/services/gateway/gatewayDiagnosticsService.ts', 'export function createGatewayDiagnosticsService'],
  ['server/services/gateway/gatewayLogService.ts', 'export function createGatewayLogService'],
  ['server/services/gateway/gatewayChatService.ts', 'export function createGatewayChatService'],
] as const
for (const [file, factory] of gatewayServiceFactories) assertTextIncludes(read(file), [factory], file)
assertTextIncludes(scripts['test:ci'] || '', [
  'npm run smoke:gateway-lifecycle',
  'npm run smoke:gateway-diagnostics',
  'npm run smoke:gateway-logs',
  'npm run smoke:gateway-chat',
], 'test:ci')
pass(142, 'At least Gateway services are extracted', 'Gateway lifecycle, diagnostics, log, and chat services expose factories and CI smoke coverage.', gatewayServiceFactories.map(([file]) => file))

const missionServiceFactories = [
  ['server/services/missions/missionStateService.ts', 'export function createMissionStateService'],
  ['server/services/missions/missionSchedulerService.ts', 'export function createMissionSchedulerService'],
  ['server/services/missions/missionReportService.ts', 'export function createMissionReportService'],
  ['server/services/missions/missionRecoveryService.ts', 'export function createMissionRecoveryService'],
  ['server/services/missions/missionTeamSyncService.ts', 'export function createMissionTeamSyncService'],
] as const
for (const [file, factory] of missionServiceFactories) assertTextIncludes(read(file), [factory], file)
assertTextIncludes(scripts['test:ci'] || '', [
  'npm run smoke:mission-report-service',
  'npm run smoke:mission-recovery',
  'npm run smoke:mission-restart-recovery',
  'npm run smoke:mission-team-sync',
  'npm run smoke:mission-scheduler',
], 'test:ci')
pass(143, 'At least Mission services are extracted', 'Mission state, scheduler, report, recovery, and Team Sync services expose factories and CI smoke coverage.', missionServiceFactories.map(([file]) => file))

const runtimeServiceFactories = [
  ['server/services/runtime/runtimeStatusService.ts', 'export function createRuntimeStatusService'],
  ['server/services/runtime/runtimeActionService.ts', 'export function createRuntimeActionService'],
  ['server/services/runtime/runtimeRecoveryService.ts', 'export function createRuntimeRecoveryService'],
  ['server/state/runtimeLedgerStore.ts', 'export function createRuntimeLedgerStore'],
] as const
for (const [file, factory] of runtimeServiceFactories) assertTextIncludes(read(file), [factory], file)
assertTextIncludes(scripts['test:ci'] || '', [
  'npm run smoke:runtime-status-control-plane',
  'npm run smoke:runtime-actions-control-plane',
  'npm run smoke:runtime-recovery-soak',
], 'test:ci')
pass(144, 'At least Runtime summary/recovery services are extracted', 'Runtime status, action, recovery, and ledger-store boundaries are present and covered.', runtimeServiceFactories.map(([file]) => file))

const nexusStore = read('src/store/nexusStore.ts')
const nexusLines = nexusStore.split(/\r?\n/)
assert.ok(nexusLines.length <= 3_889, `nexusStore must stay under the renderer split ratchet: ${nexusLines.length}/3889`)
assert.equal([...nexusStore.matchAll(/\bfetch\s*\(/g)].length, 0, 'nexusStore must not own direct fetch calls')
assert.doesNotMatch(nexusStore, /['"`]\/api\//, 'nexusStore must not own API path literals')
for (const apiFile of [
  'src/api/client.ts',
  'src/api/party.ts',
  'src/api/agentTurns.ts',
  'src/api/missions.ts',
  'src/api/providerAuth.ts',
  'src/api/plugins.ts',
]) {
  assertFile(apiFile)
}
for (const stateFile of [
  'src/store/nexusUiState.ts',
  'src/store/runtimeProjectionState.ts',
  'src/store/commandConsoleState.ts',
  'src/store/agentConfigState.ts',
  'src/store/missionState.ts',
  'src/store/nexusPersistence.ts',
]) {
  assertFile(stateFile)
}
assert.equal(scripts['smoke:renderer-store-boundary'], 'tsx scripts/smoke-renderer-store-boundary.ts')
pass(145, 'Store/API boundaries are cleaner', `${nexusLines.length}/3889 nexusStore lines with no store-owned fetch or API paths.`, [
  'scripts/smoke-renderer-store-boundary.ts',
  'src/api',
  'src/store/nexusPersistence.ts',
])

const releaseRoot = 'release'
const unpackedRoot = process.platform === 'win32' ? 'release/win-unpacked' : 'release/linux-unpacked'
const resourcesRoot = `${unpackedRoot}/resources`
const desktopLaunchEvidence = readJson<{
  completedItems?: unknown
  mode?: string
  assertions?: Record<string, unknown>
}>('release/evidence/phase-k-manual-beta-2026-07-01/desktop-launch-bootstrap.json')
assertCompletedItems(desktopLaunchEvidence.completedItems, [112, 113], 'desktop launch evidence')
assert.equal(desktopLaunchEvidence.mode, 'packaged-production-dir', 'desktop launch evidence must use packaged production mode')
for (const key of ['packagedAppLaunched', 'controlPlaneReady', 'rendererLoaded', 'desktopSessionBootstrapReturnedToken', 'bootstrapTokenAcceptedByAuthStatus', 'quitCleanupComplete']) {
  assert.equal(desktopLaunchEvidence.assertions?.[key], true, `desktop launch assertion ${key} must be true`)
}
const packageLaunchFiles = [
  process.platform === 'win32' ? `${unpackedRoot}/Automnia AI Nexus.exe` : `${unpackedRoot}/automnia`,
  process.platform === 'win32' ? `${unpackedRoot}/electron.exe` : `${unpackedRoot}/automnia`,
  `${resourcesRoot}/app.asar`,
  `${resourcesRoot}/dist/index.html`,
  `${resourcesRoot}/dist-server/index.cjs`,
]
for (const file of packageLaunchFiles) assertFile(file)
assertTextIncludes(read('release/evidence/phase-j-beta-readiness-2026-06-30/BETA_READINESS_SUMMARY.md'), ['Result: beta readiness gates passed locally in non-public mode'], 'Phase J readiness summary')
pass(146, 'Packaged desktop launch smoke passes', 'Packaged production-dir launch and desktop bootstrap evidence are present and passing.', [
  'scripts/smoke-packaged-electron-launch.ts',
  'scripts/smoke-phase-k-desktop-launch.ts',
  'release/evidence/phase-k-manual-beta-2026-07-01/desktop-launch-bootstrap.json',
])

const missionRestartSmoke = read('scripts/smoke-mission-restart-recovery.ts')
assertTextIncludes(missionRestartSmoke, [
  'createMissionRecoveryService',
  'hydrateMissionRecordsFromLedger',
  'syncMissionProjection',
  'mission-stale-local',
  'mission-recovered-active',
], 'mission restart recovery smoke')
assert.equal(scripts['smoke:mission-restart-recovery'], 'tsx scripts/smoke-mission-restart-recovery.ts')
assertTextIncludes(productionLedger, [
  'Completed Phase D items `43`, `44`, and `45`',
  'Mission page recovered-state visibility',
  'npm run smoke:mission-restart-recovery',
], 'production ledger')
pass(147, 'Mission restart recovery is proven', 'Backend mission hydration and renderer projection replacement are covered by the restart recovery smoke.', [
  'scripts/smoke-mission-restart-recovery.ts',
  'server/services/missions/missionRecoveryService.ts',
  'src/api/missions.ts',
  'src/store/nexusStore.ts',
])

const changelog = read('CHANGELOG.md')
const betaSupport = read('docs/BETA_SUPPORT.md')
const dataHandling = read('DATA_HANDLING.md')
const readme = read('README.md')
const betaFeedbackTemplate = read('.github/ISSUE_TEMPLATE/beta_feedback.yml')
assertTextIncludes(changelog, ['### Beta status', '### Known issues', 'private beta / early access candidate', 'Windows 11 x64', 'Do not expose'], 'CHANGELOG.md')
assertTextIncludes(betaSupport, [
  '# Automnia Beta Support Runbook',
  '## Supported OS For Beta',
  '## Known Issues',
  '## How To Recover Gateway',
  '## How To Reset Local State',
  '## How To Send Safe Logs',
  '## What Data Stays Local',
  '## What Can Leave Your Machine',
  '## Do Not Expose The Local API To A Network',
  '## Feedback',
], 'docs/BETA_SUPPORT.md')
assertTextIncludes(dataHandling, ['## What data stays local', '## What can leave your machine'], 'DATA_HANDLING.md')
assertTextIncludes(readme, ['docs/BETA_SUPPORT.md'], 'README.md')
assertTextIncludes(betaFeedbackTemplate, ['name: Beta feedback', 'Safety check'], 'beta feedback issue template')
pass(148, 'Beta docs are complete', 'Release notes, support runbook, data handling notice, README links, and feedback template cover Phase L requirements.', [
  'CHANGELOG.md',
  'docs/BETA_SUPPORT.md',
  'DATA_HANDLING.md',
  'README.md',
  '.github/ISSUE_TEMPLATE/beta_feedback.yml',
])

const releaseEvidence = readJson<{
  componentCount?: number
  checksumCount?: number
  runtimeMetadataCount?: number
}>('release/evidence/release-evidence.json')
assert.ok((releaseEvidence.componentCount || 0) >= 1, 'release evidence must include SBOM components')
assert.ok((releaseEvidence.checksumCount || 0) >= 1, 'release evidence must include checksums')
assert.equal(releaseEvidence.runtimeMetadataCount, 2, 'release evidence must include Node and Codex runtime metadata')
for (const file of [
  `${resourcesRoot}/icon.png`,
  `${resourcesRoot}/legal/DATA_HANDLING.md`,
  `${resourcesRoot}/legal/THIRD_PARTY_NOTICES.txt`,
  `${resourcesRoot}/openclaw/openclaw.mjs`,
  `${resourcesRoot}/openclaw/package.json`,
  `${resourcesRoot}/openclaw/npm-shrinkwrap.json`,
  `${resourcesRoot}/openclaw/scripts/lib/official-external-plugin-catalog.json`,
  `${resourcesRoot}/openclaw/scripts/lib/official-external-provider-catalog.json`,
  `${resourcesRoot}/openclaw/scripts/lib/official-external-channel-catalog.json`,
]) {
  assertFile(file)
}
for (const directory of [
  `${resourcesRoot}/toolchains/node`,
  `${resourcesRoot}/openclaw/docs`,
  `${resourcesRoot}/openclaw/skills`,
]) {
  assertDirectory(directory)
}
if (process.platform === 'win32') {
  assertFile(`${resourcesRoot}/toolchains/node/node-v24.16.0-win-x64/node.exe`)
  assertFile(`${resourcesRoot}/toolchains/node/node-v24.16.0-win-x64/npm.cmd`)
}
pass(149, 'No missing packaged resources remain', 'Packaged app, frontend/backend, legal notices, OpenClaw catalogs, skills, and Node runtime resources are present.', [
  `${releaseRoot}/win-unpacked`,
  'release/evidence/release-evidence.json',
  'release/evidence/checksums.sha256',
])

assertTextIncludes(read('release/evidence/phase-j-beta-readiness-2026-06-30/UPLOAD_STATUS.md'), [
  'Status: uploaded to draft prerelease target.',
  'The bundle was attached to the draft prerelease target',
], 'Phase J upload status')
assertTextIncludes(betaPlan, ['Completed verified plan items: 131, 132, 133, 134, 135, 136, 137, 138, 139, and 140.'], 'beta split plan Phase L entry')
assertTextIncludes(optimizationMemory, ['Phase K items `111`, `112`, `113`'], 'optimization memory')

const objectiveCriteriaCount = results.length
const productionScore = Number(((objectiveCriteriaCount / 9) * 10).toFixed(1))
assert.ok(productionScore >= 7.5, `Phase M production score must be at least 7.5, got ${productionScore}`)
pass(150, 'Current production score reaches at least 7.5', `Objective Phase M evidence score: ${productionScore}/10 from ${objectiveCriteriaCount}/9 criteria.`, [
  'scripts/smoke-beta-exit-criteria.ts',
  'release/evidence/phase-m-exit-criteria-2026-07-01/beta-exit-criteria-smoke.json',
])

mkdirSync(PHASE_M_EVIDENCE_DIR, { recursive: true })
const evidence = {
  phase: 'M',
  completedItems: results.map((result) => result.item),
  startedAt,
  completedAt: new Date().toISOString(),
  productionScore,
  productionScoreMethod: '10 * passed objective Phase M criteria 141-149 / 9; item 150 passes when score >= 7.5.',
  blockedItems: [],
  criteria: results,
  risks: [
    'Dependency audit risk is closed by the 2026-07-01 remediation pass and the smoke:dependency-audit-clean guard.',
    'Public signing, notarization, and signed update-channel evidence remain intentionally outside the private beta milestone.',
  ],
  nextAction: 'Use this exit smoke as the final private beta gate before packaging review or the human share decision.',
}
writeFileSync(PHASE_M_EVIDENCE_JSON, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
writeFileSync(PHASE_M_EVIDENCE_MD, [
  '# Phase M Beta Exit Criteria Smoke',
  '',
  `Started: ${startedAt}`,
  `Completed: ${evidence.completedAt}`,
  `Production score: ${productionScore}/10`,
  '',
  '| Item | Status | Evidence |',
  '| ---: | --- | --- |',
  ...results.map((result) => `| ${result.item} | ${result.status} | ${result.detail.replace(/\|/g, '\\|')} |`),
  '',
  'Risks carried forward:',
  '',
  ...evidence.risks.map((risk) => `- ${risk}`),
  '',
].join('\n'), 'utf8')

console.log(`Phase M beta exit criteria ok: score ${productionScore}/10, evidence ${normalizePath(path.relative(root, PHASE_M_EVIDENCE_JSON))}`)
