import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import type { LocalOAuthCredential } from './providerAuthService'

export const GOOGLE_VERTEX_PROJECT_ID_KEYS = ['GOOGLE_VERTEX_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT']
export const GOOGLE_VERTEX_LOCATION_KEYS = [
  'GOOGLE_VERTEX_LOCATION',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_REGION',
  'GCLOUD_LOCATION',
  'CLOUD_ML_REGION',
]
export const GOOGLE_VERTEX_ACCESS_TOKEN_KEYS = ['GOOGLE_VERTEX_ACCESS_TOKEN', 'GCLOUD_ACCESS_TOKEN']
export const GOOGLE_CLOUD_CLI_INSTALL_URL = 'https://cloud.google.com/sdk/docs/install'
export const GOOGLE_ADC_SETUP_SCRIPT_URL = 'https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh'
export const GOOGLE_ADC_SETUP_POWERSHELL_URL = 'https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.ps1'
export const GOOGLE_VERTEX_GLOBAL_LOCATION = 'global'
export const GOOGLE_VERTEX_DEFAULT_LOCATION = GOOGLE_VERTEX_GLOBAL_LOCATION
export const GOOGLE_VERTEX_ACCESS_TOKEN_CACHE_MS = 45 * 60 * 1000

export type GoogleVertexGcloudStatus = {
  supported: true
  installed: boolean
  authenticated: boolean
  configured: boolean
  credentialSource?: 'application-default' | 'gcloud' | 'environment' | 'local-oauth'
  projectId?: string
  location: string
  account?: string
  missing: string[]
  installUrl: string
  setupScript: GoogleVertexSetupScript
  commands: string[]
  source?: 'probe' | 'cache' | 'fast'
}

export type GoogleVertexSetupScript = {
  label: string
  command: string
}

export type ProviderRequestAuth =
  | { type: 'apiKey'; value: string; source: string }
  | { type: 'oauth'; accessToken: string; projectId?: string; location?: string; source: string }

export type GoogleOAuthClientConfig = {
  clientId: string
  clientSecret?: string
}

type GoogleApplicationDefaultAuthorizedUserCredential = {
  clientId: string
  clientSecret: string
  refreshToken: string
  projectId?: string
}

export type OpenAICodexAuthorizationFlow = {
  verifier: string
  redirectUri: string
  state: string
  url: string
}

export type OpenAICodexTokenExchangeResult =
  | {
      type: 'success'
      access: string
      refresh: string
      expires: number
    }
  | {
      type: 'failed'
      status?: number
      message: string
    }

export type OpenAICodexOAuthTesting = {
  createAuthorizationFlow: (originator?: string) => Promise<OpenAICodexAuthorizationFlow>
  exchangeAuthorizationCode: (
    code: string,
    verifier: string,
    redirectUri?: string,
  ) => Promise<OpenAICodexTokenExchangeResult>
}

export type OpenAICodexRefreshResult = {
  access: string
  refresh: string
  expires: number
  accountId?: string
  idToken?: string
}

type OpenAICodexOAuthModule = {
  loginOpenAICodex: (options: {
    originator?: string
    onAuth: (auth: { url: string; instructions?: string }) => void
    onProgress?: (message: string) => void
    onPrompt: (prompt: { message: string }) => Promise<string>
  }) => Promise<{
    access: string
    refresh: string
    expires: number
    accountId?: string
    idToken?: string
  }>
}

type OpenAICodexRefreshModule = {
  refreshOpenAICodexToken: (refreshToken: string) => Promise<OpenAICodexRefreshResult>
}

type OpenAICodexRuntimeModule = OpenAICodexOAuthModule & OpenAICodexRefreshModule & {
  testing?: OpenAICodexOAuthTesting
}

type SpawnSyncResultLike = {
  stdout?: string | Buffer
  stderr?: string | Buffer
  status?: number | null
  error?: Error
}

type SpawnSyncLike = (
  command: string,
  args: readonly string[],
  options: {
    encoding: 'utf-8'
    timeout: number
    shell: boolean
    env: NodeJS.ProcessEnv
    windowsHide?: boolean
  },
) => SpawnSyncResultLike

export type ProviderSetupServiceOptions = {
  electronResourcesPath?: () => string
  ensureLocalAuthStoreLoaded: () => Promise<unknown>
  existsSync?: (filePath: string) => boolean
  fetch?: typeof fetch
  getLocalProviderMode: (provider: string) => 'oauth' | 'apiKey' | undefined
  getLocalProviderOAuth: (provider: string) => LocalOAuthCredential | undefined
  googleOAuthClientIdKeys: string[]
  googleOAuthClientSecretKeys: string[]
  googleProjectIdKeys: string[]
  importModule?: (moduleUrl: string) => Promise<Record<string, unknown>>
  localOAuthFromMainAuthProfile: (provider: string) => LocalOAuthCredential | null
  now?: () => number
  openClawBin?: string
  openClawStateRoot: string
  persistProviderOAuth: (provider: 'google' | 'openai', oauth: LocalOAuthCredential) => Promise<unknown>
  platform?: NodeJS.Platform
  processEnv?: NodeJS.ProcessEnv
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string
  readdirSync?: typeof readdirSync
  refreshGoogleOAuthCredential: (oauth: LocalOAuthCredential) => Promise<LocalOAuthCredential>
  refreshOpenAICodexOAuthCredential: (oauth: LocalOAuthCredential) => Promise<LocalOAuthCredential>
  spawnSync?: SpawnSyncLike
  workspaceRoot: string
}

