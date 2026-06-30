import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AUTH_ENV_MAP, AUTH_PROVIDER_CATALOG } from '../../catalogs/providerCatalog'

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/

export type PluginConfigField = {
  key: string
  label: string
  path?: string
  envVar?: string
  providerId?: string
  secret: boolean
  required: boolean
  present: boolean
  acceptsDirectSave: boolean
  help?: string
}

export type PluginControlEntry = {
  id: string
  name: string
  description: string
  icon?: string
  systemImage?: string
  packageName?: string
  installSpec?: string
  origin: string
  status: string
  enabled: boolean
  configuredEnabled: boolean | null
  runtimeLoaded?: boolean
  managed?: boolean
  category: string
  commands: string[]
  providers: string[]
  channels: string[]
  missingDependencies: string[]
  configFields: PluginConfigField[]
  guidance: string[]
  needsSetup: boolean
  restartRequired: boolean
}

export type PluginRuntimeState = {
  secrets?: Record<string, Record<string, string>>
  managed?: Record<string, { enabled: boolean; updatedAt: string }>
  installs?: Record<string, {
    pluginId: string
    spec: string
    source: string
    packageName?: string
    version?: string
    enabled: boolean
    installedAt: string
    updatedAt: string
    stateRoot: string
    configPath: string
    openclawBin: string
    installedBy: 'control-center'
  }>
}

export type PluginInventoryOpenClawPluginEntry = {
  enabled?: boolean
  config?: unknown
  apiKey?: unknown
  [key: string]: unknown
}

