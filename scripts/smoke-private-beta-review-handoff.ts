import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const startedAt = new Date().toISOString()
const HANDOFF_EVIDENCE_DIR = path.join(root, 'release', 'evidence', 'private-beta-review-handoff-2026-07-01')
const HANDOFF_EVIDENCE_JSON = path.join(HANDOFF_EVIDENCE_DIR, 'private-beta-review-handoff.json')
const HANDOFF_EVIDENCE_MD = path.join(HANDOFF_EVIDENCE_DIR, 'PRIVATE_BETA_REVIEW_HANDOFF.md')
const HANDOFF_DOC = path.join(root, 'docs', 'PRIVATE_BETA_REVIEW_HANDOFF.md')
const PHASE_J_DIR = 'release/evidence/phase-j-beta-readiness-2026-06-30'
const PHASE_K_DIR = 'release/evidence/phase-k-manual-beta-2026-07-01'
const PHASE_M_DIR = 'release/evidence/phase-m-exit-criteria-2026-07-01'
const EXPECTED_EVIDENCE_ZIP_SHA256 = '5da8bbc10e611eb737b5e3a0f3a9be15a5f93ffc9a73b01cfc79e5abf17cae5b'
const SOURCE_CONTENT_EXCLUSIONS = [
  'docs/PRIVATE_BETA_REVIEW_HANDOFF.md',
  'docs/BETA_CODEBASE_SPLIT_PLAN.md',
  'docs/OPTIMIZATION_MEMORY.md',
  'docs/PRODUCTION_HARDENING_LEDGER.md',
]

type PackageJson = {
  name?: string
  version?: string
  scripts?: Record<string, string>
}

type ReleaseEvidence = {
  generatedAt?: string
  componentCount?: number
  checksumCount?: number
  runtimeMetadataCount?: number
}

type PhaseEvidence = {
  completedItems?: unknown
  blockedItems?: unknown
  productionScore?: number
  item?: unknown
  result?: string
  risks?: unknown
}

type PhaseKCheck = {
  label: string
  file: string
  items: number[]
  command: string
}

type SourceChange = {
  status: string
  path: string
}

type SourceChangeInventory = {
  trackedCount: number
  untrackedCount: number
  totalCount: number
  trackedChanges: SourceChange[]
  untrackedFiles: SourceChange[]
}

type SourceFileHash = {
  path: string
  sha256: string
  bytes: number
}

type SourceContentAnchor = {
  trackedDiffSha256: string
  trackedDiffBytes: number
  trackedDiffFileCount: number
  untrackedFileHashes: SourceFileHash[]
  generatedOutputExclusions: string[]
  sourceContentSha256: string
}

type GitReviewAnchor = {
  branch: string
  head: string
  upstreamRef: string | null
  upstreamHead: string | null
  statusHeader: string
  trackedDiffShortStat: string
  sourceInventorySha256: string
  sourceContentSha256: string
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

function relativeFromRoot(fullPath: string) {
  return normalizePath(path.relative(root, fullPath))
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
  return normalizePath(relativePath)
}

function assertIncludes(source: string, needles: string[], label: string) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`)
  }
}

function assertEvidenceItems(evidence: PhaseEvidence, items: number[], label: string) {
  const completedItems = Array.isArray(evidence.completedItems) ? evidence.completedItems : []
  const itemLabel = typeof evidence.item === 'string' ? evidence.item : ''
  for (const item of items) {
    assert.ok(
      completedItems.includes(item) || itemLabel.includes(String(item)),
      `${label} must record completed item ${item}`,
    )
  }
  if (Array.isArray(evidence.blockedItems)) {
    assert.equal(evidence.blockedItems.length, 0, `${label} must not record blocked items`)
  }
  if (evidence.result) assert.equal(evidence.result, 'passed', `${label} result must be passed`)
}

function sha256File(relativePath: string) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path.join(root, relativePath)))
  return hash.digest('hex')
}

function sha256Text(value: string) {
  const hash = createHash('sha256')
  hash.update(value)
  return hash.digest('hex')
}

function sha256Buffer(value: Buffer) {
  const hash = createHash('sha256')
  hash.update(value)
  return hash.digest('hex')
}

function assertNoRawSecretMarkers(text: string) {
  const forbidden = [
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /sk-[A-Za-z0-9]{20,}/,
    /xox[baprs]-[A-Za-z0-9-]{20,}/i,
    /gh[pousr]_[A-Za-z0-9]{20,}/i,
    /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}/i,
    /cookie\s*[:=]\s*[^`\s]{16,}/i,
  ]
  for (const pattern of forbidden) {
    assert.doesNotMatch(text, pattern, `handoff output must not include raw secret marker ${pattern}`)
  }
}