function uniqueStrings(...items: Array<unknown>): string[] {
  return Array.from(new Set(items.flat().filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())))
}

function isWindowsCommandScript(bin: string) {
  const lower = (bin.split(/[\\/]/).pop() || bin).toLowerCase()
  return lower === 'openclaw' || lower.endsWith('.cmd') || lower.endsWith('.bat')
}

function quoteCmdArgument(value: string) {
  if (!value) return '""'
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/(["^&|<>])/g, '^$1')
  return /[\s"^&|<>%]/.test(value) ? `"${escaped}"` : escaped
}

function windowsCmdShellSpec(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return {
    command: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArgument).join(' ')],
    shell: false,
  } as const
}

function shelllessSpawnSpecForCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  options: { wrapWindowsPathLookup?: boolean } = {},
) {
  const commandPath = platform === 'win32' ? path.win32 : path.posix
  if (
    platform === 'win32' &&
    (isWindowsCommandScript(command) ||
      (options.wrapWindowsPathLookup && !commandPath.isAbsolute(command) && !/\.(?:exe|com)$/i.test(command)))
  ) {
    return windowsCmdShellSpec(command, args, env)
  }
  return { command, args, shell: false } as const
}

function isOAuthCredentialUsable(oauth: LocalOAuthCredential | undefined | null): oauth is LocalOAuthCredential {
  return Boolean(oauth?.accessToken?.trim() || oauth?.refreshToken?.trim())
}

function cleanGcloudConfigValue(value: string) {
  const line = value.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || ''
  if (!line || line === '(unset)' || /^unset$/i.test(line)) return ''
  return line
}

function defaultImportModule(moduleUrl: string) {
  return import(moduleUrl) as Promise<Record<string, unknown>>
}

function spawnResultText(value: string | Buffer | undefined) {
  return Buffer.isBuffer(value) ? value.toString('utf-8') : String(value || '')
}

