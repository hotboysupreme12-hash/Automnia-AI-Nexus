import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import {
  appendFileSync,
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
const validatorSource = readFileSync(path.join(root, 'scripts/validate-release-artifacts.cjs'), 'utf8')
const workflowSource = readFileSync(path.join(root, '.github/workflows/control-plane-ci.yml'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')

assert.match(validatorSource, /parseChecksumManifest/, 'release validation must parse the checksum manifest')
assert.match(validatorSource, /sha256File/, 'release validation must recompute artifact checksums')
assert.match(validatorSource, /artifactCount < 1/, 'release validation must require packaged artifacts by default')
assert.match(validatorSource, /crypto\.verify\(null, checksums, publicKey, signature\)/, 'release validation must verify release signatures when present')
assert.match(validatorSource, /DYSTOPAI_RELEASE_VALIDATE_ALLOW_NO_ARTIFACTS/, 'release validation must provide an explicit no-artifact escape hatch')
assert.match(scripts['release:validate'] || '', /node scripts\/validate-release-artifacts\.cjs/, 'package scripts must expose release validation')
assert.match(scripts['smoke:release-validation'] || '', /tsx scripts\/smoke-release-validation\.ts/, 'package scripts must expose release validation smoke coverage')
assert.match(scripts['test:ci'] || '', /npm run smoke:release-validation/, 'test:ci must include release validation smoke coverage')
assert.match(workflowSource, /node scripts\/package-desktop\.cjs --dir/, 'CI must package the desktop directory before release evidence')
assert.match(workflowSource, /npm run release:validate/, 'CI must validate packaged release artifacts')
assert.match(readme, /npm run release:validate/, 'README must document release validation')

function run(command: string, args: string[], env: NodeJS.ProcessEnv, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  })
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout)
  return result
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'dystopai-release-validation-'))
const artifactRoot = path.join(tempRoot, 'release')
const evidenceDir = path.join(artifactRoot, 'evidence')
const runtimeRoot = path.join(tempRoot, 'runtime-bundles')
const nodeRuntimeDir = path.join(runtimeRoot, 'toolchains', 'node')
const codexRuntimeDir = path.join(runtimeRoot, 'openclaw-codex', 'codex')
const env = {
  DYSTOPAI_RELEASE_ARTIFACT_ROOT: artifactRoot,
  DYSTOPAI_RELEASE_EVIDENCE_DIR: evidenceDir,
  DYSTOPAI_RUNTIME_BUNDLE_ROOT: runtimeRoot,
}

mkdirSync(path.join(artifactRoot, 'win-unpacked'), { recursive: true })
mkdirSync(nodeRuntimeDir, { recursive: true })
mkdirSync(codexRuntimeDir, { recursive: true })
writeFileSync(path.join(artifactRoot, 'win-unpacked', 'DystopAI.exe'), 'packaged-app-binary-placeholder\n')
writeFileSync(path.join(nodeRuntimeDir, '.dystopai-runtime-bundle.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  node: {
    version: 'v24.16.0',
    archive: 'node-v24.16.0-win-x64.zip',
    sha256: 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56',
    shasumsUrl: 'https://nodejs.org/dist/v24.16.0/SHASUMS256.txt',
  },
}, null, 2)}\n`)
writeFileSync(path.join(codexRuntimeDir, '.dystopai-runtime-bundle.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  codex: {
    package: '@openclaw/codex',
    spec: '@openclaw/codex@2026.6.10',
    version: '2026.6.10',
    integrity: 'sha512-0M5FsRb3IxsJ/xb2U1eMOZL/7w9W27tnzhSANY7JbbCRhz1+v7WUE6uS3YRWoTKv/9sNx9MAJXFntCK8MpWKYQ==',
    tarball: 'https://registry.npmjs.org/@openclaw/codex/-/codex-2026.6.10.tgz',
    lockfile: '.dystopai-runtime-package-lock.json',
    dependencies: {
      '@openai/codex': {
        version: '0.139.0',
        integrity: 'sha512-test-runtime',
      },
    },
  },
}, null, 2)}\n`)

run(process.execPath, ['scripts/generate-release-evidence.cjs'], env)
let validation = run(process.execPath, ['scripts/validate-release-artifacts.cjs'], env)
assert.match(validation.stdout, /verified \d+ checksum\(s\)/)
assert.match(validation.stdout, /verified \d+ packaged artifact file\(s\)/)
assert.match(validation.stdout, /no signing evidence present/)

const { privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
run(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  ...env,
  DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
  DYSTOPAI_RELEASE_SIGNING_KEY_ID: 'validation-smoke-key',
})
validation = run(process.execPath, ['scripts/validate-release-artifacts.cjs'], env)
assert.match(validation.stdout, /verified Ed25519 checksum signature/)
assert.match(validation.stdout, /validation-smoke-key/)

appendFileSync(path.join(artifactRoot, 'win-unpacked', 'DystopAI.exe'), 'tampered\n')
const tampered = spawnSync(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...env },
  windowsHide: true,
})
assert.notEqual(tampered.status, 0, 'release validation must fail when a packaged artifact changes after evidence generation')
assert.match(tampered.stderr, /sha256 mismatch/, 'release validation must report checksum mismatches')

console.log('release validation contract ok')
