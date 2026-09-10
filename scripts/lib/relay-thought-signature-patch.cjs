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

function ensureRelayThoughtSignatureReplay(vendorRoot) {
  const dist = path.join(vendorRoot, 'node_modules', '@openclaw', 'ai', 'dist')
  const candidates = fs.readdirSync(dist).filter((name) => /^openai-completions-stream-.*\.mjs$/.test(name))
  if (!candidates.length) throw new Error('Missing OpenAI completions runtime for signature replay patch')
  for (const name of candidates) {
    const file = path.join(dist, name)
    const source = fs.readFileSync(file, 'utf8')
    const patched = patchRelayThoughtSignatureSource(source)
    if (patched !== source) fs.writeFileSync(file, patched)
  }
}

module.exports = { ensureRelayThoughtSignatureReplay, patchRelayThoughtSignatureSource }