export type PluginInventoryOpenClawConfig = {
  plugins?: {
    enabled?: boolean
    allow?: unknown
    deny?: unknown
    entries?: Record<string, PluginInventoryOpenClawPluginEntry>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type PluginListCacheEntry = {
  rawPlugins: Record<string, unknown>[]
  cliError?: string
  refreshedAt: number
  expiresAt: number
  source: 'openclaw' | 'bundled'
}

export type PluginListResult = PluginListCacheEntry & {
  refreshing: boolean
}

export type PluginControlsPayload = {
  plugins: PluginControlEntry[]
  configPath: string
  cache: {
    source: PluginListResult['source']
    refreshedAt: number
    refreshing: boolean
  }
  cliError?: string
}

type RunOpenClawResult = {
  stdout: string
  stderr: string
  code: number
}

export type PluginInventoryServiceOptions = {
  cacheMs?: number
  configPath: string
  listCachePath: string
  openclawBin: string
  pluginListCacheStateKey: string
  providerAuthStatus: (providerId: string) => { configured?: boolean }
  readControlCenterStateRecord: <T>(stateKey: string) => T | null
  readOpenclawConfig: () => Promise<PluginInventoryOpenClawConfig>
  readPluginRuntimeState: () => Promise<PluginRuntimeState>
  redactSensitiveText: (value: string) => string
  runOpenClaw: (args: string[], timeoutMs: number) => Promise<RunOpenClawResult>
  warn?: (message: string, error: unknown) => void
  workspaceRoot: string
  writeControlCenterStateRecord: (stateKey: string, value: unknown, sourcePath?: string) => boolean
}

export type PluginInventoryService = {
  getPluginList: (options?: { forceRefresh?: boolean }) => Promise<PluginListResult>
  listPluginControls: (options?: { forceRefresh?: boolean }) => Promise<PluginControlsPayload>
  refreshPluginListCache: () => Promise<PluginListCacheEntry>
}

export const PLUGIN_CATALOG: Record<string, { name: string; description: string; category: string }> = {
  browser: {
    name: 'Browser Control',
    description: 'Chrome and browser automation relay for web tasks.',
    category: 'automation',
  },
  codex: {
    name: 'Codex',
    description: 'OpenClaw Codex app-server harness and Codex-managed model provider.',
    category: 'providers',
  },
  clawtalk: {
    name: 'ClawTalk',
    description: 'Voice, SMS, missions, and approval integrations.',
    category: 'communications',
  },
  'memory-core': {
    name: 'Memory Core',
    description: 'Local memory indexing and recall for agents.',
    category: 'memory',
  },
  openai: {
    name: 'OpenAI Provider',
    description: 'OpenAI and Codex model provider integration.',
    category: 'providers',
  },
  deepseek: {
    name: 'DeepSeek Provider',
    description: 'DeepSeek model provider integration.',
    category: 'providers',
  },
  google: {
    name: 'Google Provider',
    description: 'Google Gemini, Vertex, media, and search provider integration.',
    category: 'providers',
  },
}

const DEFAULT_PLUGIN_LIST_CACHE_MS = 12 * 60 * 60 * 1000
const OFFICIAL_EXTERNAL_CATALOG_FILES = [
  'official-external-plugin-catalog.json',
  'official-external-provider-catalog.json',
  'official-external-channel-catalog.json',
]
const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_BEL = String.fromCharCode(7)
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${ANSI_BEL}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`, 'g')

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripAnsi(text: string) {
  return text
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')
}

function uniqueStrings(...items: Array<unknown>): string[] {
  const out = new Set<string>()
  const add = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item)
      return
    }
    if (typeof value !== 'string') return
    const normalized = value.trim()
    if (normalized) out.add(normalized)
  }
  for (const item of items) add(item)
  return [...out]
}

export function pluginStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function pluginIdFromPackageName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/^@openclaw\//, '')
    .replace(/-(?:plugin|provider)$/, '')
}

function pluginArrayFromRecord(record: Record<string, unknown> | null, key: string): string[] {
  return record ? pluginStringArray(record[key]) : []
}

function pluginIdsFromRecordArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isLooseRecord)
    .map((entry) => stringField(entry, ['id']))
    .filter(Boolean)
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isLooseRecord) : []
}

export function displayPluginName(pluginId: string, rawName: unknown): string {
  const catalog = PLUGIN_CATALOG[pluginId]
  if (catalog) return catalog.name
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : pluginId
  return name
    .replace(/^@openclaw\//, '')
    .replace(/-provider$/, ' provider')
    .replace(/-plugin$/, ' plugin')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function firstJsonSliceFromText(value: string) {
  const text = stripAnsi(value || '').trim()
  const firstObject = text.indexOf('{')
  const firstArray = text.indexOf('[')
  const starts = [firstObject, firstArray].filter((index) => index >= 0)
  if (!starts.length) return ''
  const start = Math.min(...starts)
  const opener = text[start]
  const closer = opener === '{' ? '}' : ']'
  const stack: string[] = []
  let inString = false
  let escaping = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) return ''
      stack.pop()
      if (!stack.length && char === closer) return text.slice(start, index + 1)
    }
  }

  return ''
}

function parseOpenClawJsonOutput(stdout: string): unknown {
  const text = stripAnsi(stdout || '').trim()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    const slice = firstJsonSliceFromText(text)
    return slice ? JSON.parse(slice) as unknown : {}
  }
}

export function parsePluginList(stdout: string): Record<string, unknown>[] {
  const parsed = parseOpenClawJsonOutput(stdout)
  if (!isLooseRecord(parsed) || !Array.isArray(parsed.plugins)) return []
  return parsed.plugins.filter(isLooseRecord)
}

function pluginDiagnosticMessagesFromJson(value: unknown): string[] {
  const messages: string[] = []
  const addDiagnostic = (entry: unknown) => {
    if (!isLooseRecord(entry)) return
    const level = stringField(entry, ['level', 'severity', 'type']).toLowerCase()
    if (level && !/\b(?:warn|warning|error|fail|failed)\b/i.test(level)) return
    const message = stringField(entry, ['message', 'detail', 'reason', 'summary', 'error'])
    if (!message) return
    const code = stringField(entry, ['code'])
    messages.push(code ? `${message} (${code})` : message)
  }

  if (Array.isArray(value)) {
    value.forEach(addDiagnostic)
  } else if (isLooseRecord(value)) {
    for (const key of ['diagnostics', 'warnings', 'errors']) {
      const nested = value[key]
      if (Array.isArray(nested)) nested.forEach(addDiagnostic)
    }
    for (const key of ['registry', 'pluginRegistry', 'meta']) {
      const nested = value[key]
      if (isLooseRecord(nested)) {
        for (const nestedKey of ['diagnostics', 'warnings', 'errors']) {
          const entries = nested[nestedKey]
          if (Array.isArray(entries)) entries.forEach(addDiagnostic)
        }
      }
    }
    addDiagnostic(value)
  }

  return uniqueStrings(messages)
}

function compactPluginCliText(value: string, redactSensitiveText: (value: string) => string, maxLength = 360) {
  const compact = redactSensitiveText(stripAnsi(value || ''))
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3).trim()}...` : compact
}

function pluginCliWarningMessagesFromText(value: string, redactSensitiveText: (value: string) => string): string[] {
  const text = stripAnsi(value || '').trim()
  if (!text) return []

  try {
    const parsed = parseOpenClawJsonOutput(text)
    const messages = pluginDiagnosticMessagesFromJson(parsed)
    if (messages.length) return messages
    if (isLooseRecord(parsed) && Array.isArray(parsed.plugins)) return []
  } catch {
    // Fall back to compacting plain CLI text below.
  }

  if (/^\s*[[{]/.test(text)) return []
  const compact = compactPluginCliText(text, redactSensitiveText)
  return compact ? [compact] : []
}

export function sanitizePluginCliError(value: unknown, redactSensitiveText: (value: string) => string) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const messages = pluginCliWarningMessagesFromText(value, redactSensitiveText)
  return compactPluginCliText((messages.length ? messages : [value]).slice(0, 2).join(' '), redactSensitiveText)
}

export function pluginCliWarningFromOutput(
  result: RunOpenClawResult,
  command: string,
  redactSensitiveText: (value: string) => string,
) {
  const messages = uniqueStrings(
    pluginCliWarningMessagesFromText(result.stderr, redactSensitiveText),
    pluginCliWarningMessagesFromText(result.stdout, redactSensitiveText),
  )
  if (messages.length) return compactPluginCliText(messages.slice(0, 2).join(' '), redactSensitiveText)
  return result.code === 0 ? '' : `${command} exited ${result.code}.`
}

function pluginRawFromManifest(
  manifest: Record<string, unknown>,
  packageJson: Record<string, unknown>,
): Record<string, unknown> | null {
  const id = (typeof manifest.id === 'string' ? manifest.id : pluginIdFromPackageName(packageJson.name)).trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) return null

  const contracts = isLooseRecord(manifest.contracts) ? manifest.contracts : null
  const commandAliases = Array.isArray(manifest.commandAliases)
    ? manifest.commandAliases
        .filter(isLooseRecord)
        .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
        .filter(Boolean)
    : []

  const enabledByDefault = manifest.enabledByDefault !== false

  return {
    id,
    name: typeof packageJson.name === 'string' ? packageJson.name : id,
    packageName: typeof packageJson.name === 'string' ? packageJson.name : undefined,
    version: typeof packageJson.version === 'string' ? packageJson.version : undefined,
    description: typeof packageJson.description === 'string' ? packageJson.description : PLUGIN_CATALOG[id]?.description,
    icon: typeof manifest.icon === 'string' && manifest.icon.trim() ? manifest.icon.trim() : undefined,
    systemImage: typeof manifest.systemImage === 'string' && manifest.systemImage.trim() ? manifest.systemImage.trim() : undefined,
    origin: 'bundled',
    enabled: enabledByDefault,
    status: enabledByDefault ? 'enabled' : 'disabled',
    activation: isLooseRecord(manifest.activation) ? manifest.activation : undefined,
    setup: isLooseRecord(manifest.setup) ? manifest.setup : undefined,
    configSchema: isLooseRecord(manifest.configSchema) ? manifest.configSchema : undefined,
    uiHints: isLooseRecord(manifest.uiHints) ? manifest.uiHints : undefined,
    providerAuthChoices: Array.isArray(manifest.providerAuthChoices) ? manifest.providerAuthChoices.filter(isLooseRecord) : undefined,
    commands: uniqueStrings(commandAliases, pluginArrayFromRecord(contracts, 'tools')),
    cliBackendIds: pluginStringArray(manifest.cliBackends),
    providerIds: pluginStringArray(manifest.providers),
    speechProviderIds: pluginArrayFromRecord(contracts, 'speechProviders'),
    webSearchProviderIds: pluginArrayFromRecord(contracts, 'webSearchProviders'),
    imageGenerationProviderIds: pluginArrayFromRecord(contracts, 'imageGenerationProviders'),
    mediaUnderstandingProviderIds: pluginArrayFromRecord(contracts, 'mediaUnderstandingProviders'),
    memoryEmbeddingProviderIds: pluginArrayFromRecord(contracts, 'memoryEmbeddingProviders'),
    videoGenerationProviderIds: pluginArrayFromRecord(contracts, 'videoGenerationProviders'),
    channelIds: pluginStringArray(manifest.channels),
  }
}

function setupProvidersFromCatalog(openclaw: Record<string, unknown>): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  const add = (provider: Record<string, unknown>) => {
    const id = stringField(provider, ['id'])
    if (!id) return
    const existing = byId.get(id) || { id }
    byId.set(id, {
      ...existing,
      envVars: uniqueStrings(existing.envVars, provider.envVars),
    })
  }
  for (const key of ['providers', 'webSearchProviders', 'speechProviders', 'imageGenerationProviders', 'memoryEmbeddingProviders']) {
    for (const provider of recordArray(openclaw[key])) add(provider)
  }
  return [...byId.values()].filter((provider) => pluginStringArray(provider.envVars).length || AUTH_ENV_MAP[String(provider.id)]?.length)
}

