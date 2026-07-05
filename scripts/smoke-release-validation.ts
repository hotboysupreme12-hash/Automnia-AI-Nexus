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
const publicReleaseWorkflow = readFileSync(path.join(root, '.github/workflows/public-release.yml'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')

assert.match(validatorSource, /parseChecksumManifest/, 'release validation must parse the checksum manifest')
assert.match(validatorSource, /sha256File/, 'release validation must recompute artifact checksums')
assert.match(validatorSource, /artifactCount < 1/, 'release validation must require packaged artifacts by default')
assert.match(validatorSource, /crypto\.verify\(null, checksums, publicKey, signature\)/, 'release validation must verify release signatures when present')
assert.match(validatorSource, /DYSTOPAI_RELEASE_VALIDATE_ALLOW_NO_ARTIFACTS/, 'release validation must provide an explicit no-artifact escape hatch')
assert.match(validatorSource, /AUTOMNIA_RELEASE_REQUIRE_SIGNING/, 'release validation must support mandatory public-release signing')
assert.match(validatorSource, /distribution-signing\.json/, 'release validation must require consumer distribution signing evidence for public builds')
assert.match(validatorSource, /authenticode/, 'release validation must require Windows Authenticode evidence for public Windows builds')
assert.match(validatorSource, /validateUpdateChannelIfPresent/, 'release validation must cryptographically verify the signed update channel')
assert.match(validatorSource, /rollbackTested/, 'release validation must require signed update rollback evidence')
assert.match(validatorSource, /freshInstall.*upgrade.*uninstall.*corruptedUpdate/, 'release validation must require install, upgrade, uninstall, and corrupted-update test evidence')
assert.match(scripts['release:validate'] || '', /node scripts\/validate-release-artifacts\.cjs/, 'package scripts must expose release validation')
assert.match(scripts['smoke:release-validation'] || '', /tsx scripts\/smoke-release-validation\.ts/, 'package scripts must expose release validation smoke coverage')
assert.match(scripts['test:ci'] || '', /npm run smoke:release-validation/, 'test:ci must include release validation smoke coverage')
assert.match(workflowSource, /node scripts\/package-desktop\.cjs --dir/, 'CI must package the desktop directory before release evidence')
assert.match(publicReleaseWorkflow, /tags:[\s\S]*'v\*'/, 'version tags must use the dedicated public release workflow')
assert.match(publicReleaseWorkflow, /AUTOMNIA_RELEASE_REQUIRE_SIGNING/, 'public release CI must pass the mandatory release-signing policy into validation')
assert.match(publicReleaseWorkflow, /AUTOMNIA_UPDATE_REQUIRE_SIGNING/, 'public release CI must require signed update manifests')
assert.match(workflowSource, /npm run release:validate/, 'CI must validate packaged release artifacts')
assert.match(readme, /npm run release:validate/, 'README must document release validation')
assert.match(readme, /AUTOMNIA_RELEASE_REQUIRE_SIGNING/, 'README must document mandatory public-release signing validation')
assert.match(readme, /distribution-signing\.json/, 'README must document consumer distribution signing evidence')

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
writeFileSync(path.join(artifactRoot, 'win-unpacked', 'Automnia AI Nexus.exe'), 'packaged-app-binary-placeholder\n')
writeFileSync(path.join(artifactRoot, 'Automnia AI Nexus-Setup-0.0.6.exe'), 'windows-installer-placeholder\n')
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
    spec: '@openclaw/codex@2026.6.11',
    version: '2026.6.11',
    integrity: 'sha512-L9rO95x0DW7rpVJisPv2kkgwr04nKYAA1xbgDXVAm2oh801BCJFIJFo021bvhPmwo7MTAXNcuchO3laGa30QRQ==',
    tarball: 'https://registry.npmjs.org/@openclaw/codex/-/codex-2026.6.11.tgz',
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

const unsignedPublicRelease = spawnSync(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...env, AUTOMNIA_RELEASE_REQUIRE_SIGNING: '1' },
  windowsHide: true,
})
assert.notEqual(unsignedPublicRelease.status, 0, 'public release validation must fail when signing evidence is absent')
assert.match(unsignedPublicRelease.stderr, /Release signing evidence is required/, 'public release validation must explain missing signing evidence')

const { privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
run(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
  AUTOMNIA_RELEASE_SIGNING_KEY_ID: 'validation-smoke-key',
})
validation = run(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_REQUIRE_SIGNING: '1',
}, 1)
assert.match(validation.stderr, /signed update manifest/i, 'public release validation must require a cryptographically signed update channel after checksum signing exists')

run(process.execPath, ['scripts/generate-update-manifest.cjs'], {
  ...env,
  DYSTOPAI_UPDATE_OUTPUT_DIR: path.join(artifactRoot, 'updates'),
  AUTOMNIA_UPDATE_REQUIRE_SIGNING: '1',
  AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM: privatePem,
  AUTOMNIA_UPDATE_SIGNING_KEY_ID: 'update-validation-smoke-key',
})
run(process.execPath, ['scripts/generate-release-evidence.cjs'], env)
run(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
  AUTOMNIA_RELEASE_SIGNING_KEY_ID: 'validation-smoke-key',
})
validation = run(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_REQUIRE_SIGNING: '1',
}, 1)
assert.match(validation.stderr, /Distribution signing evidence is required/, 'public release validation must require consumer distribution evidence after update signing exists')

writeFileSync(path.join(evidenceDir, 'distribution-signing.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  artifacts: [
    {
      platform: 'windows',
  artifact: path.relative(root, path.join(artifactRoot, 'Automnia AI Nexus-Setup-0.0.6.exe')).replace(/\\/g, '/'),
      signing: {
        type: 'authenticode',
        status: 'verified',
        signer: 'DystopAI Release Test Certificate',
        thumbprint: '0123456789abcdef0123456789abcdef01234567',
        timestamp: '2026-06-24T00:00:00.000Z',
  verificationCommand: 'signtool verify /pa /tw "Automnia AI Nexus-Setup-0.0.6.exe"',
      },
    },
  ],
  updateChannel: {
    signed: true,
    rollbackTested: true,
    verificationCommand: 'verify signed update manifest and rollback marker',
  },
  installTests: {
    freshInstall: { status: 'passed', evidence: 'fresh install smoke log' },
    upgrade: { status: 'passed', evidence: 'upgrade smoke log' },
    uninstall: { status: 'passed', evidence: 'uninstall smoke log' },
    corruptedUpdate: { status: 'passed', evidence: 'corrupted update rollback smoke log' },
  },
}, null, 2)}\n`)

run(process.execPath, ['scripts/generate-release-evidence.cjs'], env)
run(process.execPath, ['scripts/sign-release-evidence.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
  AUTOMNIA_RELEASE_SIGNING_KEY_ID: 'validation-smoke-key',
})
validation = run(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  ...env,
  AUTOMNIA_RELEASE_REQUIRE_SIGNING: '1',
})
assert.match(validation.stdout, /verified signed update manifest/)
assert.match(validation.stdout, /verified Ed25519 checksum signature/)
assert.match(validation.stdout, /validation-smoke-key/)
assert.match(validation.stdout, /verified distribution signing evidence/)

appendFileSync(path.join(artifactRoot, 'win-unpacked', 'Automnia AI Nexus.exe'), 'tampered\n')
const tampered = spawnSync(process.execPath, ['scripts/validate-release-artifacts.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...env },
  windowsHide: true,
})
assert.notEqual(tampered.status, 0, 'release validation must fail when a packaged artifact changes after evidence generation')
assert.match(tampered.stderr, /sha256 mismatch/, 'release validation must report checksum mismatches')

console.log('release validation contract ok')
