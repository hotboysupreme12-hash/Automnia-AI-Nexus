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

assert.match(
  prepareRuntimeBundles,
  /const DEFAULT_BUNDLED_NODE_VERSION = 'v24\.16\.0'/,
  'bundled Node runtime must default to an exact Node 24 version',
)
assert.match(
  prepareRuntimeBundles,
  /const DEFAULT_BUNDLED_CODEX_VERSION = '2026\.6\.10'/,
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
  packageJson.scripts?.['test:ci'] || '',
  /smoke:runtime-reproducibility/,
  'test:ci must include runtime reproducibility smoke coverage',
)

console.log('runtime reproducibility contract ok')
