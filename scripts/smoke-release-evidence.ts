import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const scripts = packageJson.scripts || {}
const generatorSource = readFileSync(path.join(root, 'scripts/generate-release-evidence.cjs'), 'utf8')

assert.match(generatorSource, /bomFormat:\s*'CycloneDX'/, 'release evidence must emit a CycloneDX SBOM')
assert.match(generatorSource, /specVersion:\s*'1\.5'/, 'release evidence must pin the SBOM spec version')
assert.match(generatorSource, /package-lock\.json/, 'release evidence must derive package components from the lockfile')
assert.match(generatorSource, /\.automnia-runtime-bundle\.json/, 'release evidence must include prepared runtime metadata')
assert.match(generatorSource, /crypto\.createHash\('sha256'\)/, 'release evidence must compute SHA-256 checksums')
assert.match(generatorSource, /checksums\.sha256/, 'release evidence must write a checksum manifest')
assert.match(generatorSource, /distribution-signing\.json/, 'release evidence must include platform distribution signing evidence when present')
assert.match(generatorSource, /AUTOMNIA_RELEASE_EVIDENCE_DIR/, 'release evidence must support a testable evidence directory override')
assert.match(generatorSource, /AUTOMNIA_RELEASE_ARTIFACT_ROOT/, 'release evidence must support a release artifact root override')
assert.match(generatorSource, /AUTOMNIA_RUNTIME_BUNDLE_ROOT/, 'release evidence must support a runtime bundle root override')
assert.match(scripts['release:evidence'] || '', /node scripts\/generate-release-evidence\.cjs/, 'package scripts must expose release evidence generation')
assert.match(scripts['smoke:release-evidence'] || '', /tsx scripts\/smoke-release-evidence\.ts/, 'package scripts must expose release evidence smoke coverage')
assert.match(scripts['test:ci'] || '', /npm run smoke:release-evidence/, 'test:ci must include release evidence smoke coverage')

const tempRoot = mkdtempSync(path.join(tmpdir(), 'automnia-release-evidence-'))
const artifactRoot = path.join(tempRoot, 'release')
const evidenceDir = path.join(tempRoot, 'evidence')
const runtimeRoot = path.join(tempRoot, 'runtime-bundles')
const nodeRuntimeDir = path.join(runtimeRoot, 'toolchains', 'node')
const codexRuntimeDir = path.join(runtimeRoot, 'openclaw-codex', 'codex')

mkdirSync(artifactRoot, { recursive: true })
mkdirSync(nodeRuntimeDir, { recursive: true })
mkdirSync(codexRuntimeDir, { recursive: true })

writeFileSync(path.join(artifactRoot, 'Automnia-test-artifact.txt'), 'artifact\n')
writeFileSync(path.join(nodeRuntimeDir, '.automnia-runtime-bundle.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  node: {
    version: 'v24.16.0',
    archive: 'node-v24.16.0-win-x64.zip',
    sha256: 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56',
    shasumsUrl: 'https://nodejs.org/dist/v24.16.0/SHASUMS256.txt',
  },
}, null, 2)}\n`)
writeFileSync(path.join(codexRuntimeDir, '.automnia-runtime-bundle.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  codex: {
    package: '@openclaw/codex',
    spec: '@openclaw/codex@2026.7.1-1',
    version: '2026.7.1-1',
    integrity: 'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==',
    tarball: 'https://registry.npmjs.org/@openclaw/codex/-/codex-2026.7.1-1.tgz',
    lockfile: '.automnia-runtime-package-lock.json',
    dependencies: {
      '@openai/codex': {
        version: '0.139.0',
        integrity: 'sha512-test-runtime',
      },
      '@openai/codex-win32-x64': {
        version: '0.139.0-win32-x64',
        integrity: 'sha512-test-native',
      },
    },
  },
}, null, 2)}\n`)

const result = spawnSync(process.execPath, ['scripts/generate-release-evidence.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    AUTOMNIA_RELEASE_EVIDENCE_DIR: evidenceDir,
    AUTOMNIA_RELEASE_ARTIFACT_ROOT: artifactRoot,
    AUTOMNIA_RUNTIME_BUNDLE_ROOT: runtimeRoot,
  },
  windowsHide: true,
})

assert.equal(result.status, 0, result.stderr || result.stdout)

const sbomPath = path.join(evidenceDir, 'automnia-sbom.cdx.json')
const checksumsPath = path.join(evidenceDir, 'checksums.sha256')
const summaryPath = path.join(evidenceDir, 'release-evidence.json')

assert.ok(existsSync(sbomPath), 'release evidence must write a CycloneDX SBOM')
assert.ok(existsSync(checksumsPath), 'release evidence must write SHA-256 checksums')
assert.ok(existsSync(summaryPath), 'release evidence must write a machine-readable summary')

const sbom = JSON.parse(readFileSync(sbomPath, 'utf8')) as {
  bomFormat: string
  specVersion: string
  components: Array<{ name?: string; version?: string; hashes?: Array<{ alg?: string; content?: string }> }>
}
const checksums = readFileSync(checksumsPath, 'utf8')
const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
  componentCount: number
  checksumCount: number
  runtimeMetadataCount: number
}

assert.equal(sbom.bomFormat, 'CycloneDX')
assert.equal(sbom.specVersion, '1.5')
assert.ok(sbom.components.some((component) => component.name === 'react'), 'SBOM must include lockfile dependencies')
assert.ok(sbom.components.some((component) => component.name === 'node' && component.hashes?.some((hash) => hash.alg === 'SHA-256')), 'SBOM must include hashed Node runtime metadata')
assert.ok(sbom.components.some((component) => component.name === '@openclaw/codex' && component.version === '2026.7.1-1'), 'SBOM must include bundled Codex runtime metadata')
assert.ok(sbom.components.some((component) => component.name === '@openai/codex-win32-x64'), 'SBOM must include native Codex runtime dependency metadata')
assert.match(checksums, /Automnia-test-artifact\.txt/, 'checksum manifest must include release artifacts')
assert.match(checksums, /automnia-sbom\.cdx\.json/, 'checksum manifest must include the generated SBOM')
assert.ok(summary.componentCount >= 4, 'release evidence summary must count generated SBOM components')
assert.ok(summary.checksumCount >= 4, 'release evidence summary must count checksummed inputs')
assert.equal(summary.runtimeMetadataCount, 2, 'release evidence summary must count runtime metadata files')

console.log('release evidence contract ok')
