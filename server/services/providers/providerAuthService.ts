import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const optionalRequire = createRequire(import.meta.url)

type SqliteStatement = {
  get?: (...args: unknown[]) => unknown
  run?: (...args: unknown[]) => unknown
}

type SqliteDatabase = {
  exec?: (sql: string) => unknown
  prepare: (sql: string) => SqliteStatement
  close?: () => unknown
}

type SqliteModule = {
  DatabaseSync?: new (filePath: string, options?: { readOnly?: boolean }) => SqliteDatabase
}

export type AuthMode = 'oauth' | 'apiKey'

export type LocalOAuthCredential = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string[]
  email?: string
  accountId?: string
  idToken?: string
  projectId?: string
  createdAt?: string
  updatedAt?: string
}

export type LocalProviderAuth = {
  mode?: AuthMode
  apiKey?: string
  oauth?: LocalOAuthCredential
}

export type LocalAuthStore = {
  providers: Record<string, LocalProviderAuth>
}

type AuthProfileApiKeyCredential = {
  type: 'api_key'
  provider: string
  key: string
}

type AuthProfileOAuthCredential = {
  type: 'oauth'
  provider: string
  copyToAgents?: boolean
  access?: string
  refresh?: string
  expires?: number
  email?: string
  accountId?: string
  idToken?: string
  displayName?: string
  projectId?: string
}

type AuthProfileCredential = AuthProfileApiKeyCredential | AuthProfileOAuthCredential

type AuthProfileStore = {
  version: number
  profiles: Record<string, AuthProfileCredential>
  order?: Record<string, string[]>
  lastGood?: Record<string, string>
}

type AuthProfileStateStore = {
  version: number
  order?: Record<string, string[]>
  lastGood?: Record<string, string>
  usageStats?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type ProviderAuthCatalogEntry = {
  label?: string
  envKeys?: string[]
  oauthEnvKeys?: string[]
  docs?: string
  apiKeyUrl?: string
  optionalAuth?: boolean
  oauth?: {
    docs?: string
    redirectUri?: string
    clientIdEnvKeys?: string[]
    projectIdEnvKeys?: string[]
  }
  subscriptionAuth?: {
    label?: string
    docs?: string
    setupCommand?: string
  }
}

export type ProviderAuthOpenClawConfig = {
  agents?: {
    list?: Array<{ id?: string; [key: string]: unknown }>
  }
  plugins?: {
    entries?: Record<string, { enabled?: boolean; [key: string]: unknown }>
    allow?: unknown
    deny?: unknown
  }
  [key: string]: unknown
}

type ProviderAuthAgentLocalConfig = {
  auth?: {
    providers?: Record<string, { mode: 'oauth' | 'apiKey'; apiKey?: string }>
  }
}

export type ProviderAuthStatusOptions = {
  probeGcloud?: boolean
}

export type ProviderAuthServiceOptions = {
  authEnvMap: Record<string, string[]>
  authProviderCatalog: Record<string, ProviderAuthCatalogEntry>
  canonicalAgentModelId: (modelId: string | undefined) => string
  configuredProviderApiKeyMarker: (provider: string) => string
  createInitialOpenclawConfig: () => ProviderAuthOpenClawConfig
  ensureBundledProviderPluginEnabledForProviderAuth: (config: ProviderAuthOpenClawConfig, pluginId: 'meta') => void
  ensureOpenRouterModelCatalogAllowlist: (config: ProviderAuthOpenClawConfig) => void
  ensureOpenRouterPluginEnabledForProviderAuth: (config: ProviderAuthOpenClawConfig) => void
  googleOAuthClientConfigStatus: () => { available: boolean; missing: string[] }
  googleVertexGcloudStatus: (options?: ProviderAuthStatusOptions) => unknown
  homeDir: string
  invalidateAvailableModelsForAuthChange: () => void
  isGoogleVertexConfigured: (options?: ProviderAuthStatusOptions) => boolean
  isGoogleVertexLocalOAuthConfigured: (env?: Record<string, string>, options?: ProviderAuthStatusOptions) => boolean
  isOpenAiCodexSubscriptionModel: (modelId: string) => boolean
  isValidAgentId: (agentId: string | undefined) => boolean
  localAuthPath: string
  localAuthStateKey: string
  now?: () => number
  openclawAgentFolder: (agentId: string) => string
  readAgentLocalConfigIfPresent: (agentId: string) => Promise<ProviderAuthAgentLocalConfig | null | undefined>
  readControlCenterStateRecord: <T>(stateKey: string) => T | null
  readOpenclawConfig: () => Promise<ProviderAuthOpenClawConfig>
  resolveGoogleProjectId: (input?: string) => string
  writeControlCenterStateRecord: (stateKey: string, value: unknown, sourcePath?: string) => boolean
  writeOpenclawConfig: (config: unknown) => Promise<unknown>
  writePrivateJsonFileAtomically: (filePath: string, value: unknown) => Promise<void>
  writePrivateTextFileAtomically: (filePath: string, content: string) => Promise<void>
}

const AUTH_PROVIDER_PROFILE_ALIASES: Record<string, string[]> = {
  opencode: ['opencode', 'opencode-go'],
  'opencode-go': ['opencode', 'opencode-go'],
  qwen: ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  qwencloud: ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  dashscope: ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  modelstudio: ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  'qwen-cli': ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  'qwen-oauth': ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  'qwen-portal': ['qwen', 'qwencloud', 'dashscope', 'modelstudio', 'qwen-cli', 'qwen-oauth', 'qwen-portal'],
  kimi: ['kimi', 'kimi-coding', 'moonshot'],
  'kimi-coding': ['kimi', 'kimi-coding', 'moonshot'],
  moonshot: ['kimi', 'kimi-coding', 'moonshot'],
  novita: ['novita', 'novita-ai', 'novitaai'],
  'novita-ai': ['novita', 'novita-ai', 'novitaai'],
  novitaai: ['novita', 'novita-ai', 'novitaai'],
  gmi: ['gmi', 'gmi-cloud', 'gmicloud'],
  'gmi-cloud': ['gmi', 'gmi-cloud', 'gmicloud'],
  gmicloud: ['gmi', 'gmi-cloud', 'gmicloud'],
  byteplus: ['byteplus', 'byteplus-plan'],
  'byteplus-plan': ['byteplus', 'byteplus-plan'],
  volcengine: ['volcengine', 'volcengine-plan'],
  'volcengine-plan': ['volcengine', 'volcengine-plan'],
  stepfun: ['stepfun', 'stepfun-plan'],
  'stepfun-plan': ['stepfun', 'stepfun-plan'],
  xiaomi: ['xiaomi', 'xiaomi-token-plan'],
  'xiaomi-token-plan': ['xiaomi', 'xiaomi-token-plan'],
  parallel: ['parallel', 'parallel-free'],
  'parallel-free': ['parallel', 'parallel-free'],
  azure: ['azure', 'azure-speech'],
  'azure-speech': ['azure', 'azure-speech'],
  openai: ['openai'],
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return isLooseRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeLocalAuthStore(value: unknown): LocalAuthStore | null {
  if (!isLooseRecord(value) || !isLooseRecord(value.providers)) return null
  const providers = { ...(value.providers as Record<string, LocalProviderAuth>) }
  // OpenClaw now uses the canonical "openai" provider for both API keys and
  // ChatGPT/Codex OAuth. Merge rather than discard a user's older local entry.
  const legacyCodex = providers['openai-codex']
  if (legacyCodex) {
    const openai = providers.openai || {}
    providers.openai = {
      ...legacyCodex,
      ...openai,
      apiKey: openai.apiKey || legacyCodex.apiKey,
      oauth: openai.oauth || legacyCodex.oauth,
      mode: openai.mode || legacyCodex.mode,
    }
    delete providers['openai-codex']
  }
  return { providers }
}

async function readLegacyJsonState<T>(filePath: string, normalize: (value: unknown) => T | null): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return normalize(parseLooseJsonObject(raw))
  } catch {
    return null
  }
}

