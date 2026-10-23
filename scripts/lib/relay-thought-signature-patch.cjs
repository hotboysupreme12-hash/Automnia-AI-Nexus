const fs = require('node:fs')
const path = require('node:path')

const marker = 'Automnia: replay opaque Gemini tool signatures'

function patchRelayThoughtSignatureSource(source) {
  if (source.includes(marker)) return source
  const anchor = 'arguments: JSON.stringify(toolCall.arguments)'
  if (!source.includes(anchor)) throw new Error('OpenAI tool-call serializer changed; cannot apply signature replay patch')
  return source.replace(anchor, `${anchor},
                        // ${marker} through the billing relay.
                        ...(model.provider === "automnia-cloud" && typeof toolCall.thoughtSignature === "string" && toolCall.thoughtSignature.trim()
                          ? { thought_signature: toolCall.thoughtSignature }
                          : {})`)
}

function patchRelayRetrySafetySource(source) {
  const retryMarker = 'Automnia: stable Relay idempotency key'
  if (source.includes(retryMarker)) return source
  if (!/function buildOpenAISdkClientOptions\(model\) \{[\s\S]*?maxRetries: 0/.test(source)) {
    throw new Error('OpenAI SDK retry guard changed; cannot safely patch Relay retry behavior')
  }
  const firstImport = /^import [^\r\n]+;\r?\n/m.exec(source)
  if (!firstImport) throw new Error('OpenAI request header module imports changed; cannot add Relay idempotency key')
  source = source.slice(0, firstImport.index + firstImport[0].length) + 'import { createHash } from "node:crypto";\n' + source.slice(firstImport.index + firstImport[0].length)

  const headerReturn = '\treturn resolveOpencodeSessionHeaders(model, {\n\t\tsessionId,\n\t\theaders: resolvedHeaders\n\t}) ?? resolvedHeaders;'
  if (!source.includes(headerReturn)) throw new Error('OpenAI request header builder changed; cannot add Relay idempotency key')
  const idempotencyGuard = `\tif (model.provider === "automnia-cloud" && !Object.keys(resolvedHeaders).some((key) => ["idempotency-key", "x-request-id"].includes(normalizeLowercaseStringOrEmpty(key)))) {
\t\tconst requestSeed = JSON.stringify({
\t\t\tsessionId: sessionId ?? "",
\t\t\tprovider: model.provider,
\t\t\tapi: model.api,
\t\t\tbaseUrl: model.baseUrl,
\t\t\tmodel: model.id,
\t\t\tsystemPrompt: context.systemPrompt ?? "",
\t\t\tmessages: context.messages ?? []
\t\t});
\t\t// ${retryMarker} across retries of one hosted turn.
\t\tresolvedHeaders["Idempotency-Key"] = \`automnia-\${createHash("sha256").update(requestSeed).digest("hex")}\`;
\t}
`
  source = source.replace(headerReturn, `${idempotencyGuard}${headerReturn}`)
  return source
}

function ensureRelayAiTransportCompatibility(vendorRoot) {
  const dist = path.join(vendorRoot, 'node_modules', '@openclaw', 'ai', 'dist')
  const candidates = fs.readdirSync(dist).filter((name) => /^openai-completions-transport-.*\.mjs$/.test(name))
  if (!candidates.length) throw new Error('Missing OpenAI completions transport for signature replay patch')
  for (const name of candidates) {
    const file = path.join(dist, name)
    const source = fs.readFileSync(file, 'utf8')
    const patched = patchRelayThoughtSignatureSource(source)
    if (patched !== source) fs.writeFileSync(file, patched)
  }

  const sharedCandidates = fs.readdirSync(dist).filter((name) => /^openai-responses-shared-.*\.mjs$/.test(name))
  if (!sharedCandidates.length) throw new Error('Missing OpenAI request header runtime for Relay idempotency patch')
  let retrySafetyPatched = false
  for (const name of sharedCandidates) {
    const file = path.join(dist, name)
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes('function buildOpenAIClientHeaders(')) continue
    const patched = patchRelayRetrySafetySource(source)
    if (patched !== source) fs.writeFileSync(file, patched)
    retrySafetyPatched = true
  }
  if (!retrySafetyPatched) throw new Error('Missing OpenAI request header builder for Relay idempotency patch')
}

module.exports = {
  ensureRelayAiTransportCompatibility,
  patchRelayRetrySafetySource,
  patchRelayThoughtSignatureSource,
}