function git(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
  )
  return result.stdout.trim()
}

function gitRaw(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
  )
  return result.stdout
}

function gitOptional(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

function parseNameStatusLine(line: string): SourceChange {
  const columns = line.split('\t')
  return {
    status: columns[0] || 'M',
    path: columns.slice(1).map(normalizePath).join(' -> '),
  }
}

function buildSourceChangeInventory(): SourceChangeInventory {
  const trackedChanges = git(['diff', '--name-status'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseNameStatusLine)
  const untrackedFiles = git(['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => ({ status: '??', path: normalizePath(file) }))
  return {
    trackedCount: trackedChanges.length,
    untrackedCount: untrackedFiles.length,
    totalCount: trackedChanges.length + untrackedFiles.length,
    trackedChanges,
    untrackedFiles,
  }
}

function buildSourceInventoryDigest(inventory: SourceChangeInventory) {
  return sha256Text(
    JSON.stringify({
      trackedChanges: inventory.trackedChanges,
      untrackedFiles: inventory.untrackedFiles,
    }),
  )
}

function buildTrackedContentPaths(inventory: SourceChangeInventory) {
  const generatedOutputExclusionSet = new Set(SOURCE_CONTENT_EXCLUSIONS)
  return [
    ...new Set(
      inventory.trackedChanges
        .map((file) => file.path)
        .flatMap((file) => file.split(' -> '))
        .filter((file) => file && !generatedOutputExclusionSet.has(file)),
    ),
  ]
}

function buildTrackedContentShortStat(inventory: SourceChangeInventory) {
  const trackedContentPaths = buildTrackedContentPaths(inventory)
  if (trackedContentPaths.length === 0) return 'no tracked content diff'
  return git(['diff', '--shortstat', '--', ...trackedContentPaths]) || 'no tracked content diff'
}

function buildSourceContentAnchor(inventory: SourceChangeInventory): SourceContentAnchor {
  const generatedOutputExclusions = SOURCE_CONTENT_EXCLUSIONS
  const generatedOutputExclusionSet = new Set(generatedOutputExclusions)
  const trackedContentPaths = buildTrackedContentPaths(inventory)
  const trackedDiff = trackedContentPaths.length > 0
    ? gitRaw(['diff', '--binary', '--', ...trackedContentPaths])
    : ''
  const untrackedFileHashes = inventory.untrackedFiles
    .filter((file) => !generatedOutputExclusionSet.has(file.path))
    .map((file) => {
      const content = readFileSync(path.join(root, file.path))
      return {
        path: file.path,
        sha256: sha256Buffer(content),
        bytes: content.byteLength,
      }
    })
  const trackedDiffSha256 = sha256Text(trackedDiff)
  const contentAnchor = {
    trackedDiffSha256,
    trackedDiffBytes: Buffer.byteLength(trackedDiff, 'utf8'),
    trackedDiffFileCount: trackedContentPaths.length,
    untrackedFileHashes,
    generatedOutputExclusions,
  }
  return {
    ...contentAnchor,
    sourceContentSha256: sha256Text(JSON.stringify(contentAnchor)),
  }
}

function buildGitReviewAnchor(inventory: SourceChangeInventory, contentAnchor: SourceContentAnchor): GitReviewAnchor {
  const upstreamRef = gitOptional(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(['rev-parse', 'HEAD']),
    upstreamRef,
    upstreamHead: upstreamRef ? gitOptional(['rev-parse', upstreamRef]) : null,
    statusHeader: git(['status', '--short', '--branch']).split(/\r?\n/)[0] || '',
    trackedDiffShortStat: buildTrackedContentShortStat(inventory),
    sourceInventorySha256: buildSourceInventoryDigest(inventory),
    sourceContentSha256: contentAnchor.sourceContentSha256,
  }
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, '\\|')
}

function sourceChangeRows(changes: SourceChange[]) {
  if (changes.length === 0) return ['| - | None |']
  return changes.map((change) => `| \`${escapeTableCell(change.status)}\` | \`${escapeTableCell(change.path)}\` |`)
}

function sourceFileHashRows(hashes: SourceFileHash[]) {
  if (hashes.length === 0) return ['| None | - | - |']
  return hashes.map((file) => `| \`${escapeTableCell(file.path)}\` | \`${file.sha256}\` | ${file.bytes} |`)
}

const packageJson = readJson<PackageJson>('package.json')
const scripts = packageJson.scripts || {}
assert.equal(scripts['smoke:private-beta-handoff'], 'tsx scripts/smoke-private-beta-review-handoff.ts')
assertFile('scripts/smoke-private-beta-review-handoff.ts')

const betaPlan = read('docs/BETA_CODEBASE_SPLIT_PLAN.md')
const optimizationMemory = read('docs/OPTIMIZATION_MEMORY.md')
const productionLedger = read('docs/PRODUCTION_HARDENING_LEDGER.md')
assertIncludes(betaPlan, [
  'Private beta split-plan implementation is complete through Phase M',
  'Dependency audit remediation closure',
  'Prepare review/release handoff from the refreshed private beta evidence',
], 'beta split plan')
assertIncludes(optimizationMemory, [
  'Private beta split-plan implementation is complete through Phase M',
  'The Phase J dependency audit risk is now closed',
  'Private beta review handoff is now prepared',
], 'optimization memory')
assertIncludes(productionLedger, [
  'Dependency Audit Remediation Closure',
  'Private beta split-plan implementation is complete through Phase M',
  'Prepare review/release handoff from the refreshed private beta evidence',
], 'production ledger')

const phaseJSummary = read(`${PHASE_J_DIR}/BETA_READINESS_SUMMARY.md`)
const phaseJUpload = read(`${PHASE_J_DIR}/UPLOAD_STATUS.md`)
const phaseJKnownIssues = read(`${PHASE_J_DIR}/BETA_KNOWN_ISSUES.md`)
assertIncludes(phaseJSummary, [
  'Result: beta readiness gates passed locally in non-public mode',
  '`npm test`: passed on the final tree, 187 unit tests plus smoke gates.',
  '`npm run release:validate`: passed in non-public mode',
], 'Phase J readiness summary')
assertIncludes(phaseJUpload, [
  'Status: uploaded to draft prerelease target.',
  'Draft release tag: `phase-j-beta-readiness-2026-06-30`',
  'The bundle was attached to the draft prerelease target for Phase J item 109.',
], 'Phase J upload status')
assertIncludes(phaseJKnownIssues, [
  'Resolved after Phase J: the 8 dependency audit findings originally reported by `npm ci` were closed on 2026-07-01.',
  'Public signing was intentionally skipped for beta.',
], 'Phase J known issues')
assert.doesNotMatch(phaseJKnownIssues, /upload is pending/i, 'Phase J known issues must not carry stale upload-pending text')

const evidenceZip = 'release/phase-j-beta-readiness-2026-06-30-evidence.zip'
assertFile(evidenceZip)
const evidenceZipSha256 = sha256File(evidenceZip)
assert.equal(evidenceZipSha256, EXPECTED_EVIDENCE_ZIP_SHA256, 'local evidence zip digest must match uploaded GitHub asset digest')

const phaseKChecks: PhaseKCheck[] = [
  { label: 'Fresh checkout', file: 'fresh-checkout-smoke.json', items: [111], command: 'npm run smoke:fresh-checkout' },
  { label: 'Desktop launch bootstrap', file: 'desktop-launch-bootstrap.json', items: [112, 113], command: 'npm run smoke:phase-k-desktop-launch' },
  { label: 'Provider and agent setup', file: 'provider-agent-smoke.json', items: [114, 115, 116], command: 'npm run smoke:phase-k-provider-agent' },
  { label: 'Command Console and attachment', file: 'command-console-smoke.json', items: [117, 118], command: 'npm run smoke:phase-k-command-console' },
  { label: 'Mission launch', file: 'mission-launch-smoke.json', items: [119, 120], command: 'npm run smoke:phase-k-mission-launch' },
  { label: 'Mission cancellation', file: 'mission-cancellation-smoke.json', items: [121], command: 'npm run smoke:phase-k-mission-cancellation' },
  { label: 'Monitor runtime evidence', file: 'monitor-runtime-evidence-smoke.json', items: [122], command: 'npm run smoke:phase-k-monitor-runtime-evidence' },
  { label: 'Gateway restart UI', file: 'gateway-restart-ui-smoke.json', items: [123], command: 'npm run smoke:phase-k-gateway-restart-ui' },
  { label: 'Gateway tray recovery', file: 'gateway-tray-recovery-smoke.json', items: [124], command: 'npm run smoke:phase-k-gateway-tray-recovery' },
  { label: 'App rehydration', file: 'app-rehydration-smoke.json', items: [125], command: 'npm run smoke:phase-k-app-rehydration' },
  { label: 'Plugin status', file: 'plugin-status-smoke.json', items: [126], command: 'npm run smoke:phase-k-plugin-status' },
  { label: 'Missing provider auth', file: 'missing-provider-auth-smoke.json', items: [127], command: 'npm run smoke:phase-k-missing-provider-auth' },
  { label: 'Redacted failed command', file: 'redacted-failed-command-smoke.json', items: [128], command: 'npm run smoke:phase-k-redacted-failed-command' },
  { label: 'Mission report inspection', file: 'mission-report-inspection-smoke.json', items: [129], command: 'npm run smoke:phase-k-mission-report-inspection' },
  { label: 'Settings persistence', file: 'settings-persistence-smoke.json', items: [130], command: 'npm run smoke:phase-k-settings-persistence' },
]

const phaseKCompletedItems = new Set<number>()
const phaseKRows = phaseKChecks.map((check) => {
  const evidencePath = `${PHASE_K_DIR}/${check.file}`
  assertFile(evidencePath)
  const evidence = readJson<PhaseEvidence>(evidencePath)
  assertEvidenceItems(evidence, check.items, check.label)
  for (const item of check.items) phaseKCompletedItems.add(item)
  return {
    ...check,
    evidence: normalizePath(evidencePath),
  }
})
for (let item = 111; item <= 130; item += 1) {
  assert.ok(phaseKCompletedItems.has(item), `Phase K handoff must cover item ${item}`)
}
assertFile(`${PHASE_K_DIR}/settings-persistence-smoke.png`)

const phaseM = readJson<PhaseEvidence>(`${PHASE_M_DIR}/beta-exit-criteria-smoke.json`)
assertEvidenceItems(phaseM, [141, 142, 143, 144, 145, 146, 147, 148, 149, 150], 'Phase M exit criteria')
assert.equal(phaseM.productionScore, 10, 'Phase M production score must stay at 10 for this handoff')
const phaseMRisks = Array.isArray(phaseM.risks) ? phaseM.risks.map(String).join('\n') : ''
assert.doesNotMatch(
  phaseMRisks,
  /Dependency audit warnings remain recorded/i,
  'Phase M exit criteria evidence must not reintroduce the stale dependency-audit risk',
)
assert.match(
  phaseMRisks,
  /Dependency audit risk is closed/i,
  'Phase M exit criteria evidence must record the closed dependency-audit risk',
)

const releaseEvidence = readJson<ReleaseEvidence>('release/evidence/release-evidence.json')
assert.ok((releaseEvidence.componentCount || 0) >= 500, 'release evidence must include the refreshed SBOM component count')
assert.ok((releaseEvidence.checksumCount || 0) >= 35_000, 'release evidence must include the refreshed checksum count')
assert.equal(releaseEvidence.runtimeMetadataCount, 2, 'release evidence must include Node and Codex runtime metadata')
for (const file of [
  'release/evidence/dystopai-sbom.cdx.json',
  'release/evidence/checksums.sha256',
  'release/evidence/release-evidence.json',
  'release/win-unpacked/Automnia AI Nexus.exe',
  'release/win-unpacked/electron.exe',
  'release/win-unpacked/resources/app.asar',
  'release/win-unpacked/resources/dist/index.html',
  'release/win-unpacked/resources/dist-server/index.cjs',
  'release/win-unpacked/resources/legal/DATA_HANDLING.md',
  'release/win-unpacked/resources/legal/THIRD_PARTY_NOTICES.txt',
]) {
  assertFile(file)
}
for (const directory of [
  'release/win-unpacked/resources/openclaw',
  'release/win-unpacked/resources/openclaw/skills',
  'release/win-unpacked/resources/toolchains/node',
]) {
  assertDirectory(directory)
}

assert.equal(scripts['smoke:dependency-audit-clean'], 'tsx scripts/smoke-dependency-audit-clean.ts')
assertIncludes(productionLedger, [
  'Full `npm audit --json` passed with `0` total vulnerabilities.',
  '`npm run smoke:dependency-audit-clean` passed and reported `dependency audit clean: full=0, production=0`.',
], 'dependency audit ledger evidence')

const draftUrlMatch = betaPlan.match(/Current draft release URL: `([^`]+)`/)
assert.ok(draftUrlMatch, 'beta split plan must record current draft release URL')
const draftUrl = draftUrlMatch[1]
assert.match(draftUrl, /^https:\/\/github\.com\/hotboysupreme12-hash\/Automnia-AI-Nexus\/releases\//)
const sourceChangeInventory = buildSourceChangeInventory()
const sourceContentAnchor = buildSourceContentAnchor(sourceChangeInventory)
const gitReviewAnchor = buildGitReviewAnchor(sourceChangeInventory, sourceContentAnchor)
assert.match(
  gitReviewAnchor.sourceInventorySha256,
  /^[a-f0-9]{64}$/,
  'source inventory SHA-256 must be recorded as a stable review anchor',
)
assert.match(
  gitReviewAnchor.sourceContentSha256,
  /^[a-f0-9]{64}$/,
  'source content SHA-256 must be recorded as a stable review anchor',
)
assert.ok(
  sourceContentAnchor.generatedOutputExclusions.includes('docs/PRIVATE_BETA_REVIEW_HANDOFF.md'),
  'generated handoff document must be excluded from the self-referential content hash',
)
for (const exclusion of [
  'docs/BETA_CODEBASE_SPLIT_PLAN.md',
  'docs/OPTIMIZATION_MEMORY.md',
  'docs/PRODUCTION_HARDENING_LEDGER.md',
]) {
  assert.ok(
    sourceContentAnchor.generatedOutputExclusions.includes(exclusion),
    `${exclusion} must be excluded from the source content hash so ledger updates do not stale the handoff`,
  )
}

const handoff = {
  schema: 1,
  generatedAt: startedAt,
  package: {
    name: packageJson.name,
    version: packageJson.version,
  },
  releasePosture: 'private-beta-non-public-signing',
  draftRelease: {
    title: 'Phase J Beta Readiness Evidence (2026-06-30)',
    tag: 'phase-j-beta-readiness-2026-06-30',
    url: draftUrl,
    uploadedEvidenceZip: normalizePath(evidenceZip),
    uploadedEvidenceZipSha256: evidenceZipSha256,
  },
  canonicalReleaseEvidence: {
    generatedAt: releaseEvidence.generatedAt,
    componentCount: releaseEvidence.componentCount,
    checksumCount: releaseEvidence.checksumCount,
    runtimeMetadataCount: releaseEvidence.runtimeMetadataCount,
  },
  betaGates: {
    phaseJ: 'passed',
    phaseKCompletedItems: [...phaseKCompletedItems].sort((a, b) => a - b),
    phaseMProductionScore: phaseM.productionScore,
    dependencyAudit: 'closed',
  },
  sourceReview: {
    decision: 'ready-for-human-review',
    automationAction: 'no commit, push, tag, or release publish performed',
    rationale: [
      'Phase F-M split-plan work is complete and verified in the source ledgers.',
      'The generated handoff evidence matches the uploaded draft prerelease bundle digest.',
      'The current source-change inventory is captured below for reviewer inspection before sharing.',
    ],
    git: gitReviewAnchor,
    inventory: sourceChangeInventory,
    contentAnchor: sourceContentAnchor,
  },
  phaseKRows,
  reviewerFocus: [
    'Review the uncommitted beta implementation diff and generated evidence before tagging or inviting beta users.',
    'Compare the local evidence zip digest with the draft prerelease asset digest before sharing.',
    'Keep release validation in non-public mode unless signing, notarization, and update-channel evidence are intentionally added.',
  ],
  carriedRisks: [
    'Public signing, notarization, signed update-channel evidence, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain outside this milestone.',
    'Windows packaging logs can briefly lag while electron-builder finishes copying the unpacked tree; wait for project-owned builder processes before release validation.',
    'Real local-state backups skip and record symlink or junction entries instead of following them; affected plugin links may need refresh after restore.',
  ],
  verificationCommands: [
    'npm run smoke:private-beta-handoff',
    'npm run smoke:beta-exit-criteria',
    'npm run smoke:dependency-audit-clean',
    'npm run release:validate',
  ],
  sourceLedgers: [
    'docs/BETA_CODEBASE_SPLIT_PLAN.md',
    'docs/OPTIMIZATION_MEMORY.md',
    'docs/PRODUCTION_HARDENING_LEDGER.md',
  ],
}

const markdown = [
  '# Private Beta Review Handoff',
  '',
  `Generated: ${handoff.generatedAt}`,
  `Package: ${handoff.package.name} ${handoff.package.version}`,
  `Release posture: ${handoff.releasePosture}`,
  '',
  '## Reviewer Focus',
  '',
  ...handoff.reviewerFocus.map((item) => `- ${item}`),
  '',
  '## Release Target',
  '',
  `- Draft prerelease: [${handoff.draftRelease.title}](${handoff.draftRelease.url})`,
  `- Draft release tag: \`${handoff.draftRelease.tag}\``,
  `- Uploaded evidence bundle: \`${handoff.draftRelease.uploadedEvidenceZip}\``,
  `- Uploaded bundle SHA-256: \`${handoff.draftRelease.uploadedEvidenceZipSha256}\``,
  '',
  '## Canonical Evidence',
  '',
  `- Release evidence generated: ${handoff.canonicalReleaseEvidence.generatedAt}`,
  `- SBOM components: ${handoff.canonicalReleaseEvidence.componentCount}`,
  `- Checksum entries: ${handoff.canonicalReleaseEvidence.checksumCount}`,
  `- Runtime metadata entries: ${handoff.canonicalReleaseEvidence.runtimeMetadataCount}`,
  `- Phase M production score: ${handoff.betaGates.phaseMProductionScore}/10`,
  `- Phase K completed items: ${handoff.betaGates.phaseKCompletedItems.join(', ')}`,
  `- Dependency audit: ${handoff.betaGates.dependencyAudit}`,
  '',
  '## Review Decision',
  '',
  `- Status: ${handoff.sourceReview.decision}`,
  `- Automation action: ${handoff.sourceReview.automationAction}`,
  ...handoff.sourceReview.rationale.map((item) => `- ${item}`),
  '',
  '## Git Review Anchor',
  '',
  `- Branch: \`${handoff.sourceReview.git.branch}\``,
  `- HEAD: \`${handoff.sourceReview.git.head}\``,
  `- Upstream: \`${handoff.sourceReview.git.upstreamRef || 'none'}\``,
  `- Upstream HEAD: \`${handoff.sourceReview.git.upstreamHead || 'none'}\``,
  `- Status header: \`${handoff.sourceReview.git.statusHeader}\``,
  `- Tracked content diff shortstat: \`${handoff.sourceReview.git.trackedDiffShortStat}\``,
  `- Source inventory SHA-256: \`${handoff.sourceReview.git.sourceInventorySha256}\``,
  `- Source content SHA-256: \`${handoff.sourceReview.git.sourceContentSha256}\``,
  `- Tracked diff SHA-256: \`${handoff.sourceReview.contentAnchor.trackedDiffSha256}\``,
  `- Tracked diff bytes: ${handoff.sourceReview.contentAnchor.trackedDiffBytes}`,
  `- Tracked files included in content hash: ${handoff.sourceReview.contentAnchor.trackedDiffFileCount}`,
  `- Generated and mutable outputs excluded from content hash: ${handoff.sourceReview.contentAnchor.generatedOutputExclusions.map((file) => `\`${file}\``).join(', ')}`,
  '',
  '## Source Change Inventory',
  '',
  `- Tracked changed files: ${handoff.sourceReview.inventory.trackedCount}`,
  `- Untracked source files: ${handoff.sourceReview.inventory.untrackedCount}`,
  `- Total review files: ${handoff.sourceReview.inventory.totalCount}`,
  '',
  '| Status | Path |',
  '| --- | --- |',
  ...sourceChangeRows([
    ...handoff.sourceReview.inventory.trackedChanges,
    ...handoff.sourceReview.inventory.untrackedFiles,
  ]),
  '',
  '## Untracked Source Content Hashes',
  '',
  '| Path | SHA-256 | Bytes |',
  '| --- | --- | --- |',
  ...sourceFileHashRows(handoff.sourceReview.contentAnchor.untrackedFileHashes),
  '',
  '## Manual Beta Evidence',
  '',
  '| Items | Check | Command | Evidence |',
  '| --- | --- | --- | --- |',
  ...phaseKRows.map((row) => `| ${row.items.join(', ')} | ${row.label} | \`${row.command}\` | \`${row.evidence}\` |`),
  '',
  '## Carried Risks',
  '',
  ...handoff.carriedRisks.map((risk) => `- ${risk}`),
  '',
  '## Verification Commands',
  '',
  ...handoff.verificationCommands.map((command) => `- \`${command}\``),
  '',
  '## Source Ledgers',
  '',
  ...handoff.sourceLedgers.map((source) => `- \`${source}\``),
  '',
].join('\n')

assertNoRawSecretMarkers(JSON.stringify(handoff))
assertNoRawSecretMarkers(markdown)

mkdirSync(HANDOFF_EVIDENCE_DIR, { recursive: true })
writeFileSync(HANDOFF_EVIDENCE_JSON, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8')
writeFileSync(HANDOFF_EVIDENCE_MD, markdown, 'utf8')
writeFileSync(HANDOFF_DOC, markdown, 'utf8')

console.log(
  `private beta handoff ok: ${phaseKCompletedItems.size} Phase K items, score ${phaseM.productionScore}/10, doc ${relativeFromRoot(HANDOFF_DOC)}`,
)