function inferOpenClawAgentIdFromAgentDir(agentDir: string) {
  const normalized = path.normalize(agentDir)
  if (path.basename(normalized).toLowerCase() === 'agent') {
    const parent = path.basename(path.dirname(normalized))
    if (parent) return parent
  }
  return 'main'
}

function authProfileSqlitePath(agentDir: string) {
  return path.join(agentDir, 'openclaw-agent.sqlite')
}

function normalizeAuthProfileStore(value: Partial<AuthProfileStore> | null | undefined): AuthProfileStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) return null
  return {
    version: Number(value.version || 1),
    profiles: value.profiles as Record<string, AuthProfileCredential>,
    ...(value.order && typeof value.order === 'object' && !Array.isArray(value.order) ? { order: value.order } : {}),
    ...(value.lastGood && typeof value.lastGood === 'object' && !Array.isArray(value.lastGood) ? { lastGood: value.lastGood } : {}),
  }
}

function normalizeAuthProfileState(value: Partial<AuthProfileStateStore> | null | undefined): AuthProfileStateStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    ...value,
    version: Number(value.version || 1),
  } as AuthProfileStateStore
}

function mergeAuthProfileStores(...stores: Array<AuthProfileStore | null | undefined>): AuthProfileStore {
  const merged: AuthProfileStore = { version: 1, profiles: {} }
  for (const store of stores) {
    if (!store) continue
    merged.version = Math.max(merged.version, Number(store.version || 1))
    merged.profiles = {
      ...merged.profiles,
      ...(store.profiles || {}),
    }
    if (store.order) {
      merged.order = merged.order || {}
      for (const [provider, order] of Object.entries(store.order)) {
        merged.order[provider] = Array.from(new Set([...(merged.order[provider] || []), ...(order || [])]))
      }
    }
    if (store.lastGood) {
      merged.lastGood = {
        ...(merged.lastGood || {}),
        ...store.lastGood,
      }
    }
  }
  return merged
}

function mergeAuthProfileStates(...states: Array<AuthProfileStateStore | null | undefined>): AuthProfileStateStore {
  const merged: AuthProfileStateStore = { version: 1 }
  for (const state of states) {
    if (!state) continue
    merged.version = Math.max(merged.version, Number(state.version || 1))
    const { order, lastGood, usageStats, ...rest } = state
    delete (rest as Partial<AuthProfileStateStore>).version
    Object.assign(merged, rest)
    if (order) {
      merged.order = merged.order || {}
      for (const [provider, providerOrder] of Object.entries(order)) {
        merged.order[provider] = Array.from(new Set([...(merged.order[provider] || []), ...(providerOrder || [])]))
      }
    }
    if (lastGood) {
      merged.lastGood = {
        ...(merged.lastGood || {}),
        ...lastGood,
      }
    }
    if (usageStats) {
      merged.usageStats = {
        ...(merged.usageStats || {}),
        ...usageStats,
      }
    }
  }
  return merged
}

function readAuthProfileSqliteJson(agentDir: string, table: 'auth_profile_store' | 'auth_profile_state', keyColumn: 'store_key' | 'state_key', jsonColumn: 'store_json' | 'state_json') {
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return null
    const sqlitePath = authProfileSqlitePath(agentDir)
    if (!existsSync(sqlitePath)) return null
    db = new sqlite.DatabaseSync(sqlitePath, { readOnly: true })
    const row = db.prepare(`SELECT ${jsonColumn} AS json FROM ${table} WHERE ${keyColumn} = ?`).get?.('primary') as { json?: unknown } | undefined
    const raw = typeof row?.json === 'string' ? row.json : ''
    return raw ? parseLooseJsonObject(raw) : null
  } catch {
    return null
  } finally {
    db?.close?.()
  }
}