export function createProviderSetupService(options: ProviderSetupServiceOptions) {
  const processEnv = options.processEnv || process.env
  const hasExplicitProcessEnv = Boolean(options.processEnv)
  const platform = options.platform || process.platform
  const platformPath = platform === 'win32' ? path.win32 : path.posix
  const exists = options.existsSync || existsSync
  const readFile = options.readFileSync || readFileSync
  const readDir = options.readdirSync || readdirSync
  const spawn = options.spawnSync || (spawnSync as SpawnSyncLike)
  const fetch = options.fetch || globalThis.fetch
  const now = options.now || Date.now
  const importModule = options.importModule || defaultImportModule
  const googleProjectIdKeys = uniqueStrings(options.googleProjectIdKeys)
  const googleVertexProjectIdKeys = uniqueStrings('GOOGLE_VERTEX_PROJECT_ID', ...googleProjectIdKeys)

  let googleVertexGcloudStatusCache: { value: GoogleVertexGcloudStatus; expiresAt: number } | null = null
  let googleVertexAccessTokenCache: { value: string; expiresAt: number } | null = null
  let googleVertexGcloudCommandCache: string | null = null

  function resolveEnvValue(env: Record<string, string | undefined>, keys: string[]) {
    for (const key of keys) {
      const value = env[key]?.trim() || processEnv[key]?.trim()
      if (value) return value
    }
    return ''
  }

  function googleCloudSdkRootCandidates() {
    const homeDir = googleCloudHomeDir()
    const localAppData = resolveEnvValue({}, ['LOCALAPPDATA', 'LocalAppData'])
    const appData = resolveEnvValue({}, ['APPDATA', 'AppData'])
    const programFiles = resolveEnvValue({}, ['ProgramFiles', 'PROGRAMFILES'])
    const programFilesX86 = processEnv['ProgramFiles(x86)']?.trim() || processEnv.PROGRAMFILES_X86?.trim() || ''
    return uniqueStrings(
      resolveEnvValue({}, ['CLOUDSDK_ROOT_DIR', 'GCLOUD_SDK_ROOT', 'GOOGLE_CLOUD_SDK_HOME']),
      homeDir ? platformPath.join(homeDir, 'google-cloud-sdk') : '',
      localAppData ? platformPath.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk') : '',
      localAppData ? platformPath.join(localAppData, 'Programs', 'Google', 'Cloud SDK', 'google-cloud-sdk') : '',
      appData ? platformPath.join(appData, 'gcloud', 'google-cloud-sdk') : '',
      programFiles ? platformPath.join(programFiles, 'Google', 'Cloud SDK', 'google-cloud-sdk') : '',
      programFilesX86 ? platformPath.join(programFilesX86, 'Google', 'Cloud SDK', 'google-cloud-sdk') : '',
      platform === 'darwin' ? '/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk' : '',
      platform === 'darwin' ? '/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk' : '',
      platform === 'linux' ? '/usr/lib/google-cloud-sdk' : '',
      platform === 'linux' ? '/snap/google-cloud-sdk/current' : '',
    )
  }

  function googleCloudHomeDir() {
    return resolveEnvValue({}, ['HOME', 'USERPROFILE']) || (hasExplicitProcessEnv ? '' : homedir())
  }

  function googleVertexSetupScript(): GoogleVertexSetupScript {
    if (platform === 'win32') {
      return {
        label: 'Windows PowerShell',
        command: `powershell -c "iex (irm ${GOOGLE_ADC_SETUP_POWERSHELL_URL})"`,
      }
    }
    return {
      label: platform === 'darwin' ? 'macOS Terminal' : 'Linux terminal',
      command: `bash <(curl -sSL ${GOOGLE_ADC_SETUP_SCRIPT_URL})`,
    }
  }

  function googleVertexManualSetupCommands(projectId = 'YOUR_PROJECT_ID') {
    return [
      'gcloud auth application-default login',
      `gcloud config set project ${projectId}`,
      `gcloud services enable aiplatform.googleapis.com --project ${projectId}`,
    ]
  }

  function googleCloudSdkBinForRoot(root: string) {
    return platformPath.basename(root).toLowerCase() === 'bin' ? root : platformPath.join(root, 'bin')
  }

  function googleVertexGcloudCommandCandidates() {
    const commandNames = platform === 'win32'
      ? ['gcloud.cmd', 'gcloud.bat', 'gcloud.exe']
      : ['gcloud']
    return uniqueStrings(
      ...googleCloudSdkRootCandidates().flatMap((root) => {
        const binDir = googleCloudSdkBinForRoot(root)
        return commandNames.map((name) => platformPath.join(binDir, name))
      }),
    ).filter((candidate) => exists(candidate))
  }

  function prependPathEntry(value: string | undefined, entry: string) {
    const current = value || ''
    const delimiter = platform === 'win32' ? ';' : ':'
    const parts = current.split(delimiter).filter(Boolean)
    if (parts.some((part) => platformPath.resolve(part).toLowerCase() === platformPath.resolve(entry).toLowerCase())) return current
    return [entry, ...parts].join(delimiter)
  }

  function spawnGcloud(command: string, args: string[], timeoutMs: number) {
    const env = { ...processEnv } as NodeJS.ProcessEnv
    if (platformPath.isAbsolute(command)) {
      const binDir = platformPath.dirname(command)
      env.PATH = prependPathEntry(env.PATH, binDir)
      env.Path = prependPathEntry(env.Path, binDir)
    }
    const spec = shelllessSpawnSpecForCommand(command, args, platform, env, { wrapWindowsPathLookup: true })
    const result = spawn(spec.command, spec.args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      shell: spec.shell,
      env,
      ...(platform === 'win32' ? { windowsHide: true } : {}),
    })
    const errorText = result.error ? String(result.error) : ''
    return {
      stdout: spawnResultText(result.stdout).trim(),
      stderr: [spawnResultText(result.stderr).trim(), errorText].filter(Boolean).join('\n'),
      code: typeof result.status === 'number' ? result.status : result.error ? 1 : 0,
    }
  }

  function isMissingGcloudCommand(result: { stderr: string; code: number }) {
    const stderr = result.stderr.toLowerCase()
    return Boolean(
      stderr.includes('enoent') ||
      stderr.includes('not recognized as an internal or external command') ||
      stderr.includes('command not found') ||
      stderr.includes('no such file or directory'),
    )
  }

  function runGcloud(args: string[], timeoutMs = 8000): { stdout: string; stderr: string; code: number } {
    const commands = uniqueStrings(googleVertexGcloudCommandCache, 'gcloud', ...googleVertexGcloudCommandCandidates())
    let missingResult: { stdout: string; stderr: string; code: number } | null = null
    for (const command of commands) {
      const result = spawnGcloud(command, args, timeoutMs)
      if (!isMissingGcloudCommand(result)) {
        googleVertexGcloudCommandCache = command
        return result
      }
      missingResult ||= result
      if (googleVertexGcloudCommandCache === command) googleVertexGcloudCommandCache = null
    }
    return missingResult || { stdout: '', stderr: 'gcloud was not found.', code: 1 }
  }

  function resolveGoogleVertexProjectId(env: Record<string, string | undefined> = {}) {
    const fromEnv = resolveEnvValue(env, googleVertexProjectIdKeys)
    if (fromEnv) return fromEnv
    const fromAdc = readGoogleApplicationDefaultAuthorizedUserCredential()?.projectId
    if (fromAdc) return fromAdc
    const result = runGcloud(['config', 'get-value', 'project', '--quiet'], 5000)
    return result.code === 0 ? cleanGcloudConfigValue(result.stdout) : ''
  }

  function resolveGoogleProjectId(input?: string) {
    const fromInput = input?.trim()
    if (fromInput) return fromInput
    return resolveEnvValue({}, googleProjectIdKeys)
  }

  function resolveGoogleVertexProjectIdFast(env: Record<string, string | undefined> = {}) {
    return (
      resolveEnvValue(env, googleVertexProjectIdKeys) ||
      options.getLocalProviderOAuth('google')?.projectId?.trim() ||
      readGoogleApplicationDefaultAuthorizedUserCredential()?.projectId ||
      resolveGoogleProjectId() ||
      ''
    )
  }

  function resolveGoogleVertexLocation(env: Record<string, string | undefined> = {}) {
    const fromEnv = resolveEnvValue(env, GOOGLE_VERTEX_LOCATION_KEYS)
    if (fromEnv) return fromEnv
    return GOOGLE_VERTEX_DEFAULT_LOCATION
  }

  function resolveGoogleVertexLocationFast(env: Record<string, string | undefined> = {}) {
    return resolveEnvValue(env, GOOGLE_VERTEX_LOCATION_KEYS) || GOOGLE_VERTEX_DEFAULT_LOCATION
  }

  function resolveGoogleVertexAccessTokenForProcessEnv(env: Record<string, string | undefined> = {}) {
    const fromEnv = resolveEnvValue(env, GOOGLE_VERTEX_ACCESS_TOKEN_KEYS)
    if (fromEnv) return fromEnv

    const localGoogleOAuth = options.getLocalProviderOAuth('google')
    const localAccessToken = localGoogleOAuth?.accessToken?.trim()
    if (localAccessToken && (!localGoogleOAuth?.expiresAt || localGoogleOAuth.expiresAt > now() + 60_000)) {
      return localAccessToken
    }

    if (googleVertexAccessTokenCache && googleVertexAccessTokenCache.expiresAt > now()) {
      return googleVertexAccessTokenCache.value
    }

    const credential = resolveGoogleVertexGcloudAccessToken({
      includeApplicationDefault: !readGoogleApplicationDefaultAuthorizedUserCredential(),
    })
    if (!credential) return ''
    googleVertexAccessTokenCache = {
      value: credential.accessToken,
      expiresAt: now() + GOOGLE_VERTEX_ACCESS_TOKEN_CACHE_MS,
    }
    return credential.accessToken
  }

  /**
   * Vertex's recommended local-development credential is ADC, created by
   * `gcloud auth application-default login`. Keep the ordinary gcloud account
   * as a compatibility fallback for people who only use `gcloud auth login`.
   * Tokens remain in-process and are never surfaced in provider status.
   */
  function resolveGoogleVertexGcloudAccessToken({ includeApplicationDefault = true }: { includeApplicationDefault?: boolean } = {}): {
    accessToken: string
    source: 'application-default' | 'gcloud'
  } | null {
    if (includeApplicationDefault) {
      const adc = runGcloud(['auth', 'application-default', 'print-access-token', '--quiet'], 10000)
      const adcToken = adc.code === 0 ? adc.stdout.trim() : ''
      if (adcToken) return { accessToken: adcToken, source: 'application-default' }
    }

    const gcloud = runGcloud(['auth', 'print-access-token', '--quiet'], 10000)
    const gcloudToken = gcloud.code === 0 ? gcloud.stdout.trim() : ''
    if (gcloudToken) return { accessToken: gcloudToken, source: 'gcloud' }

    return null
  }

  function googleApplicationDefaultCredentialFileCandidates() {
    const configuredPath = resolveEnvValue({}, ['GOOGLE_APPLICATION_CREDENTIALS'])
    const homeDir = googleCloudHomeDir()
    const appData = resolveEnvValue({}, ['APPDATA', 'AppData'])
    return uniqueStrings(
      configuredPath,
      platform === 'win32' && appData ? platformPath.join(appData, 'gcloud', 'application_default_credentials.json') : '',
      homeDir ? platformPath.join(homeDir, '.config', 'gcloud', 'application_default_credentials.json') : '',
    )
  }

  function readGoogleApplicationDefaultAuthorizedUserCredential(): GoogleApplicationDefaultAuthorizedUserCredential | null {
    for (const filePath of googleApplicationDefaultCredentialFileCandidates()) {
      try {
        const parsed = JSON.parse(readFile(filePath, 'utf-8')) as {
          type?: string
          client_id?: string
          client_secret?: string
          refresh_token?: string
          quota_project_id?: string
        }
        const clientId = parsed.client_id?.trim()
        const clientSecret = parsed.client_secret?.trim()
        const refreshToken = parsed.refresh_token?.trim()
        if (parsed.type !== 'authorized_user' || !clientId || !clientSecret || !refreshToken) continue
        const projectId = parsed.quota_project_id?.trim()
        return { clientId, clientSecret, refreshToken, ...(projectId ? { projectId } : {}) }
      } catch {
        // ADC may be absent or use a credential type handled by gcloud instead.
      }
    }
    return null
  }

  async function resolveGoogleVertexApplicationDefaultAuth(): Promise<{
    accessToken: string
    source: 'application-default'
  } | null> {
    const credential = readGoogleApplicationDefaultAuthorizedUserCredential()
    if (!credential) return null

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credential.clientId,
          client_secret: credential.clientSecret,
          refresh_token: credential.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      })
      if (!response.ok) return null
      const payload = await response.json() as { access_token?: unknown }
      const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
      return accessToken ? { accessToken, source: 'application-default' } : null
    } catch {
      return null
    }
  }

  function getGoogleVertexProcessEnv(baseEnv: Record<string, string | undefined> = processEnv): Record<string, string> {
    const env = Object.fromEntries(
      Object.entries(baseEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    const projectId = resolveGoogleVertexProjectId(env)
    if (!projectId) return {}
    const location = resolveGoogleVertexLocation(env)
    const next: Record<string, string> = {}
    if (!env.GOOGLE_CLOUD_PROJECT?.trim()) next.GOOGLE_CLOUD_PROJECT = projectId
    if (!env.GCLOUD_PROJECT?.trim()) next.GCLOUD_PROJECT = projectId
    if (!env.GOOGLE_CLOUD_LOCATION?.trim()) next.GOOGLE_CLOUD_LOCATION = location
    const accessToken = resolveGoogleVertexAccessTokenForProcessEnv(env)
    if (accessToken) {
      if (!env.GOOGLE_VERTEX_ACCESS_TOKEN?.trim()) next.GOOGLE_VERTEX_ACCESS_TOKEN = accessToken
      if (!env.GCLOUD_ACCESS_TOKEN?.trim()) next.GCLOUD_ACCESS_TOKEN = accessToken
    }
    return next
  }

  function googleVertexGcloudStatus(statusOptions: { probeGcloud?: boolean } = {}): GoogleVertexGcloudStatus {
    const current = now()
    const forceProbe = statusOptions.probeGcloud === true
    if (!forceProbe && googleVertexGcloudStatusCache && googleVertexGcloudStatusCache.expiresAt > current) {
      return { ...googleVertexGcloudStatusCache.value, source: 'cache' }
    }

    if (statusOptions.probeGcloud === false) {
      const projectId = resolveGoogleVertexProjectIdFast()
      const location = resolveGoogleVertexLocationFast()
      const tokenFromEnv = resolveEnvValue({}, GOOGLE_VERTEX_ACCESS_TOKEN_KEYS)
      const localGoogleOAuth = options.getLocalProviderOAuth('google')
      const localOAuthUsable = isOAuthCredentialUsable(localGoogleOAuth)
      const authenticated = Boolean(tokenFromEnv || localOAuthUsable)
      const configured = Boolean(projectId && authenticated)
      const missing: string[] = []
      if (!authenticated) missing.push('Connect Google OAuth, set GOOGLE_VERTEX_ACCESS_TOKEN, or refresh gcloud status.')
      if (!projectId) missing.push('Set a Google Cloud project.')
      if (configured) missing.length = 0
      return {
        supported: true,
        installed: googleVertexGcloudStatusCache?.value.installed ?? false,
        authenticated,
        configured,
        ...(tokenFromEnv
          ? { credentialSource: 'environment' as const }
          : localOAuthUsable
            ? { credentialSource: 'local-oauth' as const }
            : {}),
        ...(projectId ? { projectId } : {}),
        location,
        ...(localGoogleOAuth?.email ? { account: localGoogleOAuth.email } : {}),
        missing,
        installUrl: GOOGLE_CLOUD_CLI_INSTALL_URL,
        setupScript: googleVertexSetupScript(),
        commands: googleVertexManualSetupCommands(projectId || 'YOUR_PROJECT_ID'),
        source: 'fast',
      }
    }

    const projectId = resolveGoogleVertexProjectId()
    const location = resolveGoogleVertexLocation()
    const tokenFromEnv = resolveEnvValue({}, GOOGLE_VERTEX_ACCESS_TOKEN_KEYS)
    const version = runGcloud(['--version'], 5000)
    const installed = version.code === 0
    const account = installed
      ? cleanGcloudConfigValue(runGcloud(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)', '--quiet'], 7000).stdout)
      : ''
    const localAdc = !tokenFromEnv ? readGoogleApplicationDefaultAuthorizedUserCredential() : null
    const credential = installed && !tokenFromEnv && !localAdc ? resolveGoogleVertexGcloudAccessToken() : null
    const authenticated = Boolean(tokenFromEnv || localAdc || credential)
    const configured = Boolean(projectId && authenticated)
    const missing: string[] = []
    if (!installed && !tokenFromEnv) {
      missing.push(`Install Google Cloud CLI: ${GOOGLE_CLOUD_CLI_INSTALL_URL}`)
    }
    if (installed && !authenticated) {
      missing.push('Run the recommended ADC setup script, then select Refresh.')
    }
    if (!projectId) {
      missing.push('Set a Google Cloud project with gcloud config set project YOUR_PROJECT_ID.')
    }
    if (configured) {
      missing.length = 0
    }

    const value: GoogleVertexGcloudStatus = {
      supported: true,
      installed,
      authenticated,
      configured,
      ...(tokenFromEnv
        ? { credentialSource: 'environment' as const }
        : localAdc
          ? { credentialSource: 'application-default' as const }
        : credential
          ? { credentialSource: credential.source }
          : {}),
      ...(projectId ? { projectId } : {}),
      location,
      ...(account ? { account } : {}),
      missing,
      installUrl: GOOGLE_CLOUD_CLI_INSTALL_URL,
      setupScript: googleVertexSetupScript(),
      commands: googleVertexManualSetupCommands(projectId || 'YOUR_PROJECT_ID'),
      source: 'probe',
    }
    googleVertexGcloudStatusCache = { value, expiresAt: current + 15000 }
    return value
  }

  function googleVertexLocalOAuthProjectId(env: Record<string, string | undefined> = {}, statusOptions: { probeGcloud?: boolean } = {}) {
    return (
      (statusOptions.probeGcloud === false ? resolveGoogleVertexProjectIdFast(env) : resolveGoogleVertexProjectId(env)) ||
      options.getLocalProviderOAuth('google')?.projectId?.trim() ||
      resolveGoogleProjectId() ||
      ''
    )
  }

  function isGoogleVertexLocalOAuthConfigured(env: Record<string, string | undefined> = {}, statusOptions: { probeGcloud?: boolean } = {}) {
    return Boolean(isOAuthCredentialUsable(options.getLocalProviderOAuth('google')) && googleVertexLocalOAuthProjectId(env, statusOptions))
  }

  function isGoogleVertexConfigured(statusOptions: { probeGcloud?: boolean } = {}) {
    return googleVertexGcloudStatus(statusOptions).configured || isGoogleVertexLocalOAuthConfigured({}, statusOptions)
  }

  async function resolveGoogleVertexGcloudAuth(env: Record<string, string>): Promise<ProviderRequestAuth | null> {
    const envToken = resolveEnvValue(env, GOOGLE_VERTEX_ACCESS_TOKEN_KEYS)
    const projectId = resolveGoogleVertexProjectId(env)
    const location = resolveGoogleVertexLocation(env)
    if (envToken && projectId) {
      return { type: 'oauth', accessToken: envToken, projectId, location, source: 'env-token' }
    }

    const hasLocalAdc = Boolean(readGoogleApplicationDefaultAuthorizedUserCredential())
    const applicationDefault = await resolveGoogleVertexApplicationDefaultAuth()
    if (applicationDefault && projectId) {
      return { type: 'oauth', accessToken: applicationDefault.accessToken, projectId, location, source: applicationDefault.source }
    }

    const version = runGcloud(['--version'], 5000)
    if (version.code !== 0) return null
    const credential = resolveGoogleVertexGcloudAccessToken({ includeApplicationDefault: !hasLocalAdc })
    if (!credential || !projectId) return null
    return { type: 'oauth', accessToken: credential.accessToken, projectId, location, source: credential.source }
  }

  async function resolveGoogleOAuthForRequest(): Promise<{ accessToken: string; projectId?: string } | null> {
    const stored = options.getLocalProviderOAuth('google') || options.localOAuthFromMainAuthProfile('google') || undefined
    if (!isOAuthCredentialUsable(stored)) return null

    const expiresAt = stored.expiresAt || 0
    if (stored.accessToken?.trim() && expiresAt > now() + 60000) {
      return {
        accessToken: stored.accessToken.trim(),
        ...(stored.projectId ? { projectId: stored.projectId } : {}),
      }
    }

    const refreshed = await options.refreshGoogleOAuthCredential(stored)
    await options.persistProviderOAuth('google', refreshed)
    const next = options.getLocalProviderOAuth('google') || refreshed
    return {
      accessToken: next.accessToken?.trim() || refreshed.accessToken?.trim() || '',
      ...(next.projectId ? { projectId: next.projectId } : {}),
    }
  }

  async function resolveOpenAICodexOAuthForRequest(): Promise<{ accessToken: string } | null> {
    const stored = options.getLocalProviderOAuth('openai') || options.localOAuthFromMainAuthProfile('openai') || undefined
    if (!isOAuthCredentialUsable(stored)) return null

    const accessToken = stored.accessToken?.trim()
    const expiresAt = stored.expiresAt || 0
    if (accessToken && (!expiresAt || expiresAt > now() + 60000)) {
      return { accessToken }
    }

    const refreshed = await options.refreshOpenAICodexOAuthCredential(stored)
    await options.persistProviderOAuth('openai', refreshed)
    const next = options.getLocalProviderOAuth('openai') || refreshed
    const nextAccessToken = next.accessToken?.trim() || refreshed.accessToken?.trim()
    return nextAccessToken ? { accessToken: nextAccessToken } : null
  }

  async function resolveGoogleVertexRequestAuth(env: Record<string, string>): Promise<ProviderRequestAuth | null> {
    const gcloudAuth = await resolveGoogleVertexGcloudAuth(env)
    if (gcloudAuth) return gcloudAuth

    const oauth = await resolveGoogleOAuthForRequest().catch(() => null)
    const projectId = googleVertexLocalOAuthProjectId(env)
    const location = resolveGoogleVertexLocation(env)
    if (oauth?.accessToken && projectId) {
      return { type: 'oauth', accessToken: oauth.accessToken, projectId, location, source: 'local-google-oauth' }
    }

    return null
  }

  async function resolveProviderRequestAuth(
    provider: string,
    env: Record<string, string>,
    envKeys: string[],
  ): Promise<ProviderRequestAuth | null> {
    await options.ensureLocalAuthStoreLoaded().catch(() => undefined)
    if (provider === 'google-vertex') {
      return resolveGoogleVertexRequestAuth(env)
    }

    const localMode = options.getLocalProviderMode(provider)
    if (provider === 'google' && localMode === 'oauth') {
      const oauth = await resolveGoogleOAuthForRequest().catch(() => null)
      if (oauth?.accessToken) {
        return { type: 'oauth', accessToken: oauth.accessToken, ...(oauth.projectId ? { projectId: oauth.projectId } : {}), source: 'local-oauth' }
      }
    }

    if (provider === 'openai' && localMode === 'oauth') {
      const oauth = await resolveOpenAICodexOAuthForRequest().catch(() => null)
      if (oauth?.accessToken) return { type: 'oauth', accessToken: oauth.accessToken, source: 'local-oauth' }
    }

    const apiKey = resolveEnvValue(env, envKeys)
    if (apiKey) return { type: 'apiKey', value: apiKey, source: 'api-key' }

    if (provider === 'google') {
      const oauth = await resolveGoogleOAuthForRequest().catch(() => null)
      if (oauth?.accessToken) {
        return { type: 'oauth', accessToken: oauth.accessToken, ...(oauth.projectId ? { projectId: oauth.projectId } : {}), source: 'local-oauth' }
      }
    }

    if (provider === 'openai' && localMode !== 'apiKey') {
      const oauth = await resolveOpenAICodexOAuthForRequest().catch(() => null)
      if (oauth?.accessToken) return { type: 'oauth', accessToken: oauth.accessToken, source: 'local-oauth' }
    }

    return null
  }

  function openClawDistDirCandidates() {
    const electronResourcesPath = options.electronResourcesPath?.() || ''
    const binDir = options.openClawBin && options.openClawBin !== 'openclaw' ? path.dirname(path.resolve(options.openClawBin)) : ''
    return uniqueStrings(
      binDir ? path.join(binDir, 'dist') : '',
      binDir,
      path.resolve(process.cwd(), 'vendor', 'openclaw', 'dist'),
      path.resolve(process.cwd(), 'resources', 'openclaw', 'dist'),
      electronResourcesPath ? path.join(electronResourcesPath, 'openclaw', 'dist') : '',
      path.join(options.workspaceRoot, 'vendor', 'openclaw', 'dist'),
    ).filter(Boolean)
  }

  function openClawDistModulePath(fileName: string) {
    for (const distDir of openClawDistDirCandidates()) {
      const candidate = path.join(distDir, fileName)
      if (exists(candidate)) return candidate
    }
    return path.join(openClawDistDirCandidates()[0] || path.join(options.workspaceRoot, 'vendor', 'openclaw', 'dist'), fileName)
  }

  function openAICodexOAuthModulePath() {
    return openClawDistModulePath('openai-chatgpt-oauth-flow.runtime.js')
  }

  async function importOpenAICodexOAuthModule() {
    const modulePath = openAICodexOAuthModulePath()
    const oauthModule = await importModule(pathToFileURL(modulePath).href)
    const loginOpenAICodex = oauthModule.loginOpenAICodex ?? oauthModule.t
    const refreshOpenAICodexToken = oauthModule.refreshOpenAICodexToken ?? oauthModule.r
    const testing = oauthModule.testing ?? oauthModule.i

    if (typeof loginOpenAICodex !== 'function') {
      throw new Error(`OpenAI Codex OAuth runtime at ${modulePath} does not export loginOpenAICodex.`)
    }
    if (typeof refreshOpenAICodexToken !== 'function') {
      throw new Error(`OpenAI Codex OAuth runtime at ${modulePath} does not export refreshOpenAICodexToken.`)
    }

    return {
      ...oauthModule,
      loginOpenAICodex,
      refreshOpenAICodexToken,
      ...(testing ? { testing } : {}),
    } as OpenAICodexRuntimeModule
  }

  function openAICodexOAuthTesting(oauthModule: OpenAICodexRuntimeModule): OpenAICodexOAuthTesting {
    if (
      !oauthModule.testing ||
      typeof oauthModule.testing.createAuthorizationFlow !== 'function' ||
      typeof oauthModule.testing.exchangeAuthorizationCode !== 'function'
    ) {
      throw new Error('OpenAI Codex OAuth runtime does not expose the callback flow helpers.')
    }
    return oauthModule.testing
  }

  async function createOpenAICodexAuthorizationFlow(originator?: string) {
    const oauthModule = await importOpenAICodexOAuthModule()
    return openAICodexOAuthTesting(oauthModule).createAuthorizationFlow(originator)
  }

  async function exchangeOpenAICodexAuthorizationCode(code: string, verifier: string, redirectUri?: string) {
    const oauthModule = await importOpenAICodexOAuthModule()
    return openAICodexOAuthTesting(oauthModule).exchangeAuthorizationCode(code, verifier, redirectUri)
  }

  async function refreshOpenAICodexToken(refreshToken: string) {
    const oauthModule = await importOpenAICodexOAuthModule()
    return oauthModule.refreshOpenAICodexToken(refreshToken)
  }

  function googleOAuthClientConfigFileCandidates() {
    const candidates = [
      path.join(options.openClawStateRoot, 'google-oauth-client.json'),
      path.join(options.workspaceRoot, 'google-oauth-client.json'),
      path.join(options.workspaceRoot, 'client_secret.json'),
      // `gcloud auth application-default login` creates an authorized-user
      // credential that already contains a valid desktop OAuth client. Reuse
      // that local client when the app has no separate client_secret.json.
      ...googleApplicationDefaultCredentialFileCandidates(),
    ]

    try {
      const downloadedClientFiles = readDir(options.workspaceRoot, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            /^client_secret_.+\.apps\.googleusercontent\.com\.json$/i.test(entry.name),
        )
        .map((entry) => path.join(options.workspaceRoot, entry.name))
        .sort()

      candidates.push(...downloadedClientFiles)
    } catch {
      // Optional convenience scan.
    }

    return candidates
  }

  function readGoogleOAuthClientConfigFile(): GoogleOAuthClientConfig | null {
    const candidates = googleOAuthClientConfigFileCandidates()

    for (const filePath of candidates) {
      try {
        const parsed = JSON.parse(readFile(filePath, 'utf-8')) as {
          installed?: { client_id?: string; client_secret?: string }
          web?: { client_id?: string; client_secret?: string }
          client_id?: string
          client_secret?: string
        }
        const source = parsed.installed || parsed.web || parsed
        const clientId = source.client_id?.trim()
        if (!clientId) continue
        return {
          clientId,
          ...(source.client_secret?.trim() ? { clientSecret: source.client_secret.trim() } : {}),
        }
      } catch {
        // Optional convenience file.
      }
    }

    return null
  }

  function resolveGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
    const clientId = resolveEnvValue({}, options.googleOAuthClientIdKeys)
    if (clientId) {
      const clientSecret = resolveEnvValue({}, options.googleOAuthClientSecretKeys)
      return {
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
      }
    }

    const fileConfig = readGoogleOAuthClientConfigFile()
    if (fileConfig) return fileConfig

    throw new Error(
      `Google OAuth needs a desktop OAuth client. Set ${options.googleOAuthClientIdKeys[0]}, run "gcloud auth application-default login", or place client_secret.json in ${options.workspaceRoot}.`,
    )
  }

  function googleOAuthClientConfigStatus() {
    try {
      resolveGoogleOAuthClientConfig()
      return { available: true, missing: [] as string[] }
    } catch (error) {
      return {
        available: false,
        missing: [String(error)],
      }
    }
  }

  return {
    createOpenAICodexAuthorizationFlow,
    exchangeOpenAICodexAuthorizationCode,
    getGoogleVertexProcessEnv,
    googleCloudSdkRootCandidates,
    googleApplicationDefaultCredentialFileCandidates,
    googleOAuthClientConfigFileCandidates,
    googleOAuthClientConfigStatus,
    googleVertexGcloudStatus,
    googleVertexSetupScript,
    googleVertexLocalOAuthProjectId,
    importOpenAICodexOAuthModule,
    isGoogleVertexConfigured,
    isGoogleVertexLocalOAuthConfigured,
    openAICodexOAuthModulePath,
    readGoogleApplicationDefaultAuthorizedUserCredential,
    readGoogleOAuthClientConfigFile,
    refreshOpenAICodexToken,
    resolveGoogleOAuthClientConfig,
    resolveGoogleOAuthForRequest,
    resolveGoogleProjectId,
    resolveGoogleVertexAccessTokenForProcessEnv,
    resolveGoogleVertexApplicationDefaultAuth,
    resolveGoogleVertexGcloudAccessToken,
    resolveGoogleVertexLocation,
    resolveGoogleVertexLocationFast,
    resolveGoogleVertexProjectId,
    resolveGoogleVertexProjectIdFast,
    resolveGoogleVertexRequestAuth,
    resolveOpenAICodexOAuthForRequest,
    resolveProviderRequestAuth,
  }
}

export type ProviderSetupService = ReturnType<typeof createProviderSetupService>
