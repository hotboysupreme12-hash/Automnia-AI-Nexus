import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const googlePluginRoot = path.join(root, 'vendor', 'openclaw', 'dist', 'extensions', 'google')
const discoveryPath = path.join(googlePluginRoot, 'provider-discovery.js')
const catalogPatch = require('./lib/google-gemini-model-catalog.cjs')
const originalDiscoverySource = readFileSync(discoveryPath, 'utf8')
const discoverySource = catalogPatch.prepareGoogleGeminiDirectVideoBuilder(
  catalogPatch.prepareGoogleGeminiDiscoverySource(originalDiscoverySource),
)
assert.equal(
  catalogPatch.prepareGoogleGeminiDirectVideoBuilder(catalogPatch.prepareGoogleGeminiDiscoverySource(discoverySource)),
  discoverySource,
  'Google Gemini provider discovery patch should be idempotent',
)
const vendorRoot = path.join(root, 'vendor', 'openclaw')

function replaceBareSdkImport(source, specifier, packagePath) {
  const bare = `from "openclaw/plugin-sdk/${specifier}"`
  assert.ok(source.includes(bare), `provider discovery should import the expected ${specifier} SDK entry`)
  return source.replace(bare, `from "${pathToFileURL(path.join(vendorRoot, 'dist', 'plugin-sdk', packagePath)).href}"`)
}

