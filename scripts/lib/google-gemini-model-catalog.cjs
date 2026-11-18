const GOOGLE_GEMINI_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    reasoning: true,
    input: ['text', 'image', 'audio', 'video'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { minimal: null },
    compat: { codeMode: 'preferred' },
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    reasoning: true,
    input: ['text', 'image', 'audio', 'video'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { minimal: null },
    compat: { codeMode: 'preferred' },
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { minimal: null },
    compat: { codeMode: 'preferred' },
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    reasoning: true,
    input: ['text', 'image', 'audio', 'video'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { minimal: null },
    compat: { codeMode: 'preferred' },
  },
]

const LEGACY_INPUTS = {
  'gemini-3.8-flash': [
    ['text', 'image'],
    ['text', 'image', 'video'],
  ],
}

function findMatchingBracket(source, openIndex, openChar, closeChar) {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === openChar) depth += 1
    else if (char === closeChar && --depth === 0) return index
  }
  return -1
}

function normalizeGoogleGeminiModel(model, sourceLabel) {
  const expected = GOOGLE_GEMINI_MODELS.find((entry) => entry.id === model?.id)
  if (!expected) return model
  for (const key of ['name', 'reasoning', 'contextWindow', 'maxTokens']) {
    if (model[key] !== expected[key]) {
      throw new Error(`[openclaw-vendor] ${sourceLabel} ${expected.id} has unexpected ${key}: ${JSON.stringify(model[key])}`)
    }
  }
  const inputMatches = (input) => JSON.stringify(input) === JSON.stringify(expected.input)
  const isKnownLegacyInput = (LEGACY_INPUTS[expected.id] || []).some((input) => JSON.stringify(model.input) === JSON.stringify(input))
  if (!Array.isArray(model.input) || (!inputMatches(model.input) && !isKnownLegacyInput)) {
    throw new Error(`[openclaw-vendor] ${sourceLabel} ${expected.id} input modalities changed unexpectedly`)
  }
  if (model.thinkingLevelMap?.minimal !== null || model.compat?.codeMode !== 'preferred') {
    throw new Error(`[openclaw-vendor] ${sourceLabel} ${expected.id} reasoning/compat metadata changed unexpectedly`)
  }
  return inputMatches(model.input) ? model : { ...model, input: [...expected.input] }
}

function formatDiscoveryModel(model) {
  return JSON.stringify(model, null, '\t')
    .split('\n')
    .map((line) => `\t\t\t${line}`)
    .join('\n')
}

