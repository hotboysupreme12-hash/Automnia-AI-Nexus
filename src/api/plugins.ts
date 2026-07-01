import { apiErrorMessage, apiRequest, type ApiRequestOptions } from './client'

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

export type PluginEntry = {
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

export type PluginsResponse = {
  plugins: PluginEntry[]
  configPath?: string
  cliError?: string
  cache?: {
    source: 'openclaw' | 'bundled'
    refreshedAt: number
    refreshing: boolean
  }
}

export type PluginSearchResult = {
  id: string
  name: string
  description: string
  version?: string
  source: string
  installSpec: string
  packageName?: string
  publisher?: string
  installed?: boolean
  verified?: boolean
  score?: number
}

export type PluginCommandResult = {
  command: string
  code: number
  stdout: string
  stderr: string
  output: string
  elapsedMs?: number
}

export type PluginInstallRepair = {
  applied: boolean
  reason: string
  actions: string[]
  retryArgs?: string[]
}

export type PluginRuntimeInspect = {
  pluginId: string
  status: string
  runtimeLoaded: boolean | null
  surfaces: Array<{ label: string; values: string[] }>
  command: PluginCommandResult
}

export type PluginRestartResponse = {
  restarted: boolean
  scheduled?: boolean
  detail: string
}

export type PluginRegistryRefreshResponse = {
  scheduled: boolean
  detail: string
}

export type ClawTalkSetupPayload = {
  installed: boolean
  configured: boolean
  enabled: boolean
  ready: boolean
  botConnected: boolean
  websocketServer: boolean
  actions: string[]
}

export type PluginApiPayload = PluginsResponse & {
  ok?: boolean
  error?: string
  detail?: string
  command?: PluginCommandResult
  doctor?: PluginCommandResult
  clawTalkSetup?: ClawTalkSetupPayload
  repair?: PluginInstallRepair
  inspect?: PluginRuntimeInspect
  restart?: PluginRestartResponse
  registryRefresh?: PluginRegistryRefreshResponse
  plugin?: PluginEntry | null
}

export type PluginSearchPayload = {
  results?: PluginSearchResult[]
  cliError?: string
}

type PluginInstallRequest = {
  spec: string
  pluginId?: string
  pin: boolean
  enable?: boolean
  restart?: boolean
}

async function pluginApiData<T>(path: string, options: ApiRequestOptions | undefined, fallbackMessage: string): Promise<T> {
  const result = await apiRequest<T>(path, { cache: 'no-store', ...(options || {}) })
  if (!result.ok) throw new Error(apiErrorMessage(result.error) || fallbackMessage)
  return result.data
}

export function pluginRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Plugin request timed out. Refresh again after the backend finishes.'
  }
  return error instanceof Error ? error.message : String(error)
}

export function runOpenClawPluginCommand(command: string): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    '/api/openclaw/command',
    {
      method: 'POST',
      body: {
        command,
        timeoutSeconds: 600,
        refreshPlugins: true,
      },
      timeoutMs: 620_000,
    },
    'OpenClaw command failed.',
  )
}

export function savePluginSetup(
  pluginId: string,
  values: Record<string, string>,
  providerAuth: Record<string, string>,
): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    `/api/plugins/${encodeURIComponent(pluginId)}/config`,
    {
      method: 'POST',
      body: {
        values,
        providerAuth,
        restart: true,
      },
      timeoutMs: 30_000,
    },
    'Plugin setup failed.',
  )
}

export function setupClawTalkPlugin(apiKey: string): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    '/api/plugins/clawtalk/setup',
    {
      method: 'POST',
      body: {
        apiKey,
        install: true,
        restart: true,
      },
      timeoutMs: 190_000,
    },
    'Plugin setup failed.',
  )
}

export function searchOpenClawPlugins(query: string, limit = 20): Promise<PluginSearchPayload> {
  return pluginApiData<PluginSearchPayload>(
    `/api/plugins/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    { timeoutMs: 130_000 },
    'Plugin search failed.',
  )
}

export function installOpenClawPlugin(request: PluginInstallRequest): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    '/api/plugins/install',
    {
      method: 'POST',
      body: {
        spec: request.spec,
        pluginId: request.pluginId,
        pin: request.pin,
        enable: request.enable ?? true,
        restart: request.restart ?? true,
      },
      timeoutMs: 260_000,
    },
    'Plugin install failed.',
  )
}

export function fetchPlugins(options: { force?: boolean } = {}): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    options.force ? '/api/plugins?refresh=1' : '/api/plugins',
    { timeoutMs: options.force ? 30_000 : 10_000 },
    'Plugin list failed.',
  )
}

export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    `/api/plugins/${encodeURIComponent(pluginId)}`,
    {
      method: 'POST',
      body: { enabled, restart: false },
      timeoutMs: 45_000,
    },
    'Plugin update failed.',
  )
}

export function updateOpenClawPlugin(pluginId: string): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    `/api/plugins/${encodeURIComponent(pluginId)}/update`,
    {
      method: 'POST',
      body: { restart: true },
      timeoutMs: 280_000,
    },
    'Plugin update failed.',
  )
}

export function updateAllOpenClawPlugins(): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    '/api/plugins/update-all',
    {
      method: 'POST',
      body: { restart: true },
      timeoutMs: 320_000,
    },
    'Plugin update failed.',
  )
}

export function inspectOpenClawPluginRuntime(pluginId: string): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    `/api/plugins/${encodeURIComponent(pluginId)}/inspect`,
    { method: 'POST', timeoutMs: 140_000 },
    'Plugin runtime inspect failed.',
  )
}

export function restartPluginGateway(): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    '/api/plugins/gateway/restart',
    { method: 'POST', timeoutMs: 90_000 },
    'Gateway restart failed.',
  )
}

export function uninstallOpenClawPlugin(pluginId: string): Promise<PluginApiPayload> {
  return pluginApiData<PluginApiPayload>(
    `/api/plugins/${encodeURIComponent(pluginId)}/uninstall`,
    {
      method: 'POST',
      body: { keepFiles: false, force: true, restart: true },
      timeoutMs: 280_000,
    },
    'Plugin uninstall failed.',
  )
}
