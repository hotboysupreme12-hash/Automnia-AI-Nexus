import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const googlePluginRoot = path.join(root, 'vendor', 'openclaw', 'dist', 'extensions', 'google')
const discoveryPath = path.join(googlePluginRoot, 'provider-discovery.js')
const discoverySource = readFileSync(discoveryPath, 'utf8')
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

const expectedIds = ['gemini-4-hydrogen', 'gemini-4-carbon']
for (const [providerId, provider] of [['google', direct], ['google-vertex', vertex]]) {
  for (const id of expectedIds) {
    const rows = provider.models.filter((model) => model.id === id)
    assert.equal(rows.length, 1, `${providerId} catalog should expose exactly one ${id} row`)
    const model = rows[0]
    assert.equal(model.reasoning, true, `${providerId}/${id} should be marked as a reasoning model`)
    assert.deepEqual(model.input, ['text', 'image', 'audio', 'video'], `${providerId}/${id} should expose all supported input modalities`)
    assert.equal(model.contextWindow, 1_048_576, `${providerId}/${id} should expose the unified 1M context limit`)
    assert.equal(model.maxTokens, 65_536, `${providerId}/${id} should expose the synchronous streaming output cap`)
    assert.equal(model.thinkingLevelMap?.minimal, null, `${providerId}/${id} should omit Google's unsupported MINIMAL thinking level`)
    assert.equal(model.compat?.codeMode, 'preferred')
  }
}

const manifest = JSON.parse(readFileSync(path.join(googlePluginRoot, 'openclaw.plugin.json'), 'utf8'))
for (const id of expectedIds) {
  const row = manifest.modelCatalog.providers.google.models.find((model) => model.id === id)
  assert.ok(row, `Google plugin manifest should expose ${id} for provider registration`)
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

console.log('Google Gemini 4 Hydrogen/Carbon OpenClaw catalog and endpoint contracts ok')