function prepareGoogleGeminiDiscoverySource(source) {
  const modelCatalogStart = source.indexOf('var modelCatalog = {')
  const googleProviderStart = source.indexOf('"providers": { "google": {', modelCatalogStart)
  const modelsToken = source.indexOf('"models": [', googleProviderStart)
  const modelsStart = source.indexOf('[', modelsToken)
  if (modelCatalogStart < 0 || googleProviderStart < 0 || modelsToken < 0 || modelsStart < 0) {
    throw new Error('[openclaw-vendor] Google provider discovery model catalog structure changed')
  }
  const modelsEnd = findMatchingBracket(source, modelsStart, '[', ']')
  if (modelsEnd < 0) throw new Error('[openclaw-vendor] Could not parse Google provider discovery model list')

  const modelArraySource = source.slice(modelsStart, modelsEnd + 1)
  const missing = []
  const patches = []
  for (const expected of GOOGLE_GEMINI_MODELS) {
    const idMarker = `"id": "${expected.id}"`
    const firstIndex = modelArraySource.indexOf(idMarker)
    if (firstIndex >= 0 && modelArraySource.indexOf(idMarker, firstIndex + idMarker.length) >= 0) {
      throw new Error(`[openclaw-vendor] Duplicate ${expected.id} rows in Google provider discovery catalog`)
    }
    if (firstIndex < 0) {
      missing.push(expected)
      continue
    }
    const absoluteIdIndex = modelsStart + firstIndex
    const objectStart = source.lastIndexOf('\n\t\t\t{', absoluteIdIndex)
    const objectEndMarker = source.indexOf('\n\t\t\t},', absoluteIdIndex)
    if (objectStart < 0 || objectStart > modelsEnd || objectEndMarker < 0 || objectEndMarker > modelsEnd) {
      throw new Error(`[openclaw-vendor] Could not safely validate existing ${expected.id} provider discovery row`)
    }
    const objectText = source.slice(objectStart + 1, objectEndMarker + 5)
    let existing
    try {
      existing = JSON.parse(objectText)
    } catch (error) {
      throw new Error(`[openclaw-vendor] Existing ${expected.id} provider discovery row is not JSON-compatible: ${String(error)}`)
    }
    const normalized = normalizeGoogleGeminiModel(existing, 'provider discovery')
    if (normalized !== existing) {
      patches.push({
        start: objectStart + 1,
        end: objectEndMarker + 5,
        text: formatDiscoveryModel(normalized),
      })
    }
  }

  if (missing.length) {
    const anchor = '\n\t\t\t{\n\t\t\t\t"id": "gemini-2.5-pro"'
    const anchorIndex = source.indexOf(anchor, modelsStart)
    if (anchorIndex < 0 || anchorIndex > modelsEnd) {
      throw new Error('[openclaw-vendor] Could not locate stable Google model catalog insertion anchor')
    }
    const formatted = missing.map(formatDiscoveryModel).join(',\n')
    return prepareGoogleGeminiDiscoverySource(source.slice(0, anchorIndex) + `\n${formatted},` + source.slice(anchorIndex))
  }

  for (const patch of patches.sort((left, right) => right.start - left.start)) {
    source = source.slice(0, patch.start) + patch.text + source.slice(patch.end)
  }
  return source
}

function prepareGoogleGeminiDirectVideoBuilder(source) {
  const patched = 'input: e.id === "gemini-4-argon" ? [...e.input] : e.input.includes("video") ? [...e.input] : [...e.input, "video"]'
  if (source.includes(patched)) return source
  const existing = 'input: e.input.includes("video") ? [...e.input] : [...e.input, "video"]'
  const original = 'input: [...e.input, "video"]'
  if (source.includes(existing)) return source.replace(existing, patched)
  if (source.includes(original)) return source.replace(original, patched)
  throw new Error('[openclaw-vendor] Google direct catalog video modality builder changed; refusing broad patch')
}

function prepareGoogleGeminiManifest(manifest) {
  const result = JSON.parse(JSON.stringify(manifest))
  const directProvider = result?.modelCatalog?.providers?.google
  if (directProvider?.api !== 'google-generative-ai' || directProvider?.baseUrl !== 'https://generativelanguage.googleapis.com/v1beta') {
    throw new Error('[openclaw-vendor] Google plugin manifest direct endpoint changed; refusing model-catalog patch')
  }
  const models = directProvider.models
  if (!Array.isArray(models)) throw new Error('[openclaw-vendor] Google plugin manifest model list is missing')
  let changed = false
  const missing = []
  for (const expected of GOOGLE_GEMINI_MODELS) {
    const matches = models.map((model, index) => ({ model, index })).filter(({ model }) => model.id === expected.id)
    if (matches.length > 1) throw new Error(`[openclaw-vendor] Duplicate ${expected.id} rows in Google plugin manifest`)
    if (!matches.length) {
      missing.push(expected)
      continue
    }
    const { model, index } = matches[0]
    const normalized = normalizeGoogleGeminiModel(model, 'plugin manifest')
    if (normalized !== model) {
      models[index] = normalized
      changed = true
    }
  }
  if (missing.length) {
    const anchorIndex = models.findIndex((model) => model.id === 'gemini-2.5-pro')
    if (anchorIndex < 0) throw new Error('[openclaw-vendor] Could not locate stable Google plugin manifest insertion anchor')
    models.splice(anchorIndex, 0, ...missing)
    changed = true
  }
  return { manifest: result, changed }
}

module.exports = {
  GOOGLE_GEMINI_MODELS,
  normalizeGoogleGeminiModel,
  prepareGoogleGeminiDiscoverySource,
  prepareGoogleGeminiDirectVideoBuilder,
  prepareGoogleGeminiManifest,
}