function readAuthProfileSqliteStore(agentDir: string): AuthProfileStore | null {
  return normalizeAuthProfileStore(readAuthProfileSqliteJson(agentDir, 'auth_profile_store', 'store_key', 'store_json') as Partial<AuthProfileStore> | null)
}

function readAuthProfileSqliteState(agentDir: string): AuthProfileStateStore | null {
  return normalizeAuthProfileState(readAuthProfileSqliteJson(agentDir, 'auth_profile_state', 'state_key', 'state_json') as Partial<AuthProfileStateStore> | null)
}

function authProfileStateFromStore(store: AuthProfileStore): AuthProfileStateStore | null {
  const state: AuthProfileStateStore = { version: 1 }
  if (store.order && Object.keys(store.order).length) state.order = store.order
  if (store.lastGood && Object.keys(store.lastGood).length) state.lastGood = store.lastGood
  return state.order || state.lastGood ? state : null
}

async function writeAuthProfileSqlite(agentDir: string, store: AuthProfileStore, state = authProfileStateFromStore(store)) {
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return
    await fs.mkdir(agentDir, { recursive: true })
    db = new sqlite.DatabaseSync(authProfileSqlitePath(agentDir))
    db.exec?.('PRAGMA busy_timeout = 5000;')
    db.exec?.(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        meta_key TEXT NOT NULL PRIMARY KEY,
        role TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        agent_id TEXT,
        app_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_profile_store (
        store_key TEXT NOT NULL PRIMARY KEY,
        store_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_profile_state (
        state_key TEXT NOT NULL PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const now = Date.now()
    const agentId = inferOpenClawAgentIdFromAgentDir(agentDir)
    db.exec?.('BEGIN IMMEDIATE;')
    try {
      db.prepare(`
        INSERT INTO schema_meta (meta_key, role, schema_version, agent_id, app_version, created_at, updated_at)
        VALUES ('primary', 'agent', 1, ?, NULL, ?, ?)
        ON CONFLICT(meta_key) DO UPDATE SET
          role = 'agent',
          schema_version = 1,
          agent_id = excluded.agent_id,
          updated_at = excluded.updated_at
      `).run?.(agentId, now, now)
      db.prepare(`
        INSERT INTO auth_profile_store (store_key, store_json, updated_at)
        VALUES ('primary', ?, ?)
        ON CONFLICT(store_key) DO UPDATE SET
          store_json = excluded.store_json,
          updated_at = excluded.updated_at
      `).run?.(JSON.stringify({ version: 1, profiles: store.profiles }), now)
      if (state) {
        db.prepare(`
          INSERT INTO auth_profile_state (state_key, state_json, updated_at)
          VALUES ('primary', ?, ?)
          ON CONFLICT(state_key) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `).run?.(JSON.stringify(state), now)
      } else {
        db.prepare(`DELETE FROM auth_profile_state WHERE state_key = 'primary'`).run?.()
      }
      db.exec?.('COMMIT;')
    } catch (error) {
      db.exec?.('ROLLBACK;')
      throw error
    }
  } catch (error) {
    console.warn(`[auth] failed to write OpenClaw SQLite auth profile store for ${agentDir}:`, error)
  } finally {
    db?.close?.()
  }
}

async function writeAuthProfileStateSqlite(agentDir: string, state: AuthProfileStateStore | null) {
  const store = await readAuthProfileStore(agentDir)
  const storeState = authProfileStateFromStore(store)
  const mergedState = state
    ? {
        version: 1,
        order: {
          ...(storeState?.order || {}),
          ...(state.order || {}),
        },
        lastGood: {
          ...(storeState?.lastGood || {}),
          ...(state.lastGood || {}),
        },
        ...(state.usageStats ? { usageStats: state.usageStats } : {}),
      }
    : storeState
  await writeAuthProfileSqlite(agentDir, store, mergedState)
}

function authProfileProvidersFor(provider: string) {
  return AUTH_PROVIDER_PROFILE_ALIASES[provider] || [provider]
}

function authProfileIdFor(provider: string, mode: AuthMode) {
  if (provider === 'openai' && mode === 'oauth') return 'openai:chatgpt-default'
  return mode === 'oauth' ? `${provider}:oauth-default` : `${provider}:default`
}

function authProfileOAuthTargetsFor(provider: string) {
  return authProfileProvidersFor(provider).map((authProvider) => ({
    provider: authProvider,
    profileId: authProfileIdFor(authProvider, 'oauth'),
  }))
}

function prependAuthProfileForProvider(store: AuthProfileStore, provider: string, profileId: string) {
  store.order = {
    ...(store.order || {}),
    [provider]: Array.from(new Set([profileId, ...(store.order?.[provider] || [])])),
  }
  store.lastGood = {
    ...(store.lastGood || {}),
    [provider]: profileId,
  }
}

function preferredOpenAiCodexOrder(existing: string[] | undefined) {
  const preferred = authProfileIdFor('openai', 'oauth')
  return Array.from(
    new Set([
      preferred,
      ...(existing || []).filter((profileId) => !profileId.toLowerCase().startsWith('openai-codex:') && profileId !== preferred),
    ]),
  )
}

function preferOpenAiCodexOAuthProfile(store: AuthProfileStore) {
  const profileId = authProfileIdFor('openai', 'oauth')
  if (!store.profiles[profileId]) return
  store.order = {
    ...(store.order || {}),
    openai: preferredOpenAiCodexOrder(store.order?.openai),
  }
  store.lastGood = {
    ...(store.lastGood || {}),
    openai: profileId,
  }
}

function removeLegacyOpenAiCodexAuthProfiles(store: AuthProfileStore) {
  const removedProfileIds = new Set<string>()
  for (const [profileId, credential] of Object.entries(store.profiles)) {
    if (profileId.toLowerCase().startsWith('openai-codex:') || credential.provider === 'openai-codex') {
      delete store.profiles[profileId]
      removedProfileIds.add(profileId)
    }
  }
  if (store.order?.['openai-codex']) {
    for (const profileId of store.order['openai-codex']) removedProfileIds.add(profileId)
    delete store.order['openai-codex']
  }
  if (store.lastGood?.['openai-codex']) {
    removedProfileIds.add(store.lastGood['openai-codex'])
    delete store.lastGood['openai-codex']
  }
  for (const provider of Object.keys(store.order || {})) {
    store.order![provider] = store.order![provider].filter((profileId) => !removedProfileIds.has(profileId))
    if (!store.order![provider].length) delete store.order![provider]
  }
  for (const [provider, profileId] of Object.entries(store.lastGood || {})) {
    if (removedProfileIds.has(profileId)) delete store.lastGood![provider]
  }
}

async function readAuthProfileState(agentDir: string): Promise<AuthProfileStateStore> {
  const statePath = path.join(agentDir, 'auth-state.json')
  let jsonState: AuthProfileStateStore | null = null
  try {
    const raw = await fs.readFile(statePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AuthProfileStateStore>
    jsonState = normalizeAuthProfileState(parsed)
  } catch {
    // Missing auth-state.json is fine; OpenClaw creates it lazily.
  }
  return mergeAuthProfileStates(jsonState, readAuthProfileSqliteState(agentDir))
}

function preferOpenAiCodexOAuthInState(state: AuthProfileStateStore) {
  const profileId = authProfileIdFor('openai', 'oauth')
  state.order = {
    ...(state.order || {}),
    openai: preferredOpenAiCodexOrder(state.order?.openai),
  }
  delete state.order['openai-codex']
  state.lastGood = {
    ...(state.lastGood || {}),
    openai: profileId,
  }
  delete state.lastGood['openai-codex']
  if (state.usageStats) {
    delete state.usageStats['openai-codex:default']
    const apiKeyStats = state.usageStats['openai:default']
    if (apiKeyStats?.cooldownReason === 'rate_limit') {
      delete apiKeyStats.cooldownUntil
      delete apiKeyStats.cooldownReason
      delete apiKeyStats.cooldownModel
    }
  }
}

async function readAuthProfileStore(agentDir: string): Promise<AuthProfileStore> {
  const authPath = path.join(agentDir, 'auth-profiles.json')
  let jsonStore: AuthProfileStore | null = null
  try {
    const raw = await fs.readFile(authPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AuthProfileStore>
    jsonStore = normalizeAuthProfileStore(parsed)
  } catch {
    // Missing auth-profiles.json is created when saving a key.
  }
  return mergeAuthProfileStores(jsonStore, readAuthProfileSqliteStore(agentDir))
}

export function isOAuthCredentialUsable(oauth: LocalOAuthCredential | undefined): oauth is LocalOAuthCredential {
  return Boolean(oauth?.accessToken?.trim() || oauth?.refreshToken?.trim())
}

function authProfileCredentialUsable(credential: AuthProfileCredential | undefined) {
  if (!credential) return false
  if (credential.type === 'api_key') return Boolean(credential.key?.trim())
  return Boolean(credential.access?.trim() || credential.refresh?.trim())
}

function authProfileProviderIdsFor(provider: string) {
  if (provider === 'openai-codex') return ['openai']
  return authProfileProvidersFor(provider)
}

function authProfileCredentialsForProvider(store: AuthProfileStore | null | undefined, provider: string) {
  if (!store) return []
  const providerIds = new Set(authProfileProviderIdsFor(provider))
  const credentials = Object.entries(store.profiles || {}).filter(([profileId, credential]) => {
    if (provider === 'openai-codex') {
      return (
        profileId === authProfileIdFor('openai-codex', 'oauth') ||
        profileId.toLowerCase().startsWith('openai-codex:') ||
        credential.provider === 'openai-codex'
      )
    }
    return providerIds.has(credential.provider)
  })
  return credentials.map(([, credential]) => credential)
}

function authProfileStoreHasProvider(store: AuthProfileStore | null | undefined, provider: string, mode?: AuthMode) {
  return authProfileCredentialsForProvider(store, provider).some((credential) => (
    authProfileCredentialUsable(credential) &&
    (!mode || (mode === 'apiKey' ? credential.type === 'api_key' : credential.type === 'oauth'))
  ))
}

function localOAuthFromAuthProfileCredential(credential: AuthProfileCredential | undefined): LocalOAuthCredential | null {
  if (!credential || credential.type !== 'oauth') return null
  if (!credential.access?.trim() && !credential.refresh?.trim()) return null
  return {
    ...(credential.access ? { accessToken: credential.access } : {}),
    ...(credential.refresh ? { refreshToken: credential.refresh } : {}),
    ...(Number.isFinite(credential.expires) ? { expiresAt: credential.expires } : {}),
    ...(credential.email ? { email: credential.email } : {}),
    ...(credential.accountId ? { accountId: credential.accountId } : {}),
    ...(credential.idToken ? { idToken: credential.idToken } : {}),
    ...(credential.projectId ? { projectId: credential.projectId } : {}),
  }
}

function authEnvFromProviders(authEnvMap: Record<string, string[]>, providers: Record<string, { mode: 'oauth' | 'apiKey'; apiKey?: string }> | undefined) {
  const env: Record<string, string> = {}
  for (const [provider, settings] of Object.entries(providers || {})) {
    const apiKey = settings.apiKey?.trim()
    if (!apiKey) continue
    const envKeys = authEnvMap[provider] || []
    for (const envKey of envKeys) env[envKey] = apiKey
  }
  return env
}

export function createProviderAuthService(options: ProviderAuthServiceOptions) {
  const localAuthStore: LocalAuthStore = { providers: {} }
  let localAuthStoreHydrated = false
  let localAuthStoreLoadPromise: Promise<LocalAuthStore> | null = null

  async function loadLocalAuthStore(): Promise<LocalAuthStore> {
    const sqliteStore = normalizeLocalAuthStore(
      options.readControlCenterStateRecord<LocalAuthStore>(options.localAuthStateKey),
    )
    if (sqliteStore) return sqliteStore

    const legacyStore = await readLegacyJsonState(options.localAuthPath, normalizeLocalAuthStore)
    if (legacyStore) {
      options.writeControlCenterStateRecord(options.localAuthStateKey, legacyStore, options.localAuthPath)
      return legacyStore
    }

    return { providers: {} }
  }

  async function saveLocalAuthStore(next: LocalAuthStore) {
    if (options.writeControlCenterStateRecord(options.localAuthStateKey, next, options.localAuthPath)) return
    await options.writePrivateJsonFileAtomically(options.localAuthPath, next)
  }

  async function ensureLocalAuthStoreLoaded(): Promise<LocalAuthStore> {
    if (localAuthStoreHydrated) return localAuthStore
    if (!localAuthStoreLoadPromise) {
      localAuthStoreLoadPromise = loadLocalAuthStore()
        .then((store) => {
          localAuthStore.providers = {
            ...(store.providers || {}),
            ...(localAuthStore.providers || {}),
          }
          localAuthStoreHydrated = true
          return localAuthStore
        })
        .catch((error) => {
          localAuthStoreLoadPromise = null
          throw error
        })
    }
    return localAuthStoreLoadPromise
  }

  async function writeOpenAiCodexAuthStatePreference(agentDir: string) {
    const statePath = path.join(agentDir, 'auth-state.json')
    const state = await readAuthProfileState(agentDir)
    preferOpenAiCodexOAuthInState(state)
    await options.writePrivateJsonFileAtomically(statePath, state)
    await writeAuthProfileStateSqlite(agentDir, state)
  }

  async function writeProviderApiKeyAuthProfiles(agentDir: string, provider: string, apiKey: string) {
    const key = apiKey.trim()
    if (!key) return

    const authPath = path.join(agentDir, 'auth-profiles.json')
    const store = await readAuthProfileStore(agentDir)
    const providers = authProfileProvidersFor(provider)

    for (const authProvider of providers) {
      const profileId = authProfileIdFor(authProvider, 'apiKey')
      store.profiles[profileId] = {
        type: 'api_key',
        provider: authProvider,
        key,
      }
      prependAuthProfileForProvider(store, authProvider, profileId)
    }
    if (provider === 'openai') preferOpenAiCodexOAuthProfile(store)

    await options.writePrivateJsonFileAtomically(authPath, store)
    await writeAuthProfileSqlite(agentDir, store)
    if (provider === 'openai') await writeOpenAiCodexAuthStatePreference(agentDir).catch(() => undefined)
  }

  async function writeProviderOAuthAuthProfiles(agentDir: string, provider: string, oauth: LocalOAuthCredential) {
    const access = oauth.accessToken?.trim()
    const refresh = oauth.refreshToken?.trim()
    if (!access && !refresh) return

    const authPath = path.join(agentDir, 'auth-profiles.json')
    const store = await readAuthProfileStore(agentDir)
    if (provider === 'openai') removeLegacyOpenAiCodexAuthProfiles(store)
    for (const { provider: authProvider, profileId } of authProfileOAuthTargetsFor(provider)) {
      store.profiles[profileId] = {
        type: 'oauth',
        provider: authProvider,
        copyToAgents: true,
        ...(access ? { access } : {}),
        ...(refresh ? { refresh } : {}),
        ...(Number.isFinite(oauth.expiresAt) ? { expires: oauth.expiresAt } : {}),
        ...(oauth.email ? { email: oauth.email } : {}),
        ...(oauth.accountId ? { accountId: oauth.accountId } : {}),
        ...(oauth.idToken ? { idToken: oauth.idToken } : {}),
        ...(oauth.projectId ? { projectId: oauth.projectId } : {}),
      }
      prependAuthProfileForProvider(store, authProvider, profileId)
    }
    if (provider === 'openai') preferOpenAiCodexOAuthProfile(store)

    await options.writePrivateJsonFileAtomically(authPath, store)
    await writeAuthProfileSqlite(agentDir, store)
    if (provider === 'openai') await writeOpenAiCodexAuthStatePreference(agentDir).catch(() => undefined)
  }

  async function syncUserCodexAuthToAgentHome(agentDir: string): Promise<boolean> {
    const sourcePath = path.join(options.homeDir, '.codex', 'auth.json')
    let sourceRaw = ''
    try {
      sourceRaw = await fs.readFile(sourcePath, 'utf-8')
      if (!isChatGptCodexAuthJson(JSON.parse(sourceRaw))) return false
    } catch {
      return false
    }

    const targetPath = path.join(agentDir, 'codex-home', 'auth.json')
    const existingRaw = await fs.readFile(targetPath, 'utf-8').catch(() => '')
    if (existingRaw === sourceRaw) return true
    await options.writePrivateTextFileAtomically(targetPath, sourceRaw.endsWith('\n') ? sourceRaw : `${sourceRaw}\n`)
    return true
  }

  async function persistProviderAuth(provider: string, apiKey: string) {
    await ensureLocalAuthStoreLoaded()
    localAuthStore.providers[provider] = {
      ...(localAuthStore.providers[provider] || {}),
      mode: 'apiKey',
      apiKey,
    }
    await saveLocalAuthStore(localAuthStore)

    await writeProviderApiKeyAuthProfiles(options.openclawAgentFolder('main'), provider, apiKey)
    const config = await options.readOpenclawConfig().catch(() => null)
    for (const entry of config?.agents?.list || []) {
      const agentId = entry.id
      if (!agentId || !options.isValidAgentId(agentId)) continue
      await writeProviderApiKeyAuthProfiles(options.openclawAgentFolder(agentId), provider, apiKey)
    }
    if (provider === 'openrouter') {
      const nextConfig = config || options.createInitialOpenclawConfig()
      options.ensureOpenRouterPluginEnabledForProviderAuth(nextConfig)
      options.ensureOpenRouterModelCatalogAllowlist(nextConfig)
      await options.writeOpenclawConfig(nextConfig)
    }
    if (provider === 'meta') {
      const nextConfig = config || options.createInitialOpenclawConfig()
      options.ensureBundledProviderPluginEnabledForProviderAuth(nextConfig, 'meta')
      await options.writeOpenclawConfig(nextConfig)
    }
    options.invalidateAvailableModelsForAuthChange()
  }

  async function persistProviderOAuth(provider: string, oauth: LocalOAuthCredential) {
    await ensureLocalAuthStoreLoaded()
    const now = new Date().toISOString()
    const previous = localAuthStore.providers[provider] || {}
    localAuthStore.providers[provider] = {
      ...previous,
      mode: 'oauth',
      oauth: {
        ...(previous.oauth || {}),
        ...oauth,
        createdAt: previous.oauth?.createdAt || oauth.createdAt || now,
        updatedAt: now,
      },
    }
    await saveLocalAuthStore(localAuthStore)

    const persisted = localAuthStore.providers[provider].oauth
    if (!persisted) return

    await writeProviderOAuthAuthProfiles(options.openclawAgentFolder('main'), provider, persisted)
    const config = await options.readOpenclawConfig().catch(() => null)
    for (const entry of config?.agents?.list || []) {
      const agentId = entry.id
      if (!agentId || !options.isValidAgentId(agentId)) continue
      await writeProviderOAuthAuthProfiles(options.openclawAgentFolder(agentId), provider, persisted)
    }
    options.invalidateAvailableModelsForAuthChange()
  }

  async function updateProviderOAuthSettings(provider: string, settings: { projectId?: string }) {
    const oauthProvider = provider === 'google-vertex' ? 'google' : provider
    await ensureLocalAuthStoreLoaded()
    const existing = localAuthStore.providers[oauthProvider]?.oauth || localOAuthFromMainAuthProfile(oauthProvider) || undefined
    if (!isOAuthCredentialUsable(existing)) {
      throw new Error(`No ${oauthProvider} OAuth connection is available to update.`)
    }
    await persistProviderOAuth(oauthProvider, {
      ...existing,
      ...(settings.projectId?.trim() ? { projectId: settings.projectId.trim() } : { projectId: undefined }),
    })
  }

  async function syncStoredProviderAuthProfiles(provider: string, config: LocalProviderAuth) {
    if (config.apiKey?.trim()) {
      await writeProviderApiKeyAuthProfiles(options.openclawAgentFolder('main'), provider, config.apiKey.trim())
    }
    if (config.oauth) {
      await writeProviderOAuthAuthProfiles(options.openclawAgentFolder('main'), provider, config.oauth)
    }

    const openclawConfig = await options.readOpenclawConfig().catch(() => null)
    for (const entry of openclawConfig?.agents?.list || []) {
      const agentId = entry.id
      if (!agentId || !options.isValidAgentId(agentId)) continue
      if (config.apiKey?.trim()) {
        await writeProviderApiKeyAuthProfiles(options.openclawAgentFolder(agentId), provider, config.apiKey.trim())
      }
      if (config.oauth) {
        await writeProviderOAuthAuthProfiles(options.openclawAgentFolder(agentId), provider, config.oauth)
      }
    }
    if (provider === 'openai') {
      await syncUserCodexAuthToAgentHome(options.openclawAgentFolder('main')).catch(() => undefined)
      for (const entry of openclawConfig?.agents?.list || []) {
        const agentId = entry.id
        if (!agentId || !options.isValidAgentId(agentId)) continue
        await syncUserCodexAuthToAgentHome(options.openclawAgentFolder(agentId)).catch(() => undefined)
      }
    }
  }

  async function removeProviderAuthProfiles(agentDir: string, provider: string) {
    const authPath = path.join(agentDir, 'auth-profiles.json')
    const store = await readAuthProfileStore(agentDir)
    const removedProfileIds = new Set<string>()
    for (const authProvider of authProfileProvidersFor(provider)) {
      const managedProfileIds = new Set([
        authProfileIdFor(authProvider, 'apiKey'),
        authProfileIdFor(authProvider, 'oauth'),
      ])
      if (provider === 'openai') {
        managedProfileIds.add(authProfileIdFor('openai', 'oauth'))
        for (const profileId of Object.keys(store.profiles)) {
          if (profileId.toLowerCase().startsWith('openai-codex:')) managedProfileIds.add(profileId)
        }
      }
      for (const [profileId, credential] of Object.entries(store.profiles)) {
        if (managedProfileIds.has(profileId) || credential.provider === authProvider) {
          delete store.profiles[profileId]
          managedProfileIds.add(profileId)
          removedProfileIds.add(profileId)
        }
      }
      if (store.order?.[authProvider]) store.order[authProvider] = store.order[authProvider].filter((id) => !managedProfileIds.has(id))
      if (store.lastGood?.[authProvider] && managedProfileIds.has(store.lastGood[authProvider])) delete store.lastGood[authProvider]
    }
    if (provider === 'openai') {
      if (store.order?.['openai-codex']) {
        for (const profileId of store.order['openai-codex']) removedProfileIds.add(profileId)
        delete store.order['openai-codex']
      }
      if (store.lastGood?.['openai-codex']) {
        removedProfileIds.add(store.lastGood['openai-codex'])
        delete store.lastGood['openai-codex']
      }
      for (const providerKey of Object.keys(store.order || {})) {
        store.order![providerKey] = store.order![providerKey].filter((id) => !removedProfileIds.has(id))
        if (!store.order![providerKey].length) delete store.order![providerKey]
      }
      for (const [providerKey, profileId] of Object.entries(store.lastGood || {})) {
        if (removedProfileIds.has(profileId)) delete store.lastGood![providerKey]
      }
    }
    await options.writePrivateJsonFileAtomically(authPath, store)
    await writeAuthProfileSqlite(agentDir, store)
  }

  async function removeProviderAuth(provider: string) {
    await ensureLocalAuthStoreLoaded()
    delete localAuthStore.providers[provider]
    await saveLocalAuthStore(localAuthStore)

    await removeProviderAuthProfiles(options.openclawAgentFolder('main'), provider)
    const config = await options.readOpenclawConfig().catch(() => null)
    for (const entry of config?.agents?.list || []) {
      const agentId = entry.id
      if (!agentId || !options.isValidAgentId(agentId)) continue
      await removeProviderAuthProfiles(options.openclawAgentFolder(agentId), provider)
    }
    options.invalidateAvailableModelsForAuthChange()
  }

  function mainAuthProfileSqliteStore() {
    return readAuthProfileSqliteStore(options.openclawAgentFolder('main'))
  }

  function localOAuthFromMainAuthProfile(provider: string): LocalOAuthCredential | null {
    const store = mainAuthProfileSqliteStore()
    const oauthCredential = authProfileCredentialsForProvider(store, provider)
      .find((credential) => credential.type === 'oauth' && authProfileCredentialUsable(credential))
    return localOAuthFromAuthProfileCredential(oauthCredential)
  }

  function mainAuthProfileEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    const store = mainAuthProfileSqliteStore()
    if (!store) return env
    for (const credential of Object.values(store.profiles || {})) {
      if (credential.type !== 'api_key') continue
      const key = credential.key?.trim()
      if (!key) continue
      const envKeys = options.authEnvMap[credential.provider] || []
      for (const envKey of envKeys) env[envKey] ||= key
    }
    return env
  }

  function getLocalAuthEnv(): Record<string, string> {
    const env: Record<string, string> = mainAuthProfileEnv()
    for (const [provider, config] of Object.entries(localAuthStore.providers)) {
      const apiKey = config.apiKey?.trim()
      if (!apiKey) continue
      const envKeys = options.authEnvMap[provider] || []
      for (const envKey of envKeys) {
        env[envKey] = apiKey
      }
    }
    return env
  }

  async function getAgentAuthEnv(agentId?: string) {
    await ensureLocalAuthStoreLoaded().catch(() => undefined)
    const globalEnv = getLocalAuthEnv()
    if (!agentId) return {}
    try {
      await syncUserCodexAuthToAgentHome(options.openclawAgentFolder(agentId)).catch(() => undefined)
      const parsed = await options.readAgentLocalConfigIfPresent(agentId)
      return {
        ...globalEnv,
        ...authEnvFromProviders(options.authEnvMap, parsed?.auth?.providers),
      }
    } catch {
      return globalEnv
    }
  }

  function isProviderConfigured(provider: string): boolean {
    if (provider === 'google-vertex') return options.isGoogleVertexConfigured()
    const envKeys = options.authEnvMap[provider] || []
    for (const envKey of envKeys) {
      if (process.env[envKey]) return true
    }
    const oauthEnvKeys = options.authProviderCatalog[provider]?.oauthEnvKeys || []
    if (oauthEnvKeys.some((envKey) => Boolean(process.env[envKey]?.trim()))) return true
    if (options.configuredProviderApiKeyMarker(provider)) return true
    const stored = authProfileProvidersFor(provider)
      .map((authProvider) => localAuthStore.providers[authProvider]?.apiKey)
      .find((apiKey) => apiKey?.trim())
    if (stored?.trim()) return true
    if (options.authProviderCatalog[provider]?.oauth && isOAuthCredentialUsable(localAuthStore.providers[provider]?.oauth)) return true
    if (authProfileStoreHasProvider(mainAuthProfileSqliteStore(), provider)) return true
    return false
  }

  function providerAuthStatus(provider: string, statusOptions: ProviderAuthStatusOptions = {}) {
    const catalog = options.authProviderCatalog[provider]
    const envKeys = options.authEnvMap[provider] || []
    const oauthEnvKeys = catalog?.oauthEnvKeys || []
    const gcloud = provider === 'google-vertex' ? options.googleVertexGcloudStatus(statusOptions) : undefined
    const vertexOAuthConfigured = provider === 'google-vertex' ? options.isGoogleVertexLocalOAuthConfigured({}, statusOptions) : false
    // Google Vertex and direct Gemini deliberately share one local Google OAuth
    // credential. Keep the status surface provider-specific while resolving the
    // underlying credential from the canonical Google record.
    const oauthProvider = provider === 'google-vertex' ? 'google' : provider
    const envConfigured = envKeys.some((envKey) => Boolean(process.env[envKey]?.trim()))
    const oauthEnvConfigured = oauthEnvKeys.some((envKey) => Boolean(process.env[envKey]?.trim()))
    const configApiKeyConfigured = Boolean(options.configuredProviderApiKeyMarker(provider))
    const sqliteStore = mainAuthProfileSqliteStore()
    const sqliteApiKeyConfigured = authProfileStoreHasProvider(sqliteStore, provider, 'apiKey')
    const sqliteOAuthConfigured = authProfileStoreHasProvider(sqliteStore, oauthProvider, 'oauth')
    const subscriptionConfigured = Boolean(catalog?.subscriptionAuth && sqliteOAuthConfigured)
    const storedApiKey = authProfileProvidersFor(provider).some((authProvider) =>
      Boolean(localAuthStore.providers[authProvider]?.apiKey?.trim()),
    )
    const local = localAuthStore.providers[oauthProvider] || {}
    const sqliteOAuth = localOAuthFromMainAuthProfile(oauthProvider)
    const oauthConfigured = Boolean(catalog?.oauth && (oauthEnvConfigured || isOAuthCredentialUsable(local.oauth) || sqliteOAuthConfigured))
    const oauthAvailability = oauthProvider === 'google'
      ? options.googleOAuthClientConfigStatus()
      : oauthProvider === 'openai' || oauthProvider === 'anthropic'
        ? { available: true, missing: [] as string[] }
        : { available: false, missing: [] as string[] }
    const providerOAuthConfigured = provider === 'google-vertex' ? vertexOAuthConfigured : oauthConfigured
    const configured = envConfigured || oauthEnvConfigured || configApiKeyConfigured || storedApiKey || sqliteApiKeyConfigured || providerOAuthConfigured || subscriptionConfigured || Boolean((gcloud as { configured?: unknown } | undefined)?.configured)
    const defaultMode: AuthMode = catalog?.oauth && !envKeys.length ? 'oauth' : oauthConfigured ? 'oauth' : 'apiKey'

    return {
      provider,
      label: catalog?.label || provider,
      configured,
      mode: local.mode || defaultMode,
      envKeys,
      docs: catalog?.docs,
      apiKeyUrl: catalog?.apiKeyUrl,
      optionalAuth: Boolean(catalog?.optionalAuth),
      stored: storedApiKey || sqliteApiKeyConfigured || oauthConfigured || subscriptionConfigured || vertexOAuthConfigured || Boolean((gcloud as { configured?: unknown } | undefined)?.configured),
      apiKey: {
        configured: envConfigured || configApiKeyConfigured || storedApiKey || sqliteApiKeyConfigured,
        stored: configApiKeyConfigured || storedApiKey || sqliteApiKeyConfigured,
        envConfigured,
        configConfigured: configApiKeyConfigured,
        envKeys,
      },
      ...(gcloud ? { gcloud } : {}),
      ...(catalog?.subscriptionAuth
        ? {
            subscriptionAuth: {
              supported: true,
              configured: subscriptionConfigured,
              label: catalog.subscriptionAuth.label,
              docs: catalog.subscriptionAuth.docs,
              setupCommand: catalog.subscriptionAuth.setupCommand,
            },
          }
        : {}),
      oauth: catalog?.oauth
        ? {
            supported: true,
            configured: oauthConfigured,
            available: oauthAvailability.available,
            missing: oauthAvailability.missing,
            docs: catalog.oauth.docs,
            redirectUri: catalog.oauth.redirectUri,
            projectId: oauthProvider === 'google' ? local.oauth?.projectId || sqliteOAuth?.projectId || options.resolveGoogleProjectId() || undefined : undefined,
            accountId: local.oauth?.accountId || sqliteOAuth?.accountId || undefined,
            email: local.oauth?.email || sqliteOAuth?.email || undefined,
            expiresAt: local.oauth?.expiresAt || sqliteOAuth?.expiresAt || undefined,
            refreshAvailable: Boolean(local.oauth?.refreshToken?.trim() || sqliteOAuth?.refreshToken?.trim()),
            clientIdEnvKeys: catalog.oauth.clientIdEnvKeys,
            projectIdEnvKeys: catalog.oauth.projectIdEnvKeys,
          }
        : {
            supported: false,
            configured: false,
            available: false,
            missing: [] as string[],
          },
    }
  }

  function modelAuthProblem(modelId: string | undefined) {
    const canonicalModelId = options.canonicalAgentModelId(modelId)
    if (options.isOpenAiCodexSubscriptionModel(canonicalModelId)) {
      if (isOAuthCredentialUsable(localAuthStore.providers.openai?.oauth)) return null
      if (authProfileStoreHasProvider(mainAuthProfileSqliteStore(), 'openai')) return null
      if (isProviderConfigured('openai')) return null
      return {
        provider: 'openai',
        providerStatus: providerAuthStatus('openai'),
      }
    }
    const provider = canonicalModelId.split('/')[0] || ''
    if (!provider || !options.authProviderCatalog[provider]) return null
    if (options.authProviderCatalog[provider]?.optionalAuth) return null
    if (isProviderConfigured(provider)) return null
    return {
      provider,
      providerStatus: providerAuthStatus(provider),
    }
  }

  function getLocalProviderAuth(provider: string) {
    return localAuthStore.providers[provider]
  }

  function getLocalProviderMode(provider: string) {
    return localAuthStore.providers[provider]?.mode
  }

  function getLocalProviderOAuth(provider: string) {
    return localAuthStore.providers[provider]?.oauth
  }

  return {
    ensureLocalAuthStoreLoaded,
    getAgentAuthEnv,
    getLocalAuthEnv,
    getLocalAuthStore: () => localAuthStore,
    getLocalProviderAuth,
    getLocalProviderMode,
    getLocalProviderOAuth,
    isOAuthCredentialUsable,
    isProviderConfigured,
    localOAuthFromMainAuthProfile,
    modelAuthProblem,
    persistProviderAuth,
    persistProviderOAuth,
    updateProviderOAuthSettings,
    providerAuthStatus,
    removeProviderAuth,
    syncStoredProviderAuthProfiles,
    syncUserCodexAuthToAgentHome,
  }
}

function isChatGptCodexAuthJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const tokens = record.tokens && typeof record.tokens === 'object' && !Array.isArray(record.tokens)
    ? record.tokens as Record<string, unknown>
    : {}
  return (
    String(record.auth_mode || '').toLowerCase() === 'chatgpt' &&
    typeof tokens.access_token === 'string' &&
    typeof tokens.refresh_token === 'string'
  )
}

export type ProviderAuthService = ReturnType<typeof createProviderAuthService>
