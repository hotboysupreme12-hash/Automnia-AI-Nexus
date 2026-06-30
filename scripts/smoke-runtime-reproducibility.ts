import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

const packageJson = JSON.parse(read('package.json')) as {
  scripts?: Record<string, string>
}
const prepareRuntimeBundles = read('scripts/prepare-runtime-bundles.cjs')
const prepareOpenClawVendor = read('scripts/prepare-openclaw-vendor.cjs')
const serverIndex = read('server/index.ts')
const serverControlPlane = read('server/controlPlane.ts')

assert.match(
  prepareRuntimeBundles,
  /const DEFAULT_BUNDLED_NODE_VERSION = 'v24\.16\.0'/,
  'bundled Node runtime must default to an exact Node 24 version',
)
assert.match(
  prepareRuntimeBundles,
  /const DEFAULT_BUNDLED_CODEX_VERSION = '2026\.6\.11'/,
  'bundled Codex plugin must default to an exact version',
)
assert.match(
  prepareRuntimeBundles,
  /const DEFAULT_BUNDLED_CODEX_INTEGRITY = 'sha512-[A-Za-z0-9+/=]+'/,
  'bundled Codex plugin must record expected npm integrity',
)
assert.doesNotMatch(
  prepareRuntimeBundles,
  /@openclaw\/codex@latest/,
  'runtime bundle prep must not install @openclaw/codex@latest',
)
assert.match(
  prepareRuntimeBundles,
  /parseExactCodexSpec/,
  'runtime bundle prep must reject non-exact Codex specs',
)
assert.match(
  prepareRuntimeBundles,
  /normalizeExactNodeVersion/,
  'runtime bundle prep must reject non-exact Node versions',
)
assert.match(
  prepareRuntimeBundles,
  /SHASUMS256\.txt/,
  'runtime bundle prep must fetch Node published checksums',
)
assert.match(
  prepareRuntimeBundles,
  /crypto\.createHash\('sha256'\)/,
  'runtime bundle prep must hash downloaded Node archives',
)
assert.match(
  prepareRuntimeBundles,
  /verifyNodeArchiveChecksum/,
  'runtime bundle prep must verify Node archives before extraction',
)
assert.match(
  prepareRuntimeBundles,
  /verifyPackageLockPackage/,
  'runtime bundle prep must verify npm lockfile package metadata',
)
assert.match(
  prepareRuntimeBundles,
  /packageLockPathFor/,
  'runtime bundle prep must accept npm package locks and shrinkwrap locks',
)
assert.match(
  prepareRuntimeBundles,
  /copying locked Codex plugin dependencies/,
  'runtime bundle prep must reuse the locked dependency tree instead of rerunning npm inside the plugin root',
)
assert.match(
  prepareRuntimeBundles,
  /\.dystopai-runtime-package-lock\.json/,
  'runtime bundle prep must preserve the lockfile used for bundled Codex dependencies',
)
assert.match(
  prepareRuntimeBundles,
  /--package-lock=true/,
  'runtime bundle prep must write package locks for runtime installs',
)
assert.match(
  prepareRuntimeBundles,
  /--save-exact/,
  'runtime bundle prep must avoid widening runtime install specs',
)
assert.match(
  prepareRuntimeBundles,
  /\.dystopai-runtime-bundle\.json/,
  'runtime bundle prep must leave verifiable bundle metadata',
)
assert.match(
  prepareOpenClawVendor,
  /npm-shrinkwrap\.json/,
  'vendored OpenClaw dependency prep must install from the published shrinkwrap lockfile',
)
assert.match(
  prepareOpenClawVendor,
  /DYSTOPAI_OPENCLAW_VENDOR_ROOT/,
  'vendored OpenClaw dependency prep must be testable against a temporary vendor root',
)
assert.match(
  prepareOpenClawVendor,
  /DEFAULT_OPENCLAW_PACKAGE_INTEGRITY = 'sha512-/,
  'vendored OpenClaw package hydration must pin the published package integrity',
)
assert.match(
  prepareOpenClawVendor,
  /hydratePublishedPackageArtifacts/,
  'vendored OpenClaw dependency prep must hydrate missing package artifacts before packaging',
)
assert.match(
  prepareOpenClawVendor,
  /path\.join\('dist', 'entry\.js'\)/,
  'vendored OpenClaw dependency prep must require the CLI dist/entry.js artifact',
)
assert.match(
  prepareOpenClawVendor,
  /sriSha512File/,
  'vendored OpenClaw package hydration must verify the package tarball SRI',
)
assert.match(
  prepareOpenClawVendor,
  /'ci'/,
  'vendored OpenClaw dependency prep must use npm ci',
)
assert.match(
  prepareOpenClawVendor,
  /--omit=dev/,
  'vendored OpenClaw dependency prep must omit development dependencies',
)
assert.match(
  prepareOpenClawVendor,
  /--ignore-scripts/,
  'vendored OpenClaw dependency prep must not run package lifecycle scripts during packaging',
)
assert.match(
  prepareOpenClawVendor,
  /sha256File/,
  'vendored OpenClaw dependency prep must record the shrinkwrap checksum',
)
assert.match(
  prepareOpenClawVendor,
  /\.dystopai-openclaw-vendor-deps\.json/,
  'vendored OpenClaw dependency prep must leave verifiable dependency metadata',
)
assert.match(
  packageJson.scripts?.['prepare:openclaw-vendor'] || '',
  /node scripts\/prepare-openclaw-vendor\.cjs/,
  'package scripts must expose vendored OpenClaw dependency preparation',
)
assert.match(
  packageJson.scripts?.['dev:server'] || '',
  /prepare:openclaw-vendor/,
  'fresh-source dev server startup must prepare the vendored OpenClaw runtime first',
)
assert.match(
  packageJson.scripts?.desktop || '',
  /prepare:openclaw-vendor/,
  'fresh-source desktop startup must prepare the vendored OpenClaw runtime first',
)
assert.match(
  packageJson.scripts?.start || '',
  /prepare:openclaw-vendor/,
  'fresh-source backend startup must prepare the vendored OpenClaw runtime first',
)
assert.match(
  serverIndex,
  /import ['"]\.\/controlPlane['"]/,
  'server entrypoint must load the control-plane composition module',
)
assert.match(
  serverControlPlane,
  /prepareSourceOpenClawVendorIfMissing/,
  'server startup must self-heal a source checkout missing ignored OpenClaw package artifacts',
)
assert.match(
  serverControlPlane,
  /hasOpenClawEntryArtifact/,
  'server startup must explicitly check for OpenClaw dist entry artifacts',
)
assert.match(
  serverControlPlane,
  /DYSTOPAI_OPENCLAW_VENDOR_ROOT/,
  'server startup self-heal must run the vendor prep script against the detected vendor root',
)

assert.match(
  packageJson.scripts?.['test:ci'] || '',
  /smoke:runtime-reproducibility/,
  'test:ci must include runtime reproducibility smoke coverage',
)

console.log('runtime reproducibility contract ok')