const executableDiscoverySource = replaceBareSdkImport(
  replaceBareSdkImport(
    replaceBareSdkImport(discoverySource, 'provider-model-metadata', 'provider-model-metadata.js'),
    'secret-file-runtime',
    'secret-file-runtime.js',
  ),
  'string-coerce-runtime',
  'string-coerce-runtime.js',
)
const discoveryDataUrl = `data:text/javascript;base64,${Buffer.from(executableDiscoverySource).toString('base64')}`
const { default: googleDiscovery } = await import(discoveryDataUrl)
const catalogResult = await googleDiscovery.staticCatalog.run()
const direct = catalogResult.providers.google
const vertex = catalogResult.providers['google-vertex']
assert.ok(direct, 'Google AI Studio static provider catalog should be registered')
assert.ok(vertex, 'Google Vertex static provider catalog should be registered')
assert.equal(direct.api, 'google-generative-ai')
assert.equal(direct.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')
assert.equal(vertex.api, 'google-vertex')
assert.equal(vertex.baseUrl, 'https://{location}-aiplatform.googleapis.com')

const expectedModels = [
  { id: 'gemini-3.8-flash', input: ['text', 'image', 'audio', 'video'] },
  { id: 'gemini-4-hydrogen', input: ['text', 'image', 'audio', 'video'] },
  { id: 'gemini-4-argon', input: ['text', 'image'] },
  { id: 'gemini-4-carbon', input: ['text', 'image', 'audio', 'video'] },
]
assert.deepEqual(
  catalogPatch.normalizeGoogleGeminiModel({
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    thinkingLevelMap: { minimal: null },
    compat: { codeMode: 'preferred' },
  }, 'legacy fixture').input,
  expectedModels[0].input,
  'legacy Gemini 3.8 Flash metadata should gain its documented audio/video modalities',
)
const oldBuilderFixture = 'models: rows.map((e) => ({ input: [...e.input, "video"] }))'
const patchedBuilderFixture = catalogPatch.prepareGoogleGeminiDirectVideoBuilder(oldBuilderFixture)
assert.match(patchedBuilderFixture, /e\.id === "gemini-4-argon"/)
assert.equal(catalogPatch.prepareGoogleGeminiDirectVideoBuilder(patchedBuilderFixture), patchedBuilderFixture)
for (const [providerId, provider] of [['google', direct], ['google-vertex', vertex]]) {
  for (const expected of expectedModels) {
    const rows = provider.models.filter((model) => model.id === expected.id)
    assert.equal(rows.length, 1, `${providerId} catalog should expose exactly one ${expected.id} row`)
    const model = rows[0]
    assert.equal(model.reasoning, true, `${providerId}/${expected.id} should be marked as a reasoning model`)
    assert.deepEqual(model.input, expected.input, `${providerId}/${expected.id} should expose its supported input modalities`)
    assert.equal(model.contextWindow, 1_048_576, `${providerId}/${expected.id} should expose the unified 1M context limit`)
    assert.equal(model.maxTokens, 65_536, `${providerId}/${expected.id} should expose the synchronous streaming output cap`)
    assert.equal(model.thinkingLevelMap?.minimal, null, `${providerId}/${expected.id} should omit Google's unsupported MINIMAL thinking level`)
    assert.equal(model.compat?.codeMode, 'preferred')
  }
}

const { DEFAULT_MODEL, patchGoogleGeminiOnboardingDefault } = require('./lib/google-gemini-onboarding-default.cjs')
const onboardingFixture = [
  'const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-4-argon";',
  'if (model === "google/gemini-4-argon" && !hasRetiredGeminiDefaultModelRefs(e)) return unchanged;',
].join('\n')
const patchedOnboardingFixture = patchGoogleGeminiOnboardingDefault(onboardingFixture)
assert.equal(DEFAULT_MODEL, 'google/gemini-4-hydrogen')
assert.match(patchedOnboardingFixture, /const GOOGLE_GEMINI_DEFAULT_MODEL = "google\/gemini-4-hydrogen";/)
assert.match(patchedOnboardingFixture, /=== "google\/gemini-4-hydrogen" && !hasRetiredGeminiDefaultModelRefs\(e\)/)
assert.equal(patchGoogleGeminiOnboardingDefault(patchedOnboardingFixture), patchedOnboardingFixture, 'Google onboarding default patch should be idempotent')

const originalManifest = JSON.parse(readFileSync(path.join(googlePluginRoot, 'openclaw.plugin.json'), 'utf8'))
const { manifest, changed: manifestChanged } = catalogPatch.prepareGoogleGeminiManifest(originalManifest)
assert.ok(typeof manifestChanged === 'boolean')
assert.equal(catalogPatch.prepareGoogleGeminiManifest(manifest).changed, false, 'Google Gemini manifest patch should be idempotent')
const legacyManifestFixture = JSON.parse(JSON.stringify(originalManifest))
legacyManifestFixture.modelCatalog.providers.google.models.find((model) => model.id === 'gemini-3.8-flash').input = ['text', 'image']
const normalizedLegacyManifest = catalogPatch.prepareGoogleGeminiManifest(legacyManifestFixture)
assert.equal(normalizedLegacyManifest.changed, true, 'legacy manifest metadata should be upgraded')
assert.deepEqual(
  normalizedLegacyManifest.manifest.modelCatalog.providers.google.models.find((model) => model.id === 'gemini-3.8-flash').input,
  expectedModels[0].input,
)
for (const expected of expectedModels) {
  const row = manifest.modelCatalog.providers.google.models.find((model) => model.id === expected.id)
  assert.ok(row, `Google plugin manifest should expose ${expected.id} for provider registration`)
  assert.deepEqual(row.input, expected.input, `Google plugin manifest should retain ${expected.id} input support`)
}
assert.equal(manifest.modelCatalog.providers.google.baseUrl, direct.baseUrl, 'Google direct manifest must retain its v1beta endpoint')

const distRoot = path.join(vendorRoot, 'dist')
const transportName = readdirSync(distRoot)
  .find((name) => name.startsWith('transport-stream-') && name.endsWith('.mjs'))
assert.ok(transportName, 'Google transport bundle should exist')
const transport = readFileSync(path.join(distRoot, transportName), 'utf8')
assert.ok(transport.includes('const GOOGLE_VERTEX_DEFAULT_API_VERSION = "v1";'), 'Vertex transport must keep API version v1')
assert.ok(transport.includes('${GOOGLE_VERTEX_DEFAULT_API_VERSION}/projects/${e}/locations/${t}/publishers/google/models/${n}:streamGenerateContent?alt=sse'), 'Vertex requests must retain the aiplatform v1 publisher model route')
assert.ok(transport.includes('${normalizeGoogleApiBaseUrl(i.baseUrl)}/${resolveGoogleModelPath(i.id)}:streamGenerateContent?alt=sse'), 'direct requests must continue using the configured generativelanguage base URL')

console.log('Google Gemini 3.8 Flash and Gemini 4 Hydrogen/Argon/Carbon OpenClaw catalog and endpoint contracts ok')