function providerAuthChoicesFromCatalog(openclaw: Record<string, unknown>): Record<string, unknown>[] {
  const choices: Record<string, unknown>[] = []
  const add = (provider: Record<string, unknown>) => {
    const providerId = stringField(provider, ['id'])
    if (!providerId) return
    for (const choice of recordArray(provider.authChoices)) {
      choices.push({
        ...choice,
        provider: typeof choice.provider === 'string' && choice.provider.trim() ? choice.provider.trim() : providerId,
      })
    }
    const credentialLabel = stringField(provider, ['credentialLabel'])
    if (credentialLabel) {
      choices.push({
        provider: providerId,
        method: 'api-key',
        choiceLabel: credentialLabel,
      })
    }
  }
  for (const key of ['providers', 'webSearchProviders', 'speechProviders', 'imageGenerationProviders', 'memoryEmbeddingProviders']) {
    for (const provider of recordArray(openclaw[key])) add(provider)
  }
  return choices
}

function pluginRawFromExternalCatalogEntry(entry: Record<string, unknown>): Record<string, unknown> | null {
  const openclaw = isLooseRecord(entry.openclaw) ? entry.openclaw : {}
  const plugin = isLooseRecord(openclaw.plugin) ? openclaw.plugin : {}
  const channel = isLooseRecord(openclaw.channel) ? openclaw.channel : {}
  const install = isLooseRecord(openclaw.install) ? openclaw.install : {}
  const contracts = isLooseRecord(openclaw.contracts) ? openclaw.contracts : null
  const packageName = stringField(entry, ['name'])
  const id = (stringField(plugin, ['id']) || stringField(channel, ['id']) || pluginIdFromPackageName(packageName)).trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) return null

  const setupProviders = setupProvidersFromCatalog(openclaw)
  const providerAuthChoices = providerAuthChoicesFromCatalog(openclaw)
  const channelIds = uniqueStrings(
    stringField(channel, ['id']),
    pluginIdsFromRecordArray(openclaw.channels),
    Object.keys(isLooseRecord(openclaw.channelConfigs) ? openclaw.channelConfigs : {}),
    pluginArrayFromRecord(contracts, 'channels'),
  )

  return {
    id,
    name: stringField(plugin, ['label']) || stringField(channel, ['label', 'detailLabel', 'selectionLabel']) || packageName || id,
    packageName: packageName || undefined,
    description: stringField(entry, ['description']) || stringField(channel, ['blurb']) || PLUGIN_CATALOG[id]?.description,
    icon: stringField(plugin, ['icon']) || undefined,
    systemImage: stringField(channel, ['systemImage']) || undefined,
    installSpec: stringField(install, ['npmSpec', 'clawhubSpec']) || undefined,
    minHostVersion: stringField(install, ['minHostVersion']) || undefined,
    origin: 'official-catalog',
    kind: stringField(entry, ['kind']) || 'plugin',
    source: stringField(entry, ['source']) || 'official',
    enabled: false,
    status: 'disabled',
    setup: setupProviders.length ? { providers: setupProviders } : undefined,
    providerAuthChoices: providerAuthChoices.length ? providerAuthChoices : undefined,
    commands: pluginArrayFromRecord(contracts, 'tools'),
    providerIds: pluginIdsFromRecordArray(openclaw.providers),
    speechProviderIds: uniqueStrings(pluginIdsFromRecordArray(openclaw.speechProviders), pluginArrayFromRecord(contracts, 'speechProviders')),
    webSearchProviderIds: uniqueStrings(pluginIdsFromRecordArray(openclaw.webSearchProviders), pluginArrayFromRecord(contracts, 'webSearchProviders')),
    imageGenerationProviderIds: uniqueStrings(pluginIdsFromRecordArray(openclaw.imageGenerationProviders), pluginArrayFromRecord(contracts, 'imageGenerationProviders')),
    mediaUnderstandingProviderIds: pluginArrayFromRecord(contracts, 'mediaUnderstandingProviders'),
    memoryEmbeddingProviderIds: uniqueStrings(pluginIdsFromRecordArray(openclaw.memoryEmbeddingProviders), pluginArrayFromRecord(contracts, 'memoryEmbeddingProviders')),
    videoGenerationProviderIds: pluginArrayFromRecord(contracts, 'videoGenerationProviders'),
    channelIds,
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown
    return isLooseRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function pluginConfiguredEnabled(config: PluginInventoryOpenClawConfig, pluginId: string): boolean | null {
  const configured = config.plugins?.entries?.[pluginId]?.enabled
  return typeof configured === 'boolean' ? configured : null
}

function pluginCategory(pluginId: string, raw: Record<string, unknown>): string {
  if (PLUGIN_CATALOG[pluginId]) return PLUGIN_CATALOG[pluginId].category
  if (typeof raw.kind === 'string' && raw.kind.trim()) return raw.kind.trim()
  if (pluginStringArray(raw.providerIds).length || pluginStringArray(raw.cliBackendIds).length) return 'providers'
  if (
    pluginStringArray(raw.channelIds).length ||
    pluginStringArray(raw.channels).length ||
    /(?:chat|talk|sms|voice|discord|slack|telegram|whatsapp|teams)/i.test(pluginId)
  ) {
    return 'communications'
  }
  if (/memory/i.test(pluginId) || pluginStringArray(raw.memoryEmbeddingProviderIds).length) return 'memory'
  if (pluginStringArray(raw.commands).length || pluginStringArray(raw.services).length) return 'automation'
  if (/(?:web|search|readability|browser|brave|duckduckgo|firecrawl|perplexity|tavily|exa|searxng)/i.test(pluginId)) return 'web'
  return 'runtime'
}

function pluginMissingDependencies(raw: Record<string, unknown>): string[] {
  const dependencyStatus = isLooseRecord(raw.dependencyStatus) ? raw.dependencyStatus : {}
  return pluginStringArray(dependencyStatus.missing)
    .concat(
      Array.isArray(dependencyStatus.missing)
        ? dependencyStatus.missing
            .filter(isLooseRecord)
            .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
            .filter(Boolean)
        : [],
    )
    .slice(0, 12)
}

function readNestedRecordValue(root: unknown, dottedPath: string): unknown {
  let current: unknown = root
  for (const segment of dottedPath.split('.').filter(Boolean)) {
    if (!isLooseRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function hasUsableConfigValue(value: unknown) {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value && typeof value === 'object')
}

function configFieldFromPluginConfig(params: {
  key: string
  label: string
  path: string
  value: unknown
  secret?: boolean
  required?: boolean
  help?: string
}): PluginConfigField {
  return {
    key: params.key,
    label: params.label,
    path: params.path,
    secret: params.secret !== false,
    required: params.required !== false,
    present: hasUsableConfigValue(params.value),
    acceptsDirectSave: true,
    ...(params.help ? { help: params.help } : {}),
  }
}

function providerLabel(providerId: string) {
  return AUTH_PROVIDER_CATALOG[providerId]?.label || providerId
}

function providerConfigFieldsFromSetup(
  raw: Record<string, unknown>,
  providerAuthStatus: (providerId: string) => { configured?: boolean },
): PluginConfigField[] {
  const setup = isLooseRecord(raw.setup) ? raw.setup : null
  const providers = Array.isArray(setup?.providers) ? setup.providers.filter(isLooseRecord) : []
  const fields: PluginConfigField[] = []

  for (const providerSetup of providers) {
    const providerId = typeof providerSetup.id === 'string' ? providerSetup.id.trim() : ''
    if (!providerId) continue
    const status = providerAuthStatus(providerId)
    const envVars = pluginStringArray(providerSetup.envVars)
    const knownEnvVars = AUTH_ENV_MAP[providerId] || []
    if (!providerId || (!knownEnvVars.length && !envVars.length)) continue
    const primaryEnvVar = envVars[0] || knownEnvVars[0] || ''
    const choice = Array.isArray(raw.providerAuthChoices)
      ? raw.providerAuthChoices
          .filter(isLooseRecord)
          .find((entry) => entry.provider === providerId && entry.method === 'api-key')
      : null
    const label = typeof choice?.choiceLabel === 'string' && choice.choiceLabel.trim()
      ? choice.choiceLabel.trim()
      : `${providerLabel(providerId)} API key`
    fields.push({
      key: `provider:${providerId}`,
      label,
      ...(primaryEnvVar ? { envVar: primaryEnvVar } : {}),
      providerId,
      secret: true,
      required: true,
      present: Boolean(status.configured),
      acceptsDirectSave: true,
      help: status.configured
        ? `${providerLabel(providerId)} auth is already configured.`
        : primaryEnvVar
          ? `Paste ${primaryEnvVar} or use Model/Auth setup.`
          : `Paste a ${providerLabel(providerId)} API key or use Model/Auth setup.`,
    })
  }

  return fields
}

function schemaConfigFieldsFromRaw(
  raw: Record<string, unknown>,
  entryConfig: PluginInventoryOpenClawPluginEntry | undefined,
): PluginConfigField[] {
  const schema = isLooseRecord(raw.configSchema) ? raw.configSchema : null
  const properties = isLooseRecord(schema?.properties) ? schema.properties : {}
  const required = new Set(pluginStringArray(schema?.required))
  const uiHints = isLooseRecord(raw.uiHints) ? raw.uiHints : {}
  const fields: PluginConfigField[] = []

  for (const [key, property] of Object.entries(properties)) {
    if (!PLUGIN_ID_PATTERN.test(key.replace(/\./g, '-'))) continue
    const hint = isLooseRecord(uiHints[key]) ? uiHints[key] : {}
    const lowerKey = key.toLowerCase()
    const sensitive =
      hint.sensitive === true ||
      /(?:api[-_]?key|token|secret|password|credential)/i.test(lowerKey)
    const requiredField = required.has(key)
    if (!requiredField && !sensitive) continue
    const propRecord = isLooseRecord(property) ? property : {}
    const label = typeof hint.label === 'string' && hint.label.trim()
      ? hint.label.trim()
      : key
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/[-_.]+/g, ' ')
          .replace(/\b\w/g, (match) => match.toUpperCase())
    const help =
      typeof hint.help === 'string' && hint.help.trim()
        ? hint.help.trim()
        : typeof propRecord.description === 'string' && propRecord.description.trim()
          ? propRecord.description.trim()
          : undefined
    fields.push(configFieldFromPluginConfig({
      key,
      label,
      path: `plugins.entries.${String(raw.id)}.config.${key}`,
      value: readNestedRecordValue(entryConfig?.config, key),
      secret: sensitive,
      required: requiredField || sensitive,
      help,
    }))
  }

  return fields
}

function knownPluginConfigFields(
  id: string,
  raw: Record<string, unknown>,
  config: PluginInventoryOpenClawConfig,
  pluginState: PluginRuntimeState,
  providerAuthStatus: (providerId: string) => { configured?: boolean },
): PluginConfigField[] {
  const entryConfig = config.plugins?.entries?.[id]
  const fields = [...schemaConfigFieldsFromRaw(raw, entryConfig), ...providerConfigFieldsFromSetup(raw, providerAuthStatus)]

  if (id === 'clawtalk') {
    const existing = fields.find((field) => field.key === 'apiKey')
    const apiKey =
      readNestedRecordValue(entryConfig?.config, 'apiKey') ||
      entryConfig?.apiKey ||
      pluginState.secrets?.[id]?.apiKey
    if (existing) {
      existing.present = hasUsableConfigValue(apiKey)
      existing.required = true
      existing.acceptsDirectSave = true
      existing.path = `plugins.entries.${id}.config.apiKey`
    } else {
      fields.unshift(configFieldFromPluginConfig({
        key: 'apiKey',
        label: 'ClawTalk API key',
        path: `plugins.entries.${id}.config.apiKey`,
        value: apiKey,
        secret: true,
        required: true,
        help: 'Paste the ClawTalk API key to connect and verify WebSocket auth.',
      }))
    }
  }

  const seen = new Set<string>()
  return fields.filter((field) => {
    const key = field.providerId ? `provider:${field.providerId}` : field.key
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pluginGuidance(
  entry: Omit<PluginControlEntry, 'configFields' | 'guidance' | 'needsSetup'>,
  configFields: PluginConfigField[],
) {
  const guidance: string[] = []
  const missingFields = configFields.filter((field) => field.required && !field.present)

  if (entry.missingDependencies.length) {
    guidance.push(`Missing dependencies: ${entry.missingDependencies.slice(0, 4).join(', ')}.`)
  }
  if (entry.enabled && missingFields.length) {
    guidance.push(`Paste ${missingFields.map((field) => field.label).join(', ')} and refresh.`)
  }
  if (entry.enabled && !entry.missingDependencies.length && !missingFields.length) {
    guidance.push('Ready. Runtime inspect verifies loaded plugin surfaces after install or config changes.')
  }
  if (!entry.enabled && missingFields.length) {
    guidance.push(`Enable after adding ${missingFields.map((field) => field.label).join(', ')}.`)
  }

  return guidance
}

function buildPluginControlEntry(
  raw: Record<string, unknown>,
  config: PluginInventoryOpenClawConfig,
  pluginState: PluginRuntimeState,
  providerAuthStatus: (providerId: string) => { configured?: boolean },
): PluginControlEntry | null {
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : ''
  if (!PLUGIN_ID_PATTERN.test(id)) return null

  const configuredEnabled = pluginConfiguredEnabled(config, id)
  const globalDisabled = config.plugins?.enabled === false
  const allow = pluginStringArray(config.plugins?.allow)
  const deny = pluginStringArray(config.plugins?.deny)
  const excludedByAllow = Boolean(allow.length && !allow.includes(id))
  const denied = deny.includes(id)
  const rawEnabled = configuredEnabled === true ? true : typeof raw.enabled === 'boolean' ? raw.enabled : configuredEnabled !== false
  const enabled = !globalDisabled && !excludedByAllow && !denied && configuredEnabled !== false && rawEnabled
  const catalog = PLUGIN_CATALOG[id]
  const rawStatus = typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : ''
  const status =
    globalDisabled || configuredEnabled === false || excludedByAllow || denied
      ? 'disabled'
      : enabled
        ? (/^disabled$/i.test(rawStatus) ? 'enabled' : rawStatus || 'enabled')
        : rawStatus || 'disabled'

  const base = {
    id,
    name: displayPluginName(id, raw.name),
    description:
      catalog?.description ||
      (typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : `OpenClaw plugin ${id}.`),
    ...(typeof raw.icon === 'string' && raw.icon.trim() ? { icon: raw.icon.trim() } : {}),
    ...(typeof raw.systemImage === 'string' && raw.systemImage.trim() ? { systemImage: raw.systemImage.trim() } : {}),
    ...(typeof raw.packageName === 'string' && raw.packageName.trim() ? { packageName: raw.packageName.trim() } : {}),
    ...(typeof raw.installSpec === 'string' && raw.installSpec.trim() ? { installSpec: raw.installSpec.trim() } : {}),
    origin: typeof raw.origin === 'string' && raw.origin.trim() ? raw.origin.trim() : configuredEnabled !== null ? 'config' : 'bundled',
    status,
    enabled,
    configuredEnabled,
    category: pluginCategory(id, raw),
    commands: uniqueStrings(...pluginStringArray(raw.commands), ...pluginStringArray(raw.cliCommands)).slice(0, 12),
    providers: uniqueStrings(
      ...pluginStringArray(raw.providerIds),
      ...pluginStringArray(raw.speechProviderIds),
      ...pluginStringArray(raw.webSearchProviderIds),
      ...pluginStringArray(raw.imageGenerationProviderIds),
      ...pluginStringArray(raw.mediaUnderstandingProviderIds),
      ...pluginStringArray(raw.memoryEmbeddingProviderIds),
      ...pluginStringArray(raw.videoGenerationProviderIds),
    ).slice(0, 12),
    channels: uniqueStrings(
      ...pluginStringArray(raw.channelIds),
      ...pluginStringArray(raw.channels),
      ...pluginStringArray(raw.gatewayMethods),
    ).slice(0, 12),
    missingDependencies: uniqueStrings(...pluginMissingDependencies(raw)),
    restartRequired: typeof raw.restartRequired === 'boolean' ? raw.restartRequired : false,
  }
  const configFields = knownPluginConfigFields(id, raw, config, pluginState, providerAuthStatus)
  const guidance = pluginGuidance(base, configFields)
  return {
    ...base,
    configFields,
    guidance,
    needsSetup: Boolean(
      base.missingDependencies.length ||
      (base.enabled && configFields.some((field) => field.required && !field.present)),
    ),
  }
}

export function createPluginInventoryService(options: PluginInventoryServiceOptions): PluginInventoryService {
  const cacheMs = options.cacheMs ?? DEFAULT_PLUGIN_LIST_CACHE_MS
  let pluginListCache: PluginListCacheEntry | null = null
  let pluginListRefreshPromise: Promise<PluginListCacheEntry> | null = null
  const warn = options.warn || ((message, error) => console.warn(message, error))

  async function loadBundledPluginManifestsFromRoot(openclawRoot: string): Promise<Record<string, unknown>[]> {
    const root = path.join(openclawRoot, 'dist', 'extensions')
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    if (!entries.length) return []

    const plugins = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const pluginDir = path.join(root, entry.name)
          const [manifest, packageJson] = await Promise.all([
            readJsonRecord(path.join(pluginDir, 'openclaw.plugin.json')),
            readJsonRecord(path.join(pluginDir, 'package.json')),
          ])
          return pluginRawFromManifest(manifest, packageJson)
        }),
    )

    return plugins.filter((plugin): plugin is Record<string, unknown> => Boolean(plugin))
  }

  async function loadOfficialExternalCatalogPluginsFromRoot(openclawRoot: string): Promise<Record<string, unknown>[]> {
    const plugins: Record<string, unknown>[] = []
    for (const fileName of OFFICIAL_EXTERNAL_CATALOG_FILES) {
      const catalog = await readJsonRecord(path.join(openclawRoot, 'scripts', 'lib', fileName))
      const entries = Array.isArray(catalog.entries) ? catalog.entries.filter(isLooseRecord) : []
      plugins.push(...entries.map(pluginRawFromExternalCatalogEntry).filter((plugin): plugin is Record<string, unknown> => Boolean(plugin)))
    }
    return plugins
  }

  function mergePluginRawEntries(...groups: Record<string, unknown>[][]): Record<string, unknown>[] {
    const byId = new Map<string, Record<string, unknown>>()
    for (const raw of groups.flat()) {
      const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : ''
      if (!PLUGIN_ID_PATTERN.test(id) || byId.has(id)) continue
      byId.set(id, raw)
    }
    return [...byId.values()]
  }

  async function loadBundledPluginManifestList(): Promise<Record<string, unknown>[]> {
    const openclawDir = options.openclawBin && options.openclawBin !== 'openclaw'
      ? path.dirname(path.resolve(options.openclawBin))
      : ''
    const openclawRoots = uniqueStrings(
      openclawDir,
      openclawDir ? path.resolve(openclawDir, '..') : '',
      path.resolve(options.workspaceRoot, 'vendor', 'openclaw'),
      path.resolve(process.cwd(), 'vendor', 'openclaw'),
      path.resolve(process.cwd(), 'resources', 'openclaw'),
    )

    for (const root of openclawRoots) {
      const bundled = await loadBundledPluginManifestsFromRoot(root)
      const external = await loadOfficialExternalCatalogPluginsFromRoot(root)
      const plugins = mergePluginRawEntries(bundled, external)
      if (plugins.length) return plugins
    }

    return []
  }

  async function readLegacyPluginListCache(
    normalize: (value: unknown) => PluginListCacheEntry | null,
  ): Promise<PluginListCacheEntry | null> {
    try {
      const raw = await fs.readFile(options.listCachePath, 'utf-8')
      return normalize(JSON.parse(raw.replace(/^\uFEFF/, '')))
    } catch {
      return null
    }
  }

  async function readPluginListDiskCache(): Promise<PluginListCacheEntry | null> {
    const cacheFromValue = (value: unknown): PluginListCacheEntry | null => {
      const parsed = value
      if (!isLooseRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.rawPlugins)) return null

      const rawPlugins = parsed.rawPlugins.filter(isLooseRecord)
      if (!rawPlugins.length) return null

      const refreshedAt = typeof parsed.refreshedAt === 'number' ? parsed.refreshedAt : Date.now()
      const source = parsed.source === 'bundled' ? 'bundled' : 'openclaw'
      const cliError = sanitizePluginCliError(parsed.cliError, options.redactSensitiveText)
      return {
        rawPlugins,
        ...(cliError ? { cliError } : {}),
        refreshedAt,
        expiresAt: refreshedAt + cacheMs,
        source,
      }
    }

    const sqliteCache = cacheFromValue(options.readControlCenterStateRecord(options.pluginListCacheStateKey))
    if (sqliteCache) return sqliteCache

    const legacyCache = await readLegacyPluginListCache(cacheFromValue)
    if (legacyCache) {
      options.writeControlCenterStateRecord(options.pluginListCacheStateKey, {
        version: 1,
        source: legacyCache.source,
        refreshedAt: legacyCache.refreshedAt,
        rawPlugins: legacyCache.rawPlugins,
        ...(legacyCache.cliError ? { cliError: legacyCache.cliError } : {}),
      }, options.listCachePath)
    }
    return legacyCache
  }

  async function writePluginListDiskCache(cache: PluginListCacheEntry) {
    if (!cache.rawPlugins.length) return
    const cliError = sanitizePluginCliError(cache.cliError, options.redactSensitiveText)
    const payload = {
      version: 1,
      source: cache.source,
      refreshedAt: cache.refreshedAt,
      rawPlugins: cache.rawPlugins,
      ...(cliError ? { cliError } : {}),
    }
    if (options.writeControlCenterStateRecord(options.pluginListCacheStateKey, payload, options.listCachePath)) return
    await fs.mkdir(path.dirname(options.listCachePath), { recursive: true })
    await fs.writeFile(options.listCachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  }

  async function refreshPluginListCache(): Promise<PluginListCacheEntry> {
    if (pluginListRefreshPromise) return pluginListRefreshPromise

    pluginListRefreshPromise = (async () => {
      let rawPlugins: Record<string, unknown>[] = []
      let cliError = ''
      let source: PluginListCacheEntry['source'] = 'openclaw'

      try {
        const result = await options.runOpenClaw(['plugins', 'list', '--json'], 90_000)
        try {
          rawPlugins = parsePluginList(result.stdout)
        } catch (error) {
          cliError = sanitizePluginCliError(String(error), options.redactSensitiveText)
        }
        const warning = pluginCliWarningFromOutput(result, 'openclaw plugins list', options.redactSensitiveText)
        if (warning) {
          cliError = uniqueStrings(cliError, warning).join(' ')
        } else {
          cliError = sanitizePluginCliError(cliError, options.redactSensitiveText)
        }
      } catch (error) {
        cliError = sanitizePluginCliError(String(error), options.redactSensitiveText)
      }

      if (!rawPlugins.length) {
        const bundledPlugins = await loadBundledPluginManifestList()
        if (bundledPlugins.length) {
          rawPlugins = bundledPlugins
          source = 'bundled'
        }
      }

      const now = Date.now()
      const cache: PluginListCacheEntry = {
        rawPlugins,
        ...(cliError ? { cliError } : {}),
        refreshedAt: now,
        expiresAt: now + cacheMs,
        source,
      }

      pluginListCache = cache
      await writePluginListDiskCache(cache).catch((error) => {
        warn('Failed to write plugin list cache:', error)
      })
      return cache
    })().finally(() => {
      pluginListRefreshPromise = null
    })

    return pluginListRefreshPromise
  }

  function refreshPluginListCacheInBackground() {
    void refreshPluginListCache().catch((error) => {
      warn('Background plugin list refresh failed:', error)
    })
  }

  async function getPluginList(listOptions: { forceRefresh?: boolean } = {}): Promise<PluginListResult> {
    if (listOptions.forceRefresh) {
      const now = Date.now()
      if (pluginListCache?.rawPlugins.length) {
        refreshPluginListCacheInBackground()
        return { ...pluginListCache, refreshing: true }
      }

      const diskCache = await readPluginListDiskCache()
      if (diskCache?.rawPlugins.length) {
        pluginListCache = diskCache
        refreshPluginListCacheInBackground()
        return { ...diskCache, refreshing: true }
      }

      const bundledPlugins = await loadBundledPluginManifestList()
      const cache: PluginListCacheEntry = {
        rawPlugins: bundledPlugins,
        refreshedAt: now,
        expiresAt: now + cacheMs,
        source: 'bundled',
        cliError: 'OpenClaw plugin refresh is running in the background.',
      }
      pluginListCache = cache
      await writePluginListDiskCache(cache).catch((error) => {
        warn('Failed to write bundled plugin list cache:', error)
      })
      refreshPluginListCacheInBackground()
      return { ...cache, refreshing: true }
    }

    const now = Date.now()
    if (pluginListCache?.rawPlugins.length) {
      if (pluginListCache.expiresAt <= now) refreshPluginListCacheInBackground()
      return { ...pluginListCache, refreshing: Boolean(pluginListRefreshPromise) }
    }

    const diskCache = await readPluginListDiskCache()
    if (diskCache?.rawPlugins.length) {
      pluginListCache = diskCache
      if (diskCache.expiresAt <= now) refreshPluginListCacheInBackground()
      return { ...diskCache, refreshing: Boolean(pluginListRefreshPromise) }
    }

    const bundledPlugins = await loadBundledPluginManifestList()
    const cache: PluginListCacheEntry = {
      rawPlugins: bundledPlugins,
      refreshedAt: now,
      expiresAt: now + cacheMs,
      source: 'bundled',
    }
    pluginListCache = cache
    await writePluginListDiskCache(cache).catch((error) => {
      warn('Failed to write bundled plugin list cache:', error)
    })
    refreshPluginListCacheInBackground()
    return { ...cache, refreshing: true }
  }

  async function listPluginControls(listOptions: { forceRefresh?: boolean } = {}): Promise<PluginControlsPayload> {
    const config = await options.readOpenclawConfig()
    const pluginState = await options.readPluginRuntimeState()
    const pluginList = await getPluginList(listOptions)

    const byId = new Map<string, Record<string, unknown>>()
    for (const raw of pluginList.rawPlugins) {
      const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : ''
      if (PLUGIN_ID_PATTERN.test(id)) byId.set(id, raw)
    }

    for (const [id, entry] of Object.entries(config.plugins?.entries || {})) {
      if (!PLUGIN_ID_PATTERN.test(id) || byId.has(id)) continue
      byId.set(id, {
        id,
        name: PLUGIN_CATALOG[id]?.name || id,
        description: PLUGIN_CATALOG[id]?.description,
        origin: 'config',
        enabled: entry.enabled !== false,
        status: entry.enabled === false ? 'disabled' : 'configured',
      })
    }

    for (const [id, state] of Object.entries(pluginState.managed || {})) {
      if (!PLUGIN_ID_PATTERN.test(id) || byId.has(id)) continue
      byId.set(id, {
        id,
        name: PLUGIN_CATALOG[id]?.name || id,
        description: PLUGIN_CATALOG[id]?.description,
        origin: 'managed',
        enabled: state.enabled,
        status: state.enabled ? 'managed' : 'disabled',
      })
    }

    const priority = new Map([
      ['browser', 0],
      ['codex', 1],
      ['clawtalk', 2],
      ['memory-core', 3],
      ['openai', 4],
      ['deepseek', 5],
      ['google', 6],
    ])
    const plugins = Array.from(byId.values())
      .map((raw) => buildPluginControlEntry(raw, config, pluginState, (providerId) => providerAuthStatus(providerId)))
      .filter((entry): entry is PluginControlEntry => Boolean(entry))
      .map((entry) => ({
        ...entry,
        managed: Boolean(pluginState.managed?.[entry.id]),
      }))
      .sort((a, b) => {
        const rank = (priority.get(a.id) ?? 1000) - (priority.get(b.id) ?? 1000)
        if (rank !== 0) return rank
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return {
      plugins,
      configPath: options.configPath,
      cache: {
        source: pluginList.source,
        refreshedAt: pluginList.refreshedAt,
        refreshing: pluginList.refreshing,
      },
      ...(pluginList.cliError ? { cliError: pluginList.cliError } : {}),
    }
  }

  const providerAuthStatus = options.providerAuthStatus

  return {
    getPluginList,
    listPluginControls,
    refreshPluginListCache,
  }
}
