// No new domain logic goes here. Keep this file to dependency wiring and
// temporary composition glue; new backend behavior must declare and use its
// target service folder from docs/BETA_CODEBASE_SPLIT_PLAN.md.
import express from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, promises as fs } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONTROL_CENTER_STATE_KEYS,
  createRuntimeLedgerStore,
  runtimeLedgerPathsForStateRoot,
  runtimeMonitorClearMarkerPath,
  scheduleLegacyRuntimeLedgerImport,
} from './state/runtimeLedgerStore'
import { apiFailure, installControlPlaneErrorHandler, installControlPlaneHttp } from './controlPlaneHttp'
import { registerAuthRoutes } from './routes/authRoutes'
import { registerLicenseRoutes } from './routes/licenseRoutes'
import { registerCommandConsoleFileRoutes } from './routes/commandConsoleFileRoutes'
import { registerClawTalkConsoleRoutes } from './routes/clawTalkConsoleRoutes'
import { registerDiagnosticsRoutes } from './routes/diagnosticsRoutes'
import { registerAgentTurnRoutes } from './routes/agentTurnRoutes'
import { registerAgentConfigRoutes } from './routes/agentConfigRoutes'
import { registerFilesystemRoutes } from './routes/filesystemRoutes'
import { registerMissionRoutes } from './routes/missionRoutes'
import { registerOpenClawCommandRoutes } from './routes/openclawCommandRoutes'
import { registerPartyCoordinationRoutes } from './routes/partyCoordinationRoutes'
import { registerPartyManagementRoutes } from './routes/partyManagementRoutes'
import { registerPluginRoutes } from './routes/pluginRoutes'
import { registerProviderAuthRoutes } from './routes/providerAuthRoutes'
import { registerRuntimeRoutes } from './routes/runtimeRoutes'
import { registerSkillRoutes } from './routes/skillRoutes'
import { registerSpeechRoutes } from './routes/speechRoutes'
import { createControlFilesService } from './services/controlFilesService'
import {
  AVATAR_UPLOAD_LIMIT_BYTES,
  assertAvatarImageUploadSignature,
  assertAvatarUploadBytes,
  assertAvatarUploadSize,
  avatarUploadLimitErrorMessage,
  avatarUploadFileName,
  isSupportedAvatarImagePath,
  managedAvatarFileName,
} from './services/filesystem/avatarFileService'
import {
  createMissionStateService,
  missionRecordSnapshot,
  type Mission,
  type MissionFeedEvent,
  type MissionLifecycleEvent,
} from './services/missions/missionStateService'
import {
  createMissionSchedulerService,
  type MissionCronRuntimeSnapshot,
  type MissionCronRuntimeDefaults,
  type MissionSchedulerService,
} from './services/missions/missionSchedulerService'
import { createMissionReportService } from './services/missions/missionReportService'
import {
  createMissionRecoveryService,
  type MissionCronReconciliationSnapshot,
} from './services/missions/missionRecoveryService'
import { createMissionTeamSyncService } from './services/missions/missionTeamSyncService'
import { createLoginAttemptLimiter } from './loginAttemptLimiter'
import { createSessionTokenStore } from './sessionTokenStore'
import { createLicenseService } from './services/license/licenseService'
import {
  applyUsagePriorityModelOrder,
  withUsagePriorityChannelDefault,
} from './services/license/usagePriorityRouting'
import {
  AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS,
  AUTOMNIA_CREDITS_MODEL_IDS,
  AUTOMNIA_CREDITS_MODEL_ID,
  AUTOMNIA_CREDITS_PROVIDER_ID,
  CREDITS_ONLY_MODEL_ACCESS_MESSAGE,
  creditsOnlyModelSelection,
  isAutomniaCreditsModelId,
} from './services/license/creditsOnlyModelPolicy'
import { createAccountAuthService } from './services/auth/accountAuthService'
import { automniaCloudRouteBaseUrl } from './config/automniaCloud'
import {
  AUTH_ENV_MAP,
  AUTH_PROVIDER_CATALOG,
  ANTHROPIC_OAUTH_REDIRECT_URI,
  GOOGLE_ACCOUNT_OAUTH_SCOPES,
  GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_SCOPES,
  OPENAI_CODEX_OAUTH_REDIRECT_URI,
  OPENAI_CODEX_OAUTH_SCOPES,
} from './catalogs/providerCatalog'
import {
  FALLBACK_MODELS,
  KNOWN_UNAVAILABLE_MODEL_IDS,
  canonicalAgentModelId,
  createModelCatalogService,
  isModelSafeForOpenClawConfig,
  isOpenAiCodexSubscriptionModel,
  splitModelId,
  type ModelCatalogOpenClawConfig,
  type ModelProviderConfig,
} from './services/providers/modelCatalogService'
import {
  AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT,
  AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP,
  thinkingForAutomniaGeminiRuntimeModel,
} from './services/providers/automniaGeminiThinking'
import { applyGoogleVertexModelLimits } from './services/providers/googleVertexModelPolicy'
import {
  googleGeminiModelDisallowsCustomSampling,
  googleGeminiThinkingForModel,
} from './services/providers/googleGeminiModelPolicy'
import {
  createProviderAuthService,
  isOAuthCredentialUsable,
  type ProviderAuthOpenClawConfig,
  type ProviderAuthService,
} from './services/providers/providerAuthService'
import {
  createProviderSetupService,
  GOOGLE_VERTEX_ACCESS_TOKEN_KEYS,
  GOOGLE_VERTEX_DEFAULT_LOCATION,
  GOOGLE_VERTEX_GLOBAL_LOCATION,
  GOOGLE_VERTEX_LOCATION_KEYS,
  GOOGLE_VERTEX_PROJECT_ID_KEYS,
  type ProviderRequestAuth,
} from './services/providers/providerSetupService'
import { createOAuthCallbackService, type OAuthCallbackService } from './services/providers/oauthCallbackService'
import {
  CLAWTALK_CORE_BRIDGE_ROUTING_HELPER,
  TELEGRAM_AGENT_ROUTING_HELPER,
} from './integrations/agentRoutingHelpers'
import { registerBrowserRoutes } from './routes/browserRoutes'
import { registerShiftRoutes } from './routes/shiftRoutes'
import { registerStaticUi } from './staticUi'
import { buildOpenClawOptimizationScorecard } from './openclawOptimizationScorecard'
import { createSafePathService } from './services/filesystem/safePathService'
import {
  COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES,
  createCommandConsoleUploadService,
} from './services/filesystem/commandConsoleUploadService'
import { createPickerSessionService } from './services/filesystem/pickerSessionService'
import {
  createGatewayLifecycleService,
  type GatewayLifecycleService,
  type GatewayStartupPluginRepairSummary,
} from './services/gateway/gatewayLifecycleService'
import { applyTelegramPluginConfigValues } from './services/plugins/telegramConfigMapping'
import { repairInvalidTelegramDmPolicy } from './services/plugins/telegramPolicy'
import { archiveCoveredLegacyConfigHealthState } from './services/gateway/legacyStateCleanupService'
import {
  createGatewayDiagnosticsService,
  type GatewayDiagnosticsClient,
  type GatewayStabilityStatus,
} from './services/gateway/gatewayDiagnosticsService'
import {
  createGatewayLogService,
  type GatewayActivitySummary,
  type GatewayChannelActivity,
  type GatewayLogEntry,
} from './services/gateway/gatewayLogService'
import {
  AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
  AUTOMNIA_OPENCLAW_CONTEXT_TOKENS_DEFAULT,
  AUTOMNIA_COMPACTION_RESERVE_TOKENS,
  enforceAutomniaCompactionPolicy,
  migrateAutomniaCompactBaseline,
  type AutomniaCompactionSettings,
} from './services/gateway/compactionPolicy'
import { createGatewayChatService } from './services/gateway/gatewayChatService'
import { createBufferedAgentTurnService } from './services/agents/agentTurnService'
import { createGatewayAgentTurnService } from './services/agents/gatewayAgentTurnService'
import { createAgentRuntimeService } from './services/agents/agentRuntimeService'
import { createAgentStreamingService } from './services/agents/agentStreamingService'
import { composeAutomniaContinuationPrompt } from './services/agents/promptEfficiencyPolicy'
import {
  createRuntimeStatusService,
  type RuntimeStatusService,
} from './services/runtime/runtimeStatusService'
import { createGatewayActivityFeedService } from './services/runtime/gatewayActivityFeedService'
import { createRuntimeActionService } from './services/runtime/runtimeActionService'
import { ensurePrimaryAgentSelection } from './services/agents/primaryAgentSelectionService'
import { recoverMalformedCodexBindingSidecars } from './services/runtime/codexSidecarRecoveryService'
import { createBrowserPreflightService } from './services/browser/browserPreflightService'
import { createSpeechTranscriptionService } from './services/speech/speechTranscriptionService'
import { createRuntimeRecoveryService } from './services/runtime/runtimeRecoveryService'
import {
  createPluginInventoryService,
  displayPluginName,
  pluginCliWarningFromOutput as pluginInventoryCliWarningFromOutput,
  pluginIdFromPackageName,
  PLUGIN_ID_PATTERN,
  sanitizePluginCliError as sanitizePluginInventoryCliError,
  type PluginControlEntry,
  type PluginInventoryService,
  type PluginRuntimeState,
} from './services/plugins/pluginInventoryService'
import {
  createPluginInstallService,
  type PluginInstallService,
} from './services/plugins/pluginInstallService'
import {
  createPluginDiagnosticsService,
  type PluginDiagnosticsService,
} from './services/plugins/pluginDiagnosticsService'
import {
  createPluginRuntimeService,
  type PluginRuntimeService,
} from './services/plugins/pluginRuntimeService'
import { pluginToggleRequiresGatewayRestart } from './services/plugins/pluginRestartPolicy'
import { computeShiftDurationMinutes } from './shiftContracts'
import type {
  HeartbeatRuntimeDefaults,
  RuntimeCronJobSummary,
  Shift,
  StartShiftPayload,
} from './shiftContracts'
import { applyDiagnosticRedactions } from '../src/utils/diagnosticRedaction'

const CONTROL_CENTER_STARTUP_TRACE = process.env.CONTROL_CENTER_STARTUP_TRACE === '1'
const CONTROL_CENTER_MODULE_EVALUATION_STARTED_AT = Date.now()

function traceControlCenterStartup(stage: string) {
  if (!CONTROL_CENTER_STARTUP_TRACE) return
  const elapsedMs = Date.now() - CONTROL_CENTER_MODULE_EVALUATION_STARTED_AT
  console.error(`[control-plane:start] +${elapsedMs}ms ${stage}`)
}

traceControlCenterStartup('control-plane module evaluation started')

const app = express()

const PORT = Number(process.env.CONTROL_CENTER_PORT || 4050)
const CONFIGURED_AUTH_TOKEN = process.env.CONTROL_CENTER_TOKEN?.trim()
const AUTH_TOKEN = CONFIGURED_AUTH_TOKEN || randomBytes(32).toString('base64url')
const AUTH_TOKEN_SOURCE = CONFIGURED_AUTH_TOKEN ? 'environment' : 'generated'
const sessionTokens = createSessionTokenStore({
  ttlMs: Number(process.env.CONTROL_CENTER_SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  maxSessions: Number(process.env.CONTROL_CENTER_MAX_SESSIONS || 64),
})
const loginAttempts = createLoginAttemptLimiter({
  windowMs: Number(process.env.CONTROL_CENTER_LOGIN_WINDOW_MS || 60_000),
  maxAttempts: Number(process.env.CONTROL_CENTER_LOGIN_MAX_ATTEMPTS || 5),
  baseLockoutMs: Number(process.env.CONTROL_CENTER_LOGIN_BASE_LOCKOUT_MS || 2_000),
  maxLockoutMs: Number(process.env.CONTROL_CENTER_LOGIN_MAX_LOCKOUT_MS || 60_000),
})
const CONTROL_CENTER_FRONTEND_PORT = Number(process.env.CONTROL_CENTER_FRONTEND_PORT || 5173)
installControlPlaneHttp(app, {
  authToken: AUTH_TOKEN,
  frontendPort: CONTROL_CENTER_FRONTEND_PORT,
  port: PORT,
  sessionTokens,
})

function pluginErrorStatus(error: unknown): number {
  return typeof (error as Error & { code?: unknown }).code === 'number' ? 502 : 500
}

function pluginErrorDetail(error: unknown): string {
  return redactSensitiveText(String(error))
}

let controlServer: Server | null = null
const optionalRequire = createRequire(import.meta.url || __filename)
type SqliteStatement = {
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  get?: (...params: unknown[]) => Record<string, unknown> | undefined
  run?: (...params: unknown[]) => unknown
}
type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement
  exec?: (sql: string) => void
  close?: () => void
}
type SqliteModule = {
  DatabaseSync?: new (filePath: string, options?: { readOnly?: boolean }) => SqliteDatabase
}
const WORKSPACE_ROOT = path.resolve(process.env.CONTROL_CENTER_WORKSPACE_ROOT || process.cwd())
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || WORKSPACE_ROOT
const NATIVE_OPENCLAW_STATE_ROOT = path.join(HOME_DIR, '.openclaw')
function getElectronResourcesPath() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath
  return typeof resourcesPath === 'string' ? resourcesPath : ''
}

function mutableRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isBundledOpenClawPath(value: string | undefined) {
  if (!value) return false
  const normalized = value.replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/automnia-control-center/openclaw') || normalized.includes('/automnia-ai-nexus/openclaw')
}

function defaultAgencyAgentTemplateSourceRoot() {
  const electronResourcesPath = getElectronResourcesPath()
  const candidates = [
    path.join(WORKSPACE_ROOT, 'vendor', 'agency-agents'),
    path.resolve(process.cwd(), 'vendor', 'agency-agents'),
    path.resolve(process.cwd(), 'resources', 'agency-agents'),
    electronResourcesPath ? path.join(electronResourcesPath, 'agency-agents') : '',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) || path.join(WORKSPACE_ROOT, 'vendor', 'agency-agents')
}

const CONFIGURED_OPENCLAW_STATE_ROOT = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || ''
const OPENCLAW_STATE_ROOT = path.resolve(
  CONFIGURED_OPENCLAW_STATE_ROOT && !isBundledOpenClawPath(CONFIGURED_OPENCLAW_STATE_ROOT)
    ? CONFIGURED_OPENCLAW_STATE_ROOT
    : NATIVE_OPENCLAW_STATE_ROOT,
)
const OPENCLAW_PROFILE = (process.env.OPENCLAW_PROFILE || 'default').trim() || 'default'
const OPENCLAW_CONFIG_PATH = path.resolve(
  process.env.OPENCLAW_CONFIG_PATH && !isBundledOpenClawPath(process.env.OPENCLAW_CONFIG_PATH)
    ? process.env.OPENCLAW_CONFIG_PATH
    : path.join(OPENCLAW_STATE_ROOT, 'openclaw.json'),
)
const OPENCLAW_GATEWAY_LOG_PATH = path.resolve(
  process.env.OPENCLAW_GATEWAY_LOG_PATH && !isBundledOpenClawPath(process.env.OPENCLAW_GATEWAY_LOG_PATH)
    ? process.env.OPENCLAW_GATEWAY_LOG_PATH
    : path.join(OPENCLAW_STATE_ROOT, 'gateway.log'),
)
const OPENCLAW_ENV_PATH = path.join(OPENCLAW_STATE_ROOT, '.env')
process.env.OPENCLAW_STATE_DIR = OPENCLAW_STATE_ROOT
process.env.OPENCLAW_CONFIG_PATH = OPENCLAW_CONFIG_PATH
process.env.OPENCLAW_GATEWAY_LOG_PATH = OPENCLAW_GATEWAY_LOG_PATH
process.env.OPENCLAW_SUPPRESS_EXTENSION_API_WARNING = process.env.OPENCLAW_SUPPRESS_EXTENSION_API_WARNING || '1'
const HEARTBEAT_DEFAULTS_PATH = path.join(OPENCLAW_STATE_ROOT, 'heartbeat-runtime-defaults.json')
const HEARTBEAT_AGENT_DEFAULTS_PATH = path.join(OPENCLAW_STATE_ROOT, 'heartbeat-runtime-per-agent.json')
const RETIRED_AGENT_IDS_PATH = path.join(OPENCLAW_STATE_ROOT, 'retired-agents.json')
const PARTY_PROFILE_PATH = path.join(WORKSPACE_ROOT, '.openclaw', 'party-profiles.json')
const AGENCY_AGENT_TEMPLATE_SOURCE_ROOT = path.resolve(
  process.env.AGENCY_AGENT_TEMPLATE_SOURCE_ROOT || defaultAgencyAgentTemplateSourceRoot(),
)
const AGENCY_AGENT_TEMPLATE_STATE_PATH = path.join(OPENCLAW_STATE_ROOT, 'agency-agent-template-catalog.json')
const OPENCLAW_AGENTS_ROOT = path.join(OPENCLAW_STATE_ROOT, 'agents')
const SHARED_SKILLS_ROOT = path.join(OPENCLAW_STATE_ROOT, 'skills')
const CODEX_AGENT_PROFILES_ROOT = path.join(HOME_DIR, '.codex', 'agent-profiles')
const CODEX_LEGACY_AGENT_PROFILE_ROOT = path.join(HOME_DIR, '.codex', 'agent-profile')
const LOCAL_AUTH_PATH = path.join(OPENCLAW_STATE_ROOT, 'local-auth.json')
const CONTROL_CENTER_LEDGER_PATHS = runtimeLedgerPathsForStateRoot(OPENCLAW_STATE_ROOT)
const RUNTIME_MONITOR_CLEAR_MARKER_PATH = runtimeMonitorClearMarkerPath(CONTROL_CENTER_LEDGER_PATHS)
const RECOMMENDED_OPENCLAW_VERSION = '2026.7.1-2'
const DEFAULT_OPENCLAW_FAST_MODE = 'auto'
const DEFAULT_OPENCLAW_FAST_AUTO_ON_SECONDS = 60
const FAST_MODE_MODEL_PARAM_PROVIDERS = new Set(['openai', 'openai-codex', 'anthropic', 'xai', 'minimax'])
const MAX_RUNTIME_OUTPUT_CHARS = 1_200_000
const MAX_LOCAL_JSON_RESPONSE_CHARS = 1_200_000
const UPSTREAM_SSE_BUFFER_LIMIT_CHARS = 1_000_000
const FOLDER_PICKER_TIMEOUT_MS = (() => {
  const configured = Number(process.env.CONTROL_CENTER_FOLDER_PICKER_TIMEOUT_MS || 60000)
  return Number.isFinite(configured) && configured >= 5000 ? configured : 60000
})()
const COMMAND_CONSOLE_UPLOADS_DIR = path.join(WORKSPACE_ROOT, '.openclaw', 'command-console-uploads')
const JSON_DISK_CACHE_STAT_MS = 750
const SKILL_LIBRARY_CACHE_MS = 15_000
const CONTROL_CENTER_STARTED_AT_MS = Date.now()

const runtimeLedgerStore = createRuntimeLedgerStore(CONTROL_CENTER_LEDGER_PATHS)
const licenseService = createLicenseService({
  read: runtimeLedgerStore.readControlCenterState,
  write: runtimeLedgerStore.writeControlCenterState,
  remove: runtimeLedgerStore.deleteControlCenterState,
})
const accountAuthService = createAccountAuthService({
  read: runtimeLedgerStore.readControlCenterState,
  write: runtimeLedgerStore.writeControlCenterState,
  licenseService,
  reconcileAccountAccess: async () => {
    // Account login can replace both the canonical license key and the
    // entitlement. Refresh the provisioner-owned balance first, then apply
    // the new hosted/provider route to the live Gateway before the next turn.
    await licenseService.refresh().catch(() => undefined)
    await synchronizeBillingRouteWithGateway()
  },
})

// License routes remain accessible after local authentication. Every other
// control-plane API requires an active customer license.
app.use('/api', (req, res, next) => {
  const requestPath = (req.originalUrl.split('?')[0] || req.path).replace(/\/+$/, '') || '/'
  if (
    requestPath === '/api/ready' ||
    requestPath === '/api/health' ||
    requestPath.startsWith('/api/auth/') ||
    requestPath.startsWith('/api/license/')
  ) return next()
  if (!licenseService.isActive()) {
    return apiFailure(res, 402, 'license_required', 'Activate your Automnia license to use the Control Center.')
  }
  const gate = licenseService.getTrafficGate()
  const isMutatingRequest = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  const isLicenseRecoveryRequest = requestPath === '/api/license/activate'
    || requestPath === '/api/license/checkout'
    || requestPath === '/api/license/deactivate'
    || requestPath === '/api/license/refresh'
  if (gate.blocked && isMutatingRequest && !isLicenseRecoveryRequest) {
    return apiFailure(
      res,
      402,
      'credits_exhausted',
      gate.blockMessage || 'Automnia credits are unavailable. Restore your credit balance before sending traffic.',
      { gate: { creditState: gate.creditState, tier: gate.tier, mode: gate.mode } },
    )
  }
  // The generic OpenClaw command endpoint is intentionally unavailable to
  // credits-only accounts. Otherwise a user could write a provider/model
  // directly through the CLI bridge and bypass the model/config route guards.
  if (gate.creditsOnly && requestPath === '/api/openclaw/command' && isMutatingRequest) {
    return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE)
  }
  return next()
})

function readControlCenterStateRecord<T>(stateKey: string, options?: { sqlite?: boolean }): T | null {
  return runtimeLedgerStore.readControlCenterState<T>(stateKey, options)
}

function writeControlCenterStateRecord(stateKey: string, value: unknown, sourcePath?: string) {
  return runtimeLedgerStore.writeControlCenterState(stateKey, value, sourcePath)
}

async function readLegacyJsonState<T>(
  filePath: string,
  normalize: (value: unknown) => T | null,
): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return normalize(JSON.parse(raw.replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
}

function readLegacyJsonStateSync<T>(
  filePath: string,
  normalize: (value: unknown) => T | null,
): T | null {
  try {
    return normalize(JSON.parse(readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
}

const safePathService = createSafePathService()
const isInsidePath = safePathService.isInsidePath
const isPathUnder = safePathService.isPathUnder
const samePath = safePathService.samePath
const controlFilesService = createControlFilesService(WORKSPACE_ROOT, { isPathUnder })
const commandConsoleUploadService = createCommandConsoleUploadService({
  uploadsDir: COMMAND_CONSOLE_UPLOADS_DIR,
  approvedRootDir: WORKSPACE_ROOT,
  isPathUnder,
})
const pickerSessionService = createPickerSessionService({
  stateRoot: OPENCLAW_STATE_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  timeoutMs: FOLDER_PICKER_TIMEOUT_MS,
  persistAgentAvatarFromPath,
})
const OPENCLAW_BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md'] as const
const OPENCLAW_OPTIONAL_BOOTSTRAP_FILES = ['SOUL.md', 'USER.md', 'HEARTBEAT.md', 'IDENTITY.md'] as const
const AGENT_RESOURCE_FILES = [
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'MDS.json',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'TEAM_STATE.md',
  'TEAM_INTENTS.md',
  'TEAM_SYNC.md',
  'TOOLS.md',
  'MISSION_PROMPT.md',
] as const
const RESOURCE_SEED_FILES = [
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'TEAM_STATE.md',
  'TEAM_INTENTS.md',
  'TOOLS.md',
] as const
const SHARED_TEAM_FILES = ['TEAM_INTENTS.md', 'TEAM_STATE.md', 'TEAM_SYNC.md'] as const
const AUTOMNIA_CREDITS_COMPACT_TOOL_ALLOWLIST = [
  'read',
  'write',
  'edit',
  'exec',
  'process',
  'memory_get',
  'session_status',
] as const
const AUTOMNIA_CREDITS_COMPACT_MEMORY_MAX_CHARS = 720
const AUTOMNIA_CREDITS_COMPACT_TOOL_RESULT_MAX_CHARS = 4000
const AUTOMNIA_CREDITS_COMPACT_MEMORY_GET_MAX_CHARS = 1000
const AUTOMNIA_CREDITS_COMPACT_POST_COMPACTION_MAX_CHARS = 800
const SHARED_AGENT_STATE_DIR = path.join('.openclaw', 'agents')
const AGENT_LOCAL_CONFIG_FILE = 'config.json'
const AGENT_MDS_FILE = 'MDS.json'
const CANONICAL_DOCTRINE_ONLY = true
const ENABLE_HOST_ACTION_SHORTCUTS = false
const CONTROL_CENTER_GATEWAY_AGENT_SESSIONS = !/^(0|false|no)$/i.test(
  process.env.CONTROL_CENTER_GATEWAY_AGENT_SESSIONS || '1',
)
const CONTROL_CENTER_GATEWAY_CHAT_CLIENT = !/^(0|false|no)$/i.test(
  process.env.CONTROL_CENTER_GATEWAY_CHAT_CLIENT || (CONTROL_CENTER_GATEWAY_AGENT_SESSIONS ? '1' : ''),
)
const CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP || '',
)
const CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC || '',
)
// The local embedded runner can be useful for advanced recovery, but it adds a
// second execution stack (and its own provider/session state) to a failed
// Gateway request. Keep it opt-in so a Gateway failure is a contained,
// actionable error instead of silently switching the end user to another agent.
const CONTROL_CENTER_ALLOW_LOCAL_AGENT_FALLBACK = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_ALLOW_LOCAL_AGENT_FALLBACK || '',
)
const FORCE_LOCAL_AGENT_RUNTIME = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_FORCE_LOCAL_AGENT_RUNTIME || '',
)
const CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK || '',
)
const CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN || '',
)
const AUTO_START_GATEWAY = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_AUTOSTART_GATEWAY || (CONTROL_CENTER_GATEWAY_AGENT_SESSIONS ? '1' : ''),
)
const STARTUP_AUTH_PROFILE_SYNC = /^(1|true|yes)$/i.test(process.env.CONTROL_CENTER_STARTUP_AUTH_PROFILE_SYNC || '')
const STARTUP_AGENT_CONFIG_SYNC = /^(1|true|yes)$/i.test(process.env.CONTROL_CENTER_STARTUP_AGENT_CONFIG_SYNC || '')
const CLAWTALK_PLUGIN_ID = 'clawtalk'
const BROWSER_PLUGIN_ID = 'browser'
const EXTERNAL_LOAD_PATH_RESERVED_PLUGIN_IDS = new Set(['codex'])
const CLAWTALK_DEFAULT_SERVER = 'https://clawdtalk.com'
const CLAWTALK_DEFAULT_AGENT_ID = 'hn-coordinator'
const CLAWTALK_AGENT_TOOL_NAMES = [
  'clawtalk_bot_config',
  'clawtalk_call',
  'clawtalk_call_status',
  'clawtalk_sms',
  'clawtalk_sms_list',
  'clawtalk_sms_conversations',
  'clawtalk_approve',
  'clawtalk_status',
  'clawtalk_mission_init',
  'clawtalk_mission_setup_agent',
  'clawtalk_mission_schedule',
  'clawtalk_mission_event_status',
  'clawtalk_mission_complete',
  'clawtalk_mission_update_step',
  'clawtalk_mission_log_event',
  'clawtalk_mission_memory',
  'clawtalk_mission_list',
  'clawtalk_mission_get_plan',
  'clawtalk_mission_cancel_event',
  'clawtalk_assistants',
  'clawtalk_insights',
] as const
const MIN_BROWSER_TIMEOUT_SECONDS = 240
const DISABLE_BROWSER_RUNTIME_DEFAULTS = /^(1|true|yes)$/i.test(
  process.env.CONTROL_CENTER_DISABLE_BROWSER_DEFAULTS || process.env.AUTOMNIA_DISABLE_OPENCLAW_BROWSER || '',
)

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type FastModePreference = 'auto' | 'on' | 'off'
type OpenClawFastModeDefault = 'auto' | boolean
type OpenClawChatFastMode = 'auto' | true
const AGENT_BEHAVIOR_PROFILES = ['executor', 'architect', 'auditor', 'researcher', 'hybrid'] as const
type AgentBehaviorProfile = (typeof AGENT_BEHAVIOR_PROFILES)[number]
type FailureKind =
  | 'timeout'
  | 'rate_limit'
  | 'gateway_disconnect'
  | 'runtime_unavailable'
  | 'auth_expired'
  | 'auth_missing'
  | 'plugin_loader_error'
  | 'stale_lock'
  | 'disk_low'
  | 'provider_unsupported'
  | 'provider_forbidden'
  | 'insufficient_credits'
  | 'sandbox_unavailable'
  | 'network_error'
  | 'process_error'
  | 'aborted'
  | 'interrupted'
  | 'unknown'

type BoundedOperationResult<T> = {
  ok: boolean
  label: string
  elapsedMs: number
  timeoutMs: number
  value?: T
  error?: string
  failureKind?: FailureKind
}

type OpenClawResult = {
  stdout: string
  stderr: string
  code: number
  controlCenterRunId?: string
  failureKind?: FailureKind
  elapsedMs?: number
  timedOut?: boolean
  runtimeTransport?: 'gateway-chat' | 'gateway' | 'local'
  gatewayFallbackDetail?: string
}

function openClawErrorResult(error: unknown): OpenClawResult {
  const text = error instanceof Error ? error.message : String(error)
  return {
    stdout: '',
    stderr: text,
    code: 1,
    failureKind: classifyFailureKind(text, 'failed') || 'unknown',
  }
}

function redactSensitiveText(value: string) {
  return applyDiagnosticRedactions(stripAnsi(value || ''))
}

function sanitizePluginCliError(value: unknown) {
  return sanitizePluginInventoryCliError(value, redactSensitiveText)
}

function pluginCliWarningFromOutput(result: OpenClawResult, command: string) {
  return pluginInventoryCliWarningFromOutput(result, command, redactSensitiveText)
}

let pluginInventoryService: PluginInventoryService | null = null
let pluginInstallService: PluginInstallService | null = null
let pluginDiagnosticsService: PluginDiagnosticsService | null = null
let pluginRuntimeService: PluginRuntimeService | null = null

function activePluginInventoryService() {
  if (!pluginInventoryService) throw new Error('Plugin inventory service is not initialized.')
  return pluginInventoryService
}

function getPluginList(options?: { forceRefresh?: boolean }) {
  return activePluginInventoryService().getPluginList(options)
}

function listPluginControls(options?: { forceRefresh?: boolean }) {
  return activePluginInventoryService().listPluginControls(options)
}

function refreshPluginListCache() {
  return activePluginInventoryService().refreshPluginListCache()
}

function activePluginInstallService() {
  if (!pluginInstallService) throw new Error('Plugin install service is not initialized.')
  return pluginInstallService
}

const installOpenClawPlugin: PluginInstallService['installOpenClawPlugin'] = (params) =>
  activePluginInstallService().installOpenClawPlugin(params)

const updateOpenClawPlugin: PluginInstallService['updateOpenClawPlugin'] = (pluginId, restartRequested) =>
  activePluginInstallService().updateOpenClawPlugin(pluginId, restartRequested)

const updateAllOpenClawPlugins: PluginInstallService['updateAllOpenClawPlugins'] = (restartRequested) =>
  activePluginInstallService().updateAllOpenClawPlugins(restartRequested)

const uninstallOpenClawPlugin: PluginInstallService['uninstallOpenClawPlugin'] = (pluginId, options) =>
  activePluginInstallService().uninstallOpenClawPlugin(pluginId, options)

function activePluginDiagnosticsService() {
  if (!pluginDiagnosticsService) throw new Error('Plugin diagnostics service is not initialized.')
  return pluginDiagnosticsService
}

const setupClawTalkPlugin: PluginDiagnosticsService['setupClawTalkPlugin'] = (params) =>
  activePluginDiagnosticsService().setupClawTalkPlugin(params)

function activePluginRuntimeService() {
  if (!pluginRuntimeService) throw new Error('Plugin runtime service is not initialized.')
  return pluginRuntimeService
}

const inspectOpenClawPluginRuntime: PluginRuntimeService['inspectOpenClawPluginRuntime'] = (pluginId) =>
  activePluginRuntimeService().inspectOpenClawPluginRuntime(pluginId)

const pluginRuntimeInspectReady: PluginRuntimeService['pluginRuntimeInspectReady'] = (inspect) =>
  activePluginRuntimeService().pluginRuntimeInspectReady(inspect)

const stopAllPluginSetupTerminalSessions: PluginRuntimeService['stopAllPluginSetupTerminalSessions'] = (reason) =>
  activePluginRuntimeService().stopAllPluginSetupTerminalSessions(reason)

function classifyFailureKind(text: string, status?: OpenClawRunStatus | null): FailureKind | undefined {
  const clean = stripAnsi(text || '').toLowerCase()
  if (status === 'timeout' || /\b(timeout|timed out|deadline exceeded|abortsignal\.timeout)\b/.test(clean)) return 'timeout'
  if (status === 'aborted' || /\b(aborted|aborterror|signal is aborted|operation was aborted)\b/.test(clean)) return 'aborted'
  if (status === 'interrupted' || /\b(control center restarted|observer interrupted|runtime observer lost)\b/.test(clean)) return 'interrupted'
  if (/\b(rate limit|too many requests|quota exceeded|http 429|status 429|429)\b/.test(clean)) return 'rate_limit'
  if (/\b(openclaw runtime is unavailable|openclaw cli is unavailable|spawn openclaw enoent|openclaw.*enoent|openclaw.*not recognized|not recognized as an internal or external command|openclaw: command not found|command not found: openclaw)\b/.test(clean)) return 'runtime_unavailable'
  if (/\b(auth expired|token expired|expired credential|refresh token|oauth.*expired|invalid_grant)\b/.test(clean)) return 'auth_expired'
  if (/\b(missing auth|no usable|unauthorized|forbidden|401|403|api key missing|credential is missing|not authenticated)\b/.test(clean)) return 'auth_missing'
  if (/\b(gatewaytransporterror|gateway closed|gateway unavailable|gateway unreachable|no close frame|gateway disconnect|gateway.*dropped|socket hang up|econnreset|econnrefused|connection refused)\b/.test(clean)) return 'gateway_disconnect'
  if (/\b(plugin.*(?:load|loader|dependency|missing)|missing dependencies|plugin_loader_error)\b/.test(clean)) return 'plugin_loader_error'
  if (/\b(stale lock|jsonl\.lock|lock file|file lock)\b/.test(clean)) return 'stale_lock'
  if (/\b(no space left|disk full|enospc|low disk)\b/.test(clean)) return 'disk_low'
  if (/\b(unsupported provider|provider unsupported|not configured for .*streaming|unsupported model|model unsupported|unknown model|model not found|model .*not (?:available|supported)|does not exist)\b/.test(clean)) return 'provider_unsupported'
  if (/\b(spawn docker enoent|docker.*enoent|sandbox image not found|openclaw-sandbox|no such image.*sandbox)\b/.test(clean)) return 'sandbox_unavailable'
  if (/\b(network error|fetch failed|etimedout|enotfound|eai_again|tls|certificate)\b/.test(clean)) return 'network_error'
  if (clean.trim()) return 'unknown'
  return undefined
}

function appendBoundedRuntimeOutput(current: string, chunk: unknown) {
  if (current.length >= MAX_RUNTIME_OUTPUT_CHARS) return current
  const text = String(chunk || '')
  if (current.length + text.length <= MAX_RUNTIME_OUTPUT_CHARS) return current + text
  const remaining = Math.max(0, MAX_RUNTIME_OUTPUT_CHARS - current.length)
  return `${current}${text.slice(0, remaining)}\n\n[Output truncated by Control Center at ${MAX_RUNTIME_OUTPUT_CHARS} chars.]`
}

function appendBoundedLocalJsonResponse(current: string, chunk: unknown) {
  if (current.length >= MAX_LOCAL_JSON_RESPONSE_CHARS) return current
  const text = String(chunk || '')
  if (current.length + text.length <= MAX_LOCAL_JSON_RESPONSE_CHARS) return current + text
  const remaining = Math.max(0, MAX_LOCAL_JSON_RESPONSE_CHARS - current.length)
  return `${current}${text.slice(0, remaining)}\n\n[Local HTTP response truncated by Control Center at ${MAX_LOCAL_JSON_RESPONSE_CHARS} chars.]`
}

async function boundedOperation<T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<BoundedOperationResult<T>> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()
  try {
    const value = await operation(controller.signal)
    return { ok: true, label, value, elapsedMs: Date.now() - startedAt, timeoutMs }
  } catch (error) {
    const message = error instanceof Error && error.message ? `${error.name}: ${error.message}` : String(error)
    return {
      ok: false,
      label,
      error: redactSensitiveText(message),
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      failureKind: classifyFailureKind(message, controller.signal.aborted ? 'timeout' : null) || 'unknown',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function isNodeScriptBin(bin: string) {
  const lower = bin.toLowerCase()
  return lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')
}

function isWindowsCommandScript(bin: string) {
  const lower = path.basename(bin).toLowerCase()
  return lower === 'openclaw' || lower.endsWith('.cmd') || lower.endsWith('.bat')
}

function isLikelyNodeExecutable(command: string) {
  const base = path.basename(command || '').toLowerCase()
  return base === 'node' || base === 'node.exe'
}

function executableFileExists(filePath: string) {
  if (!filePath) return false
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    if ((stat.mode & 0o111) === 0) chmodSync(filePath, stat.mode | 0o755)
    return (statSync(filePath).mode & 0o111) !== 0
  } catch {
    return false
  }
}

function nodeToolchainPlatformSegment() {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'linux') return 'linux'
  return ''
}

function nodeToolchainDirMatchesCurrentPlatform(name: string) {
  const platform = nodeToolchainPlatformSegment()
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : ''
  if (!platform || !arch) return false
  return new RegExp(`^node-v\\d+\\.\\d+\\.\\d+-${platform}-${arch}$`, 'i').test(name)
}

function nodeBinInToolchainDir(nodeDir: string) {
  return process.platform === 'win32' ? path.join(nodeDir, 'node.exe') : path.join(nodeDir, 'bin', 'node')
}

function nodeRuntimeCandidatesFromToolchainRoot(root: string) {
  if (!root || !existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && nodeToolchainDirMatchesCurrentPlatform(entry.name))
      .map((entry) => nodeBinInToolchainDir(path.join(root, entry.name)))
  } catch {
    return []
  }
}

function nodeRuntimeToolchainRoots() {
  const electronResourcesPath = getElectronResourcesPath()
  return uniqueStrings(
    electronResourcesPath ? path.join(electronResourcesPath, 'toolchains', 'node') : '',
    path.resolve(process.cwd(), '.cache', 'runtime-bundles', 'toolchains', 'node'),
    ...sourceRootCandidates().map((root) => path.join(root, '.cache', 'runtime-bundles', 'toolchains', 'node')),
  ).filter(Boolean)
}

function nodeRuntimeCommandExists(command: string) {
  if (!command) return false
  if (command === 'node' || command === 'node.exe') return commandExistsOnPath(command)
  return executableFileExists(command)
}

let resolvedNodeRuntimeExecutable: string | null = null

function resolveNodeRuntimeExecutable() {
  if (resolvedNodeRuntimeExecutable) return resolvedNodeRuntimeExecutable
  const pathNode = process.platform === 'win32' ? 'node.exe' : 'node'
  const candidates = uniqueStrings(
    process.env.AUTOMNIA_NODE_BIN || '',
    process.env.NODE_EXE || '',
    process.env.NODE_BINARY || '',
    isLikelyNodeExecutable(process.execPath) ? process.execPath : '',
    ...nodeRuntimeToolchainRoots().flatMap(nodeRuntimeCandidatesFromToolchainRoot),
    pathNode,
  ).filter(Boolean)
  resolvedNodeRuntimeExecutable = candidates.find(nodeRuntimeCommandExists) || pathNode
  return resolvedNodeRuntimeExecutable
}

function quoteCmdArgument(value: string) {
  if (!value) return '""'
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/(["^&|<>])/g, '^$1')
  return /[\s"^&|<>%]/.test(value) ? `"${escaped}"` : escaped
}

function windowsCmdShellSpec(command: string, args: string[]) {
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArgument).join(' ')],
    shell: false,
  } as const
}

function shelllessSpawnSpecForCommand(command: string, args: string[], options: { wrapWindowsPathLookup?: boolean } = {}) {
  if (
    process.platform === 'win32' &&
    (isWindowsCommandScript(command) ||
      (options.wrapWindowsPathLookup && !path.isAbsolute(command) && !/\.(?:exe|com)$/i.test(command)))
  ) {
    return windowsCmdShellSpec(command, args)
  }
  return { command, args, shell: false } as const
}

function openClawSpawnSpecForBin(bin: string, args: string[]) {
  if (isNodeScriptBin(bin)) {
    return { command: resolveNodeRuntimeExecutable(), args: [bin, ...args], shell: false }
  }
  if (process.platform === 'win32') {
    if (isWindowsCommandScript(bin)) return windowsCmdShellSpec(bin, args)
    return { command: bin, args, shell: false }
  }
  return { command: bin, args, shell: false }
}

function currentModuleDir() {
  try {
    const metaUrl = import.meta.url || ''
    if (metaUrl.startsWith('file:')) return path.dirname(fileURLToPath(metaUrl))
    if (metaUrl) return path.dirname(path.resolve(metaUrl))
  } catch {
    // Fall through to the CommonJS path below.
  }
  try {
    return path.dirname(__filename)
  } catch {
    return process.cwd()
  }
}

function sourceRootCandidates() {
  return uniqueStrings(
    process.env.CONTROL_CENTER_APP_ROOT || '',
    path.resolve(process.cwd()),
    path.resolve(currentModuleDir(), '..'),
    path.resolve(currentModuleDir(), '..', '..'),
  ).filter(Boolean)
}

function sourceOpenClawVendorCandidate() {
  for (const root of sourceRootCandidates()) {
    const vendorRoot = path.join(root, 'vendor', 'openclaw')
    const prepScript = path.join(root, 'scripts', 'prepare-openclaw-vendor.cjs')
    if (
      existsSync(path.join(vendorRoot, 'openclaw.mjs')) &&
      existsSync(path.join(vendorRoot, 'package.json')) &&
      existsSync(prepScript)
    ) {
      return { root, vendorRoot, prepScript }
    }
  }
  return null
}

function hasOpenClawEntryArtifact(vendorRoot: string) {
  return existsSync(path.join(vendorRoot, 'dist', 'entry.js')) ||
    existsSync(path.join(vendorRoot, 'dist', 'entry.mjs'))
}

function prepareSourceOpenClawVendorIfMissing() {
  if (/^(1|true|yes)$/i.test(process.env.CONTROL_CENTER_SKIP_OPENCLAW_VENDOR_PREP || '')) return
  const vendor = sourceOpenClawVendorCandidate()
  if (!vendor || hasOpenClawEntryArtifact(vendor.vendorRoot)) return

  console.warn(`[openclaw] missing vendored dist/entry artifact; preparing OpenClaw vendor payload at ${vendor.vendorRoot}`)
  const result = spawnSync(resolveNodeRuntimeExecutable(), [vendor.prepScript], {
    cwd: vendor.root,
    env: {
      ...process.env,
      AUTOMNIA_OPENCLAW_VENDOR_ROOT: vendor.vendorRoot,
    },
    shell: false,
    stdio: 'inherit',
    timeout: 600_000,
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  })
  if (result.status !== 0 || result.error) {
    const detail = result.error ? String(result.error) : `exit ${result.status ?? 'unknown'}`
    console.warn(`[openclaw] OpenClaw vendor preparation failed; Gateway startup may fail: ${detail}`)
  }
}

function openClawExecutableCandidatesForDir(dir: string) {
  return process.platform === 'win32'
    ? [path.join(dir, 'openclaw.cmd'), path.join(dir, 'openclaw.mjs')]
    : [path.join(dir, 'openclaw.mjs')]
}

function sourceReleaseOpenClawBinCandidates() {
  const roots = uniqueStrings(
    process.env.CONTROL_CENTER_APP_ROOT || '',
    path.resolve(process.cwd()),
    path.resolve(currentModuleDir(), '..'),
    path.resolve(currentModuleDir(), '..', '..'),
  ).filter(Boolean)
  const candidates: string[] = []
  for (const root of roots) {
    candidates.push(...openClawExecutableCandidatesForDir(path.join(root, 'resources', 'openclaw')))
    candidates.push(...openClawExecutableCandidatesForDir(path.join(root, 'openclaw')))
    const releaseRoot = path.join(root, 'release')
    candidates.push(...openClawExecutableCandidatesForDir(path.join(releaseRoot, 'win-unpacked', 'resources', 'openclaw')))
    try {
      for (const entry of readdirSync(releaseRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('win-unpacked')) continue
        candidates.push(...openClawExecutableCandidatesForDir(path.join(releaseRoot, entry.name, 'resources', 'openclaw')))
      }
    } catch {
      // Release fallback is best-effort for extracted source/dev bundles.
    }
  }
  return uniqueStrings(...candidates)
}

function commandExistsOnPath(command: string) {
  const result = process.platform === 'win32'
    ? spawnSync('where.exe', [command], {
        stdio: 'ignore',
        timeout: 2000,
        ...(process.platform === 'win32' ? { windowsHide: true } : {}),
      })
    : spawnSync('sh', ['-lc', `command -v ${command}`], {
        stdio: 'ignore',
        timeout: 2000,
      })
  return !result.error && result.status === 0
}

function openClawBinExists(candidate: string) {
  if (candidate === 'openclaw') return commandExistsOnPath('openclaw')
  return existsSync(candidate)
}

function sameResolvedRuntimePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function isUsableOpenClawBin(candidate: string) {
  if (!openClawBinExists(candidate)) return false
  const spec = openClawSpawnSpecForBin(candidate, ['--help'])
  const result = spawnSync(spec.command, spec.args, {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    shell: spec.shell,
    stdio: 'ignore',
    timeout: 5000,
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  })
  return !result.error && result.status === 0
}

function embeddedOpenClawBinCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  const resourceCandidates = electronResourcesPath
    ? openClawExecutableCandidatesForDir(path.join(electronResourcesPath, 'openclaw'))
    : []
  const candidates = process.platform === 'win32'
    ? [
        path.resolve(process.cwd(), 'vendor', 'openclaw', 'openclaw.cmd'),
        path.resolve(process.cwd(), 'vendor', 'openclaw', 'openclaw.mjs'),
        path.resolve(process.cwd(), 'resources', 'openclaw', 'openclaw.cmd'),
        path.resolve(process.cwd(), 'resources', 'openclaw', 'openclaw.mjs'),
        ...resourceCandidates,
        ...sourceReleaseOpenClawBinCandidates(),
      ]
    : [
        path.resolve(process.cwd(), 'vendor', 'openclaw', 'openclaw.mjs'),
        path.resolve(process.cwd(), 'resources', 'openclaw', 'openclaw.mjs'),
        ...resourceCandidates,
        ...sourceReleaseOpenClawBinCandidates(),
      ]
  return uniqueStrings(...candidates)
}

function cliOpenClawBinCandidates() {
  return process.platform === 'win32'
    ? uniqueStrings(
        path.join(process.env.APPDATA || '', 'npm', 'openclaw.cmd'),
        path.resolve(WORKSPACE_ROOT, '..', 'cLAW', 'openclaw', 'openclaw.cmd'),
        path.resolve(WORKSPACE_ROOT, '..', 'cLAW', 'openclaw', 'openclaw.mjs'),
        'openclaw',
      )
    : uniqueStrings(
        path.resolve(WORKSPACE_ROOT, '..', 'cLAW', 'openclaw', 'openclaw.mjs'),
        path.resolve(WORKSPACE_ROOT, '..', 'cLAW', 'openclaw', 'dist', 'openclaw.mjs'),
        'openclaw',
      )
}

function resolveOpenClawBin() {
  const configured = process.env.OPENCLAW_BIN?.trim()
  if (configured) return configured

  const embeddedCandidates = embeddedOpenClawBinCandidates()
  const embedded = embeddedCandidates.find((candidate) => isUsableOpenClawBin(candidate))
  if (embedded) return embedded
  const existingEmbedded = embeddedCandidates.find(openClawBinExists)
  if (FORCE_LOCAL_AGENT_RUNTIME && existingEmbedded) {
    console.warn(`[openclaw] embedded runtime exists but did not pass preflight; forcing local runtime: ${existingEmbedded}`)
    return existingEmbedded
  }

  const cliCandidates = cliOpenClawBinCandidates()
  const cli = cliCandidates.find((candidate) => isUsableOpenClawBin(candidate))
  if (cli) return cli

  return existingEmbedded || cliCandidates.find(openClawBinExists) || 'openclaw'
}

traceControlCenterStartup('preparing bundled OpenClaw runtime')
prepareSourceOpenClawVendorIfMissing()
traceControlCenterStartup('resolving bundled OpenClaw runtime')
const openclawBin = resolveOpenClawBin()
traceControlCenterStartup('bundled OpenClaw runtime resolved')
if (openclawBin && openclawBin !== 'openclaw') process.env.OPENCLAW_BIN = openclawBin

function isOpenClawRuntimeAvailable() {
  return Boolean(openclawBin && openClawBinExists(openclawBin))
}

function openClawRuntimeUnavailableMessage() {
  const configured = process.env.OPENCLAW_BIN?.trim()
  const checked = embeddedOpenClawBinCandidates()
    .concat(cliOpenClawBinCandidates())
    .filter((candidate) => candidate !== 'openclaw')
  const checkedPreview = checked.slice(0, 8).join(', ')
  return [
    'OpenClaw runtime is unavailable: no bundled OpenClaw CLI was found and "openclaw" is not on PATH.',
    configured ? `OPENCLAW_BIN=${configured}` : '',
    checkedPreview ? `Checked: ${checkedPreview}${checked.length > 8 ? ', ...' : ''}` : '',
  ].filter(Boolean).join(' ')
}

function resolvedOpenClawRuntimeInfo() {
  const embedded = openclawBin !== 'openclaw' && embeddedOpenClawBinCandidates()
    .some((candidate) => openClawBinExists(candidate) && sameResolvedRuntimePath(candidate, openclawBin))
  let version: string | null = null
  if (openclawBin !== 'openclaw') {
    try {
      const parsed = JSON.parse(readFileSync(path.join(path.dirname(openclawBin), 'package.json'), 'utf-8')) as { version?: unknown }
      version = typeof parsed.version === 'string' ? parsed.version : null
    } catch {
      version = null
    }
  }
  return {
    bin: openclawBin,
    embedded,
    available: isOpenClawRuntimeAvailable(),
    version,
    node: process.versions.node,
  }
}

function openClawSpawnSpec(args: string[]) {
  return openClawSpawnSpecForBin(openclawBin, args)
}

function openClawRuntimeCwd() {
  return openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : WORKSPACE_ROOT
}

function openClawProcessEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    OPENCLAW_BIN: openclawBin,
    OPENCLAW_RUNTIME: openclawBin,
    OPENCLAW_STATE_DIR: OPENCLAW_STATE_ROOT,
    OPENCLAW_HOME: HOME_DIR,
    OPENCLAW_CONFIG_PATH,
    OPENCLAW_GATEWAY_LOG_PATH,
    OPENCLAW_PROFILE,
    OPENCLAW_WORKSPACE_ROOT: WORKSPACE_ROOT,
    CONTROL_CENTER_WORKSPACE_ROOT: WORKSPACE_ROOT,
    ...getGoogleVertexProcessEnv(),
    ...getGatewayAuthEnv(),
    ...getLocalAuthEnv(),
    ...overrides,
  }

  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

async function terminateProcessTree(pid: number | undefined, reason = 'runtime cleanup', force = false): Promise<{ ok: boolean; detail: string }> {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return { ok: false, detail: 'missing pid' }
  if (!isPidAlive(pid)) return { ok: true, detail: `pid ${pid} already exited` }

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      let settled = false
      const settle = (result: { ok: boolean; detail: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }
      const args = ['/PID', String(pid), '/T']
      if (force) args.push('/F')
      const child = spawn('taskkill.exe', args, {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      const timeout = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // taskkill may have already exited.
        }
        settle({ ok: false, detail: `taskkill timeout for pid ${pid}` })
      }, 5000)
      child.on('error', (error) => settle({ ok: false, detail: String(error) }))
      child.on('close', (code) => settle({ ok: code === 0 || !isPidAlive(pid), detail: `${reason}: taskkill exit ${code ?? 'unknown'} for pid ${pid}` }))
    })
  }

  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
    return { ok: true, detail: `${reason}: signaled process group ${pid}` }
  } catch {
    try {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
      return { ok: true, detail: `${reason}: signaled pid ${pid}` }
    } catch (error) {
      return { ok: !isPidAlive(pid), detail: `${reason}: ${String(error)}` }
    }
  }
}


type AgentIdentity = {
  name?: string
  theme?: string
  emoji?: string
  avatar?: string
}

type AgentConfigEntry = {
  id: string
  default?: boolean
  workspace?: string
  agentDir?: string
  sandbox?: AgentSandboxConfig
  tools?: AgentToolsConfig
  skills?: string[]
  systemPromptOverride?: string
  fastModeDefault?: OpenClawFastModeDefault
  identity?: AgentIdentity
  name?: string
  modelOverride?: string
  model?: {
    primary?: string
    fallbacks?: string[]
  }
  contextLimits?: {
    memoryGetMaxChars?: number
    memoryGetDefaultLines?: number
    toolResultMaxChars?: number
    postCompactionMaxChars?: number
  }
}

type OpenClawModelAllowlistEntry = {
  alias?: string
  params?: {
    fastMode?: OpenClawFastModeDefault
    fastAutoOnSeconds?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

type AgentSandboxConfig = {
  mode?: 'off' | 'all' | 'non-main'
  scope?: 'session' | 'agent' | 'shared'
  workspaceRoot?: string
  workspaceAccess?: 'rw' | 'ro' | 'none'
  docker?: Record<string, unknown>
  browser?: Record<string, unknown>
  prune?: Record<string, unknown>
}

type ProviderToolPolicy = {
  profile?: string
  allow?: string[]
  deny?: string[]
}

type AgentToolsConfig = {
  profile?: string
  alsoAllow?: string[]
  allow?: string[]
  deny?: string[]
  byProvider?: Record<string, ProviderToolPolicy>
  sandbox?: {
    tools?: {
      allow?: string[]
      deny?: string[]
    }
  }
  elevated?: {
    enabled?: boolean
  }
}

const OPENCLAW_TOOL_PROFILES = new Set(['minimal', 'coding', 'messaging', 'full'])
const LEGACY_TOOL_PROFILE_ALIASES: Record<string, string> = {
  balanced: 'full',
}

type OpenClawPluginEntryConfig = {
  enabled?: boolean
  config?: Record<string, unknown>
  env?: Record<string, string>
  source?: string
  path?: string
  package?: string
  [key: string]: unknown
}

type OpenClawPluginsConfig = {
  enabled?: boolean
  allow?: string[]
  deny?: string[]
  entries?: Record<string, OpenClawPluginEntryConfig>
  load?: {
    extraDirs?: string[]
    paths?: string[]
    watch?: boolean
    watchDebounceMs?: number
    [key: string]: unknown
  }
  slots?: {
    memory?: string
  }
  [key: string]: unknown
}

type OpenClawContextPruningConfig = {
  mode?: 'off' | 'cache-ttl'
  ttl?: string
  keepLastAssistants?: number
  softTrimRatio?: number
  hardClearRatio?: number
  minPrunableToolChars?: number
  tools?: { allow?: string[]; deny?: string[] }
  softTrim?: { maxChars?: number; headChars?: number; tailChars?: number }
  hardClear?: { enabled?: boolean; placeholder?: string }
}

type OpenClawBinding = {
  agentId: string
  match?: {
    channel?: string
    accountId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

type OpenClawSessionConfig = {
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer'
  maintenance?: {
    mode?: 'enforce' | 'warn'
    pruneAfter?: string | number
    maxEntries?: number
    rotateBytes?: string | number
    resetArchiveRetention?: string | number | false
    maxDiskBytes?: string | number
    highWaterBytes?: string | number
  }
  [key: string]: unknown
}

type OpenClawMemoryConfig = {
  backend?: 'builtin' | 'qmd'
  citations?: 'auto' | 'on' | 'off'
  qmd?: {
    command?: string
    searchMode?: 'query' | 'search' | 'vsearch'
    includeDefaultMemory?: boolean
    sessions?: { enabled?: boolean; exportDir?: string; retentionDays?: number }
    update?: {
      interval?: string
      debounceMs?: number
      startup?: 'off' | 'idle' | 'immediate'
      commandTimeoutMs?: number
      updateTimeoutMs?: number
      embedTimeoutMs?: number
    }
    limits?: {
      maxResults?: number
      maxSnippetChars?: number
      maxInjectedChars?: number
      timeoutMs?: number
    }
    scope?: {
      default?: 'allow' | 'deny'
      rules?: Array<{ action: 'allow' | 'deny'; match?: { chatType?: 'direct' | 'group' | 'channel' | 'dm'; channel?: string; keyPrefix?: string; rawKeyPrefix?: string } }>
    }
  }
}

type OpenClawConfigFile = {
  models?: {
    providers?: Record<string, ModelProviderConfig>
    [key: string]: unknown
  }
  channels?: {
    modelByChannel?: Record<string, Record<string, string>>
    [key: string]: unknown
  }
  gateway?: {
    mode?: string
    [key: string]: unknown
  }
  env?: {
    vars?: Record<string, unknown>
    [key: string]: unknown
  }
  session?: OpenClawSessionConfig
  memory?: OpenClawMemoryConfig
  secrets?: {
    providers?: Record<string, Record<string, unknown>>
    [key: string]: unknown
  }
  skills?: {
    allowBundled?: string[]
    entries?: Record<
      string,
      {
        enabled?: boolean
        apiKey?: string
        env?: Record<string, string>
        config?: Record<string, unknown>
      }
    >
    load?: {
      watch?: boolean
      watchDebounceMs?: number
      extraDirs?: string[]
    }
    install?: {
      nodeManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
    }
  }
  plugins?: OpenClawPluginsConfig
  bindings?: OpenClawBinding[]
  tools?: {
    profile?: string
    alsoAllow?: string[]
    allow?: string[]
    deny?: string[]
    byProvider?: Record<string, ProviderToolPolicy>
    sandbox?: { tools?: { allow?: string[]; deny?: string[] } }
    subagents?: { tools?: { allow?: string[]; deny?: string[] } }
    elevated?: { enabled?: boolean }
    web?: {
      search?: {
        enabled?: boolean
        provider?: string
        [key: string]: unknown
      }
      [key: string]: unknown
    }
    agentToAgent?: {
      enabled?: boolean
      allow?: string[]
    }
  }
  agents?: {
    list?: AgentConfigEntry[]
    defaults?: {
      workspace?: string
      timeoutSeconds?: number
      fastModeDefault?: OpenClawFastModeDefault
      // Shared agent-wide prompt budget. OpenClaw clamps this to the active
      // model's own context window, so it is safe across provider families.
      contextTokens?: number
      modelOverride?: string
      model?: { primary?: string; fallbacks?: string[] }
      models?: Record<string, OpenClawModelAllowlistEntry>
      imageMaxDimensionPx?: number
      imageQuality?: 'auto' | 'efficient' | 'balanced' | 'high'
      sandbox?: AgentSandboxConfig
      skipBootstrap?: boolean
      skipOptionalBootstrapFiles?: string[]
      systemPromptOverride?: string
      contextInjection?: 'always' | 'continuation-skip' | 'never'
      bootstrapMaxChars?: number
      bootstrapTotalMaxChars?: number
      bootstrapPromptTruncationWarning?: 'off' | 'once' | 'always'
      startupContext?: {
        enabled?: boolean
        applyOn?: Array<'new' | 'reset'>
        dailyMemoryDays?: number
        maxFileBytes?: number
        maxFileChars?: number
        maxTotalChars?: number
      }
      compaction?: {
        enabled?: boolean
        mode?: 'default' | 'safeguard'
        timeoutSeconds?: number
        reserveTokens?: number
        keepRecentTokens?: number
        reserveTokensFloor?: number
        maxActiveTranscriptBytes?: string | number
        truncateAfterCompaction?: boolean
        notifyUser?: boolean
        midTurnPrecheck?: {
          enabled?: boolean
        }
        memoryFlush?: {
          enabled?: boolean
          softThresholdTokens?: number
          systemPrompt?: string
          prompt?: string
        }
      }
      contextLimits?: {
        memoryGetMaxChars?: number
        memoryGetDefaultLines?: number
        toolResultMaxChars?: number
        postCompactionMaxChars?: number
      }
      contextPruning?: OpenClawContextPruningConfig
      memorySearch?: {
        enabled?: boolean
        provider?: string
        model?: string
        fallback?: string
        extraPaths?: string[]
        sync?: {
          watch?: boolean
        }
        cache?: {
          enabled?: boolean
          maxEntries?: number
        }
        store?: {
          path?: string
        }
        query?: {
          hybrid?: {
            enabled?: boolean
            vectorWeight?: number
            textWeight?: number
            candidateMultiplier?: number
          }
        }
      }
    }
  }
}

type AgentSkillSource = 'bundled' | 'library' | 'agent' | 'learned' | 'clawhub'

type AgentSkillEntry = {
  id: string
  name: string
  description: string
  source: AgentSkillSource
  path?: string
  learnedAt?: string
  xpValue?: number
}

type AgentSkillLibraryState = {
  knownSkills: AgentSkillEntry[]
  preferredSkills: string[]
  lastSyncedAt?: string
}

type AgentLocalConfig = {
  schemaVersion: number
  agent: {
    id: string
    displayName: string
    aliases: string[]
    tags: string[]
    createdAt: string
    updatedAt: string
  }
  identity: {
    name: string
    emoji: string
    theme: string
    avatar: string
  }
  routing: {
    workspace: string
    canonicalFolder: string
  }
  model: {
    primary: string
    fallbacks: string[]
  }
  profile: AgentProfile
  attributes: {
    intelligence: number
    speed: number
    precision: number
    creativity: number
    stability: number
    compute: number
    parallelism: number
  }
  soul: {
    personality: 'analytical' | 'creative' | 'aggressive' | 'conservative'
    autonomyLevel: number
    riskTolerance: number
    reflectionDepth: number
    goalOrientation: number
    persistence: number
    alignmentMode: 'strict' | 'balanced' | 'exploratory'
  }
  heartbeat: {
    tickIntervalMs: number
    maxExecutionTimeMs: number | null
    continuous: boolean
    idleTimeoutMs: number
    recoveryMode: boolean
  }
  mds: {
    maxContextTokens: number
    delegationAllowed: boolean
    subAgentSpawnLimit: number
    toolAccess: string[]
    capabilities: Record<'codeGeneration' | 'planning' | 'research' | 'orchestration' | 'memoryManagement', boolean>
    skillLibrary?: AgentSkillLibraryState
  }
  memory: {
    journalDir: string
    retentionDays: number
  }
  runtime: {
    thinkingDefault: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    timeoutSeconds: number
    parallelPreferred: boolean
    fastModeDefault: FastModePreference
  }
  auth: {
    providers: Record<string, { mode: 'oauth' | 'apiKey'; apiKey?: string }>
  }
  sandbox: AgentSandboxConfig
  tools: AgentToolsConfig
}

type AgentResourceFile = (typeof AGENT_RESOURCE_FILES)[number]
type SharedTeamFile = (typeof SHARED_TEAM_FILES)[number]
const EDITOR_RESOURCE_FILES = AGENT_RESOURCE_FILES.filter(
  (file): file is AgentResourceFile => file.toLowerCase().endsWith('.md'),
)

type AgentStats = {
  execution: number
  reliability: number
  speed: number
  analysis: number
  communication: number
}

type AgentProfile = {
  skills: string[]
  abilities: string[]
  tools: string[]
  behaviorProfile: AgentBehaviorProfile
  className: string
  role: string
  motto: string
  bio: string
  avatar?: string
  level: number
  stats: AgentStats
}

type PartialAgentProfileInput = Partial<Omit<AgentProfile, 'stats'>> & {
  stats?: Partial<AgentStats>
}

type PartyProfiles = {
  agents: Record<string, AgentProfile>
}

type JsonFileCacheEntry<T> = {
  path: string
  mtimeMs: number
  size: number
  checkedAt: number
  value: T
}

type TimedValueCache<T> = {
  expiresAt: number
  value: T
}

const GOOGLE_VERTEX_GLOBAL_BASE_URL = 'https://aiplatform.googleapis.com'
const GOOGLE_VERTEX_REGION_HOST_SUFFIX = '-aiplatform.googleapis.com'
const GOOGLE_VERTEX_MULTI_REGION_HOSTS = new Set(['aiplatform.eu.rep.googleapis.com', 'aiplatform.us.rep.googleapis.com'])
const GOOGLE_VERTEX_MODEL_AVAILABILITY_CACHE_MS = 10 * 60 * 1000
const OPENCLAW_STALE_LOCK_MIN_AGE_MS = 15_000
const OPENCLAW_SESSION_LOCK_ORPHAN_GRACE_MS = 30_000
const OPENCLAW_SESSION_LOCK_SWEEP_INTERVAL_MS = 20_000
const OPENCLAW_SESSION_WRITE_LOCK_STALE_MS = 30 * 60 * 1000
const OPENCLAW_SESSION_LOCK_REPORT_ONLY_REASONS = new Set(['too-old', 'hold-exceeded'])


const CODEX_PROVIDER_BASE_URL = 'https://chatgpt.com/backend-api'
const CODEX_APP_SERVER_AUTH_MARKER = 'codex-app-server'

const OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS = 10 * 60
const OPENCLAW_TIMEOUT_RECOVERY_SECONDS = 15 * 60
const MODEL_RESILIENCE_FALLBACKS: Record<string, string[]> = {
  [AUTOMNIA_CREDITS_MODEL_ID]: [...AUTOMNIA_CREDITS_FALLBACK_MODEL_IDS],
  'openai/gpt-5.6-sol': [
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-luna',
  ],
  'openai/gpt-5.6-terra': [
    'openai/gpt-5.6-sol',
    'openai/gpt-5.6-luna',
  ],
  'openai/gpt-5.6-luna': [
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-sol',
  ],
  'google/gemini-3.7-flash': [
    'google/gemini-3.6-flash',
    'google/gemini-3.5-flash',
    'google/gemini-3.1-flash-lite',
  ],
  'google/gemini-3.6-flash': [
    'google/gemini-3.5-flash',
    'google/gemini-3.1-flash-lite',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-lite',
  ],
  'google-vertex/gemini-3.7-flash': [
    'google-vertex/gemini-3.6-flash',
    'google-vertex/gemini-3.5-flash',
    'google-vertex/gemini-3.1-flash-lite',
  ],
  'google-vertex/gemini-3.6-flash': [
    'google-vertex/gemini-3.5-flash',
    'google-vertex/gemini-3.1-flash-lite',
    'google-vertex/gemini-2.5-flash',
    'google-vertex/gemini-2.5-flash-lite',
  ],
  'google-vertex/gemini-3.5-flash': [
    'google-vertex/gemini-3-flash-preview',
    'google-vertex/gemini-3.1-flash-lite',
    'google-vertex/gemini-2.5-flash',
    'google-vertex/gemini-2.5-flash-lite',
  ],
  'google-vertex/gemini-3-flash-preview': [
    'google-vertex/gemini-3.1-flash-lite',
    'google-vertex/gemini-2.5-flash',
    'google-vertex/gemini-2.5-flash-lite',
  ],
  'google-vertex/gemini-3.1-flash-lite': [
    'google-vertex/gemini-2.5-flash',
    'google-vertex/gemini-2.5-flash-lite',
  ],
  'deepseek/deepseek-v4-flash': [
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-reasoner',
  ],
  'deepseek/deepseek-v4-pro': [
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-reasoner',
  ],
  'deepseek/deepseek-chat': [
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-reasoner',
  ],
  'deepseek/deepseek-reasoner': [
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-chat',
  ],
  'openrouter/deepseek/deepseek-v4-flash': [
    'openrouter/deepseek/deepseek-v4-pro',
  ],
  'openrouter/deepseek/deepseek-v4-pro': [
    'openrouter/deepseek/deepseek-v4-flash',
  ],
}
const OPENROUTER_DEEPSEEK_V4_PRO_MODEL_ID = 'openrouter/deepseek/deepseek-v4-pro'
const OPENROUTER_DEEPSEEK_V4_FLASH_MODEL_ID = 'openrouter/deepseek/deepseek-v4-flash'
const OPENAI_DEFAULT_MODEL_ID = 'openai/gpt-5.6-terra'
const DEEPSEEK_DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash'
const DEEPSEEK_DEFAULT_FALLBACKS = MODEL_RESILIENCE_FALLBACKS[DEEPSEEK_DEFAULT_MODEL_ID] || [
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'deepseek/deepseek-v4-pro',
]
const DEEPSEEK_ONLY_DEFAULTS = /^(1|true|yes)$/i.test(process.env.AUTOMNIA_DEEPSEEK_ONLY_DEFAULTS || '')
const DEFAULT_AGENT_MODEL_ID = process.env.AUTOMNIA_DEFAULT_AGENT_MODEL?.trim() || OPENAI_DEFAULT_MODEL_ID
const GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS = new Set([
  DEEPSEEK_DEFAULT_MODEL_ID,
  ...DEEPSEEK_DEFAULT_FALLBACKS,
])
const GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS = new Set([
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL_ID,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL_ID,
])
const GENERATED_DEEPSEEK_ROUTE_MODEL_IDS = new Set([
  ...GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS,
  ...GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS,
])
const OPENAI_DEFAULT_MODEL_IDS = new Set(
  FALLBACK_MODELS
    .map((entry) => entry.id)
    .filter((modelId) => splitModelId(modelId).provider === 'openai'),
)

function defaultAgentModelSelection() {
  return {
    primary: DEFAULT_AGENT_MODEL_ID,
    ...(DEFAULT_AGENT_MODEL_ID === DEEPSEEK_DEFAULT_MODEL_ID && DEEPSEEK_DEFAULT_FALLBACKS.length
      ? { fallbacks: [...DEEPSEEK_DEFAULT_FALLBACKS] }
      : {}),
  }
}

let openclawConfigCache: JsonFileCacheEntry<OpenClawConfigFile> | null = null
let partyProfilesCache: JsonFileCacheEntry<PartyProfiles> | null = null
const agentLocalConfigCache = new Map<string, JsonFileCacheEntry<AgentLocalConfig>>()
const skillRootCache = new Map<string, TimedValueCache<AgentSkillEntry[]>>()

function thinkingForOpenClawRuntimeModel(modelId: string, thinking: ThinkingLevel): ThinkingLevel {
  if (isOpenAiCodexSubscriptionModel(modelId)) return 'off'
  return thinkingForAutomniaGeminiRuntimeModel(modelId, googleGeminiThinkingForModel(modelId, thinking))
}

function primaryModelForOpenClawConfig(modelId: string | undefined) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  if (canonicalModelId && isModelSafeForOpenClawConfig(canonicalModelId)) return canonicalModelId
  return DEFAULT_AGENT_MODEL_ID
}

function fallbackModelForOpenClawConfig(modelId: string | undefined) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  return canonicalModelId && isModelSafeForOpenClawConfig(canonicalModelId) ? canonicalModelId : ''
}

function resilienceFallbacksForModel(modelId: string) {
  return MODEL_RESILIENCE_FALLBACKS[canonicalAgentModelId(modelId)] || []
}

function modelSelectionForOpenClawConfig(model: { primary?: string; fallbacks?: string[] }) {
  const primary = primaryModelForOpenClawConfig(model.primary)
  const fallbackSet = new Set<string>()
  for (const modelId of [...(model.fallbacks || []), ...resilienceFallbacksForModel(primary)]) {
    const fallback = fallbackModelForOpenClawConfig(modelId)
    if (fallback && fallback !== primary) fallbackSet.add(fallback)
  }
  return { primary, fallbacks: Array.from(fallbackSet) }
}

function shouldMigrateGeneratedDeepSeekDefaults() {
  return !DEEPSEEK_ONLY_DEFAULTS && canonicalAgentModelId(DEFAULT_AGENT_MODEL_ID) !== DEEPSEEK_DEFAULT_MODEL_ID
}

function modelSelectionLooksLikeGeneratedDeepSeekDefault(selection: { primary?: string; fallbacks?: string[] } | undefined) {
  if (!selection || !shouldMigrateGeneratedDeepSeekDefaults()) return false
  const primary = canonicalAgentModelId(selection.primary)
  if (!primary) return false
  const modelIds = [primary, ...(selection.fallbacks || []).map((modelId) => canonicalAgentModelId(modelId)).filter(Boolean)]
  return GENERATED_DEEPSEEK_ROUTE_MODEL_IDS.has(primary) &&
    modelIds.every((modelId) => GENERATED_DEEPSEEK_ROUTE_MODEL_IDS.has(modelId))
}

function applyGeneratedDeepSeekDefaultMigration(selection: { primary?: string; fallbacks?: string[] } | undefined) {
  if (!modelSelectionLooksLikeGeneratedDeepSeekDefault(selection)) return false
  if (!selection) return false
  const next = defaultAgentModelSelection()
  selection.primary = next.primary
  if (next.fallbacks?.length) selection.fallbacks = [...next.fallbacks]
  else delete selection.fallbacks
  return true
}

function migrateGeneratedDeepSeekDefaultsInOpenClawConfig(config: OpenClawConfigFile) {
  if (!shouldMigrateGeneratedDeepSeekDefaults()) return false
  let changed = false
  if (config.agents?.defaults?.model) {
    changed = applyGeneratedDeepSeekDefaultMigration(config.agents.defaults.model) || changed
  }
  for (const entry of config.agents?.list || []) {
    changed = applyGeneratedDeepSeekDefaultMigration(entry.model) || changed
  }
  return changed
}

function migrateGeneratedDeepSeekDefaultPrimary(modelId: string | undefined) {
  const selection = { primary: modelId }
  return applyGeneratedDeepSeekDefaultMigration(selection)
    ? selection.primary
    : modelId
}

function agentRuntimeModelIdsForConfig(config: OpenClawConfigFile) {
  const modelIds = new Set<string>()
  const add = (modelId: string | undefined) => {
    const canonical = canonicalAgentModelId(modelId)
    if (isModelSafeForOpenClawConfig(canonical)) modelIds.add(canonical)
  }
  const addSelection = (selection: { primary?: string; fallbacks?: string[] } | undefined) => {
    add(selection?.primary)
    for (const modelId of selection?.fallbacks || []) add(modelId)
  }

  const defaultCatalogModelIds = DEEPSEEK_ONLY_DEFAULTS
    ? [DEEPSEEK_DEFAULT_MODEL_ID, ...DEEPSEEK_DEFAULT_FALLBACKS]
    : uniqueStrings(DEFAULT_AGENT_MODEL_ID, ...resilienceFallbacksForModel(DEFAULT_AGENT_MODEL_ID))
  for (const modelId of defaultCatalogModelIds) add(modelId)
  addSelection(config.agents?.defaults?.model)
  for (const modelId of Object.keys(config.agents?.defaults?.models || {})) add(modelId)
  for (const agent of config.agents?.list || []) addSelection(agent.model)
  return Array.from(modelIds)
}

function normalizedAgentRuntimeId(value: unknown) {
  if (typeof value === 'string') return value.trim().toLowerCase()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id.trim().toLowerCase() : ''
}

function recordUsesCodexAgentRuntime(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return normalizedAgentRuntimeId((value as { agentRuntime?: unknown }).agentRuntime) === 'codex'
}

function modelRuntimeMapUsesCodexRuntime(models: unknown) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) return false
  return Object.values(models as Record<string, unknown>).some(recordUsesCodexAgentRuntime)
}

function providerModelListHasExplicitCodexRuntime(providerConfig: ModelProviderConfig | undefined) {
  if (!providerConfig || !Array.isArray(providerConfig.models)) return false
  return providerConfig.models.some(recordUsesCodexAgentRuntime)
}

function openClawConfigNeedsCodexPlugin(config: OpenClawConfigFile) {
  const openAiProvider = config.models?.providers?.openai
  const openAiRuntimeId = normalizedAgentRuntimeId(openAiProvider?.agentRuntime)
  if (openAiRuntimeId === 'codex') return true
  if (providerModelListHasExplicitCodexRuntime(openAiProvider)) return true
  if (modelRuntimeMapUsesCodexRuntime(config.agents?.defaults?.models)) return true
  for (const agent of config.agents?.list || []) {
    if (modelRuntimeMapUsesCodexRuntime((agent as AgentConfigEntry & { models?: unknown }).models)) return true
  }
  return false
}

function codexPluginForceEnableRequested() {
  return /^(1|true|yes)$/i.test(process.env.AUTOMNIA_ENABLE_EXTERNAL_CODEX_PLUGIN || '')
}

function isCodexPluginExplicitlyEnabled(config: OpenClawConfigFile) {
  return codexPluginForceEnableRequested() || config.plugins?.entries?.codex?.enabled === true
}

function shouldPrepareCodexPluginForRuntime(config: OpenClawConfigFile) {
  return openClawConfigNeedsCodexPlugin(config) || isCodexPluginExplicitlyEnabled(config)
}

function ensureCodexPluginExplicitEnablement(config: OpenClawConfigFile) {
  const forceEnable = codexPluginForceEnableRequested()
  const existingEntry = config.plugins?.entries?.codex
  if (!forceEnable && existingEntry?.enabled !== true && !openClawConfigNeedsCodexPlugin(config)) return

  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}

  config.plugins.entries.codex = {
    ...(existingEntry || {}),
    enabled: true,
  }
  if (Array.isArray(config.plugins.deny) && config.plugins.deny.includes('codex')) {
    config.plugins.deny = config.plugins.deny.filter((entry) => entry !== 'codex')
  }
  ensureTrustedPluginAllowlist(config, 'codex')
}

function ensureOpenRouterPluginEnabledForProviderAuth(config: OpenClawConfigFile) {
  ensureProviderPluginEnabledForProviderAuth(config, 'openrouter')
}

function ensureBundledProviderPluginEnabledForProviderAuth(config: OpenClawConfigFile, pluginId: 'meta') {
  ensureProviderPluginEnabledForProviderAuth(config, pluginId)
}

function ensureProviderPluginEnabledForProviderAuth(config: OpenClawConfigFile, pluginId: 'openrouter' | 'meta') {
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  const existingEntry = config.plugins.entries[pluginId] || {}
  config.plugins.entries[pluginId] = {
    ...(existingEntry || {}),
    enabled: true,
  }
  if (Array.isArray(config.plugins.deny) && config.plugins.deny.includes(pluginId)) {
    config.plugins.deny = config.plugins.deny.filter((entry) => entry !== pluginId)
  }
  ensureTrustedPluginAllowlist(config, pluginId)
}

const providerAuthServiceRef: { current?: ProviderAuthService } = {}
const oauthCallbackServiceRef: { current?: OAuthCallbackService } = {}
const modelCatalogService = createModelCatalogService({
  ensureFastModeModelParams: (config: ModelCatalogOpenClawConfig, modelId: string) => {
    ensureFastModeModelParams(config as OpenClawConfigFile, modelId)
  },
  filterGoogleVertexCatalogModels,
  isProviderConfigured: (provider) => providerAuthServiceRef.current?.isProviderConfigured(provider) ?? false,
  readOpenclawConfig,
  runOpenClaw,
  streamingCapabilityForModel,
  writeOpenclawConfig,
})
const configHasOpenRouterPluginEnabled = modelCatalogService.configHasOpenRouterPluginEnabled
const ensureConfiguredModelAllowlist = (config: OpenClawConfigFile, modelIds: string[]) =>
  modelCatalogService.ensureConfiguredModelAllowlist(config, modelIds)
const ensureOpenRouterModelCatalogAllowlist = (config: OpenClawConfigFile) =>
  modelCatalogService.ensureOpenRouterModelCatalogAllowlist(config)
const fallbackAvailableModels = modelCatalogService.fallbackAvailableModels
const getFastAvailableModelsCatalog = modelCatalogService.getFastAvailableModelsCatalog
const invalidateAvailableModelsForAuthChange = modelCatalogService.invalidateAvailableModelsForAuthChange
const refreshAvailableModelsCache = modelCatalogService.refreshAvailableModelsCache

const providerSetupService = createProviderSetupService({
  anthropicOAuthEnvKeys: AUTH_PROVIDER_CATALOG.anthropic.oauthEnvKeys || ['ANTHROPIC_OAUTH_TOKEN'],
  electronResourcesPath: getElectronResourcesPath,
  ensureLocalAuthStoreLoaded: async () => await providerAuthServiceRef.current?.ensureLocalAuthStoreLoaded(),
  getLocalProviderMode: (provider) => providerAuthServiceRef.current?.getLocalProviderMode(provider),
  getLocalProviderOAuth: (provider) => providerAuthServiceRef.current?.getLocalProviderOAuth(provider),
  googleOAuthClientIdKeys: AUTH_PROVIDER_CATALOG.google.oauth?.clientIdEnvKeys || [],
  googleOAuthClientSecretKeys: AUTH_PROVIDER_CATALOG.google.oauth?.clientSecretEnvKeys || [],
  googleProjectIdKeys: AUTH_PROVIDER_CATALOG.google.oauth?.projectIdEnvKeys || [],
  localOAuthFromMainAuthProfile: (provider) => providerAuthServiceRef.current?.localOAuthFromMainAuthProfile(provider) || null,
  openClawBin: openclawBin,
  openClawStateRoot: OPENCLAW_STATE_ROOT,
  persistProviderOAuth: async (provider, oauth) => await providerAuthServiceRef.current?.persistProviderOAuth(provider, oauth),
  refreshGoogleOAuthCredential: async (oauth) => {
    const service = oauthCallbackServiceRef.current
    if (!service) throw new Error('OAuth callback service is not initialized.')
    return service.refreshGoogleOAuthCredential(oauth)
  },
  refreshAnthropicOAuthCredential: async (oauth) => {
    const service = oauthCallbackServiceRef.current
    if (!service) throw new Error('OAuth callback service is not initialized.')
    return service.refreshAnthropicOAuthCredential(oauth)
  },
  refreshOpenAICodexOAuthCredential: async (oauth) => {
    const service = oauthCallbackServiceRef.current
    if (!service) throw new Error('OAuth callback service is not initialized.')
    return service.refreshOpenAICodexOAuthCredential(oauth)
  },
  workspaceRoot: WORKSPACE_ROOT,
})
const getGoogleVertexProcessEnv = providerSetupService.getGoogleVertexProcessEnv
const googleOAuthClientConfigStatus = providerSetupService.googleOAuthClientConfigStatus
const googleVertexGcloudStatus = providerSetupService.googleVertexGcloudStatus
const isGoogleVertexConfigured = providerSetupService.isGoogleVertexConfigured
const isGoogleVertexLocalOAuthConfigured = providerSetupService.isGoogleVertexLocalOAuthConfigured
const resolveGoogleProjectId = providerSetupService.resolveGoogleProjectId
const resolveGoogleVertexRequestAuth = providerSetupService.resolveGoogleVertexRequestAuth
const resolveProviderRequestAuth = providerSetupService.resolveProviderRequestAuth
const resolveOpenAICodexOAuthForRequest = providerSetupService.resolveOpenAICodexOAuthForRequest

const providerAuthService = createProviderAuthService({
  authEnvMap: AUTH_ENV_MAP,
  authProviderCatalog: AUTH_PROVIDER_CATALOG,
  canonicalAgentModelId,
  configuredProviderApiKeyMarker,
  createInitialOpenclawConfig: () => createInitialOpenclawConfig() as ProviderAuthOpenClawConfig,
  ensureBundledProviderPluginEnabledForProviderAuth: (config, pluginId) =>
    ensureBundledProviderPluginEnabledForProviderAuth(config as OpenClawConfigFile, pluginId),
  ensureOpenRouterModelCatalogAllowlist: (config) =>
    modelCatalogService.ensureOpenRouterModelCatalogAllowlist(config as OpenClawConfigFile),
  ensureOpenRouterPluginEnabledForProviderAuth: (config) =>
    ensureOpenRouterPluginEnabledForProviderAuth(config as OpenClawConfigFile),
  googleOAuthClientConfigStatus,
  googleVertexGcloudStatus,
  homeDir: HOME_DIR,
  invalidateAvailableModelsForAuthChange,
  isGoogleVertexConfigured,
  isGoogleVertexLocalOAuthConfigured,
  isOpenAiCodexSubscriptionModel,
  isValidAgentId: (agentId) => Boolean(agentId && isValidAgentId(agentId)),
  localAuthPath: LOCAL_AUTH_PATH,
  localAuthStateKey: CONTROL_CENTER_STATE_KEYS.localAuth,
  openclawAgentFolder,
  readAgentLocalConfigIfPresent,
  readControlCenterStateRecord,
  readOpenclawConfig: async () => await readOpenclawConfig() as ProviderAuthOpenClawConfig,
  resolveGoogleProjectId,
  writeControlCenterStateRecord,
  writeOpenclawConfig,
  writePrivateJsonFileAtomically,
  writePrivateTextFileAtomically,
})
providerAuthServiceRef.current = providerAuthService
const ensureLocalAuthStoreLoaded = providerAuthService.ensureLocalAuthStoreLoaded
const getAgentAuthEnv = providerAuthService.getAgentAuthEnv
const getLocalAuthEnv = providerAuthService.getLocalAuthEnv
const getLocalProviderMode = providerAuthService.getLocalProviderMode
const isProviderConfigured = providerAuthService.isProviderConfigured
const modelAuthProblem = providerAuthService.modelAuthProblem
const persistProviderAuth = providerAuthService.persistProviderAuth
const persistProviderOAuth = providerAuthService.persistProviderOAuth
const providerAuthStatus = providerAuthService.providerAuthStatus
const removeProviderAuth = providerAuthService.removeProviderAuth
const syncStoredProviderAuthProfiles = providerAuthService.syncStoredProviderAuthProfiles
const oauthCallbackService = createOAuthCallbackService({
  authenticateGoogleAccount: (accessToken) => accountAuthService.loginWithGoogle(accessToken),
  createOpenAICodexAuthorizationFlow: providerSetupService.createOpenAICodexAuthorizationFlow,
  exchangeOpenAICodexAuthorizationCode: providerSetupService.exchangeOpenAICodexAuthorizationCode,
  anthropicOAuthRedirectUri: ANTHROPIC_OAUTH_REDIRECT_URI,
  googleOAuthRedirectUri: GOOGLE_OAUTH_REDIRECT_URI,
  googleAccountOAuthScopes: GOOGLE_ACCOUNT_OAUTH_SCOPES,
  googleOAuthScopes: GOOGLE_OAUTH_SCOPES,
  isShuttingDown: () => shuttingDown,
  // The Anthropic OAuth login/refresh implementation is supplied by the
  // bundled OpenClaw runtime; this keeps its PKCE/client-id contract versioned
  // with the same runtime that will execute the agent turn.
  loginAnthropicOAuth: providerSetupService.loginAnthropicOAuth,
  openAiCodexOAuthRedirectUri: OPENAI_CODEX_OAUTH_REDIRECT_URI,
  openAiCodexOAuthScopes: OPENAI_CODEX_OAUTH_SCOPES,
  openExternalAuthUrl,
  persistProviderOAuth,
  redactSensitiveText,
  refreshOpenAICodexToken: providerSetupService.refreshOpenAICodexToken,
  refreshAnthropicOAuthToken: providerSetupService.refreshAnthropicOAuthToken,
  resolveGoogleOAuthClientConfig: providerSetupService.resolveGoogleOAuthClientConfig,
  resolveGoogleProjectId,
})
oauthCallbackServiceRef.current = oauthCallbackService
const oauthSessions = oauthCallbackService.oauthSessions
const parseOpenAICodexAuthorizationInput = oauthCallbackService.parseOpenAICodexAuthorizationInput
const completeOpenAICodexOAuthSession = oauthCallbackService.completeOpenAICodexOAuthSession
const closeOAuthCallbackServersForProcessExit = oauthCallbackService.closeOAuthCallbackServersForProcessExit
const closeOAuthCallbackServersForShutdown = oauthCallbackService.closeOAuthCallbackServersForShutdown
const cancelOAuthSession = oauthCallbackService.cancelOAuthSession
const startGoogleOAuthSession = oauthCallbackService.startGoogleOAuthSession
const startGoogleAccountOAuthSession = oauthCallbackService.startGoogleAccountOAuthSession
const startAnthropicOAuthSession = oauthCallbackService.startAnthropicOAuthSession
const startOpenAICodexOAuthSession = oauthCallbackService.startOpenAICodexOAuthSession
const submitAnthropicOAuthManualInput = oauthCallbackService.submitAnthropicOAuthManualInput

const DEFAULT_BOOTSTRAP_AGENTS: Array<{ id: string; name: string }> = [
  { id: 'hn-architect', name: 'Elena Vasquez' },
  { id: 'hn-coordinator', name: 'Sarah Cooper' },
  { id: 'hn-crypto-lead', name: 'Marcus Chen' },
]
const DEFAULT_BOOTSTRAP_AGENT_BY_ID = new Map(DEFAULT_BOOTSTRAP_AGENTS.map((agent) => [agent.id, agent]))

async function writePrivateTextFileAtomically(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await retryTransientFileLock(
      () => fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 }),
      `write ${tempPath}`,
    )
    await fs.chmod(tempPath, 0o600).catch(() => undefined)
    await renameWithLockRetry(tempPath, filePath)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

async function writePrivateJsonFileAtomically(filePath: string, value: unknown) {
  await writePrivateTextFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseLooseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw || '{}') as unknown
  return isLooseRecord(parsed) ? parsed : {}
}

function nestedString(value: unknown, keys: string[]): string {
  let current = value
  for (const key of keys) {
    if (!isLooseRecord(current)) return ''
    current = current[key]
  }
  return typeof current === 'string' ? current.trim() : ''
}

function readJsonFileSyncLoose(filePath: string): Record<string, unknown> | null {
  try {
    return parseLooseJsonObject(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function gatewayConfigToken(config: Record<string, unknown> | null): string {
  const authToken = nestedString(config, ['gateway', 'auth', 'token'])
  if (authToken) return authToken
  const remoteToken = nestedString(config, ['gateway', 'remote', 'token'])
  return remoteToken
}

function gatewayConfigPassword(config: Record<string, unknown> | null): string {
  const authPassword = nestedString(config, ['gateway', 'auth', 'password'])
  if (authPassword) return authPassword
  const remotePassword = nestedString(config, ['gateway', 'remote', 'password'])
  return remotePassword
}

function readDotEnvValueSync(filePath: string, key: string): string {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const prefix = `${key}=`
      if (line.startsWith(prefix)) return line.slice(prefix.length).trim()
    }
  } catch {
    // Missing local env files are fine on first launch.
  }
  return ''
}

function upsertDotEnvValue(raw: string, key: string, value: string): string {
  const lines = raw ? raw.split(/\r?\n/) : []
  let found = false
  const next = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line
    found = true
    return `${key}=${value}`
  })
  if (!found) next.push(`${key}=${value}`)
  while (next.length > 0 && next[next.length - 1] === '') next.pop()
  return `${next.join('\n')}\n`
}

function writeOpenClawEnvSync(updates: Record<string, string>): boolean {
  let raw = ''
  try {
    raw = readFileSync(OPENCLAW_ENV_PATH, 'utf-8')
  } catch {
    raw = ''
  }

  let next = raw
  for (const [key, value] of Object.entries(updates)) {
    if (value) next = upsertDotEnvValue(next, key, value)
  }
  if (next === raw) return false

  mkdirSync(path.dirname(OPENCLAW_ENV_PATH), { recursive: true })
  try {
    if (existsSync(OPENCLAW_ENV_PATH)) {
      const backupPath = `${OPENCLAW_ENV_PATH}.bak-auth-autofix-${new Date().toISOString().replace(/[:.]/g, '-')}`
      writeFileSync(backupPath, raw, 'utf-8')
    }
  } catch {
    // Best-effort backup only; the env repair can still proceed.
  }
  writeFileSync(OPENCLAW_ENV_PATH, next, 'utf-8')
  return true
}

function findFallbackGatewayToken(): string {
  const configuredToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
  if (configuredToken) return configuredToken

  const localConfig = readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH)
  const localToken = gatewayConfigToken(localConfig)
  if (localToken) return localToken

  const envToken = readDotEnvValueSync(OPENCLAW_ENV_PATH, 'OPENCLAW_GATEWAY_TOKEN')
  if (envToken) return envToken

  const defaultConfigPath = path.join(HOME_DIR, '.openclaw', 'openclaw.json')
  if (path.resolve(defaultConfigPath) !== path.resolve(OPENCLAW_CONFIG_PATH)) {
    const defaultToken = gatewayConfigToken(readJsonFileSyncLoose(defaultConfigPath))
    if (defaultToken) return defaultToken
  }

  return ''
}

function findFallbackGatewayPassword(config?: Record<string, unknown> | null): string {
  const configuredPassword = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim()
  if (configuredPassword) return configuredPassword

  const localPassword = gatewayConfigPassword(config ?? readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH))
  if (localPassword) return localPassword

  const envPassword = readDotEnvValueSync(OPENCLAW_ENV_PATH, 'OPENCLAW_GATEWAY_PASSWORD')
  if (envPassword) return envPassword

  return ''
}

function repairGatewayTokenConfigSync(): { repaired: boolean; detail: string } {
  const parsedConfig = readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH)
  if (!parsedConfig && existsSync(OPENCLAW_CONFIG_PATH)) {
    return { repaired: false, detail: 'openclaw config unavailable' }
  }

  const config = parsedConfig ?? {}
  const token = findFallbackGatewayToken() || randomBytes(32).toString('hex')
  const password = findFallbackGatewayPassword(config)

  const gateway = mutableRecord(config.gateway)
  const auth = mutableRecord(gateway.auth)
  const remote = mutableRecord(gateway.remote)
  const needsAuthToken = auth.token !== token || auth.mode !== 'token'
  const needsRemoteToken = remote.token !== token
  const needsAuthPassword = password ? auth.password !== password : Object.prototype.hasOwnProperty.call(auth, 'password')
  const needsRemotePassword = password ? remote.password !== password : Object.prototype.hasOwnProperty.call(remote, 'password')
  const envChanged = writeOpenClawEnvSync({
    OPENCLAW_GATEWAY_TOKEN: token,
    ...(password ? { OPENCLAW_GATEWAY_PASSWORD: password } : {}),
  })
  process.env.OPENCLAW_GATEWAY_TOKEN = token
  if (password) process.env.OPENCLAW_GATEWAY_PASSWORD = password
  else delete process.env.OPENCLAW_GATEWAY_PASSWORD
  if (!needsAuthToken && !needsRemoteToken && !needsAuthPassword && !needsRemotePassword && !envChanged) {
    return { repaired: false, detail: 'gateway token config already aligned' }
  }

  const nextAuth: Record<string, unknown> = { ...auth, mode: 'token', token }
  const nextRemote: Record<string, unknown> = { ...remote, token }
  if (password) {
    nextAuth.password = password
    nextRemote.password = password
  } else {
    delete nextAuth.password
    delete nextRemote.password
  }

  const next = {
    ...config,
    gateway: {
      ...gateway,
      auth: nextAuth,
      remote: nextRemote,
    },
  }

  try {
    mkdirSync(path.dirname(OPENCLAW_CONFIG_PATH), { recursive: true })
    const backupPath = `${OPENCLAW_CONFIG_PATH}.bak-token-autofix-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      if (existsSync(OPENCLAW_CONFIG_PATH)) {
        const currentRaw = readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
        writeFileSync(backupPath, currentRaw, 'utf-8')
      }
    } catch {
      // Best-effort backup only; the repair itself is the important path.
    }
    writeFileSync(OPENCLAW_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
    return { repaired: true, detail: `synced gateway auth token${password ? '/password' : ''} into Control Center OpenClaw config` }
  } catch (error) {
    return { repaired: false, detail: `gateway token config repair failed: ${String(error)}` }
  }
}

function getGatewayAuthEnv(): Record<string, string> {
  repairGatewayTokenConfigSync()
  const token = findFallbackGatewayToken()
  const password = findFallbackGatewayPassword()
  return {
    ...(token ? { OPENCLAW_GATEWAY_TOKEN: token } : {}),
    ...(password ? { OPENCLAW_GATEWAY_PASSWORD: password } : {}),
  }
}

function configuredProviderApiKeyMarker(provider: string) {
  const config = readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH)
  if (!config) return ''
  return (
    nestedString(config, ['models', 'providers', provider, 'apiKey']) ||
    nestedString(config, ['plugins', 'entries', provider, 'apiKey']) ||
    nestedString(config, ['plugins', 'entries', provider, 'config', 'apiKey'])
  )
}

async function isGoogleVertexConfiguredForCronModel(modelName: string) {
  if (isGoogleVertexConfigured()) return true
  try {
    const config = await readOpenclawConfig()
    const envVars = openClawConfigEnvValues(config)
    const hasProject = GOOGLE_VERTEX_PROJECT_ID_KEYS.some((key) => typeof envVars[key] === 'string' && Boolean((envVars[key] as string).trim()))
    const hasLocation = GOOGLE_VERTEX_LOCATION_KEYS.some((key) => typeof envVars[key] === 'string' && Boolean((envVars[key] as string).trim()))
    const providerConfig = config.models?.providers?.['google-vertex']
    const hasVertexProvider = Boolean(providerConfig && typeof providerConfig === 'object')
    const hasVertexModel = Boolean(config.agents?.defaults?.models?.[`google-vertex/${modelName}`])
    return hasVertexProvider || hasVertexModel || (hasProject && hasLocation)
  } catch {
    return false
  }
}

async function missionCronModelForConfiguredAuth(modelId: string) {
  const canonical = canonicalAgentModelId(modelId)
  const { provider, model } = splitModelId(canonical)
  if (provider === 'google' && model && await isGoogleVertexConfiguredForCronModel(model)) {
    return `google-vertex/${model}`
  }
  return canonical
}

function primaryModelFromLocalConfig(config: AgentLocalConfig | null | undefined) {
  const primary = config?.model?.primary
  return typeof primary === 'string' ? primary.trim() : ''
}

async function readMissionCronLocalModelCandidates(agentId: string) {
  const candidates: string[] = []
  const paths = uniqueStrings(
    ...stateAgentLocalConfigPathCandidates(agentId),
    ...embeddedAgentLocalConfigPathCandidates(agentId),
  )
  for (const candidatePath of paths) {
    try {
      const raw = await fs.readFile(candidatePath, 'utf-8')
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as AgentLocalConfig
      const primary = primaryModelFromLocalConfig(parsed)
      if (primary) candidates.push(primary)
    } catch {
      // keep scanning local config mirrors
    }
  }
  return uniqueStrings(...candidates)
}

async function resolveMissionCronModelForAgent(agentId: string, fallbacks: string[]) {
  const candidates = uniqueStrings(...fallbacks, ...await readMissionCronLocalModelCandidates(agentId))
    .map((modelId) => canonicalAgentModelId(modelId))
    .filter(Boolean)
  const explicitVertex = candidates.find((modelId) => splitModelId(modelId).provider === 'google-vertex')
  if (explicitVertex) return explicitVertex
  for (const candidate of candidates) {
    const resolved = await missionCronModelForConfiguredAuth(candidate)
    if (resolved) return resolved
  }
  return ''
}

async function resolveMissionCronRuntimeDefaultsForAgent(agentId: string): Promise<MissionCronRuntimeDefaults> {
  const [heartbeatDefaults, configuredPrimary, localConfig, modelStack] = await Promise.all([
    resolveHeartbeatRuntimeDefaultsForAgent(agentId).catch(() => DEFAULT_HEARTBEAT_RUNTIME),
    resolveAgentPrimaryModelId(agentId).catch(() => ''),
    readAgentLocalConfigIfPresent(agentId).catch(() => null),
    resolveAgentConfiguredModelStack(agentId).catch(() => null),
  ])
  const localThinking = localConfig?.runtime?.thinkingDefault
  const localTimeout = normalizeWorkTimeoutSeconds(localConfig?.runtime?.timeoutSeconds)
  const heartbeatTimeout = normalizeWorkTimeoutSeconds(heartbeatDefaults.timeoutSeconds)
  const timeoutSeconds = Math.min(
    7200,
    Math.max(TIMED_MISSION_AGENT_TIMEOUT_SECONDS, localTimeout ?? 0, heartbeatTimeout ?? 0),
  )
  const model = await resolveMissionCronModelForAgent(agentId, [
    configuredPrimary,
    primaryModelFromLocalConfig(localConfig),
    modelStack?.primary || '',
  ])

  return {
    model,
    thinking: localThinking || heartbeatDefaults.thinking || 'medium',
    timeoutSeconds,
  }
}

type ControlCenterCronExpiryKind = 'mission' | 'shift'

type ControlCenterCronExpiryInfo = {
  cronId: string
  kind: ControlCenterCronExpiryKind
  controlCenterId: string | null
  expiresAt: string
  expiresMs: number
}

function unwrapCanonicalApiPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = payload as Record<string, unknown>
  if (record.ok === true && Object.prototype.hasOwnProperty.call(record, 'data')) return record.data
  if (record.ok === false && record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(error, 'detail')) return error.detail
  }
  return payload
}

const shiftTimers = new Map<string, NodeJS.Timeout>()
const activeShifts = new Map<string, Shift>()
const managedBatchTimers = new Map<string, NodeJS.Timeout[]>()
const missionTimers = new Map<string, NodeJS.Timeout>()
const missionLoopTimers = new Map<string, NodeJS.Timeout>()
const missionRunControllers = new Map<string, AbortController>()
const missions = new Map<string, Mission>()
const missionFeed: MissionFeedEvent[] = []
const TIMED_MISSION_AGENT_TIMEOUT_SECONDS = 900
const MISSION_CRON_EXPIRY_SWEEP_MS = 30_000
let missionCronExpirySweepTimer: NodeJS.Timeout | null = null
let missionCronExpirySweepInFlight: Promise<void> | null = null
const agentTurnSessions = new Map<string, string>()

const missionReportService = createMissionReportService({
  appendMissionReport: (report) => runtimeLedgerStore.appendMissionReport(report),
  missionFeed,
  missions,
  readMissionEvents: (limit) => runtimeLedgerStore.readMissionEvents(limit),
  readMissionRecords: (limit) => runtimeLedgerStore.readMissionRecords(limit),
  readMissionReports: (limit) => runtimeLedgerStore.readMissionReports(limit),
})
const buildMissionLifecycleProjection = missionReportService.buildMissionLifecycleProjection
const buildReconciledMissionLifecycleProjection: typeof buildMissionLifecycleProjection = async (projectionOptions) => {
  await missionSchedulerService.reconcileRecurringMissionCronRuntime(listMissionCronRuntimeSnapshotsFromStateDb())
  return buildMissionLifecycleProjection(projectionOptions)
}
const listMissionReports = missionReportService.listMissionReports
const recordMissionReport = missionReportService.recordMissionReport
const missionTeamSyncService = createMissionTeamSyncService({
  canonicalDoctrineOnly: CANONICAL_DOCTRINE_ONLY,
  canonicalDoctrineRoot,
  defaultAgentWorkspace,
  fileExists,
  resolveAgentWorkspace,
  resolveAgentWorkspaces,
  resolveDoctrineWorkspaceForRun,
  resolveSharedTeamSyncPath,
  trimTask,
  workspaceRoot: WORKSPACE_ROOT,
})
const ensureTeamSyncFile = missionTeamSyncService.ensureTeamSyncFile
const writeTeamSyncSnapshot = missionTeamSyncService.writeTeamSyncSnapshot

const missionStateService = createMissionStateService({
  appendMissionEvent: (event) => runtimeLedgerStore.appendMissionEvent(event),
  appendMissionRecord: (record) => runtimeLedgerStore.appendMissionRecord(record),
  cleanupMissionCronJobs: (mission) => missionSchedulerService.cleanupMissionCronJobs(mission),
  clearMissionController: (missionId) => missionSchedulerService.clearMissionController(missionId),
  completeCronMission: (mission, status, note, assignments, activity) =>
    missionSchedulerService.completeCronMission(mission, status, note, assignments, activity),
  controlCenterMissionSchedulerDryRun: CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN,
  missionCronCleanupFailureSummary: (error) => missionSchedulerService.missionCronCleanupFailureSummary(error),
  missionCronJobNeedsRecovery: (job) => missionSchedulerService.missionCronJobNeedsRecovery(job),
  launchRecurringMissionImmediately: (mission, assignments, activity) =>
    missionSchedulerService.launchRecurringMissionImmediately(mission, assignments, activity),
  missionFeed,
  missions,
  missionTimers,
  redactSensitiveText,
  recordMissionReport,
  scheduleNextMissionRound: (mission, assignments, activity, delayMs) =>
    missionSchedulerService.scheduleNextMissionRound(mission, assignments, activity, delayMs),
  startRecurringMissionCronJobs: (mission, assignments, activity) =>
    missionSchedulerService.startRecurringMissionCronJobs(mission, assignments, activity),
  writeTeamSyncSnapshot,
})

const listMissions = missionStateService.listMissions
const missionView = missionStateService.missionView
const persistMissionRecord = missionStateService.persistMissionRecord
const pushMissionEvent = missionStateService.pushMissionEvent
const transitionMissionState = missionStateService.transitionMissionState

const missionSchedulerService: MissionSchedulerService = createMissionSchedulerService({
  appendAgentDailyMemory,
  clearDisallowedAutoModelOverridesForAgent,
  clearShiftRuntimeStateForCronId,
  composeAgentDoctrinePrompt,
  ensureGatewayReadyForCronMission,
  ensureTeamSyncFile,
  extractAgentReply,
  getAgentAuthEnv,
  missionAgentTimeoutSeconds: TIMED_MISSION_AGENT_TIMEOUT_SECONDS,
  missionLoopTimers,
  missionRunControllers,
  missionTimers,
  missions,
  openClawAgentsRoot: OPENCLAW_AGENTS_ROOT,
  openClawErrorResult,
  persistMissionRecord,
  port: PORT,
  pushMissionEvent,
  recordMissionReport,
  redactSensitiveText,
  resolveAgentRunContext,
  resolveMissionCronRuntimeDefaultsForAgent,
  resolveSharedTeamSyncPath,
  runCwdForContext,
  runOpenClaw,
  setActiveShift: (id, shift) => activeShifts.set(id, shift as Shift),
  stripAnsi,
  transitionMissionState,
  trimTask,
  writeTeamSyncSnapshot,
})

function agentTurnSessionScope(agentId: string, sessionKey?: string | null) {
  const cleanSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : ''
  return cleanSessionKey ? `${agentId}:${cleanSessionKey}` : agentId
}

function agentTurnSessionScopeAgentId(scope: string) {
  return scope.split(':', 1)[0] || scope
}

function agentTurnSessionScopeMatchesAgent(scope: string, agentId?: string) {
  return !agentId || scope === agentId || scope.startsWith(`${agentId}:`)
}

type OpenClawRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'aborted' | 'interrupted'

type OpenClawRunRecord = {
  id: string
  command: string
  agentId?: string
  sessionId?: string
  sessionKey?: string
  cwd: string
  timeoutMs: number
  startedAt: string
  endedAt?: string
  elapsedMs?: number
  status: OpenClawRunStatus
  pid?: number
  exitCode?: number
  stdoutPreview?: string
  stderrPreview?: string
  failureKind?: FailureKind
}

const OPENCLAW_RECENT_RUN_LIMIT = 80
const activeOpenClawRuns = new Map<string, OpenClawRunRecord>()
const recentOpenClawRuns: OpenClawRunRecord[] = []

const missionRecoveryService = createMissionRecoveryService({
  clearMissionController: (missionId) => missionSchedulerService.clearMissionController(missionId),
  clearShiftRuntimeStateForCronId,
  controlCenterStartedAtMs: CONTROL_CENTER_STARTED_AT_MS,
  ensureGatewayClient: ensureControlCenterGatewayClient,
  getRuntimeRunStatus: (id) => {
    const cleanId = typeof id === 'string' ? id.trim() : ''
    if (!cleanId) return 'unknown'
    return activeOpenClawRuns.get(cleanId)?.status || recentOpenClawRuns.find((run) => run.id === cleanId)?.status || 'unknown'
  },
  listMissionCronReconciliationSnapshot: listMissionCronReconciliationSnapshotFromStateDb,
  missionCronJobNeedsRecovery: (job) => missionSchedulerService.missionCronJobNeedsRecovery(job),
  missions,
  persistMissionRecord,
  pushGatewayLog,
  pushMissionEvent,
  readMissionRecords: (limit) => runtimeLedgerStore.readMissionRecords(limit),
  recordMissionReport,
  redactSensitiveText,
  rehydrateRecurringMissionShifts: (mission, cronState) => missionSchedulerService.rehydrateRecurringMissionShifts(mission, cronState),
  armRehydratedMissionTimer: (mission, assignments, activity) =>
    missionSchedulerService.armRehydratedMissionTimer(mission, assignments, activity),
  transitionMissionState,
  trimTask,
})
const hydrateMissionRecordsFromLedger = missionRecoveryService.hydrateMissionRecordsFromLedger

function openClawRunLedgerPayload(record: OpenClawRunRecord) {
  return {
    ...record,
    stdoutPreview: record.stdoutPreview || '',
    stderrPreview: record.stderrPreview || '',
  }
}

async function persistOpenClawRunLedgerSnapshot(record: OpenClawRunRecord) {
  await runtimeLedgerStore.appendRuntimeRun(openClawRunLedgerPayload(record), { mirrorJsonl: false })
}

function persistOpenClawRunLedgerSnapshotSoon(record: OpenClawRunRecord) {
  setTimeout(() => {
    void persistOpenClawRunLedgerSnapshot(record).catch(() => undefined)
  }, 0).unref?.()
}

function interruptedOpenClawRunFromLedger(record: OpenClawRunRecord): OpenClawRunRecord | null {
  if (record.status !== 'running') return null
  if (activeOpenClawRuns.has(record.id)) return null
  const startedMs = Date.parse(record.startedAt)
  if (!Number.isFinite(startedMs)) return null
  if (startedMs >= CONTROL_CENTER_STARTED_AT_MS - 1000) return null
  if (!isRuntimeMonitorEntryVisible(record.startedAt)) return null
  const elapsedMs = Math.max(0, CONTROL_CENTER_STARTED_AT_MS - startedMs)
  const timeoutMs = Number.isFinite(record.timeoutMs) && record.timeoutMs > 0 ? record.timeoutMs : 0
  const timedOut = timeoutMs > 0 && elapsedMs >= timeoutMs
  return {
    ...record,
    status: timedOut ? 'timeout' : 'interrupted',
    endedAt: new Date(CONTROL_CENTER_STARTED_AT_MS).toISOString(),
    elapsedMs,
    exitCode: 1,
    failureKind: timedOut ? 'timeout' : 'interrupted',
    stderrPreview: timedOut
      ? 'Control Center restarted after this runtime call exceeded its wrapper timeout.'
      : 'Control Center restarted before this runtime call emitted a terminal event.',
  }
}

async function readRuntimeMonitorClearedAtMs() {
  const markerFromValue = (value: unknown) => {
    if (!isLooseRecord(value)) return 0
    const parsed = value as { clearedAt?: unknown; clearedAtMs?: unknown }
    const fromIso = typeof parsed.clearedAt === 'string' ? Date.parse(parsed.clearedAt) : NaN
    const fromMs = typeof parsed.clearedAtMs === 'number' ? parsed.clearedAtMs : NaN
    const resolved = Number.isFinite(fromIso) ? fromIso : fromMs
    return Number.isFinite(resolved) && resolved > 0 ? resolved : 0
  }
  const sqliteMarker = readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.runtimeMonitorClear)
  const sqliteValue = markerFromValue(sqliteMarker)
  if (sqliteValue > 0) return sqliteValue

  const legacyMarker = await readLegacyJsonState(RUNTIME_MONITOR_CLEAR_MARKER_PATH, (value) => {
    const markerValue = markerFromValue(value)
    return markerValue > 0 ? value : null
  })
  const legacyValue = markerFromValue(legacyMarker)
  if (legacyValue > 0) {
    writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.runtimeMonitorClear, legacyMarker, RUNTIME_MONITOR_CLEAR_MARKER_PATH)
  }
  return legacyValue
}

async function writeRuntimeMonitorClearMarker(clearedAt: Date) {
  const payload = {
    clearedAt: clearedAt.toISOString(),
    clearedAtMs: clearedAt.getTime(),
  }
  if (writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.runtimeMonitorClear, payload, RUNTIME_MONITOR_CLEAR_MARKER_PATH)) return
  await fs.mkdir(path.dirname(RUNTIME_MONITOR_CLEAR_MARKER_PATH), { recursive: true })
  await fs.writeFile(RUNTIME_MONITOR_CLEAR_MARKER_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

async function hydrateRecentOpenClawRunsFromLedger() {
  runtimeMonitorClearedAtMs = Math.max(runtimeMonitorClearedAtMs, await readRuntimeMonitorClearedAtMs())
  const records = await runtimeLedgerStore.readRuntimeRuns<OpenClawRunRecord>(OPENCLAW_RECENT_RUN_LIMIT * 3)
  if (!records.length) return
  recentOpenClawRuns.length = 0
  const recovered: OpenClawRunRecord[] = []
  const seenIds = new Set<string>()
  for (const record of [...records].reverse()) {
    if (!record?.id || seenIds.has(record.id)) continue
    seenIds.add(record.id)
    if (record.status === 'running') {
      const interrupted = interruptedOpenClawRunFromLedger(record)
      if (!interrupted) continue
      recentOpenClawRuns.push(interrupted)
      recovered.push(interrupted)
      continue
    }
    if (!isRuntimeMonitorEntryVisible(record.endedAt || record.startedAt)) continue
    recentOpenClawRuns.push(record)
  }
  if (recentOpenClawRuns.length > OPENCLAW_RECENT_RUN_LIMIT) recentOpenClawRuns.length = OPENCLAW_RECENT_RUN_LIMIT
  if (recovered.length) {
    await Promise.allSettled(recovered.slice(0, OPENCLAW_RECENT_RUN_LIMIT).map((record) => persistOpenClawRunLedgerSnapshot(record)))
    pushGatewayLog('lifecycle', `recovered ${recovered.length} interrupted runtime run(s) from the ledger after restart`)
  }
}

type ProviderConversationRole = 'user' | 'assistant'
type ProviderConversationMessage = {
  role: ProviderConversationRole
  content: string
  reasoningContent?: string
}

type ProviderConversationState = {
  sessionId: string
  provider: string
  modelId: string
  messages: ProviderConversationMessage[]
  updatedAt: number
}

const providerConversationHistories = new Map<string, ProviderConversationState>()
// Direct-provider calls use this same bounded working set as the Gateway
// path. Keeping a provider-specific exception here would let Luna (or any
// future provider) replay a large transcript outside the shared policy.
const MAX_PROVIDER_CONVERSATION_MESSAGES = 8
const MAX_PROVIDER_CONVERSATION_CHARS = 32_000
const MAX_PROVIDER_CONVERSATION_SESSIONS = 128
const PROVIDER_CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000

function providerConversationChars(messages: ProviderConversationMessage[]) {
  return messages.reduce((total, message) => total + message.content.length + (message.reasoningContent?.length || 0), 0)
}

function trimProviderConversationMessages(
  messages: ProviderConversationMessage[],
  limits: { maxMessages?: number; maxChars?: number } = {},
) {
  const maxMessages = limits.maxMessages || MAX_PROVIDER_CONVERSATION_MESSAGES
  const maxChars = limits.maxChars || MAX_PROVIDER_CONVERSATION_CHARS
  let next = messages.filter((message) => message.content.trim() || message.reasoningContent?.trim())
  if (next.length > maxMessages) next = next.slice(-maxMessages)
  while (next.length > 2 && providerConversationChars(next) > maxChars) {
    next = next.slice(2)
  }
  return next
}

function providerConversationLimits() {
  return { maxMessages: MAX_PROVIDER_CONVERSATION_MESSAGES, maxChars: MAX_PROVIDER_CONVERSATION_CHARS }
}

function pruneProviderConversationHistories() {
  const cutoff = Date.now() - PROVIDER_CONVERSATION_TTL_MS
  for (const [sessionId, history] of providerConversationHistories) {
    if (history.updatedAt < cutoff) providerConversationHistories.delete(sessionId)
  }
  if (providerConversationHistories.size <= MAX_PROVIDER_CONVERSATION_SESSIONS) return
  const oldest = Array.from(providerConversationHistories.values())
    .sort((left, right) => left.updatedAt - right.updatedAt)
  for (const history of oldest.slice(0, providerConversationHistories.size - MAX_PROVIDER_CONVERSATION_SESSIONS)) {
    providerConversationHistories.delete(history.sessionId)
  }
}

function providerConversationMessagesForRequest(
  sessionId: string,
  provider: string,
  modelId: string,
  userContent: string,
) {
  pruneProviderConversationHistories()
  const existing = providerConversationHistories.get(sessionId)
  if (
    existing &&
    (existing.provider.trim().toLowerCase() !== provider.trim().toLowerCase() ||
      modelRefKeyFromId(existing.modelId) !== modelRefKeyFromId(modelId))
  ) {
    providerConversationHistories.delete(sessionId)
  }
  const history = providerConversationHistories.get(sessionId)?.messages || []
  return trimProviderConversationMessages([...history, { role: 'user', content: userContent }], providerConversationLimits())
}

function saveProviderConversationTurn(
  sessionId: string,
  provider: string,
  modelId: string,
  requestMessages: ProviderConversationMessage[],
  assistant: { content: string; reasoningContent?: string },
) {
  pruneProviderConversationHistories()
  const limits = providerConversationLimits()
  providerConversationHistories.set(sessionId, {
    sessionId,
    provider,
    modelId,
    messages: trimProviderConversationMessages([
      ...requestMessages,
      {
        role: 'assistant',
        content: assistant.content,
        reasoningContent: assistant.reasoningContent,
      },
    ], limits),
    updatedAt: Date.now(),
  })
}

function clearAgentTurnSessions(agentId?: string) {
  if (agentId) {
    let sessions = 0
    let histories = 0
    for (const [scope, sessionId] of Array.from(agentTurnSessions.entries())) {
      if (!agentTurnSessionScopeMatchesAgent(scope, agentId)) continue
      agentTurnSessions.delete(scope)
      sessions += 1
      if (providerConversationHistories.delete(sessionId)) histories += 1
    }
    return { sessions, histories }
  }
  const sessions = agentTurnSessions.size
  const histories = providerConversationHistories.size
  agentTurnSessions.clear()
  providerConversationHistories.clear()
  return { sessions, histories }
}

function resetAgentTurnSessionsForAgentContextChange(agentId: string, reason: string) {
  const reset = clearAgentTurnSessions(agentId)
  if (reset.sessions || reset.histories) {
    pushGatewayLog(
      'lifecycle',
      `${reason} for ${agentId}; reset ${reset.sessions} active session(s) and ${reset.histories} provider history cache(s)`,
    )
  }
  return reset
}

function resetAgentTurnSessionsForModelChange(agentId: string) {
  return resetAgentTurnSessionsForAgentContextChange(agentId, 'model config changed')
}

function abortGatewayChatOpenClawRun(run: OpenClawRunRecord, reason = 'runtime session close') {
  if (!run.sessionKey) return false
  if (!gatewayChatService.requestAbortIfClient(run.sessionKey, run.id, reason)) return false
  finishOpenClawRun(run, 'aborted', { code: 1, failureKind: 'aborted', stderr: reason })
  return true
}

async function abortOpenClawRunById(runId: string, reason = 'operator stop requested') {
  const cleanRunId = runId.trim()
  const run = activeOpenClawRuns.get(cleanRunId)
  if (!cleanRunId || !run) {
    return { found: false, runId: cleanRunId, stopped: false, detail: 'Active runtime run was not found.' }
  }

  // Gateway chat waiters are the authoritative cancellation boundary for
  // chat.send runs. This works even while the Gateway websocket is restarting:
  // the waiter is closed locally, the in-flight chat.abort is best effort, and
  // runTurn finalizes the same run record as aborted.
  if (run.sessionKey && gatewayChatService.abortRun(run.id, reason)) {
    finishOpenClawRun(run, 'aborted', { code: 1, failureKind: 'aborted', stderr: reason })
    pushGatewayLog('lifecycle', `operator stopped Gateway chat run ${run.id}`)
    return { found: true, runId: run.id, stopped: true, method: 'gateway-chat', detail: 'Gateway chat abort requested.' }
  }

  if (run.pid) {
    const result = await terminateProcessTree(run.pid, reason, true)
    if (activeOpenClawRuns.has(run.id)) {
      finishOpenClawRun(run, 'aborted', { code: 1, failureKind: 'aborted', stderr: reason })
    }
    return { found: true, runId: run.id, stopped: result.ok, method: 'process-tree', detail: result.detail }
  }

  // A run can be between its terminal Gateway event and the final response
  // projection. Close that server-owned record rather than leaving a phantom
  // spinner that has no child process or Gateway waiter left to cancel.
  finishOpenClawRun(run, 'aborted', { code: 1, failureKind: 'aborted', stderr: reason })
  return { found: true, runId: run.id, stopped: true, method: 'record-close', detail: 'Active runtime record closed.' }
}

function normalizeGatewaySessionKey(value: string | null | undefined, agentId?: string) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (raw.startsWith('agent:')) return raw
  return agentId ? `agent:${agentId}:${raw}` : raw
}

function runtimeSessionKeyFromScope(scope: string, agentId: string) {
  if (!scope.startsWith(`${agentId}:`)) return ''
  return normalizeGatewaySessionKey(scope.slice(agentId.length + 1), agentId)
}

type GatewayRuntimeSessionAbortResult = {
  sessionKey: string
  runId?: string
  agentId?: string
  sessionId?: string
  ok: boolean
  method: 'sessions.abort' | 'chat.abort' | 'gateway-client'
  detail?: string
}

type RuntimeSessionCloseInput = {
  agentId?: string
  sessionId?: string
  sessionKey?: string
  all?: boolean
}

function runtimeCloseMatchesRun(input: RuntimeSessionCloseInput, run: OpenClawRunRecord) {
  if (input.all) return true
  const targetSessionKey = normalizeGatewaySessionKey(input.sessionKey, input.agentId || run.agentId)
  if (targetSessionKey && run.sessionKey !== targetSessionKey) return false
  if (input.agentId && run.agentId !== input.agentId) return false
  if (input.sessionId && run.sessionId !== input.sessionId) return false
  return true
}

function runtimeCloseMatchesSession(input: RuntimeSessionCloseInput, scope: string, sessionId: string) {
  if (input.all) return true
  const agentId = agentTurnSessionScopeAgentId(scope)
  const scopedSessionKey = runtimeSessionKeyFromScope(scope, agentId)
  const targetSessionKey = normalizeGatewaySessionKey(input.sessionKey, input.agentId || agentId)
  if (targetSessionKey && scopedSessionKey && scopedSessionKey !== targetSessionKey) return false
  if (targetSessionKey && !scopedSessionKey && !input.agentId && !input.sessionId) return false
  if (input.agentId && !agentTurnSessionScopeMatchesAgent(scope, input.agentId)) return false
  if (input.sessionId && sessionId !== input.sessionId) return false
  return true
}

function gatewayAbortCandidatesForRuntimeClose(input: RuntimeSessionCloseInput) {
  const candidates = new Map<string, { sessionKey: string; runId?: string; agentId?: string; sessionId?: string }>()
  const add = (candidate: { sessionKey?: string; runId?: string; agentId?: string; sessionId?: string }) => {
    const sessionKey = normalizeGatewaySessionKey(candidate.sessionKey, candidate.agentId || input.agentId)
    if (!sessionKey) return
    const key = `${sessionKey}\0${candidate.runId || ''}`
    candidates.set(key, { ...candidate, sessionKey })
  }

  add({ sessionKey: input.sessionKey, agentId: input.agentId, sessionId: input.sessionId })
  for (const run of activeOpenClawRuns.values()) {
    if (!runtimeCloseMatchesRun(input, run)) continue
    add({ sessionKey: run.sessionKey, runId: run.id, agentId: run.agentId, sessionId: run.sessionId })
  }
  for (const [scope, sessionId] of agentTurnSessions.entries()) {
    if (!runtimeCloseMatchesSession(input, scope, sessionId)) continue
    const agentId = agentTurnSessionScopeAgentId(scope)
    add({ sessionKey: runtimeSessionKeyFromScope(scope, agentId), agentId, sessionId })
  }
  return Array.from(candidates.values()).slice(0, 25)
}

async function requestGatewaySessionAbort(candidate: { sessionKey: string; runId?: string; agentId?: string; sessionId?: string }): Promise<GatewayRuntimeSessionAbortResult> {
  let state: Awaited<ReturnType<typeof ensureControlCenterGatewayClient>>
  try {
    state = await ensureControlCenterGatewayClient(AbortSignal.timeout(5_000))
  } catch (error) {
    return {
      ...candidate,
      ok: false,
      method: 'gateway-client',
      detail: redactSensitiveText(String(error)),
    }
  }

  const params = {
    key: candidate.sessionKey,
    ...(candidate.runId ? { runId: candidate.runId } : {}),
  }
  try {
    const payload = await state.client.request('sessions.abort', params, { timeoutMs: 3_000 })
    if (!isLooseRecord(payload) || payload.ok !== false) {
      return {
        ...candidate,
        ok: true,
        method: 'sessions.abort',
        detail: isLooseRecord(payload) && typeof payload.status === 'string' ? payload.status : undefined,
      }
    }
    throw new Error(typeof payload.error === 'string' ? payload.error : 'sessions.abort returned ok=false')
  } catch (sessionsAbortError) {
    try {
      const payload = await state.client.request('chat.abort', {
        sessionKey: candidate.sessionKey,
        ...(candidate.runId ? { runId: candidate.runId } : {}),
      }, { timeoutMs: 3_000 })
      return {
        ...candidate,
        ok: !isLooseRecord(payload) || payload.ok !== false,
        method: 'chat.abort',
        detail: isLooseRecord(payload) && typeof payload.status === 'string'
          ? payload.status
          : redactSensitiveText(String(sessionsAbortError)),
      }
    } catch (chatAbortError) {
      return {
        ...candidate,
        ok: false,
        method: 'chat.abort',
        detail: redactSensitiveText(String(chatAbortError)),
      }
    }
  }
}

async function abortGatewayRuntimeSessionsForClose(input: RuntimeSessionCloseInput) {
  const candidates = gatewayAbortCandidatesForRuntimeClose(input)
  const results: GatewayRuntimeSessionAbortResult[] = []
  for (const candidate of candidates) {
    results.push(await requestGatewaySessionAbort(candidate))
  }
  const okCount = results.filter((result) => result.ok).length
  if (results.length) {
    pushGatewayLog(
      okCount === results.length ? 'lifecycle' : 'stderr',
      `gateway abort requested for ${okCount}/${results.length} runtime session(s)`,
    )
  }
  return results
}

function terminateOpenClawRunsForSession(input: RuntimeSessionCloseInput) {
  const terminated: Array<{ id: string; pid: number | null; agentId?: string; sessionId?: string }> = []
  for (const run of Array.from(activeOpenClawRuns.values())) {
    if (!runtimeCloseMatchesRun(input, run)) continue
    if (!run.pid) {
      if (abortGatewayChatOpenClawRun(run)) {
        pushGatewayLog('lifecycle', `abort requested for gateway chat runtime call ${run.id}`)
        terminated.push({ id: run.id, pid: null, agentId: run.agentId, sessionId: run.sessionId })
      }
      continue
    }
    try {
      void terminateProcessTree(run.pid, 'runtime session close')
      pushGatewayLog('lifecycle', `close requested for runtime call ${run.id} (pid=${run.pid})`)
      terminated.push({ id: run.id, pid: run.pid, agentId: run.agentId, sessionId: run.sessionId })
    } catch (error) {
      pushGatewayLog('lifecycle', `failed to terminate runtime call ${run.id}: ${String(error)}`)
      terminated.push({ id: run.id, pid: run.pid, agentId: run.agentId, sessionId: run.sessionId })
    }
  }
  return terminated
}

function closeRuntimeSessions(input: RuntimeSessionCloseInput) {
  const closed: Array<{ agentId: string; sessionId: string; scope: string }> = []
  let histories = 0
  for (const [scope, sessionId] of Array.from(agentTurnSessions.entries())) {
    if (!runtimeCloseMatchesSession(input, scope, sessionId)) continue
    agentTurnSessions.delete(scope)
    if (providerConversationHistories.delete(sessionId)) histories += 1
    closed.push({ agentId: agentTurnSessionScopeAgentId(scope), sessionId, scope })
  }

  if (input.sessionId && providerConversationHistories.delete(input.sessionId)) histories += 1
  const terminatedRuns = terminateOpenClawRunsForSession(input)
  if (closed.length || terminatedRuns.length) {
    pushGatewayLog('lifecycle', `closed ${closed.length} runtime session(s); terminated ${terminatedRuns.length} active call(s)`)
  }
  return {
    closedSessions: closed.length,
    clearedHistories: histories,
    closed,
    terminatedRuns,
  }
}

async function terminateAllOpenClawRunsNow(reason = 'control center shutdown') {
  const runs = Array.from(activeOpenClawRuns.values())
  const results: Array<{ id: string; pid: number | null; agentId?: string; sessionId?: string; ok: boolean; detail: string }> = []
  for (const run of runs) {
    const pid = run.pid || null
    if (!pid) {
      const aborted = abortGatewayChatOpenClawRun(run, reason)
      results.push({
        id: run.id,
        pid,
        agentId: run.agentId,
        sessionId: run.sessionId,
        ok: aborted,
        detail: aborted ? 'gateway chat abort requested' : 'no child process or gateway chat client to terminate',
      })
      continue
    }
    const result = await terminateProcessTree(pid || undefined, reason, true)
    if (activeOpenClawRuns.has(run.id)) {
      finishOpenClawRun(run, 'aborted', { code: 1, failureKind: 'aborted', stderr: reason })
    }
    results.push({ id: run.id, pid, agentId: run.agentId, sessionId: run.sessionId, ok: result.ok, detail: result.detail })
  }
  return results
}

function terminateAllOpenClawRuns(reason = 'control center shutdown') {
  void terminateAllOpenClawRunsNow(reason)
}

function sanitizeOpenClawArgsForDisplay(args: string[]) {
  const redactedValueFlags = new Set([
    '--message',
    '--api-key',
    '--auth-token',
    '--token',
    '--password',
    '--secret',
  ])
  const redactedInlineFlags = [/token=/i, /api[-_]?key=/i, /password=/i, /secret=/i]
  const safe: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (redactedValueFlags.has(arg)) {
      safe.push(arg, '[redacted]')
      index += 1
      continue
    }
    safe.push(redactedInlineFlags.some((pattern) => pattern.test(arg)) ? '[redacted]' : arg)
  }
  return safe
}

function openClawRunLabel(args: string[]) {
  return `openclaw ${sanitizeOpenClawArgsForDisplay(args).join(' ')}`.trim()
}

function previewRuntimeOutput(text: string, max = 260) {
  const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function runtimeFailureSummary(text: string, status?: OpenClawRunStatus) {
  const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim()
  const cronError = summarizeCronProcessedError(clean)
  if (cronError) return cronError.message
  if (/^incomplete turn detected:\s+runId=/iu.test(clean)) {
    return 'The model turn ended without a final assistant reply.'
  }
  if (/(?:\[clawtalk\]\s+)?CoreBridge:\s+Control Center stream unavailable,\s+falling back to embedded agent:/iu.test(clean)) {
    return 'ClawTalk continued through the embedded agent after the live stream closed.'
  }
  if (/tool policy removed \d+ tool\(s\) via tools\.profile/iu.test(clean)) {
    return 'Runtime tool policy was applied.'
  }
  if (/powershell|\.ps1\b/iu.test(clean) && /\bfailed\b/iu.test(clean)) {
    return 'A PowerShell script exited with an error.'
  }
  if (status === 'aborted' || /\b(?:operation was aborted|openclaw aborted|gateway chat run aborted)\b/iu.test(clean)) {
    return 'The runtime request was cancelled before a final reply arrived.'
  }
  if (status === 'interrupted' || /\b(?:control center restarted|observer interrupted|runtime observer lost)\b/iu.test(clean)) {
    return 'The runtime observer restarted before a final reply arrived.'
  }
  if (status === 'timeout' || /\b(?:timed out|timeout)\b/iu.test(clean)) {
    return 'The runtime request exceeded its timeout before a final reply arrived.'
  }
  return ''
}

function previewUserRuntimeOutput(text: string, status?: OpenClawRunStatus, max = 260) {
  const visible = sanitizeUserVisibleRuntimeText(redactSensitiveText(text || ''))
  return previewRuntimeOutput(visible || runtimeFailureSummary(text, status) || redactSensitiveText(text || ''), max)
}

function beginOpenClawRun(args: string[], cwd: string, timeoutMs: number): OpenClawRunRecord {
  const now = new Date().toISOString()
  const record: OpenClawRunRecord = {
    id: randomUUID(),
    command: openClawRunLabel(args),
    agentId: args[0] === 'agent' ? argValue(args, '--agent') || undefined : undefined,
    sessionId: args[0] === 'agent' ? argValue(args, '--session-id') || undefined : undefined,
    cwd,
    timeoutMs,
    startedAt: now,
    status: 'running',
  }
  activeOpenClawRuns.set(record.id, record)
  persistOpenClawRunLedgerSnapshotSoon(record)
  invalidateRuntimeStatusCache()
  if (record.agentId) {
    pushGatewayLog(
      'lifecycle',
      `OpenClaw runtime started: ${record.agentId}${record.sessionId ? ` session=${record.sessionId.slice(0, 8)}` : ''} timeout=${Math.round(timeoutMs / 1000)}s`,
    )
  }
  return record
}

function beginGatewayChatOpenClawRun(params: {
  runId: string
  agentId: string
  sessionId: string
  sessionKey: string
  cwd: string
  timeoutMs: number
}) {
  const record: OpenClawRunRecord = {
    id: params.runId,
    command: `gateway chat.send --agent ${params.agentId} --session-key ${params.sessionKey}`,
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
  activeOpenClawRuns.set(record.id, record)
  persistOpenClawRunLedgerSnapshotSoon(record)
  invalidateRuntimeStatusCache()
  pushGatewayLog(
    'lifecycle',
    `OpenClaw gateway chat started: ${record.agentId} session=${record.sessionId?.slice(0, 8) || 'unknown'} timeout=${Math.round(record.timeoutMs / 1000)}s`,
  )
  return record
}

function updateOpenClawRunPid(record: OpenClawRunRecord, pid?: number) {
  if (!pid) return
  const current = activeOpenClawRuns.get(record.id)
  if (current) {
    current.pid = pid
    persistOpenClawRunLedgerSnapshotSoon(current)
    return
  }
  record.pid = pid
  persistOpenClawRunLedgerSnapshotSoon(record)
}

function finishOpenClawRun(
  record: OpenClawRunRecord,
  status: OpenClawRunStatus,
  output: { stdout?: string; stderr?: string; code?: number; failureKind?: FailureKind } = {},
) {
  const current = activeOpenClawRuns.get(record.id)
  if (!current && recentOpenClawRuns.some((run) => run.id === record.id && run.status !== 'running')) return
  const active = current || record
  const endedAt = new Date().toISOString()
  const startedMs = new Date(active.startedAt).getTime()
  const failureKind = output.failureKind || (status === 'completed' ? undefined : classifyFailureKind(`${output.stderr || ''}\n${output.stdout || ''}`, status) || 'unknown')
  const finished: OpenClawRunRecord = {
    ...active,
    status,
    endedAt,
    elapsedMs: Number.isFinite(startedMs) ? Date.now() - startedMs : undefined,
    ...(typeof output.code === 'number' ? { exitCode: output.code } : {}),
    ...(output.stdout ? { stdoutPreview: previewUserRuntimeOutput(output.stdout, status) } : {}),
    ...(output.stderr ? { stderrPreview: previewUserRuntimeOutput(output.stderr, status) } : {}),
    ...(failureKind ? { failureKind } : {}),
  }
  activeOpenClawRuns.delete(record.id)
  recentOpenClawRuns.unshift(finished)
  invalidateRuntimeStatusCache()
  if (recentOpenClawRuns.length > OPENCLAW_RECENT_RUN_LIMIT) recentOpenClawRuns.length = OPENCLAW_RECENT_RUN_LIMIT
  if (finished.agentId) {
    pushGatewayLog(
      'lifecycle',
      `OpenClaw runtime ${status}: ${finished.agentId}${finished.sessionId ? ` session=${finished.sessionId.slice(0, 8)}` : ''} elapsed=${Math.round((finished.elapsedMs || 0) / 1000)}s${failureKind ? ` failure=${failureKind}` : ''}`,
    )
  }
  persistOpenClawRunLedgerSnapshotSoon(finished)
}

function openClawRunSnapshot(record: OpenClawRunRecord): OpenClawRunRecord {
  if (record.status !== 'running') return { ...record }
  const startedMs = new Date(record.startedAt).getTime()
  return {
    ...record,
    elapsedMs: Number.isFinite(startedMs) ? Date.now() - startedMs : undefined,
  }
}

type AgentSessionStoreEntry = Record<string, unknown>
type AgentSessionStore = Record<string, AgentSessionStoreEntry>
type ModelOverrideCleanupResult = {
  changed: boolean
  cleared: Array<{ sessionKey: string; model: string; reason: string }>
}

function sessionStringField(entry: AgentSessionStoreEntry, key: string) {
  const value = entry[key]
  return typeof value === 'string' ? value.trim() : ''
}

function modelRefKeyFromId(modelId: string) {
  const trimmed = modelId.trim()
  if (!trimmed) return ''
  const { provider, model } = splitModelId(trimmed)
  return provider && model ? `${provider}/${model}`.toLowerCase() : trimmed.toLowerCase()
}

function modelRefKeyFromParts(provider: string, model: string) {
  const modelText = model.trim()
  if (!modelText) return ''
  if (modelText.includes('/')) return modelRefKeyFromId(modelText)
  const providerText = provider.trim()
  return providerText ? `${providerText}/${modelText}`.toLowerCase() : modelText.toLowerCase()
}

function addConfiguredModelKey(keys: Set<string>, modelId?: string) {
  const raw = modelId?.trim()
  if (!raw) return
  const fullKey = modelRefKeyFromId(raw)
  if (fullKey) keys.add(fullKey)
  const { model } = splitModelId(raw)
  if (model) keys.add(model.toLowerCase())
}

function configuredModelKeys(model: { primary?: string; fallbacks?: string[] }) {
  const keys = new Set<string>()
  addConfiguredModelKey(keys, model.primary)
  for (const fallback of model.fallbacks || []) addConfiguredModelKey(keys, fallback)
  return keys
}

function addConfiguredModelProvider(providers: Set<string>, modelId?: string) {
  const raw = modelId?.trim()
  if (!raw) return
  const { provider } = splitModelId(raw)
  if (!provider) return
  providers.add(provider.toLowerCase())
}

function configuredAuthProfilePrefixes(model: { primary?: string; fallbacks?: string[] }) {
  const providers = new Set<string>()
  addConfiguredModelProvider(providers, model.primary)
  for (const fallback of model.fallbacks || []) addConfiguredModelProvider(providers, fallback)

  const prefixes = new Set<string>()
  for (const provider of providers) {
    prefixes.add(`${provider}:`)
    if (provider === 'google') {
      prefixes.add('google:')
      prefixes.add('gemini:')
    }
    if (provider === 'google-vertex') {
      prefixes.add('google-vertex:')
    }
    if (provider === 'openai' || provider === 'openai-codex') {
      prefixes.add('openai:')
      prefixes.add('openai-codex:')
    }
    if (provider === 'codex') {
      prefixes.add('codex:')
      prefixes.add('openai-codex:')
    }
  }
  return prefixes
}

function authProfileMatchesAllowedProvider(authProfileId: string, allowedPrefixes: Set<string>) {
  const normalized = authProfileId.trim().toLowerCase()
  if (!normalized) return true
  if (!allowedPrefixes.size) return true
  for (const prefix of allowedPrefixes) {
    if (normalized.startsWith(prefix)) return true
  }
  return false
}

function agentSessionStorePath(agentId: string) {
  return path.join(OPENCLAW_AGENTS_ROOT, agentId, 'sessions', 'sessions.json')
}

async function resolveAgentConfiguredModelStack(agentId: string) {
  const { config, target } = await getAgentById(agentId)
  if (!target) return null
  const defaults = config.agents?.defaults?.model || {}
  const local = await ensureAgentLocalConfig({
    agentId: target.id,
    entry: target,
    defaultsModel: defaults,
    defaultsSandbox: (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox,
  })
  return normalizeModelWithFallback(local.model, defaults)
}

function clearDisallowedAutoModelOverrideFromEntry(
  entry: AgentSessionStoreEntry,
  sessionKey: string,
  allowedKeys: Set<string>,
  allowedAuthPrefixes: Set<string>,
  options: { clearManualOverrides?: boolean } = {},
): ModelOverrideCleanupResult['cleared'][number] | null {
  const source = sessionStringField(entry, 'modelOverrideSource').toLowerCase()
  const authSource = sessionStringField(entry, 'authProfileOverrideSource').toLowerCase()
  const authProfileOverride = sessionStringField(entry, 'authProfileOverride')
  const overrideKey = modelRefKeyFromParts(
    sessionStringField(entry, 'providerOverride'),
    sessionStringField(entry, 'modelOverride'),
  )
  const activeNoticeKey = modelRefKeyFromId(sessionStringField(entry, 'fallbackNoticeActiveModel'))
  const runtimeKey = modelRefKeyFromParts(
    sessionStringField(entry, 'modelProvider'),
    sessionStringField(entry, 'model'),
  )
  // A manual /model command is normally allowed to persist. When the agent's
  // configured model is explicitly saved (or it is made the inbound default),
  // that configuration is the newer source of truth, so clear an incompatible
  // manual override as well. This prevents an old OpenAI session from silently
  // winning over a newly selected Gemini model.
  const shouldClearOverride = Boolean(overrideKey) && !allowedKeys.has(overrideKey) && (
    source === 'auto' || options.clearManualOverrides === true
  )
  const shouldClearNotice = Boolean(activeNoticeKey) && !allowedKeys.has(activeNoticeKey)
  const shouldClearRuntime = Boolean(runtimeKey) && !allowedKeys.has(runtimeKey)
  const shouldClearAuth =
    Boolean(authProfileOverride) &&
    (authSource === 'auto' || entry.authProfileOverrideCompactionCount !== undefined) &&
    !authProfileMatchesAllowedProvider(authProfileOverride, allowedAuthPrefixes)

  if (!shouldClearOverride && !shouldClearNotice && !shouldClearRuntime && !shouldClearAuth) return null

  const clearedModel = overrideKey || activeNoticeKey || runtimeKey || authProfileOverride || 'unknown'
  if (shouldClearOverride) {
    delete entry.providerOverride
    delete entry.modelOverride
    delete entry.modelOverrideSource
  }
  if (shouldClearOverride || shouldClearAuth) {
    delete entry.authProfileOverride
    delete entry.authProfileOverrideSource
    delete entry.authProfileOverrideCompactionCount
  }
  delete entry.fallbackNoticeSelectedModel
  delete entry.fallbackNoticeActiveModel
  delete entry.fallbackNoticeReason

  if (shouldClearRuntime) {
    delete entry.modelProvider
    delete entry.model
    delete entry.contextTokens
    delete entry.systemPromptReport
  }
  entry.updatedAt = Date.now()

  return {
    sessionKey,
    model: clearedModel,
    reason: shouldClearOverride
      ? 'auto override outside configured model stack'
      : shouldClearNotice
        ? 'stale fallback notice outside configured model stack'
        : shouldClearRuntime
          ? 'runtime model outside configured model stack'
          : 'auto auth profile outside configured provider stack',
  }
}

async function clearDisallowedAutoModelOverridesForAgent(
  agentId: string,
  modelStack?: { primary?: string; fallbacks?: string[] },
  options: { clearManualOverrides?: boolean } = {},
): Promise<ModelOverrideCleanupResult> {
  if (!isValidAgentId(agentId) || isRetiredAgentId(agentId)) return { changed: false, cleared: [] }
  const configured = modelStack || await resolveAgentConfiguredModelStack(agentId)
  if (!configured) return { changed: false, cleared: [] }
  const allowedKeys = configuredModelKeys(configured)
  if (!allowedKeys.size) return { changed: false, cleared: [] }
  const allowedAuthPrefixes = configuredAuthProfilePrefixes(configured)

  const storePath = agentSessionStorePath(agentId)
  let store: AgentSessionStore
  try {
    const raw = await fs.readFile(storePath, 'utf-8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { changed: false, cleared: [] }
    store = parsed as AgentSessionStore
  } catch {
    return { changed: false, cleared: [] }
  }

  const cleared: ModelOverrideCleanupResult['cleared'] = []
  for (const [sessionKey, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const result = clearDisallowedAutoModelOverrideFromEntry(entry, sessionKey, allowedKeys, allowedAuthPrefixes, options)
    if (result) cleared.push(result)
  }

  if (!cleared.length) return { changed: false, cleared }
  await writeTextFileWithLockRetry(storePath, `${JSON.stringify(store, null, 2)}\n`)
  console.warn(`[model-guard] cleared ${cleared.length} disallowed auto model override(s) for ${agentId}`)
  return { changed: true, cleared }
}

async function clearDisallowedAutoModelOverridesForAgentArgs(args: string[]) {
  if (args[0] !== 'agent') return
  const agentId = argValue(args, '--agent')
  if (!isValidAgentId(agentId)) return
  await clearDisallowedAutoModelOverridesForAgent(agentId)
}

// --- Gateway lifecycle management ---
type GatewayRestartOutcome = 'scheduled' | 'started' | 'succeeded' | 'failed' | 'skipped'

type GatewayRestartLifecycleSnapshot = {
  at: string
  reason: string
  outcome: GatewayRestartOutcome
  eventAt?: string
}

type GatewayLedgerSnapshot = {
  entries: GatewayLogEntry[]
  restart: GatewayRestartLifecycleSnapshot | null
  recentRestarts: GatewayRestartLifecycleSnapshot[]
}

const GATEWAY_HTTP_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789)
let gatewayAutostartTimer: NodeJS.Timeout | null = null
let shuttingDown = false
let desktopParentWatchdogTimer: NodeJS.Timeout | null = null

const RUNTIME_STATUS_CACHE_MS = Math.max(
  500,
  Math.min(10_000, Number(process.env.CONTROL_CENTER_RUNTIME_STATUS_CACHE_MS || 1_500)),
)
const RUNTIME_SUMMARY_CACHE_MS = Math.max(
  500,
  Math.min(10_000, Number(process.env.CONTROL_CENTER_RUNTIME_SUMMARY_CACHE_MS || 2_000)),
)
const GATEWAY_LEDGER_SNAPSHOT_CACHE_MS = Math.max(
  500,
  Math.min(10_000, Number(process.env.CONTROL_CENTER_GATEWAY_LEDGER_SNAPSHOT_CACHE_MS || 2_000)),
)
const RUNTIME_STATUS_RESPONSE_TIMEOUT_MS = Math.max(
  1_500,
  Math.min(15_000, Number(process.env.CONTROL_CENTER_RUNTIME_STATUS_RESPONSE_TIMEOUT_MS || 6_000)),
)
const RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS = Math.max(
  750,
  Math.min(10_000, Number(process.env.CONTROL_CENTER_RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS || 2_500)),
)
const GATEWAY_STARTUP_HEALTH_GRACE_MS = (() => {
  const configured = Number(process.env.CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_GRACE_MS || 75_000)
  return Number.isFinite(configured) ? Math.max(15_000, Math.min(180_000, configured)) : 75_000
})()
const GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS = (() => {
  const configured = Number(process.env.CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS || 45_000)
  return Number.isFinite(configured) ? Math.max(10_000, Math.min(180_000, configured)) : 45_000
})()
const GATEWAY_STARTUP_HEALTH_POLL_MS = (() => {
  const configured = Number(process.env.CONTROL_CENTER_GATEWAY_STARTUP_HEALTH_POLL_MS || 1_500)
  return Number.isFinite(configured) ? Math.max(500, Math.min(10_000, configured)) : 1_500
})()
const GATEWAY_CONFIG_VALIDATE_TIMEOUT_MS = 60_000
const GATEWAY_CONFIG_DOCTOR_TIMEOUT_MS = 120_000
const GATEWAY_RESTART_TIMELINE_LIMIT = 5
let runtimeMonitorClearedAtMs = 0
let gatewayConfigPreflightInFlight: Promise<boolean> | null = null
let gatewayLedgerSnapshotCache: { builtAt: number; limit: number; sqlite: boolean; snapshot: GatewayLedgerSnapshot } | null = null
let gatewayLedgerSnapshotInFlight: { limit: number; sqlite: boolean; promise: Promise<GatewayLedgerSnapshot> } | null = null
let gatewayLedgerSnapshotGeneration = 0
const runtimeStatusServiceRef: { current?: RuntimeStatusService } = {}

function invalidateRuntimeStatusCache() {
  runtimeStatusServiceRef.current?.invalidateCache()
}

function invalidateGatewayLedgerSnapshotCache() {
  gatewayLedgerSnapshotGeneration += 1
  gatewayLedgerSnapshotCache = null
  gatewayLedgerSnapshotInFlight = null
}

function sanitizeGatewayStartupMessage(message: string, max = 220) {
  return compactGatewayLogMessage(redactSensitiveText(stripAnsi(message || '')), max)
}

function isRuntimeMonitorEntryVisible(timestamp: string | null | undefined) {
  if (!runtimeMonitorClearedAtMs) return true
  const entryMs = timestamp ? Date.parse(timestamp) : NaN
  return Number.isFinite(entryMs) && entryMs > runtimeMonitorClearedAtMs
}

const gatewayLifecycleRef: { current?: GatewayLifecycleService } = {}
let getGatewayDiagnosticsClient: () => GatewayDiagnosticsClient | null = () => null

const gatewayLogService = createGatewayLogService({
  openClawGatewayLogPath: OPENCLAW_GATEWAY_LOG_PATH,
  openClawStateRoot: OPENCLAW_STATE_ROOT,
  nativeOpenClawStateRoot: NATIVE_OPENCLAW_STATE_ROOT,
  controlCenterStartedAtMs: CONTROL_CENTER_STARTED_AT_MS,
  readOpenclawConfig,
  getGatewayClient: () => getGatewayDiagnosticsClient(),
  appendGatewayLogEntry: (entry) => {
    invalidateGatewayLedgerSnapshotCache()
    return runtimeLedgerStore.appendGatewayEvent(entry, { mirrorJsonl: false })
  },
  getGatewayLastStartedAt: () => gatewayLifecycleRef.current?.lifecycleSnapshot().lastStartedAt || null,
  getRuntimeMonitorClearedAtMs: () => runtimeMonitorClearedAtMs,
  applyDiagnosticRedactions,
  redactSensitiveText,
  stripAnsi,
})

function compactGatewayLogMessage(value: string, max = 640) {
  return gatewayLogService.compactGatewayLogMessage(value, max)
}

function formatGatewayProcessOutput(prefix: string, message: string) {
  return gatewayLogService.formatGatewayProcessOutput(prefix, message)
}

function pushGatewayLog(stream: GatewayLogEntry['stream'], message: string, level?: string) {
  gatewayLogService.pushGatewayLog(stream, message, level)
}

function dedupeGatewayLogEntries(entries: GatewayLogEntry[], limit = 80) {
  return gatewayLogService.dedupeGatewayLogEntries(entries, limit)
}

async function readExternalGatewayLogEntries(limit = 80): Promise<GatewayLogEntry[]> {
  return gatewayLogService.readExternalGatewayLogEntries(limit)
}

async function readExternalChannelActivityEntries(limit = 80): Promise<GatewayLogEntry[]> {
  return gatewayLogService.readExternalChannelActivityEntries(limit)
}

function normalizeGatewayLedgerEntry(value: unknown, index: number): GatewayLogEntry | null {
  return gatewayLogService.normalizeGatewayLedgerEntry(value, index)
}

function gatewayLogEntriesSinceCurrentStart(entries: GatewayLogEntry[]) {
  return gatewayLogService.gatewayLogEntriesSinceCurrentStart(entries)
}

function summarizeGatewayActivity(entries: GatewayLogEntry[], activeWindowMs = 10 * 60 * 1000): GatewayActivitySummary {
  return gatewayLogService.summarizeGatewayActivity(entries, activeWindowMs)
}

function runtimeLoadedPluginIdsFromGatewayLogs(entries: GatewayLogEntry[]) {
  return gatewayLogService.runtimeLoadedPluginIdsFromGatewayLogs(entries)
}

function summarizeCronProcessedError(value: string) {
  return gatewayLogService.summarizeCronProcessedError(value)
}

function isGatewayInternalDiagnosticMessage(value: string) {
  return gatewayLogService.isGatewayInternalDiagnosticMessage(value)
}

const gatewayChatService = createGatewayChatService({
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  clientVersion: '0.0.6',
  gatewayAgentSessionsEnabled: CONTROL_CENTER_GATEWAY_AGENT_SESSIONS,
  gatewayChatClientEnabled: CONTROL_CENTER_GATEWAY_CHAT_CLIENT,
  forceLocalAgentRuntime: FORCE_LOCAL_AGENT_RUNTIME,
  toolsEffectiveDiagnostic: CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC,
  fastAutoOnSeconds: DEFAULT_OPENCLAW_FAST_AUTO_ON_SECONDS,
  getGatewayAuthEnv,
  isShuttingDown: () => shuttingDown,
  ensureGatewayRunning,
  startGatewayHealthMonitor,
  isGatewayHealthy,
  getOpenClawAgentRunDefaultsReady: () => openclawAgentRunDefaultsReady,
  ensureOpenclawAgentRunConfigDefaults,
  gatewayChatAttachmentsFromTurnAttachments,
  normalizeFastMode: openClawChatFastMode,
  beginGatewayChatRun: beginGatewayChatOpenClawRun,
  finishGatewayChatRun: finishOpenClawRun,
  classifyFailureKind,
  sanitizeUserVisibleRuntimeText,
  redactHiddenReasoningAndSecrets,
  redactSensitiveText,
  pushGatewayLog,
})
getGatewayDiagnosticsClient = () => gatewayChatService.getReadyClient()

function gatewayChatRuntimeSnapshot(now = Date.now()) {
  return gatewayChatService.runtimeSnapshot(now)
}

function abortStaleGatewayChatWaiters(minAgeMs: number, reason: string) {
  return gatewayChatService.abortStaleWaiters(minAgeMs, reason)
}

function registerGatewayChatStreamObserver(emit: StreamEmitter, signal?: AbortSignal) {
  return gatewayChatService.registerStreamObserver(emit, signal)
}

function gatewayChatStreamObserver(id?: string) {
  return gatewayChatService.streamObserver(id)
}

function stopControlCenterGatewayClient(reason = 'control center shutdown') {
  gatewayChatService.stopClient(reason)
}

function ensureControlCenterGatewayClient(signal?: AbortSignal) {
  return gatewayChatService.ensureClient(signal)
}

function prewarmControlCenterGatewayAgentRuntime(reason = 'startup') {
  return gatewayChatService.prewarm(reason)
}

function scheduleControlCenterGatewayAgentRuntimePrewarm(reason = 'startup', delayMs = 1500) {
  gatewayChatService.schedulePrewarm(reason, delayMs)
}

function runControlCenterGatewayChatTurn(params: {
  agentId: string
  message: string
  attachments?: unknown[]
  sessionId: string
  requestedSessionKey?: string
  freshSession?: boolean
  thinking: ThinkingLevel
  fastMode?: FastModePreference
  timeoutMs: number
  cwd: string
  streamObserverId?: string
  signal?: AbortSignal
}) {
  return gatewayChatService.runTurn(params)
}

function spawnText(
  command: string,
  args: string[],
  options: { timeoutMs?: number; windowsHide?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      ...(process.platform === 'win32' ? { windowsHide: options.windowsHide ?? true } : {}),
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return
          settled = true
          void terminateProcessTree(child.pid, `${command} helper timeout`, true)
          resolve({ stdout, stderr, code: null, timedOut: true })
        }, options.timeoutMs)
      : null

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve({ stdout, stderr: stderr || String(error), code: 1, timedOut: false })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve({ stdout, stderr, code, timedOut: false })
    })
  })
}

function openClawCommandOutput(result: OpenClawResult) {
  return redactSensitiveText(stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)).trim()
}

function compactOpenClawCommandOutput(result: OpenClawResult, fallback: string) {
  const output = openClawCommandOutput(result)
  return compactGatewayLogMessage(output || fallback, 900)
}

function openClawValidateResultIsValid(result: OpenClawResult) {
  if (result.code !== 0) return false
  const text = (result.stdout || '').trim()
  if (!text) return true
  try {
    const parsed = JSON.parse(text) as { valid?: unknown; ok?: unknown }
    return parsed.valid === true || parsed.ok === true
  } catch {
    return /\b(valid|ok)\b/i.test(text) && !/\binvalid\b/i.test(text)
  }
}

function isInvalidOpenClawConfigText(value: string) {
  return /\bInvalid config\b/i.test(value)
    || /\bconfig schema validation failed\b/i.test(value)
    || /\bconfig reload skipped \(invalid config\)/i.test(value)
    || /\bagents\.list\.\d+:\s*Invalid input\b/i.test(value)
}

async function promoteValidatedOpenClawConfigLastGood(reason: string) {
  try {
    const raw = await readTextFileWithLockRetry(OPENCLAW_CONFIG_PATH)
    await writeTextFileWithLockRetry(`${OPENCLAW_CONFIG_PATH}.last-good`, raw.endsWith('\n') ? raw : `${raw}\n`)
    pushGatewayLog('lifecycle', `validated OpenClaw config promoted to last-good (${reason})`)
  } catch (error) {
    console.warn(`[gateway] failed to promote validated config backup (${reason}):`, error)
  }
}

async function validateOpenClawConfigForGateway(reason: string) {
  const result = await runOpenClaw(['config', 'validate', '--json'], GATEWAY_CONFIG_VALIDATE_TIMEOUT_MS)
  const valid = openClawValidateResultIsValid(result)
  const detail = compactOpenClawCommandOutput(result, valid ? 'OpenClaw config valid.' : `openclaw config validate exited ${result.code}`)
  if (valid) {
    await promoteValidatedOpenClawConfigLastGood(reason)
  } else {
    pushGatewayLog('lifecycle', `OpenClaw config validation failed (${reason}): ${detail}`)
  }
  return { valid, detail, result }
}

function pauseGatewayAutoRestartForInvalidConfig(detail: string) {
  gatewayLifecycle.pauseAutoRestartForInvalidConfig(detail)
}

function pauseGatewayAutoRestartForRuntimeUnavailable(detail: string) {
  gatewayLifecycle.pauseAutoRestartForRuntimeUnavailable(detail)
}

async function cleanupLegacyConfigHealthStateForGateway(reason: string) {
  const cleanup = await archiveCoveredLegacyConfigHealthState({ stateRoot: OPENCLAW_STATE_ROOT })
    .catch((error) => ({
      archived: false,
      reason: String(error),
      sourcePath: path.join(OPENCLAW_STATE_ROOT, 'logs', 'config-health.json'),
      entries: 0,
    }))
  if (cleanup.archived) {
    pushGatewayLog('lifecycle', `Archived covered legacy config health state (${reason})`)
  }
  return cleanup
}

async function repairOpenClawConfigForGateway(reason: string) {
  pushGatewayLog('lifecycle', `running OpenClaw doctor repair for config (${reason})`)
  const result = await runOpenClaw(
    ['doctor', '--fix', '--non-interactive', '--yes', '--no-workspace-suggestions'],
    GATEWAY_CONFIG_DOCTOR_TIMEOUT_MS,
  )
  openclawConfigCache = null
  modelCatalogService.invalidateAvailableModels()
  const detail = compactOpenClawCommandOutput(result, `openclaw doctor --fix exited ${result.code}`)
  if (result.code === 0) {
    pushGatewayLog('lifecycle', `OpenClaw doctor repair completed (${reason})`)
  } else {
    pushGatewayLog('lifecycle', `OpenClaw doctor repair failed (${reason}): ${detail}`)
  }
  return { ok: result.code === 0, detail, result }
}

async function prepareOpenClawConfigForGatewayStartup(reason: string) {
  if (gatewayConfigPreflightInFlight) return gatewayConfigPreflightInFlight
  gatewayConfigPreflightInFlight = (async () => {
    try {
      if (!isOpenClawRuntimeAvailable()) {
        const detail = openClawRuntimeUnavailableMessage()
        pushGatewayLog('lifecycle', `OpenClaw config validation skipped (${reason}): ${detail}`)
        pauseGatewayAutoRestartForRuntimeUnavailable(detail)
        return false
      }
      openclawConfigCache = null
      await cleanupLegacyConfigHealthStateForGateway(reason)
      const config = await readOpenclawConfig()
      await synchronizeOpenClawBillingRoute(config)
      await cleanupLegacyConfigHealthStateForGateway(reason)
      let validation = await validateOpenClawConfigForGateway(reason)
      if (validation.valid) return true

      const repair = await repairOpenClawConfigForGateway(reason)
      openclawConfigCache = null
      const repairedConfig = await readOpenclawConfig().catch(() => null)
      if (repairedConfig) await synchronizeOpenClawBillingRoute(repairedConfig)
      await cleanupLegacyConfigHealthStateForGateway(`${reason}; after doctor repair`)
      validation = await validateOpenClawConfigForGateway(`${reason}; after doctor repair`)
      if (validation.valid) {
        gatewayLifecycle.resumeAutoRestartAfterConfigRepair()
        return true
      }

      pauseGatewayAutoRestartForInvalidConfig(validation.detail || repair.detail)
      return false
    } catch (error) {
      const detail = compactGatewayLogMessage(redactSensitiveText(stripAnsi(String(error))), 900)
      pauseGatewayAutoRestartForInvalidConfig(detail)
      return false
    }
  })().finally(() => {
    gatewayConfigPreflightInFlight = null
  })
  return gatewayConfigPreflightInFlight
}

const gatewayDiagnostics = createGatewayDiagnosticsService({
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  getGatewayClient: () => getGatewayDiagnosticsClient(),
  sanitizeGatewayMessage: sanitizeGatewayStartupMessage,
  redactSensitiveText,
  onHealthy: () => gatewayLifecycleRef.current?.markGatewayHealthy(),
})

function fetchGatewayHealthPayload() {
  return gatewayDiagnostics.fetchGatewayHealthPayload()
}

function fetchGatewayReadinessPayload() {
  return gatewayDiagnostics.fetchGatewayReadinessPayload()
}

function gatewayReadinessUnavailable(error?: string) {
  return gatewayDiagnostics.gatewayReadinessUnavailable(error)
}

function gatewayStabilityUnavailable(source: GatewayStabilityStatus['source'], error?: string) {
  return gatewayDiagnostics.gatewayStabilityUnavailable(source, error)
}

function readGatewayStabilitySnapshot(limit = 12) {
  return gatewayDiagnostics.readGatewayStabilitySnapshot(limit)
}

const gatewayLifecycle = createGatewayLifecycleService({
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  controlCenterPort: PORT,
  controlCenterToken: AUTH_TOKEN,
  openClawConfigPath: OPENCLAW_CONFIG_PATH,
  openClawStateRoot: OPENCLAW_STATE_ROOT,
  startupHealthGraceMs: GATEWAY_STARTUP_HEALTH_GRACE_MS,
  startupHealthConfirmTimeoutMs: GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS,
  startupHealthPollMs: GATEWAY_STARTUP_HEALTH_POLL_MS,
  isShuttingDown: () => shuttingDown,
  isOpenClawRuntimeAvailable,
  openClawRuntimeUnavailableMessage,
  openClawSpawnSpec,
  openClawProcessEnv,
  openClawRuntimeCwd,
  spawnText,
  terminateProcessTree,
  checkTcpPort,
  tryReleaseGatewayPort,
  isPidAlive,
  delayMs,
  appendBoundedRuntimeOutput,
  compactGatewayLogMessage,
  redactSensitiveText,
  stripAnsi,
  sanitizeGatewayStartupMessage,
  formatGatewayProcessOutput,
  pushGatewayLog,
  appendGatewayLifecycleEvent: (entry) => {
    invalidateGatewayLedgerSnapshotCache()
    return runtimeLedgerStore.appendGatewayEvent(entry, { mirrorJsonl: false })
  },
  getGatewayLogs: () => gatewayLogService.getGatewayLogs(),
  isRuntimeMonitorEntryVisible,
  invalidateRuntimeStatusCache,
  gatewayStabilityUnavailable,
  fetchGatewayHealthPayload,
  repairClawTalkPluginManifestContracts,
  repairTelegramAgentRoutingRuntime,
  refreshOpenClawPluginRegistry,
  ensureGatewayStartupPluginDefaults,
  prepareOpenClawConfigForGatewayStartup,
  isInvalidOpenClawConfigText,
  scheduleOpenClawSessionLockSweep,
  sweepOpenClawSessionLocks,
  stopControlCenterGatewayClient,
})
gatewayLifecycleRef.current = gatewayLifecycle

async function gatewayListenerPidForPort(port: number) {
  return gatewayLifecycle.gatewayListenerPidForPort(port)
}

async function isGatewayHealthy(): Promise<boolean> {
  return gatewayLifecycle.isGatewayHealthy()
}

function startGatewayHealthMonitor(): void {
  gatewayLifecycle.startGatewayHealthMonitor()
}

function stopGatewayHealthMonitor(): void {
  gatewayLifecycle.stopGatewayHealthMonitor()
}

async function ensureGatewayRunning(): Promise<void> {
  const gate = licenseService.getTrafficGate()
  if (gate.blocked) {
    pushGatewayLog('lifecycle', gate.blockMessage || 'Gateway start blocked by the Automnia traffic gate.', 'warning')
    return
  }
  return gatewayLifecycle.ensureGatewayRunning()
}

function stopGateway(): void {
  gatewayLifecycle.stopGateway()
}

async function stopGatewayRuntime(reason = 'manual stop') {
  return gatewayLifecycle.stopGatewayRuntime(reason)
}

function gatewayStatusSnapshot(
  healthy: boolean,
  listenerPid: number | null = null,
  restartSnapshot: GatewayRestartLifecycleSnapshot | null = null,
  restartTimeline: GatewayRestartLifecycleSnapshot[] = [],
  stability: GatewayStabilityStatus = gatewayStabilityUnavailable('gateway-client-not-ready'),
) {
  return gatewayLifecycle.gatewayStatusSnapshot(healthy, listenerPid, restartSnapshot, restartTimeline, stability)
}

function gatewayRestartDiagnostics(
  healthy: boolean,
  recentRestarts: GatewayRestartLifecycleSnapshot[],
  stability: GatewayStabilityStatus,
) {
  return gatewayLifecycle.restartDiagnostics(healthy, recentRestarts, stability)
}

const runtimeStatusService = createRuntimeStatusService({
  openClawConfigPath: OPENCLAW_CONFIG_PATH,
  statusCacheMs: RUNTIME_STATUS_CACHE_MS,
  summaryCacheMs: RUNTIME_SUMMARY_CACHE_MS,
  statusResponseTimeoutMs: RUNTIME_STATUS_RESPONSE_TIMEOUT_MS,
  summaryResponseTimeoutMs: RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS,
  fetchGatewayHealthPayload,
  fetchGatewayReadinessPayload,
  readRuntimeGatewayLedgerSnapshot,
  readExternalGatewayLogEntries,
  readExternalChannelActivityEntries,
  listPluginControls,
  readOpenclawConfig,
  createInitialOpenclawConfig,
  openClawOptimizationStatus: (config) => openClawOptimizationStatus(config as OpenClawConfigFile),
  readGatewayStabilitySnapshot,
  readDoctorDiagnosticsSummary,
  gatewayStatusSnapshot,
  gatewayLogEntriesSinceCurrentStart,
  dedupeGatewayLogEntries,
  runtimeLoadedPluginIdsFromGatewayLogs,
  summarizeGatewayActivity,
  openAgentSessionSnapshots,
  listMissions,
  missionView: (mission) => missionView(mission as Mission),
  listActiveCronJobViews,
  activeRunSnapshots: () => Array.from(activeOpenClawRuns.values()).map(openClawRunSnapshot),
  recentRunSnapshots: (limit) => recentOpenClawRuns
    .filter((run) => isRuntimeMonitorEntryVisible(run.endedAt || run.startedAt))
    .slice(0, limit),
  isRuntimeMonitorEntryVisible,
  runtimeVersionCheckPayload,
  runtimeLedgerStatus: runtimeLedgerStore.status,
  gatewayChatRuntimeSnapshot,
  gatewayReadinessUnavailable,
  gatewayStabilityUnavailable,
  cachedDoctorDiagnosticsSummary,
  redactSensitiveText,
})
runtimeStatusServiceRef.current = runtimeStatusService

const gatewayActivityFeedService = createGatewayActivityFeedService({
  readGatewayLedgerSnapshot: readRuntimeGatewayLedgerSnapshot,
  dedupeGatewayLogEntries,
  isRuntimeMonitorEntryVisible,
})

function getRuntimeStatusPayload(forcePluginRefresh: boolean): Promise<Record<string, unknown>> {
  return runtimeStatusService.getRuntimeStatusPayload(forcePluginRefresh)
}

function getRuntimeSummaryPayload(forceRefresh: boolean): Promise<Record<string, unknown>> {
  return runtimeStatusService.getRuntimeSummaryPayload(forceRefresh)
}

function getGatewayActivityFeed(limit?: number) {
  return gatewayActivityFeedService.getGatewayActivityFeed(limit)
}
async function agentSessionFileSnapshot(agentId: string, sessionId: string) {
  const sessionFile = path.join(OPENCLAW_AGENTS_ROOT, agentId, 'sessions', `${sessionId}.jsonl`)
  const stat = await fs.stat(sessionFile).catch(() => null)
  return {
    sessionFile,
    sessionFileExists: Boolean(stat),
    lastTouchedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
  }
}

async function openAgentSessionSnapshots(gatewayActivity?: GatewayActivitySummary) {
  const sessionEntries = Array.from(agentTurnSessions.entries())
  const activeRunsBySession = new Map<string, OpenClawRunRecord>()
  for (const run of activeOpenClawRuns.values()) {
    if (run.agentId && run.sessionId) activeRunsBySession.set(`${run.agentId}\0${run.sessionId}`, run)
  }
  const lockReport = await inspectOpenClawSessionLocks({ all: true }).catch((error) => ({
    scanned: 0,
    locks: [] as OpenClawSessionLockInspection[],
    errors: [String(error)],
  }))
  const locksBySession = new Map<string, OpenClawSessionLockInspection>()
  for (const lock of lockReport.locks) {
    locksBySession.set(`${lock.agentId}\0${lock.sessionId}`, lock)
  }
  const gatewayEventsByAgent = new Map<string, GatewayChannelActivity[]>()
  for (const event of gatewayActivity?.events || []) {
    if (!event.agentId) continue
    const events = gatewayEventsByAgent.get(event.agentId)
    if (events) events.push(event)
    else gatewayEventsByAgent.set(event.agentId, [event])
  }
  const seenSessionKeys = new Set<string>()
  const snapshots = await Promise.all(sessionEntries.map(async ([scope, sessionId]) => {
    const agentId = agentTurnSessionScopeAgentId(scope)
    const sessionKey = `${agentId}\0${sessionId}`
    const gatewaySessionKey = activeRunsBySession.get(sessionKey)?.sessionKey || runtimeSessionKeyFromScope(scope, agentId)
    seenSessionKeys.add(sessionKey)
    const history = providerConversationHistories.get(sessionId)
    const activeRun = activeRunsBySession.get(sessionKey)
    const activityEvents = gatewayEventsByAgent.get(agentId) || []
    const inferredActivityEvents = activityEvents.length
      ? activityEvents
      : sessionEntries.length === 1
        ? gatewayActivity?.events || []
        : []
    const lastGatewayEventAt = inferredActivityEvents[0]?.timestamp || null
    const lastGatewayEventMs = lastGatewayEventAt ? Date.parse(lastGatewayEventAt) : NaN
    const gatewayActive = Number.isFinite(lastGatewayEventMs) ? Date.now() - lastGatewayEventMs <= 10 * 60 * 1000 : false
    return {
      agentId,
      sessionScope: scope,
      sessionKey: gatewaySessionKey || null,
      sessionId,
      active: Boolean(activeRun) || gatewayActive,
      activeRunId: activeRun?.id || null,
      provider: history?.provider || null,
      modelId: history?.modelId || null,
      conversationMessages: history?.messages.length || 0,
      updatedAt: history?.updatedAt ? new Date(history.updatedAt).toISOString() : null,
      gatewayActive,
      gatewayLastEventAt: lastGatewayEventAt,
      gatewayEventCount: inferredActivityEvents.length,
      gatewayInboundCount: inferredActivityEvents.filter((event) => event.direction === 'inbound').length,
      gatewayOutboundCount: inferredActivityEvents.filter((event) => event.direction === 'outbound').length,
      ...(locksBySession.has(sessionKey) ? { sessionLock: openClawSessionLockStatus(locksBySession.get(sessionKey)!) } : {}),
      ...(await agentSessionFileSnapshot(agentId, sessionId)),
    }
  }))
  const lockOnlySessions = await Promise.all(Array.from(locksBySession.values())
    .filter((lock) => !seenSessionKeys.has(`${lock.agentId}\0${lock.sessionId}`))
    .map(async (lock) => ({
      agentId: lock.agentId,
      sessionScope: lock.agentId,
      sessionKey: null,
      sessionId: lock.sessionId,
      active: false,
      activeRunId: null,
      provider: null,
      modelId: null,
      conversationMessages: 0,
      updatedAt: null,
      gatewayActive: false,
      gatewayLastEventAt: null,
      gatewayEventCount: 0,
      gatewayInboundCount: 0,
      gatewayOutboundCount: 0,
      sessionLock: openClawSessionLockStatus(lock),
      ...(await agentSessionFileSnapshot(lock.agentId, lock.sessionId)),
    })))
  return [...snapshots, ...lockOnlySessions]
}

function isGatewayRestartOutcome(value: unknown): value is GatewayRestartOutcome {
  return value === 'scheduled'
    || value === 'started'
    || value === 'succeeded'
    || value === 'failed'
    || value === 'skipped'
}

function gatewayRestartLifecycleSnapshotFromRecord(value: unknown): GatewayRestartLifecycleSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.event !== 'gateway.restart.lifecycle') return null
  if (record.lifecycle !== 'restart') return null
  if (!isGatewayRestartOutcome(record.restartOutcome)) return null

  const rawAt = typeof record.restartRequestedAt === 'string' && record.restartRequestedAt.trim()
    ? record.restartRequestedAt.trim()
    : typeof record.timestamp === 'string' && record.timestamp.trim()
      ? record.timestamp.trim()
      : ''
  const at = rawAt && !Number.isNaN(Date.parse(rawAt)) ? new Date(rawAt).toISOString() : ''
  const rawEventAt = typeof record.timestamp === 'string' && record.timestamp.trim() ? record.timestamp.trim() : rawAt
  const eventAt = rawEventAt && !Number.isNaN(Date.parse(rawEventAt)) ? new Date(rawEventAt).toISOString() : at
  const rawReason = typeof record.restartReason === 'string' ? record.restartReason.trim() : ''
  const reason = sanitizeGatewayStartupMessage(rawReason || 'unspecified gateway restart', 180)
  if (!at || !reason) return null
  return {
    at,
    reason,
    outcome: record.restartOutcome,
    eventAt,
  }
}

function gatewayRestartLifecycleSnapshotFromRecords(records: unknown[]): GatewayRestartLifecycleSnapshot | null {
  return gatewayRestartLifecycleSnapshotsFromRecords(records, 1)[0] || null
}

function gatewayRestartLifecycleSnapshotsFromRecords(records: unknown[], limit = GATEWAY_RESTART_TIMELINE_LIMIT): GatewayRestartLifecycleSnapshot[] {
  const byRequestedAt = new Map<string, GatewayRestartLifecycleSnapshot>()
  for (const record of records) {
    const snapshot = gatewayRestartLifecycleSnapshotFromRecord(record)
    if (!snapshot) continue
    if (!isRuntimeMonitorEntryVisible(snapshot.eventAt || snapshot.at)) continue
    byRequestedAt.set(snapshot.at, snapshot)
  }
  return Array.from(byRequestedAt.values())
    .sort((a, b) => Date.parse(b.eventAt || b.at) - Date.parse(a.eventAt || a.at))
    .slice(0, Math.max(1, Math.min(GATEWAY_RESTART_TIMELINE_LIMIT, Math.round(limit))))
}

function gatewayRestartLifecycleTimelineWithMemory(
  restartSnapshot: GatewayRestartLifecycleSnapshot | null,
  restartTimeline: GatewayRestartLifecycleSnapshot[],
): GatewayRestartLifecycleSnapshot[] {
  return gatewayLifecycle.restartLifecycleTimelineWithMemory(restartSnapshot, restartTimeline)
}

async function readGatewayLedgerSnapshot(limit = 120, options: { sqlite?: boolean } = {}): Promise<{
  entries: GatewayLogEntry[]
  restart: GatewayRestartLifecycleSnapshot | null
  recentRestarts: GatewayRestartLifecycleSnapshot[]
}> {
  const records = await runtimeLedgerStore.readGatewayEvents<unknown>(limit, options).catch(() => [])
  const entries = records
    .map((record, index) => normalizeGatewayLedgerEntry(record, index))
    .filter((entry): entry is GatewayLogEntry => Boolean(entry))
    .filter((entry) => isRuntimeMonitorEntryVisible(entry.timestamp))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
  return {
    entries,
    restart: gatewayRestartLifecycleSnapshotFromRecords(records),
    recentRestarts: gatewayRestartLifecycleSnapshotsFromRecords(records),
  }
}

function normalizedGatewayLedgerSnapshotLimit(limit: number) {
  return Math.max(1, Math.min(1000, Math.round(Number.isFinite(limit) ? limit : 1)))
}

function limitGatewayLedgerSnapshot(snapshot: GatewayLedgerSnapshot, limit: number): GatewayLedgerSnapshot {
  const normalizedLimit = normalizedGatewayLedgerSnapshotLimit(limit)
  return {
    entries: snapshot.entries.slice(0, normalizedLimit),
    restart: snapshot.restart,
    recentRestarts: snapshot.recentRestarts.slice(0, GATEWAY_RESTART_TIMELINE_LIMIT),
  }
}

async function readRuntimeGatewayLedgerSnapshot(limit = 120, options: { sqlite?: boolean } = {}): Promise<GatewayLedgerSnapshot> {
  const normalizedLimit = normalizedGatewayLedgerSnapshotLimit(limit)
  const sqlite = options.sqlite !== false
  const now = Date.now()
  if (
    gatewayLedgerSnapshotCache
    && gatewayLedgerSnapshotCache.sqlite === sqlite
    && gatewayLedgerSnapshotCache.limit >= normalizedLimit
    && now - gatewayLedgerSnapshotCache.builtAt <= GATEWAY_LEDGER_SNAPSHOT_CACHE_MS
  ) {
    return limitGatewayLedgerSnapshot(gatewayLedgerSnapshotCache.snapshot, normalizedLimit)
  }

  if (gatewayLedgerSnapshotInFlight && gatewayLedgerSnapshotInFlight.sqlite === sqlite && gatewayLedgerSnapshotInFlight.limit >= normalizedLimit) {
    return limitGatewayLedgerSnapshot(await gatewayLedgerSnapshotInFlight.promise, normalizedLimit)
  }

  const requestGeneration = gatewayLedgerSnapshotGeneration
  const promise = readGatewayLedgerSnapshot(normalizedLimit, { sqlite }).then((snapshot) => {
    if (requestGeneration === gatewayLedgerSnapshotGeneration) {
      gatewayLedgerSnapshotCache = {
        builtAt: Date.now(),
        limit: normalizedLimit,
        sqlite,
        snapshot,
      }
    }
    return snapshot
  }).finally(() => {
    if (gatewayLedgerSnapshotInFlight?.promise === promise) gatewayLedgerSnapshotInFlight = null
  })
  gatewayLedgerSnapshotInFlight = { limit: normalizedLimit, sqlite, promise }
  return limitGatewayLedgerSnapshot(await promise, normalizedLimit)
}

let signalShutdownInFlight = false
let controlServerClosing = false

function clearShutdownPinnedTimers(): void {
  modelCatalogService.clearRefreshTimer()
  if (gatewayAutostartTimer) {
    clearTimeout(gatewayAutostartTimer)
    gatewayAutostartTimer = null
  }
  gatewayLifecycle.clearRestartTimer()
  if (pluginGatewayRestartTimer) {
    clearTimeout(pluginGatewayRestartTimer)
    pluginGatewayRestartTimer = null
  }
  if (pluginRegistryRefreshTimer) {
    clearTimeout(pluginRegistryRefreshTimer)
    pluginRegistryRefreshTimer = null
  }
  for (const timer of shiftTimers.values()) clearTimeout(timer)
  shiftTimers.clear()
  for (const timers of managedBatchTimers.values()) {
    for (const timer of timers) clearInterval(timer)
  }
  managedBatchTimers.clear()
  for (const timer of missionTimers.values()) clearTimeout(timer)
  missionTimers.clear()
  for (const timer of missionLoopTimers.values()) clearTimeout(timer)
  missionLoopTimers.clear()
}

async function closeControlServerForShutdown(reason: string): Promise<void> {
  if (!controlServer || controlServerClosing) return
  controlServerClosing = true
  const server = controlServer as Server & {
    closeAllConnections?: () => void
    closeIdleConnections?: () => void
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (error?: Error & { code?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(forceCloseTimer)
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.warn(`[control-center] ${reason}: HTTP server close warning:`, error)
      }
      resolve()
    }
    const forceCloseTimer = setTimeout(() => {
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      finish()
    }, 1500)
    forceCloseTimer.unref?.()

    try {
      server.close(finish)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function handleControlCenterShutdown(signalName: 'SIGTERM' | 'SIGINT' | 'SIGHUP' | 'process exit') {
  if (desktopParentWatchdogTimer) {
    clearInterval(desktopParentWatchdogTimer)
    desktopParentWatchdogTimer = null
  }
  if (shuttingDown && signalName !== 'process exit') {
    if (!signalShutdownInFlight) return
    console.warn(`[control-center] ${signalName} received while shutdown is still in progress; forcing exit.`)
    process.exit(1)
  }
  if (signalName !== 'process exit') shuttingDown = true
  if (signalName !== 'process exit') console.log(`[control-center] received ${signalName}`)
  if (signalName !== 'process exit') {
    signalShutdownInFlight = true
    const forceExitTimer = setTimeout(() => {
      console.warn(`[control-center] ${signalName} shutdown timed out; forcing exit.`)
      process.exit(1)
    }, 10000)
    forceExitTimer.unref?.()

    void (async () => {
      await closeControlServerForShutdown(`${signalName} shutdown`)
      await runtimeRecoveryService.shutdownControlCenterRuntime(`${signalName} shutdown`)
    })()
      .catch((error) => {
        console.warn(`[control-center] ${signalName} shutdown cleanup failed:`, error)
        process.exitCode = 1
      })
      .finally(() => {
        clearTimeout(forceExitTimer)
        process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
      })
    return
  }
  runtimeRecoveryService.processExitCleanup(`${signalName} shutdown`)
}

process.on('SIGTERM', () => handleControlCenterShutdown('SIGTERM'))
process.on('SIGINT', () => handleControlCenterShutdown('SIGINT'))
process.on('SIGHUP', () => handleControlCenterShutdown('SIGHUP'))
process.on('exit', () => {
  handleControlCenterShutdown('process exit')
})

function startDesktopParentWatchdog(): void {
  const parentPid = Number(process.env.AUTOMNIA_DESKTOP_SERVER_PARENT_PID || 0)
  if (process.env.AUTOMNIA_DESKTOP_SERVER_CHILD !== '1' || !Number.isFinite(parentPid) || parentPid <= 1) return

  desktopParentWatchdogTimer = setInterval(() => {
    if (shuttingDown) return
    if (process.ppid === parentPid && isPidAlive(parentPid)) return
    console.warn(`[control-center] desktop parent pid ${parentPid} is gone; shutting down orphaned API server.`)
    handleControlCenterShutdown('SIGHUP')
  }, 1500)
  desktopParentWatchdogTimer.unref?.()
}

startDesktopParentWatchdog()

function isMarkdownResourceFile(file: string) {
  return /^[^\\/]+\.md$/i.test(file)
}

function contentTypeFromExt(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.htm') return 'text/html; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') return 'text/javascript; charset=utf-8'
  if (ext === '.json' || ext === '.map') return 'application/json; charset=utf-8'
  if (ext === '.jsonl') return 'application/x-ndjson; charset=utf-8'
  if (ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.md' || ext === '.markdown') return 'text/markdown; charset=utf-8'
  if (ext === '.csv') return 'text/csv; charset=utf-8'
  if (ext === '.tsv') return 'text/tab-separated-values; charset=utf-8'
  if (ext === '.log') return 'text/plain; charset=utf-8'
  if (ext === '.xml') return 'application/xml; charset=utf-8'
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml; charset=utf-8'
  if (ext === '.py' || ext === '.ipynb' || ext === '.java' || ext === '.go' || ext === '.rs' || ext === '.c' || ext === '.cc' || ext === '.cpp' || ext === '.h' || ext === '.hpp' || ext === '.cs' || ext === '.php' || ext === '.rb' || ext === '.sh' || ext === '.bash' || ext === '.zsh' || ext === '.ps1' || ext === '.sql' || ext === '.toml' || ext === '.ini' || ext === '.env') return 'text/plain; charset=utf-8'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.doc') return 'application/msword'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.rtf') return 'application/rtf'
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint'
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (ext === '.xls') return 'application/vnd.ms-excel'
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.aac') return 'audio/aac'
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.opus') return 'audio/opus'
  if (ext === '.ico') return 'image/x-icon'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.woff') return 'font/woff'
  if (ext === '.woff2') return 'font/woff2'
  if (ext === '.ttf') return 'font/ttf'
  return 'application/octet-stream'
}

function persistCommandConsoleUpload(bytes: Buffer, sourceName: string | undefined, rawMimeType: string | undefined) {
  return commandConsoleUploadService.persistUpload(bytes, sourceName, rawMimeType)
}

function gatewayChatAttachmentsFromTurnAttachments(attachments: unknown[] | undefined) {
  return commandConsoleUploadService.gatewayAttachmentsFromTurnAttachments(attachments)
}

function clampStat(value: number | undefined) {
  if (!Number.isFinite(value)) return 50
  return Math.min(99, Math.max(1, Math.round(value as number)))
}

function isAgentBehaviorProfile(value: unknown): value is AgentBehaviorProfile {
  return typeof value === 'string' && (AGENT_BEHAVIOR_PROFILES as readonly string[]).includes(value)
}

function sanitizeProfile(profile: PartialAgentProfileInput): AgentProfile {
  return {
    skills: normalizeAgentSkillList(profile.skills, 50),
    abilities: Array.isArray(profile.abilities) ? profile.abilities.filter(Boolean).slice(0, 20) : [],
    tools: Array.isArray(profile.tools) ? profile.tools.filter(Boolean).slice(0, 20) : [],
    behaviorProfile: isAgentBehaviorProfile(profile.behaviorProfile) ? profile.behaviorProfile : 'hybrid',
    className: (profile.className || '').trim().slice(0, 60),
    role: (profile.role || '').trim().slice(0, 60),
    motto: (profile.motto || '').trim().slice(0, 140),
    bio: (profile.bio || '').trim().slice(0, 800),
    avatar: profile.avatar?.trim().slice(0, 500),
    level: Math.min(99, Math.max(1, Math.round(profile.level || 1))),
    stats: {
      execution: clampStat(profile.stats?.execution),
      reliability: clampStat(profile.stats?.reliability),
      speed: clampStat(profile.stats?.speed),
      analysis: clampStat(profile.stats?.analysis),
      communication: clampStat(profile.stats?.communication),
    },
  }
}

function recruitCapabilitiesFromProfile(profile: AgentProfile): AgentLocalConfig['mds']['capabilities'] {
  const abilities = new Set(profile.abilities)
  const tools = new Set(profile.tools)
  const hasAbilities = profile.abilities.length > 0
  return {
    codeGeneration: abilities.has('codeGeneration') || (!hasAbilities && (tools.has('shell') || tools.has('filesystem'))),
    planning: abilities.has('planning') || (!hasAbilities && tools.has('planner')),
    research: abilities.has('research') || (!hasAbilities && (tools.has('web_search') || tools.has('web_fetch'))),
    orchestration: abilities.has('orchestration') || (!hasAbilities && profile.behaviorProfile === 'architect'),
    memoryManagement: abilities.has('memoryManagement') || (!hasAbilities && tools.has('memory')),
  }
}

function recruitAttributesFromProfile(profile: AgentProfile): AgentLocalConfig['attributes'] {
  const stats = profile.stats
  return {
    intelligence: clampStat(stats.analysis),
    speed: clampStat(stats.speed),
    precision: clampStat(stats.reliability),
    creativity: clampStat(Math.round((stats.analysis + stats.communication) / 2)),
    stability: clampStat(stats.reliability),
    compute: clampStat(stats.execution),
    parallelism: clampStat(stats.communication),
  }
}

function recruitRuntimeDefaults(): AgentLocalConfig['runtime'] {
  return {
    thinkingDefault: 'off',
    timeoutSeconds: 90,
    parallelPreferred: true,
    fastModeDefault: DEFAULT_OPENCLAW_FAST_MODE,
  }
}

function recruitHeartbeatDefaults(): AgentLocalConfig['heartbeat'] {
  return {
    tickIntervalMs: 4200,
    maxExecutionTimeMs: null,
    continuous: false,
    idleTimeoutMs: 45000,
    recoveryMode: true,
  }
}

function recruitSoulDefaults(behaviorProfile: AgentBehaviorProfile): AgentLocalConfig['soul'] {
  if (behaviorProfile === 'architect') {
    return { personality: 'analytical', autonomyLevel: 78, riskTolerance: 34, reflectionDepth: 88, goalOrientation: 86, persistence: 78, alignmentMode: 'strict' }
  }
  if (behaviorProfile === 'auditor') {
    return { personality: 'conservative', autonomyLevel: 70, riskTolerance: 22, reflectionDepth: 92, goalOrientation: 80, persistence: 86, alignmentMode: 'strict' }
  }
  if (behaviorProfile === 'researcher') {
    return { personality: 'analytical', autonomyLevel: 76, riskTolerance: 38, reflectionDepth: 90, goalOrientation: 78, persistence: 76, alignmentMode: 'exploratory' }
  }
  if (behaviorProfile === 'hybrid') {
    return { personality: 'creative', autonomyLevel: 80, riskTolerance: 48, reflectionDepth: 76, goalOrientation: 82, persistence: 80, alignmentMode: 'balanced' }
  }
  return { personality: 'aggressive', autonomyLevel: 82, riskTolerance: 56, reflectionDepth: 58, goalOrientation: 88, persistence: 84, alignmentMode: 'balanced' }
}

function recruitMdsDefaults(profile: AgentProfile): AgentLocalConfig['mds'] {
  const capabilities = recruitCapabilitiesFromProfile(profile)
  const toolAccess = profile.tools.length ? profile.tools : ['filesystem', 'message', 'planner', 'memory']
  return {
    maxContextTokens: 32000,
    delegationAllowed: true,
    subAgentSpawnLimit: capabilities.orchestration ? 4 : 2,
    toolAccess,
    capabilities,
  }
}

type AgentMdsPatch = Partial<Omit<AgentLocalConfig['mds'], 'capabilities' | 'skillLibrary'>> & {
  capabilities?: Partial<AgentLocalConfig['mds']['capabilities']>
  skillLibrary?: Partial<AgentSkillLibraryState>
}

function normalizeAgentMdsState(base: AgentLocalConfig['mds'], patch?: AgentMdsPatch): AgentLocalConfig['mds'] {
  const capabilities = patch?.capabilities
  const toolAccess = patch?.toolAccess
  const scalarPatch: Partial<Omit<AgentLocalConfig['mds'], 'capabilities' | 'skillLibrary' | 'toolAccess'>> = {
    ...(patch?.maxContextTokens !== undefined ? { maxContextTokens: patch.maxContextTokens } : {}),
    ...(patch?.delegationAllowed !== undefined ? { delegationAllowed: patch.delegationAllowed } : {}),
    ...(patch?.subAgentSpawnLimit !== undefined ? { subAgentSpawnLimit: patch.subAgentSpawnLimit } : {}),
  }
  const skillLibraryPatch = patch?.skillLibrary
  const existingSkillLibrary = base.skillLibrary
  const skillLibrary = skillLibraryPatch || existingSkillLibrary

  return {
    ...base,
    ...scalarPatch,
    capabilities: {
      ...base.capabilities,
      ...(capabilities || {}),
    },
    toolAccess: toolAccess?.length ? toolAccess : base.toolAccess,
    ...(skillLibrary
      ? {
          skillLibrary: {
            knownSkills: skillLibraryPatch?.knownSkills || existingSkillLibrary?.knownSkills || [],
            preferredSkills: skillLibraryPatch?.preferredSkills || existingSkillLibrary?.preferredSkills || [],
            ...(skillLibraryPatch?.lastSyncedAt || existingSkillLibrary?.lastSyncedAt
              ? { lastSyncedAt: skillLibraryPatch?.lastSyncedAt || existingSkillLibrary?.lastSyncedAt }
              : {}),
          },
        }
      : {}),
  }
}

function isLegacyGenericRecruitRuntime(value?: Partial<AgentLocalConfig['runtime']>) {
  if (!value) return false
  return value.thinkingDefault === 'medium'
    && value.timeoutSeconds === 900
    && (value.parallelPreferred === undefined || value.parallelPreferred === true)
    && (value.fastModeDefault === undefined || value.fastModeDefault === DEFAULT_OPENCLAW_FAST_MODE)
}

function isLegacyGenericRecruitHeartbeat(value?: Partial<AgentLocalConfig['heartbeat']>) {
  if (!value) return false
  return value.tickIntervalMs === 3000
    && value.maxExecutionTimeMs === 900000
    && value.continuous === true
    && value.idleTimeoutMs === 180000
    && value.recoveryMode === true
}

function isLegacyGenericRecruitSoul(value?: Partial<AgentLocalConfig['soul']>) {
  if (!value) return false
  return value.personality === 'analytical'
    && value.autonomyLevel === 72
    && value.riskTolerance === 48
    && value.reflectionDepth === 62
    && value.goalOrientation === 84
    && value.persistence === 88
    && value.alignmentMode === 'balanced'
}

function isLegacyGenericRecruitAttributes(value?: Partial<AgentLocalConfig['attributes']>) {
  if (!value) return false
  return value.intelligence === 80
    && value.speed === 80
    && value.precision === 80
    && value.creativity === 80
    && value.stability === 80
    && value.compute === 80
    && value.parallelism === 4
}

function isLegacyGenericRecruitMds(value: AgentMdsPatch | undefined, inferred: AgentLocalConfig['mds']) {
  if (!value) return false
  const caps: Partial<AgentLocalConfig['mds']['capabilities']> = value.capabilities || {}
  const allCapabilitiesOn =
    caps.codeGeneration === true
    && caps.planning === true
    && caps.research === true
    && caps.orchestration === true
    && caps.memoryManagement === true
  const lacksToolAccess = !Array.isArray(value.toolAccess) || value.toolAccess.length === 0
  const conflictsWithProfile = Object.entries(inferred.capabilities).some(([, enabled]) => enabled !== true) || inferred.toolAccess.length > 0
  return Boolean(
    allCapabilitiesOn
      && lacksToolAccess
      && conflictsWithProfile
      && (value.maxContextTokens ?? 0) >= 128000
      && (value.subAgentSpawnLimit ?? 0) >= 8,
  )
}

function normalizeStringList(values?: string[]) {
  const output = Array.from(new Set((values || []).map((value) => value?.trim()).filter(Boolean)))
  return output.length ? output : undefined
}

function normalizeAgentSkillList(values?: string[], limit = 100) {
  return Array.from(
    new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)),
  ).slice(0, limit)
}

function skillSelectionKey(value: string) {
  return value.trim().toLowerCase()
}

function resolveOpenClawAgentSkillFilter(local: AgentLocalConfig) {
  const selected = normalizeAgentSkillList(local.profile?.skills, 100)
  if (!selected.length) return [] as string[]

  const selectedKeys = new Set(selected.map(skillSelectionKey))
  const output = new Set<string>(selected)
  for (const skill of local.mds?.skillLibrary?.knownSkills || []) {
    const id = skill.id?.trim()
    const name = skill.name?.trim()
    if (
      (id && selectedKeys.has(skillSelectionKey(id))) ||
      (name && selectedKeys.has(skillSelectionKey(name)))
    ) {
      if (name) output.add(name)
      if (id) output.add(id)
    }
  }
  return Array.from(output).slice(0, 100)
}

function normalizeToolProfile(profile?: string) {
  const value = profile?.trim().toLowerCase()
  if (!value) return undefined
  const canonical = LEGACY_TOOL_PROFILE_ALIASES[value] || value
  return OPENCLAW_TOOL_PROFILES.has(canonical) ? canonical : undefined
}

function normalizeSandboxConfig(input?: AgentSandboxConfig): AgentSandboxConfig {
  const mode = input?.mode && ['off', 'all', 'non-main'].includes(input.mode) ? input.mode : undefined
  const scope = input?.scope && ['session', 'agent', 'shared'].includes(input.scope) ? input.scope : undefined
  const workspaceAccess =
    input?.workspaceAccess && ['rw', 'ro', 'none'].includes(input.workspaceAccess) ? input.workspaceAccess : undefined
  const workspaceRoot = resolveWorkspacePath(input?.workspaceRoot)
  return {
    ...(mode ? { mode } : {}),
    ...(scope ? { scope } : {}),
    ...(workspaceRoot ? { workspaceRoot: path.resolve(workspaceRoot) } : {}),
    ...(workspaceAccess ? { workspaceAccess } : {}),
    ...(input?.docker ? { docker: input.docker } : {}),
    ...(input?.browser ? { browser: input.browser } : {}),
    ...(input?.prune ? { prune: input.prune } : {}),
  }
}

let dockerAvailabilityCache: { checkedAt: number; available: boolean } | null = null

function isDockerCliAvailable() {
  const now = Date.now()
  if (dockerAvailabilityCache && now - dockerAvailabilityCache.checkedAt < 30_000) {
    return dockerAvailabilityCache.available
  }

  const result = spawnSync('docker', ['--version'], {
    cwd: WORKSPACE_ROOT,
    env: process.env,
    shell: false,
    stdio: 'ignore',
    timeout: 2500,
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  })
  const available = !result.error && result.status === 0
  dockerAvailabilityCache = { checkedAt: now, available }
  return available
}

function sandboxRequiresDocker(sandbox?: AgentSandboxConfig) {
  return Boolean(sandbox?.mode && sandbox.mode !== 'off')
}

function dockerUnavailableSandboxMessage(agentId: string) {
  return `Agent ${agentId} requested sandboxed execution, but Docker is not available on this machine. Sandbox mode was switched off for embedded OpenClaw runtime execution.`
}

function normalizeAgentToolsConfig(input?: AgentToolsConfig): AgentToolsConfig {
  const byProvider = Object.fromEntries(
    Object.entries(input?.byProvider || {})
      .map(([provider, policy]) => {
        const key = provider.trim()
        if (!key) return null
        const normalized: ProviderToolPolicy = {
          ...(normalizeToolProfile(policy.profile) ? { profile: normalizeToolProfile(policy.profile) } : {}),
          ...(normalizeStringList(policy.allow) ? { allow: normalizeStringList(policy.allow) } : {}),
          ...(normalizeStringList(policy.deny) ? { deny: normalizeStringList(policy.deny) } : {}),
        }
        return Object.keys(normalized).length ? [key, normalized] : null
      })
      .filter((entry): entry is [string, ProviderToolPolicy] => Boolean(entry)),
  )

  return {
    ...(normalizeToolProfile(input?.profile) ? { profile: normalizeToolProfile(input?.profile) } : {}),
    ...(normalizeStringList(input?.alsoAllow) ? { alsoAllow: normalizeStringList(input?.alsoAllow) } : {}),
    ...(normalizeStringList(input?.allow) ? { allow: normalizeStringList(input?.allow) } : {}),
    ...(normalizeStringList(input?.deny) ? { deny: normalizeStringList(input?.deny) } : {}),
    ...(Object.keys(byProvider).length ? { byProvider } : {}),
    ...(input?.sandbox?.tools
      ? {
          sandbox: {
            tools: {
              ...(normalizeStringList(input.sandbox.tools.allow) ? { allow: normalizeStringList(input.sandbox.tools.allow) } : {}),
              ...(normalizeStringList(input.sandbox.tools.deny) ? { deny: normalizeStringList(input.sandbox.tools.deny) } : {}),
            },
          },
        }
      : {}),
    ...(typeof input?.elevated?.enabled === 'boolean' ? { elevated: { enabled: input.elevated.enabled } } : {}),
  }
}

function unrestrictedAgentToolsConfig(): AgentToolsConfig {
  return normalizeAgentToolsConfig({ profile: 'full' })
}

function applyExecutionWorkspaceToLocalConfig(local: AgentLocalConfig, workspacePath: string) {
  const workspace = normalizeExecutionWorkspacePath(path.resolve(workspacePath || defaultAgentWorkspace(local.agent.id)))
  local.routing.workspace = workspace
  local.identity.avatar = configSafeAgentAvatar(local.identity.avatar, workspace)
  local.memory = {
    ...(local.memory || { retentionDays: 180 }),
    journalDir: path.join(workspace, 'memory'),
    retentionDays: local.memory?.retentionDays ?? 180,
  }
  local.sandbox = normalizeSandboxConfig({
    ...local.sandbox,
    workspaceRoot: workspace,
  })
  return workspace
}

type AgentRuntimeFlagMode = 'default' | 'gateway' | 'local'

function withAgentRuntimeFlags(args: string[], options: { mode?: AgentRuntimeFlagMode } = {}) {
  if (!args.length || args[0] !== 'agent') return args
  const mode = options.mode || 'default'
  if (mode === 'gateway') return args.filter((arg) => arg !== '--local')
  if (mode !== 'local' && !FORCE_LOCAL_AGENT_RUNTIME) return args
  if (args.includes('--local')) return args
  return ['agent', '--local', ...args.slice(1)]
}

function openClawJsonHasReply(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    payloads?: Array<{ text?: unknown; isError?: unknown }>
    result?: { payloads?: Array<{ text?: unknown; isError?: unknown }> }
    payload?: { text?: unknown }
    text?: unknown
    message?: unknown
    content?: unknown
    summary?: unknown
    status?: unknown
    ok?: unknown
  }
  if (record.ok === false || record.status === 'error') return false
  const payloads = [...(record.payloads || []), ...(record.result?.payloads || [])]
  if (payloads.some((payload) => !payload.isError && typeof payload.text === 'string' && payload.text.trim())) return true
  return [record.payload?.text, record.text, record.message, record.content, record.summary].some(
    (entry) => typeof entry === 'string' && entry.trim().length > 0,
  )
}

function stdoutHasOpenClawReply(stdout: string) {
  const trimmed = stdout.trim()
  if (!trimmed) return false
  try {
    if (openClawJsonHasReply(JSON.parse(trimmed))) return true
  } catch {
    // Try JSON-lines or a final JSON object mixed with logs.
  }
  for (const line of trimmed.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).reverse()) {
    try {
      if (openClawJsonHasReply(JSON.parse(line.replace(/,$/, '')))) return true
    } catch {
      // keep scanning
    }
  }
  return false
}

function resolveOpenClawTimeoutResult(stdout: string, stderr: string, timeoutMs: number) {
  const trimmedOut = stdout.trim()
  const trimmedErr = stderr.trim()
  const timeoutMessage = `openclaw child process exceeded wrapper timeout after ${timeoutMs}ms`
  if (stdoutHasOpenClawReply(trimmedOut)) {
    return {
      stdout: trimmedOut,
      stderr: [trimmedErr, timeoutMessage].filter(Boolean).join('\n'),
      code: 0,
    }
  }
  return {
    stdout: trimmedOut,
    stderr: [trimmedErr, `Error: openclaw timed out after ${timeoutMs}ms`].filter(Boolean).join('\n'),
    code: 124,
  }
}

function argValue(args: string[], flag: string) {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : ''
  return typeof value === 'string' ? value.trim() : ''
}

function isSafeSessionId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value) && !value.includes('..')
}

function isPidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

type OpenClawSessionLockStaleReason =
  | 'missing-pid'
  | 'dead-pid'
  | 'invalid-createdAt'
  | 'too-old'
  | 'hold-exceeded'
  | 'non-openclaw-owner'

type OpenClawSessionLockInspection = {
  agentId: string
  sessionId: string
  lockPath: string
  pid: number | null
  ownerAlive: boolean | null
  ageMs: number | null
  mtimeAgeMs: number
  staleReasons: OpenClawSessionLockStaleReason[]
  removed: boolean
}

type OpenClawSessionLockStatus = {
  lockPath: string
  pid: number | null
  ownerAlive: boolean | null
  ageMs: number | null
  mtimeAgeMs: number
  staleReasons: OpenClawSessionLockStaleReason[]
  stale: boolean
  removable: boolean
}

type OpenClawSessionLockCleanupResult = {
  scanned: number
  removed: OpenClawSessionLockInspection[]
  skipped?: boolean
  errors: string[]
}

let openClawSessionLockSweepInFlight: Promise<OpenClawSessionLockCleanupResult> | null = null
let openClawSessionLockLastSweepAt = 0

function isValidLockNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function positiveLockNumber(value: unknown) {
  return isValidLockNumber(value) ? value : null
}

function resolveOpenClawSessionWriteLockStaleMs() {
  const raw = process.env.OPENCLAW_SESSION_WRITE_LOCK_STALE_MS?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const parsed = Number(raw)
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  }
  return OPENCLAW_SESSION_WRITE_LOCK_STALE_MS
}

function isOpenClawSessionOwnerCommandLine(commandLine: string) {
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase()
  if (/(^|[\s"'])(openclaw(?:\.mjs|\.cmd|\.bat|\.exe)?|openclaw-gateway(?:\.mjs|\.cmd|\.exe)?)(?=$|[\s"'])/.test(normalized)) {
    return true
  }
  if (normalized.includes('/openclaw.mjs') || normalized.includes('/openclaw.cmd')) return true
  const hasRuntimeCommand = /(^|[\s"'])(agent|gateway)(?=$|[\s"'])/.test(normalized)
  if (!hasRuntimeCommand) return false
  return normalized.includes('/vendor/openclaw/')
    || normalized.includes('/resources/openclaw/')
    || normalized.includes('/openclaw/dist/')
    || normalized.includes('/openclaw/src/')
    || normalized.includes('/openclaw/openclaw.mjs')
}

async function readProcessCommandLine(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  const result = process.platform === 'win32'
    ? await spawnText('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }`,
      ], {
        windowsHide: true,
        timeoutMs: 2500,
      })
    : await spawnText('ps', ['-p', String(pid), '-o', 'args='], {
        timeoutMs: 2500,
      })
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim()
  if (result.timedOut || result.code !== 0 || !output) return null
  return output
}

function sessionLockShouldWaitForOrphanPayloadGrace(inspection: OpenClawSessionLockInspection) {
  return inspection.staleReasons.length > 0
    && inspection.staleReasons.every((reason) => reason === 'missing-pid' || reason === 'invalid-createdAt' || reason === 'too-old')
}

function shouldRemoveOpenClawSessionLock(inspection: OpenClawSessionLockInspection, minAgeMs: number) {
  if (!inspection.staleReasons.length) return false
  if (inspection.mtimeAgeMs < minAgeMs) return false
  if (inspection.staleReasons.every((reason) => OPENCLAW_SESSION_LOCK_REPORT_ONLY_REASONS.has(reason))) return false
  if (sessionLockShouldWaitForOrphanPayloadGrace(inspection) && inspection.mtimeAgeMs < OPENCLAW_SESSION_LOCK_ORPHAN_GRACE_MS) return false
  return true
}

async function inspectOpenClawSessionLock(
  params: {
    agentId: string
    lockPath: string
    sessionId: string
    stat: Awaited<ReturnType<typeof fs.stat>>
    staleMs: number
    ownerCommandLines: Map<number, Promise<string | null>>
  },
): Promise<OpenClawSessionLockInspection> {
  const nowMs = Date.now()
  const raw = await fs.readFile(params.lockPath, 'utf-8').catch(() => '')
  let payload: Record<string, unknown> | null = null
  try {
    const parsed = raw.trim() ? JSON.parse(raw) as unknown : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
  } catch {
    payload = null
  }

  const pid = payload ? positiveLockNumber(payload.pid) : null
  const createdAt = typeof payload?.createdAt === 'string' ? payload.createdAt : ''
  const createdAtMs = createdAt ? Date.parse(createdAt) : NaN
  const ageMs = Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : null
  const mtimeAgeMs = Math.max(0, nowMs - Number(params.stat.mtimeMs))
  const maxHoldMs = payload ? positiveLockNumber(payload.maxHoldMs) : null
  const staleReasons: OpenClawSessionLockStaleReason[] = []
  let ownerAlive: boolean | null = null

  if (pid === null || pid <= 0) {
    ownerAlive = null
    staleReasons.push('missing-pid')
  } else if (!isPidAlive(pid)) {
    ownerAlive = false
    staleReasons.push('dead-pid')
  } else {
    ownerAlive = true
    let commandLinePromise = params.ownerCommandLines.get(pid)
    if (!commandLinePromise) {
      commandLinePromise = readProcessCommandLine(pid)
      params.ownerCommandLines.set(pid, commandLinePromise)
    }
    const commandLine = await commandLinePromise
    if (commandLine?.trim() && !isOpenClawSessionOwnerCommandLine(commandLine)) {
      staleReasons.push('non-openclaw-owner')
    }
  }

  if (ageMs === null) {
    staleReasons.push('invalid-createdAt')
  } else {
    if (ageMs > params.staleMs) staleReasons.push('too-old')
    if (typeof maxHoldMs === 'number' && maxHoldMs > 0 && ageMs > maxHoldMs) staleReasons.push('hold-exceeded')
  }

  return {
    agentId: params.agentId,
    sessionId: params.sessionId,
    lockPath: params.lockPath,
    pid: pid && pid > 0 ? pid : null,
    ownerAlive,
    ageMs,
    mtimeAgeMs,
    staleReasons,
    removed: false,
  }
}

async function listOpenClawAgentIdsForLockCleanup(agentId?: string) {
  if (agentId) return isValidAgentId(agentId) ? [agentId] : []
  const entries = await fs.readdir(OPENCLAW_AGENTS_ROOT, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && isValidAgentId(entry.name))
    .map((entry) => entry.name)
}

function openClawSessionLockSummary(locks: OpenClawSessionLockInspection[]) {
  const preview = locks
    .slice(0, 4)
    .map((lock) => `${lock.agentId}/${lock.sessionId.slice(0, 8)} (${lock.staleReasons.join(', ') || 'stale'})`)
    .join('; ')
  return locks.length > 4 ? `${preview}; +${locks.length - 4} more` : preview
}

function openClawSessionLockStatus(inspection: OpenClawSessionLockInspection): OpenClawSessionLockStatus {
  return {
    lockPath: inspection.lockPath,
    pid: inspection.pid,
    ownerAlive: inspection.ownerAlive,
    ageMs: inspection.ageMs,
    mtimeAgeMs: inspection.mtimeAgeMs,
    staleReasons: inspection.staleReasons,
    stale: inspection.staleReasons.length > 0,
    removable: shouldRemoveOpenClawSessionLock(inspection, 0),
  }
}

async function inspectOpenClawSessionLocks(
  options: {
    agentId?: string
    sessionId?: string
    all?: boolean
  } = {},
): Promise<{ scanned: number; locks: OpenClawSessionLockInspection[]; errors: string[] }> {
  const result: { scanned: number; locks: OpenClawSessionLockInspection[]; errors: string[] } = { scanned: 0, locks: [], errors: [] }
  const staleMs = resolveOpenClawSessionWriteLockStaleMs()
  const ownerCommandLines = new Map<number, Promise<string | null>>()
  const agentIds = await listOpenClawAgentIdsForLockCleanup(options.all ? undefined : options.agentId)
  const sessionIdFilter = options.sessionId && isSafeSessionId(options.sessionId) ? options.sessionId : ''

  for (const agentId of agentIds) {
    const sessionDir = path.join(OPENCLAW_AGENTS_ROOT, agentId, 'sessions')
    let lockNames: string[] = []
    try {
      if (sessionIdFilter) {
        lockNames = [`${sessionIdFilter}.jsonl.lock`]
      } else {
        const entries = await fs.readdir(sessionDir, { withFileTypes: true }).catch(() => [])
        lockNames = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl.lock'))
          .map((entry) => entry.name)
      }

      for (const name of lockNames) {
        const lockSessionId = name.replace(/\.jsonl\.lock$/u, '')
        if (!isSafeSessionId(lockSessionId)) continue
        const lockPath = path.join(sessionDir, name)
        const stat = await fs.stat(lockPath).catch(() => null)
        if (!stat) continue
        const inspection = await inspectOpenClawSessionLock({
          agentId,
          sessionId: lockSessionId,
          lockPath,
          stat,
          staleMs,
          ownerCommandLines,
        })
        result.scanned += 1
        result.locks.push(inspection)
      }
    } catch (error) {
      result.errors.push(`${agentId}: ${String(error)}`)
    }
  }

  return result
}

async function cleanupOpenClawSessionLocks(
  options: {
    agentId?: string
    sessionId?: string
    all?: boolean
    minAgeMs?: number
    reason?: string
    quiet?: boolean
  } = {},
): Promise<OpenClawSessionLockCleanupResult> {
  const result: OpenClawSessionLockCleanupResult = { scanned: 0, removed: [], errors: [] }
  const minAgeMs = options.minAgeMs ?? OPENCLAW_STALE_LOCK_MIN_AGE_MS
  const staleMs = resolveOpenClawSessionWriteLockStaleMs()
  const ownerCommandLines = new Map<number, Promise<string | null>>()
  const agentIds = await listOpenClawAgentIdsForLockCleanup(options.all ? undefined : options.agentId)
  const sessionIdFilter = options.sessionId && isSafeSessionId(options.sessionId) ? options.sessionId : ''

  for (const agentId of agentIds) {
    const sessionDir = path.join(OPENCLAW_AGENTS_ROOT, agentId, 'sessions')
    let lockNames: string[] = []
    try {
      if (sessionIdFilter) {
        lockNames = [`${sessionIdFilter}.jsonl.lock`]
      } else {
        const entries = await fs.readdir(sessionDir, { withFileTypes: true }).catch(() => [])
        lockNames = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl.lock'))
          .map((entry) => entry.name)
      }

      for (const name of lockNames) {
        const lockSessionId = name.replace(/\.jsonl\.lock$/u, '')
        if (!isSafeSessionId(lockSessionId)) continue
        const lockPath = path.join(sessionDir, name)
        const stat = await fs.stat(lockPath).catch(() => null)
        if (!stat) continue
        const inspection = await inspectOpenClawSessionLock({
          agentId,
          sessionId: lockSessionId,
          lockPath,
          stat,
          staleMs,
          ownerCommandLines,
        })
        result.scanned += 1
        if (!shouldRemoveOpenClawSessionLock(inspection, minAgeMs)) continue
        await fs.rm(lockPath, { force: true })
        inspection.removed = true
        result.removed.push(inspection)
      }
    } catch (error) {
      result.errors.push(`${agentId}: ${String(error)}`)
    }
  }

  if (result.removed.length && !options.quiet) {
    const reason = options.reason || 'runtime maintenance'
    pushGatewayLog('lifecycle', `session lock cleanup (${reason}) reclaimed ${result.removed.length} orphaned lock file(s): ${openClawSessionLockSummary(result.removed)}`)
  }
  if (result.errors.length && !options.quiet) {
    pushGatewayLog('lifecycle', `session lock cleanup skipped ${result.errors.length} agent folder(s): ${result.errors.slice(0, 3).join('; ')}`)
  }
  return result
}

async function sweepOpenClawSessionLocks(
  reason: string,
  options: { minIntervalMs?: number; minAgeMs?: number; quiet?: boolean } = {},
) {
  const minIntervalMs = options.minIntervalMs ?? OPENCLAW_SESSION_LOCK_SWEEP_INTERVAL_MS
  const now = Date.now()
  if (openClawSessionLockSweepInFlight) return openClawSessionLockSweepInFlight
  if (minIntervalMs > 0 && openClawSessionLockLastSweepAt && now - openClawSessionLockLastSweepAt < minIntervalMs) {
    return { scanned: 0, removed: [], errors: [], skipped: true } satisfies OpenClawSessionLockCleanupResult
  }
  openClawSessionLockLastSweepAt = now
  openClawSessionLockSweepInFlight = cleanupOpenClawSessionLocks({
    all: true,
    minAgeMs: options.minAgeMs ?? 0,
    reason,
    quiet: options.quiet,
  }).finally(() => {
    openClawSessionLockSweepInFlight = null
  })
  return openClawSessionLockSweepInFlight
}

function scheduleOpenClawSessionLockSweep(reason: string, delayMs = 1500) {
  const timeout = setTimeout(() => {
    void sweepOpenClawSessionLocks(reason, { minIntervalMs: 0, minAgeMs: 0 })
  }, delayMs)
  timeout.unref?.()
}

async function cleanupStaleOpenClawSessionLocksForArgs(
  args: string[],
  options: { minAgeMs?: number; onlyCurrentSession?: boolean } = {},
) {
  if (args[0] !== 'agent') return
  const agentId = argValue(args, '--agent')
  if (!isValidAgentId(agentId)) return
  const sessionId = argValue(args, '--session-id')
  await cleanupOpenClawSessionLocks({
    agentId,
    sessionId: options.onlyCurrentSession ? sessionId : undefined,
    minAgeMs: options.minAgeMs,
    reason: options.onlyCurrentSession ? 'agent run finished' : 'agent run preflight',
  })
}

function scheduleStaleOpenClawSessionLockCleanup(args: string[], delayMs = 1500) {
  const timeout = setTimeout(() => {
    void cleanupStaleOpenClawSessionLocksForArgs(args, { minAgeMs: 0, onlyCurrentSession: true })
  }, delayMs)
  timeout.unref?.()
}

type AgentRuntimePreflightCheck = {
  id: string
  label: string
  ok: boolean
  severity: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}

function commandCheck(command: string, args: string[], label: string): AgentRuntimePreflightCheck {
  const spec = shelllessSpawnSpecForCommand(command, args)
  const result = spawnSync(spec.command, spec.args, {
    cwd: WORKSPACE_ROOT,
    env: openClawProcessEnv(),
    encoding: 'utf8',
    shell: spec.shell,
    timeout: 5000,
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  })
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}\n${result.error ? String(result.error) : ''}`).trim()
  if (result.status === 0 && !result.error) {
    return {
      id: label.toLowerCase(),
      label,
      ok: true,
      severity: 'info',
      message: `${label} available${output ? ` (${output.split(/\r?\n/)[0]})` : ''}.`,
    }
  }
  return {
    id: label.toLowerCase(),
    label,
    ok: false,
    severity: 'error',
    message: `${label} is not available to the agent runtime process.`,
    detail: output || `${command} ${args.join(' ')} failed`,
  }
}

function selectedModelIdsForAgent(config: OpenClawConfigFile, agentId: string) {
  const entry = (config.agents?.list || []).find((agent) => agent.id === agentId)
  const selection = normalizeModelWithFallback(entry?.model, config.agents?.defaults?.model)
  return uniqueStrings(selection.primary, selection.fallbacks)
}

function selectedModelsUseProvider(config: OpenClawConfigFile, agentId: string, providerId: string) {
  const provider = providerId.trim().toLowerCase()
  return selectedModelIdsForAgent(config, agentId).some((modelId) =>
    splitModelId(canonicalAgentModelId(modelId)).provider.toLowerCase() === provider,
  )
}

async function pluginRuntimeCheck(pluginId: string, label: string): Promise<AgentRuntimePreflightCheck> {
  const controls = await listPluginControls({ forceRefresh: true }).catch((error) => {
    throw new Error(`Plugin list failed: ${String(error)}`)
  })
  const plugin = controls.plugins.find((entry) => entry.id === pluginId)
  if (pluginId === 'codex' && isCodexPluginAvailableForRuntime(plugin)) {
    return {
      id: `plugin:${pluginId}`,
      label,
      ok: true,
      severity: 'info',
      message: `${label} available.`,
    }
  }
  if (plugin && (plugin.enabled || plugin.runtimeLoaded || plugin.status.toLowerCase() === 'loaded')) {
    return {
      id: `plugin:${pluginId}`,
      label,
      ok: true,
      severity: 'info',
      message: `${label} available.`,
    }
  }
  return {
    id: `plugin:${pluginId}`,
    label,
    ok: false,
    severity: 'error',
    message: `${label} is required but is not installed or enabled.`,
    detail: plugin ? JSON.stringify({ status: plugin.status, enabled: plugin.enabled, origin: plugin.origin }) : 'Plugin not listed.',
  }
}

async function buildAgentRuntimePreflightChecks(agentId: string, config: OpenClawConfigFile): Promise<AgentRuntimePreflightCheck[]> {
  const checks: AgentRuntimePreflightCheck[] = [
    commandCheck(process.platform === 'win32' ? 'node.exe' : 'node', ['--version'], 'Node.js'),
    commandCheck(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], 'npm'),
  ]

  if (selectedModelsUseProvider(config, agentId, 'deepseek')) {
    const status = providerAuthStatus('deepseek')
    checks.push({
      id: 'auth:deepseek',
      label: 'DeepSeek auth',
      ok: Boolean(status.configured),
      severity: status.configured ? 'info' : 'error',
      message: status.configured
        ? 'DeepSeek API key is configured.'
        : 'DeepSeek API key is missing. Add it in provider settings or set DEEPSEEK_API_KEY.',
      detail: status.configured ? undefined : `Checked env keys: ${(status.envKeys || []).join(', ') || 'DEEPSEEK_API_KEY'}`,
    })
  }

  const codexRuntimeRequired = openClawConfigNeedsCodexPlugin(config)
  const codexPluginEnabled = isCodexPluginExplicitlyEnabled(config)
  if (codexRuntimeRequired && !codexPluginEnabled) {
    checks.push({
      id: 'plugin:codex',
      label: 'Codex plugin',
      ok: false,
      severity: 'error',
      message: 'Codex runtime is selected, but the Codex plugin is disabled.',
      detail: 'Enable the Codex plugin explicitly or switch the OpenAI provider/model runtime to OpenClaw.',
    })
  } else if (codexPluginEnabled) {
    checks.push(await pluginRuntimeCheck('codex', 'Codex plugin'))
  }

  return checks
}

function runtimePreflightFailureMessage(agentId: string, checks: AgentRuntimePreflightCheck[]) {
  const failures = checks.filter((check) => !check.ok && check.severity === 'error')
  if (!failures.length) return ''
  return [
    `Agent runtime health preflight failed for ${agentId}.`,
    ...failures.map((check) => `${check.label}: ${check.message}${check.detail ? ` ${check.detail}` : ''}`),
  ].join(' ')
}

async function ensureAgentRuntimeHealthPreflight(agentId: string, config?: OpenClawConfigFile) {
  const activeConfig = config || await readOpenclawConfig()
  const checks = await buildAgentRuntimePreflightChecks(agentId, activeConfig)
  const failure = runtimePreflightFailureMessage(agentId, checks)
  if (failure) {
    const error = new Error(failure)
    ;(error as Error & { checks?: AgentRuntimePreflightCheck[] }).checks = checks
    throw error
  }
  return checks
}

async function runOpenClaw(
  args: string[],
  timeoutMs = 120000,
  options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal },
): Promise<OpenClawResult> {
  const runCwd = options?.cwd || WORKSPACE_ROOT
  const trafficGate = licenseService.getTrafficGate()
  if (args[0] === 'agent' && !trafficGate.messageTrafficAllowed) {
    const message = trafficGate.blockMessage || 'Automnia credits are unavailable. Restore the credit balance before sending another message.'
    return { stdout: '', stderr: message, code: 402, failureKind: 'insufficient_credits', elapsedMs: 0 }
  }
  if (args[0] === 'agent' && !trafficGate.localAiAllowed && args.includes('--local')) {
    const message = 'Starter Subscription and credit-refill access cannot use local AI runtime features.'
    return { stdout: '', stderr: message, code: 403, failureKind: 'provider_forbidden', elapsedMs: 0 }
  }
  if (!isOpenClawRuntimeAvailable()) {
    const runRecord = beginOpenClawRun(args, runCwd, timeoutMs)
    const stderr = openClawRuntimeUnavailableMessage()
    finishOpenClawRun(runRecord, 'failed', { stdout: '', stderr, code: 1, failureKind: 'runtime_unavailable' })
    return { stdout: '', stderr, code: 1, controlCenterRunId: runRecord.id, failureKind: 'runtime_unavailable', elapsedMs: 0 }
  }

  if (args[0] === 'agent') {
    await ensureOpenclawAgentRunConfigDefaults()
    await clearDisallowedAutoModelOverridesForAgentArgs(args)
    await cleanupStaleOpenClawSessionLocksForArgs(args)
  }

  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error('openclaw aborted before start'))
      return
    }
    const runRecord = beginOpenClawRun(args, runCwd, timeoutMs)
    const startedAt = Date.now()
    const spawnEnv = openClawProcessEnv(options?.envOverrides || {})
    const spec = openClawSpawnSpec(args)
    const child = spawn(spec.command, spec.args, {
      cwd: runCwd,
      env: spawnEnv,
      shell: spec.shell,
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    })
    updateOpenClawRunPid(runRecord, child.pid)
    let stdout = ''
    let stderr = ''
    let settled = false
    const shouldResolveOnJsonReply = args[0] === 'agent' && args.includes('--json')

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void terminateProcessTree(child.pid, 'openclaw timeout', true)
      scheduleStaleOpenClawSessionLockCleanup(args)
      cleanup()
      finishOpenClawRun(runRecord, 'timeout', { stdout, stderr, code: 1, failureKind: 'timeout' })
      // Give Node a short chance to flush stdout/stderr from a child that did
      // produce a JSON reply but kept handles open past the wrapper timeout.
      setTimeout(() => resolve({
        ...resolveOpenClawTimeoutResult(stdout, stderr, timeoutMs),
        controlCenterRunId: runRecord.id,
        failureKind: 'timeout',
        elapsedMs: Date.now() - startedAt,
        timedOut: true,
      }), 750)
    }, timeoutMs)
    const abort = () => {
      if (settled) return
      settled = true
      void terminateProcessTree(child.pid, 'openclaw aborted', true)
      scheduleStaleOpenClawSessionLockCleanup(args)
      clearTimeout(timeout)
      finishOpenClawRun(runRecord, 'aborted', { stdout, stderr, code: 1, failureKind: 'aborted' })
      reject(new Error('openclaw aborted'))
    }
    options?.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => {
      clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', abort)
    }

    child.stdout.on('data', (chunk) => {
      stdout = appendBoundedRuntimeOutput(stdout, chunk)
      if (!shouldResolveOnJsonReply || settled || !stdoutHasOpenClawReply(stdout)) return
      settled = true
      cleanup()
      void terminateProcessTree(child.pid, 'openclaw json reply complete')
      scheduleStaleOpenClawSessionLockCleanup(args)
      finishOpenClawRun(runRecord, 'completed', { stdout, stderr, code: 0 })
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: 0, controlCenterRunId: runRecord.id, elapsedMs: Date.now() - startedAt })
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendBoundedRuntimeOutput(stderr, chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      const failureKind = classifyFailureKind(`${stderr}\n${String(err)}`, 'failed') || 'process_error'
      finishOpenClawRun(runRecord, 'failed', { stdout, stderr: stderr || String(err), code: 1, failureKind })
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      void cleanupStaleOpenClawSessionLocksForArgs(args, { minAgeMs: 0, onlyCurrentSession: true })
      const exitCode = code ?? 1
      const status = exitCode === 0 ? 'completed' : 'failed'
      const failureKind = status === 'completed' ? undefined : classifyFailureKind(`${stderr}\n${stdout}`, status) || 'unknown'
      finishOpenClawRun(runRecord, status, { stdout, stderr, code: exitCode, failureKind })
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: exitCode, controlCenterRunId: runRecord.id, failureKind, elapsedMs: Date.now() - startedAt })
    })
  })
}

const RATE_LIMIT_REGEX = /\b(rate limit|too many requests|quota|429)\b/i

function isRateLimitText(text: string) {
  return RATE_LIMIT_REGEX.test(text || '')
}

async function runOpenClawWithRetry(
  args: string[],
  timeoutMs = 120000,
  options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal },
): Promise<OpenClawResult> {
  const first = await runOpenClaw(args, timeoutMs, options).catch(openClawErrorResult)
  const combined = `${first.stdout || ''}\n${first.stderr || ''}`
  if (args[0] !== 'agent' || !isRateLimitText(combined)) return first

  await new Promise((resolve) => setTimeout(resolve, 2200))
  return runOpenClaw(args, timeoutMs, options).catch(openClawErrorResult)
}

async function refreshOpenClawPluginRegistry(reason: string): Promise<OpenClawResult> {
  const args = ['plugins', 'registry', '--refresh']
  const result = await runOpenClaw(args, 120_000)
  const warning = pluginCliWarningFromOutput(result, 'openclaw plugins registry --refresh')
  if (result.code !== 0) {
    console.warn(`[plugins] registry refresh failed (${reason}): ${warning || stripAnsi(`${result.stdout}\n${result.stderr}`).trim() || `exit ${result.code}`}`)
  } else if (warning) {
    console.warn(`[plugins] registry refresh warning (${reason}): ${warning}`)
  }
  return result
}

type PluginRegistryRefreshRequest = {
  scheduled: boolean
  detail: string
}

const PLUGIN_REGISTRY_REFRESH_DEBOUNCE_MS = 500
let pluginRegistryRefreshTimer: NodeJS.Timeout | null = null
let pluginRegistryRefreshInFlight: Promise<void> | null = null
let pluginRegistryRefreshRunAgain = false
let pluginRegistryRefreshReasons = new Set<string>()

async function runQueuedPluginRegistryRefresh(): Promise<void> {
  if (pluginRegistryRefreshInFlight) {
    pluginRegistryRefreshRunAgain = true
    await pluginRegistryRefreshInFlight
    return
  }

  pluginRegistryRefreshInFlight = (async () => {
    do {
      pluginRegistryRefreshRunAgain = false
      const reasons = [...pluginRegistryRefreshReasons].join(', ') || 'plugin-change'
      pluginRegistryRefreshReasons = new Set()
      const result = await refreshOpenClawPluginRegistry(reasons)
      if (result.code === 0) {
        await refreshPluginListCache().catch((error) => {
          console.warn('[plugins] plugin list refresh after registry refresh failed:', error)
        })
      }
    } while (pluginRegistryRefreshRunAgain)
  })().finally(() => {
    pluginRegistryRefreshInFlight = null
  })

  await pluginRegistryRefreshInFlight
}

function schedulePluginRegistryRefresh(reason: string): PluginRegistryRefreshRequest {
  pluginRegistryRefreshReasons.add(reason)
  if (pluginRegistryRefreshTimer) clearTimeout(pluginRegistryRefreshTimer)
  pluginRegistryRefreshTimer = setTimeout(() => {
    pluginRegistryRefreshTimer = null
    void runQueuedPluginRegistryRefresh().catch((error) => {
      console.warn('[plugins] queued registry refresh failed:', error)
    })
  }, PLUGIN_REGISTRY_REFRESH_DEBOUNCE_MS)
  pluginRegistryRefreshTimer.unref?.()

  return {
    scheduled: true,
    detail: `plugin registry refresh queued in ${PLUGIN_REGISTRY_REFRESH_DEBOUNCE_MS}ms`,
  }
}

type StreamingProviderKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'gemini-vertex-generate-content'

type StreamingProviderConfig = {
  kind: StreamingProviderKind
  envKeys: string[]
  endpoint?: string
  docs: string
}

type StreamEmitter = (event: string, data: Record<string, unknown>) => void

const SSE_DELTA_CHUNK_CHARS = 16_000
const SSE_FINAL_TEXT_LIMIT = 24_000
const DIRECT_PROVIDER_REQUEST_TIMEOUT_MS = (() => {
  const configured = Number(process.env.AUTOMNIA_DIRECT_PROVIDER_REQUEST_TIMEOUT_MS || 300_000)
  return Number.isFinite(configured)
    ? Math.max(30_000, Math.min(1_800_000, Math.round(configured)))
    : 300_000
})()

function directProviderRequestSignal(parent?: AbortSignal) {
  const deadline = AbortSignal.timeout(DIRECT_PROVIDER_REQUEST_TIMEOUT_MS)
  return parent ? AbortSignal.any([parent, deadline]) : deadline
}

const STREAMING_PROVIDER_CONFIG: Record<string, StreamingProviderConfig> = {
  deepseek: {
    kind: 'openai-compatible',
    envKeys: ['DEEPSEEK_API_KEY'],
    endpoint: 'https://api.deepseek.com/chat/completions',
    docs: 'https://api-docs.deepseek.com/api/create-chat-completion',
  },
  openai: {
    kind: 'openai-responses',
    envKeys: ['OPENAI_API_KEY'],
    endpoint: 'https://api.openai.com/v1/responses',
    docs: 'https://developers.openai.com/api/docs/guides/streaming-responses',
  },
  'openai-codex': {
    kind: 'openai-codex-responses',
    envKeys: [],
    endpoint: 'https://api.openai.com/v1/responses',
    docs: 'https://developers.openai.com/api/docs/guides/streaming-responses',
  },
  anthropic: {
    kind: 'anthropic-messages',
    envKeys: ['ANTHROPIC_API_KEY'],
    endpoint: 'https://api.anthropic.com/v1/messages',
    docs: 'https://platform.claude.com/docs/en/build-with-claude/streaming',
  },
  google: {
    kind: 'gemini-generate-content',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    docs: 'https://ai.google.dev/api/generate-content',
  },
  'google-vertex': {
    kind: 'gemini-vertex-generate-content',
    envKeys: GOOGLE_VERTEX_ACCESS_TOKEN_KEYS,
    docs: 'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini',
  },
}

function streamingCapabilityForModel(modelId: string) {
  const canonicalModelId = canonicalAgentModelId(modelId)
  if (isOpenAiCodexSubscriptionModel(canonicalModelId)) {
    const openAiAuth = AUTH_PROVIDER_CATALOG.openai
    const oauthConfigured = isOAuthCredentialUsable(providerAuthService.getLocalProviderOAuth('openai'))
    const openAiApiConfigured = isProviderConfigured('openai')
    return {
      supported: true,
      provider: 'openai',
      transport: oauthConfigured ? 'openai-codex-responses' : 'openai-responses',
      requires: oauthConfigured || openAiApiConfigured ? [] as string[] : ['OpenAI Codex OAuth or OPENAI_API_KEY'],
      docs: openAiAuth?.docs,
    }
  }

  const { provider } = splitModelId(canonicalModelId)
  const config = STREAMING_PROVIDER_CONFIG[provider]
  return {
    supported: Boolean(config),
    provider,
    transport: config?.kind || 'buffered-openclaw',
    requires: config?.envKeys || [],
    docs: config?.docs,
  }
}

function openClawConfigEnvValues(config: OpenClawConfigFile) {
  const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env)
    ? config.env as Record<string, unknown>
    : {}
  const vars = env.vars && typeof env.vars === 'object' && !Array.isArray(env.vars)
    ? env.vars as Record<string, unknown>
    : {}
  return { ...env, ...vars }
}

function openClawDistModulePathByPrefix(prefix: string) {
  for (const distDir of openClawDistDirCandidates()) {
    if (!existsSync(distDir)) continue
    const candidates = readdirSync(distDir)
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.js'))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    const match = candidates[0]
    if (match) return path.join(distDir, match)
  }
  throw new Error(`Could not find OpenClaw dist module matching ${prefix}*.js`)
}

function openClawDistDirCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  const binDir = openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : ''
  return uniqueStrings(
    binDir ? path.join(binDir, 'dist') : '',
    binDir,
    path.resolve(process.cwd(), 'vendor', 'openclaw', 'dist'),
    path.resolve(process.cwd(), 'resources', 'openclaw', 'dist'),
    electronResourcesPath ? path.join(electronResourcesPath, 'openclaw', 'dist') : '',
    path.join(WORKSPACE_ROOT, 'vendor', 'openclaw', 'dist'),
  ).filter(Boolean)
}

async function resolveOpenAiSubscriptionRequestAuth(env: Record<string, string>) {
  const openAiProviderConfig = STREAMING_PROVIDER_CONFIG.openai
  const preferredMode = getLocalProviderMode('openai')
  if (preferredMode !== 'apiKey') {
    const codexOAuth = await resolveOpenAICodexOAuthForRequest().catch(() => null)
    if (codexOAuth?.accessToken) {
      return {
        provider: 'openai',
        providerConfig: openAiProviderConfig,
        requestAuth: { type: 'oauth', accessToken: codexOAuth.accessToken, source: 'local-openai-codex-oauth' } as ProviderRequestAuth,
      }
    }
  }

  const openAiApiAuth = await resolveProviderRequestAuth('openai', env, openAiProviderConfig.envKeys)
  if (openAiApiAuth) {
    return {
      provider: 'openai',
      providerConfig: openAiProviderConfig,
      requestAuth: openAiApiAuth,
    }
  }

  const codexOAuth = await resolveOpenAICodexOAuthForRequest().catch(() => null)
  if (codexOAuth?.accessToken) {
    return {
      provider: 'openai',
      providerConfig: openAiProviderConfig,
      requestAuth: { type: 'oauth', accessToken: codexOAuth.accessToken, source: 'local-openai-codex-oauth' } as ProviderRequestAuth,
    }
  }
  return {
    provider: 'openai',
    providerConfig: openAiProviderConfig,
    requestAuth: null,
  }
}

async function openExternalAuthUrl(url: string) {
  if (process.platform === 'win32') return spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url])
  if (process.platform === 'darwin') return spawnDetached('open', [url])
  return spawnDetached('xdg-open', [url])
}

function writeSseEvent(res: { write: (chunk: string) => unknown }, event: string, data: Record<string, unknown>) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function splitTextForSse(text: string, chunkSize = SSE_DELTA_CHUNK_CHARS) {
  const chunks: string[] = []
  for (let index = 0; index < text.length;) {
    let end = Math.min(index + chunkSize, text.length)
    const lastCode = text.charCodeAt(end - 1)
    if (end < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1
    chunks.push(text.slice(index, end))
    index = end
  }
  return chunks.length ? chunks : ['']
}

function compactSseText(value: string, liveTextStreamed: boolean, field = '') {
  if (liveTextStreamed && field !== 'reply') return ''
  return value.length > SSE_FINAL_TEXT_LIMIT ? `${value.slice(0, SSE_FINAL_TEXT_LIMIT).trimEnd()}\n\n[Response truncated in final SSE metadata; streamed text was already delivered.]` : value
}

function compactFinalSsePayload(payload: Record<string, unknown>, liveTextStreamed: boolean): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload }
  const truncatedFields: string[] = []
  const sanitizedFields: string[] = []

  for (const field of ['reply', 'stdout', 'stderr', 'error', 'detail']) {
    const value = next[field]
    if (typeof value !== 'string') continue
    const visible = field === 'reply' || field === 'error' || field === 'detail'
      ? sanitizeUserVisibleRuntimeText(value) || (field === 'reply' ? 'No response returned.' : '')
      : value
    if (visible !== value) sanitizedFields.push(field)
    const compacted = compactSseText(visible, liveTextStreamed, field)
    if (compacted !== value) truncatedFields.push(field)
    next[field] = compacted
  }

  if (sanitizedFields.length) {
    next.runtimeLogsFiltered = true
    next.runtimeLogsFilteredFields = sanitizedFields
  }

  if (truncatedFields.length) {
    next.sseCompacted = true
    next.sseCompactedFields = truncatedFields
  }

  return next
}

function compactHttpJsonPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload }
  const compactedFields: string[] = []
  const sanitizedFields: string[] = []

  for (const field of ['reply', 'stdout', 'stderr', 'error', 'detail']) {
    const value = next[field]
    if (typeof value !== 'string') continue
    const visible = field === 'reply' || field === 'error' || field === 'detail'
      ? sanitizeUserVisibleRuntimeText(value) || (field === 'reply' ? 'No response returned.' : '')
      : value
    if (visible !== value) sanitizedFields.push(field)
    if (visible.length > SSE_FINAL_TEXT_LIMIT) {
      next[field] = `${visible.slice(0, SSE_FINAL_TEXT_LIMIT).trimEnd()}\n\n[Response truncated for HTTP payload.]`
      compactedFields.push(field)
    } else {
      next[field] = visible
    }
  }

  if (sanitizedFields.length) {
    next.runtimeLogsFiltered = true
    next.runtimeLogsFilteredFields = sanitizedFields
  }

  if (compactedFields.length) {
    next.compacted = true
    next.compactedFields = compactedFields
  }

  return next
}

function initializeSseResponse(res: {
  writeHead: (status: number, headers: Record<string, string>) => unknown
  write: (chunk: string) => unknown
  flushHeaders?: () => void
}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')
  res.flushHeaders?.()
}

const CLAWTALK_CONSOLE_EVENT_LIMIT = 200

type ClawTalkConsoleMirrorContext = {
  clawTalkRunId: string
  agentId: string
  sessionKey: string
  prompt: string
  terminalEmitted?: boolean
  updatedAt?: number
}

const clawTalkConsoleEvents: Array<Record<string, unknown>> = []
const clawTalkConsoleClients = new Map<string, { write: (chunk: string) => unknown; closed: boolean }>()
const clawTalkConsoleMirrorsBySessionKey = new Map<string, ClawTalkConsoleMirrorContext>()
const CLAWTALK_CONSOLE_MIRROR_TTL_MS = 10 * 60 * 1000

function compactClawTalkConsoleValue(value: string, maxChars = SSE_FINAL_TEXT_LIMIT) {
  const visible = redactHiddenReasoningAndSecrets(sanitizeUserVisibleRuntimeText(value))
  return visible.length > maxChars ? `${visible.slice(0, maxChars).trimEnd()}\n\n[ClawTalk console event truncated.]` : visible
}

function normalizeClawTalkConsoleFrame(event: string, context: ClawTalkConsoleMirrorContext, data: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {
    ...data,
    id: randomUUID(),
    source: 'clawtalk',
    event,
    clawTalkRunId: context.clawTalkRunId,
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    prompt: context.prompt,
    timestamp: new Date().toISOString(),
    transport: typeof data.transport === 'string' && data.transport.trim() ? data.transport : 'clawtalk-control-center',
  }
  for (const field of ['text', 'reply', 'message', 'error', 'detail']) {
    const value = normalized[field]
    if (typeof value === 'string') normalized[field] = compactClawTalkConsoleValue(value)
  }
  return normalized
}

function cleanupClawTalkConsoleMirrors() {
  const cutoff = Date.now() - CLAWTALK_CONSOLE_MIRROR_TTL_MS
  for (const [key, context] of clawTalkConsoleMirrorsBySessionKey) {
    if ((context.updatedAt || 0) < cutoff) clawTalkConsoleMirrorsBySessionKey.delete(key)
  }
}

function rememberClawTalkConsoleMirror(context: ClawTalkConsoleMirrorContext) {
  context.updatedAt = Date.now()
  cleanupClawTalkConsoleMirrors()
  clawTalkConsoleMirrorsBySessionKey.set(context.sessionKey, context)
}

function resolveClawTalkConsoleMirrorContext(input: { agentId: string; sessionKey: string; prompt?: string }) {
  cleanupClawTalkConsoleMirrors()
  const existing = clawTalkConsoleMirrorsBySessionKey.get(input.sessionKey)
  if (existing) {
    existing.updatedAt = Date.now()
    if (input.prompt?.trim()) existing.prompt = input.prompt.trim()
    return existing
  }

  const context: ClawTalkConsoleMirrorContext = {
    clawTalkRunId: randomUUID(),
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    prompt: input.prompt?.trim() || 'ClawTalk message',
    updatedAt: Date.now(),
  }
  clawTalkConsoleMirrorsBySessionKey.set(input.sessionKey, context)
  return context
}

function emitClawTalkConsoleFrame(event: string, context: ClawTalkConsoleMirrorContext, data: Record<string, unknown>) {
  const finalOverride = event === 'final' &&
    context.terminalEmitted &&
    data.consoleBridgeFinal === true &&
    data.ok !== false &&
    typeof (data.reply || data.text) === 'string' &&
    String(data.reply || data.text).trim().length > 0
  if (event === 'final' && context.terminalEmitted && !finalOverride) return false
  context.updatedAt = Date.now()
  const payload = normalizeClawTalkConsoleFrame(event, context, data)
  if (event === 'final') context.terminalEmitted = true
  clawTalkConsoleEvents.unshift(payload)
  if (clawTalkConsoleEvents.length > CLAWTALK_CONSOLE_EVENT_LIMIT) {
    clawTalkConsoleEvents.length = CLAWTALK_CONSOLE_EVENT_LIMIT
  }
  for (const [id, client] of clawTalkConsoleClients) {
    if (client.closed) {
      clawTalkConsoleClients.delete(id)
      continue
    }
    try {
      writeSseEvent(client, event, payload)
    } catch {
      client.closed = true
      clawTalkConsoleClients.delete(id)
    }
  }
  return true
}

function parseSseFrames(buffer: string): { frames: Array<{ event?: string; data: string }>; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: Array<{ event?: string; data: string }> = []
  let cursor = 0
  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break
    const rawFrame = normalized.slice(cursor, boundary)
    cursor = boundary + 2
    const dataLines: string[] = []
    let event: string | undefined
    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest: normalized.slice(cursor) }
}

async function readUpstreamSse(
  response: globalThis.Response,
  onFrame: (frame: { event?: string; data: string }) => void | false,
) {
  if (!response.body) throw new Error('Streaming response did not include a body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (buffer.length > UPSTREAM_SSE_BUFFER_LIMIT_CHARS) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`Streaming response frame exceeded ${UPSTREAM_SSE_BUFFER_LIMIT_CHARS} chars without an SSE boundary.`)
    }
    const parsed = parseSseFrames(buffer)
    buffer = parsed.rest
    for (const frame of parsed.frames) {
      if (onFrame(frame) === false) {
        await reader.cancel().catch(() => undefined)
        return
      }
    }
  }
  buffer += decoder.decode()
  const parsed = parseSseFrames(`${buffer}\n\n`)
  for (const frame of parsed.frames) {
    if (onFrame(frame) === false) return
  }
}

async function assertUpstreamOk(response: globalThis.Response, provider: string) {
  if (response.ok) return
  const detail = await response.text().catch(() => '')
  throw new Error(`${provider} streaming request failed (${response.status}): ${trimTask(detail || response.statusText, 600)}`)
}

function effortForThinking(thinking: Exclude<ThinkingLevel, 'off'>): 'low' | 'medium' | 'high' {
  if (thinking === 'high' || thinking === 'xhigh' || thinking === 'max') return 'high'
  if (thinking === 'medium') return 'medium'
  return 'low'
}

function deepSeekThinkingPatch(thinking: ThinkingLevel) {
  if (thinking === 'high' || thinking === 'xhigh' || thinking === 'max') return { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
  if (thinking === 'medium') return { thinking: { type: 'enabled' }, reasoning_effort: 'medium' }
  if (thinking === 'minimal' || thinking === 'low') return { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
  return { thinking: { type: 'disabled' } }
}

function isOpenAiReasoningModel(model: string) {
  const normalized = model.toLowerCase()
  return /^(gpt-5|o[1-9]|gpt-oss)/.test(normalized)
}

function parsedOpenAiGpt5Minor(model: string): number | null {
  const match = model.toLowerCase().match(/^gpt-5(?:\.(\d+))?/)
  if (!match) return null
  return match[1] ? Number(match[1]) : 0
}

function openAiSupportsReasoningNone(model: string) {
  const minor = parsedOpenAiGpt5Minor(model)
  return minor !== null && minor >= 1
}

function openAiSupportsMinimalReasoning(model: string) {
  const minor = parsedOpenAiGpt5Minor(model)
  return minor !== null && minor >= 2
}

function openAiReasoningPatch(model: string, thinking: ThinkingLevel) {
  if (!isOpenAiReasoningModel(model)) return {}
  if (thinking === 'off') {
    return openAiSupportsReasoningNone(model) ? { reasoning_effort: 'none' } : {}
  }
  if (thinking === 'minimal') {
    return { reasoning_effort: openAiSupportsMinimalReasoning(model) ? 'minimal' : 'low' }
  }
  return { reasoning_effort: thinking }
}

function openAiResponsesReasoningPatch(model: string, thinking: ThinkingLevel) {
  if (!isOpenAiReasoningModel(model)) return {}
  if (thinking === 'off') {
    return openAiSupportsReasoningNone(model) ? { reasoning: { effort: 'none' } } : {}
  }
  if (thinking === 'minimal') {
    return { reasoning: { effort: openAiSupportsMinimalReasoning(model) ? 'minimal' : 'low' } }
  }
  return { reasoning: { effort: thinking } }
}

function openAiCompatibleThinkingPatch(provider: string, model: string, thinking: ThinkingLevel) {
  if (provider === 'deepseek') return deepSeekThinkingPatch(thinking)
  if (provider === 'openai') return openAiReasoningPatch(model, thinking)
  return {}
}

function toOpenAiCompatibleMessages(provider: string, messages: ProviderConversationMessage[]) {
  return messages.map((message) => {
    const payload: Record<string, string> = {
      role: message.role,
      content: message.content,
    }
    if (provider === 'deepseek' && message.role === 'assistant' && message.reasoningContent) {
      payload.reasoning_content = message.reasoningContent
    }
    return payload
  })
}

function toOpenAiResponsesInput(messages: ProviderConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function textFromOpenAiResponsesResponse(response: unknown) {
  if (!isLooseRecord(response) || !Array.isArray(response.output)) return ''
  const parts: string[] = []
  for (const item of response.output) {
    if (!isLooseRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isLooseRecord(content)) continue
      const type = typeof content.type === 'string' ? content.type : ''
      const text = typeof content.text === 'string' ? content.text : ''
      if (text && (type === 'output_text' || type === 'text')) parts.push(text)
    }
  }
  return parts.join('')
}

function openAiResponsesStreamErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const errorMessage = (error: unknown) => {
    if (typeof error === 'string' && error.trim()) return error.trim()
    if (!isLooseRecord(error)) return ''
    const message = typeof error.message === 'string' ? error.message.trim() : ''
    if (message) return message
    const code = typeof error.code === 'string' ? error.code.trim() : ''
    const type = typeof error.type === 'string' ? error.type.trim() : ''
    return [type, code].filter(Boolean).join(': ')
  }

  const error = payload.error
  const topLevelError = errorMessage(error)
  if (topLevelError) return topLevelError

  const response = payload.response
  const responseError = isLooseRecord(response) ? errorMessage(response.error) : ''
  if (responseError) return responseError

  const message = typeof payload.message === 'string' ? payload.message.trim() : ''
  return message || fallback
}

function toAnthropicMessages(messages: ProviderConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function toGeminiContents(messages: ProviderConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
}

function anthropicSupportsAdaptiveThinking(model: string) {
  const normalized = model.toLowerCase()
  return (
    /claude-opus-4-(6|7|8)\b/.test(normalized) ||
    /claude-sonnet-4-6\b/.test(normalized) ||
    /claude-mythos/.test(normalized) ||
    /claude-(?:opus|sonnet|fable)-5\b/.test(normalized)
  )
}

function anthropicSupportsEffort(model: string) {
  const normalized = model.toLowerCase()
  return (
    anthropicSupportsAdaptiveThinking(model) ||
    /claude-opus-4-5\b/.test(normalized)
  )
}

function anthropicSupportsManualThinking(model: string) {
  const normalized = model.toLowerCase()
  if (/claude-opus-4-(7|8)\b/.test(normalized) || /claude-(?:opus|sonnet|fable|mythos)-5\b/.test(normalized)) return false
  return /claude-(sonnet-3-7|sonnet-4|opus-4|haiku-4-5)\b/.test(normalized)
}

function anthropicThinkingBudget(thinking: Exclude<ThinkingLevel, 'off'>) {
  if (thinking === 'high' || thinking === 'xhigh' || thinking === 'max') return 4096
  if (thinking === 'medium') return 2048
  return 1024
}

function anthropicMaxTokens(thinking: ThinkingLevel) {
  if (thinking === 'max') return 16384
  if (thinking === 'xhigh') return 12288
  if (thinking === 'high') return 8192
  if (thinking === 'medium') return 6144
  return 4096
}

function anthropicReasoningPatch(model: string, thinking: ThinkingLevel) {
  if (thinking === 'off') return {}

  const effort = effortForThinking(thinking)
  const patch: Record<string, unknown> = {}
  if (anthropicSupportsEffort(model)) {
    patch.output_config = { effort }
  }
  if (anthropicSupportsAdaptiveThinking(model)) {
    patch.thinking = { type: 'adaptive' }
  } else if (anthropicSupportsManualThinking(model)) {
    patch.thinking = { type: 'enabled', budget_tokens: anthropicThinkingBudget(thinking) }
  }
  return patch
}

function geminiThinkingBudget(model: string, thinking: ThinkingLevel) {
  const normalized = model.toLowerCase()
  const isPro = /gemini-2\.5-pro/.test(normalized)
  if (thinking === 'off' || thinking === 'minimal') return isPro ? 128 : 0
  if (thinking === 'high' || thinking === 'xhigh' || thinking === 'max') return 8192
  if (thinking === 'medium') return 4096
  return 1024
}

function geminiThinkingConfig(model: string, thinking: ThinkingLevel) {
  const normalized = model.toLowerCase()
  if (/gemini-2\.5/.test(normalized)) {
    return { thinkingBudget: geminiThinkingBudget(model, thinking) }
  }
  const effectiveThinking = googleGeminiThinkingForModel(model, thinking)
  const nativeThinking = effectiveThinking === 'xhigh' || effectiveThinking === 'max' ? 'high' : effectiveThinking
  if (/gemini-3(?:\.\d+)?-flash/.test(normalized)) {
    return { thinkingLevel: nativeThinking === 'off' ? 'minimal' : nativeThinking }
  }
  if (/gemini-(3|4|5)/.test(normalized)) {
    return { thinkingLevel: nativeThinking === 'off' ? 'minimal' : nativeThinking }
  }
  return undefined
}

/**
 * Gemini 3.6 and 3.7 Flash reject deprecated custom sampling parameters in
 * the current Gemini generation contract. The usual streaming path already
 * omits them; this guard keeps the direct Vertex artifact fallback aligned
 * with that same request contract.
 */
function geminiDisallowsCustomSampling(model: string) {
  return googleGeminiModelDisallowsCustomSampling(model)
}

async function streamOpenAiCompatibleCompletion(params: {
  provider: string
  model: string
  endpoint: string
  apiKey: string
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  signal: AbortSignal
  emit: StreamEmitter
}) {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: toOpenAiCompatibleMessages(params.provider, params.messages),
    stream: true,
  }
  Object.assign(body, openAiCompatibleThinkingPatch(params.provider, params.model, params.thinking))
  const upstream = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: directProviderRequestSignal(params.signal),
  })
  await assertUpstreamOk(upstream, params.provider)
  let reply = ''
  let reasoningContent = ''
  await readUpstreamSse(upstream, (frame) => {
    if (frame.data === '[DONE]') return
    try {
      const payload = JSON.parse(frame.data) as {
        choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>
      }
      const reasoning = payload.choices?.[0]?.delta?.reasoning_content || ''
      if (reasoning) reasoningContent += reasoning
      const text = payload.choices?.[0]?.delta?.content || ''
      if (!text) return
      reply += text
      params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
    } catch {
      // Ignore malformed upstream frames; provider streams can include keepalive noise.
    }
  })
  return { content: reply, reasoningContent: reasoningContent || undefined }
}

async function streamOpenAiResponsesCompletion(params: {
  provider: string
  model: string
  endpoint: string
  apiKey: string
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  signal: AbortSignal
  emit: StreamEmitter
}) {
  const body: Record<string, unknown> = {
    model: params.model,
    input: toOpenAiResponsesInput(params.messages),
    stream: true,
    store: false,
  }
  Object.assign(body, openAiResponsesReasoningPatch(params.model, params.thinking))
  const upstream = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: directProviderRequestSignal(params.signal),
  })
  await assertUpstreamOk(upstream, params.provider)

  let reply = ''
  let finalText = ''
  let reasoningContent = ''
  let completedResponse: unknown
  await readUpstreamSse(upstream, (frame) => {
    if (frame.data === '[DONE]') return
    let payload: unknown
    try {
      payload = JSON.parse(frame.data) as unknown
    } catch {
      return
    }
    if (!isLooseRecord(payload)) return

    const type = typeof payload.type === 'string' ? payload.type : frame.event || ''
    if (type === 'response.output_text.delta') {
      const text = typeof payload.delta === 'string' ? payload.delta : ''
      if (!text) return
      reply += text
      params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
      return
    }
    if (type === 'response.output_text.done') {
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (text) finalText = text
      return
    }
    if (type === 'response.refusal.delta') {
      const text = typeof payload.delta === 'string' ? payload.delta : ''
      if (!text) return
      reply += text
      params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
      return
    }
    if (type === 'response.refusal.done') {
      const text = typeof payload.refusal === 'string' ? payload.refusal : ''
      if (text) finalText = text
      return
    }
    if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
      const text = typeof payload.delta === 'string' ? payload.delta : ''
      if (text) reasoningContent += text
      return
    }
    if (type === 'response.completed') {
      completedResponse = payload.response
      return
    }
    if (type === 'response.failed' || type === 'error') {
      throw new Error(openAiResponsesStreamErrorMessage(payload, 'OpenAI Responses streaming failed.'))
    }
  })

  const finalReply = reply || finalText || textFromOpenAiResponsesResponse(completedResponse)
  return { content: finalReply, reasoningContent: reasoningContent || undefined }
}

type OpenAICodexModel = {
  id: string
  name: string
  api: 'openai-chatgpt-responses'
  provider: 'openai'
  baseUrl: string
  reasoning: boolean
  input: string[]
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  contextWindow: number
  maxTokens: number
  headers?: Record<string, string>
  thinkingLevelMap?: Record<string, string | null>
}

type PiAiAssistantMessage = {
  content?: Array<{ type?: string; text?: string; thinking?: string }>
  errorMessage?: string
}

type PiAiAssistantMessageEvent = {
  type: string
  delta?: string
  content?: string
  message?: PiAiAssistantMessage
  error?: PiAiAssistantMessage
}

function fallbackOpenAICodexModel(model: string): OpenAICodexModel {
  return {
    id: model,
    name: model,
    api: 'openai-chatgpt-responses',
    provider: 'openai',
    baseUrl: 'https://chatgpt.com/backend-api',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
  }
}

async function resolveOpenAICodexModel(model: string): Promise<OpenAICodexModel> {
  return fallbackOpenAICodexModel(model)
}

function toOpenAICodexContext(
  provider: string,
  model: string,
  messages: ProviderConversationMessage[],
) {
  const now = Date.now()
  return {
    systemPrompt: [
      'You are a Automnia direct streaming agent.',
      'Answer the user directly and concisely.',
      'This direct streaming path has no filesystem, terminal, browser, or app-control tools.',
      'If the request requires tools or workspace edits, state the specific missing tool action without telling the user to send a slash command.',
    ].join('\n'),
    messages: messages.map((message, index) => {
      const timestamp = now - (messages.length - index)
      if (message.role === 'user') {
        return {
          role: 'user',
          content: message.content,
          timestamp,
        }
      }
      return {
        role: 'assistant',
        content: [{ type: 'text', text: message.content }],
        api: 'openai-chatgpt-responses',
        provider,
        model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp,
      }
    }),
  }
}

function openAICodexReasoningEffort(thinking: ThinkingLevel): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (thinking === 'off') return 'none'
  return thinking
}

function textFromPiAiAssistantMessage(message?: PiAiAssistantMessage) {
  return (message?.content || [])
    .map((block) => (block.type === 'text' ? block.text || '' : ''))
    .filter(Boolean)
    .join('')
}

function reasoningFromPiAiAssistantMessage(message?: PiAiAssistantMessage) {
  return (message?.content || [])
    .map((block) => (block.type === 'thinking' ? block.thinking || '' : ''))
    .filter(Boolean)
    .join('\n\n')
}

async function streamOpenAICodexResponsesCompletion(params: {
  model: string
  accessToken: string
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  sessionId: string
  signal: AbortSignal
  emit: StreamEmitter
}) {
  const providerPath = openClawDistModulePathByPrefix('openai-chatgpt-responses-')
  const providerModule = await import(pathToFileURL(providerPath).href) as {
    streamOpenAICodexResponses: (
      model: OpenAICodexModel,
      context: ReturnType<typeof toOpenAICodexContext>,
      options: Record<string, unknown>,
    ) => AsyncIterable<PiAiAssistantMessageEvent>
  }
  const codexModel = await resolveOpenAICodexModel(params.model)
  const context = toOpenAICodexContext('openai', params.model, params.messages)
  const stream = providerModule.streamOpenAICodexResponses(codexModel, context, {
    apiKey: params.accessToken,
    signal: directProviderRequestSignal(params.signal),
    sessionId: params.sessionId,
    transport: 'sse',
    reasoningEffort: openAICodexReasoningEffort(params.thinking),
    reasoningSummary: 'auto',
    textVerbosity: 'low',
  })

  let reply = ''
  let finalMessage: PiAiAssistantMessage | undefined
  for await (const event of stream) {
    if (params.signal.aborted) throw new Error('Request was aborted')
    if (event.type === 'text_delta') {
      const text = event.delta || ''
      if (!text) continue
      reply += text
      params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
    } else if (event.type === 'done') {
      finalMessage = event.message
    } else if (event.type === 'error') {
      throw new Error(event.error?.errorMessage || 'OpenAI Codex streaming failed.')
    }
  }

  const finalReply = reply || textFromPiAiAssistantMessage(finalMessage)
  return {
    content: finalReply,
    reasoningContent: reasoningFromPiAiAssistantMessage(finalMessage) || undefined,
  }
}

async function streamAnthropicMessage(params: {
  model: string
  auth: ProviderRequestAuth
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  signal: AbortSignal
  emit: StreamEmitter
}) {
  const body = {
    model: params.model,
    max_tokens: anthropicMaxTokens(params.thinking),
    messages: toAnthropicMessages(params.messages),
    stream: true,
    ...anthropicReasoningPatch(params.model, params.thinking),
  }
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...(params.auth.type === 'apiKey'
        ? { 'x-api-key': params.auth.value }
        : {
            Authorization: `Bearer ${params.auth.accessToken}`,
            'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
            'anthropic-dangerous-direct-browser-access': 'true',
            'x-app': 'cli',
          }),
    },
    body: JSON.stringify(body),
    signal: directProviderRequestSignal(params.signal),
  })
  await assertUpstreamOk(upstream, 'anthropic')
  let reply = ''
  await readUpstreamSse(upstream, (frame) => {
    try {
      const payload = JSON.parse(frame.data) as {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
      }
      if (payload.type !== 'content_block_delta' || payload.delta?.type !== 'text_delta') return
      const text = payload.delta.text || ''
      if (!text) return
      reply += text
      params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
    } catch {
      // Ignore ping and unknown event frames.
    }
  })
  return { content: reply }
}

async function streamGeminiContent(params: {
  model: string
  auth: ProviderRequestAuth
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  signal: AbortSignal
  emit: StreamEmitter
}) {
  const modelPath = params.model.startsWith('models/') ? params.model : `models/${params.model}`
  const thinkingConfig = geminiThinkingConfig(params.model, params.thinking)
  const body: Record<string, unknown> = {
    contents: toGeminiContents(params.messages),
  }
  if (thinkingConfig) {
    body.generationConfig = {
      thinkingConfig,
    }
  }
  const query = new URLSearchParams({ alt: 'sse' })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (params.auth.type === 'apiKey') {
    query.set('key', params.auth.value)
  } else {
    headers.Authorization = `Bearer ${params.auth.accessToken}`
    if (params.auth.projectId) headers['x-goog-user-project'] = params.auth.projectId
  }
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:streamGenerateContent?${query.toString()}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: directProviderRequestSignal(params.signal),
    },
  )
  await assertUpstreamOk(upstream, 'google')
  let reply = ''
  await readUpstreamSse(upstream, (frame) => {
    try {
      const payload = JSON.parse(frame.data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      }
      const finishReason = payload.candidates?.[0]?.finishReason
      const text = (payload.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || '')
        .filter(Boolean)
        .join('')
      if (text) {
        reply += text
        params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
      }
      if (finishReason) return false
    } catch {
      // Ignore malformed upstream frames.
    }
  })
  return { content: reply }
}

function googleVertexBaseUrl(location: string) {
  return location === 'global'
    ? 'https://aiplatform.googleapis.com/v1'
    : `https://${location}-aiplatform.googleapis.com/v1`
}

function googleVertexModelName(model: string) {
  return model
    .replace(/^publishers\/google\/models\//i, '')
    .replace(/^models\//i, '')
    .trim()
}

type GoogleVertexOauthAuth = Extract<ProviderRequestAuth, { type: 'oauth' }>

type GoogleVertexModelAvailability = {
  ok: boolean
  status: number
  location: string
  detail?: string
}

const googleVertexModelAvailabilityCache = new Map<string, { value: GoogleVertexModelAvailability; expiresAt: number }>()
const MAX_GOOGLE_VERTEX_AVAILABILITY_CACHE_ENTRIES = 256

function pruneGoogleVertexModelAvailabilityCache(now = Date.now()) {
  for (const [key, entry] of googleVertexModelAvailabilityCache) {
    if (entry.expiresAt <= now) googleVertexModelAvailabilityCache.delete(key)
  }
  if (googleVertexModelAvailabilityCache.size <= MAX_GOOGLE_VERTEX_AVAILABILITY_CACHE_ENTRIES) return
  const oldest = Array.from(googleVertexModelAvailabilityCache.entries())
    .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
  for (const [key] of oldest.slice(0, googleVertexModelAvailabilityCache.size - MAX_GOOGLE_VERTEX_AVAILABILITY_CACHE_ENTRIES)) {
    googleVertexModelAvailabilityCache.delete(key)
  }
}

function normalizeGoogleVertexLocation(location?: string) {
  return location?.trim() || GOOGLE_VERTEX_DEFAULT_LOCATION
}

function googleVertexCandidateLocations(location?: string) {
  const preferred = normalizeGoogleVertexLocation(location)
  return Array.from(new Set([preferred, GOOGLE_VERTEX_GLOBAL_LOCATION].filter(Boolean)))
}

function googleVertexModelMethodEndpoint(
  projectId: string,
  location: string,
  modelName: string,
  method: 'countTokens' | 'generateContent' | 'streamGenerateContent',
) {
  const encodedModel = encodeURIComponent(modelName).replace(/%40/g, '@')
  return [
    googleVertexBaseUrl(location),
    `projects/${encodeURIComponent(projectId)}`,
    `locations/${encodeURIComponent(location)}`,
    'publishers/google',
    `models/${encodedModel}:${method}`,
  ].join('/')
}

function googleVertexAvailabilityCacheKey(projectId: string, location: string, modelName: string) {
  return [projectId, location, modelName].join('\u0000')
}

async function checkGoogleVertexModelAvailability(params: {
  auth: GoogleVertexOauthAuth
  modelName: string
  location: string
  signal?: AbortSignal
}): Promise<GoogleVertexModelAvailability> {
  const projectId = params.auth.projectId?.trim()
  if (!projectId) {
    return {
      ok: false,
      status: 0,
      location: params.location,
      detail: 'Google Vertex requires a configured Google Cloud project.',
    }
  }

  const cacheKey = googleVertexAvailabilityCacheKey(projectId, params.location, params.modelName)
  pruneGoogleVertexModelAvailabilityCache()
  const cached = googleVertexModelAvailabilityCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const response = await fetch(googleVertexModelMethodEndpoint(projectId, params.location, params.modelName, 'countTokens'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.auth.accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    }),
    signal: directProviderRequestSignal(params.signal),
  })
  const detail = response.ok ? '' : await response.text().catch(() => '')
  const value: GoogleVertexModelAvailability = {
    ok: response.ok,
    status: response.status,
    location: params.location,
    ...(detail ? { detail: trimTask(detail, 400) } : {}),
  }
  googleVertexModelAvailabilityCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + GOOGLE_VERTEX_MODEL_AVAILABILITY_CACHE_MS,
  })
  pruneGoogleVertexModelAvailabilityCache()
  return value
}

function googleVertexUnavailableMessage(modelName: string, checks: GoogleVertexModelAvailability[]) {
  const locations = checks.map((check) => check.location).join(', ') || GOOGLE_VERTEX_DEFAULT_LOCATION
  const quota = checks.find((check) => check.status === 429)
  if (quota) {
    return `Google Vertex quota blocked the model check for ${modelName} in ${quota.location}. ${quota.detail || 'Try again after quota is available.'}`
  }
  const auth = checks.find((check) => check.status === 401 || check.status === 403)
  if (auth) {
    return `Google Vertex cannot access ${modelName} with the current gcloud credentials or project. ${auth.detail || 'Check IAM, billing, and Vertex AI API access.'}`
  }
  const lastDetail = [...checks].reverse().find((check) => check.detail)?.detail
  return `Google Vertex model ${modelName} is not available in ${locations} for the configured project. Pick another google-vertex model or use a Vertex location where Google has enabled that model.${lastDetail ? ` Last check: ${lastDetail}` : ''}`
}

async function resolveGoogleVertexModelRoute(params: {
  auth: GoogleVertexOauthAuth
  modelName: string
  preferredLocation?: string
  signal?: AbortSignal
}) {
  const projectId = params.auth.projectId?.trim()
  if (!projectId) throw new Error('Google Vertex streaming requires a Google Cloud project. Run gcloud config set project YOUR_PROJECT_ID.')

  const checks: GoogleVertexModelAvailability[] = []
  for (const location of googleVertexCandidateLocations(params.preferredLocation || params.auth.location)) {
    const availability = await checkGoogleVertexModelAvailability({
      auth: params.auth,
      modelName: params.modelName,
      location,
      signal: directProviderRequestSignal(params.signal),
    })
    checks.push(availability)
    if (availability.ok) {
      return {
        location,
        endpoint: googleVertexModelMethodEndpoint(projectId, location, params.modelName, 'streamGenerateContent'),
      }
    }
  }

  throw new Error(googleVertexUnavailableMessage(params.modelName, checks))
}

async function filterGoogleVertexCatalogModels<T extends { id: string; provider?: string; name?: string }>(models: T[]): Promise<T[]> {
  const vertexModelNames = Array.from(
    new Set(
      models
        .filter((model) => (model.provider || splitModelId(model.id).provider) === 'google-vertex')
        .map((model) => model.name || splitModelId(model.id).model)
        .map((model) => googleVertexModelName(model))
        .filter(Boolean),
    ),
  )
  if (!vertexModelNames.length) return models

  const auth = await resolveGoogleVertexRequestAuth({}).catch(() => null)
  if (!auth || auth.type !== 'oauth') return models

  const available = new Map<string, boolean>()
  await Promise.all(
    vertexModelNames.map(async (modelName) => {
      const route = await resolveGoogleVertexModelRoute({ auth, modelName }).catch(() => null)
      available.set(modelName, Boolean(route))
    }),
  )
  if (!Array.from(available.values()).some(Boolean)) return models

  return models.filter((model) => {
    const provider = model.provider || splitModelId(model.id).provider
    if (provider !== 'google-vertex') return true
    const modelName = googleVertexModelName(model.name || splitModelId(model.id).model)
    return Boolean(available.get(modelName))
  })
}

async function streamGoogleVertexContent(params: {
  model: string
  auth: ProviderRequestAuth
  messages: ProviderConversationMessage[]
  thinking: ThinkingLevel
  signal: AbortSignal
  emit: StreamEmitter
}) {
  if (params.auth.type !== 'oauth') throw new Error('Google Vertex streaming requires gcloud or a Google access token.')
  const projectId = params.auth.projectId?.trim()
  if (!projectId) throw new Error('Google Vertex streaming requires a Google Cloud project. Run gcloud config set project YOUR_PROJECT_ID.')
  const location = normalizeGoogleVertexLocation(params.auth.location)
  const modelName = googleVertexModelName(params.model)
  const route = await resolveGoogleVertexModelRoute({
    auth: params.auth,
    modelName,
    preferredLocation: location,
    signal: directProviderRequestSignal(params.signal),
  })
  if (route.location !== location) {
    params.emit('status', {
      message: `Using Google Vertex ${route.location} endpoint for ${modelName}; it was not available in ${location}.`,
    })
  }
  const thinkingConfig = geminiThinkingConfig(params.model, params.thinking)
  const body: Record<string, unknown> = {
    contents: toGeminiContents(params.messages),
  }
  if (thinkingConfig) {
    body.generationConfig = {
      thinkingConfig,
    }
  }

  const upstream = await fetch(`${route.endpoint}?${new URLSearchParams({ alt: 'sse' }).toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.auth.accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify(body),
    signal: directProviderRequestSignal(params.signal),
  })
  await assertUpstreamOk(upstream, 'google-vertex')
  let reply = ''
  await readUpstreamSse(upstream, (frame) => {
    try {
      const payload = JSON.parse(frame.data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      }
      const finishReason = payload.candidates?.[0]?.finishReason
      const text = (payload.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || '')
        .filter(Boolean)
        .join('')
      if (text) {
        reply += text
        params.emit('delta', { text: redactHiddenReasoningAndSecrets(text) })
      }
      if (finishReason) return false
    } catch {
      // Ignore malformed upstream frames.
    }
  })
  return { content: reply }
}

type BufferedRuntimeReason = {
  code: string
  message: string
}

type AgentRuntimeShortcut = {
  command: 'work' | 'runtime' | 'openclaw'
  message: string
}

type LocalJsonPostResponse = {
  ok: boolean
  status: number
  text: string
}

function parseAgentRuntimeShortcut(message: string): AgentRuntimeShortcut | null {
  const match = /^\s*\/(work|runtime|openclaw)(?=$|\s|:)(?:\s+|:\s*)?([\s\S]*)$/i.exec(message || '')
  if (!match) return null
  const command = match[1].toLowerCase() as AgentRuntimeShortcut['command']
  const instruction = (match[2] || '').trim()
  return {
    command,
    message: instruction || 'OpenClaw runtime requested. Ask the operator what work should be done.',
  }
}

function agentRuntimeShortcutReason(shortcut?: AgentRuntimeShortcut | null): BufferedRuntimeReason {
  return {
    code: shortcut ? `slash-${shortcut.command}` : 'forced-openclaw-runtime',
    message: shortcut
      ? `/${shortcut.command} sends this turn straight to the OpenClaw runtime.`
      : 'Agent accepted the turn.',
  }
}

function postLocalJsonNoHeaderTimeout(routePath: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<LocalJsonPostResponse> {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted'))
      return
    }

    let settled = false
    let onAbort = () => undefined
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const request = httpRequest({
      host: '127.0.0.1',
      port: PORT,
      path: routePath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Connection: 'close',
      },
      timeout: 0,
    }, (response) => {
      response.setEncoding('utf8')
      let text = ''
      response.on('data', (chunk) => {
        text = appendBoundedLocalJsonResponse(text, chunk)
      })
      response.on('error', (error) => finish(() => reject(error)))
      response.on('end', () => {
        const status = response.statusCode || 0
        finish(() => resolve({
          ok: status >= 200 && status < 300,
          status,
          text,
        }))
      })
    })

    onAbort = () => {
      request.destroy(new Error('Request aborted'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    request.setTimeout(0)
    request.on('error', (error) => finish(() => reject(error)))
    request.write(payload)
    request.end()
  })
}

const ROUTER_TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bteh\b/g, 'the'],
  [/\bthsi\b/g, 'this'],
  [/\btaht\b/g, 'that'],
  [/\baks(?:ing)?\b/g, 'asking'],
  [/\banswre\b/g, 'answer'],
  [/\bshwo(?:ing)?\b/g, 'showing'],
  [/\bwwhat\b/g, 'what'],
  [/\bedoin?g\b/g, 'doing'],
  [/\bthrougha?\b/g, 'through'],
  [/\bauidt\b/g, 'audit'],
  [/\baudti\b/g, 'audit'],
  [/\bcomercial(?:ly)?\b/g, 'commercially'],
  [/\bcommerical(?:ly)?\b/g, 'commercially'],
  [/\bater\b/g, 'after'],
  [/\binefr?nece\b/g, 'inference'],
  [/\bregcngition\b/g, 'recognition'],
  [/\brecogni[sz]ing\b/g, 'recognizing'],
  [/\bapproprile?y\b/g, 'appropriately'],
]

function normalizeRouterText(value: string) {
  let text = (value || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [pattern, replacement] of ROUTER_TYPO_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }
  return text
}

function isDefinitionOnlyWorkspaceQuestion(text: string) {
  return (
    /\b(?:what\s+(?:do\s+you\s+mean\s+by|does|is)|explain|define|meaning\s+of)\b/.test(text) &&
    !/\b(?:read|open|show|inspect|audit|review|check|verify|scan|look\s+(?:at|into)|fix|change|update|edit|patch|build|run)\b/.test(text)
  )
}

function hasOpenClawToolSurfaceMention(text: string) {
  return /\b(?:tools?|tool\s+path|runtime|gateway|openclaw|clawtalk|filesystem|file\s*system|terminal|shell|browser|app[-\s]?control|workspace\s+access)\b/i.test(text)
}

function hasDirectExecutionRequest(text: string) {
  return /\b(?:(?:can|could|would|will)\s+(?:you|we)|(?:i\s+)?need\s+you\s+to|want\s+you\s+to|please)\b[\s\S]{0,140}\b(?:do|handle|take\s+care\s+of|check|verify|fix|make|update|run|test|build|look\s+(?:at|into)|go\s+through|inspect|read|open|use|execute|download|digest)\b/i.test(text)
}

function hasContextualExecutionRequest(text: string) {
  return /\b(?:do|handle|take\s+care\s+of|check|verify|fix|make|update|run|test|build|inspect|read|open|execute)\s+(?:it|this|that|these|those|the\s+(?:change|fix|update|test|build|work|thing|task))\b/i.test(text)
}

function inferWorkspaceRuntimeIntent(message: string, intentMessage?: string): BufferedRuntimeReason | null {
  const rawIntent = intentMessage?.trim() || message || ''
  const intentText = normalizeRouterText(rawIntent)
  const composedText = normalizeRouterText(message || '')
  if (!intentText) return null
  if (isDefinitionOnlyWorkspaceQuestion(intentText)) return null

  const text = `${intentText}\n${composedText}`
  const explicitWorkspaceTarget =
    /\b(?:workspace|repo(?:sitory)?|project\s+(?:files?|folder|directory)|directory|folder|files?|source\s+code|codebase|package\.json|tsconfig|vite|server|client|component|html|css|javascript|typescript)\b/i
  const productTarget =
    /\b(?:this|the|our|my)\s+(?:app|application|project|repo(?:sitory)?|codebase|build|release|product|desktop\s+app|electron\s+app)\b/i
  const namedProductTarget =
    /\b(?:automnia|openclaw|control\s+center|electron|desktop\s+app|release[/\\]win-unpacked|\.openclaw)\b/i
  const explicitToolAction =
    /\b(?:implement|scaffold|patch|edit(?:ed|ing)?|save|rename|delete|install|npm|terminal|shell|command|run\s+tests?|run\s+build|build|compile|lint|fix|update|modify|change|read|inspect|list|search|find|look\s+(?:at|into)|go\s+through|download|digest|analy[sz]e|summari[sz]e|audit|review|check|verify|validate|scan)\b/i
  const commercialAuditAction =
    /\b(?:sell|commercial(?:ly)?|commercialize|license|licen[cs]ing|distribute|distribution|ship|release|publish|app\s*store|installer|eula|privacy|terms|compliance|copyright|trademark|legal|sbom|third[-\s]?party\s+notices?)\b/i
  const followUpWorkspaceAction =
    /\b(?:after\s+(?:those|that|this)|those\s+(?:are|r)?\s*done|that\s+(?:is|s)?\s*done|blockers?|fix(?:es)?|changes?|cleanup|clean\s+build|ready\s+to\s+(?:sell|ship|release)|can\s+i\s+(?:sell|ship|release))\b/i
  const workspaceLookupQuestion =
    /\b(?:show\s+me|where(?:\s+is|'?s)?|which|what(?:\s+is|'?s)\s+(?:in|inside)|tell\s+me\s+(?:where|which|what\s+(?:is|'?s)\s+(?:in|inside)))\b/i
  const explicitCreationTarget =
    /\b(?:create|make|generate|write|save|export|render|produce)\b/i.test(intentText) &&
    /\b(?:file|folder|directory|component|page|website|web\s*app|app|game|script|code|html|css|javascript|typescript|project|pdf|docx?|document|word\s+doc(?:ument)?|xlsx?|spreadsheet|csv|pptx?|presentation|slide\s+deck|zip|archive)\b/i.test(intentText)

  if (hasOpenClawToolSurfaceMention(text) && (explicitToolAction.test(intentText) || hasDirectExecutionRequest(intentText))) {
    return {
      code: 'tool-access',
      message: 'Agent is using OpenClaw tools for this request.',
    }
  }

  if (hasContextualExecutionRequest(intentText)) {
    return {
      code: 'contextual-workspace',
      message: 'Agent is using the current workspace context.',
    }
  }

  const hasWorkspaceTarget =
    explicitWorkspaceTarget.test(text) ||
    productTarget.test(intentText) ||
    namedProductTarget.test(text)

  if (commercialAuditAction.test(intentText) && (hasWorkspaceTarget || followUpWorkspaceAction.test(intentText))) {
    return {
      code: 'commercial-audit',
      message: 'Agent is checking project files for commercial readiness.',
    }
  }

  if (followUpWorkspaceAction.test(intentText) && /\b(?:audit|review|check|verify|confirm|ready|done|sell|ship|release|commercial(?:ly)?)\b/i.test(intentText)) {
    return {
      code: 'contextual-workspace',
      message: 'Agent is checking the current workspace context.',
    }
  }

  if ((explicitToolAction.test(intentText) && hasWorkspaceTarget) || (workspaceLookupQuestion.test(intentText) && hasWorkspaceTarget) || explicitCreationTarget) {
    return {
      code: 'workspace-tools',
      message: 'Agent is using workspace tools for this request.',
    }
  }

  return null
}

function bufferedAgentRuntimeReason(message: string, attachments?: unknown[], intentMessage?: string): BufferedRuntimeReason | null {
  const text = message || ''
  const intentText = intentMessage?.trim() || text
  const runtimeShortcut = parseAgentRuntimeShortcut(text)
  if (runtimeShortcut) return agentRuntimeShortcutReason(runtimeShortcut)
  if (attachments?.length) {
    return {
      code: 'attachments',
      message: 'Agent is reading the attached file context.',
    }
  }
  if (isBrowserIntentMessage(intentText)) {
    return {
      code: 'browser',
      message: 'Agent is using browser tools for this request.',
    }
  }
  if (isClawTalkIntentMessage(intentText) || isClawTalkSetupIntentMessage(intentText)) {
    return {
      code: 'clawtalk',
      message: 'Agent is using or configuring ClawTalk for this request.',
    }
  }
  if (parseDelegationIntent(intentText)) {
    return {
      code: 'delegation',
      message: 'Agent is coordinating this with another agent.',
    }
  }
  if (isTeamRuntimePrompt(text)) {
    return {
      code: 'team-runtime',
      message: 'Agent is handling team coordination context.',
    }
  }

  return inferWorkspaceRuntimeIntent(text, intentMessage)
}

function isLikelyOpenClawRuntimeToolRequest(message: string) {
  const text = normalizeRouterText(message || '')
  if (isDefinitionOnlyWorkspaceQuestion(text)) return false
  const workspaceTarget =
    /\b(workspace|repo(?:sitory)?|project\s+(?:files?|folder|directory)|directory|folder|files?|source\s+code|codebase|package\.json|tsconfig|vite|server|client|component|html|css|javascript|typescript|this\s+(?:app|application|project|repo|codebase|build|release)|our\s+(?:app|application|project|repo|codebase|build|release)|automnia|openclaw|control\s+center|\.openclaw)\b/i
  const toolAction =
    /\b(use\s+(?:tools?|openclaw|terminal|shell|browser)|run|execute|test|build|compile|lint|install|start|restart|read|inspect|list|search|find|review|audit|check|verify|validate|scan|analy[sz]e|summari[sz]e|edit|patch|modify|update|fix|sell|commercial(?:ly)?|license|licen[cs]ing|distribute|ship|release)\b/i
  const localQuestion =
    /\b(?:what(?:'s| is)?|where(?:'s| is)?|which|show me|tell me)\b/i
  const contextualFollowUp =
    /\b(?:after\s+(?:those|that|this)|those\s+(?:are|r)?\s*done|blockers?|fix(?:es)?|ready\s+to\s+(?:sell|ship|release)|can\s+i\s+(?:sell|ship|release))\b/i
  if (hasOpenClawToolSurfaceMention(text) && (toolAction.test(text) || hasDirectExecutionRequest(text))) return true
  if (hasContextualExecutionRequest(text)) return true
  if (contextualFollowUp.test(text)) return true
  return workspaceTarget.test(text) && (toolAction.test(text) || localQuestion.test(text))
}

function googleGeminiEmbeddedRuntimeReason(modelId: string, message: string, intentMessage?: string): BufferedRuntimeReason | null {
  if (!isGoogleGeminiModelId(modelId)) return null
  const text = intentMessage?.trim() || message || ''
  if (!text.trim()) return null
  if (!isLikelyCodeArtifactRequest(text) && !isLikelyOpenClawRuntimeToolRequest(text)) return null
  return {
    code: 'google-gemini-tools',
    message: 'Agent is using tools for this Google Gemini request.',
  }
}

function openAiCodexEmbeddedRuntimeReason(modelId: string, message: string, intentMessage?: string): BufferedRuntimeReason | null {
  if (!isOpenAiCodexSubscriptionModel(modelId)) return null
  const text = intentMessage?.trim() || message || ''
  if (!text.trim()) return null
  if (!isLikelyCodeArtifactRequest(text) && !isLikelyOpenClawRuntimeToolRequest(text)) return null
  return {
    code: 'openai-codex-tools',
    message: 'Agent is using tools for this GPT/Codex request.',
  }
}

async function resolveAgentPrimaryModelId(agentId: string) {
  const { config, target } = await getAgentById(agentId)
  if (!target) throw new Error(`Agent not found: ${agentId}`)
  const defaults = config.agents?.defaults?.model || {}
  const local = await ensureAgentLocalConfig({
    agentId: target.id,
    entry: target,
    defaultsModel: defaults,
    defaultsSandbox: (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox,
  })
  return normalizeModelWithFallback(local.model, defaults).primary
}

type HostActionRequest =
  | {
      kind: 'launch-chrome'
      url?: string
    }

function detectHostActionRequest(message: string): HostActionRequest | null {
  const raw = (message || '').trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()
  const hasCompoundIntent =
    /\b(and then|then|also|after that|next)\b/i.test(normalized) ||
    (/\band\b/i.test(normalized) && /\b(add|buy|search|find|order|fill|checkout|recipe|ingredients|cart)\b/i.test(normalized))
  if (hasCompoundIntent) return null

  const urlMatch = raw.match(/\bhttps?:\/\/[^\s<>")']+/i)
  const mentionsChrome = /\b(google\s+)?chrome\b/i.test(normalized)
  const explicitLaunchIntent = /\b(open|launch|start|run|use)\b/i.test(normalized)
  const goToIntent = /\bgo\s*to\b|\bgoto\b/i.test(normalized)
  const wantsChrome = mentionsChrome && (explicitLaunchIntent || goToIntent || Boolean(urlMatch))
  if (!wantsChrome) return null
  return {
    kind: 'launch-chrome',
    url: urlMatch?.[0],
  }
}

function spawnDetached(command: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        shell: false,
      })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        resolve({ ok: false, detail: String(error) })
      })
      child.unref()
      setTimeout(() => {
        if (settled) return
        settled = true
        resolve({ ok: true, detail: `spawned pid ${child.pid ?? 'n/a'}` })
      }, 40)
    } catch (error) {
      resolve({ ok: false, detail: String(error) })
    }
  })
}

async function persistAgentAvatarBytes(agentId: string, bytes: Buffer, sourceName: string) {
  if (!isValidAgentId(agentId)) throw new Error('Invalid agent id.')
  assertAvatarUploadBytes(bytes, AVATAR_UPLOAD_LIMIT_BYTES)
  assertAvatarImageUploadSignature(bytes, sourceName)
  if (!isSupportedAvatarImagePath(sourceName)) {
    throw new Error('Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image.')
  }

  const { config, target } = await getAgentById(agentId)
  if (!target) throw new Error(`Agent not found: ${agentId}`)
  const local = await ensureAgentLocalConfig({
    agentId: target.id,
    entry: target,
    defaultsModel: config.agents?.defaults?.model || {},
    defaultsSandbox: (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox,
  })
  const workspace = normalizeExecutionWorkspacePath(local.routing.workspace || defaultAgentWorkspace(target.id))
  const avatarDir = path.join(workspace, '.openclaw', 'avatars')
  await fs.mkdir(avatarDir, { recursive: true })
  const avatarPath = path.join(avatarDir, managedAvatarFileName(target.id, sourceName))
  await fs.writeFile(avatarPath, bytes)
  const avatar = path.relative(workspace, avatarPath)

  local.identity.avatar = avatar
  local.agent.updatedAt = new Date().toISOString()
  applyExecutionWorkspaceToLocalConfig(local, workspace)
  await writeTextFileWithLockRetry(agentLocalConfigPath(target.id), `${JSON.stringify(local, null, 2)}\n`)
  await rememberAgentLocalConfigCache(agentLocalConfigPath(target.id), local)
  applyLocalConfigToGlobal(target.id, local, config)
  await writeOpenclawConfig(config)

  return {
    agentId: target.id,
    avatar,
    avatarPath,
    previewUrl: `/api/party/avatar/${encodeURIComponent(target.id)}?v=${Date.now()}`,
  }
}

async function persistAgentAvatarFromPath(agentId: string, sourcePath: string) {
  if (!isValidAgentId(agentId)) throw new Error('Invalid agent id.')
  const selectedPath = path.resolve(sourcePath)
  if (!isSupportedAvatarImagePath(selectedPath)) {
    throw new Error('Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image.')
  }
  const stat = await fs.stat(selectedPath)
  if (!stat.isFile()) throw new Error('Selected avatar is not a file.')
  assertAvatarUploadSize(stat.size, AVATAR_UPLOAD_LIMIT_BYTES)
  assertAvatarImageUploadSignature(await fs.readFile(selectedPath), selectedPath)

  const { config, target } = await getAgentById(agentId)
  if (!target) throw new Error(`Agent not found: ${agentId}`)
  const local = await ensureAgentLocalConfig({
    agentId: target.id,
    entry: target,
    defaultsModel: config.agents?.defaults?.model || {},
    defaultsSandbox: (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox,
  })
  const workspace = normalizeExecutionWorkspacePath(local.routing.workspace || defaultAgentWorkspace(target.id))
  const avatarDir = path.join(workspace, '.openclaw', 'avatars')
  await fs.mkdir(avatarDir, { recursive: true })
  const avatarPath = path.join(avatarDir, managedAvatarFileName(target.id, selectedPath))
  await fs.copyFile(selectedPath, avatarPath)
  const avatar = path.relative(workspace, avatarPath)

  local.identity.avatar = avatar
  local.agent.updatedAt = new Date().toISOString()
  applyExecutionWorkspaceToLocalConfig(local, workspace)
  await writeTextFileWithLockRetry(agentLocalConfigPath(target.id), `${JSON.stringify(local, null, 2)}\n`)
  await rememberAgentLocalConfigCache(agentLocalConfigPath(target.id), local)
  applyLocalConfigToGlobal(target.id, local, config)
  await writeOpenclawConfig(config)

  return {
    agentId: target.id,
    sourcePath: selectedPath,
    avatar,
    avatarPath,
    previewUrl: `/api/party/avatar/${encodeURIComponent(target.id)}?v=${Date.now()}`,
  }
}

async function launchChromeHost(url?: string): Promise<{ ok: boolean; detail: string; command: string }> {
  const args = url ? [url] : []
  if (process.platform === 'win32') {
    const candidates = [
      'chrome.exe',
      'chrome',
      path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LocalAppData || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      if (candidate.includes(path.sep) && !(await fileExists(candidate))) continue
      const launched = await spawnDetached(candidate, args)
      if (launched.ok) {
        return {
          ok: true,
          detail: launched.detail,
          command: `${candidate}${args.length ? ` ${args.join(' ')}` : ''}`,
        }
      }
    }
    return { ok: false, detail: 'Chrome executable not found or could not be started.', command: 'chrome.exe' }
  }

  if (process.platform === 'darwin') {
    const launched = await spawnDetached('open', ['-a', 'Google Chrome', ...(url ? [url] : [])])
    return {
      ok: launched.ok,
      detail: launched.detail,
      command: `open -a "Google Chrome"${url ? ` ${url}` : ''}`,
    }
  }

  const linux = await spawnDetached('xdg-open', [url || 'https://www.google.com'])
  return {
    ok: linux.ok,
    detail: linux.detail,
    command: `xdg-open ${url || 'https://www.google.com'}`,
  }
}

const VISIBLE_RUNTIME_LOG_PREFIX_RE =
  /^(?:\[(?:plugins?|agent\/embedded|agents\/[^\]]+|gateway(?:-err)?|browser\/service|clawtalk|openclaw(?:\/[^\]]+)?|runtime(?:\/[^\]]+)?)\]\s*)+/i

const VISIBLE_RUNTIME_LOG_SPLIT_RE =
  /\s+(?=\[(?:plugins?|agent\/embedded|agents\/[^\]]+|gateway(?:-err)?|browser\/service|clawtalk|openclaw(?:\/[^\]]+)?|runtime(?:\/[^\]]+)?)\]\s*)/gi

function runtimeVisibleSegments(text: string): string[] {
  return stripAnsi(text || '')
    .replace(VISIBLE_RUNTIME_LOG_SPLIT_RE, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function redactHiddenReasoningAndSecrets(text: string): string {
  return redactSensitiveText(text || '')
    .replace(/<\s*(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\b[\s\S]*?<\s*\/\s*(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\s*>/gi, '[hidden reasoning removed]')
    .replace(/\b(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\s*[:=]\s*["']?[^"'\n]{8,}/gi, 'reasoning=[redacted]')
    .replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\n]+/gi, 'Cookie: [redacted]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Authorization: Bearer [redacted]')
    .replace(/\b(?:[A-Za-z]:\\Users\\)[^\\\s]+/g, '%USERPROFILE%')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
}

function isUserVisibleRuntimeLogLine(line: string): boolean {
  const text = stripAnsi(line || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (isGatewayInternalDiagnosticMessage(text)) return true
  if (/^message processed:\s+channel=(?:cron|agent|chat)\b/iu.test(text)) return true
  if (/^(?:warn|stderr)\s+(?:long-running|stalled|stuck) session:/iu.test(text)) return true
  if (VISIBLE_RUNTIME_LOG_PREFIX_RE.test(text)) return true
  if (/^ClawTalk plugin loaded\b/i.test(text)) return true
  if (/^Registered \d+\s+agent tools\b/i.test(text)) return true
  if (/^OpenClaw runtime (?:handoff|selected|returned|working|is handling|child process started|started|completed|failed)\b/i.test(text)) return true
  if (/^Waiting for OpenClaw runtime\b/i.test(text)) return true
  return false
}

function sanitizeUserVisibleRuntimeText(text: string): string {
  return runtimeVisibleSegments(redactHiddenReasoningAndSecrets(text))
    .filter((line) => !isUserVisibleRuntimeLogLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractAgentReply(stdout: string, stderr: string): string {
  const trimmedOut = stdout.trim()
  if (!trimmedOut) return sanitizeUserVisibleRuntimeText(stderr)

  const extractFromParsed = (parsed: unknown): string => {
    if (!parsed || typeof parsed !== 'object') return ''
    const payload = parsed as {
      payloads?: Array<{ text?: string | null }>
      result?: { payloads?: Array<{ text?: string | null }> }
      summary?: string
      status?: string
      text?: string
      message?: string
      content?: string
      payload?: { text?: string | null }
    }
    const payloadText = [
      ...(payload.payloads || []),
      ...(payload.result?.payloads || []),
    ]
      .map((item) => (item.text || '').trim())
      .filter(Boolean)
      .join('\n\n')
    if (payloadText) return sanitizeUserVisibleRuntimeText(payloadText)
    if (payload.payload?.text?.trim()) return sanitizeUserVisibleRuntimeText(payload.payload.text)
    if (payload.text?.trim()) return sanitizeUserVisibleRuntimeText(payload.text)
    if (payload.message?.trim()) return sanitizeUserVisibleRuntimeText(payload.message)
    if (payload.content?.trim()) return sanitizeUserVisibleRuntimeText(payload.content)
    return sanitizeUserVisibleRuntimeText(payload.summary || payload.status || '')
  }

  try {
    const parsed = JSON.parse(trimmedOut)
    const extracted = extractFromParsed(parsed)
    if (extracted) return extracted
  } catch {
    // fall through to line-wise parsing
  }

  const lineText = runtimeVisibleSegments(trimmedOut)
    .filter((line) => !isUserVisibleRuntimeLogLine(line))
    .filter((line) => !/^"?sessionKey"?\s*:/i.test(line))
    .filter((line) => !line || !Array.from(line).every((char) => char === '{' || char === '}' || char === '[' || char === ']' || char === ','))

  if (lineText.length) {
    const parsedLineReplies: string[] = []
    for (const line of lineText) {
      const candidate = line.replace(/,$/, '')
      try {
        const parsed = JSON.parse(candidate)
        const extracted = extractFromParsed(parsed)
        if (extracted) parsedLineReplies.push(extracted)
      } catch {
        if (!isUserVisibleRuntimeLogLine(candidate) && !/^"?[a-zA-Z0-9_]+"?\s*:/.test(candidate)) {
          parsedLineReplies.push(candidate.replace(/^"|"$/g, '').trim())
        }
      }
    }
    const joined = sanitizeUserVisibleRuntimeText(parsedLineReplies.join('\n'))
    if (joined) return joined
  }

  return sanitizeUserVisibleRuntimeText(stderr) || 'No response returned.'
}

function isContextOverflowReply(text: string): boolean {
  return /context overflow|prompt too large|start a fresh session/i.test(text)
}

function isEmptyAgentNoResponseReply(text: string): boolean {
  return /Agent couldn't generate a response/i.test(text || '')
}

function isBrowserIntentMessage(text: string): boolean {
  const raw = text || ''
  const normalized = raw.toLowerCase()
  if (!normalized.trim()) return false
  if (/\bhttps?:\/\//i.test(normalized)) return true

  const segments = raw
    .replace(/\r/g, '\n')
    .split(/[\n!?;]+/g)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)

  const localFileExtension = '(?:cjs|css|csv|docx?|gif|html?|ini|jpe?g|json|jsx?|lock|log|md|mjs|pdf|png|pptx?|py|svg|toml|tsv|tsx?|txt|webp|xlsx?|ya?ml|zip)'
  const domainPattern = `(?:www\\.)?[a-z0-9][a-z0-9.-]*\\.(?!${localFileExtension}\\b)[a-z]{2,}(?:/\\S*)?`
  const browserTarget = '(?:google\\s+chrome|chrome|browser|web\\s*page|web\\s*site|website|url|tab)'
  const browserAction = '(?:open|launch|start|use|attach|navigate|visit|load|click|type|fill|select|scroll|screenshot|capture|inspect)'
  const webSearchTarget = '(?:web|internet|online|browser|chrome|google|site|website|page|url)'

  return segments.some((segment) => {
    if (new RegExp(`\\b(?:open|visit|load|navigate\\s+to|go\\s*to|goto)\\s+${domainPattern}`, 'i').test(segment)) return true
    if (new RegExp(`\\b${browserAction}\\b(?:\\W+\\w+){0,8}?\\W+\\b${browserTarget}\\b`, 'i').test(segment)) return true
    if (new RegExp(`\\b${browserTarget}\\b(?:\\W+\\w+){0,8}?\\W+\\b${browserAction}\\b`, 'i').test(segment)) return true
    if (/\b(?:go\s*to|goto|navigate\s+to|visit|load)\b/.test(segment) && new RegExp(`\\b(?:${browserTarget}|${domainPattern})\\b`, 'i').test(segment)) return true
    if (/\b(?:search|google|look\s+up|find)\b/.test(segment) && new RegExp(`\\b${webSearchTarget}\\b`, 'i').test(segment)) return true
    if (/\b(?:web|internet|online)\s+search\b|\bsearch\s+(?:the\s+)?(?:web|internet|online)\b/.test(segment)) return true
    return false
  })
}

function isClawTalkIntentMessage(text: string): boolean {
  const raw = text || ''
  const normalized = raw.toLowerCase()
  if (!normalized.trim()) return false

  const phonePattern = /\+?\d[\d\s().-]{7,}\d/
  const technicalCallTarget =
    /\b(?:api|callback|command|endpoint|file|function|gateway|method|plugin|repo|runtime|server|tool)\b/i
  const segments = raw
    .replace(/\r/g, '\n')
    .split(/[\n!?;]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.some((segment) => {
    const lower = segment.toLowerCase()
    const mentionsClawTalk = /\bclaw\s*talk\b|\bclawtalk\b/i.test(segment)
    const hasPhoneNumber = phonePattern.test(segment)
    const hasMessagingAction = /\b(?:send|text|sms|message|reply)\b/i.test(segment)
    const hasVoiceAction = /\b(?:call|dial|phone|ring|voice\s+call)\b/i.test(segment)
    const hasCommunicationMedium = /\b(?:sms|text(?:\s+message)?|phone|voice|call|number|mobile|cell)\b/i.test(segment)
    const hasRecipientCue =
      hasPhoneNumber ||
      /\b(?:to|at)\s+(?:\+?\d|my\s+phone|this\s+number|that\s+number|the\s+number|a\s+contact|the\s+contact|client|customer|lead|user|recipient)\b/i.test(segment)

    if (mentionsClawTalk && (hasMessagingAction || hasVoiceAction || hasCommunicationMedium)) return true
    if (hasMessagingAction && (hasRecipientCue || hasCommunicationMedium)) return true
    if (hasVoiceAction && (hasRecipientCue || hasPhoneNumber)) return true
    if (hasPhoneNumber && (hasMessagingAction || hasVoiceAction)) return true

    if (!hasVoiceAction || technicalCallTarget.test(lower)) return false
    return /\b(?:call|dial|phone|ring)\s+(?:my\s+)?[a-z][a-z0-9_-]{1,}(?:\s+[a-z][a-z0-9_-]{1,}){0,3}\b/i.test(segment)
  })
}

function isClawTalkSetupIntentMessage(text: string): boolean {
  const raw = text || ''
  const normalized = raw.toLowerCase()
  if (!normalized.trim()) return false
  if (!/\bclaw\s*talk\b|\bclawtalk\b/i.test(raw)) return false
  return /\b(?:install|setup|set\s*up|enable|configure|config|repair|fix|doctor|connect|authenticate|api\s*key|plugin)\b/i.test(normalized)
}

async function shouldRouteBrowserIntentThroughBrowserPlugin(text: string, hostAction: HostActionRequest | null) {
  if (hostAction || !isBrowserIntentMessage(text)) return false
  const browserPlugin = await getOpenClawPluginEnabled('browser')
  return browserPlugin.enabled
}

function isBrowserServiceReadyOnlyReply(reply: string): boolean {
  const compact = (reply || '').trim().replace(/\s+/g, ' ')
  return /^\[browser\/service\]\s*browser control service ready/i.test(compact)
}

function isTeamRuntimePrompt(message: string): boolean {
  const text = (message || '').replace(/^\s*\/new\b\s*/i, '').trimStart()
  return /^(?:TEAM:|TEAM_SYNC\b|EVIDENCE\[|Lane\s+\d+\/|Mission:|claim your files\b|Attached file\b|Slot 1 commander protocol\b|Initial teammate lane\b|COMMANDER INTENT\b|LANE STATUS MATRIX\b|WORKSPACE REGISTRY\b)/i.test(text)
}

function parseDelegationIntent(message: string): { targetRef: string; instruction: string } | null {
  const input = (message || '').trim()
  if (!input) return null

  const mentionMatch = input.match(/^@([a-z0-9_-]{2,40})[\s,:-]+([\s\S]+)/i)
  if (mentionMatch) {
    const targetRef = (mentionMatch[1] || '').trim()
    const instruction = (mentionMatch[2] || '').trim()
    if (targetRef && instruction && !isRetiredAgentId(targetRef)) return { targetRef, instruction }
  }

  if (isTeamRuntimePrompt(input)) return null

  const agentRefPattern = '([a-z0-9_-]+(?:\\s+[a-z0-9_-]+){0,3})'
  const patterns = [
    new RegExp(`(?:^|\\b)(?:ask|tell|have|delegate(?:\\s+to)?|assign)\\s+${agentRefPattern}\\s+to\\s+([\\s\\S]+)`, 'i'),
    new RegExp(`(?:^|\\b)(?:ask|tell|have|delegate(?:\\s+to)?|assign)\\s+${agentRefPattern}\\s*[:,-]\\s*([\\s\\S]+)`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (!match) continue
    const targetRef = (match[1] || '').trim()
    const instruction = (match[2] || '').trim()
    if (targetRef && instruction && !isRetiredAgentId(targetRef)) return { targetRef, instruction }
  }

  return null
}

function resolveAgentReference(targetRef: string, party: Array<{ id: string; name?: string; aliases?: string[] }>, sourceAgentId?: string) {
  const ref = (targetRef || '').trim().toLowerCase()
  if (!ref || isRetiredAgentId(ref)) return null
  const candidates = party.filter((entry) => !isRetiredAgentId(entry.id))

  const exactId = candidates.find((entry) => entry.id.toLowerCase() === ref)
  if (exactId && exactId.id !== sourceAgentId) return exactId

  const exactName = candidates.find((entry) => (entry.name || '').trim().toLowerCase() === ref)
  if (exactName && exactName.id !== sourceAgentId) return exactName

  const exactAlias = candidates.find((entry) => (entry.aliases || []).some((alias) => alias.trim().toLowerCase() === ref))
  if (exactAlias && exactAlias.id !== sourceAgentId) return exactAlias

  const containsName = candidates.find((entry) => (entry.name || '').trim().toLowerCase().includes(ref) || ref.includes((entry.name || '').trim().toLowerCase()))
  if (containsName && containsName.id !== sourceAgentId) return containsName

  const containsAlias = candidates.find((entry) =>
    (entry.aliases || []).some((alias) => alias.trim().toLowerCase().includes(ref) || ref.includes(alias.trim().toLowerCase())),
  )
  if (containsAlias && containsAlias.id !== sourceAgentId) return containsAlias

  const containsId = candidates.find((entry) => entry.id.toLowerCase().includes(ref) || ref.includes(entry.id.toLowerCase()))
  if (containsId && containsId.id !== sourceAgentId) return containsId

  return null
}

function buildBrowserRecoveryInstruction(originalTask: string): string {
  return [
    originalTask,
    '',
    'Recovery requirement:',
    '- Use browser tools now (no placeholder/service-ready response).',
    '- Complete the requested browser action in this turn.',
    '- If searching, run the search and include the query + page URL in output.',
    '- Return concrete evidence only after action succeeds.',
  ].join('\n')
}

function buildClawTalkRuntimeInstruction(originalTask: string, setupIntent = false): string {
  const setupRequirements = setupIntent
    ? [
        '- If ClawTalk is missing, disabled, not loaded, or not authenticated, install/enable/configure it yourself using available OpenClaw/runtime tools before giving up.',
        '- Do not tell the user to enable ClawTalk manually unless an API key, account authorization, phone number, or other secret/account detail is genuinely missing.',
        '- After setup or repair, verify with ClawTalk/OpenClaw diagnostics and continue the requested phone/SMS work when enough details are available.',
      ]
    : [
        '- If ClawTalk is missing, disabled, or not loaded, attempt a safe self-repair/diagnostic path first; only ask the user for missing credentials or recipient details.',
      ]
  return [
    originalTask,
    '',
    'ClawTalk requirement:',
    ...setupRequirements,
    '- Use ClawTalk voice/SMS tools for outbound calls, texts, replies, and phone-channel work.',
    '- If the recipient, phone number, or message is missing, ask only for the missing detail.',
    '- Do not simulate a sent text or completed call. Report the ClawTalk tool result, message id, call id, or setup blocker.',
    '- Keep phone numbers, API keys, and private channel details redacted in the final reply.',
  ].join('\n')
}

function isAgentRuntimeTimeoutResult(result: OpenClawResult, reply = '') {
  if (result.code === 0) return false
  const combined = `${reply || ''}\n${result.stderr || ''}\n${result.stdout || ''}`
  return result.failureKind === 'timeout' || classifyFailureKind(combined, 'failed') === 'timeout'
}

function buildRuntimeTimeoutContinuationInstruction(originalTask: string, timeoutSeconds: number): string {
  return [
    'The previous OpenClaw runtime turn for this same agent session timed out before a final assistant reply.',
    'Continue from the work already present in the session and workspace. Inspect current files, logs, and tool state before changing anything.',
    'Do not restart from scratch unless no durable progress exists. Preserve completed work and finish the original request.',
    `This recovery turn has up to ${timeoutSeconds} seconds.`,
    '',
    'Original request:',
    originalTask,
  ].join('\n')
}

function runtimeTimeoutResumeAdvice(agentId: string, sessionId: string) {
  return [
    'Runtime timed out before a final reply.',
    `The ${agentId} session was preserved (${sessionId.slice(0, 8)}).`,
    'Send "continue" or "resume" to pick up from the same session.',
  ].join(' ')
}

function withRuntimeTimeoutResumeAdvice(reply: string, agentId: string, sessionId: string) {
  const advice = runtimeTimeoutResumeAdvice(agentId, sessionId)
  const cleanReply = (reply || '').trim()
  if (!cleanReply) return advice
  if (cleanReply.includes('session was preserved') || cleanReply.includes('Send "continue"')) return cleanReply
  return `${cleanReply}\n\n${advice}`
}

function hasBrowserRelayPortConflict(stderr: string): boolean {
  const text = (stderr || '').toLowerCase()
  return text.includes('eaddrinuse') && text.includes('127.0.0.1:18792')
}

function hasBrowserRelayDisconnected(stderr: string): boolean {
  const text = (stderr || '').toLowerCase()
  return (
    text.includes('gateway closed') ||
    text.includes("can't reach the openclaw browser control service") ||
    (text.includes('abnormal closure') && text.includes(`127.0.0.1:${GATEWAY_HTTP_PORT}`))
  )
}

function hasNoAttachedBrowserTab(detail: string): boolean {
  return /no tab is connected|attach it|click the openclaw chrome extension icon on a tab/i.test(detail || '')
}

function stripAnsi(text: string): string {
  const escape = String.fromCharCode(27)
  return (text || '').replace(new RegExp(`${escape}\\[[0-9;]*m`, 'g'), '')
}

function extractDevicePairingRequestId(text: string): string | null {
  const match = /requestId:\s*([0-9a-f-]{24,})/i.exec(text || '') || /requestId["'\s:]+([0-9a-f-]{24,})/i.exec(text || '')
  return match?.[1] || null
}

function isLoopbackAddress(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true
  const host = value.trim().replace(/^::ffff:/, '')
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

function uniqueStrings(...items: Array<unknown>): string[] {
  const out = new Set<string>()
  for (const item of items) {
    if (Array.isArray(item)) {
      for (const value of item) {
        if (typeof value === 'string' && value.trim()) out.add(value.trim())
      }
    } else if (typeof item === 'string' && item.trim()) {
      out.add(item.trim())
    }
  }
  return [...out]
}

function splitTextForAppend(value: string, maxChars: number): string[] {
  const text = (value || '').trim()
  if (!text) return []
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('\n\n', maxChars)
    if (cut < Math.floor(maxChars * 0.35)) cut = remaining.lastIndexOf('\n', maxChars)
    if (cut < Math.floor(maxChars * 0.35)) cut = remaining.lastIndexOf(' ', maxChars)
    if (cut < Math.floor(maxChars * 0.35)) cut = maxChars
    const chunk = remaining.slice(0, cut).trim()
    if (chunk) chunks.push(chunk)
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

async function approveLocalDevicePairingRequest(requestId: string, baseDir: string): Promise<{ approved: boolean; detail: string }> {
  const pendingPath = path.join(baseDir, 'devices', 'pending.json')
  const pairedPath = path.join(baseDir, 'devices', 'paired.json')
  try {
    const [pendingRaw, pairedRaw] = await Promise.all([
      fs.readFile(pendingPath, 'utf-8').catch(() => '{}'),
      fs.readFile(pairedPath, 'utf-8').catch(() => '{}'),
    ])
    const pendingById = parseLooseJsonObject(pendingRaw)
    const pairedByDeviceId = parseLooseJsonObject(pairedRaw)
    const pending = isLooseRecord(pendingById[requestId]) ? pendingById[requestId] : null
    if (!pending) return { approved: false, detail: `pending request not found in ${baseDir}` }

    const roles = uniqueStrings(pending.roles, pending.role || 'operator')
    const requestedScopes = uniqueStrings(pending.scopes)
    const operatorOnly = roles.every((role) => role === 'operator') && requestedScopes.every((scope) => scope.startsWith('operator.'))
    if (!operatorOnly || !isLoopbackAddress(pending.remoteIp)) {
      return { approved: false, detail: `pending request refused for auto-approval in ${baseDir}` }
    }

    const deviceId = String(pending.deviceId || '').trim()
    if (!deviceId) return { approved: false, detail: `pending request missing device id in ${baseDir}` }
    const existing = isLooseRecord(pairedByDeviceId[deviceId]) ? pairedByDeviceId[deviceId] : {}
    const approvedScopes = uniqueStrings(existing.approvedScopes || existing.scopes, requestedScopes)
    const mergedRoles = uniqueStrings(existing.roles, existing.role, roles)
    const tokens = isLooseRecord(existing.tokens) ? { ...existing.tokens } : {}
    const now = Date.now()
    for (const role of mergedRoles) {
      if (role !== 'operator') continue
      const existingToken = isLooseRecord(tokens[role]) ? tokens[role] : {}
      const tokenScopes = approvedScopes.filter((scope) => scope.startsWith('operator.'))
      tokens[role] = {
        token: randomBytes(32).toString('base64url'),
        role,
        scopes: tokenScopes,
        createdAtMs: existingToken.createdAtMs || now,
        ...(existingToken.createdAtMs ? { rotatedAtMs: now } : {}),
        ...(existingToken.lastUsedAtMs ? { lastUsedAtMs: existingToken.lastUsedAtMs } : {}),
      }
    }

    pairedByDeviceId[deviceId] = {
      ...existing,
      deviceId,
      publicKey: pending.publicKey || existing.publicKey,
      displayName: pending.displayName || existing.displayName,
      platform: pending.platform || existing.platform,
      deviceFamily: pending.deviceFamily || existing.deviceFamily,
      clientId: pending.clientId || existing.clientId,
      clientMode: pending.clientMode || existing.clientMode,
      role: pending.role || existing.role || 'operator',
      roles: mergedRoles,
      scopes: approvedScopes,
      approvedScopes,
      remoteIp: pending.remoteIp || existing.remoteIp,
      tokens,
      createdAtMs: existing.createdAtMs || now,
      approvedAtMs: now,
    }
    delete pendingById[requestId]

    await fs.mkdir(path.dirname(pendingPath), { recursive: true })
    await fs.writeFile(pendingPath, `${JSON.stringify(pendingById, null, 2)}\n`, 'utf-8')
    await fs.writeFile(pairedPath, `${JSON.stringify(pairedByDeviceId, null, 2)}\n`, 'utf-8')
    return { approved: true, detail: `approved local loopback device scope request ${requestId} in ${baseDir}` }
  } catch (error) {
    return { approved: false, detail: `local device approval failed in ${baseDir}: ${String(error)}` }
  }
}

async function tryApprovePendingDeviceScopeUpgrade(detail: string): Promise<{ approved: boolean; detail: string }> {
  const requestId = extractDevicePairingRequestId(detail)
  if (!requestId) return { approved: false, detail: 'no pending device request id found' }

  const baseDirs = uniqueStrings(OPENCLAW_STATE_ROOT, path.join(HOME_DIR, '.openclaw'))
  const logs: string[] = []
  for (const baseDir of baseDirs) {
    const result = await approveLocalDevicePairingRequest(requestId, baseDir)
    logs.push(result.detail)
    if (result.approved) return { approved: true, detail: logs.join('\n') }
  }
  return { approved: false, detail: logs.join('\n') || `request ${requestId} was not approved` }
}

async function tryStartBrowserRelayWithRepair(): Promise<{ started: boolean; detail: string }> {
  const first = await tryStartBrowserRelay()
  if (first.started || !/scope upgrade pending approval|pairing required|requestId/i.test(first.detail)) return first

  const approval = await tryApprovePendingDeviceScopeUpgrade(first.detail)
  if (!approval.approved) {
    return { started: false, detail: `${first.detail}\n[device-scope-autofix] failed | ${approval.detail}` }
  }

  await new Promise((resolve) => setTimeout(resolve, 900))
  const second = await tryStartBrowserRelay()
  return {
    started: second.started,
    detail: `${second.detail}\n[device-scope-autofix] approved | ${approval.detail}`,
  }
}

async function tryStartBrowserRelay(): Promise<{ started: boolean; detail: string }> {
  try {
    const start = await runOpenClaw(['browser', '--browser-profile', 'openclaw', '--timeout', '45000', 'start'], 55000)
    const actualStart =
      start.code !== 0 && /unknown option/i.test(`${start.stdout}\n${start.stderr}`)
        ? await runOpenClaw(['browser', '--timeout', '45000', 'start'], 55000)
          .catch(async () => runOpenClaw(['browser', 'start'], 55000).catch((error) => ({ stdout: '', stderr: String(error), code: 1 })))
        : start
    const status = await runOpenClaw(['browser', '--browser-profile', 'openclaw', '--json', 'status'], 12000).catch((error) => ({
      stdout: '',
      stderr: String(error),
      code: 1,
    }))
    const actualStatus =
      status.code !== 0 && /unknown option/i.test(`${status.stdout}\n${status.stderr}`)
        ? await runOpenClaw(['browser', '--json', 'status'], 12000)
          .catch(async () => runOpenClaw(['browser', 'status'], 12000).catch((error) => ({ stdout: '', stderr: String(error), code: 1 })))
        : status

    const output = [actualStart.stdout || '', actualStart.stderr || '', actualStatus.stdout || '', actualStatus.stderr || '']
      .map((part) => stripAnsi(part).trim())
      .filter(Boolean)
      .join('\n')
      .trim()

    const statusText = stripAnsi(actualStatus.stdout || '').trim()
    let cdpHttpReady = false
    if (actualStatus.code === 0 && statusText) {
      try {
        const parsed = JSON.parse(statusText) as { cdpHttp?: boolean; cdpHttpReady?: boolean; browser?: { cdpHttpReady?: boolean } }
        cdpHttpReady = Boolean(parsed.browser?.cdpHttpReady ?? parsed.cdpHttpReady ?? parsed.cdpHttp)
      } catch {
        cdpHttpReady = /cdp.*ready|browser.*ready|connected|running/i.test(statusText)
      }
    }

    const startText = stripAnsi(`${actualStart.stdout || ''}\n${actualStart.stderr || ''}`)
    const startSucceeded = actualStart.code === 0 || /already running|started|running/i.test(startText)
    return {
      started: cdpHttpReady || startSucceeded,
      detail: output || `browser start exit code ${actualStart.code}`,
    }
  } catch (error) {
    return { started: false, detail: String(error) }
  }
}

async function tryReleaseBrowserRelayPort(): Promise<{ released: boolean; detail: string }> {
  if (process.platform !== 'win32') {
    return tryReleaseTcpPortUnix(18792)
  }

  return new Promise((resolve) => {
    let settled = false
    const command = [
      "$listeners = Get-NetTCPConnection -State Listen -LocalPort 18792 -ErrorAction SilentlyContinue;",
      'if (-not $listeners) { Write-Output "PORT_CLEAR"; exit 0 };',
      '$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique;',
      'Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue;',
      'Start-Sleep -Milliseconds 500;',
      '$still = Get-NetTCPConnection -State Listen -LocalPort 18792 -ErrorAction SilentlyContinue;',
      'if ($still) { Write-Output "PORT_STILL_BUSY"; exit 1 } else { Write-Output "PORT_RELEASED"; exit 0 }',
    ].join(' ')

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      shell: false,
      windowsHide: true,
    })
    const timeout = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Process may have already exited.
      }
      settle({ released: false, detail: 'PORT_RELEASE_TIMEOUT:18792' })
    }, 5000)
    const settle = (result: { released: boolean; detail: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      settle({ released: false, detail: String(error) })
    })
    child.on('close', (code) => {
      const combined = `${stdout}\n${stderr}`.trim()
      const released = code === 0 && /PORT_RELEASED|PORT_CLEAR/i.test(combined)
      settle({ released, detail: combined || `exit:${code ?? 1}` })
    })
  })
}

async function tryReleaseGatewayPort(): Promise<{ released: boolean; detail: string }> {
  const port = GATEWAY_HTTP_PORT
  if (process.platform !== 'win32') {
    return tryReleaseTcpPortUnix(port)
  }

  return new Promise((resolve) => {
    let settled = false
    const command = [
      `$listeners = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue;`,
      'if (-not $listeners) { Write-Output "PORT_CLEAR"; exit 0 };',
      '$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique;',
      'Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue;',
      'Start-Sleep -Milliseconds 700;',
      `$still = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue;`,
      'if ($still) { Write-Output "PORT_STILL_BUSY"; exit 1 } else { Write-Output "PORT_RELEASED"; exit 0 }',
    ].join(' ')

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      shell: false,
      windowsHide: true,
    })
    const timeout = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Process may have already exited.
      }
      settle({ released: false, detail: `PORT_RELEASE_TIMEOUT:${port}` })
    }, 5000)
    const settle = (result: { released: boolean; detail: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      settle({ released: false, detail: String(error) })
    })
    child.on('close', (code) => {
      const combined = `${stdout}\n${stderr}`.trim()
      const released = code === 0 && /PORT_RELEASED|PORT_CLEAR/i.test(combined)
      settle({ released, detail: combined || `exit:${code ?? 1}` })
    })
  })
}

async function tryReleaseTcpPortUnix(port: number): Promise<{ released: boolean; detail: string }> {
  if (process.platform === 'win32') return { released: false, detail: 'unsupported-platform' }

  const run = (cmd: string, args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(cmd, args, { shell: false })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        resolve({ code: 127, stdout, stderr: String(error) })
      })
      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })

  const before = await checkTcpPort('127.0.0.1', port, 500)
  if (!before) return { released: true, detail: `PORT_CLEAR:${port}` }

  const fuser = await run('fuser', ['-k', `${port}/tcp`])
  await new Promise((resolve) => setTimeout(resolve, 700))
  const afterFuser = await checkTcpPort('127.0.0.1', port, 500)
  if (!afterFuser) {
    return { released: true, detail: `PORT_RELEASED:${port} via fuser ${stripAnsi(`${fuser.stdout}\n${fuser.stderr}`).trim()}` }
  }

  const lsof = await run('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN'])
  const pids = lsof.stdout
    .split(/\s+/)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process may have exited after lsof; ignore and recheck.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 900))
  const afterTerm = await checkTcpPort('127.0.0.1', port, 500)
  if (!afterTerm) return { released: true, detail: `PORT_RELEASED:${port} via SIGTERM ${pids.join(',')}` }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may have exited after SIGTERM; ignore and recheck.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  const afterKill = await checkTcpPort('127.0.0.1', port, 500)
  return {
    released: !afterKill,
    detail: afterKill
      ? `PORT_STILL_BUSY:${port} fuser=${stripAnsi(`${fuser.stdout}\n${fuser.stderr}`).trim()} lsof=${stripAnsi(`${lsof.stdout}\n${lsof.stderr}`).trim()}`
      : `PORT_RELEASED:${port} via SIGKILL ${pids.join(',')}`,
  }
}

async function tryRestartGatewayService(options: { force?: boolean; allowExternalTakeover?: boolean; reason?: string } = {}): Promise<{ restarted: boolean; detail: string }> {
  const gate = licenseService.getTrafficGate()
  if (gate.blocked) {
    return { restarted: false, detail: gate.blockMessage || 'Gateway restart blocked by the Automnia traffic gate.' }
  }
  return gatewayLifecycle.tryRestartGatewayService(options)
}

async function ensureGatewayReadyForCronMission(): Promise<void> {
  const gate = licenseService.getTrafficGate()
  if (gate.blocked) throw new Error(gate.blockMessage || 'Automnia traffic is blocked until credits are restored.')
  if (await isGatewayHealthy()) {
    startGatewayHealthMonitor()
    return
  }

  await ensureGatewayRunning()
  startGatewayHealthMonitor()
  if (await isGatewayHealthy()) return

  const recovered = await tryRestartGatewayService({ reason: 'mission cron gateway recovery' })
  if (recovered.restarted || await isGatewayHealthy()) return

  const detail = recovered.detail ? ` ${recovered.detail}` : ''
  throw new Error(`OpenClaw gateway is offline; mission cron cannot run.${detail}`)
}

function checkTcpPort(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // no-op
      }
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

const browserProbeCache = new Map<string, { ok: boolean; checkedAt: number; detail: string }>()

async function runBrowserToolProbe(agentId: string): Promise<{ ok: boolean; detail: string }> {
  const cached = browserProbeCache.get(agentId)
  if (cached && Date.now() - cached.checkedAt < 45_000) {
    return { ok: cached.ok, detail: cached.detail }
  }

  const context = await resolveAgentRunContext(agentId)
  const envOverrides = await getAgentAuthEnv(agentId)
  const sessionId = randomUUID()
  const probeTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(agentId, MIN_BROWSER_TIMEOUT_SECONDS)
  const probeMessage = `/new ${composeAgentDoctrinePrompt(
    agentId,
    [
      'Browser readiness probe:',
      '- Use browser tool on the currently attached tab only.',
      '- Do not open a new tab and do not navigate to a different URL.',
      '- Capture a quick browser snapshot to confirm tool availability.',
      '- Reply exactly BROWSER_PROBE_OK after completion',
      '- If browser tool is unavailable, reply BROWSER_PROBE_FAIL with one short reason',
    ].join('\n'),
    context.executionWorkspace,
    context.doctrineWorkspace,
  )}`

  const result = await runOpenClaw(
    withAgentRuntimeFlags([
      'agent',
      '--agent',
      agentId,
      '--session-id',
      sessionId,
      '--message',
      probeMessage,
      '--thinking',
      'off',
      '--timeout',
      String(probeTimeoutSeconds),
      '--json',
    ]),
    agentWorkTimeoutWrapperMs(probeTimeoutSeconds),
    { cwd: runCwdForContext(context), envOverrides },
  ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))

  await cleanupDoctrineMirrorsAfterRun(agentId, context.executionWorkspace)

  const reply = extractAgentReply(result.stdout, result.stderr)
  const combined = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`)
  const transportReady = /\[browser\/service\]\s*browser control service ready/i.test(combined)
  const hardFailure =
    hasBrowserRelayDisconnected(combined) ||
    hasBrowserRelayPortConflict(combined) ||
    /\[tools\]\s*browser failed|browser tool unavailable|\bBROWSER_PROBE_FAIL\b/i.test(combined)
  const ok = result.code === 0 && transportReady && !hardFailure
  const detail = stripAnsi(`${reply}\n${combined}`.trim()) || `code=${result.code}`
  browserProbeCache.set(agentId, { ok, checkedAt: Date.now(), detail })
  return { ok, detail }
}

const browserPreflightService = createBrowserPreflightService({
  ensureOpenclawAgentRunConfigDefaults,
  getOpenClawPluginEnabled,
  repairGatewayTokenConfigSync,
  ensureGatewayRunning,
  startGatewayHealthMonitor,
  isGatewayHealthy,
  tryRestartGatewayService,
  tryStartBrowserRelayWithRepair,
  runBrowserToolProbe,
  tryReleaseBrowserRelayPort: async () => {
    const released = await tryReleaseBrowserRelayPort()
    if (released.released) browserProbeCache.clear()
    return released
  },
  hasBrowserRelayPortConflict,
  hasNoAttachedBrowserTab,
  redactSensitiveText,
})

async function checkBrowserPreflight(agentId?: string) {
  return browserPreflightService.checkBrowserPreflight(agentId)
}

async function persistAllMissionRecords(reason: string) {
  await Promise.allSettled(Array.from(missions.values()).map((mission) => runtimeLedgerStore.appendMissionRecord(missionRecordSnapshot(mission, reason))))
}

const DEFAULT_CONTEXT_PRUNING_TOOL_DENY = ['browser', 'canvas']

function defaultContextPruningConfig(): OpenClawContextPruningConfig {
  return {
    mode: 'cache-ttl',
    ttl: '5m',
    keepLastAssistants: 2,
    softTrimRatio: 0.25,
    hardClearRatio: 0.4,
    minPrunableToolChars: 8000,
    // Browser text can be pruned safely; image blocks are protected by
    // OpenClaw's image sanitizer. Keep canvas denied because it is primarily
    // visual state and is not a useful token-saving target.
    tools: { deny: ['canvas'] },
    softTrim: { maxChars: 2000, headChars: 800, tailChars: 800 },
    hardClear: { enabled: true, placeholder: '[Old tool result content cleared]' },
  }
}

function applyNoBootstrapAgentConfig(entry: AgentConfigEntry) {
  const rawEntry = entry as Record<string, unknown>
  delete rawEntry.skipBootstrap
  delete rawEntry.skipOptionalBootstrapFiles
  delete rawEntry.contextInjection
  delete rawEntry.bootstrapMaxChars
  delete rawEntry.bootstrapTotalMaxChars
  delete rawEntry.bootstrapPromptTruncationWarning
  delete rawEntry.startupContext
  return entry
}

function defaultSessionConfig(): OpenClawSessionConfig {
  return {
    dmScope: 'per-channel-peer',
    maintenance: {
      mode: 'enforce',
      pruneAfter: '30d',
      maxEntries: 500,
    },
  }
}

function defaultMemoryConfig(): OpenClawMemoryConfig {
  return {
    backend: 'builtin',
    citations: 'auto',
    qmd: {
      searchMode: 'search',
      update: {
        interval: '5m',
        startup: 'off',
        commandTimeoutMs: 4000,
        updateTimeoutMs: 4000,
      },
      limits: {
        timeoutMs: 4000,
        maxResults: 10,
        maxSnippetChars: 1600,
        maxInjectedChars: 6000,
      },
      scope: {
        default: 'deny',
        rules: [
          { action: 'allow', match: { chatType: 'direct' } },
          { action: 'allow', match: { chatType: 'channel' } },
        ],
      },
    },
  }
}

function ensureGatewayConfigDefaults(config: OpenClawConfigFile) {
  if (!config.gateway) config.gateway = {}
  config.gateway.mode ??= 'local'
  const gateway = config.gateway as Record<string, unknown>
  const reload = (gateway.reload && typeof gateway.reload === 'object' && !Array.isArray(gateway.reload))
    ? gateway.reload as Record<string, unknown>
    : {}
  reload.mode ??= 'hybrid'
  reload.debounceMs ??= 500
  reload.deferralTimeoutMs ??= 300000
  gateway.reload = reload
  gateway.handshakeTimeoutMs ??= 30000
  gateway.channelHealthCheckMinutes ??= 5
  gateway.channelStaleEventThresholdMinutes ??= 30
  gateway.channelMaxRestartsPerHour ??= 4
}

function ensureModelRuntimeDefaults(config: OpenClawConfigFile) {
  if (!config.models) config.models = {}
  const models = config.models as Record<string, unknown>
  const pricing = (models.pricing && typeof models.pricing === 'object' && !Array.isArray(models.pricing))
    ? models.pricing as Record<string, unknown>
    : {}
  pricing.enabled ??= false
  models.pricing = pricing
}

function ensureContextPruningDefaults(defaults: NonNullable<NonNullable<OpenClawConfigFile['agents']>['defaults']>) {
  if (!defaults.contextPruning) {
    defaults.contextPruning = defaultContextPruningConfig()
    return
  }
  const pruning = defaults.contextPruning
  if (pruning.mode === 'off') return
  const baseline = defaultContextPruningConfig()
  const isLegacyAutomniaBaseline = pruning.ttl === '5m'
    && pruning.keepLastAssistants === 3
    && pruning.softTrimRatio === 0.3
    && pruning.hardClearRatio === 0.5
    && pruning.minPrunableToolChars === 50000
    && JSON.stringify(pruning.tools?.deny || []) === JSON.stringify(DEFAULT_CONTEXT_PRUNING_TOOL_DENY)
    && pruning.softTrim?.maxChars === 4000
    && pruning.softTrim?.headChars === 1500
    && pruning.softTrim?.tailChars === 1500
  if (isLegacyAutomniaBaseline) {
    defaults.contextPruning = defaultContextPruningConfig()
    return
  }
  pruning.mode ??= baseline.mode
  pruning.ttl ??= baseline.ttl
  pruning.keepLastAssistants ??= baseline.keepLastAssistants
  pruning.softTrimRatio ??= baseline.softTrimRatio
  pruning.hardClearRatio ??= baseline.hardClearRatio
  pruning.minPrunableToolChars ??= baseline.minPrunableToolChars
  if (!pruning.tools) pruning.tools = {}
  if (!Array.isArray(pruning.tools.deny)) pruning.tools.deny = [...DEFAULT_CONTEXT_PRUNING_TOOL_DENY]
  if (!pruning.softTrim) pruning.softTrim = {}
  pruning.softTrim.maxChars ??= baseline.softTrim?.maxChars
  pruning.softTrim.headChars ??= baseline.softTrim?.headChars
  pruning.softTrim.tailChars ??= baseline.softTrim?.tailChars
  if (!pruning.hardClear) pruning.hardClear = {}
  pruning.hardClear.enabled ??= baseline.hardClear?.enabled
  pruning.hardClear.placeholder ??= baseline.hardClear?.placeholder
}

function ensureSessionDefaults(config: OpenClawConfigFile) {
  if (!config.session) {
    config.session = defaultSessionConfig()
    return
  }
  const baseline = defaultSessionConfig()
  config.session.dmScope ??= baseline.dmScope
  if (!config.session.maintenance) config.session.maintenance = {}
  config.session.maintenance.mode ??= baseline.maintenance?.mode
  config.session.maintenance.pruneAfter ??= baseline.maintenance?.pruneAfter
  config.session.maintenance.maxEntries ??= baseline.maintenance?.maxEntries
}

function ensureMemoryDefaults(config: OpenClawConfigFile) {
  if (!config.memory) {
    config.memory = defaultMemoryConfig()
    return
  }
  const baseline = defaultMemoryConfig()
  config.memory.backend ??= baseline.backend
  config.memory.citations ??= baseline.citations
  if (!config.memory.qmd) config.memory.qmd = {}
  config.memory.qmd.searchMode ??= baseline.qmd?.searchMode
  config.memory.qmd.includeDefaultMemory ??= true
  if (!config.memory.qmd.update) config.memory.qmd.update = {}
  config.memory.qmd.update.interval ??= baseline.qmd?.update?.interval
  config.memory.qmd.update.startup ??= baseline.qmd?.update?.startup
  config.memory.qmd.update.commandTimeoutMs ??= baseline.qmd?.update?.commandTimeoutMs
  config.memory.qmd.update.updateTimeoutMs ??= baseline.qmd?.update?.updateTimeoutMs
  if (!config.memory.qmd.limits) config.memory.qmd.limits = {}
  config.memory.qmd.limits.timeoutMs ??= baseline.qmd?.limits?.timeoutMs
  config.memory.qmd.limits.maxResults ??= baseline.qmd?.limits?.maxResults
  config.memory.qmd.limits.maxSnippetChars ??= baseline.qmd?.limits?.maxSnippetChars
  config.memory.qmd.limits.maxInjectedChars ??= baseline.qmd?.limits?.maxInjectedChars
  config.memory.qmd.scope ??= baseline.qmd?.scope
  if (config.memory.backend === 'qmd') {
    if (!config.memory.qmd.sessions) config.memory.qmd.sessions = {}
    config.memory.qmd.sessions.enabled ??= true
  }
}

function toolPolicyListIncludes(list: unknown, entry: string) {
  const normalized = entry.trim().toLowerCase()
  return Array.isArray(list) && list.some((item) => typeof item === 'string' && item.trim().toLowerCase() === normalized)
}

function removeToolPolicyGrant(config: OpenClawConfigFile, entry: string) {
  if (!config.tools) return
  const normalized = entry.trim().toLowerCase()
  const filterGrant = (list: unknown) => Array.isArray(list)
    ? list.filter((item) => typeof item !== 'string' || item.trim().toLowerCase() !== normalized)
    : list
  config.tools.allow = filterGrant(config.tools.allow) as string[] | undefined
  config.tools.alsoAllow = filterGrant(config.tools.alsoAllow) as string[] | undefined
}

function ensureToolPolicyGrant(config: OpenClawConfigFile, entry: string) {
  if (!entry.trim()) return
  if (!config.tools) config.tools = {}
  const tools = config.tools
  if (toolPolicyListIncludes(tools.deny, entry)) return

  const alsoAllow = uniqueStrings(tools.alsoAllow)
  if (Array.isArray(tools.allow) && tools.allow.length > 0) {
    tools.allow = uniqueStrings(tools.allow, alsoAllow, entry)
    if (alsoAllow.length) delete tools.alsoAllow
    return
  }

  tools.profile = normalizeToolProfile(tools.profile) || 'coding'
  tools.alsoAllow = uniqueStrings(alsoAllow, entry)
}

function ensureBrowserRuntimeDefaults(config: OpenClawConfigFile) {
  if (DISABLE_BROWSER_RUNTIME_DEFAULTS || config.plugins?.enabled === false) return
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  const explicitBrowserDeny = Array.isArray(config.plugins.deny) && config.plugins.deny.includes(BROWSER_PLUGIN_ID)
  const existingBrowserEntry = config.plugins.entries[BROWSER_PLUGIN_ID]
  if (!explicitBrowserDeny && existingBrowserEntry?.enabled !== false) {
    config.plugins.entries[BROWSER_PLUGIN_ID] = {
      ...(existingBrowserEntry || {}),
      enabled: true,
    }
  }

  if (!explicitBrowserDeny) {
    const explicitToolDeny = Array.isArray(config.tools?.deny) && config.tools.deny.includes(BROWSER_PLUGIN_ID)
    if (!explicitToolDeny) {
      ensureToolPolicyGrant(config, BROWSER_PLUGIN_ID)
    }
  }
}

function openClawOptimizationStatus(config: OpenClawConfigFile) {
  const normalized = cloneJson(config)
  ensureOpenclawRuntimeDefaults(normalized)
  const pruning = normalized.agents?.defaults?.contextPruning
  const compaction = normalized.agents?.defaults?.compaction
  const session = normalized.session
  const memory = normalized.memory
  const agents = normalized.agents?.list || []
  const modelEntries = Object.values(normalized.agents?.defaults?.models || {})
  const fastAgentDefaults = agents.filter((entry) => normalizeFastModePreference(entry.fastModeDefault) === 'auto').length
  const fastModelDefaults = modelEntries.filter((entry) => {
    const params = entry?.params
    return params && typeof params === 'object' && !Array.isArray(params) && params.fastMode === 'auto'
  }).length
  return {
    compaction: {
      enabled: compaction?.enabled !== false,
      reserveTokensFloor: compaction?.reserveTokensFloor ?? null,
      keepRecentTokens: compaction?.keepRecentTokens ?? null,
      midTurnPrecheck: compaction?.midTurnPrecheck?.enabled === true,
      truncateAfterCompaction: compaction?.truncateAfterCompaction === true,
      notifyUser: compaction?.notifyUser === true,
    },
    fastMode: {
      default: normalizeFastModePreference(normalized.agents?.defaults?.fastModeDefault),
      autoCutoffSeconds: DEFAULT_OPENCLAW_FAST_AUTO_ON_SECONDS,
      agentAutoDefaults: fastAgentDefaults,
      modelAutoDefaults: fastModelDefaults,
    },
    contextPruning: {
      enabled: pruning?.mode === 'cache-ttl',
      mode: pruning?.mode || 'off',
      ttl: pruning?.ttl || 'default',
      keepLastAssistants: pruning?.keepLastAssistants ?? null,
      hardClear: pruning?.hardClear?.enabled !== false,
      minPrunableToolChars: pruning?.minPrunableToolChars ?? null,
      toolsDeny: Array.isArray(pruning?.tools?.deny) ? pruning.tools.deny : [],
    },
    contextTokens: normalized.agents?.defaults?.contextTokens ?? null,
    session: {
      dmScope: session?.dmScope || 'main',
      maintenanceMode: session?.maintenance?.mode || 'default',
      pruneAfter: session?.maintenance?.pruneAfter ?? null,
      maxEntries: session?.maintenance?.maxEntries ?? null,
    },
    memory: {
      backend: memory?.backend || 'builtin',
      citations: memory?.citations || 'auto',
      qmdEnabled: memory?.backend === 'qmd',
      qmdSearchMode: memory?.qmd?.searchMode || 'search',
      qmdSessionsEnabled: Boolean(memory?.qmd?.sessions?.enabled),
      qmdStartup: memory?.qmd?.update?.startup || 'off',
      qmdTimeoutMs: memory?.qmd?.limits?.timeoutMs ?? null,
    },
  }
}

function createInitialOpenclawConfig() {
  const bootstrapAgents = DEFAULT_BOOTSTRAP_AGENTS.filter((agent) => !isRetiredAgentId(agent.id))
  const config: OpenClawConfigFile = {
    gateway: { mode: 'local' },
    session: defaultSessionConfig(),
    memory: defaultMemoryConfig(),
    skills: {
      load: { watch: true, watchDebounceMs: 250, extraDirs: [SHARED_SKILLS_ROOT] },
      entries: {},
      install: { nodeManager: 'npm' as const },
    },
    plugins: { slots: {} },
    tools: {
      agentToAgent: {
        enabled: true,
        allow: bootstrapAgents.map((agent) => agent.id),
      },
    },
    agents: {
      defaults: {
        workspace: WORKSPACE_ROOT,
        model: defaultAgentModelSelection(),
        contextTokens: AUTOMNIA_OPENCLAW_CONTEXT_TOKENS,
        compaction: {
          reserveTokensFloor: AUTOMNIA_COMPACTION_RESERVE_TOKENS,
          keepRecentTokens: AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
          midTurnPrecheck: { enabled: true },
          truncateAfterCompaction: true,
          maxActiveTranscriptBytes: '8mb',
          notifyUser: false,
          memoryFlush: { enabled: false, softThresholdTokens: 4000 },
        },
        sandbox: { mode: 'off' as const, scope: 'agent' as const, workspaceAccess: 'rw' as const },
        skipBootstrap: true,
        skipOptionalBootstrapFiles: [...OPENCLAW_OPTIONAL_BOOTSTRAP_FILES],
        contextInjection: 'never',
        bootstrapMaxChars: 1,
        bootstrapTotalMaxChars: 1,
        bootstrapPromptTruncationWarning: 'off',
        startupContext: { enabled: false, applyOn: [] },
        contextPruning: defaultContextPruningConfig(),
        imageMaxDimensionPx: 1024,
        imageQuality: 'efficient',
      },
      list: bootstrapAgents.map((agent, index) => applyNoBootstrapAgentConfig({
        id: agent.id,
        ...(index === 0 ? { default: true } : {}),
        name: agent.name,
        identity: { name: agent.name, emoji: '@', theme: 'adventurer' },
        workspace: WORKSPACE_ROOT,
        model: defaultAgentModelSelection(),
        fastModeDefault: openClawFastModeDefault(DEFAULT_OPENCLAW_FAST_MODE),
        sandbox: { mode: 'off' as const, scope: 'agent' as const, workspaceAccess: 'rw' as const },
      })),
    },
  }
  ensureClawTalkBundledPluginDefaults(config)
  ensureBrowserRuntimeDefaults(config)
  return config
}

async function readCachedJsonFile<T>(
  filePath: string,
  cache: JsonFileCacheEntry<T> | null | undefined,
  parse: (raw: string) => T,
  updateCache: (entry: JsonFileCacheEntry<T>) => void,
): Promise<T> {
  const resolved = path.resolve(filePath)
  const now = Date.now()
  if (cache && cache.path === resolved && now - cache.checkedAt < JSON_DISK_CACHE_STAT_MS) {
    return cloneJson(cache.value)
  }

  const stat = await fs.stat(resolved)
  if (cache && cache.path === resolved && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    cache.checkedAt = now
    return cloneJson(cache.value)
  }

  const raw = await fs.readFile(resolved, 'utf-8')
  const value = parse(raw.replace(/^\uFEFF/, ''))
  updateCache({
    path: resolved,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    checkedAt: now,
    value: cloneJson(value),
  })
  return value
}

async function rememberJsonFileCache<T>(
  filePath: string,
  value: T,
  updateCache: (entry: JsonFileCacheEntry<T>) => void,
) {
  try {
    const resolved = path.resolve(filePath)
    const stat = await fs.stat(resolved)
    updateCache({
      path: resolved,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      checkedAt: Date.now(),
      value: cloneJson(value),
    })
  } catch {
    // Cache refresh is best-effort; the next read will fall back to disk.
  }
}

function enforcePersistedCompactionPolicy(config: OpenClawConfigFile) {
  const defaults = config.agents?.defaults
  if (!defaults) return false
  if (!defaults.compaction) defaults.compaction = {}
  const settings = defaults.compaction as AutomniaCompactionSettings
  const migrated = migrateAutomniaCompactBaseline(settings)
  return migrated || enforceAutomniaCompactionPolicy(settings)
}

function repairInvalidPersistedTelegramPolicy(config: OpenClawConfigFile) {
  return repairInvalidTelegramDmPolicy(config as unknown as Record<string, unknown>)
}

async function readOpenclawConfig() {
  let raw: string
  try {
    const cached = await readCachedJsonFile(
      OPENCLAW_CONFIG_PATH,
      openclawConfigCache,
      (text) => JSON.parse(text) as OpenClawConfigFile,
      (entry) => { openclawConfigCache = entry },
    )
    if (
      ensurePrimaryAgentSelection(cached, isRetiredAgentId)
      || sanitizeOpenClawConfigAgentAvatars(cached)
      || migrateGeneratedDeepSeekDefaultsInOpenClawConfig(cached)
      || pruneRetiredAgentsFromOpenClawConfig(cached)
      || repairInvalidPersistedTelegramPolicy(cached)
      || enforcePersistedCompactionPolicy(cached)
    ) {
      await writeOpenclawConfig(cached).catch(() => undefined)
    }
    return cached
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await writeOpenclawConfig(createInitialOpenclawConfig())
      raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf-8')
    } else if (error instanceof SyntaxError) {
      raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf-8')
    } else {
      throw error
    }
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as OpenClawConfigFile
      if (
        ensurePrimaryAgentSelection(parsed, isRetiredAgentId)
        || sanitizeOpenClawConfigAgentAvatars(parsed)
        || migrateGeneratedDeepSeekDefaultsInOpenClawConfig(parsed)
        || pruneRetiredAgentsFromOpenClawConfig(parsed)
        || repairInvalidPersistedTelegramPolicy(parsed)
        || enforcePersistedCompactionPolicy(parsed)
      ) {
        await writeOpenclawConfig(parsed).catch(() => undefined)
      }
      await rememberJsonFileCache(OPENCLAW_CONFIG_PATH, parsed, (entry) => { openclawConfigCache = entry })
      return parsed
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 75))
        raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf-8')
      }
    }
  }

  try {
    const fallbackRaw = await fs.readFile(`${OPENCLAW_CONFIG_PATH}.last-good`, 'utf-8')
    const parsed = JSON.parse(fallbackRaw.replace(/^\uFEFF/, '')) as OpenClawConfigFile
    if (
      ensurePrimaryAgentSelection(parsed, isRetiredAgentId)
      || sanitizeOpenClawConfigAgentAvatars(parsed)
      || migrateGeneratedDeepSeekDefaultsInOpenClawConfig(parsed)
      || pruneRetiredAgentsFromOpenClawConfig(parsed)
      || repairInvalidPersistedTelegramPolicy(parsed)
      || enforcePersistedCompactionPolicy(parsed)
    ) {
      await writeOpenclawConfig(parsed).catch(() => undefined)
    }
    await rememberJsonFileCache(OPENCLAW_CONFIG_PATH, parsed, (entry) => { openclawConfigCache = entry })
    return parsed
  } catch {
    throw lastError
  }
}

function isTransientFileLockError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

async function delayMs(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryTransientFileLock<T>(operation: () => Promise<T>, label: string, attempts = 10): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientFileLockError(error) || attempt === attempts - 1) throw error
      const waitMs = Math.min(1000, 75 * Math.pow(1.55, attempt))
      console.warn(`[file-lock-retry] ${label} failed with ${(error as NodeJS.ErrnoException).code}; retrying in ${Math.round(waitMs)}ms`)
      await delayMs(waitMs)
    }
  }
  throw lastError
}

async function readTextFileWithLockRetry(filePath: string) {
  return retryTransientFileLock(() => fs.readFile(filePath, 'utf-8'), `read ${filePath}`)
}

async function writeTextFileWithLockRetry(filePath: string, content: string) {
  return retryTransientFileLock(() => fs.writeFile(filePath, content, 'utf-8'), `write ${filePath}`)
}

async function renameWithLockRetry(fromPath: string, toPath: string) {
  return retryTransientFileLock(() => fs.rename(fromPath, toPath), `rename ${fromPath} -> ${toPath}`)
}

function isCompleteModelProviderConfig(value: unknown, providerId?: string): value is ModelProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const provider = value as ModelProviderConfig
  if (!Array.isArray(provider.models)) return false
  if (typeof provider.baseUrl === 'string' && provider.baseUrl.trim().length > 0) return true
  return providerId === 'openai' || providerId === 'google' || providerId === 'google-vertex' || providerId === 'deepseek'
}

function pruneIncompleteModelProviderConfigs(config: OpenClawConfigFile) {
  const providers = config.models?.providers
  if (!providers) return
  for (const [provider, providerConfig] of Object.entries(providers)) {
    if (!isCompleteModelProviderConfig(providerConfig, provider)) {
      delete providers[provider]
    }
  }
}

function normalizeModelSelectionForOpenClawConfig(value: { primary?: string; fallbacks?: string[] } | undefined) {
  if (!value) return
  const normalized = modelSelectionForOpenClawConfig({
    primary: value.primary,
    fallbacks: Array.isArray(value.fallbacks) ? value.fallbacks : [],
  })
  value.primary = normalized.primary
  if (normalized.fallbacks.length) {
    value.fallbacks = normalized.fallbacks
  } else {
    delete value.fallbacks
  }
}

function normalizeConfigModelField(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? primaryModelForOpenClawConfig(value)
    : value
}

function isLegacyOpenAiCodexProviderConfig(providerConfig: ModelProviderConfig | undefined) {
  if (!providerConfig) return false
  const apiKey = typeof providerConfig.apiKey === 'string' ? providerConfig.apiKey.trim() : ''
  const baseUrl = typeof providerConfig.baseUrl === 'string' ? providerConfig.baseUrl.trim() : ''
  const api = typeof providerConfig.api === 'string' ? providerConfig.api.trim() : ''
  return (
    apiKey === CODEX_APP_SERVER_AUTH_MARKER ||
    (baseUrl === CODEX_PROVIDER_BASE_URL && /openai-(?:chatgpt|codex)-responses/i.test(api))
  )
}

function rawProviderModelId(entry: unknown) {
  if (typeof entry === 'string') return entry.trim()
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const record = entry as { id?: unknown; model?: unknown; name?: unknown }
  return String(record.id || record.model || record.name || '').trim()
}

function migrateLegacyOpenAiCodexProviderConfig(config: OpenClawConfigFile) {
  const providers = config.models?.providers
  const openAiProvider = providers?.openai
  if (!providers || !openAiProvider || !isLegacyOpenAiCodexProviderConfig(openAiProvider)) return

  const remainingOpenAiModels: unknown[] = []
  for (const entry of Array.isArray(openAiProvider.models) ? openAiProvider.models : []) {
    const rawId = rawProviderModelId(entry)
    if (!rawId) continue
    const canonical = canonicalAgentModelId(`openai/${rawId}`)
    const { provider, model } = splitModelId(canonical)
    if (provider === 'openai' && model && isModelSafeForOpenClawConfig(canonical)) {
      const normalizedEntry: Record<string, unknown> = entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...(entry as Record<string, unknown>) } : { id: model, name: model }
      normalizedEntry.id = model
      if (!normalizedEntry.name) normalizedEntry.name = model
      if (normalizedEntry.api === 'openai-chatgpt-responses') normalizedEntry.api = 'openai-responses'
      delete normalizedEntry.baseUrl
      remainingOpenAiModels.push(normalizedEntry)
    } else {
      remainingOpenAiModels.push(entry)
    }
  }

  if (remainingOpenAiModels.length) {
    openAiProvider.models = remainingOpenAiModels
    // ChatGPT/Codex OAuth model discovery must not silently select the Codex
    // app-server harness for every OpenAI tool turn. Direct streaming can use
    // the OAuth credential without that embedded runner; users who want the
    // native harness can explicitly choose it in their OpenClaw config.
    delete openAiProvider.agentRuntime
    delete openAiProvider.apiKey
    delete openAiProvider.auth
    if (openAiProvider.baseUrl === CODEX_PROVIDER_BASE_URL) delete openAiProvider.baseUrl
    if (openAiProvider.api === 'openai-chatgpt-responses') openAiProvider.api = 'openai-responses'
  } else {
    delete providers.openai
  }
}

function pruneTopLevelCodexProviderConfig(config: OpenClawConfigFile) {
  const providers = config.models?.providers
  const codexProvider = providers?.codex
  if (!providers || !codexProvider) return
  if (isLegacyOpenAiCodexProviderConfig(codexProvider) || codexProvider.api === 'openai-codex-responses') {
    delete providers.codex
  }
}

function pruneOpenClawConfigProviderModels(config: OpenClawConfigFile) {
  const providers = config.models?.providers
  if (!providers) return

  for (const providerId of ['openai', 'google', 'google-vertex', 'deepseek']) {
    const providerConfig = providers[providerId]
    if (!providerConfig || !Array.isArray(providerConfig.models)) continue
    const seen = new Set<string>()
    providerConfig.models = providerConfig.models.filter((entry) => {
      const rawId = rawProviderModelId(entry)
      const modelId = rawId ? `${providerId}/${rawId}` : ''
      if (!modelId || !isModelSafeForOpenClawConfig(modelId)) return false
      const canonicalModel = splitModelId(canonicalAgentModelId(modelId)).model
      if (!canonicalModel || seen.has(canonicalModel)) return false
      seen.add(canonicalModel)
      return true
    })
  }
}

function modelSelectionUsesProvider(selection: { primary?: string; fallbacks?: string[] } | undefined, providerId: string) {
  if (!selection) return false
  const provider = providerId.trim().toLowerCase()
  const modelIds = [selection.primary, ...(selection.fallbacks || [])]
  return modelIds.some((modelId) => splitModelId(canonicalAgentModelId(modelId)).provider.toLowerCase() === provider)
}

function configUsesProviderModel(config: OpenClawConfigFile, providerId: string) {
  if (modelSelectionUsesProvider(config.agents?.defaults?.model, providerId)) return true
  for (const entry of config.agents?.list || []) {
    if (modelSelectionUsesProvider(entry.model, providerId)) return true
  }
  for (const modelId of Object.keys(config.agents?.defaults?.models || {})) {
    if (splitModelId(canonicalAgentModelId(modelId)).provider.toLowerCase() === providerId.toLowerCase()) return true
  }
  return false
}

function selectionLooksLikeOpenAiDefault(selection: { primary?: string; fallbacks?: string[] } | undefined) {
  if (!selection) return true
  const primary = canonicalAgentModelId(selection.primary)
  if (!primary) return true
  if (!isOpenAiCodexSubscriptionModel(primary) && !OPENAI_DEFAULT_MODEL_IDS.has(primary)) return false
  return (selection.fallbacks || []).every((modelId) => {
    const canonical = canonicalAgentModelId(modelId)
    return !canonical || isOpenAiCodexSubscriptionModel(canonical) || OPENAI_DEFAULT_MODEL_IDS.has(canonical)
  })
}

function applyDeepSeekOnlyModelSelectionDefaults(selection: { primary?: string; fallbacks?: string[] } | undefined) {
  if (!selection || !selectionLooksLikeOpenAiDefault(selection)) return false
  const next = defaultAgentModelSelection()
  selection.primary = next.primary
  if (next.fallbacks?.length) selection.fallbacks = [...next.fallbacks]
  else delete selection.fallbacks
  return true
}

function removeCodexPluginDefaultRoute(config: OpenClawConfigFile) {
  const entry = config.plugins?.entries?.codex
  if (!entry) return false
  const keys = Object.keys(entry as Record<string, unknown>).filter((key) => key !== 'enabled')
  if (!keys.length) {
    delete config.plugins?.entries?.codex
  } else {
    entry.enabled = false
  }
  if (Array.isArray(config.plugins?.allow)) {
    config.plugins.allow = config.plugins.allow.filter((id) => id !== 'codex')
  }
  return true
}

function applyDeepSeekOnlyRuntimeDefaults(config: OpenClawConfigFile) {
  if (!DEEPSEEK_ONLY_DEFAULTS) return false
  let changed = false

  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}
  if (!config.agents.defaults.model) config.agents.defaults.model = {}
  changed = applyDeepSeekOnlyModelSelectionDefaults(config.agents.defaults.model) || changed

  for (const entry of config.agents.list || []) {
    if (!entry.model) entry.model = {}
    changed = applyDeepSeekOnlyModelSelectionDefaults(entry.model) || changed
  }

  if (config.agents.defaults.models) {
    for (const modelId of Object.keys(config.agents.defaults.models)) {
      const provider = splitModelId(canonicalAgentModelId(modelId)).provider.toLowerCase()
      if (provider === 'openai' || provider === 'openai-codex' || provider === 'codex') {
        delete config.agents.defaults.models[modelId]
        changed = true
      }
    }
  }

  if (!configUsesProviderModel(config, 'openai')) {
    if (config.models?.providers?.openai) {
      delete config.models.providers.openai
      changed = true
    }
    if (removeCodexPluginDefaultRoute(config)) changed = true
  }

  return changed
}

function pruneOpenClawLegacyConfigKeys(config: OpenClawConfigFile) {
  const defaults = config.agents?.defaults as Record<string, unknown> | undefined
  if (defaults) {
    delete defaults.systemPromptOverride
    delete defaults.fastModeDefault
    const memorySearch = defaults.memorySearch
    if (memorySearch && typeof memorySearch === 'object' && !Array.isArray(memorySearch)) {
      delete (memorySearch as Record<string, unknown>).store
    }
  }
  for (const entry of config.agents?.list || []) {
    delete (entry as Record<string, unknown>).systemPromptOverride
  }
  if (Array.isArray(config.plugins?.allow) && config.plugins.allow.length && config.plugins.bundledDiscovery === undefined) {
    config.plugins.bundledDiscovery = 'compat'
  }
}

function isGoogleVertexAiplatformBaseUrl(baseUrl: unknown) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase()
    return hostname === 'aiplatform.googleapis.com'
      || hostname.endsWith(GOOGLE_VERTEX_REGION_HOST_SUFFIX)
      || GOOGLE_VERTEX_MULTI_REGION_HOSTS.has(hostname)
  } catch {
    return false
  }
}

function ensureGoogleVertexGlobalRouting(config: OpenClawConfigFile) {
  if (!configUsesProviderModel(config, 'google-vertex') && !config.models?.providers?.['google-vertex']) return

  if (!config.models) config.models = {}
  if (!config.models.providers) config.models.providers = {}
  const providerConfig = config.models.providers['google-vertex'] ||= {}
  providerConfig.api = 'google-vertex'
  providerConfig.apiKey ||= 'gcp-vertex-credentials'
  applyGoogleVertexModelLimits(providerConfig as Record<string, unknown>)
  if (!providerConfig.baseUrl || isGoogleVertexAiplatformBaseUrl(providerConfig.baseUrl)) {
    providerConfig.baseUrl = GOOGLE_VERTEX_GLOBAL_BASE_URL
  }

  if (!config.env || typeof config.env !== 'object' || Array.isArray(config.env)) config.env = {}
  const env = config.env as Record<string, unknown>
  const vars = env.vars && typeof env.vars === 'object' && !Array.isArray(env.vars)
    ? env.vars as Record<string, unknown>
    : {}

  env.GOOGLE_CLOUD_LOCATION = GOOGLE_VERTEX_GLOBAL_LOCATION
  vars.GOOGLE_CLOUD_LOCATION = GOOGLE_VERTEX_GLOBAL_LOCATION
  for (const key of GOOGLE_VERTEX_LOCATION_KEYS) {
    if (typeof env[key] === 'string' && (env[key] as string).trim()) env[key] = GOOGLE_VERTEX_GLOBAL_LOCATION
    if (typeof vars[key] === 'string' && (vars[key] as string).trim()) vars[key] = GOOGLE_VERTEX_GLOBAL_LOCATION
  }
  env.vars = vars
}

function normalizeOpenClawConfigModelRefs(config: OpenClawConfigFile) {
  normalizeModelSelectionForOpenClawConfig(config.agents?.defaults?.model)
  for (const entry of config.agents?.list || []) {
    normalizeModelSelectionForOpenClawConfig(entry.model)
  }
  const runtimeDefaults = config.agents?.defaults as Record<string, unknown> | undefined
  const heartbeat = runtimeDefaults?.heartbeat
  if (heartbeat && typeof heartbeat === 'object' && !Array.isArray(heartbeat)) {
    ;(heartbeat as Record<string, unknown>).model = normalizeConfigModelField((heartbeat as Record<string, unknown>).model)
  }
  const subagents = runtimeDefaults?.subagents
  if (subagents && typeof subagents === 'object' && !Array.isArray(subagents)) {
    ;(subagents as Record<string, unknown>).model = normalizeConfigModelField((subagents as Record<string, unknown>).model)
  }

  const defaultsWithImageModel = config.agents?.defaults as { imageModel?: { primary?: string; fallbacks?: string[] } } | undefined
  if (defaultsWithImageModel?.imageModel?.primary && isOpenAiCodexSubscriptionModel(defaultsWithImageModel.imageModel.primary)) {
    delete defaultsWithImageModel.imageModel
  }

  const defaults = config.agents?.defaults
  const models = defaults?.models
  if (models && typeof models === 'object' && !Array.isArray(models)) {
    const normalizedModels: Record<string, OpenClawModelAllowlistEntry> = {}
    for (const [modelId, entry] of Object.entries(models)) {
      const canonicalModelId = canonicalAgentModelId(modelId)
      if (!isModelSafeForOpenClawConfig(canonicalModelId)) continue
      normalizedModels[canonicalModelId] = {
        ...(normalizedModels[canonicalModelId] && typeof normalizedModels[canonicalModelId] === 'object'
          ? normalizedModels[canonicalModelId] as Record<string, unknown>
          : {}),
        ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {}),
      }
    }
    defaults.models = normalizedModels
    ensureConfiguredModelAllowlist(config, Object.keys(normalizedModels))
  }

  migrateLegacyOpenAiCodexProviderConfig(config)
  pruneTopLevelCodexProviderConfig(config)
  pruneOpenClawConfigProviderModels(config)
  ensureGoogleVertexGlobalRouting(config)
}

function applyAutomniaCreditsCompactToolPolicy(config: OpenClawConfigFile) {
  const current = config.tools || {}
  const allow = [...AUTOMNIA_CREDITS_COMPACT_TOOL_ALLOWLIST]
  config.tools = {
    ...current,
    byProvider: {
      ...(current.byProvider || {}),
      [AUTOMNIA_CREDITS_PROVIDER_ID]: {
        ...(current.byProvider?.[AUTOMNIA_CREDITS_PROVIDER_ID] || {}),
        allow,
      },
    },
  }
}

function applyTokenEfficientContextLimits(
  entry: AgentConfigEntry,
) {
  const current = entry.contextLimits
  const next = current || {}
  if (next.memoryGetMaxChars === undefined || next.memoryGetMaxChars > AUTOMNIA_CREDITS_COMPACT_MEMORY_GET_MAX_CHARS) {
    next.memoryGetMaxChars = AUTOMNIA_CREDITS_COMPACT_MEMORY_GET_MAX_CHARS
  }
  if (next.memoryGetDefaultLines === undefined || next.memoryGetDefaultLines > 20) next.memoryGetDefaultLines = 20
  if (next.toolResultMaxChars === undefined || next.toolResultMaxChars > AUTOMNIA_CREDITS_COMPACT_TOOL_RESULT_MAX_CHARS) {
    next.toolResultMaxChars = AUTOMNIA_CREDITS_COMPACT_TOOL_RESULT_MAX_CHARS
  }
  if (next.postCompactionMaxChars === undefined || next.postCompactionMaxChars > AUTOMNIA_CREDITS_COMPACT_POST_COMPACTION_MAX_CHARS) {
    next.postCompactionMaxChars = AUTOMNIA_CREDITS_COMPACT_POST_COMPACTION_MAX_CHARS
  }
  entry.contextLimits = next
}

function ensureOpenclawRuntimeDefaults(config: OpenClawConfigFile) {
  pruneOpenClawLegacyConfigKeys(config)
  sanitizeOpenClawConfigAgentAvatars(config)
  ensureGatewayConfigDefaults(config)
  ensureSessionDefaults(config)
  ensureMemoryDefaults(config)
  if (!config.models) config.models = {}
  if (!config.models.providers) config.models.providers = {}
  ensureModelRuntimeDefaults(config)
  pruneIncompleteModelProviderConfigs(config)

  if (!config.skills) config.skills = {}
  if (!config.skills.load) config.skills.load = {}
  if (!config.skills.entries) config.skills.entries = {}
  if (!config.skills.install) config.skills.install = {}
  config.skills.load.watch ??= true
  config.skills.load.watchDebounceMs ??= 250
  config.skills.load.extraDirs = uniqueStrings(SHARED_SKILLS_ROOT, config.skills.load.extraDirs)
  config.skills.install.nodeManager ??= 'npm'

  if (!config.plugins) config.plugins = {}
  if (!config.plugins.slots) config.plugins.slots = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  if (Array.isArray(config.plugins.allow) && config.plugins.allow.length && config.plugins.bundledDiscovery === undefined) {
    config.plugins.bundledDiscovery = 'compat'
  }
  sanitizeBundledPluginLoadPaths(config)

  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}
  normalizeOpenClawConfigModelRefs(config)
  migrateGeneratedDeepSeekDefaultsInOpenClawConfig(config)
  if (configHasOpenRouterPluginEnabled(config) || isProviderConfigured('openrouter')) {
    ensureOpenRouterModelCatalogAllowlist(config)
  }
  if (!Array.isArray(config.agents.list) || !config.agents.list.length) {
    config.agents.list = createInitialOpenclawConfig().agents?.list || []
  }
  ensurePrimaryAgentSelection(config, isRetiredAgentId)
  applyDeepSeekOnlyRuntimeDefaults(config)
  ensureClawTalkBundledPluginDefaults(config)
  ensureCodexPluginExplicitEnablement(config)
  ensureBrowserRuntimeDefaults(config)
  ensureTrustedPluginAllowlist(config)
  const defaults = config.agents.defaults

  defaults.sandbox = normalizeSandboxConfig(defaults.sandbox || { mode: 'off', scope: 'agent', workspaceAccess: 'rw' })
  defaults.skipBootstrap = true
  defaults.contextInjection = 'never'
  defaults.bootstrapMaxChars = 1
  defaults.bootstrapTotalMaxChars = 1
  defaults.bootstrapPromptTruncationWarning = 'off'
  defaults.skipOptionalBootstrapFiles = uniqueStrings(
    ...(defaults.skipOptionalBootstrapFiles || []),
    ...OPENCLAW_OPTIONAL_BOOTSTRAP_FILES,
  )
  defaults.startupContext = {
    ...(defaults.startupContext || {}),
    enabled: false,
    applyOn: [],
  }

  if (!defaults.compaction) defaults.compaction = {}
  if (!defaults.compaction.midTurnPrecheck) defaults.compaction.midTurnPrecheck = {}
  if (!defaults.compaction.memoryFlush) defaults.compaction.memoryFlush = {}
  const automniaDefaultCompactionSettings = defaults.compaction.reserveTokensFloor === 24000
    && defaults.compaction.keepRecentTokens === 50000
    && defaults.compaction.midTurnPrecheck.enabled === false
    && defaults.compaction.truncateAfterCompaction === false
    && defaults.compaction.maxActiveTranscriptBytes === '20mb'
    && defaults.compaction.memoryFlush.enabled === false
  if (automniaDefaultCompactionSettings) {
    // Migrate the previous Automnia baseline. The exact-shape check keeps a
    // user's independently customized compaction settings intact while
    // repairing existing installs that still use the failing 24k floor.
    defaults.compaction.reserveTokensFloor = 50000
  }
  const legacyAggressiveCompactionDefaults = defaults.compaction.reserveTokensFloor === 60000
    && defaults.compaction.keepRecentTokens === 50000
    && defaults.compaction.midTurnPrecheck.enabled === true
    && defaults.compaction.truncateAfterCompaction === true
    && defaults.compaction.maxActiveTranscriptBytes === '12mb'
    && defaults.compaction.memoryFlush.enabled === true
  if (legacyAggressiveCompactionDefaults) {
    // Migrate the bundle previously generated by Automnia. The exact-shape
    // check keeps a user's independently customized compaction settings
    // intact while fixing existing installs that still carry the old bundle.
    defaults.compaction.reserveTokensFloor = 50000
    defaults.compaction.midTurnPrecheck.enabled = false
    defaults.compaction.truncateAfterCompaction = false
    defaults.compaction.maxActiveTranscriptBytes = '20mb'
    defaults.compaction.memoryFlush.enabled = false
    if (defaults.contextLimits?.toolResultMaxChars === 10000) defaults.contextLimits.toolResultMaxChars = 16000
    if (defaults.contextLimits?.postCompactionMaxChars === 1200) defaults.contextLimits.postCompactionMaxChars = 2400
  }
  const legacyLongContextCompactionDefaults = defaults.compaction.reserveTokensFloor === 50_000
    && defaults.compaction.keepRecentTokens === 50_000
    && defaults.compaction.midTurnPrecheck.enabled === false
    && defaults.compaction.truncateAfterCompaction === false
    && defaults.compaction.maxActiveTranscriptBytes === '20mb'
    && defaults.compaction.notifyUser === true
    && defaults.compaction.memoryFlush.enabled === false
  if (legacyLongContextCompactionDefaults) {
    // The previous 50k/20mb baseline kept too much transcript in every
    // hosted tool turn. Migrate only the exact generated shape so a user's
    // independent compaction choices remain theirs.
    defaults.compaction.reserveTokensFloor = AUTOMNIA_COMPACTION_RESERVE_TOKENS
    defaults.compaction.keepRecentTokens = AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS
    defaults.compaction.midTurnPrecheck.enabled = true
    defaults.compaction.truncateAfterCompaction = true
    defaults.compaction.maxActiveTranscriptBytes = '8mb'
    defaults.compaction.notifyUser = false
  }
  migrateAutomniaCompactBaseline(defaults.compaction as AutomniaCompactionSettings)
  enforceAutomniaCompactionPolicy(defaults.compaction as AutomniaCompactionSettings)
  // Keep enough room for the Telegram relay to recover a compacted turn.
  defaults.compaction.reserveTokensFloor ??= AUTOMNIA_COMPACTION_RESERVE_TOKENS
  defaults.compaction.keepRecentTokens ??= AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS
  defaults.compaction.midTurnPrecheck.enabled ??= true
  defaults.compaction.truncateAfterCompaction ??= true
  defaults.compaction.maxActiveTranscriptBytes ??= '8mb'
  defaults.compaction.notifyUser ??= false
  defaults.compaction.memoryFlush.enabled ??= false
  defaults.compaction.memoryFlush.softThresholdTokens ??= 4000
  defaults.compaction.memoryFlush.systemPrompt ??= 'Session nearing compaction. Store durable memories now.'
  defaults.compaction.memoryFlush.prompt ??=
    'Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.'

  if (!defaults.contextLimits) defaults.contextLimits = {}
  const legacyDefaultContextLimits = defaults.contextLimits.memoryGetMaxChars === 8000
    && defaults.contextLimits.memoryGetDefaultLines === 80
    && defaults.contextLimits.toolResultMaxChars === 16000
    && defaults.contextLimits.postCompactionMaxChars === 2400
  if (legacyDefaultContextLimits) {
    defaults.contextLimits.memoryGetMaxChars = 4000
    defaults.contextLimits.memoryGetDefaultLines = 40
    defaults.contextLimits.toolResultMaxChars = 8000
    defaults.contextLimits.postCompactionMaxChars = 1200
  }
  defaults.contextLimits.memoryGetMaxChars ??= 4000
  defaults.contextLimits.memoryGetDefaultLines ??= 40
  defaults.contextLimits.toolResultMaxChars ??= 8000
  defaults.contextLimits.postCompactionMaxChars ??= 1200
  const configuredContextTokens = Number(defaults.contextTokens)
  const hasExplicitContextTokenOverride = Boolean(process.env.AUTOMNIA_OPENCLAW_CONTEXT_TOKENS?.trim())
  const legacyAutomniaContextBaseline = !hasExplicitContextTokenOverride && configuredContextTokens === 24_000
  if (legacyAutomniaContextBaseline) {
    // 24k was the previous token-saving baseline. It leaves OpenClaw's
    // documented 20k recovery reserve no usable prompt budget, so migrate
    // only that exact default while preserving explicit operator overrides.
    defaults.contextTokens = AUTOMNIA_OPENCLAW_CONTEXT_TOKENS
    for (const provider of Object.values(config.models?.providers || {})) {
      if (!provider || !Array.isArray(provider.models)) continue
      provider.models = provider.models.map((model) => (
        model && typeof model === 'object' && !Array.isArray(model) && (model as Record<string, unknown>).contextTokens === 24_000
          ? { ...(model as Record<string, unknown>), contextTokens: AUTOMNIA_OPENCLAW_CONTEXT_TOKENS }
          : model
      ))
    }
  } else if (!Number.isFinite(configuredContextTokens) || configuredContextTokens > AUTOMNIA_OPENCLAW_CONTEXT_TOKENS) {
    defaults.contextTokens = AUTOMNIA_OPENCLAW_CONTEXT_TOKENS
  }
  defaults.imageMaxDimensionPx ??= 1024
  defaults.imageQuality ??= 'efficient'

  ensureContextPruningDefaults(defaults)

  for (const entry of config.agents.list || []) {
    entry.fastModeDefault ??= openClawFastModeDefault(DEFAULT_OPENCLAW_FAST_MODE)
    if (entry.sandbox?.mode === 'off') entry.tools = unrestrictedAgentToolsConfig()
    applyNoBootstrapAgentConfig(entry)
    applyTokenEfficientContextLimits(entry)
  }

  if (!defaults.memorySearch) defaults.memorySearch = {}
  if (!defaults.memorySearch.sync) defaults.memorySearch.sync = {}
  if (!defaults.memorySearch.cache) defaults.memorySearch.cache = {}
  if (!defaults.memorySearch.query) defaults.memorySearch.query = {}
  if (!defaults.memorySearch.query.hybrid) defaults.memorySearch.query.hybrid = {}
  delete defaults.memorySearch.store

  // Embedding search can incur provider billing and, when the account is not
  // active, older gateways retry it in a hot loop. Durable markdown memory is
  // still available; semantic/vector search and its file watcher are opt-in.
  defaults.memorySearch.enabled ??= false
  defaults.memorySearch.sync.watch ??= false
  defaults.memorySearch.cache.enabled ??= true
  defaults.memorySearch.cache.maxEntries ??= 50000

  defaults.memorySearch.query.hybrid.enabled ??= true
  defaults.memorySearch.query.hybrid.vectorWeight ??= 0.7
  defaults.memorySearch.query.hybrid.textWeight ??= 0.3
  defaults.memorySearch.query.hybrid.candidateMultiplier ??= 4

  if (!config.tools) config.tools = {}
  applyAutomniaCreditsCompactToolPolicy(config)
  if (!config.tools.agentToAgent) config.tools.agentToAgent = {}
  const allowedAgents = new Set((config.agents.list || []).map((entry) => entry.id).filter((id) => id && !isRetiredAgentId(id)))
  config.tools.agentToAgent.enabled ??= true
  const existingAllow = Array.isArray(config.tools.agentToAgent.allow) ? config.tools.agentToAgent.allow : []
  const merged = new Set(existingAllow.filter((agentId) => allowedAgents.has(agentId)))
  for (const agentId of allowedAgents) merged.add(agentId)
  config.tools.agentToAgent.allow = Array.from(merged)
  ensureFastModeDefaults(config)
}

function normalizeWorkTimeoutSeconds(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(30, Math.min(86400, Math.round(numeric)))
}

function normalizeFastModePreference(value: unknown, fallback: FastModePreference = DEFAULT_OPENCLAW_FAST_MODE): FastModePreference {
  if (value === 'auto') return 'auto'
  if (value === true || value === 'on' || value === 'true' || value === 'enabled') return 'on'
  if (value === false || value === 'off' || value === 'false' || value === 'disabled') return 'off'
  return fallback
}

function openClawFastModeDefault(value: unknown, fallback: FastModePreference = DEFAULT_OPENCLAW_FAST_MODE): OpenClawFastModeDefault {
  const normalized = normalizeFastModePreference(value, fallback)
  return normalized === 'auto' ? 'auto' : normalized === 'on'
}

function openClawChatFastMode(value: unknown): OpenClawChatFastMode | null {
  const normalized = normalizeFastModePreference(value, 'off')
  if (normalized === 'auto') return 'auto'
  if (normalized === 'on') return true
  return null
}

function shouldApplyFastModeModelParams(modelId: string) {
  const provider = splitModelId(modelId).provider
  return FAST_MODE_MODEL_PARAM_PROVIDERS.has(provider)
}

function ensureFastModeModelParams(config: OpenClawConfigFile, modelId: string) {
  if (!shouldApplyFastModeModelParams(modelId)) return
  const entry = config.agents?.defaults?.models?.[modelId]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
  const params = entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
    ? entry.params
    : {}
  params.fastMode ??= 'auto'
  params.fastAutoOnSeconds ??= DEFAULT_OPENCLAW_FAST_AUTO_ON_SECONDS
  entry.params = params
}

function ensureFastModeDefaults(config: OpenClawConfigFile) {
  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}
  for (const entry of config.agents.list || []) {
    entry.fastModeDefault ??= openClawFastModeDefault(DEFAULT_OPENCLAW_FAST_MODE)
  }
  for (const modelId of Object.keys(config.agents.defaults.models || {})) {
    ensureFastModeModelParams(config, modelId)
  }
}

const OPENCLAW_AGENT_RUNTIME_WRAPPER_GRACE_MS = 10_000

function agentWorkTimeoutWrapperMs(timeoutSeconds: number, graceMs = OPENCLAW_AGENT_RUNTIME_WRAPPER_GRACE_MS) {
  const normalized = normalizeWorkTimeoutSeconds(timeoutSeconds) ?? 30
  return normalized * 1000 + Math.max(0, graceMs)
}

async function resolveEffectiveAgentWorkTimeoutSeconds(agentId: string, requested: unknown) {
  const requestedTimeout = normalizeWorkTimeoutSeconds(requested) ?? 30
  const [local, config] = await Promise.all([
    readAgentLocalConfigIfPresent(agentId).catch(() => null),
    readOpenclawConfig().catch(() => null),
  ])
  const localTimeout = normalizeWorkTimeoutSeconds(local?.runtime?.timeoutSeconds)
  const defaultTimeout = normalizeWorkTimeoutSeconds(config?.agents?.defaults?.timeoutSeconds)
  return Math.max(requestedTimeout, localTimeout ?? defaultTimeout ?? 0)
}

async function resolveEffectiveAgentFastMode(agentId: string, requested: unknown) {
  if (requested !== undefined && requested !== null) return normalizeFastModePreference(requested, DEFAULT_OPENCLAW_FAST_MODE)
  const local = await readAgentLocalConfigIfPresent(agentId).catch(() => null)
  return normalizeFastModePreference(local?.runtime?.fastModeDefault, DEFAULT_OPENCLAW_FAST_MODE)
}

async function syncModelProviderTimeoutsFromAgentSettings(config: OpenClawConfigFile) {
  const agents = config.agents?.list || []
  if (!agents.length) return

  const defaultsModel = config.agents?.defaults?.model || {}
  const providerTimeouts = new Map<string, number>()
  let maxWorkTimeoutSeconds: number | null = null

  for (const entry of agents) {
    const agentId = entry.id?.trim()
    if (!agentId || isRetiredAgentId(agentId)) continue
    const local = await readAgentLocalConfigIfPresent(agentId).catch(() => null)
    const timeoutSeconds = normalizeWorkTimeoutSeconds(local?.runtime?.timeoutSeconds)
    if (timeoutSeconds === null) continue
    maxWorkTimeoutSeconds = Math.max(maxWorkTimeoutSeconds || 0, timeoutSeconds)
    if (agentId === 'main') continue

    const model = normalizeModelWithFallback(local?.model || entry.model, defaultsModel)
    const providerTimeoutSeconds = Math.max(timeoutSeconds, OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS)
    for (const modelId of [model.primary, ...model.fallbacks]) {
      const provider = splitModelId(modelId).provider
      if (!provider) continue
      if (!isCompleteModelProviderConfig(config.models?.providers?.[provider], provider)) continue
      providerTimeouts.set(provider, Math.max(providerTimeouts.get(provider) || 0, providerTimeoutSeconds))
    }
  }

  if (maxWorkTimeoutSeconds !== null && config.agents?.defaults) {
    config.agents.defaults.timeoutSeconds = maxWorkTimeoutSeconds
  }

  if (!providerTimeouts.size) return
  const providers = config.models?.providers
  if (!providers) return
  for (const [provider, timeoutSeconds] of providerTimeouts) {
    const providerConfig = providers[provider]
    if (!isCompleteModelProviderConfig(providerConfig, provider)) continue
    const existingTimeoutSeconds = normalizeWorkTimeoutSeconds(providerConfig.timeoutSeconds)
    providers[provider] = {
      ...providerConfig,
      timeoutSeconds: Math.max(existingTimeoutSeconds ?? 0, timeoutSeconds),
    }
  }
}

const DEFAULT_HEARTBEAT_RUNTIME: HeartbeatRuntimeDefaults = {
  model: DEFAULT_AGENT_MODEL_ID,
  thinking: 'minimal',
  timeoutSeconds: 180,
  wake: 'next-heartbeat',
  session: 'isolated',
  announce: false,
  leadAgent: 'auto-highest-level',
}

function normalizeHeartbeatRuntimeDefaultsState(value: unknown): Partial<HeartbeatRuntimeDefaults> | null {
  return isLooseRecord(value) ? value as Partial<HeartbeatRuntimeDefaults> : null
}

async function readHeartbeatRuntimeDefaults(): Promise<HeartbeatRuntimeDefaults> {
  let raw =
    normalizeHeartbeatRuntimeDefaultsState(
      readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults),
    ) || {}
  if (!Object.keys(raw).length) {
    const legacy = await readLegacyJsonState(HEARTBEAT_DEFAULTS_PATH, normalizeHeartbeatRuntimeDefaultsState)
    if (legacy) {
      writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults, legacy, HEARTBEAT_DEFAULTS_PATH)
      raw = legacy
    }
  }

  const rawModel = typeof raw.model === 'string' ? raw.model : DEFAULT_HEARTBEAT_RUNTIME.model
  const model = migrateGeneratedDeepSeekDefaultPrimary(rawModel.trim())
    || DEFAULT_HEARTBEAT_RUNTIME.model

  return {
    model: model.trim(),
    thinking: raw.thinking || DEFAULT_HEARTBEAT_RUNTIME.thinking,
    timeoutSeconds: Number.isFinite(raw.timeoutSeconds)
      ? Math.max(30, Math.min(7200, Math.round(raw.timeoutSeconds as number)))
      : DEFAULT_HEARTBEAT_RUNTIME.timeoutSeconds,
    wake: raw.wake || DEFAULT_HEARTBEAT_RUNTIME.wake,
    session: raw.session || DEFAULT_HEARTBEAT_RUNTIME.session,
    announce: raw.announce ?? DEFAULT_HEARTBEAT_RUNTIME.announce,
    leadAgent: (raw.leadAgent || DEFAULT_HEARTBEAT_RUNTIME.leadAgent).trim() || DEFAULT_HEARTBEAT_RUNTIME.leadAgent,
  }
}

async function writeHeartbeatRuntimeDefaults(defaults: HeartbeatRuntimeDefaults) {
  if (writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatDefaults, defaults, HEARTBEAT_DEFAULTS_PATH)) return
  await fs.mkdir(path.dirname(HEARTBEAT_DEFAULTS_PATH), { recursive: true })
  await fs.writeFile(HEARTBEAT_DEFAULTS_PATH, `${JSON.stringify(defaults, null, 2)}\n`, 'utf-8')
}

type HeartbeatRuntimePerAgentStore = Record<string, Partial<HeartbeatRuntimeDefaults>>

function normalizeHeartbeatRuntimePerAgentState(value: unknown): HeartbeatRuntimePerAgentStore | null {
  return isLooseRecord(value) ? value as HeartbeatRuntimePerAgentStore : null
}

async function readHeartbeatRuntimePerAgent(): Promise<HeartbeatRuntimePerAgentStore> {
  const sqliteStore = normalizeHeartbeatRuntimePerAgentState(
    readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatPerAgent),
  )
  if (sqliteStore) return sqliteStore

  const legacyStore = await readLegacyJsonState(HEARTBEAT_AGENT_DEFAULTS_PATH, normalizeHeartbeatRuntimePerAgentState)
  if (legacyStore) {
    writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatPerAgent, legacyStore, HEARTBEAT_AGENT_DEFAULTS_PATH)
    return legacyStore
  }
  return {}
}

async function writeHeartbeatRuntimePerAgent(store: HeartbeatRuntimePerAgentStore) {
  if (writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.heartbeatPerAgent, store, HEARTBEAT_AGENT_DEFAULTS_PATH)) return
  await fs.mkdir(path.dirname(HEARTBEAT_AGENT_DEFAULTS_PATH), { recursive: true })
  await fs.writeFile(HEARTBEAT_AGENT_DEFAULTS_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
}

function mergeHeartbeatRuntimeDefaults(
  base: HeartbeatRuntimeDefaults,
  patch?: Partial<HeartbeatRuntimeDefaults>,
): HeartbeatRuntimeDefaults {
  const model = migrateGeneratedDeepSeekDefaultPrimary((patch?.model ?? base.model).trim()) || base.model

  return {
    model: model.trim(),
    thinking: patch?.thinking ?? base.thinking,
    timeoutSeconds: Number.isFinite(patch?.timeoutSeconds)
      ? Math.max(30, Math.min(7200, Math.round(patch?.timeoutSeconds as number)))
      : base.timeoutSeconds,
    wake: patch?.wake ?? base.wake,
    session: patch?.session ?? base.session,
    announce: patch?.announce ?? base.announce,
    leadAgent: (patch?.leadAgent ?? base.leadAgent).trim() || base.leadAgent,
  }
}

async function resolveHeartbeatRuntimeDefaultsForAgent(agentId?: string): Promise<HeartbeatRuntimeDefaults> {
  const globalDefaults = await readHeartbeatRuntimeDefaults()
  if (!agentId) return globalDefaults
  const perAgent = await readHeartbeatRuntimePerAgent()
  return mergeHeartbeatRuntimeDefaults(globalDefaults, perAgent[agentId])
}

async function appendAgentDailyMemory(agentId: string, entry: string) {
  const workspace = (await resolveAgentWorkspace(agentId)) || defaultAgentWorkspace(agentId)
  const memoryDir = path.join(workspace, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const memoryPath = path.join(memoryDir, `${today}.md`)
  if (!(await fileExists(memoryPath))) {
    await fs.writeFile(memoryPath, `# ${today}\n\n`, 'utf-8')
  }
  await fs.appendFile(memoryPath, `- ${new Date().toISOString()} | ${entry.trim()}\n`, 'utf-8')
}

let openclawConfigWriteChain: Promise<void> = Promise.resolve()
let openclawAgentRunDefaultsReady = false
let openclawAgentRunDefaultsPending: Promise<void> | null = null
let openclawCodexPluginAutoInstallReady = false
let openclawCodexPluginAutoInstallPending: Promise<void> | null = null

let activeAgentTurnExecutionCount = 0

export function beginAgentTurnExecution(): () => void {
  activeAgentTurnExecutionCount += 1
  return () => {
    activeAgentTurnExecutionCount = Math.max(0, activeAgentTurnExecutionCount - 1)
  }
}

export function isAgentTurnExecuting(): boolean {
  return activeAgentTurnExecutionCount > 0
}

async function writeOpenclawConfig(config: unknown, options: { allowDuringAgentTurn?: boolean } = {}) {
  if (isAgentTurnExecuting() && options.allowDuringAgentTurn !== true) {
    console.info('[config] writeOpenclawConfig suppressed: agent turn in progress')
    return
  }
  const parsed = (config || {}) as OpenClawConfigFile
  ensureOpenclawRuntimeDefaults(parsed)
  // The generic OpenClaw normalizer adds resilience fallbacks. Re-apply the
  // active billing contract afterward so a background config write cannot
  // silently broaden a just-selected usage policy.
  enforceActiveBillingRouteModelOrder(parsed)
  for (const entry of parsed.agents?.list || []) {
    applyTokenEfficientContextLimits(entry)
  }
  await syncModelProviderTimeoutsFromAgentSettings(parsed)
  const next = {
    ...parsed,
    agents: parsed.agents
      ? {
          ...parsed.agents,
          list: (parsed.agents.list || []).filter((entry) => !isRetiredAgentId(entry.id)).map((entry) => {
            const safeEntry = { ...(entry as Record<string, unknown>) }
            delete safeEntry.executionWorkspace
            delete safeEntry.heartbeat
            delete safeEntry.runtime
            const agentId = typeof safeEntry.id === 'string' ? safeEntry.id : undefined
            const workspace = agentConfigWorkspaceForAvatar(
              agentId,
              typeof safeEntry.workspace === 'string' ? safeEntry.workspace : undefined,
              parsed.agents?.defaults?.workspace,
            )
            if (safeEntry.identity !== undefined) {
              safeEntry.identity = sanitizeLooseIdentityForOpenClaw(safeEntry.identity, workspace)
              if (isLooseRecord(safeEntry.identity) && !Object.keys(safeEntry.identity).length) {
                delete safeEntry.identity
              }
            }
            return safeEntry
          }),
        }
      : parsed.agents,
  }
  // Create a version of the config for comparison that excludes dynamic metadata fields
  // (like lastTouchedAt, lastTouchedVersion, updatedAt) using a true deep clone to prevent unnecessary restarts.
  const stripDynamicConfigFieldsForComparison = (cfg: unknown) => {
    if (!cfg || typeof cfg !== 'object') return cfg
    const cloned = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>
    if (cloned.meta && typeof cloned.meta === 'object' && !Array.isArray(cloned.meta)) {
      const meta = cloned.meta as Record<string, unknown>
      delete meta.lastTouchedAt
      delete meta.lastTouchedVersion
      delete meta.lastTouchedBy
      delete meta.updatedAt
      delete meta.createdAt
      if (Object.keys(meta).length === 0) delete cloned.meta
    }
    return cloned
  }

  const compareNext = stripDynamicConfigFieldsForComparison(next)
  const serializedCompare = `${JSON.stringify(compareNext, null, 2)}\n`

  const serialized = `${JSON.stringify(next, null, 2)}\n`

  const write = async () => {
    await fs.mkdir(path.dirname(OPENCLAW_CONFIG_PATH), { recursive: true })
    try {
      const current = await readTextFileWithLockRetry(OPENCLAW_CONFIG_PATH)
      const currentConfig = JSON.parse(current)
      const compareCurrent = stripDynamicConfigFieldsForComparison(currentConfig)
      const serializedCurrentCompare = `${JSON.stringify(compareCurrent, null, 2)}\n`
      if (serializedCurrentCompare === serializedCompare) return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = path.join(path.dirname(OPENCLAW_CONFIG_PATH), `.openclaw.${randomUUID()}.tmp`)
    try {
      await writeTextFileWithLockRetry(tempPath, serialized)
      await renameWithLockRetry(tempPath, OPENCLAW_CONFIG_PATH)
    } finally {
      await fs.unlink(tempPath).catch(() => undefined)
    }
  }

  openclawConfigWriteChain = openclawConfigWriteChain.then(write, write)
  return openclawConfigWriteChain.then(async () => {
    modelCatalogService.invalidateAvailableModels()
    await rememberJsonFileCache(OPENCLAW_CONFIG_PATH, next as OpenClawConfigFile, (entry) => { openclawConfigCache = entry })
  })
}

// OpenClaw owns channel ingress, session routing, tool execution, and reply
// delivery.  The supported way to keep every one of those paths billable is
// therefore to register Automnia as an OpenAI-compatible model provider in
// its config, not to replace a channel's bundled dispatch function.  This
// synchronizer is invoked whenever license state changes and immediately
// before the Gateway starts, so a stale Telegram/ClawTalk process cannot keep
// a direct provider as the active model after a hosted plan is selected.
const AUTOMNIA_OPENCLAW_PROVIDER_ID = AUTOMNIA_CREDITS_PROVIDER_ID
const AUTOMNIA_OPENCLAW_MODEL = AUTOMNIA_CREDITS_MODEL_ID
const AUTOMNIA_OPENCLAW_CONTEXT_TOKENS = (() => {
  // Keep the working set bounded for every provider/model route. OpenClaw
  // clamps this to a model's actual context window, while the lower shared
  // cap makes long tool histories compact before they become six-figure
  // prompts. An explicit environment value remains an operator escape hatch.
  const configured = Number(process.env.AUTOMNIA_OPENCLAW_CONTEXT_TOKENS || AUTOMNIA_OPENCLAW_CONTEXT_TOKENS_DEFAULT)
  return Number.isFinite(configured)
    ? Math.max(16_000, Math.min(256_000, Math.round(configured)))
    : AUTOMNIA_OPENCLAW_CONTEXT_TOKENS_DEFAULT
})()

type OpenClawModelSelection = { primary?: string; fallbacks?: string[] }

function configuredAutomniaCloudBaseUrl(config?: OpenClawConfigFile) {
  // The provider URL is deployment-owned, not durable user configuration.
  // Persisting the previous Cloud Run origin here can leave a Gateway pinned
  // to a retired/stale billing deployment after the public origin changes;
  // that deployment may report a zero wallet even while Account & License
  // shows the current pooled balance. Keep explicit environment overrides for
  // staging/emergency recovery, but always migrate persisted config back to
  // the current canonical origin otherwise.
  void config
  return automniaCloudRouteBaseUrl()
}

function isAutomniaOpenClawModel(value: unknown) {
  return splitModelId(canonicalAgentModelId(typeof value === 'string' ? value : '')).provider.toLowerCase() === AUTOMNIA_OPENCLAW_PROVIDER_ID
}

function modelSelectionForActiveBillingRoute(selection: OpenClawModelSelection) {
  return licenseService.isUsagePriorityLocked() ? creditsOnlyModelSelection() : selection
}

function modelSelectionBlocked(modelId: string) {
  if (!licenseService.isUsagePriorityLocked()) return null
  if (modelId === '__provider_auth__' || !isAutomniaCreditsModelId(canonicalAgentModelId(modelId))) {
    return CREDITS_ONLY_MODEL_ACCESS_MESSAGE
  }
  return null
}

function nonAutomniaOpenClawModels(selection: OpenClawModelSelection | undefined) {
  return uniqueStrings(
    selection?.primary,
    ...(Array.isArray(selection?.fallbacks) ? selection.fallbacks : []),
  ).filter((modelId) => !isAutomniaOpenClawModel(modelId))
}

function configuredOpenClawProviderModels(config: OpenClawConfigFile) {
  const candidates = uniqueStrings(
    ...Object.keys(config.agents?.defaults?.models || {}),
    ...Object.entries(config.models?.providers || {}).flatMap(([provider, providerConfig]) => {
      if (provider === AUTOMNIA_OPENCLAW_PROVIDER_ID) return []
      const models = providerConfig && typeof providerConfig === 'object' && Array.isArray(providerConfig.models)
        ? providerConfig.models
        : []
      return models.map((entry) => {
        const model = rawProviderModelId(entry)
        return model.includes('/') ? model : `${provider}/${model}`
      })
    }),
  )
  return candidates
    .map((modelId) => canonicalAgentModelId(modelId))
    .filter((modelId) => {
      if (!modelId || isAutomniaOpenClawModel(modelId)) return false
      const { provider, model } = splitModelId(modelId)
      const providerConfig = config.models?.providers?.[provider]
      if (!providerConfig || !model) return false
      const listedModels = Array.isArray(providerConfig.models) ? providerConfig.models : []
      if (!listedModels.length) return true
      return listedModels.some((entry) => {
        const listed = rawProviderModelId(entry)
        return listed === model || canonicalAgentModelId(listed) === modelId
      })
    })
}

function applyAutomniaBillingModelOrder(
  selection: OpenClawModelSelection | undefined,
  usagePriority: 'automnia_only' | 'provider_first' | 'automnia_first_with_provider_fallback' | 'automnia_first' | 'byok_only' | null,
  providerCandidates: string[] = [],
  automniaCreditBalance?: number | null,
) {
  return applyUsagePriorityModelOrder(selection, usagePriority, [
    ...nonAutomniaOpenClawModels(selection),
    ...providerCandidates,
  ], AUTOMNIA_OPENCLAW_MODEL, {
    automniaCreditBalance,
    allowProviderFallbackWhenCreditsExhausted: !licenseService.isUsagePriorityLocked(),
  })
}

function telegramBillingDefaultModel(config: OpenClawConfigFile | null | undefined) {
  const model = config?.channels?.modelByChannel?.telegram?.['*']
  return typeof model === 'string' && model.trim() ? model.trim() : null
}

/**
 * Telegram has a channel-scoped model layer which takes precedence over the
 * agent's normal model selection. Keep only its wildcard/default entry under
 * the active billing route; explicit chat and DM entries remain user-owned.
 */
function setTelegramBillingDefaultModel(config: OpenClawConfigFile, model: string | undefined) {
  if (!model) return
  const channels = config.channels || {}
  const modelByChannel = channels.modelByChannel || {}
  const telegram = withUsagePriorityChannelDefault(modelByChannel.telegram, { primary: model }) || {}
  config.channels = {
    ...channels,
    modelByChannel: {
      ...modelByChannel,
      telegram,
    },
  }
}

function clearAutomniaTelegramBillingDefaultModel(config: OpenClawConfigFile) {
  if (telegramBillingDefaultModel(config) !== AUTOMNIA_OPENCLAW_MODEL) return
  const channels = config.channels
  const modelByChannel = channels?.modelByChannel
  const telegram = modelByChannel?.telegram
  if (!channels || !modelByChannel || !telegram) return

  const nextTelegram = { ...telegram }
  delete nextTelegram['*']
  const nextModelByChannel = { ...modelByChannel }
  if (Object.keys(nextTelegram).length) nextModelByChannel.telegram = nextTelegram
  else delete nextModelByChannel.telegram

  const nextChannels = { ...channels }
  if (Object.keys(nextModelByChannel).length) {
    nextChannels.modelByChannel = nextModelByChannel
  } else {
    delete nextChannels.modelByChannel
  }
  if (Object.keys(nextChannels).length) config.channels = nextChannels
  else delete config.channels
}

function effectiveHostedUsagePriority() {
  const status = licenseService.getStatus()
  const priority = status.usagePriority
  if (priority === 'automnia_first') return 'automnia_only' as const
  if (priority === 'byok_only') return 'provider_first' as const
  if (priority === 'automnia_only' && status.creditBalance === 0 && !licenseService.isUsagePriorityLocked()) {
    return 'provider_first' as const
  }
  return priority
}

function enforceActiveBillingRouteModelOrder(config: OpenClawConfigFile) {
  const status = licenseService.getStatus()
  const priority = status.active ? status.usagePriority : null
  if (!priority || !config.agents?.defaults) return

  const providerCandidates = configuredOpenClawProviderModels(config)
  delete config.agents.defaults.modelOverride
  const defaultSelection = applyAutomniaBillingModelOrder(
    config.agents.defaults.model,
    priority,
    providerCandidates,
    status.creditBalance,
  )
  config.agents.defaults.model = defaultSelection
  setTelegramBillingDefaultModel(config, defaultSelection?.primary)
  for (const agent of config.agents.list || []) {
    delete agent.modelOverride
    const nextSelection = applyAutomniaBillingModelOrder(agent.model, priority, providerCandidates, status.creditBalance)
    if (nextSelection) agent.model = nextSelection
    else delete agent.model
  }

  // A BYOK policy must not leave an Automnia alias or provider definition in
  // the live config for a later generic config write to resurrect.
  if (priority === 'byok_only') {
    if (config.models?.providers) delete config.models.providers[AUTOMNIA_OPENCLAW_PROVIDER_ID]
    if (config.agents.defaults.models) {
      for (const modelId of AUTOMNIA_CREDITS_MODEL_IDS) delete config.agents.defaults.models[modelId]
    }
  }

  // Starter/refill entitlements are a hard capability boundary, not merely a
  // preferred route. OpenClaw's /model directive and Telegram model menu both
  // consult this allowlist, so remove every provider model from the active
  // runtime contract while retaining the local provider records for a future
  // upgrade. The local agent files remain the durable source for restoration.
  const creditsOnly = licenseService.isUsagePriorityLocked()
  if (creditsOnly) {
    const existingAutomniaEntries = AUTOMNIA_CREDITS_MODEL_IDS.reduce<Record<string, OpenClawModelAllowlistEntry>>((entries, modelId) => {
      const existing = config.agents?.defaults?.models?.[modelId]
      entries[modelId] = {
        ...(isLooseRecord(existing) ? existing as OpenClawModelAllowlistEntry : {}),
        alias: modelId === AUTOMNIA_OPENCLAW_MODEL
          ? 'Automnia credits'
          : `Automnia hosted fallback - ${splitModelId(modelId).model}`,
      }
      return entries
    }, {})
    config.agents.defaults.models = existingAutomniaEntries
    for (const agent of config.agents.list || []) {
      delete agent.modelOverride
      const mutableAgent = agent as AgentConfigEntry & { models?: unknown }
      delete mutableAgent.models
    }
    config.env = {
      ...(config.env || {}),
      vars: {
        ...(config.env?.vars || {}),
        AUTOMNIA_CREDITS_ONLY: '1',
      },
    }
  } else if (config.env?.vars?.AUTOMNIA_CREDITS_ONLY !== undefined) {
    const vars = { ...(config.env.vars || {}) }
    delete vars.AUTOMNIA_CREDITS_ONLY
    config.env = {
      ...(config.env || {}),
      ...(Object.keys(vars).length ? { vars } : {}),
    }
    if (!config.env.vars) delete config.env
  }
}

function removeAutomniaBillingModel(selection: OpenClawModelSelection | undefined, providerCandidates: string[] = []) {
  return applyUsagePriorityModelOrder(selection, 'byok_only', [
    ...nonAutomniaOpenClawModels(selection),
    ...providerCandidates,
  ], AUTOMNIA_OPENCLAW_MODEL)
}

async function synchronizeOpenClawBillingRoute(configInput?: OpenClawConfigFile) {
  const config = configInput || await readOpenclawConfig()
  if (!config.models) config.models = {}
  if (!config.models.providers) config.models.providers = {}
  if (!config.agents) config.agents = {}
  if (!config.agents.defaults) config.agents.defaults = {}

  // Agent-local settings are the durable source of a user's BYOK model
  // stack. The hosted route may temporarily replace the global OpenClaw
  // selection with Automnia, so recover those provider models before applying
  // a new priority instead of losing them on the next mode switch.
  const localModels = new Map<string, OpenClawModelSelection>()
  await Promise.all((config.agents.list || []).map(async (agent) => {
    const local = await readAgentLocalConfigIfPresent(agent.id).catch(() => null)
    if (local?.model) localModels.set(agent.id, local.model)
  }))
  const configuredProviderModels = configuredOpenClawProviderModels(config)
  const allProviderModels = uniqueStrings(
    ...configuredProviderModels,
    ...Array.from(localModels.values()).flatMap((selection) => nonAutomniaOpenClawModels(selection)),
  )
  const licenseStatus = licenseService.getStatus()
  const requestedPriority = licenseStatus.usagePriority
  if ((requestedPriority === 'provider_first' || requestedPriority === 'automnia_first_with_provider_fallback' || requestedPriority === 'byok_only') && !allProviderModels.length) {
    throw new Error('The selected provider-plus-Automnia route has no configured provider model. Connect a provider before switching usage priority.')
  }

  const hosted = licenseService.getActiveRelayCredentials()
  if (!hosted) {
    delete config.models.providers[AUTOMNIA_OPENCLAW_PROVIDER_ID]
    if (config.agents.defaults.models) {
      for (const modelId of AUTOMNIA_CREDITS_MODEL_IDS) delete config.agents.defaults.models[modelId]
    }
    const defaultSelection = removeAutomniaBillingModel(config.agents.defaults.model, allProviderModels)
    if (defaultSelection) config.agents.defaults.model = defaultSelection
    else delete config.agents.defaults.model
    clearAutomniaTelegramBillingDefaultModel(config)
    for (const agent of config.agents.list || []) {
      const selection = removeAutomniaBillingModel(agent.model, uniqueStrings(
        ...nonAutomniaOpenClawModels(localModels.get(agent.id)),
        ...allProviderModels,
      ))
      if (selection) agent.model = selection
      else delete agent.model
    }
    await writeOpenclawConfig(config, { allowDuringAgentTurn: true })
    return { routed: false, mode: 'byok-or-inactive' as const }
  }

  const cloudBaseUrl = configuredAutomniaCloudBaseUrl(config)
  config.models.providers[AUTOMNIA_OPENCLAW_PROVIDER_ID] = {
    baseUrl: `${cloudBaseUrl}/v1`,
    api: 'openai-completions',
    apiKey: hosted.licenseKey,
    authHeader: true,
    headers: {
      // Keep the account identity explicit for the hosted boundary. The
      // standard Authorization header remains enabled below, but this avoids
      // coupling billing/authentication to a provider adapter's bearer-header
      // behavior.
      'X-Automnia-Email': hosted.email,
      'X-Automnia-License-Key': hosted.licenseKey,
    },
    timeoutSeconds: 7200,
    models: AUTOMNIA_CREDITS_MODEL_IDS.map((modelId) => {
      const bareModelId = modelId.slice(`${AUTOMNIA_OPENCLAW_PROVIDER_ID}/`.length)
      return {
        id: bareModelId,
        name: `Automnia Cloud Credits - ${bareModelId}`,
        // Keep the same OpenClaw thinking contract for every hosted candidate.
        // The relay translates the request for the selected Vertex model and
        // never sends a direct-provider request.
        reasoning: true,
        thinkingLevelMap: AUTOMNIA_GEMINI_37_OPENCLAW_THINKING_LEVEL_MAP,
        compat: AUTOMNIA_GEMINI_37_OPENAI_REASONING_COMPAT,
        input: ['text', 'image'],
        contextWindow: 1_000_000,
        contextTokens: AUTOMNIA_OPENCLAW_CONTEXT_TOKENS,
        // The relay owns the final billing/output clamp. Keep the caller-side
        // model ceiling high enough for long, multi-step tool continuations.
        maxTokens: 4_096,
      }
    }),
  }
  // Clear any cached model override that might be forcing a legacy default (like gpt-5.5)
  // when the runtime state is in transition.
  delete config.agents.defaults.modelOverride
  for (const agent of config.agents.list || []) {
    delete agent.modelOverride
  }

  const priority = hosted.usagePriority
  const defaultSelection = applyAutomniaBillingModelOrder(
    config.agents.defaults.model,
    priority,
    allProviderModels,
    licenseStatus.creditBalance,
  )
  config.agents.defaults.model = defaultSelection
  setTelegramBillingDefaultModel(config, defaultSelection?.primary)
  for (const agent of config.agents.list || []) {
    agent.model = applyAutomniaBillingModelOrder(agent.model, priority, uniqueStrings(
      ...nonAutomniaOpenClawModels(localModels.get(agent.id)),
      ...allProviderModels,
    ), licenseStatus.creditBalance)
  }
  if (!config.agents.defaults.models) config.agents.defaults.models = {}
  for (const modelId of AUTOMNIA_CREDITS_MODEL_IDS) {
    config.agents.defaults.models[modelId] = {
      alias: modelId === AUTOMNIA_OPENCLAW_MODEL
        ? 'Automnia credits'
        : `Automnia hosted fallback - ${splitModelId(modelId).model}`,
      params: { transport: 'sse' },
    }
  }
  await writeOpenclawConfig(config, { allowDuringAgentTurn: true })
  if (licenseService.isUsagePriorityLocked()) {
    await Promise.all((config.agents.list || []).map((agent) =>
      clearDisallowedAutoModelOverridesForAgent(
        agent.id,
        creditsOnlyModelSelection(),
        { clearManualOverrides: true },
      ).catch((error) => {
        console.warn(`[model-guard] failed to clear Telegram model overrides for ${agent.id}:`, error)
      })))
  }
  return { routed: true, mode: 'hosted_credits' as const, usagePriority: priority }
}

function automniaBillingRouteSnapshot(config: OpenClawConfigFile | null | undefined) {
  return JSON.stringify({
    provider: config?.models?.providers?.[AUTOMNIA_OPENCLAW_PROVIDER_ID] || null,
    defaults: config?.agents?.defaults?.model || null,
    telegramDefault: telegramBillingDefaultModel(config),
    agents: (config?.agents?.list || [])
      .map((agent) => ({ id: agent.id, model: agent.model || null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
}

/**
 * Repair a stale hosted-credits model definition before the first agent turn.
 *
 * Older installs registered Gemini 3.6 Flash with `reasoning: false`, which
 * makes OpenClaw reject every enabled thinking level locally. If that legacy
 * definition is still loaded by a healthy Gateway, hot-reload the corrected
 * profile first and restart only if the Gateway does not confirm it, so the
 * user never receives that configuration error.
 */
async function synchronizeOpenClawBillingRouteForAgentRun(config: OpenClawConfigFile) {
  const beforeRoute = automniaBillingRouteSnapshot(config)
  await synchronizeOpenClawBillingRoute(config)
  const afterConfig = await readOpenclawConfig().catch(() => null)
  const afterRoute = automniaBillingRouteSnapshot(afterConfig)
  if (beforeRoute === afterRoute || !await isGatewayHealthy().catch(() => false)) return

  const hotReload = await applyBillingRouteViaGatewayConfigPatch(afterConfig || config)
  if (hotReload.ok) return

  await tryRestartGatewayService({
    force: true,
    reason: 'hosted Gemini thinking profile synchronization',
  }).catch((error) => {
    console.warn('[hosted-gemini-thinking] failed to restart gateway after profile synchronization:', error)
  })
}

async function ensureOpenclawAgentRunConfigDefaults() {
  if (openclawAgentRunDefaultsReady) return
  if (!openclawAgentRunDefaultsPending) {
    openclawAgentRunDefaultsPending = (async () => {
      const config = await readOpenclawConfig()
      ensureConfiguredModelAllowlist(config, agentRuntimeModelIdsForConfig(config))
      await synchronizeOpenClawBillingRouteForAgentRun(config)
      const toolchainChecks = [
        commandCheck(process.platform === 'win32' ? 'node.exe' : 'node', ['--version'], 'Node.js'),
        commandCheck(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], 'npm'),
      ]
      const toolchainFailure = runtimePreflightFailureMessage('toolchain', toolchainChecks)
      if (toolchainFailure) throw new Error(toolchainFailure)
      await ensureCodexPluginInstalledForOpenAiRuntime(config)
      openclawAgentRunDefaultsReady = true
    })().finally(() => {
      openclawAgentRunDefaultsPending = null
    })
  }
  await openclawAgentRunDefaultsPending
}

async function ensureGatewayStartupPluginDefaults(repairSummary: GatewayStartupPluginRepairSummary = {}) {
  const sidecarRecovery = await recoverMalformedCodexBindingSidecars(OPENCLAW_STATE_ROOT)
  if (sidecarRecovery.recovered.length) {
    const recoveryFolder = path.join(OPENCLAW_STATE_ROOT, 'recovery', 'codex-binding-sidecars')
    const message = `Recovered ${sidecarRecovery.recovered.length} malformed legacy Codex binding sidecar${sidecarRecovery.recovered.length === 1 ? '' : 's'} before migration. Original file${sidecarRecovery.recovered.length === 1 ? ' was' : 's were'} moved to ${recoveryFolder}.`
    console.warn(`[runtime/codex-sidecar] ${message}`)
    pushGatewayLog('lifecycle', message, 'warning')
  }
  for (const warning of sidecarRecovery.warnings) {
    console.warn(`[runtime/codex-sidecar] ${warning}`)
    pushGatewayLog('lifecycle', warning, 'warning')
  }
  const config = await readOpenclawConfig().catch(() => null)
  if (!config) return
  const before = JSON.stringify({ gateway: config.gateway || {}, plugins: config.plugins || {}, tools: config.tools || {} })
  ensureGatewayConfigDefaults(config)
  ensureClawTalkBundledPluginDefaults(config)
  await ensureClawTalkApiKeyMaterial(config)
  const [
    repairedClawTalkManifests,
    repairedTelegramRuntimes,
  ] = await Promise.all([
    repairSummary.repairedClawTalkManifests
      ? Promise.resolve(repairSummary.repairedClawTalkManifests)
      : repairClawTalkPluginManifestContracts(),
    repairSummary.repairedTelegramRuntimes
      ? Promise.resolve(repairSummary.repairedTelegramRuntimes)
      : repairTelegramAgentRoutingRuntime(),
  ])
  ensureBrowserRuntimeDefaults(config)
  await ensureTrustedPluginAllowlistFromRuntimeState(config)
  await ensureEnabledManagedPluginLoadPaths(config)
  await ensureWebSearchProviderSelectionFromRuntimeState(config)
  const after = JSON.stringify({ gateway: config.gateway || {}, plugins: config.plugins || {}, tools: config.tools || {} })
  if (after !== before) await writeOpenclawConfig(config)
  if (repairedClawTalkManifests.length && !repairSummary.clawTalkRegistryRefreshed) {
    console.info(`[plugins/clawtalk] repaired manifest contracts in ${repairedClawTalkManifests.length} install(s)`)
    await refreshOpenClawPluginRegistry('clawtalk-manifest-repair').catch((error) => {
      console.warn('[plugins/clawtalk] registry refresh after manifest repair failed:', error)
    })
  } else if (repairedClawTalkManifests.length) {
    console.info(`[plugins/clawtalk] reused startup manifest repair results for ${repairedClawTalkManifests.length} install(s)`)
  }
  if (repairedTelegramRuntimes.length) {
    console.info(`[plugins/telegram] repaired agent-routing runtime in ${repairedTelegramRuntimes.length} install(s)`)
  }
}

type PluginSearchResult = {
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

type PluginCommandResult = {
  command: string
  code: number
  stdout: string
  stderr: string
  output: string
  elapsedMs?: number
}

type PluginPostInstallRepairSummary = {
  applied: boolean
  reason: string
  actions: string[]
  warnings?: string[]
  bundledSource?: string
  commands?: PluginCommandResult[]
}

const PLUGIN_LIST_CACHE_MS = 12 * 60 * 60 * 1000
const PLUGIN_LIST_CACHE_PATH = path.join(OPENCLAW_STATE_ROOT, 'plugin-list-cache.json')
const PLUGIN_RUNTIME_STATE_PATH = path.join(OPENCLAW_STATE_ROOT, 'control-center-plugin-state.json')
const OPENCLAW_PLUGIN_EXTENSIONS_DIR = path.join(OPENCLAW_STATE_ROOT, 'extensions')
const PLUGIN_INSTALL_REPAIR_DIR = path.join(OPENCLAW_STATE_ROOT, 'tmp', 'plugin-install-repair')
const CONTROL_CENTER_SECRET_PROVIDER_ID = 'controlcenter'

function normalizePluginRuntimeState(value: unknown): PluginRuntimeState | null {
  return isLooseRecord(value) ? value as PluginRuntimeState : null
}

async function readPluginRuntimeState(): Promise<PluginRuntimeState> {
  const sqliteState = normalizePluginRuntimeState(
    readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.pluginRuntimeState),
  )
  if (sqliteState) return sqliteState

  const legacyState = await readLegacyJsonState(PLUGIN_RUNTIME_STATE_PATH, normalizePluginRuntimeState)
  if (legacyState) {
    writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.pluginRuntimeState, legacyState, PLUGIN_RUNTIME_STATE_PATH)
    return legacyState
  }
  return {}
}

async function writePluginRuntimeState(state: PluginRuntimeState) {
  writeControlCenterStateRecord(
    CONTROL_CENTER_STATE_KEYS.pluginRuntimeState,
    state,
    PLUGIN_RUNTIME_STATE_PATH,
  )
  // OpenClaw's configured controlcenter secret provider still reads this generated JSON mirror.
  await fs.mkdir(path.dirname(PLUGIN_RUNTIME_STATE_PATH), { recursive: true })
  await writeTextFileWithLockRetry(PLUGIN_RUNTIME_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

async function savePluginSecret(pluginId: string, key: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return
  const state = await readPluginRuntimeState()
  state.secrets = isLooseRecord(state.secrets) ? state.secrets : {}
  state.secrets[pluginId] = isLooseRecord(state.secrets[pluginId]) ? state.secrets[pluginId] : {}
  state.secrets[pluginId][key] = value
  await writePluginRuntimeState(state)
}

async function readPluginSecret(pluginId: string, key: string) {
  const state = await readPluginRuntimeState()
  const plugin = isLooseRecord(state.secrets?.[pluginId]) ? state.secrets?.[pluginId] : null
  const value = plugin?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

pluginInventoryService = createPluginInventoryService({
  cacheMs: PLUGIN_LIST_CACHE_MS,
  configPath: OPENCLAW_CONFIG_PATH,
  listCachePath: PLUGIN_LIST_CACHE_PATH,
  openclawBin,
  pluginListCacheStateKey: CONTROL_CENTER_STATE_KEYS.pluginListCache,
  providerAuthStatus,
  readControlCenterStateRecord,
  readOpenclawConfig,
  readPluginRuntimeState,
  redactSensitiveText,
  runOpenClaw,
  warn: (message, error) => console.warn(message, error),
  workspaceRoot: WORKSPACE_ROOT,
  writeControlCenterStateRecord,
})

pluginInstallService = createPluginInstallService({
  clawTalkPluginId: CLAWTALK_PLUGIN_ID,
  configPath: OPENCLAW_CONFIG_PATH,
  installRepairDir: PLUGIN_INSTALL_REPAIR_DIR,
  openclawBin,
  pluginExtensionsDir: OPENCLAW_PLUGIN_EXTENSIONS_DIR,
  stateRoot: OPENCLAW_STATE_ROOT,
  delayMs,
  listPluginControls,
  openClawConfigNeedsCodexPlugin,
  pauseGatewayForPluginInstallRepair: (actions) => gatewayLifecycle.pauseForPluginInstallRepair(actions),
  persistTrustedPluginAllowlist,
  readOpenclawConfig,
  readPluginRuntimeState,
  redactSensitiveText,
  refreshOpenClawPluginRegistry,
  refreshPluginListCache,
  renamePath: renameWithLockRetry,
  repairClawTalkPluginManifestContracts,
  repairCodexPluginPostInstallState,
  resolveBundledCodexPluginRoot,
  resumeGatewayAfterPluginInstallRepair: (actions) => gatewayLifecycle.resumeAfterPluginInstallRepair(actions),
  runOpenClaw,
  schedulePluginGatewayRestart,
  setOpenClawPluginEnabled,
  warn: (message, error) => console.warn(message, error),
  writePluginRuntimeState,
})

pluginRuntimeService = createPluginRuntimeService({
  listPluginControls,
  openClawProcessEnv,
  openClawSpawnSpec,
  redactSensitiveText,
  runOpenClaw,
  terminateProcessTree,
  warn: (message, error) => console.warn(message, error),
  workspaceRoot: WORKSPACE_ROOT,
})

pluginDiagnosticsService = createPluginDiagnosticsService({
  clawTalkPluginId: CLAWTALK_PLUGIN_ID,
  defaultServer: CLAWTALK_DEFAULT_SERVER,
  delayMs,
  inspectOpenClawPluginRuntime,
  installOpenClawPlugin,
  isRealInstalledPluginEntry,
  listPluginControls,
  pluginRuntimeInspectReady,
  redactSensitiveText,
  refreshOpenClawPluginRegistry,
  repairClawTalkPluginManifestContracts,
  runOpenClaw,
  saveClawTalkSetupConfig,
  tryRestartGatewayService,
})

function ensureControlCenterSecretProvider(config: OpenClawConfigFile) {
  config.secrets = isLooseRecord(config.secrets) ? config.secrets : {}
  config.secrets.providers = isLooseRecord(config.secrets.providers) ? config.secrets.providers : {}
  config.secrets.providers[CONTROL_CENTER_SECRET_PROVIDER_ID] = {
    source: 'file',
    path: PLUGIN_RUNTIME_STATE_PATH,
    mode: 'json',
  }
}

function assignClawTalkApiKeyConfig(entryConfig: Record<string, unknown>, apiKey: string) {
  entryConfig.apiKey = apiKey
  delete entryConfig.apiKeyRef
  delete entryConfig.apiKeyStorage
}

async function findClawTalkApiKeyInConfigBackups(): Promise<{ apiKey: string; source: string } | null> {
  const configDir = path.dirname(OPENCLAW_CONFIG_PATH)
  const entries = await fs.readdir(configDir, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^openclaw\.json(?:\.last-good|\.bak(?:[.-].*)?)$/i.test(name))

  const withStats = await Promise.all(candidates.map(async (name) => {
    const filePath = path.join(configDir, name)
    const stat = await fs.stat(filePath).catch(() => null)
    return stat ? { name, filePath, mtimeMs: stat.mtimeMs } : null
  }))

  for (const candidate of withStats
    .filter((entry): entry is { name: string; filePath: string; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    const raw = await fs.readFile(candidate.filePath, 'utf-8').catch(() => '')
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown
      const apiKey = nestedString(parsed, ['plugins', 'entries', CLAWTALK_PLUGIN_ID, 'config', 'apiKey'])
      if (apiKey) return { apiKey, source: candidate.name }
    } catch {
      // Keep looking through older backups.
    }
  }

  return null
}

async function ensureClawTalkApiKeyMaterial(config: OpenClawConfigFile) {
  const entry = config.plugins?.entries?.[CLAWTALK_PLUGIN_ID]
  if (!entry || isClawTalkDisabled(config, entry)) return false

  if (!isLooseRecord(entry.config)) entry.config = {}
  const entryConfig = entry.config
  const existingApiKey = typeof entryConfig.apiKey === 'string' && entryConfig.apiKey.trim()
    ? entryConfig.apiKey.trim()
    : ''
  if (existingApiKey) {
    await savePluginSecret(CLAWTALK_PLUGIN_ID, 'apiKey', existingApiKey)
    ensureControlCenterSecretProvider(config)
    assignClawTalkApiKeyConfig(entryConfig, existingApiKey)
    return true
  }

  const savedSecret = await readPluginSecret(CLAWTALK_PLUGIN_ID, 'apiKey')
  const recovered = savedSecret
    ? { apiKey: savedSecret, source: 'secret cache' }
    : await findClawTalkApiKeyInConfigBackups()
  if (!recovered?.apiKey) return false

  entry.enabled = true
  entryConfig.enabled = true
  ensureControlCenterSecretProvider(config)
  assignClawTalkApiKeyConfig(entryConfig, recovered.apiKey)
  entryConfig.autoConnect = true
  entryConfig.agentId = clawTalkAgentIdFromConfig(config, entryConfig)
  entryConfig.server = typeof entryConfig.server === 'string' && entryConfig.server.trim()
    ? entryConfig.server.trim()
    : CLAWTALK_DEFAULT_SERVER
  entryConfig.missions = withClawTalkMissionConfig(entryConfig, true)
  await savePluginSecret(CLAWTALK_PLUGIN_ID, 'apiKey', recovered.apiKey)
  console.info(`[plugins/clawtalk] restored API key material from ${recovered.source}`)
  return true
}

async function markPluginManaged(pluginId: string, enabled: boolean) {
  const state = await readPluginRuntimeState()
  state.managed = isLooseRecord(state.managed) ? state.managed as PluginRuntimeState['managed'] : {}
  state.managed![pluginId] = { enabled, updatedAt: new Date().toISOString() }
  if (isLooseRecord(state.installs?.[pluginId])) {
    state.installs![pluginId].enabled = enabled
    state.installs![pluginId].updatedAt = state.managed![pluginId].updatedAt
  }
  await writePluginRuntimeState(state)
}

function packageNameFromInstallSpec(spec: string) {
  const trimmed = spec.trim()
  const prefix = trimmed.match(/^([a-z][a-z0-9-]*):/i)?.[1]?.toLowerCase()
  if (prefix && !['clawhub', 'npm'].includes(prefix)) return ''
  const value = trimmed.replace(/^(?:clawhub|npm):/i, '')
  if (!value || /^(?:[./~]|[A-Za-z]:[\\/])/.test(value)) return ''
  const atIndex = value.lastIndexOf('@')
  if (atIndex > 0 && !(value.startsWith('@') && value.indexOf('/', 1) > atIndex)) {
    return value.slice(0, atIndex).trim()
  }
  return value
}

function normalizedPluginId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const id = value.trim().toLowerCase()
  return PLUGIN_ID_PATTERN.test(id) ? id : ''
}

function normalizedPluginIds(...items: Array<unknown>): string[] {
  const out = new Set<string>()
  for (const value of uniqueStrings(...items)) {
    const id = normalizedPluginId(value)
    if (id) out.add(id)
  }
  return [...out]
}

function enabledPluginEntryIds(config: OpenClawConfigFile): string[] {
  return Object.entries(config.plugins?.entries || {})
    .filter(([, entry]) => entry?.enabled !== false)
    .map(([id]) => normalizedPluginId(id))
    .filter(Boolean)
}

function deniedOrDisabledPluginIds(config: OpenClawConfigFile): Set<string> {
  const blocked = new Set<string>(normalizedPluginIds(config.plugins?.deny))
  for (const [id, entry] of Object.entries(config.plugins?.entries || {})) {
    const normalized = normalizedPluginId(id)
    if (normalized && entry?.enabled === false) blocked.add(normalized)
  }
  return blocked
}

function pluginRootCandidateDirs(loadPath: string): string[] {
  const resolved = path.resolve(loadPath)
  let current = resolved
  try {
    if (statSync(resolved).isFile()) current = path.dirname(resolved)
  } catch {
    if (path.extname(resolved)) current = path.dirname(resolved)
  }

  const candidates: string[] = []
  for (let index = 0; index < 5; index += 1) {
    candidates.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return uniqueStrings(candidates)
}

function pluginIdFromPluginRoot(root: string): string {
  const manifest = readJsonFileSyncLoose(path.join(root, 'openclaw.plugin.json'))
  const packageJson = readJsonFileSyncLoose(path.join(root, 'package.json'))
  const id = normalizedPluginId(
    typeof manifest?.id === 'string' && manifest.id.trim()
      ? manifest.id
      : pluginIdFromPackageName(packageJson?.name),
  )
  if (id) return id

  const nativeExtensionsDir = path.resolve(OPENCLAW_PLUGIN_EXTENSIONS_DIR).toLowerCase()
  if (path.dirname(path.resolve(root)).toLowerCase() === nativeExtensionsDir) {
    return normalizedPluginId(path.basename(root))
  }
  return ''
}

function pluginIdFromLoadPath(loadPath: string): string {
  for (const candidate of pluginRootCandidateDirs(loadPath)) {
    const id = pluginIdFromPluginRoot(candidate)
    if (id) return id
  }
  return ''
}

function pluginLoadPathIds(config: OpenClawConfigFile): string[] {
  return normalizedPluginIds(pluginStringArray(config.plugins?.load?.paths).map(pluginIdFromLoadPath))
}

function enabledRuntimePluginIds(state: PluginRuntimeState): string[] {
  const ids: string[] = []
  for (const [id, entry] of Object.entries(state.managed || {})) {
    if (entry?.enabled !== false) ids.push(id)
  }
  for (const [id, entry] of Object.entries(state.installs || {})) {
    if (entry?.enabled !== false) ids.push(entry.pluginId || id)
  }
  return normalizedPluginIds(ids)
}

function ensureTrustedPluginAllowlist(config: OpenClawConfigFile, ...extraIds: Array<unknown>) {
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}

  const blocked = deniedOrDisabledPluginIds(config)
  const allow = normalizedPluginIds(
    config.plugins.allow,
    enabledPluginEntryIds(config),
    pluginLoadPathIds(config),
    extraIds,
  ).filter((id) => !blocked.has(id))

  config.plugins.allow = allow
  if (allow.length && config.plugins.bundledDiscovery === undefined) {
    config.plugins.bundledDiscovery = 'compat'
  }
}

async function ensureTrustedPluginAllowlistFromRuntimeState(config: OpenClawConfigFile, ...extraIds: Array<unknown>) {
  const state = await readPluginRuntimeState().catch(() => ({} as PluginRuntimeState))
  ensureTrustedPluginAllowlist(config, enabledRuntimePluginIds(state), ...extraIds)
}

function pluginRootDirFromRegistryRaw(raw: Record<string, unknown>) {
  const rootDir = stringField(raw, ['rootDir', 'root', 'installPath', 'pluginRoot'])
  if (rootDir) return rootDir
  const source = stringField(raw, ['source', 'path', 'entry', 'main'])
  if (!source || /^https?:\/\//i.test(source)) return ''
  try {
    const resolved = path.resolve(source)
    return path.extname(resolved) ? path.dirname(resolved) : resolved
  } catch {
    return ''
  }
}

function enabledPluginIdsForGatewayStartup(config: OpenClawConfigFile, state: PluginRuntimeState) {
  const blocked = deniedOrDisabledPluginIds(config)
  return new Set(
    normalizedPluginIds(
      enabledPluginEntryIds(config),
      enabledRuntimePluginIds(state),
    ).filter((id) => !blocked.has(id)),
  )
}

function isLoadableExternalPluginRoot(pluginId: string, root: string) {
  if (!pluginId || !root) return false
  const resolved = path.resolve(root)
  if (isBundledOpenClawPluginPath(resolved)) return false
  if (EXTERNAL_LOAD_PATH_RESERVED_PLUGIN_IDS.has(pluginId)) return false
  return existsSync(path.join(resolved, 'openclaw.plugin.json')) ||
    existsSync(path.join(resolved, 'package.json'))
}

function sanitizedManagedPluginLoadPaths(value: unknown) {
  return sanitizedPluginLoadPaths(value).filter((pathEntry) => {
    const pluginId = pluginIdFromLoadPath(pathEntry)
    if (!pluginId) return true
    return !EXTERNAL_LOAD_PATH_RESERVED_PLUGIN_IDS.has(pluginId)
  })
}

async function installedManagedPluginRootCandidates(pluginId: string, state: PluginRuntimeState) {
  const install = state.installs?.[pluginId]
  const packageName = install?.packageName || (install?.spec ? packageNameFromInstallSpec(install.spec) : '') || pluginId
  const projectsRoot = path.join(OPENCLAW_STATE_ROOT, 'npm', 'projects')
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => [])
  return uniqueStrings(
    path.join(projectsRoot, pluginId, 'node_modules', packageName),
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name, 'node_modules', packageName)),
  )
}

async function ensureEnabledManagedPluginLoadPaths(config: OpenClawConfigFile) {
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.load) config.plugins.load = {}

  const state = await readPluginRuntimeState().catch(() => ({} as PluginRuntimeState))
  const enabledIds = enabledPluginIdsForGatewayStartup(config, state)
  if (!enabledIds.size) {
    config.plugins.load.paths = sanitizedManagedPluginLoadPaths(config.plugins.load.paths)
    return
  }

  const pluginList = await getPluginList().catch(() => null)
  const loadPaths: string[] = []
  for (const raw of pluginList?.rawPlugins || []) {
    const id = normalizedPluginId(raw.id)
    if (!enabledIds.has(id)) continue
    const root = pluginRootDirFromRegistryRaw(raw)
    if (isLoadableExternalPluginRoot(id, root)) loadPaths.push(path.resolve(root))
  }

  for (const id of enabledIds) {
    const candidates = id === CLAWTALK_PLUGIN_ID
      ? await installedClawTalkPluginRootCandidates()
      : await installedManagedPluginRootCandidates(id, state)
    for (const root of candidates) {
      if (isLoadableExternalPluginRoot(id, root)) loadPaths.push(path.resolve(root))
    }
  }

  config.plugins.load.paths = uniqueStrings(sanitizedManagedPluginLoadPaths(config.plugins.load.paths), loadPaths)
}

async function persistTrustedPluginAllowlist(...extraIds: Array<unknown>) {
  const config = await readOpenclawConfig()
  const before = JSON.stringify(config.plugins || {})
  await ensureTrustedPluginAllowlistFromRuntimeState(config, ...extraIds)
  await ensureEnabledManagedPluginLoadPaths(config)
  const after = JSON.stringify(config.plugins || {})
  if (after !== before) await writeOpenclawConfig(config)
}

function isClawTalkPluginPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  const resolved = path.resolve(value)
  return path.basename(resolved).toLowerCase() === CLAWTALK_PLUGIN_ID
}

function bundledOpenClawPluginExtensionRootCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  const openclawDir = openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : ''
  return uniqueStrings(
    openclawDir ? path.join(openclawDir, 'dist', 'extensions') : '',
    path.resolve(WORKSPACE_ROOT, 'vendor', 'openclaw', 'dist', 'extensions'),
    path.resolve(process.cwd(), 'vendor', 'openclaw', 'dist', 'extensions'),
    path.resolve(process.cwd(), 'resources', 'openclaw', 'dist', 'extensions'),
    electronResourcesPath ? path.join(electronResourcesPath, 'openclaw', 'dist', 'extensions') : '',
  )
}

function looksLikePackagedBundledPluginPath(resolved: string) {
  const normalized = resolved.replace(/\\/g, '/').toLowerCase()
  return /\/(?:resources|vendor)\/openclaw\/dist\/extensions\/[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)
}

function isBundledOpenClawPluginPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  const resolved = path.resolve(value)
  const pluginId = path.basename(resolved).toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(pluginId)) return false
  const parent = path.dirname(resolved)
  return bundledOpenClawPluginExtensionRootCandidates().some((candidate) => sameResolvedRuntimePath(parent, candidate)) ||
    looksLikePackagedBundledPluginPath(resolved)
}

function sanitizedPluginLoadPaths(value: unknown) {
  return uniqueStrings(pluginStringArray(value)).filter((pathEntry) => !isBundledOpenClawPluginPath(pathEntry))
}

function sanitizeBundledPluginLoadPaths(config: OpenClawConfigFile) {
  if (!config.plugins?.load || !Array.isArray(config.plugins.load.paths)) return false
  const before = pluginStringArray(config.plugins.load.paths)
  const after = sanitizedPluginLoadPaths(before)
  const changed = before.length !== after.length || before.some((entry, index) => entry !== after[index])
  if (changed) config.plugins.load.paths = after
  return changed
}

function bundledClawTalkPluginRootCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  const openclawDir = openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : ''
  return uniqueStrings(
    openclawDir ? path.join(openclawDir, 'dist', 'extensions', CLAWTALK_PLUGIN_ID) : '',
    path.resolve(WORKSPACE_ROOT, 'vendor', 'openclaw', 'dist', 'extensions', CLAWTALK_PLUGIN_ID),
    path.resolve(process.cwd(), 'vendor', 'openclaw', 'dist', 'extensions', CLAWTALK_PLUGIN_ID),
    path.resolve(process.cwd(), 'resources', 'openclaw', 'dist', 'extensions', CLAWTALK_PLUGIN_ID),
    electronResourcesPath ? path.join(electronResourcesPath, 'openclaw', 'dist', 'extensions', CLAWTALK_PLUGIN_ID) : '',
    path.join(OPENCLAW_STATE_ROOT, 'extensions', CLAWTALK_PLUGIN_ID),
    path.join(HOME_DIR, '.openclaw', 'extensions', CLAWTALK_PLUGIN_ID),
  )
}

function hasClawTalkDependency(root: string, ...parts: string[]) {
  return existsSync(path.join(root, 'node_modules', ...parts, 'package.json')) ||
    existsSync(path.join(path.dirname(root), ...parts, 'package.json'))
}

function isUsableClawTalkPluginRoot(root: string) {
  return existsSync(path.join(root, 'openclaw.plugin.json')) &&
    existsSync(path.join(root, 'package.json')) &&
    existsSync(path.join(root, 'build', 'index.js')) &&
    hasClawTalkDependency(root, '@sinclair', 'typebox') &&
    hasClawTalkDependency(root, 'libphonenumber-js')
}

function resolveBundledClawTalkPluginRoot() {
  return bundledClawTalkPluginRootCandidates().find(isUsableClawTalkPluginRoot) || ''
}

async function installedClawTalkPluginRootCandidates() {
  const projectsRoot = path.join(OPENCLAW_STATE_ROOT, 'npm', 'projects')
  const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => [])
  const npmProjectCandidates = projectEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsRoot, entry.name, 'node_modules', CLAWTALK_PLUGIN_ID))

  return uniqueStrings(
    bundledClawTalkPluginRootCandidates(),
    path.join(projectsRoot, CLAWTALK_PLUGIN_ID, 'node_modules', CLAWTALK_PLUGIN_ID),
    npmProjectCandidates,
  ).filter(isUsableClawTalkPluginRoot)
}

function ensureClawTalkManifestContracts(manifest: Record<string, unknown>) {
  let changed = false
  const activation = isLooseRecord(manifest.activation) ? manifest.activation : {}
  if (activation !== manifest.activation) {
    manifest.activation = activation
    changed = true
  }
  if (activation.onStartup !== true) {
    activation.onStartup = true
    changed = true
  }

  const contracts = isLooseRecord(manifest.contracts) ? manifest.contracts : {}
  if (contracts !== manifest.contracts) {
    manifest.contracts = contracts
    changed = true
  }

  const previousTools = pluginStringArray(contracts.tools)
  const nextTools = uniqueStrings(previousTools, [...CLAWTALK_AGENT_TOOL_NAMES])
  if (
    nextTools.length !== previousTools.length ||
    nextTools.some((toolName, index) => toolName !== previousTools[index])
  ) {
    contracts.tools = nextTools
    changed = true
  }

  const toolMetadata = isLooseRecord(manifest.toolMetadata) ? manifest.toolMetadata : {}
  if (toolMetadata !== manifest.toolMetadata) {
    manifest.toolMetadata = toolMetadata
    changed = true
  }
  for (const toolName of CLAWTALK_AGENT_TOOL_NAMES) {
    const metadata = isLooseRecord(toolMetadata[toolName]) ? toolMetadata[toolName] : {}
    if (metadata !== toolMetadata[toolName]) {
      toolMetadata[toolName] = metadata
      changed = true
    }
    if (metadata.optional !== true) {
      metadata.optional = true
      changed = true
    }
  }

  return changed
}

function patchedClawTalkRuntimeSource(source: string) {
  let next = source
  const helperName = 'resolveClawTalkDataDir'
  if (!next.includes(`function ${helperName}(api)`)) {
    const helper = [
      'function resolveClawTalkDataDir(api) {',
      "    var resolved = typeof api.resolvePath === 'function' ? api.resolvePath('.') : '';",
      "    if (typeof resolved === 'string' && resolved.trim() && resolved.trim() !== 'undefined') return resolved.trim();",
      "    var home = process.env.OPENCLAW_STATE_ROOT || process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || process.cwd();",
      "    if (!/[\\\\/]\\.openclaw$/i.test(home)) home = \"\".concat(home, \"/.openclaw\");",
      "    return \"\".concat(home, \"/plugins/clawtalk\");",
      '}',
      '',
    ].join('\n')
    next = next.replace('var clawTalkPlugin = {', `${helper}var clawTalkPlugin = {`)
  }
  next = next.replace("dataDir: api.resolvePath('.')", 'dataDir: resolveClawTalkDataDir(api)')
  next = next.replace(
    'var wsLogPath = "".concat(api.resolvePath(\'.\'), "/ws.log");',
    'var wsLogPath = "".concat(resolveClawTalkDataDir(api), "/ws.log");',
  )
  return next
}


const CLAWTALK_REPAIR_SIGNATURE_VERSION = 'clawtalk-repair:v13'
const TELEGRAM_REPAIR_SIGNATURE_VERSION = 'telegram-routing-repair:v12'
const clawTalkRepairSignatureCache = new Map<string, string>()
const telegramRepairSignatureCache = new Map<string, string>()

async function repairFileSignature(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null)
  return stat?.isFile()
    ? `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`
    : `${filePath}:missing`
}

async function clawTalkRepairSignature(root: string) {
  const files = [
    path.join(root, 'openclaw.plugin.json'),
    path.join(root, 'build', 'index.js'),
    path.join(root, 'build', 'services', 'CoreBridge.js'),
    path.join(root, 'build', 'services', 'SmsHandler.js'),
    path.join(root, 'build', 'services', 'DeepToolHandler.js'),
  ]
  const signatures = await Promise.all(files.map((filePath) => repairFileSignature(filePath)))
  return createHash('sha1')
    .update(`${CLAWTALK_REPAIR_SIGNATURE_VERSION}\n${signatures.join('\n')}`)
    .digest('hex')
}

async function telegramRepairSignature(filePath: string) {
  return createHash('sha1')
    .update(`${TELEGRAM_REPAIR_SIGNATURE_VERSION}\n${await repairFileSignature(filePath)}`)
    .digest('hex')
}

function clawTalkCoreBridgeStreamHelper() {
  const marker = 'function resolveClawTalkControlCenterStreamUrl() {'
  const index = CLAWTALK_CORE_BRIDGE_ROUTING_HELPER.indexOf(marker)
  return index === -1 ? '' : CLAWTALK_CORE_BRIDGE_ROUTING_HELPER.slice(index)
}

function patchedClawTalkCoreBridgeSource(source: string) {
  let next = source
  const routingPatchVersion = 'var CLAWTALK_ROUTING_PATCH_VERSION = 13;'
  const routingHelperPattern = /var CLAWTALK_ROUTING_PATCH_VERSION = \d+;[\s\S]*?\nvar DEFAULT_TIMEOUT_MS = 120000;/
  const canPatchBridge = source.includes(routingPatchVersion)
    || routingHelperPattern.test(source)
    || (
      source.includes('var DEFAULT_TIMEOUT_MS = 120000;')
      && source.includes('deps.runEmbeddedPiAgent')
      && source.includes('CoreBridge: running agent turn session=')
    )
  if (!canPatchBridge) {
    console.warn('[plugins/clawtalk] CoreBridge patch skipped: unsupported bridge shape')
    return source
  }
  if (!next.includes(routingPatchVersion) && routingHelperPattern.test(next)) {
    next = next.replace(routingHelperPattern, `${CLAWTALK_CORE_BRIDGE_ROUTING_HELPER}\nvar DEFAULT_TIMEOUT_MS = 120000;`)
  } else if (!next.includes('function resolveClawTalkAgentRoute(params, fallbackConfig, fallbackAgentId, logger)')) {
    next = next.replace('var DEFAULT_TIMEOUT_MS = 120000;', `${CLAWTALK_CORE_BRIDGE_ROUTING_HELPER}\nvar DEFAULT_TIMEOUT_MS = 120000;`)
  }
  if (!next.includes('function runClawTalkControlCenterOrEmbeddedAgentTurn(options)')) {
    const streamHelper = clawTalkCoreBridgeStreamHelper()
    if (streamHelper) {
      next = next.replace('var DEFAULT_TIMEOUT_MS = 120000;', `${streamHelper}\nvar DEFAULT_TIMEOUT_MS = 120000;`)
    }
  }
  next = next.replace(
    'deps, err, cfg, agentId, storePath,',
    'deps, err, cfg, route, agentId, prompt, runSessionKey, storePath,',
  )
  next = next.replace(
    [
      '                                cfg = this.coreConfig;',
      '                                agentId = this.agentId;',
    ].join('\n'),
    [
      '                                route = resolveClawTalkAgentRoute(params, this.coreConfig, this.agentId, this.logger);',
      '                                cfg = route.config;',
      '                                agentId = route.agentId;',
      '                                prompt = route.prompt;',
      '                                runSessionKey = route.sessionKey;',
    ].join('\n'),
  )
  next = next.replace('entry = sessionStore[params.sessionKey];', 'entry = sessionStore[runSessionKey];')
  next = next.replace('sessionStore[params.sessionKey] = entry;', 'sessionStore[runSessionKey] = entry;')
  next = next.replace(
    'runId = "clawtalk:".concat(params.sessionKey, ":").concat(Date.now());',
    'runId = "clawtalk:".concat(runSessionKey, ":").concat(Date.now());',
  )
  next = next.replace(
    '(_this_logger_debug = (_this_logger = this.logger).debug) === null || _this_logger_debug === void 0 ? void 0 : _this_logger_debug.call(_this_logger, "CoreBridge: running agent turn session=".concat(params.sessionKey, " timeout=").concat(timeoutMs, "ms"));',
    '(_this_logger_debug = (_this_logger = this.logger).debug) === null || _this_logger_debug === void 0 ? void 0 : _this_logger_debug.call(_this_logger, "CoreBridge: running agent turn session=".concat(runSessionKey, " agent=").concat(agentId, " timeout=").concat(timeoutMs, "ms"));',
  )
  next = next.replace('sessionKey: params.sessionKey,', 'sessionKey: runSessionKey,')
  next = next.replace('prompt: params.prompt,', 'prompt: prompt,')
  next = next.replace(
    [
      '                                // Resolve model - prefer params, then config (string or object.primary), fall back to extensionAPI defaults',
      '                                modelCfg = cfg === null || cfg === void 0 ? void 0 : (_cfg_agents = cfg.agents) === null || _cfg_agents === void 0 ? void 0 : (_cfg_agents_defaults = _cfg_agents.defaults) === null || _cfg_agents_defaults === void 0 ? void 0 : _cfg_agents_defaults.model;',
      '                                configModel = typeof modelCfg === \'string\' ? modelCfg : modelCfg === null || modelCfg === void 0 ? void 0 : modelCfg.primary;',
      '                                modelRef = (_ref = (_params_model = params.model) !== null && _params_model !== void 0 ? _params_model : configModel) !== null && _ref !== void 0 ? _ref : "".concat(deps.DEFAULT_PROVIDER, "/").concat(deps.DEFAULT_MODEL);',
    ].join('\n'),
    [
      '                                // Resolve model - prefer the routed agent, then explicit params, then config defaults.',
      '                                configModel = resolveClawTalkAgentModelRef(cfg, agentId);',
      '                                modelCfg = cfg === null || cfg === void 0 ? void 0 : (_cfg_agents = cfg.agents) === null || _cfg_agents === void 0 ? void 0 : (_cfg_agents_defaults = _cfg_agents.defaults) === null || _cfg_agents_defaults === void 0 ? void 0 : _cfg_agents_defaults.model;',
      '                                if (!configModel) configModel = typeof modelCfg === \'string\' ? modelCfg : modelCfg === null || modelCfg === void 0 ? void 0 : modelCfg.primary;',
      '                                modelRef = normalizeClawTalkModelRef((_ref = configModel || params.model) !== null && _ref !== void 0 ? _ref : "".concat(deps.DEFAULT_PROVIDER, "/").concat(deps.DEFAULT_MODEL));',
    ].join('\n'),
  )
  next = next.replace(
    /deps\.runEmbeddedPiAgent\(\{\s*sessionId: sessionId,\s*sessionKey: runSessionKey,\s*messageProvider: 'clawtalk',\s*sessionFile: sessionFile,\s*workspaceDir: workspaceDir,\s*config: cfg,\s*prompt: prompt,\s*provider: provider,\s*model: model,\s*thinkLevel: thinkLevel,\s*verboseLevel: 'off',\s*timeoutMs: timeoutMs,\s*runId: runId,\s*lane: 'clawtalk',\s*extraSystemPrompt: params\.extraSystemPrompt,\s*agentDir: agentDir\s*\}\)/,
    [
      'runClawTalkControlCenterOrEmbeddedAgentTurn({',
      '                                        embedded: deps.runEmbeddedPiAgent.bind(deps),',
      '                                        embeddedParams: {',
      '                                            sessionId: sessionId,',
      '                                            sessionKey: runSessionKey,',
      "                                            messageProvider: 'clawtalk',",
      '                                            sessionFile: sessionFile,',
      '                                            workspaceDir: workspaceDir,',
      '                                            config: cfg,',
      '                                            prompt: prompt,',
      '                                            provider: provider,',
      '                                            model: model,',
      '                                            thinkLevel: thinkLevel,',
      "                                            verboseLevel: 'off',",
      '                                            timeoutMs: timeoutMs,',
      '                                            runId: runId,',
      "                                            lane: 'clawtalk',",
      '                                            extraSystemPrompt: params.extraSystemPrompt,',
      '                                            agentDir: agentDir',
      '                                        },',
      '                                        agentId: agentId,',
      '                                        prompt: prompt,',
      '                                        sessionKey: runSessionKey,',
      '                                        modelRef: modelRef,',
      '                                        thinkLevel: thinkLevel,',
      '                                        timeoutMs: timeoutMs,',
      '                                        extraSystemPrompt: params.extraSystemPrompt,',
      '                                        logger: this.logger',
      '                                    })',
    ].join('\n'),
  )
  if (next !== source && !next.includes('runClawTalkControlCenterOrEmbeddedAgentTurn({')) {
    console.warn('[plugins/clawtalk] CoreBridge patch skipped: embedded agent turn marker was not replaced')
    return source
  }
  return next
}

function patchedClawTalkVoiceDeepToolSource(source: string) {
  let next = source
  next = next.replace('prompt: VOICE_PREFIX + query,', 'prompt: query,')
  next = next.replace('extraSystemPrompt: this.voiceService.buildContext(),', 'extraSystemPrompt: VOICE_PREFIX + this.voiceService.buildContext(),')
  return next
}

function patchedClawTalkSmsHandlerSource(source: string) {
  let next = source
  next = next.replace('var SMS_TIMEOUT_MS = 90000;', 'var SMS_TIMEOUT_MS = 60000;')
  next = next.replace('const SMS_TIMEOUT_MS = 90000;', 'const SMS_TIMEOUT_MS = 60000;')
  next = next.replace(/\nvar CLAWTALK_SMS_HANDLER_PATCH_VERSION = \d+;[\s\S]*$/u, '')
  const deliveryPatchVersion = 'var CLAWTALK_SMS_DELIVERY_RETRY_PATCH_VERSION = 1;'
  const deliveryPatchPattern = /var CLAWTALK_SMS_DELIVERY_RETRY_PATCH_VERSION = \d+;[\s\S]*?\/\/#endregion clawtalk-sms-delivery-retry-patch/
  const deliveryPatch = String.raw`${deliveryPatchVersion}
var CLAWTALK_SMS_DELIVERY_MAX_ATTEMPTS = 3;
var CLAWTALK_SMS_DELIVERY_RETRY_BASE_MS = 750;
function isClawTalkSmsDeliveryRetryable(error) {
    var status = Number(error === null || error === void 0 ? void 0 : error.status);
    if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    var message = error instanceof Error ? error.message : String(error);
    return !Number.isFinite(status) || status === 0 || status === 408 || status === 429 || /network error|fetch failed|econnreset|econnrefused|enotfound|etimedout|socket hang up|timeout|abort/i.test(message);
}
function waitForClawTalkSmsDeliveryRetry(delayMs) {
    return new Promise(function(resolve) { return setTimeout(resolve, delayMs); });
}
async function sendClawTalkSmsWithRetry(client, logger, params) {
    var lastError;
    for(var attempt = 1; attempt <= CLAWTALK_SMS_DELIVERY_MAX_ATTEMPTS; attempt++){
        try {
            return await client.sms.send(params);
        } catch (error) {
            lastError = error;
            if (attempt >= CLAWTALK_SMS_DELIVERY_MAX_ATTEMPTS || !isClawTalkSmsDeliveryRetryable(error)) throw error;
            var delayMs = CLAWTALK_SMS_DELIVERY_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            var reason = error instanceof Error ? error.message : String(error);
            if (logger && typeof logger.warn === 'function') logger.warn("SMS delivery transient failure; retry ".concat(attempt, "/").concat(CLAWTALK_SMS_DELIVERY_MAX_ATTEMPTS - 1, " in ").concat(delayMs, "ms: ").concat(reason));
            await waitForClawTalkSmsDeliveryRetry(delayMs);
        }
    }
    throw lastError;
}
//#endregion clawtalk-sms-delivery-retry-patch`
  if (deliveryPatchPattern.test(next)) {
    next = next.replace(deliveryPatchPattern, deliveryPatch)
  } else if (!next.includes(deliveryPatchVersion)) {
    next = next.replace('function normalizePhone(phone) {', `${deliveryPatch}\nfunction normalizePhone(phone) {`)
  }
  next = next.replace('Promise.resolve(client.sms.send({', 'Promise.resolve(sendClawTalkSmsWithRetry(client, logger, {')
  next = next.replace('this.client.sms.send({', 'sendClawTalkSmsWithRetry(this.client, this.logger, {')
  return next
}


function patchedTelegramBotRuntimeSource(source: string) {
  let next = source
  const routingPatchVersion = 'var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 15;'
  const routingHelperPattern = /var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = \d+;[\s\S]*?\/\/#endregion telegram-agent-routing-patch/
  if (routingHelperPattern.test(next)) {
    next = next.replace(routingHelperPattern, TELEGRAM_AGENT_ROUTING_HELPER)
  } else if (!next.includes(routingPatchVersion)) {
    next = next.replace(
      '//#region extensions/telegram/src/group-config-helpers.ts',
      `${TELEGRAM_AGENT_ROUTING_HELPER}\n//#region extensions/telegram/src/group-config-helpers.ts`,
    )
  }
  next = next.replace(
    'const wasMentioned = options?.forceWasMentioned === true ? true : computedWasMentioned;',
    [
      'const telegramAgentRouteMentioned = isTelegramAgentRouteCommand(rawBody, cfg, routeAgentId);',
      'const wasMentioned = options?.forceWasMentioned === true ? true : computedWasMentioned || telegramAgentRouteMentioned;',
    ].join('\n\t'),
  )
  const routeApplicationMarker = 'const telegramAgentRoute = resolveTelegramAgentRouteForMessage({'
  const trafficGateRecoveryLines = [
    'const telegramTrafficGate = await resolveTelegramTrafficGateStatus();',
    'if (!telegramTrafficGate.allowed) {',
    'const telegramTrafficGateMessage = telegramTrafficGate.blocked',
    '? "Automnia is connected to Telegram, but message access is currently paused for this account. Check your Automnia license or credits, then try again."',
    ': "Automnia is connected to Telegram and is still starting its billed message route. Keep Automnia open; the message route will retry automatically.";',
    'await sendTelegramRecoveryMessage({',
    'bot,',
    'runtime,',
    'chatId,',
    'messageId: msg.message_id,',
    'text: telegramTrafficGateMessage',
    '});',
    'return null;',
    '}',
  ]
  const trafficGateRecoveryBlock = trafficGateRecoveryLines.join('\n\t')
  if (!next.includes(routeApplicationMarker)) {
    const bodyResultMarker = 'if (!bodyResult) return null;'
    const routeApplicationBlock = [
      ...trafficGateRecoveryLines,
      'const telegramAgentRoute = resolveTelegramAgentRouteForMessage({',
      'cfg: freshCfg,',
      'route,',
      'accountId: account.accountId,',
      'chatId,',
      'isGroup,',
      'resolvedThreadId,',
      'dmThreadId,',
      'senderId,',
      'botHasTopicsEnabled: resolveTelegramBotHasTopicsEnabled(primaryCtx.me),',
      'rawBody: bodyResult.rawBody,',
      'bodyText: bodyResult.bodyText',
      '});',
      'if (telegramAgentRoute.changed) {',
      'route = telegramAgentRoute.route;',
      'bodyResult.rawBody = telegramAgentRoute.rawBody;',
      'bodyResult.bodyText = telegramAgentRoute.bodyText;',
      'const telegramAgentModelRef = route.modelRef || resolveTelegramAgentModelRef(freshCfg, route.agentId);',
      'console.log(`[telegram] Agent route selected: agent=${route.agentId} mode=${telegramAgentRoute.reason || "selected"} scope=${route.lastRoutePolicy || "session"} model=${telegramAgentModelRef || "configured-default"}`);',
      '}',
      'bodyResult.bodyText = withTelegramAgentRouteContext({',
      'config: freshCfg,',
      'agentId: route.agentId,',
      'sessionKey: route.sessionKey,',
      'prompt: bodyResult.bodyText',
      '});',
    ].join('\n\t')
    if (next.includes(bodyResultMarker)) {
      next = next.replace(bodyResultMarker, `${bodyResultMarker}\n\t${routeApplicationBlock}`)
    } else {
      console.warn('[plugins/telegram] agent route patch skipped: inbound body marker not found')
    }
  }
  const legacyTrafficGateGuard = 'if (!(await automniaTrafficGateAllowsMessages())) return null;'
  if (next.includes(legacyTrafficGateGuard)) {
    next = next.replace(legacyTrafficGateGuard, trafficGateRecoveryBlock)
  }
  const previousVisibleTrafficGateGuard = /if \(!\(await automniaTrafficGateAllowsMessages\(\)\)\) \{[\s\S]*?return null;\n\t\}/u
  if (next.includes('message route is not ready yet.') && previousVisibleTrafficGateGuard.test(next)) {
    next = next.replace(previousVisibleTrafficGateGuard, trafficGateRecoveryBlock)
  }
  const configuredBindingFailureMarker = 'logVerbose(`telegram: configured ACP binding unavailable for ${bindingMode.binding.record.conversation.conversationId}: ${ensured.error}`);'
  if (next.includes(configuredBindingFailureMarker) && !next.includes('conversation is still initializing.')) {
    next = next.replace(
      configuredBindingFailureMarker,
      [
        configuredBindingFailureMarker,
        'await sendTelegramRecoveryMessage({',
        'bot,',
        'runtime,',
        'chatId,',
        'messageId: msg.message_id,',
        'text: "Automnia received your message, but this conversation is still initializing. Keep Automnia open; the route will retry automatically."',
        '});',
      ].join('\n\t'),
    )
  }
  const noVisibleResponseMarker = 'const hasFinalResponse = finalAnswerDelivered || sentFallback || suppressSilentReplyFallback || queuedFinal;'
  if (next.includes(noVisibleResponseMarker) && !next.includes('No response was generated for this Telegram message.')) {
    const noVisibleResponseBlock = [
      'if (!sentFallback && !isRoomEvent && !suppressSilentReplyFallback && !queuedFinal && !deliverySummary.delivered) {',
      'sentFallback = (await (telegramDeps.deliverReplies ?? deliverReplies)({',
      'replies: [{ text: "No response was generated for this Telegram message. Please try again; Automnia stayed on the billed route." }],',
      '...deliveryBaseOptions,',
      'silent: false,',
      'mediaLoader: telegramDeps.loadWebMedia',
      '})).delivered;',
      '}',
    ].join('\n\t')
    next = next.replace(noVisibleResponseMarker, `${noVisibleResponseBlock}\n\t${noVisibleResponseMarker}`)
  }
  const nativeAgentsCommandMarker = 'const commandDefinition = findCommandByNativeName(command.name, "telegram");\n\t\t\t\tconst rawText = ctx.match?.trim() ?? "";'
  if (!next.includes('const telegramAgentsCommandText = resolveTelegramAgentsCommandResponse({')) {
    const nativeAgentsCommandBlock = [
      nativeAgentsCommandMarker,
      'if (commandDefinition?.key === "agents") {',
      'const telegramAgentsCommandText = resolveTelegramAgentsCommandResponse({',
      'cfg: runtimeCfg,',
      'accountId,',
      'chatId,',
      'isGroup,',
      'resolvedThreadId,',
      'dmThreadId: threadSpec.scope === "dm" ? threadSpec.id : void 0,',
      'routeAgentId: route.agentId,',
      'rawText',
      '});',
      'await withTelegramApiErrorLogging({',
      'operation: "sendMessage",',
      'runtime,',
      'fn: () => bot.api.sendMessage(chatId, telegramAgentsCommandText, threadParams)',
      '});',
      'return;',
      '}',
    ].join('\n\t\t\t\t');
    if (next.includes(nativeAgentsCommandMarker)) {
      next = next.replace(nativeAgentsCommandMarker, nativeAgentsCommandBlock);
    } else {
      console.warn('[plugins/telegram] agents command patch skipped: native command marker not found');
    }
  }
  if (next !== source && !next.includes(routeApplicationMarker)) {
    console.warn('[plugins/telegram] agent route patch skipped: route application marker was not inserted')
    return source
  }
  const identityDeliveryMarker = 'beforeDeliver: async (payload) => payload,\n\t\t\t\t\t\t\t\t\tonBeforeDeliverCancelled: (payload, info) => {'
  if (next.includes(identityDeliveryMarker)) {
    next = next.replace(
      identityDeliveryMarker,
      [
        'beforeDeliver: async (payload, info) => applyTelegramVerifiedIdentityDeliveryGuard({',
        'payload,',
        'info,',
        'config: cfg,',
        'agentId: route.agentId,',
        'prompt: ctxPayload.RawBody',
        '}),',
        'onBeforeDeliverCancelled: (payload, info) => {',
      ].join('\n\t\t\t\t\t\t\t\t\t'),
    )
  } else if (!next.includes('applyTelegramVerifiedIdentityDeliveryGuard({')) {
    console.warn('[plugins/telegram] identity delivery guard skipped: reply delivery marker not found')
  }
  const modelDataMarker = 'const { byProvider, providers, modelNames, resolvedDefault: activeResolvedDefault } = modelData;'
  if (!next.includes('telegramCreditsOnlyModelData(runtimeCfg, modelData)')) {
    if (next.includes(modelDataMarker)) {
      next = next.replace(
        modelDataMarker,
        `const restrictedTelegramModelData = telegramCreditsOnlyModelData(runtimeCfg, modelData);\n\t\t\t\tconst { byProvider, providers, modelNames, resolvedDefault: activeResolvedDefault } = restrictedTelegramModelData;`,
      )
    } else {
      console.warn('[plugins/telegram] credits-only model data guard skipped: model data marker not found')
    }
  }
  const modelSelectionMarker = 'const selection = resolveModelSelection({'
  if (!next.includes('telegramCreditsOnlyModelSelectionAllowed(runtimeCfg, modelCallback)')) {
    const modelSelectionGuard = [
      'if (!telegramCreditsOnlyModelSelectionAllowed(runtimeCfg, modelCallback)) {',
      'try { await editMessageWithButtons("Starter Subscription is locked to Automnia credits only. Upgrade to choose a provider model.", []); } catch (err) { throw new TelegramRetryableCallbackError(err); }',
      'return;',
      '}',
    ].join('\n\t\t\t\t\t')
    if (next.includes(modelSelectionMarker)) {
      next = next.replace(modelSelectionMarker, `${modelSelectionGuard}\n\t\t\t\t\t${modelSelectionMarker}`)
    } else {
      console.warn('[plugins/telegram] credits-only model guard skipped: model selection marker not found')
    }
  }
  return next
}

function openClawPackageRootCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  return uniqueStrings(
    openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : '',
    path.resolve(process.cwd(), 'vendor', 'openclaw'),
    path.resolve(process.cwd(), 'resources', 'openclaw'),
    path.resolve(WORKSPACE_ROOT, 'vendor', 'openclaw'),
    electronResourcesPath ? path.join(electronResourcesPath, 'openclaw') : '',
  ).filter(Boolean)
}

async function telegramBotRuntimeFileCandidates() {
  const files: string[] = []
  for (const root of openClawPackageRootCandidates()) {
    const distRoot = path.join(root, 'dist')
    const entries = await fs.readdir(distRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      // OpenClaw's Telegram entry has shipped under both `bot*.js` and
      // `telegram-ingress-*.js`. The implementation-shape check in the
      // repair loop remains the final guard, so discover Telegram-named
      // direct dist entries instead of relying on one build filename.
      if (!entry.name.toLowerCase().includes('telegram')) continue
      files.push(path.join(distRoot, entry.name))
    }
  }
  return uniqueStrings(files)
}

async function runtimeRepairFileWritable(filePath: string) {
  try {
    await fs.access(filePath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function repairTelegramAgentRoutingRuntime() {
  const candidates = await telegramBotRuntimeFileCandidates()
  const repaired: string[] = []
  for (const entryPath of candidates) {
    const beforeSignature = await telegramRepairSignature(entryPath)
    if (telegramRepairSignatureCache.get(entryPath) === beforeSignature) continue
    if (!await runtimeRepairFileWritable(entryPath)) {
      telegramRepairSignatureCache.set(entryPath, beforeSignature)
      continue
    }
    const source = await fs.readFile(entryPath, 'utf-8').catch(() => '')
    if (!source.includes('const buildTelegramMessageContext = async') || !source.includes('function resolveTelegramInboundBody')) {
      telegramRepairSignatureCache.set(entryPath, beforeSignature)
      continue
    }
    const next = patchedTelegramBotRuntimeSource(source)
    if (next === source) {
      telegramRepairSignatureCache.set(entryPath, beforeSignature)
      continue
    }
    await writeTextFileWithLockRetry(entryPath, next)
    telegramRepairSignatureCache.set(entryPath, await telegramRepairSignature(entryPath))
    repaired.push(entryPath)
  }
  return repaired
}

async function repairClawTalkRuntimeDataDir(root: string) {
  const entryPath = path.join(root, 'build', 'index.js')
  const source = await fs.readFile(entryPath, 'utf-8').catch(() => '')
  if (!source) return false
  const next = patchedClawTalkRuntimeSource(source)
  if (next === source) return false
  await writeTextFileWithLockRetry(entryPath, next)
  return true
}

async function repairClawTalkCoreBridgeRouting(root: string) {
  const entryPath = path.join(root, 'build', 'services', 'CoreBridge.js')
  const source = await fs.readFile(entryPath, 'utf-8').catch(() => '')
  if (!source) return false
  const next = patchedClawTalkCoreBridgeSource(source)
  if (next === source) return false
  await writeTextFileWithLockRetry(entryPath, next)
  return true
}

async function repairClawTalkVoiceDeepToolRouting(root: string) {
  const entryPath = path.join(root, 'build', 'services', 'DeepToolHandler.js')
  const source = await fs.readFile(entryPath, 'utf-8').catch(() => '')
  if (!source) return false
  const next = patchedClawTalkVoiceDeepToolSource(source)
  if (next === source) return false
  await writeTextFileWithLockRetry(entryPath, next)
  return true
}

async function repairClawTalkSmsHandler(root: string) {
  const entryPath = path.join(root, 'build', 'services', 'SmsHandler.js')
  const source = await fs.readFile(entryPath, 'utf-8').catch(() => '')
  if (!source) return false
  const next = patchedClawTalkSmsHandlerSource(source)
  if (next === source) return false
  await writeTextFileWithLockRetry(entryPath, next)
  return true
}

async function repairClawTalkPluginManifestContracts() {
  const roots = await installedClawTalkPluginRootCandidates()
  const repaired: string[] = []
  for (const root of roots) {
    const beforeSignature = await clawTalkRepairSignature(root)
    if (clawTalkRepairSignatureCache.get(root) === beforeSignature) continue
    let changed = false
    const manifestPath = path.join(root, 'openclaw.plugin.json')
    const manifest = await fs.readFile(manifestPath, 'utf-8')
      .then((raw) => JSON.parse(raw) as unknown)
      .catch(() => null)
    if (isLooseRecord(manifest) && ensureClawTalkManifestContracts(manifest)) {
      await writeTextFileWithLockRetry(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      changed = true
    }
    if (await repairClawTalkRuntimeDataDir(root)) changed = true
    if (await repairClawTalkCoreBridgeRouting(root)) changed = true
    if (await repairClawTalkSmsHandler(root)) changed = true
    if (await repairClawTalkVoiceDeepToolRouting(root)) changed = true
    clawTalkRepairSignatureCache.set(root, await clawTalkRepairSignature(root))
    if (changed) repaired.push(root)
  }
  return repaired
}

function defaultClawTalkAgentId(config: OpenClawConfigFile) {
  const agentIds = (config.agents?.list || [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id))
  if (agentIds.includes(CLAWTALK_DEFAULT_AGENT_ID)) return CLAWTALK_DEFAULT_AGENT_ID
  return agentIds.find((agentId) => !isRetiredAgentId(agentId)) || 'main'
}

function legacyClawTalkRoutingConfig(entryConfig: Record<string, unknown>) {
  const routing = isLooseRecord(entryConfig.routing) ? entryConfig.routing : {}
  return routing
}

function clawTalkAgentIdFromConfig(config: OpenClawConfigFile, entryConfig: Record<string, unknown>) {
  const routing = legacyClawTalkRoutingConfig(entryConfig)
  return typeof entryConfig.agentId === 'string' && entryConfig.agentId.trim()
    ? entryConfig.agentId.trim()
    : typeof routing.defaultAgentId === 'string' && routing.defaultAgentId.trim()
      ? routing.defaultAgentId.trim()
      : defaultClawTalkAgentId(config)
}

function withoutLegacyClawTalkConfigFields(entryConfig: Record<string, unknown>) {
  const nextConfig = { ...entryConfig }
  delete nextConfig.routing
  delete nextConfig.apiKeyRef
  delete nextConfig.apiKeyStorage
  return nextConfig
}

function isClawTalkDisabled(config: OpenClawConfigFile, entry: OpenClawPluginEntryConfig | undefined) {
  const entryConfig = isLooseRecord(entry?.config) ? entry.config : {}
  return entry?.enabled === false ||
    entryConfig.enabled === false ||
    (Array.isArray(config.plugins?.deny) && config.plugins.deny.includes(CLAWTALK_PLUGIN_ID))
}

function withClawTalkMissionConfig(config: Record<string, unknown>, enabled: boolean) {
  const missions = isLooseRecord(config.missions) ? config.missions : {}
  const observer = isLooseRecord(missions.observer) ? missions.observer : {}
  return {
    ...missions,
    enabled,
    observer: {
      ...observer,
      enabled,
    },
  }
}

function ensureClawTalkBundledPluginDefaults(config: OpenClawConfigFile) {
  const bundledRoot = resolveBundledClawTalkPluginRoot()
  const existingEntry = config.plugins?.entries?.[CLAWTALK_PLUGIN_ID]
  if (!bundledRoot && !existingEntry) return

  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  if (!config.plugins.load) config.plugins.load = {}

  const entry = {
    ...(config.plugins.entries[CLAWTALK_PLUGIN_ID] || {}),
  } as OpenClawPluginEntryConfig
  const entryConfig = isLooseRecord(entry.config) ? entry.config : {}
  const configuredLoadPaths = sanitizedPluginLoadPaths(config.plugins.load.paths)

  if (isClawTalkDisabled(config, entry)) {
    entry.enabled = false
    const nextConfig = withoutLegacyClawTalkConfigFields(entryConfig)
    entry.config = {
      ...nextConfig,
      enabled: false,
      autoConnect: false,
      missions: withClawTalkMissionConfig(nextConfig, false),
    }
    config.plugins.entries[CLAWTALK_PLUGIN_ID] = entry
    config.plugins.load.paths = configuredLoadPaths.filter((pathEntry) => !isClawTalkPluginPath(pathEntry))
    config.plugins.allow = uniqueStrings(config.plugins.allow).filter((id) => id !== CLAWTALK_PLUGIN_ID)
    config.plugins.deny = uniqueStrings(config.plugins.deny, CLAWTALK_PLUGIN_ID)
    removeToolPolicyGrant(config, CLAWTALK_PLUGIN_ID)
    return
  }

  const hasApiKey = typeof entryConfig.apiKey === 'string' && entryConfig.apiKey.trim().length > 0
  const nextConfig = withoutLegacyClawTalkConfigFields(entryConfig)
  entry.enabled = true
  entry.config = {
    ...nextConfig,
    enabled: true,
    server: typeof nextConfig.server === 'string' && nextConfig.server.trim()
      ? nextConfig.server.trim()
      : CLAWTALK_DEFAULT_SERVER,
    agentId: clawTalkAgentIdFromConfig(config, entryConfig),
    autoConnect: hasApiKey ? true : nextConfig.autoConnect !== false,
    missions: withClawTalkMissionConfig(nextConfig, true),
  }
  config.plugins.entries[CLAWTALK_PLUGIN_ID] = entry
  config.plugins.allow = uniqueStrings(config.plugins.allow, CLAWTALK_PLUGIN_ID)
  config.plugins.deny = uniqueStrings(config.plugins.deny).filter((id) => id !== CLAWTALK_PLUGIN_ID)
  config.plugins.bundledDiscovery ??= 'compat'
  config.plugins.load.paths = configuredLoadPaths
  ensureToolPolicyGrant(config, CLAWTALK_PLUGIN_ID)
}

function pluginStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function pluginArrayFromRecord(record: Record<string, unknown> | null, key: string): string[] {
  return record ? pluginStringArray(record[key]) : []
}

function normalizedProviderConfigId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function pluginIdFromRawPlugin(raw: Record<string, unknown>): string {
  return normalizedPluginId(raw.id || pluginIdFromPackageName(raw.name))
}

function webSearchProviderIdsFromRawPlugin(raw: Record<string, unknown>): string[] {
  const contracts = isLooseRecord(raw.contracts) ? raw.contracts : null
  return uniqueStrings(
    pluginStringArray(raw.webSearchProviderIds),
    pluginArrayFromRecord(contracts, 'webSearchProviders'),
  )
    .map(normalizedProviderConfigId)
    .filter(Boolean)
}

async function webSearchProviderIdsForPlugin(pluginId: string): Promise<string[]> {
  const id = normalizedPluginId(pluginId)
  if (!id) return []
  const pluginList = await getPluginList().catch(() => null)
  const raw = pluginList?.rawPlugins.find((entry) => pluginIdFromRawPlugin(entry) === id)
  return raw ? webSearchProviderIdsFromRawPlugin(raw) : []
}

async function applyWebSearchProviderSelectionForPlugin(
  config: OpenClawConfigFile,
  pluginId: string,
  enabled: boolean,
): Promise<boolean> {
  const id = normalizedPluginId(pluginId)
  const providerIds = await webSearchProviderIdsForPlugin(id)
  if (!id || providerIds.length === 0) return false

  const before = JSON.stringify(config.tools?.web?.search || null)
  if (enabled) {
    if (!config.tools) config.tools = {}
    if (!config.tools.web) config.tools.web = {}
    if (!config.tools.web.search) config.tools.web.search = {}
    config.tools.web.search.enabled = true
    config.tools.web.search.provider = providerIds[0]
  } else {
    const search = config.tools?.web?.search
    const selected = normalizedProviderConfigId(search?.provider)
    if (search && (selected === id || providerIds.includes(selected))) {
      delete search.provider
    }
  }

  const after = JSON.stringify(config.tools?.web?.search || null)
  if (after === before) return false
  return true
}

async function ensureWebSearchProviderSelectionFromRuntimeState(config: OpenClawConfigFile): Promise<boolean> {
  if (typeof config.tools?.web?.search?.provider === 'string' && config.tools.web.search.provider.trim()) return false

  const state = await readPluginRuntimeState().catch(() => ({} as PluginRuntimeState))
  const managedIds = Object.entries(state.managed || {})
    .filter(([, entry]) => entry?.enabled !== false)
    .sort(([, left], [, right]) => String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')))
    .map(([id]) => id)
  const candidateIds = normalizedPluginIds(managedIds, enabledRuntimePluginIds(state), enabledPluginEntryIds(config))

  for (const id of candidateIds) {
    const providerIds = await webSearchProviderIdsForPlugin(id)
    if (!providerIds.length) continue
    if (!config.tools) config.tools = {}
    if (!config.tools.web) config.tools.web = {}
    if (!config.tools.web.search) config.tools.web.search = {}
    config.tools.web.search.enabled = true
    config.tools.web.search.provider = providerIds[0]
    return true
  }

  return false
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

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizePluginInstallSpec(raw: Record<string, unknown>, fallbackId: string) {
  const explicit = stringField(raw, ['installSpec', 'spec', 'packageSpec', 'ref'])
  if (explicit) return explicit
  const packageName = stringField(raw, ['packageName', 'package', 'npmPackage', 'name'])
  const source = stringField(raw, ['source', 'registry', 'kind']).toLowerCase()
  if (packageName && /^(?:clawhub|npm|file|path):/i.test(packageName)) return packageName
  if (packageName) return source === 'npm' ? `npm:${packageName}` : `clawhub:${packageName}`
  return fallbackId ? `clawhub:${fallbackId}` : ''
}

function normalizePluginSearchResult(raw: Record<string, unknown>, installedIds: Set<string>): PluginSearchResult | null {
  const packageRecord = isLooseRecord(raw.package) ? raw.package : null
  const searchRecord = packageRecord || raw
  const packageName =
    stringField(searchRecord, ['packageName', 'package', 'npmPackage', 'name']) ||
    stringField(raw, ['packageName', 'npmPackage'])
  const id = (
    stringField(searchRecord, ['runtimeId', 'id', 'pluginId', 'slug']) ||
    stringField(raw, ['runtimeId', 'id', 'pluginId', 'slug']) ||
    pluginIdFromPackageName(packageName || stringField(searchRecord, ['displayName', 'title', 'name']))
  ).trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) return null

  const name = stringField(searchRecord, ['displayName', 'title', 'name']) || displayPluginName(id, packageName)
  const installSpec = normalizePluginInstallSpec({
    ...searchRecord,
    ...raw,
    ...(packageName ? { packageName } : {}),
    source: 'clawhub',
  }, id)
  if (!installSpec) return null

  return {
    id,
    name,
    description: stringField(searchRecord, ['description', 'summary']) || stringField(raw, ['description', 'summary']) || `Install OpenClaw plugin ${id}.`,
    source: stringField(raw, ['source', 'registry', 'kind']) || 'clawhub',
    installSpec,
    ...(packageName ? { packageName } : {}),
    ...(stringField(searchRecord, ['version', 'latestVersion']) ? { version: stringField(searchRecord, ['version', 'latestVersion']) } : {}),
    ...(stringField(searchRecord, ['publisher', 'owner', 'ownerHandle', 'author']) ? { publisher: stringField(searchRecord, ['publisher', 'owner', 'ownerHandle', 'author']) } : {}),
    ...(typeof raw.score === 'number' ? { score: raw.score } : {}),
    ...(typeof searchRecord.verified === 'boolean' ? { verified: searchRecord.verified } : {}),
    ...(searchRecord.isOfficial === true ? { verified: true } : {}),
    installed: installedIds.has(id),
  }
}

function parsePluginSearchResults(stdout: string, installedIds: Set<string>): PluginSearchResult[] {
  const parsed = parseOpenClawJsonOutput(stdout)
  const records = Array.isArray(parsed)
    ? parsed
    : isLooseRecord(parsed) && Array.isArray(parsed.results)
      ? parsed.results
      : isLooseRecord(parsed) && Array.isArray(parsed.plugins)
        ? parsed.plugins
        : isLooseRecord(parsed) && Array.isArray(parsed.packages)
          ? parsed.packages
          : []

  const seen = new Set<string>()
  return records
    .filter(isLooseRecord)
    .map((record) => normalizePluginSearchResult(record, installedIds))
    .filter((entry): entry is PluginSearchResult => Boolean(entry))
    .filter((entry) => {
      const key = `${entry.id}:${entry.installSpec}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 50)
}

function splitPluginCommandLine(input: string) {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaping = false
  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (escaping) current += '\\'
  if (quote) throw new Error('Install command has an unterminated quote.')
  if (current) tokens.push(current)
  return tokens
}

function isOpenClawCommandToken(token: string) {
  const normalized = path.basename(token).toLowerCase().replace(/\.(?:cmd|bat|exe|mjs|js)$/i, '')
  return normalized === 'openclaw'
}

function parseOpenClawCommandInput(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('OpenClaw command is required.')
  if (trimmed.length > 4000) throw new Error('OpenClaw command is too long.')
  const tokens = splitPluginCommandLine(trimmed)
  if (!tokens.length) throw new Error('OpenClaw command is required.')
  const args = isOpenClawCommandToken(tokens[0]) ? tokens.slice(1) : tokens
  if (!args.length) return ['--help']
  if (args.some((arg) => {
    const codePoints = Array.from(arg)
    return codePoints.some((char) => {
      const code = char.charCodeAt(0)
      return code <= 31 || code === 127
    })
  })) {
    throw new Error('OpenClaw command contains unsupported control characters.')
  }
  return args
}

function bundledCodexPluginRootCandidates() {
  const electronResourcesPath = getElectronResourcesPath()
  const openclawDir = openclawBin && openclawBin !== 'openclaw' ? path.dirname(path.resolve(openclawBin)) : ''
  return uniqueStrings(
    openclawDir ? path.join(openclawDir, 'dist', 'extensions', 'codex') : '',
    path.resolve(process.cwd(), 'vendor', 'openclaw', 'dist', 'extensions', 'codex'),
    path.resolve(process.cwd(), 'resources', 'openclaw', 'dist', 'extensions', 'codex'),
    electronResourcesPath ? path.join(electronResourcesPath, 'openclaw', 'dist', 'extensions', 'codex') : '',
  ).filter(Boolean)
}

function codexNativePackageNameForCurrentPlatform() {
  const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : ''
  if (!arch) return ''
  if (process.platform === 'win32') return `codex-win32-${arch}`
  if (process.platform === 'linux') return `codex-linux-${arch}`
  if (process.platform === 'darwin') return `codex-darwin-${arch}`
  return ''
}

function codexTargetTripleForCurrentPlatform() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : process.arch === 'x64' ? 'x86_64-pc-windows-msvc' : ''
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : process.arch === 'x64' ? 'x86_64-unknown-linux-musl' : ''
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : process.arch === 'x64' ? 'x86_64-apple-darwin' : ''
  return ''
}

function bundledCodexNativeBinaryPath(root: string) {
  const packageName = codexNativePackageNameForCurrentPlatform()
  const targetTriple = codexTargetTripleForCurrentPlatform()
  if (!packageName || !targetTriple) return ''
  return path.join(
    root,
    'node_modules',
    '@openai',
    packageName,
    'vendor',
    targetTriple,
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  )
}

function bundledCodexNativeBinaryIsUsable(root: string) {
  const binaryPath = bundledCodexNativeBinaryPath(root)
  if (!binaryPath || !existsSync(binaryPath)) return false
  if (process.platform === 'win32') return true
  try {
    const mode = statSync(binaryPath).mode
    if ((mode & 0o111) === 0) chmodSync(binaryPath, mode | 0o755)
    return (statSync(binaryPath).mode & 0o111) !== 0
  } catch {
    return false
  }
}

function bundledCodexPluginSupportsCurrentPlatform(root: string) {
  const packageName = codexNativePackageNameForCurrentPlatform()
  if (!packageName) return false
  return existsSync(path.join(root, 'node_modules', '@openai', 'codex', 'package.json')) &&
    existsSync(path.join(root, 'node_modules', '@openai', packageName, 'package.json')) &&
    bundledCodexNativeBinaryIsUsable(root)
}

function resolveBundledCodexPluginRoot() {
  return bundledCodexPluginRootCandidates().find((candidate) => (
    existsSync(path.join(candidate, 'openclaw.plugin.json')) &&
    existsSync(path.join(candidate, 'package.json')) &&
    existsSync(path.join(candidate, 'dist', 'index.js')) &&
    bundledCodexPluginSupportsCurrentPlatform(candidate)
  )) || ''
}

function isCodexPluginRoot(root: string) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')) as { name?: unknown }
    return packageJson.name === '@openclaw/codex' &&
      existsSync(path.join(root, 'dist', 'index.js')) &&
      existsSync(path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'))
  } catch {
    return false
  }
}

async function installedCodexPluginRootCandidates(extraRoot?: string) {
  const projectsRoot = path.join(OPENCLAW_STATE_ROOT, 'npm', 'projects')
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => [])
  return uniqueStrings(
    extraRoot || '',
    resolveBundledCodexPluginRoot(),
    path.join(projectsRoot, 'codex', 'node_modules', '@openclaw', 'codex'),
    path.join(projectsRoot, '@openclaw-codex', 'node_modules', '@openclaw', 'codex'),
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot, entry.name, 'node_modules', '@openclaw', 'codex')),
  ).filter(isCodexPluginRoot)
}

function safeConfigPathSegments(key: string) {
  const segments = key.split('.').map((segment) => segment.trim()).filter(Boolean)
  if (!segments.length || segments.length > 5) throw new Error(`Invalid config key: ${key}`)
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(segment) || segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      throw new Error(`Invalid config key: ${key}`)
    }
  }
  return segments
}

function setNestedConfigString(target: Record<string, unknown>, key: string, value: string) {
  const segments = safeConfigPathSegments(key)
  let cursor = target
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment]
    if (!isLooseRecord(existing)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}

async function searchOpenClawPlugins(query: string, limit: number): Promise<{ results: PluginSearchResult[]; cliError?: string }> {
  const controls = await listPluginControls().catch(() => null)
  const installedIds = new Set((controls?.plugins || []).map((plugin) => plugin.id))
  const result = await runOpenClaw(['plugins', 'search', query, '--limit', String(limit), '--json'], 120_000)
  if (result.code !== 0) {
    return {
      results: [],
      cliError: pluginCliWarningFromOutput(result, 'openclaw plugins search'),
    }
  }
  return {
    results: parsePluginSearchResults(result.stdout, installedIds),
    ...(result.stderr.trim() ? { cliError: sanitizePluginCliError(result.stderr) } : {}),
  }
}

async function savePluginDirectConfig(
  pluginId: string,
  values: Record<string, string>,
  providerAuth: Record<string, string>,
) {
  const id = pluginId.trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')

  for (const [provider, apiKey] of Object.entries(providerAuth)) {
    if (!AUTH_ENV_MAP[provider]) throw new Error(`Unsupported provider auth: ${provider}`)
    if (apiKey.trim()) await persistProviderAuth(provider, apiKey.trim())
  }

  const cleanValues = Object.entries(values)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([, value]) => value.length > 0)
  if (!cleanValues.length) return

  const config = await readOpenclawConfig()
  const mappedValues = id === 'telegram'
    ? applyTelegramPluginConfigValues(config as unknown as Record<string, unknown>, cleanValues)
    : { channelValues: [] as Array<readonly [string, string]>, pluginValues: cleanValues }
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  const entry = {
    ...(config.plugins.entries[id] || {}),
    enabled: config.plugins.entries[id]?.enabled !== false,
  } as OpenClawPluginEntryConfig
  if (!isLooseRecord(entry.config)) entry.config = {}
  for (const [key] of mappedValues.channelValues) delete entry.config[key]
  for (const [key, value] of mappedValues.pluginValues) {
    setNestedConfigString(entry.config, key, value)
  }
  for (const [key, value] of [...mappedValues.channelValues, ...mappedValues.pluginValues]) {
    await savePluginSecret(id, key, value)
  }
  if (id === CLAWTALK_PLUGIN_ID) {
    entry.config = withoutLegacyClawTalkConfigFields(entry.config)
    const apiKey = typeof entry.config.apiKey === 'string' && entry.config.apiKey.trim() ? entry.config.apiKey.trim() : ''
    if (apiKey) {
      ensureControlCenterSecretProvider(config)
      assignClawTalkApiKeyConfig(entry.config, apiKey)
    }
  }
  config.plugins.entries[id] = entry
  if (entry.enabled !== false) {
    ensureTrustedPluginAllowlist(config, id)
    await ensureEnabledManagedPluginLoadPaths(config)
  }
  await writeOpenclawConfig(config)
  await markPluginManaged(id, entry.enabled !== false)
  if (id === CLAWTALK_PLUGIN_ID) {
    const repairedManifests = await repairClawTalkPluginManifestContracts()
    if (repairedManifests.length) await refreshOpenClawPluginRegistry('clawtalk-direct-config-repair')
  }
}

function codexDoctorFindingCount(result: OpenClawResult) {
  const parsed = parseOpenClawJsonOutput(result.stdout)
  if (!isLooseRecord(parsed)) return result.code === 0 ? 0 : 1
  if (Array.isArray(parsed.findings)) return parsed.findings.length
  if (parsed.ok === false) return 1
  return 0
}

function replaceCodexWindowsHide(source: string) {
  let next = source
  const labels: string[] = []
  const replace = (pattern: RegExp, replacement: string, label: string) => {
    const updated = next.replace(pattern, replacement)
    if (updated !== next) {
      next = updated
      labels.push(label)
    }
  }

  replace(
    /windowsHide: invocation\.windowsHide(?!\s*\?\?)/g,
    'windowsHide: invocation.windowsHide ?? process.platform === "win32"',
    'forced hidden Codex invocation windows',
  )
  replace(
    /windowsHide: resolved\.windowsHide(?!\s*\?\?)/g,
    'windowsHide: resolved.windowsHide ?? process.platform === "win32"',
    'forced hidden Codex resolved windows',
  )
  replace(
    /const child = spawn\(binaryPath, process\.argv\.slice\(2\), \{\n {2}stdio: "inherit",\n {2}env,\n\}\);/g,
    'const child = spawn(binaryPath, process.argv.slice(2), {\n  stdio: "inherit",\n  env,\n  windowsHide: process.platform === "win32",\n});',
    'forced hidden native Codex launcher window',
  )

  return { source: next, labels }
}

async function patchCodexWindowsHiddenSpawnFile(filePath: string) {
  if (!existsSync(filePath)) return []
  const before = await fs.readFile(filePath, 'utf-8')
  const patched = replaceCodexWindowsHide(before)
  if (patched.source === before) return []
  await fs.writeFile(filePath, patched.source, 'utf-8')
  return patched.labels.map((label) => `${label}: ${filePath}`)
}

async function repairCodexWindowsHiddenSpawns(extraRoot?: string) {
  if (process.platform !== 'win32') return []
  const actions: string[] = []
  const roots = await installedCodexPluginRootCandidates(extraRoot)
  for (const root of roots) {
    actions.push(...await patchCodexWindowsHiddenSpawnFile(path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')))
    const distEntries = await fs.readdir(path.join(root, 'dist'), { withFileTypes: true }).catch(() => [])
    for (const entry of distEntries) {
      if (!entry.isFile() || !/^(?:client|conversation-binding)-.*\.js$/i.test(entry.name)) continue
      actions.push(...await patchCodexWindowsHiddenSpawnFile(path.join(root, 'dist', entry.name)))
    }
  }
  return actions
}

async function repairCodexPluginPostInstallState(options: {
  runCliEnable: boolean
  verifyRoutes: boolean
  bundledSource?: string
}): Promise<PluginPostInstallRepairSummary> {
  const actions: string[] = []
  const warnings: string[] = []
  const commands: PluginCommandResult[] = []

  const config = await readOpenclawConfig()
  const routesNeedCodex = openClawConfigNeedsCodexPlugin(config)
  ensureConfiguredModelAllowlist(config, agentRuntimeModelIdsForConfig(config))
  ensureCodexPluginExplicitEnablement(config)
  await writeOpenclawConfig(config)
  if (isCodexPluginExplicitlyEnabled(config)) {
    actions.push('preserved codex enabled state in openclaw.json and removed plugin allow/deny conflicts')
  }

  if (options.runCliEnable) {
    const enableArgs = ['plugins', 'enable', 'codex']
    const enable = await runOpenClaw(enableArgs, 120_000)
    commands.push(pluginCommandResult(enableArgs, enable))
    if (enable.code !== 0) {
      const detail = redactSensitiveText(stripAnsi(`${enable.stdout}\n${enable.stderr}`).trim() || `openclaw plugins enable exited ${enable.code}`)
      throw new Error(`Codex plugin is installed, but activation failed: ${detail}`)
    }
    actions.push('activated codex through OpenClaw plugin enable')
  }

  await markPluginManaged('codex', true)
  actions.push(...await repairCodexWindowsHiddenSpawns(options.bundledSource))

  const registryArgs = ['plugins', 'registry', '--refresh']
  const registry = await runOpenClaw(registryArgs, 120_000)
  commands.push(pluginCommandResult(registryArgs, registry))
  if (registry.code === 0) {
    actions.push('refreshed the OpenClaw plugin registry')
  } else {
    warnings.push(redactSensitiveText(stripAnsi(`${registry.stdout}\n${registry.stderr}`).trim() || `openclaw plugins registry --refresh exited ${registry.code}`))
  }

  await refreshPluginListCache().catch((error) => {
    warnings.push(`plugin list refresh warning: ${String(error)}`)
  })

  if (routesNeedCodex || options.verifyRoutes) {
    const doctorArgs = ['doctor', '--lint', '--only', 'core/doctor/codex-session-routes', '--json']
    const doctor = await runOpenClaw(doctorArgs, 120_000)
    commands.push(pluginCommandResult(doctorArgs, doctor))
    const findingCount = codexDoctorFindingCount(doctor)
    if (doctor.code !== 0 || findingCount > 0) {
      const detail = redactSensitiveText(stripAnsi(`${doctor.stdout}\n${doctor.stderr}`).trim() || `openclaw doctor exited ${doctor.code}`)
      throw new Error(`Codex route repair did not clear the doctor check: ${detail}`)
    }
    actions.push('verified Codex session routes with OpenClaw doctor')
  }

  // Unlike ordinary settings, the Codex harness is registered while the
  // Gateway process starts. A successful config hot reload is therefore not
  // sufficient. Restart an owned, already-running Gateway before reporting
  // that Codex activation is complete, so the next turn cannot select an
  // enabled-but-unregistered harness.
  if (await isGatewayHealthy().catch(() => false)) {
    const restart = await tryRestartGatewayService({
      force: true,
      reason: 'Codex plugin activation requires a fresh Gateway harness',
    })
    if (restart.restarted) {
      actions.push('restarted the Gateway so the Codex harness is registered')
    } else {
      warnings.push(`Codex is configured, but the current Gateway was not restarted: ${restart.detail || 'restart was declined'}`)
    }
  }

  return {
    applied: actions.length > 0,
    reason: 'Codex plugin install/config repair completed.',
    actions,
    ...(warnings.length ? { warnings } : {}),
    ...(options.bundledSource ? { bundledSource: options.bundledSource } : {}),
    commands,
  }
}

function isRealInstalledPluginEntry(plugin: PluginControlEntry | undefined) {
  if (!plugin) return false
  return !['config', 'managed'].includes(plugin.origin.trim().toLowerCase())
}

function isCodexPluginAvailableForRuntime(plugin: PluginControlEntry | undefined, bundledCodexSource = resolveBundledCodexPluginRoot()) {
  if (!plugin) return Boolean(bundledCodexSource)
  if (isRealInstalledPluginEntry(plugin)) return true
  if (plugin.runtimeLoaded || plugin.status.trim().toLowerCase() === 'loaded') return true
  return plugin.enabled === true && plugin.configuredEnabled !== false && Boolean(bundledCodexSource)
}

async function ensureCodexPluginInstalledForOpenAiRuntime(config: OpenClawConfigFile) {
  if (!shouldPrepareCodexPluginForRuntime(config)) return
  if (openclawCodexPluginAutoInstallReady) return

  if (!openclawCodexPluginAutoInstallPending) {
    openclawCodexPluginAutoInstallPending = (async () => {
      const controls = await listPluginControls({ forceRefresh: true }).catch((error) => {
        console.warn('[plugins/codex] failed to inspect plugin state before auto-install:', error)
        return null
      })
      const existing = controls?.plugins.find((plugin) => plugin.id === 'codex')
      const bundledCodexSource = resolveBundledCodexPluginRoot()
      if (isCodexPluginAvailableForRuntime(existing, bundledCodexSource)) {
        await repairCodexPluginPostInstallState({
          runCliEnable: Boolean(existing && existing.enabled !== true),
          verifyRoutes: openClawConfigNeedsCodexPlugin(config),
          ...(bundledCodexSource ? { bundledSource: bundledCodexSource } : {}),
        })
        openclawCodexPluginAutoInstallReady = true
        return
      }

      console.log(
        bundledCodexSource
          ? `[plugins/codex] Codex plugin is enabled; installing bundled codex plugin from ${bundledCodexSource}.`
          : '[plugins/codex] Codex plugin is enabled; installing official codex plugin with --pin.',
      )
      try {
        const result = await installOpenClawPlugin({
          spec: bundledCodexSource || 'codex',
          pluginId: 'codex',
          pin: !bundledCodexSource,
          enable: true,
          force: false,
          restart: false,
        })
        const installed = result.controls.plugins.find((plugin) => plugin.id === 'codex')
        if (!isCodexPluginAvailableForRuntime(installed, bundledCodexSource)) {
          throw new Error('Codex plugin install completed, but the plugin is still not available in OpenClaw.')
        }
        openclawCodexPluginAutoInstallReady = true
      } catch (error) {
        throw new Error(
          `Codex plugin is enabled, but the plugin is not installed and automatic installation failed. ` +
            `Run "openclaw plugins install codex --pin" or use the Plugins panel to install Codex. ${String(error)}`,
        )
      }
    })().finally(() => {
      openclawCodexPluginAutoInstallPending = null
    })
  }

  await openclawCodexPluginAutoInstallPending
}

function pluginCommandString(args: string[]) {
  return `openclaw ${args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}`
}

function pluginCommandResult(args: string[], result: OpenClawResult): PluginCommandResult {
  const stdout = redactSensitiveText(result.stdout || '').slice(0, 12_000)
  const stderr = redactSensitiveText(result.stderr || '').slice(0, 12_000)
  const output = redactSensitiveText(stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`).trim()).slice(0, 12_000)
  return {
    command: pluginCommandString(args),
    code: result.code,
    stdout,
    stderr,
    output,
    ...(typeof result.elapsedMs === 'number' ? { elapsedMs: result.elapsedMs } : {}),
  }
}

type PluginConfigApplyMethod = 'gateway.config.patch' | 'local-config-write'

type PluginConfigApplyResult = {
  method: PluginConfigApplyMethod
  ok: boolean
  detail: string
  elapsedMs: number
  payload?: unknown
}

type PluginToggleConfigPatch = {
  patch: Record<string, unknown> | null
  replacePaths: string[]
}

const JSON_MERGE_PATCH_UNCHANGED = Symbol('jsonMergePatchUnchanged')
const PLUGIN_TOGGLE_ARRAY_REPLACE_PATHS = ['plugins.allow', 'plugins.deny', 'plugins.load.paths']
const PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS = 12_000
const BILLING_ROUTE_ARRAY_REPLACE_PATHS = ['agents.list']
const BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS = 8_000

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function jsonMergePatch(
  before: unknown,
  after: unknown,
): unknown | typeof JSON_MERGE_PATCH_UNCHANGED {
  if (JSON.stringify(before) === JSON.stringify(after)) return JSON_MERGE_PATCH_UNCHANGED

  if (isLooseRecord(before) && isLooseRecord(after)) {
    const patch: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      if (!(key in after)) {
        patch[key] = null
        continue
      }
      const childPatch = jsonMergePatch(before[key], after[key])
      if (childPatch !== JSON_MERGE_PATCH_UNCHANGED) patch[key] = childPatch
    }
    return Object.keys(patch).length ? patch : JSON_MERGE_PATCH_UNCHANGED
  }

  return cloneJsonValue(after)
}

function assignJsonMergePatch(
  patch: Record<string, unknown>,
  key: keyof OpenClawConfigFile,
  before: unknown,
  after: unknown,
) {
  const value = jsonMergePatch(before, after)
  if (value === JSON_MERGE_PATCH_UNCHANGED) return
  patch[key] = value === undefined ? null : value
}

async function buildPluginToggleConfigPatch(
  baseConfig: OpenClawConfigFile,
  pluginId: string,
  enabled: boolean,
): Promise<PluginToggleConfigPatch> {
  const before = cloneJsonValue(baseConfig || {}) as OpenClawConfigFile
  const next = cloneJsonValue(baseConfig || {}) as OpenClawConfigFile
  await applyOpenClawPluginEnabledToConfig(next, pluginId, enabled)
  await applyWebSearchProviderSelectionForPlugin(next, pluginId, enabled)

  const patch: Record<string, unknown> = {}
  assignJsonMergePatch(patch, 'plugins', before.plugins, next.plugins)
  assignJsonMergePatch(patch, 'tools', before.tools, next.tools)
  assignJsonMergePatch(patch, 'secrets', before.secrets, next.secrets)

  return {
    patch: Object.keys(patch).length ? patch : null,
    replacePaths: PLUGIN_TOGGLE_ARRAY_REPLACE_PATHS,
  }
}

function gatewayConfigGetPayload(value: unknown): { config: OpenClawConfigFile | null; hash: string } {
  const record = isLooseRecord(value) ? value : null
  if (!record) return { config: null, hash: '' }
  const hash = stringField(record, ['hash', 'configHash', 'baseHash'])
  const configValue = isLooseRecord(record.config)
    ? record.config
    : (isLooseRecord(record.payload) && isLooseRecord(record.payload.config))
      ? record.payload.config
      : null
  return {
    config: configValue ? cloneJsonValue(configValue) as OpenClawConfigFile : null,
    hash,
  }
}

function billingRouteModelSnapshot(config: OpenClawConfigFile | null | undefined) {
  return JSON.stringify({
    providerConfigured: Boolean(config?.models?.providers?.[AUTOMNIA_OPENCLAW_PROVIDER_ID]),
    defaults: config?.agents?.defaults?.model || null,
    telegramDefault: telegramBillingDefaultModel(config),
    agents: (config?.agents?.list || [])
      .map((agent) => ({ id: agent.id, model: agent.model || null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
}

type BillingRouteConfigApplyResult = {
  ok: boolean
  detail: string
  elapsedMs: number
}

/**
 * Apply only the billing-owned parts of OpenClaw's config through the
 * authenticated Gateway RPC. OpenClaw documents models/agents as hot-reload
 * safe, so a normal priority switch should not pay the multi-step Gateway
 * restart cost. A restart remains the fail-safe when hot reload is unavailable
 * or the Gateway does not confirm the exact route.
 */
async function applyBillingRouteViaGatewayConfigPatch(desiredConfig: OpenClawConfigFile): Promise<BillingRouteConfigApplyResult> {
  const startedAt = Date.now()
  try {
    if (!(await isGatewayHealthy().catch(() => false))) {
      throw new Error(`gateway is not healthy on port ${GATEWAY_HTTP_PORT}`)
    }

    const state = await ensureControlCenterGatewayClient(AbortSignal.timeout(BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS))
    const getPayload = await state.client.request(
      'config.get',
      {},
      {
        timeoutMs: BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS,
        signal: AbortSignal.timeout(BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS),
      },
    )
    const { config: gatewayConfig, hash } = gatewayConfigGetPayload(getPayload)
    if (!gatewayConfig) throw new Error('Gateway config.get returned no config')

    const desiredDefaults = desiredConfig.agents?.defaults
    const desiredAutomniaModel = desiredDefaults?.models?.[AUTOMNIA_OPENCLAW_MODEL]
    const desiredTelegramDefault = telegramBillingDefaultModel(desiredConfig)
    const patch: Record<string, unknown> = {
      models: {
        providers: {
          [AUTOMNIA_OPENCLAW_PROVIDER_ID]: desiredConfig.models?.providers?.[AUTOMNIA_OPENCLAW_PROVIDER_ID]
            ? cloneJsonValue(desiredConfig.models.providers[AUTOMNIA_OPENCLAW_PROVIDER_ID])
            : null,
        },
      },
      agents: {
        defaults: {
          model: desiredDefaults?.model ? cloneJsonValue(desiredDefaults.model) : null,
          modelOverride: null,
          models: {
            [AUTOMNIA_OPENCLAW_MODEL]: desiredAutomniaModel ? cloneJsonValue(desiredAutomniaModel) : null,
          },
        },
        // JSON merge patch replaces arrays; sending the complete sanitized
        // list prevents one agent from retaining its previous model chain.
        list: cloneJsonValue(desiredConfig.agents?.list || []),
      },
      channels: {
        modelByChannel: {
          // Keep explicit Telegram chat/DM mappings intact. Only the
          // wildcard/default entry is owned by the billing route.
          telegram: {
            '*': desiredTelegramDefault,
          },
        },
      },
    }

    if (billingRouteModelSnapshot(gatewayConfig) !== billingRouteModelSnapshot(desiredConfig)) {
      const params: Record<string, unknown> = {
        raw: JSON.stringify(patch),
        replacePaths: BILLING_ROUTE_ARRAY_REPLACE_PATHS,
        note: 'Control Center usage priority route switch',
      }
      if (hash) params.baseHash = hash
      await state.client.request(
        'config.patch',
        params,
        {
          timeoutMs: BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS,
          signal: AbortSignal.timeout(BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS),
        },
      )
      openclawConfigCache = null
    }

    const verifiedPayload = await state.client.request(
      'config.get',
      {},
      {
        timeoutMs: BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS,
        signal: AbortSignal.timeout(BILLING_ROUTE_GATEWAY_PATCH_TIMEOUT_MS),
      },
    )
    const { config: verifiedConfig } = gatewayConfigGetPayload(verifiedPayload)
    if (!verifiedConfig || billingRouteModelSnapshot(verifiedConfig) !== billingRouteModelSnapshot(desiredConfig)) {
      throw new Error('Gateway did not confirm the selected usage priority route')
    }
    if (!(await isGatewayHealthy().catch(() => false))) {
      throw new Error('Gateway became unhealthy after the usage priority route patch')
    }

    return {
      ok: true,
      detail: 'Gateway hot-reloaded the selected usage priority route',
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ok: false,
      detail: redactSensitiveText(String(error)),
      elapsedMs: Date.now() - startedAt,
    }
  }
}

function pluginConfigApplyCommandResult(result: PluginConfigApplyResult): PluginCommandResult {
  const output = redactSensitiveText(result.detail || '').slice(0, 12_000)
  return {
    command: result.method === 'gateway.config.patch'
      ? 'openclaw gateway call config.patch'
      : `write ${OPENCLAW_CONFIG_PATH}`,
    code: result.ok ? 0 : 1,
    stdout: result.ok ? output : '',
    stderr: result.ok ? '' : output,
    output,
    elapsedMs: result.elapsedMs,
  }
}

async function applyPluginToggleViaGatewayConfigPatch(pluginId: string, enabled: boolean): Promise<PluginConfigApplyResult> {
  const startedAt = Date.now()
  const action = enabled ? 'enable' : 'disable'
  try {
    if (!(await isGatewayHealthy().catch(() => false))) {
      throw new Error(`gateway is not healthy on port ${GATEWAY_HTTP_PORT}`)
    }

    const state = await ensureControlCenterGatewayClient(AbortSignal.timeout(PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS))
    const getPayload = await state.client.request(
      'config.get',
      {},
      {
        timeoutMs: PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS,
        signal: AbortSignal.timeout(PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS),
      },
    )
    const { config: gatewayConfig, hash } = gatewayConfigGetPayload(getPayload)
    const { patch, replacePaths } = await buildPluginToggleConfigPatch(
      gatewayConfig || await readOpenclawConfig(),
      pluginId,
      enabled,
    )

    if (!patch) {
      return {
        method: 'gateway.config.patch',
        ok: true,
        detail: `plugin ${pluginId} already ${enabled ? 'enabled' : 'disabled'} in config`,
        elapsedMs: Date.now() - startedAt,
      }
    }

    const params: Record<string, unknown> = {
      raw: JSON.stringify(patch),
      replacePaths,
      note: `Control Center plugin ${action}: ${pluginId}`,
    }
    if (hash) params.baseHash = hash
    const payload = await state.client.request(
      'config.patch',
      params,
      {
        timeoutMs: PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS,
        signal: AbortSignal.timeout(PLUGIN_TOGGLE_GATEWAY_PATCH_TIMEOUT_MS),
      },
    )
    openclawConfigCache = null
    return {
      method: 'gateway.config.patch',
      ok: true,
      detail: `gateway config.patch applied; plugin ${pluginId} ${enabled ? 'enabled' : 'disabled'} for new turns`,
      elapsedMs: Date.now() - startedAt,
      payload,
    }
  } catch (error) {
    return {
      method: 'gateway.config.patch',
      ok: false,
      detail: redactSensitiveText(String(error)),
      elapsedMs: Date.now() - startedAt,
    }
  }
}

async function applyPluginToggleViaLocalConfigWrite(
  pluginId: string,
  enabled: boolean,
  gatewayFailureDetail = '',
): Promise<PluginConfigApplyResult> {
  const startedAt = Date.now()
  const config = await readOpenclawConfig()
  await applyOpenClawPluginEnabledToConfig(config, pluginId, enabled)
  await applyWebSearchProviderSelectionForPlugin(config, pluginId, enabled)
  await writeOpenclawConfig(config)
  const gatewayFallback = gatewayFailureDetail
    ? ` Gateway config.patch unavailable: ${trimTask(gatewayFailureDetail, 240)}`
    : ''
  return {
    method: 'local-config-write',
    ok: true,
    detail: `local OpenClaw config updated; Gateway file watcher should hot-reload plugin config.${gatewayFallback}`,
    elapsedMs: Date.now() - startedAt,
  }
}

async function setOpenClawPluginEnabledForControlCenter(pluginId: string, enabled: boolean, options: { restart: boolean; immediateRestart: boolean }) {
  const id = pluginId.trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')

  let applyResult = await applyPluginToggleViaGatewayConfigPatch(id, enabled)
  if (!applyResult.ok) {
    console.warn(`[plugins] gateway config.patch unavailable for ${id}; falling back to local config write: ${applyResult.detail}`)
    applyResult = await applyPluginToggleViaLocalConfigWrite(id, enabled, applyResult.detail)
  }

  await markPluginManaged(id, enabled)
  const registryRefresh = schedulePluginRegistryRefresh(`plugin-${enabled ? 'enable' : 'disable'}:${id}`)
  // The native Codex harness is registered while the gateway process starts.
  // A config hot reload makes it look enabled but leaves `codex` unregistered
  // for the current process, causing every OpenAI/Codex turn to fail closed.
  const restartRequested = options.restart || pluginToggleRequiresGatewayRestart(id)
  const restart = restartRequested
    ? (options.immediateRestart || pluginToggleRequiresGatewayRestart(id))
      ? {
          ...(await tryRestartGatewayService({ force: true, reason: `plugin ${enabled ? 'enable' : 'disable'} immediate gateway restart: ${id}` })),
          scheduled: false,
        }
      : schedulePluginGatewayRestart()
    : { restarted: false, scheduled: false, detail: 'gateway restart not required; plugin config hot reload requested' }
  const controls = await listPluginControls()
  return {
    command: pluginConfigApplyCommandResult(applyResult),
    restart,
    registryRefresh,
    controls,
  }
}

async function getOpenClawPluginEnabled(pluginId: string): Promise<{ enabled: boolean; detail: string }> {
  const id = pluginId.trim().toLowerCase()
  try {
    const config = await readOpenclawConfig()
    if (config.plugins?.enabled === false) return { enabled: false, detail: 'plugins.enabled=false' }
    if (config.plugins?.entries?.[id]?.enabled === false) {
      return { enabled: false, detail: `plugins.entries.${id}.enabled=false` }
    }
    const allow = Array.isArray(config.plugins?.allow) ? config.plugins.allow : []
    if (allow.length && !allow.includes(id)) return { enabled: false, detail: `plugins.allow excludes ${id}` }
    const deny = Array.isArray(config.plugins?.deny) ? config.plugins.deny : []
    if (deny.includes(id)) return { enabled: false, detail: `plugins.deny includes ${id}` }
    return { enabled: true, detail: `${id} plugin enabled by config` }
  } catch (error) {
    return { enabled: true, detail: `could not read plugin config; assuming enabled: ${String(error)}` }
  }
}

async function applyOpenClawPluginEnabledToConfig(config: OpenClawConfigFile, pluginId: string, enabled: boolean) {
  const id = pluginId.trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')

  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  const entry = {
    ...(config.plugins.entries[id] || {}),
    enabled,
  } as OpenClawPluginEntryConfig
  config.plugins.entries[id] = entry

  if (id === 'clawtalk') {
    if (!isLooseRecord(entry.config)) entry.config = {}
    entry.config = withoutLegacyClawTalkConfigFields(entry.config)
    entry.config.enabled = enabled
    if (!config.plugins.load) config.plugins.load = {}
    if (enabled) {
      if (typeof entry.config.apiKey !== 'string' || !entry.config.apiKey.trim()) {
        const restoredApiKey = await readPluginSecret(id, 'apiKey')
        const backupApiKey = restoredApiKey ? null : await findClawTalkApiKeyInConfigBackups()
        const recoveredApiKey = restoredApiKey || backupApiKey?.apiKey || ''
        if (recoveredApiKey) {
          await savePluginSecret(id, 'apiKey', recoveredApiKey)
          ensureControlCenterSecretProvider(config)
          assignClawTalkApiKeyConfig(entry.config, recoveredApiKey)
        }
      }
    } else {
      await savePluginSecret(id, 'apiKey', entry.config.apiKey)
      delete entry.config.apiKey
      delete entry.config.apiKeyRef
      delete entry.config.apiKeyStorage
      delete entry.apiKey
      if (Array.isArray(config.plugins.load.paths)) {
        config.plugins.load.paths = config.plugins.load.paths.filter((entry) => !isClawTalkPluginPath(entry))
      }
    }
    entry.config.autoConnect = enabled
    const missions = isLooseRecord(entry.config.missions) ? entry.config.missions : {}
    missions.enabled = enabled
    const observer = isLooseRecord(missions.observer) ? missions.observer : {}
    observer.enabled = enabled
    missions.observer = observer
    entry.config.missions = missions
  } else if (isLooseRecord(entry.config)) {
    delete entry.config.enabled
    if (!Object.keys(entry.config).length) delete entry.config
  }

  if (enabled) {
    if (Array.isArray(config.plugins.deny)) {
      config.plugins.deny = config.plugins.deny.filter((entry) => entry !== id)
    }
    ensureTrustedPluginAllowlist(config, id)
    await ensureEnabledManagedPluginLoadPaths(config)
  } else {
    if (Array.isArray(config.plugins.allow)) {
      config.plugins.allow = config.plugins.allow.filter((entry) => entry !== id)
    }
    config.plugins.deny = Array.from(new Set([...(Array.isArray(config.plugins.deny) ? config.plugins.deny : []), id]))
    if (!config.plugins.load) config.plugins.load = {}
    config.plugins.load.paths = sanitizedPluginLoadPaths(config.plugins.load?.paths).filter((entry) => pluginIdFromLoadPath(entry) !== id)
  }

  if (id === 'browser') browserProbeCache.clear()
}

async function setOpenClawPluginEnabled(pluginId: string, enabled: boolean) {
  const id = pluginId.trim().toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('Invalid plugin id.')

  const config = await readOpenclawConfig()
  await applyOpenClawPluginEnabledToConfig(config, id, enabled)
  await writeOpenclawConfig(config)
  await markPluginManaged(id, enabled)
}

type GatewayRestartRequest = {
  restarted: boolean
  scheduled: boolean
  detail: string
}

const PLUGIN_GATEWAY_RESTART_DEBOUNCE_MS = 750
let pluginGatewayRestartTimer: NodeJS.Timeout | null = null
let pluginGatewayRestartInFlight: Promise<void> | null = null
let pluginGatewayRestartRunAgain = false

async function runQueuedPluginGatewayRestart(): Promise<void> {
  if (pluginGatewayRestartInFlight) {
    pluginGatewayRestartRunAgain = true
    await pluginGatewayRestartInFlight
    return
  }

  pluginGatewayRestartInFlight = (async () => {
    do {
      pluginGatewayRestartRunAgain = false
      const result = await tryRestartGatewayService({ force: true, reason: 'plugin change queued gateway restart' })
      const detail = result.detail ? `\n${result.detail}` : ''
      if (result.restarted) {
        console.log(`[plugins] gateway restart completed after plugin change${detail}`)
      } else {
        console.warn(`[plugins] gateway restart failed after plugin change${detail}`)
      }
    } while (pluginGatewayRestartRunAgain)
  })().finally(() => {
    pluginGatewayRestartInFlight = null
  })

  await pluginGatewayRestartInFlight
}

function schedulePluginGatewayRestart(): GatewayRestartRequest {
  if (pluginGatewayRestartTimer) clearTimeout(pluginGatewayRestartTimer)
  pluginGatewayRestartTimer = setTimeout(() => {
    pluginGatewayRestartTimer = null
    void runQueuedPluginGatewayRestart().catch((error) => {
      console.warn('[plugins] queued gateway restart failed:', error)
    })
  }, PLUGIN_GATEWAY_RESTART_DEBOUNCE_MS)
  pluginGatewayRestartTimer.unref?.()

  return {
    restarted: false,
    scheduled: true,
    detail: `gateway restart queued in ${PLUGIN_GATEWAY_RESTART_DEBOUNCE_MS}ms`,
  }
}

async function saveClawTalkSetupConfig(apiKey: string, server: string) {
  const config = await readOpenclawConfig()
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}

  const previousEntry = config.plugins.entries[CLAWTALK_PLUGIN_ID] || {}
  const previousConfig = isLooseRecord(previousEntry.config) ? previousEntry.config : {}
  const nextBaseConfig = withoutLegacyClawTalkConfigFields(previousConfig)
  const nextConfig: Record<string, unknown> = {
    ...nextBaseConfig,
    enabled: true,
    server,
    agentId: clawTalkAgentIdFromConfig(config, previousConfig),
    autoConnect: true,
  }
  await savePluginSecret(CLAWTALK_PLUGIN_ID, 'apiKey', apiKey)
  ensureControlCenterSecretProvider(config)
  assignClawTalkApiKeyConfig(nextConfig, apiKey)
  nextConfig.missions = withClawTalkMissionConfig(nextConfig, true)

  const entry = {
    ...previousEntry,
    enabled: true,
    config: nextConfig,
  } as OpenClawPluginEntryConfig
  delete entry.apiKey
  config.plugins.entries[CLAWTALK_PLUGIN_ID] = entry
  config.plugins.allow = uniqueStrings(config.plugins.allow, CLAWTALK_PLUGIN_ID)
  config.plugins.deny = uniqueStrings(config.plugins.deny).filter((id) => id !== CLAWTALK_PLUGIN_ID)
  config.plugins.bundledDiscovery ??= 'compat'
  ensureTrustedPluginAllowlist(config, CLAWTALK_PLUGIN_ID)
  await ensureEnabledManagedPluginLoadPaths(config)

  await writeOpenclawConfig(config)
  await markPluginManaged(CLAWTALK_PLUGIN_ID, true)
}

async function readPartyProfiles(): Promise<PartyProfiles> {
  const normalizePartyProfiles = (value: unknown): PartyProfiles | null => {
    if (!isLooseRecord(value) || !isLooseRecord(value.agents)) return null
    return { agents: value.agents as Record<string, AgentProfile> }
  }

  const sqliteProfiles = normalizePartyProfiles(
    readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.partyProfiles),
  )
  if (sqliteProfiles) return sqliteProfiles

  try {
    const parsed = await readCachedJsonFile(
      PARTY_PROFILE_PATH,
      partyProfilesCache,
      (text) => normalizePartyProfiles(JSON.parse(text)) || { agents: {} },
      (entry) => { partyProfilesCache = entry },
    )
    writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.partyProfiles, parsed, PARTY_PROFILE_PATH)
    return parsed
  } catch {
    return { agents: {} }
  }
}

async function writePartyProfiles(profiles: PartyProfiles) {
  if (writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.partyProfiles, profiles, PARTY_PROFILE_PATH)) return
  await fs.mkdir(path.dirname(PARTY_PROFILE_PATH), { recursive: true })
  const serialized = `${JSON.stringify(profiles, null, 2)}\n`
  const tempPath = path.join(path.dirname(PARTY_PROFILE_PATH), `.party-profiles.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeTextFileWithLockRetry(tempPath, serialized)
    await renameWithLockRetry(tempPath, PARTY_PROFILE_PATH)
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
  await rememberJsonFileCache(PARTY_PROFILE_PATH, profiles, (entry) => { partyProfilesCache = entry })
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T
  } catch {
    return null
  }
}

function slugifySkillId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function skillTitleFromId(value: string) {
  const words = value
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return words.length ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Skill'
}

function normalizeSkillText(value: string, max = 420) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

function stripYamlQuotes(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseSkillFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { data: {} as Record<string, string>, body: normalized }
  }
  const endIndex = normalized.indexOf('\n---', 4)
  if (endIndex < 0) return { data: {} as Record<string, string>, body: normalized }

  const data: Record<string, string> = {}
  const lines = normalized.slice(4, endIndex).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const rawValue = match[2] || ''
    if (/^[>|]/.test(rawValue.trim())) {
      const block: string[] = []
      index += 1
      for (; index < lines.length; index += 1) {
        const blockLine = lines[index]
        if (blockLine && !/^\s/.test(blockLine)) {
          index -= 1
          break
        }
        block.push(blockLine.replace(/^\s{1,4}/, ''))
      }
      data[key] = block.join('\n').trim()
      continue
    }
    data[key] = stripYamlQuotes(rawValue)
  }

  return { data, body: normalized.slice(endIndex + 4).trim() }
}

function inferSkillDescription(body: string, fallback: string) {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('```')) continue
    return normalizeSkillText(trimmed.replace(/^[-*]\s+/, ''))
  }
  return fallback
}

function resolveSkillDirectory(rootDir: string, skillId: string) {
  const id = slugifySkillId(skillId)
  if (!id) throw new Error('Invalid skill id')
  const root = path.resolve(rootDir)
  const target = path.resolve(root, id)
  if (target !== root && target.startsWith(`${root}${path.sep}`)) return { id, target }
  throw new Error('Invalid skill target path')
}

async function findSkillMarkdownPath(skillDir: string) {
  for (const fileName of ['SKILL.md', 'skill.md', 'skills.md', 'SKILL.MD']) {
    const candidate = path.join(skillDir, fileName)
    if (await fileExists(candidate)) return candidate
  }
  return null
}

async function readSkillEntryFromDir(rootDir: string, dirName: string, fallbackSource: AgentSkillSource): Promise<AgentSkillEntry | null> {
  const skillDir = path.resolve(rootDir, dirName)
  const skillPath = await findSkillMarkdownPath(skillDir)
  if (!skillPath) return null

  const [content, meta, origin, stat] = await Promise.all([
    fs.readFile(skillPath, 'utf-8'),
    readJsonFile<Record<string, unknown>>(path.join(skillDir, '_meta.json')),
    readJsonFile<Record<string, unknown>>(path.join(skillDir, '.clawhub', 'origin.json')),
    fs.stat(skillPath).catch(() => null),
  ])
  const parsed = parseSkillFrontmatter(content)
  const metaSlug = typeof meta?.slug === 'string' ? meta.slug : ''
  const id = slugifySkillId(metaSlug || parsed.data.name || dirName)
  if (!id) return null

  const explicitLearned = meta?.source === 'control-center-learned'
  const isClawHub = Boolean(origin || (meta?.ownerId && meta?.publishedAt))
  const source: AgentSkillSource = isClawHub
    ? 'clawhub'
    : explicitLearned
      ? meta?.shared === true
        ? 'library'
        : 'learned'
      : fallbackSource
  const rawName = parsed.data.name || (typeof meta?.displayName === 'string' ? meta.displayName : '') || metaSlug || dirName
  const rawDescription =
    parsed.data.description ||
    (typeof meta?.description === 'string' ? meta.description : '') ||
    inferSkillDescription(parsed.body, `Reusable skill ${skillTitleFromId(id)}.`)
  const installedAt = typeof origin?.installedAt === 'number'
    ? new Date(origin.installedAt).toISOString()
    : typeof meta?.learnedAt === 'string'
      ? meta.learnedAt
      : stat?.mtime
        ? stat.mtime.toISOString()
        : undefined

  return {
    id,
    name: normalizeSkillText(rawName, 96) || skillTitleFromId(id),
    description: normalizeSkillText(rawDescription),
    source,
    path: skillPath,
    ...(installedAt ? { learnedAt: installedAt } : {}),
    ...(typeof meta?.xpValue === 'number' ? { xpValue: meta.xpValue } : {}),
  }
}

function isSkillBackupDirectory(name: string) {
  return /\.bak(?:[-_.]\d{8,})?/i.test(name)
}

async function listSkillsFromRoot(rootDir: string, fallbackSource: AgentSkillSource) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true })
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !isSkillBackupDirectory(entry.name))
        .map((entry) => readSkillEntryFromDir(rootDir, entry.name, fallbackSource)),
    )
    const byId = new Map<string, AgentSkillEntry>()
    for (const skill of skills) {
      if (!skill) continue
      byId.set(skill.id, skill)
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return [] as AgentSkillEntry[]
  }
}

function skillRootCacheKey(rootDir: string, fallbackSource: AgentSkillSource) {
  return `${fallbackSource}:${path.resolve(rootDir).toLowerCase()}`
}

function invalidateSkillLibraryCache(rootDir?: string) {
  if (!rootDir) {
    skillRootCache.clear()
    return
  }
  const normalized = path.resolve(rootDir).toLowerCase()
  for (const key of skillRootCache.keys()) {
    if (key.endsWith(`:${normalized}`)) skillRootCache.delete(key)
  }
}

async function listSkillsFromRootCached(rootDir: string, fallbackSource: AgentSkillSource) {
  const key = skillRootCacheKey(rootDir, fallbackSource)
  const now = Date.now()
  const cached = skillRootCache.get(key)
  if (cached && cached.expiresAt > now) return cloneJson(cached.value)
  const skills = await listSkillsFromRoot(rootDir, fallbackSource)
  skillRootCache.set(key, { expiresAt: now + SKILL_LIBRARY_CACHE_MS, value: cloneJson(skills) })
  return skills
}

async function getAgentSkillsRoot(agentId?: string) {
  if (!agentId || !isValidAgentId(agentId)) return null
  const workspace = (await resolveAgentWorkspace(agentId)) || defaultAgentWorkspace(agentId)
  return path.join(workspace, 'skills')
}

async function readAgentSkillLibrary(agentId?: string) {
  const agentSkillsRoot = await getAgentSkillsRoot(agentId)
  const [shared, agent] = await Promise.all([
    listSkillsFromRootCached(SHARED_SKILLS_ROOT, 'library'),
    agentSkillsRoot ? listSkillsFromRootCached(agentSkillsRoot, 'agent') : Promise.resolve([] as AgentSkillEntry[]),
  ])
  return { shared, agent, agentSkillsRoot }
}

async function findSkillContent(skillId: string, agentId?: string) {
  const safeId = slugifySkillId(skillId)
  if (!safeId) return null
  const { shared, agent } = await readAgentSkillLibrary(agentId)
  const entries = [...agent, ...shared]
  const match = entries.find((entry) => entry.id === safeId || slugifySkillId(entry.name) === safeId)
  if (!match?.path) return null
  return { skill: match, content: await fs.readFile(match.path, 'utf-8') }
}

function yamlQuote(value: string) {
  return JSON.stringify(value.replace(/\r/g, ''))
}

function skillMarkdown(name: string, description: string, body: string) {
  const cleanBody = body.trim() || [
    `Use this skill when the task matches: ${description}`,
    '',
    '1. Confirm the task goal and relevant files/resources.',
    '2. Apply the reusable procedure.',
    '3. Verify the result with concrete evidence.',
  ].join('\n')
  const indentedDescription = description
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return [
    '---',
    `name: ${yamlQuote(name)}`,
    'description: |',
    indentedDescription,
    '---',
    '',
    cleanBody,
    '',
  ].join('\n')
}

async function writeLearnedSkill(params: {
  agentId: string
  name: string
  description: string
  body: string
  shared: boolean
  xpValue: number
}) {
  const id = slugifySkillId(params.name)
  if (!id) throw new Error('Invalid skill name')
  const targetRoot = params.shared ? SHARED_SKILLS_ROOT : (await getAgentSkillsRoot(params.agentId))
  if (!targetRoot) throw new Error('Agent workspace is unavailable')
  const { target } = resolveSkillDirectory(targetRoot, id)
  await fs.mkdir(target, { recursive: true })
  const learnedAt = new Date().toISOString()
  await fs.writeFile(path.join(target, 'SKILL.md'), skillMarkdown(params.name, params.description, params.body), 'utf-8')
  await fs.writeFile(
    path.join(target, '_meta.json'),
    `${JSON.stringify({ slug: id, source: 'control-center-learned', shared: params.shared, learnedAt, xpValue: params.xpValue }, null, 2)}\n`,
    'utf-8',
  )
  invalidateSkillLibraryCache(targetRoot)
  const entry = await readSkillEntryFromDir(targetRoot, id, params.shared ? 'library' : 'learned')
  if (!entry) throw new Error('Saved skill could not be indexed')
  return entry
}

async function runOpenClawWithManagedSkillsWorkspace(args: string[], timeoutMs = 120000) {
  const config = await readOpenclawConfig().catch(() => createInitialOpenclawConfig())
  const defaults = config.agents?.defaults as { model?: unknown } | undefined
  const tempDir = path.join(OPENCLAW_STATE_ROOT, 'tmp')
  const tempConfigPath = path.join(tempDir, `managed-skills-${randomUUID()}.json`)
  const model = defaults?.model || defaultAgentModelSelection()
  const tempConfig = {
    skills: {
      load: { watch: true, watchDebounceMs: 250, ...(config.skills?.load || {}) },
      entries: config.skills?.entries || {},
      install: config.skills?.install || { nodeManager: 'npm' },
      ...(config.skills?.allowBundled ? { allowBundled: config.skills.allowBundled } : {}),
    },
    agents: {
      defaults: {
        workspace: OPENCLAW_STATE_ROOT,
        model,
      },
      list: [
        {
          id: 'main',
          default: true,
          workspace: OPENCLAW_STATE_ROOT,
          model,
        },
      ],
    },
  }

  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(tempConfigPath, `${JSON.stringify(tempConfig, null, 2)}\n`, 'utf-8')
  try {
    return await runOpenClaw(args, timeoutMs, {
      cwd: OPENCLAW_STATE_ROOT,
      envOverrides: {
        OPENCLAW_CONFIG_PATH: tempConfigPath,
        OPENCLAW_STATE_DIR: OPENCLAW_STATE_ROOT,
      },
    })
  } finally {
    await fs.unlink(tempConfigPath).catch(() => undefined)
  }
}

function isWindowsSkillInstallRenameFailure(result: OpenClawResult, slug: string) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`
  const safeSlug = slugifySkillId(slug)
  const escapedSlug = safeSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /EPERM:\s*operation not permitted,\s*rename/i.test(text) &&
    /\.openclaw-install-stage-/i.test(text) &&
    new RegExp(`[\\\\/]${escapedSlug}\\b`, 'i').test(text)
}

async function cleanupSkillInstallStaging(slug: string) {
  const safeSlug = slugifySkillId(slug)
  const removed: string[] = []
  await fs.mkdir(SHARED_SKILLS_ROOT, { recursive: true })
  const entries = await fs.readdir(SHARED_SKILLS_ROOT, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\.openclaw-install-stage-/i.test(entry.name)) continue
    const candidate = path.resolve(SHARED_SKILLS_ROOT, entry.name)
    if (!isPathInsideOrSame(SHARED_SKILLS_ROOT, candidate)) continue
    await fs.rm(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(() => undefined)
    removed.push(candidate)
  }

  const { target } = resolveSkillDirectory(SHARED_SKILLS_ROOT, safeSlug)
  const targetStat = await fs.stat(target).catch(() => null)
  if (targetStat?.isDirectory() && isPathInsideOrSame(SHARED_SKILLS_ROOT, target) && !(await findSkillMarkdownPath(target))) {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch(() => undefined)
    removed.push(target)
  }

  return removed
}

async function installClawHubSkillWithRetry(args: string[], slug: string) {
  let result = await runOpenClawWithManagedSkillsWorkspace(args, 180000)
  if (result.code === 0 || !isWindowsSkillInstallRenameFailure(result, slug)) {
    return { result, retried: false, cleanup: [] as string[] }
  }

  const cleanup = await cleanupSkillInstallStaging(slug)
  result = await runOpenClawWithManagedSkillsWorkspace(args, 180000)
  return { result, retried: true, cleanup }
}

async function copyFileIfMissing(fromPath: string, toPath: string) {
  if (!(await fileExists(fromPath))) return false
  if (await fileExists(toPath)) return false
  await fs.mkdir(path.dirname(toPath), { recursive: true })
  await fs.copyFile(fromPath, toPath)
  return true
}

async function copyFileOverwrite(fromPath: string, toPath: string) {
  if (!(await fileExists(fromPath))) return false
  await fs.mkdir(path.dirname(toPath), { recursive: true })
  await fs.copyFile(fromPath, toPath)
  return true
}

async function mirrorDirectoryMissingFiles(fromDir: string, toDir: string) {
  if (!(await fileExists(fromDir))) return 0
  const entries = await fs.readdir(fromDir, { withFileTypes: true })
  let copied = 0
  for (const entry of entries) {
    const src = path.join(fromDir, entry.name)
    const dst = path.join(toDir, entry.name)
    if (entry.isDirectory()) {
      copied += await mirrorDirectoryMissingFiles(src, dst)
      continue
    }
    const didCopy = await copyFileIfMissing(src, dst)
    if (didCopy) copied += 1
  }
  return copied
}

async function saveAgentFileToCodexProfile(agentId: string, file: string, content: string) {
  const profileDir = codexAgentProfilePath(agentId)
  await fs.mkdir(profileDir, { recursive: true })
  await fs.writeFile(path.join(profileDir, file), content, 'utf-8')
}

async function getAgentById(agentId: string) {
  const config = await readOpenclawConfig()
  const normalized = agentId.trim().toLowerCase()
  if (isValidAgentId(normalized) && isRetiredAgentId(normalized)) return { config, target: undefined }
  let target = (config.agents?.list || []).find((entry) => {
    const idMatch = entry.id.toLowerCase() === normalized
    const nameMatch = (entry.identity?.name || entry.name || '').trim().toLowerCase() === normalized
    return idMatch || nameMatch
  })
  if (target && isRetiredAgentId(target.id)) return { config, target: undefined }
  if (!target && isValidAgentId(normalized)) {
    const local = await readAgentLocalConfigIfPresent(normalized)
    if (local) {
      if (!config.agents) config.agents = {}
      if (!config.agents.list) config.agents.list = []
      target = agentEntryFromLocalConfig(normalized, local, config.agents.defaults?.workspace)
      config.agents.list.push(target)
      await writeOpenclawConfig(config).catch(() => undefined)
    }
  }
  return { config, target }
}

function resolveWorkspacePath(rawPath: string | undefined): string | undefined {
  const trimmed = (rawPath || '').trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return path.join(HOME_DIR, trimmed.replace(/^~[\\/]?/, ''))
  }
  return trimmed
}

function resolveWorkspaceForAgent(target: AgentConfigEntry | undefined, agentId: string, defaultsWorkspace?: string) {
  return (
    resolveWorkspacePath(target?.workspace) ||
    resolveWorkspacePath(defaultsWorkspace) ||
    defaultAgentWorkspace(agentId)
  )
}

function isPathInsideOrSame(baseDir: string, targetPath: string) {
  const base = path.resolve(baseDir)
  const target = path.resolve(targetPath)
  const normalizedBase = process.platform === 'win32' ? base.toLowerCase() : base
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  const baseWithSeparator = normalizedBase.endsWith(path.sep) ? normalizedBase : `${normalizedBase}${path.sep}`
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(baseWithSeparator)
}

function agentConfigWorkspaceForAvatar(agentId: string | undefined, workspacePath?: string, defaultsWorkspace?: string) {
  return normalizeExecutionWorkspacePath(path.resolve(
    resolveWorkspacePath(workspacePath) ||
    resolveWorkspacePath(defaultsWorkspace) ||
    (agentId ? defaultAgentWorkspace(agentId) : WORKSPACE_ROOT),
  ))
}

function configSafeAgentAvatar(rawAvatar: string | undefined, workspacePath?: string) {
  const avatar = (rawAvatar || '').trim()
  if (!avatar) return ''
  if (avatar.includes('\0')) return ''
  if (/^https?:\/\//i.test(avatar)) {
    try {
      const url = new URL(avatar)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.href
    } catch {
      return ''
    }
    return ''
  }
  if (/^(?:data|file):/i.test(avatar)) return ''

  const workspace = agentConfigWorkspaceForAvatar(undefined, workspacePath)
  const candidate = path.isAbsolute(avatar) ? path.resolve(avatar) : path.resolve(workspace, avatar)
  if (!isPathInsideOrSame(workspace, candidate)) return ''
  return path.isAbsolute(avatar) ? candidate : avatar
}

function firstConfigSafeAgentAvatar(workspacePath: string, ...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const safe = configSafeAgentAvatar(candidate, workspacePath)
    if (safe) return safe
  }
  return ''
}

function sanitizeAgentIdentityForOpenClaw(identity: AgentIdentity | undefined, workspacePath: string): AgentIdentity | undefined {
  if (!identity) return identity
  const safeAvatar = configSafeAgentAvatar(identity.avatar, workspacePath)
  const next: AgentIdentity = {
    ...(identity.name !== undefined ? { name: identity.name } : {}),
    ...(identity.emoji !== undefined ? { emoji: identity.emoji } : {}),
    ...(identity.theme !== undefined ? { theme: identity.theme } : {}),
    ...(safeAvatar ? { avatar: safeAvatar } : {}),
  }
  return Object.keys(next).length ? next : undefined
}

function sanitizeLooseIdentityForOpenClaw(identity: unknown, workspacePath: string) {
  if (!isLooseRecord(identity)) return identity
  const next = { ...identity }
  const safeAvatar = typeof next.avatar === 'string' ? configSafeAgentAvatar(next.avatar, workspacePath) : ''
  if (safeAvatar) next.avatar = safeAvatar
  else delete next.avatar
  return next
}

function sanitizeOpenClawConfigAgentAvatars(config: OpenClawConfigFile) {
  let changed = false
  const defaultsWorkspace = config.agents?.defaults?.workspace
  for (const entry of config.agents?.list || []) {
    const workspace = agentConfigWorkspaceForAvatar(entry.id, entry.workspace, defaultsWorkspace)
    const before = entry.identity?.avatar || ''
    const nextIdentity = sanitizeAgentIdentityForOpenClaw(entry.identity, workspace)
    if (nextIdentity) entry.identity = nextIdentity
    else delete entry.identity
    if ((entry.identity?.avatar || '') !== before) changed = true
  }
  return changed
}

async function seedCanonicalResourceIfMissing(agentId: string, file: AgentResourceFile) {
  const canonicalWorkspace = canonicalDoctrineRoot(agentId)
  const canonicalPath = path.join(canonicalWorkspace, file)
  if (await fileExists(canonicalPath)) return

  // Prefer per-agent Codex profile files when available.
  for (const profileRoot of codexProfileCandidates(agentId)) {
    const profileFilePath = path.join(profileRoot, file)
    if (await fileExists(profileFilePath)) {
      await copyFileIfMissing(profileFilePath, canonicalPath)
      if (await fileExists(canonicalPath)) return
    }
  }

  // Prefer canonical agent workspace templates before generated fallbacks.
  for (const seedRoot of canonicalSeedCandidates(agentId)) {
    const seedPath = path.join(seedRoot, file)
    if (seedPath === canonicalPath) continue
    if (await fileExists(seedPath)) {
      await copyFileIfMissing(seedPath, canonicalPath)
      if (await fileExists(canonicalPath)) return
    }
  }

  if ((RESOURCE_SEED_FILES as readonly string[]).includes(file)) {
    const fallback = defaultAgentResourceContent(agentId, file)
    if (fallback) {
      await fs.mkdir(canonicalWorkspace, { recursive: true })
      await fs.writeFile(canonicalPath, fallback, 'utf-8')
      return
    }
  }

  if (file === 'TEAM_SYNC.md') {
    await fs.mkdir(canonicalWorkspace, { recursive: true })
    await fs.writeFile(
      canonicalPath,
      '# TEAM_SYNC.md\n\nShared coordination ledger. Updated automatically during dispatch/mission runs.\n',
      'utf-8',
    )
  }
}

async function ensureAgentEditorResources(agentId: string, files: readonly AgentResourceFile[] = EDITOR_RESOURCE_FILES) {
  await fs.mkdir(canonicalDoctrineRoot(agentId), { recursive: true })
  await Promise.all(files.map((file) => seedCanonicalResourceIfMissing(agentId, file)))
}

async function resolveAgentResourceContext(agentId: string, seedFiles: readonly AgentResourceFile[] = EDITOR_RESOURCE_FILES) {
  const config = await readOpenclawConfig()
  const target = (config.agents?.list || []).find((entry) => entry.id === agentId)
  if (!target) return null

  const local = await readAgentLocalConfigIfPresent(agentId)
  const workspace = normalizeExecutionWorkspacePath(
    path.resolve(
      resolveWorkspacePath(local?.routing?.workspace) ||
        resolveWorkspaceForAgent(target, agentId, config.agents?.defaults?.workspace),
    ),
  )
  const canonicalWorkspace = canonicalDoctrineRoot(agentId)
  await ensureAgentEditorResources(agentId, seedFiles)
  const doctrineWorkspace = resolveDoctrineWorkspaceForRun(agentId, workspace, defaultAgentWorkspace(agentId))
  if (!samePath(workspace, canonicalWorkspace)) {
    await syncDoctrineToWorkspace(agentId, workspace)
    await cleanupAgentWorkspaceDoctrineFiles(agentId, workspace, {
      dryRun: false,
      removeRootMirrors: true,
      removeScopedMirrors: false,
      force: false,
    })
  }

  return {
    config,
    target,
    workspace,
    executionWorkspace: workspace,
    canonicalWorkspace,
    doctrineWorkspace,
  }
}

async function ensureAgentPersistence(agentId: string, workspace: string) {
  const canonicalWorkspace = defaultAgentWorkspace(agentId)
  const canonicalDoctrine = canonicalDoctrineRoot(agentId)
  const executionWorkspace = normalizeExecutionWorkspacePath(path.resolve(workspace || canonicalWorkspace))
  await fs.mkdir(canonicalWorkspace, { recursive: true })
  await fs.mkdir(canonicalDoctrine, { recursive: true })
  await fs.mkdir(path.join(canonicalWorkspace, 'memory'), { recursive: true })
  await fs.mkdir(executionWorkspace, { recursive: true })
  await fs.mkdir(path.join(executionWorkspace, 'memory'), { recursive: true })

  // Seed canonical memory from agent profile stores.
  for (const profileRoot of codexProfileCandidates(agentId)) {
    await mirrorDirectoryMissingFiles(path.join(profileRoot, 'memory'), path.join(canonicalWorkspace, 'memory'))
  }

  // Keep doctrine/resources canonical in the agent profile folder only.
  for (const file of AGENT_RESOURCE_FILES) {
    await seedCanonicalResourceIfMissing(agentId, file)
    const canonicalPath = path.join(canonicalDoctrine, file)
    const codexProfilePath = path.join(codexAgentProfilePath(agentId), file)
    if (await fileExists(canonicalPath)) {
      await copyFileOverwrite(canonicalPath, codexProfilePath)
    }
  }
}

function canonicalResourcePath(agentId: string, file: string) {
  return path.join(canonicalDoctrineRoot(agentId), file)
}

function extractIdentityNameFromMarkdown(markdown: string) {
  const headingLine = markdown.match(/^\s*#\s*IDENTITY\.md\s*-\s*(.+)$/im)
  const agentNameLine = markdown.match(/^\s*-\s*Agent Name:\s*(.+)$/im)
  const displayNameLine = markdown.match(/^\s*Display Name:\s*(.+)$/im)
  const youAreLine = markdown.match(/\bYou are\s+([^(`\n.]+?)(?:\s*\(|\.|\n)/i)
  const raw = headingLine?.[1] || agentNameLine?.[1] || displayNameLine?.[1] || youAreLine?.[1] || ''
  const normalized = raw.replace(/[`*_]/g, '').trim()
  return normalized || null
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function replaceAgentNameInMarkdownTree(rootDir: string, previousName: string, nextName: string) {
  if (!previousName || !nextName || previousName === nextName) return
  if (!(await fileExists(rootDir))) return

  const previousNamePattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(previousName)}(?![\\p{L}\\p{N}])`, 'gu')

  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const content = await fs.readFile(fullPath, 'utf-8')
      const next = content.replace(previousNamePattern, nextName)
      if (next !== content) await fs.writeFile(fullPath, next, 'utf-8')
    }
  }

  await walk(rootDir)
}

async function propagateDisplayNameAcrossAgentFiles(agentId: string, previousName: string | null, local: AgentLocalConfig) {
  const nextName = (local.identity.name || local.agent.displayName || agentId).trim()
  const previous = previousName?.trim() || ''
  const canonicalDir = canonicalDoctrineRoot(agentId)
  const codexDir = codexAgentProfilePath(agentId)

  await replaceAgentNameInMarkdownTree(canonicalDir, previous, nextName)
  await replaceAgentNameInMarkdownTree(codexDir, previous, nextName)
}

async function mirrorSharedTeamFile(file: SharedTeamFile, content: string) {
  const config = await readOpenclawConfig()
  const targets = new Set<string>([path.join(WORKSPACE_ROOT, file)])
  for (const entry of config.agents?.list || []) {
    if (!isValidAgentId(entry.id)) continue
    targets.add(path.join(canonicalDoctrineRoot(entry.id), file))
  }
  for (const target of targets) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf-8')
  }
}

function isValidAgentId(agentId: string) {
  return /^[a-z0-9-]+$/.test(agentId)
}

const BUILTIN_RETIRED_AGENT_IDS = new Set([
  'recruit-check-mps3678p',
  'no-such-agent',
  'hn-builder',
  'hn-commander',
  'hn-reviewer',
  'hn-fullstack',
  'hn-netanyahu',
  'hn-crypto-technical',
  'hn-crypto-onchain',
  'hn-crypto-quant',
  'hn-crypto-sentiment',
  'hn-buffett',
  'hn-devops',
  'hn-security',
  'hn-testing',
  'hn-ux',
  'hn-franklin',
  'hn-trump',
])
const RETIRED_AGENT_IDS = new Set(BUILTIN_RETIRED_AGENT_IDS)

function normalizeRetiredAgentId(agentId: string | undefined) {
  return agentId?.trim().toLowerCase() || ''
}

function retiredAgentIdsFromUnknown(value: unknown) {
  const ids = Array.isArray(value)
    ? value
    : isLooseRecord(value) && Array.isArray(value.ids)
      ? value.ids
      : []
  return ids
    .map((rawId) => typeof rawId === 'string' ? normalizeRetiredAgentId(rawId) : '')
    .filter((agentId) => isValidAgentId(agentId))
}

function loadRetiredAgentIdsFromDisk() {
  // Do not open SQLite during module evaluation. Opening it used to import every
  // historical JSONL entry before the API could bind, making large user ledgers
  // appear as a desktop startup failure.
  const sqliteState = readControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.retiredAgentIds, { sqlite: false })
  if (sqliteState !== null) {
    const sqliteIds = retiredAgentIdsFromUnknown(sqliteState)
    sqliteIds.forEach((agentId) => RETIRED_AGENT_IDS.add(agentId))
    return
  }

  const legacyIds = readLegacyJsonStateSync(RETIRED_AGENT_IDS_PATH, (value) => {
    const ids = retiredAgentIdsFromUnknown(value)
    return ids.length ? ids : null
  })
  if (legacyIds) {
    legacyIds.forEach((agentId) => RETIRED_AGENT_IDS.add(agentId))
  }
}

async function rememberRetiredAgentId(agentId: string) {
  const normalized = normalizeRetiredAgentId(agentId)
  if (!isValidAgentId(normalized)) return false
  RETIRED_AGENT_IDS.add(normalized)
  const ids = [...RETIRED_AGENT_IDS]
    .filter((id) => !BUILTIN_RETIRED_AGENT_IDS.has(id))
    .sort((a, b) => a.localeCompare(b))
  if (writeControlCenterStateRecord(CONTROL_CENTER_STATE_KEYS.retiredAgentIds, { ids }, RETIRED_AGENT_IDS_PATH)) return true
  await fs.mkdir(path.dirname(RETIRED_AGENT_IDS_PATH), { recursive: true })
  await writeTextFileWithLockRetry(RETIRED_AGENT_IDS_PATH, `${JSON.stringify({ ids }, null, 2)}\n`)
  return true
}

traceControlCenterStartup('loading durable startup state')
loadRetiredAgentIdsFromDisk()
traceControlCenterStartup('durable startup state loaded')

function isRetiredAgentId(agentId: string | undefined) {
  const normalized = normalizeRetiredAgentId(agentId)
  return Boolean(normalized && normalized !== 'main' && RETIRED_AGENT_IDS.has(normalized))
}

function pruneRetiredAgentsFromOpenClawConfig(config: OpenClawConfigFile) {
  const list = config.agents?.list
  if (!Array.isArray(list)) return false
  const next = list.filter((entry) => !isRetiredAgentId(entry.id))
  if (next.length === list.length) return false
  config.agents!.list = next
  return true
}

type RetireAgentReport = {
  removedPaths: string[]
  skippedPaths: Array<{ path: string; reason: string }>
}

async function removeAgentPathIfPresent(targetPath: string, allowedRoot: string, report: RetireAgentReport) {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(allowedRoot)
  if (!samePath(resolvedRoot, resolvedTarget) && !isPathUnder(resolvedRoot, resolvedTarget)) {
    report.skippedPaths.push({ path: resolvedTarget, reason: 'outside allowed agent state root' })
    return
  }
  if (!(await fileExists(resolvedTarget))) return
  await fs.rm(resolvedTarget, { recursive: true, force: true })
  report.removedPaths.push(resolvedTarget)
}

async function forgetAgentLocalConfigCache(agentId: string) {
  for (const candidate of agentLocalConfigPathCandidates(agentId)) {
    agentLocalConfigCache.delete(path.resolve(candidate))
  }
}

async function assertAgentRemovedFromOpenClawConfig(agentId: string) {
  const verify = await readOpenclawConfig()
  const stillPresent = (verify.agents?.list || []).some((entry) => entry.id === agentId)
  if (stillPresent) {
    throw new Error(`Agent ${agentId} was still present after openclaw config rewrite.`)
  }
}

async function purgeAgentState(agentId: string): Promise<RetireAgentReport & {
  configRemoved: boolean
  profileRemoved: boolean
  heartbeatDefaultsRemoved: boolean
  retiredIdRecorded: boolean
  sessionsCleared: ReturnType<typeof clearAgentTurnSessions>
  runsTerminated: ReturnType<typeof terminateOpenClawRunsForSession>
  gatewayRestart: GatewayRestartRequest
}> {
  const report: RetireAgentReport = { removedPaths: [], skippedPaths: [] }
  const sessionsCleared = clearAgentTurnSessions(agentId)
  const runsTerminated = terminateOpenClawRunsForSession({ agentId })
  const retiredIdRecorded = await rememberRetiredAgentId(agentId)

  const config = await readOpenclawConfig()
  const currentList = config.agents?.list || []
  const nextList = currentList.filter((entry) => entry.id !== agentId)
  const configRemoved = nextList.length !== currentList.length
  if (configRemoved && config.agents) {
    config.agents.list = nextList
    await writeOpenclawConfig(config)
    await assertAgentRemovedFromOpenClawConfig(agentId)
  }

  const profiles = await readPartyProfiles()
  const profileRemoved = Boolean(profiles.agents[agentId])
  if (profileRemoved) {
    delete profiles.agents[agentId]
    await writePartyProfiles(profiles)
  }

  const heartbeatPerAgent = await readHeartbeatRuntimePerAgent()
  const heartbeatDefaultsRemoved = Boolean(heartbeatPerAgent[agentId])
  if (heartbeatDefaultsRemoved) {
    delete heartbeatPerAgent[agentId]
    await writeHeartbeatRuntimePerAgent(heartbeatPerAgent)
  }

  browserProbeCache.delete(agentId)
  await forgetAgentLocalConfigCache(agentId)

  await removeAgentPathIfPresent(canonicalDoctrineRoot(agentId), OPENCLAW_AGENTS_ROOT, report)
  await removeAgentPathIfPresent(codexAgentProfilePath(agentId), CODEX_AGENT_PROFILES_ROOT, report)

  const workspaceAgentRoots = uniqueStrings(
    path.join(WORKSPACE_ROOT, SHARED_AGENT_STATE_DIR),
    path.resolve(process.cwd(), SHARED_AGENT_STATE_DIR),
  )
  for (const root of workspaceAgentRoots) {
    await removeAgentPathIfPresent(path.join(root, agentId), root, report)
  }

  const memoryRoot = path.join(OPENCLAW_STATE_ROOT, 'memory')
  for (const suffix of ['.sqlite', '.sqlite-shm', '.sqlite-wal']) {
    await removeAgentPathIfPresent(path.join(memoryRoot, `${agentId}${suffix}`), memoryRoot, report)
  }

  const gatewayRestart = configRemoved
    ? schedulePluginGatewayRestart()
    : { restarted: false, scheduled: false, detail: 'gateway restart skipped; agent was not present in config' }

  return {
    ...report,
    configRemoved,
    profileRemoved,
    heartbeatDefaultsRemoved,
    retiredIdRecorded,
    sessionsCleared,
    runsTerminated,
    gatewayRestart,
  }
}

function defaultAgentWorkspace(agentId: string) {
  if (agentId === 'main') {
    return OPENCLAW_PROFILE !== 'default'
      ? path.join(OPENCLAW_STATE_ROOT, `workspace-${OPENCLAW_PROFILE}`)
      : path.join(OPENCLAW_STATE_ROOT, 'workspace')
  }
  return path.join(OPENCLAW_STATE_ROOT, `workspace-${agentId}`)
}

function openclawAgentFolder(agentId: string) {
  return path.join(OPENCLAW_AGENTS_ROOT, agentId, 'agent')
}

function canonicalDoctrineRoot(agentId: string) {
  return path.join(OPENCLAW_AGENTS_ROOT, agentId)
}

function codexAgentProfilePath(agentId: string) {
  return path.join(CODEX_AGENT_PROFILES_ROOT, agentId)
}

function codexProfileCandidates(agentId: string) {
  return [
    codexAgentProfilePath(agentId),
    openclawAgentFolder(agentId),
    path.join(CODEX_AGENT_PROFILES_ROOT, 'default'),
    CODEX_LEGACY_AGENT_PROFILE_ROOT,
  ]
}

function canonicalSeedCandidates(agentId: string) {
  const candidates = [
    ...embeddedAgentRootCandidates(agentId),
    path.resolve(process.cwd(), 'vendor', 'openclaw', 'docs', 'reference', 'templates'),
    path.resolve(process.cwd(), 'resources', 'openclaw', 'docs', 'reference', 'templates'),
  ]
  return Array.from(new Set(candidates))
}

function defaultAgentResourceContent(agentId: string, file: AgentResourceFile) {
  const displayName = DEFAULT_BOOTSTRAP_AGENT_BY_ID.get(agentId)?.name || agentId
  switch (file) {
    case 'AGENTS.md':
      return [
        `# AGENTS.md - ${displayName}`,
        '',
        '## Workspace Contract',
        '- Treat this folder as the execution workspace.',
        '- Read identity, soul, user, heartbeat, tools, and mission files from this scoped doctrine folder first.',
        '- Keep project files in the execution workspace and doctrine/state markdown in the doctrine folder.',
        '- Make concrete edits, verify when feasible, and report changed paths plus remaining risks.',
        '',
      ].join('\n')
    case 'BOOTSTRAP.md':
      return [
        `# BOOTSTRAP.md - ${displayName}`,
        '',
        'Read scoped doctrine from this folder before work:',
        '- AGENTS.md',
        '- IDENTITY.md',
        '- SOUL.md',
        '- USER.md',
        '- HEARTBEAT.md',
        '- TOOLS.md',
        '- MISSION_PROMPT.md',
        '',
      ].join('\n')
    case 'HEARTBEAT.md':
      return `# HEARTBEAT.md - ${displayName}\n\nUse heartbeats for status, blockers, and the next useful action.\n`
    case 'IDENTITY.md':
      return `# IDENTITY.md - ${displayName}\n\nAgent ID: ${agentId}\n\nYou are ${displayName}. Work as a focused OpenClaw agent grounded in files, evidence, and the current user request.\n`
    case 'MEMORY.md':
      return `# MEMORY.md - ${displayName}\n\n## Durable Notes\n- Scoped memory for ${agentId}.\n`
    case 'MISSION_PROMPT.md':
      return [
        `# MISSION_PROMPT.md - ${displayName}`,
        '',
        '## Mission Contract',
        '- Inspect the current state before acting; do not rely on memory when files, runtime status, browser state, or tool output can be checked.',
        '- Restate the objective and success criteria briefly, then make the smallest useful concrete progress.',
        '- Use available tools for file reads, edits, commands, browser work, and diagnostics when they materially reduce uncertainty.',
        '- Report safe operational progress and blockers; never expose hidden reasoning, secrets, cookies, tokens, or private prompt text.',
        '- Verify with focused tests, builds, screenshots, browser checks, or targeted commands when feasible.',
        '- Do not claim a file changed, command passed, page loaded, or test succeeded unless you observed it.',
        '- If blocked, say exactly what failed, what was tried, and the safest next step.',
        '',
        '## Final Report',
        '- Files changed.',
        '- Commands/checks run and their pass/fail status.',
        '- Browser/tool actions completed, if relevant.',
        '- Remaining risks or manual checks.',
        '',
      ].join('\n')
    case 'SOUL.md':
      return `# SOUL.md - ${displayName}\n\n## Operating Bias\n- Prefer direct progress over performance.\n- State assumptions when they matter.\n- Ask only when a missing decision would create real risk.\n`
    case 'TEAM_INTENTS.md':
      return '# TEAM_INTENTS.md\n\nShared team intent ledger.\n'
    case 'TEAM_STATE.md':
      return '# TEAM_STATE.md\n\nShared team state ledger.\n'
    case 'TEAM_SYNC.md':
      return '# TEAM_SYNC.md\n\nShared coordination ledger. Updated automatically during dispatch/mission runs.\n'
    case 'TOOLS.md':
      return [
        `# TOOLS.md - ${displayName}`,
        '',
        '## Tool Use',
        '- Search before broad edits.',
        '- Prefer local filesystem inspection for code.',
        '- Use browser tools for live web/page tasks when the browser tool is available; keep browser status messages operational and non-sensitive.',
        '- Use command/exec tools only for relevant diagnostics, tests, builds, and safe project operations.',
        '- Treat approval prompts, sandbox denials, missing tools, and failed commands as visible blockers to report.',
        '- Verify outputs with focused tests or checks when relevant.',
        '',
      ].join('\n')
    case 'USER.md':
      return `# USER.md - ${displayName}\n\nServe the user with concise, actionable engineering work. Keep the current request as the priority.\n`
    case 'MDS.json':
      return null
  }
}

function agentLocalConfigPath(agentId: string) {
  return path.join(openclawAgentFolder(agentId), AGENT_LOCAL_CONFIG_FILE)
}

function legacyAgentLocalConfigPath(agentId: string) {
  return path.join(OPENCLAW_AGENTS_ROOT, agentId, AGENT_LOCAL_CONFIG_FILE)
}

function embeddedAgentRootCandidates(agentId?: string) {
  const electronResourcesPath = getElectronResourcesPath()
  const openclawRuntimeAgentRoot = openclawBin && openclawBin !== 'openclaw'
    ? path.join(path.dirname(openclawBin), 'agents')
    : ''
  const roots = uniqueStrings(
    path.join(WORKSPACE_ROOT, SHARED_AGENT_STATE_DIR),
    path.resolve(process.cwd(), SHARED_AGENT_STATE_DIR),
    path.join(electronResourcesPath, 'openclaw', 'agents'),
    openclawRuntimeAgentRoot,
    path.resolve(process.cwd(), 'resources', 'openclaw', 'agents'),
  )
  return agentId ? roots.map((root) => path.join(root, agentId)) : roots
}

function embeddedAgentLocalConfigPathCandidates(agentId: string) {
  return uniqueStrings(
    ...embeddedAgentRootCandidates(agentId).flatMap((root) => [
      path.join(root, 'agent', AGENT_LOCAL_CONFIG_FILE),
      path.join(root, AGENT_LOCAL_CONFIG_FILE),
    ]),
  )
}

function stateAgentLocalConfigPathCandidates(agentId: string) {
  return uniqueStrings(
    agentLocalConfigPath(agentId),
    legacyAgentLocalConfigPath(agentId),
  )
}

function agentLocalConfigPathCandidates(agentId: string) {
  return uniqueStrings(
    ...stateAgentLocalConfigPathCandidates(agentId),
    ...embeddedAgentLocalConfigPathCandidates(agentId),
  )
}

async function readAgentLocalConfigFileCached(filePath: string): Promise<AgentLocalConfig> {
  const resolved = path.resolve(filePath)
  return readCachedJsonFile(
    resolved,
    agentLocalConfigCache.get(resolved),
    (text) => JSON.parse(text) as AgentLocalConfig,
    (entry) => { agentLocalConfigCache.set(resolved, entry) },
  )
}

async function rememberAgentLocalConfigCache(filePath: string, local: AgentLocalConfig) {
  const resolved = path.resolve(filePath)
  await rememberJsonFileCache(resolved, local, (entry) => { agentLocalConfigCache.set(resolved, entry) })
}

async function readAgentLocalConfigFromCandidates(candidates: string[]): Promise<AgentLocalConfig | null> {
  for (const candidate of candidates) {
    try {
      return await readAgentLocalConfigFileCached(candidate)
    } catch {
      // keep looking for the canonical or legacy agent config
    }
  }
  return null
}

async function readAgentLocalConfigIfPresent(agentId: string): Promise<AgentLocalConfig | null> {
  return readAgentLocalConfigFromCandidates(agentLocalConfigPathCandidates(agentId))
}

async function readAgentNameFromDoctrineFolders(agentId: string) {
  for (const root of uniqueStrings(...embeddedAgentRootCandidates(agentId), canonicalDoctrineRoot(agentId))) {
    for (const file of ['IDENTITY.md', 'MISSION_PROMPT.md']) {
      try {
        const raw = await fs.readFile(path.join(root, file), 'utf-8')
        const name = extractIdentityNameFromMarkdown(raw)
        if (name) return name
      } catch {
        // keep scanning candidate doctrine files
      }
    }
  }
  return null
}

function agentEntryFromBootstrapAgent(agentId: string, defaultsWorkspace?: string, discoveredName?: string): AgentConfigEntry {
  const bootstrap = DEFAULT_BOOTSTRAP_AGENT_BY_ID.get(agentId)
  const displayName = discoveredName || bootstrap?.name || agentId
  return applyNoBootstrapAgentConfig({
    id: agentId,
    name: displayName,
    workspace: normalizeExecutionWorkspacePath(path.resolve(resolveWorkspacePath(defaultsWorkspace) || WORKSPACE_ROOT)),
    agentDir: path.resolve(openclawAgentFolder(agentId)),
    identity: { name: displayName, emoji: '@', theme: 'adventurer' },
    model: defaultAgentModelSelection(),
    fastModeDefault: openClawFastModeDefault(DEFAULT_OPENCLAW_FAST_MODE),
    sandbox: { mode: 'off', scope: 'agent', workspaceAccess: 'rw' },
  })
}

function agentEntryFromLocalConfig(agentId: string, local: AgentLocalConfig, defaultsWorkspace?: string): AgentConfigEntry {
  const workspace = normalizeExecutionWorkspacePath(path.resolve(
    resolveWorkspacePath(local.routing?.workspace) ||
    resolveWorkspacePath(local.routing?.canonicalFolder) ||
    resolveWorkspacePath(defaultsWorkspace) ||
    defaultAgentWorkspace(agentId),
  ))
  const avatar = configSafeAgentAvatar(local.identity?.avatar, workspace)
  return applyNoBootstrapAgentConfig({
    id: agentId,
    name: local.identity?.name || local.agent?.displayName || agentId,
    workspace,
    agentDir: path.resolve(openclawAgentFolder(agentId)),
    identity: {
      name: local.identity?.name || local.agent?.displayName || agentId,
      emoji: local.identity?.emoji || '@',
      theme: local.identity?.theme || 'adventurer',
      ...(avatar ? { avatar } : {}),
    },
    model: local.model,
    fastModeDefault: openClawFastModeDefault(local.runtime.fastModeDefault),
    sandbox: normalizeSandboxConfig(local.sandbox),
    tools: normalizeAgentToolsConfig(local.tools),
    skills: resolveOpenClawAgentSkillFilter(local),
  })
}

async function recoverLocalAgentEntries(
  config: { agents?: { list?: AgentConfigEntry[]; defaults?: { workspace?: string } } },
  profiles: PartyProfiles,
): Promise<AgentConfigEntry[]> {
  const existingIds = new Set((config.agents?.list || []).map((entry) => entry.id))
  const candidates = new Set<string>()
  for (const agent of DEFAULT_BOOTSTRAP_AGENTS) candidates.add(agent.id)
  for (const id of Object.keys(profiles.agents || {})) candidates.add(id)
  for (const root of uniqueStrings(OPENCLAW_AGENTS_ROOT, ...embeddedAgentRootCandidates())) {
    try {
      const dirs = await fs.readdir(root, { withFileTypes: true })
      for (const dir of dirs) {
        if (dir.isDirectory()) candidates.add(dir.name)
      }
    } catch {
      // agent root may not exist yet
    }
  }

  const recovered: AgentConfigEntry[] = []
  for (const id of candidates) {
    if (id === 'main' || existingIds.has(id) || !isValidAgentId(id) || isRetiredAgentId(id)) continue
    const local = await readAgentLocalConfigIfPresent(id)
    const entry = local
      ? agentEntryFromLocalConfig(id, local, config.agents?.defaults?.workspace)
      : agentEntryFromBootstrapAgent(id, config.agents?.defaults?.workspace, (await readAgentNameFromDoctrineFolders(id)) ?? undefined)
    recovered.push(entry)
    existingIds.add(id)
  }
  return recovered
}

function normalizeModelWithFallback(
  model: { primary?: string; fallbacks?: string[] } | undefined,
  defaults?: { primary?: string; fallbacks?: string[] },
) {
  const fallbackModelIds = DEEPSEEK_ONLY_DEFAULTS
    ? [DEEPSEEK_DEFAULT_MODEL_ID, ...DEEPSEEK_DEFAULT_FALLBACKS]
    : uniqueStrings(
        DEFAULT_AGENT_MODEL_ID,
        ...resilienceFallbacksForModel(DEFAULT_AGENT_MODEL_ID),
        ...FALLBACK_MODELS.map((entry) => entry.id),
      )
  const preferredPrimary = canonicalAgentModelId(model?.primary) || canonicalAgentModelId(defaults?.primary) || DEFAULT_AGENT_MODEL_ID
  const requestedFallbacks = (model ? model.fallbacks || [] : defaults?.fallbacks || []).map((modelId) =>
    canonicalAgentModelId(modelId),
  )

  const isKnownUsableModel = (modelId: string) => {
    if (KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId)) return false
    const provider = modelId.split('/')[0]
    if (!provider) return false
    return true
  }

  const pickPrimary = () => {
    if (isKnownUsableModel(preferredPrimary)) return preferredPrimary
    const orderedCandidates = [
      ...requestedFallbacks,
      ...fallbackModelIds,
    ]
    for (const candidate of orderedCandidates) {
      const trimmed = candidate?.trim()
      if (!trimmed) continue
      if (isKnownUsableModel(trimmed)) return trimmed
    }
    return DEFAULT_AGENT_MODEL_ID
  }

  const primary = pickPrimary()
  const fallbackSet = new Set<string>()
  for (const value of [...requestedFallbacks, ...resilienceFallbacksForModel(primary)]) {
    const trimmed = value?.trim()
    if (!trimmed || trimmed === primary) continue
    if (!isKnownUsableModel(trimmed)) continue
    fallbackSet.add(trimmed)
  }
  return { primary, fallbacks: Array.from(fallbackSet) }
}

function readAgentPrimaryModelIdSync(agentId: string) {
  const normalizedAgentId = agentId.trim().toLowerCase()
  const config = readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH) as OpenClawConfigFile | null
  const configPrimary = (config?.agents?.list || [])
    .find((entry) => entry.id?.trim().toLowerCase() === normalizedAgentId)
    ?.model?.primary
    ?.trim()
  if (configPrimary) return configPrimary

  for (const candidate of agentLocalConfigPathCandidates(agentId)) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8').replace(/^\uFEFF/, '')) as AgentLocalConfig
      const primary = parsed.model?.primary?.trim()
      if (primary) return primary
    } catch {
      // keep scanning known agent config locations
    }
  }
  return ''
}

function readAutomniaCompactAgentIdentitySync(
  agentId: string,
  executionWorkspace?: string,
) {
  const config = readJsonFileSyncLoose(OPENCLAW_CONFIG_PATH) as OpenClawConfigFile | null
  const entry = (config?.agents?.list || []).find((candidate) => candidate.id?.trim().toLowerCase() === agentId.trim().toLowerCase())
  let local: Record<string, unknown> | null = null
  for (const candidate of agentLocalConfigPathCandidates(agentId)) {
    local = readJsonFileSyncLoose(candidate)
    if (local) break
  }
  const localIdentity = isLooseRecord(local?.identity) ? local.identity : {}
  const localProfile = isLooseRecord(local?.profile) ? local.profile : {}
  const entryIdentity = isLooseRecord(entry?.identity) ? entry.identity : {}
  const localRouting = isLooseRecord(local?.routing) ? local.routing : {}
  return {
    name: String(entryIdentity.name || entry?.name || localIdentity.name || agentId).trim(),
    role: String(localProfile.role || '').trim(),
    workspace: String(executionWorkspace || entry?.workspace || localRouting.workspace || '').trim(),
  }
}

function readAutomniaCompactMemorySnippetSync(
  agentId: string,
  executionWorkspace?: string,
  doctrineWorkspace?: string,
) {
  const candidates = uniqueStrings(
    doctrineWorkspace ? path.join(doctrineWorkspace, 'MEMORY.md') : '',
    executionWorkspace ? path.join(executionWorkspace, 'MEMORY.md') : '',
    path.join(canonicalDoctrineRoot(agentId), 'MEMORY.md'),
    path.join(openclawAgentFolder(agentId), 'MEMORY.md'),
  )
  for (const candidate of candidates) {
    try {
      const compact = readFileSync(candidate, 'utf-8')
        .replace(/<!--([\s\S]*?)-->/g, ' ')
        .replace(/^\s*#+\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (compact) return trimTask(compact, AUTOMNIA_CREDITS_COMPACT_MEMORY_MAX_CHARS)
    } catch {
      // A missing memory file is normal; memory_get/read remain available on demand.
    }
  }
  return ''
}

function isGoogleGeminiModelId(modelId: string) {
  const { provider, model } = splitModelId(modelId)
  return (provider === 'google-vertex' || provider === 'google') && /^gemini(?:[-/]|$)/i.test(model)
}

function isLikelyCodeArtifactRequest(message: string) {
  const text = message.toLowerCase()
  if (/\.(html|css|js|jsx|ts|tsx|py|json|md|txt)\b/i.test(message)) return true
  return (
    /\b(create|build|make|write|generate|implement|code|develop|scaffold)\b/.test(text) &&
    /\b(html|css|javascript|typescript|react|vue|svelte|canvas|game|app|website|page|file|script|component)\b/.test(text)
  )
}

function shouldUseGoogleVertexCompactMode(agentId: string) {
  return isGoogleGeminiModelId(readAgentPrimaryModelIdSync(agentId))
}

function isMissionCronPrompt(message: string) {
  return /\bMission cron run:|TEAM_SYNC logging contract|cron-controlled mission|Mission ID:/i.test(message || '')
}

function shouldUseGoogleVertexCompactArtifactMode(agentId: string, message: string) {
  return shouldUseGoogleVertexCompactMode(agentId) && !isMissionCronPrompt(message) && isLikelyCodeArtifactRequest(message)
}

function googleVertexCompactTurnDirective(agentId: string, message: string) {
  if (!shouldUseGoogleVertexCompactMode(agentId) || isMissionCronPrompt(message)) return ''

  const lines = [
    'Google Vertex Gemini compact one-shot mode:',
    '- Treat this message plus the Startup context as the complete task packet for this turn.',
    '- Keep internal reasoning private and do not expand background context before making progress.',
    '- Read only the specific startup, doctrine, skill, or project files required by this request.',
    '- Prefer the fewest tool calls needed; when a tool action is required, make the first useful tool call immediately.',
    '- Keep the final reply concise: changed files, verification, blocker, or next step.',
  ]

  if (shouldUseGoogleVertexCompactArtifactMode(agentId, message)) {
    lines.push(
      'Compact artifact rule:',
      '- For standalone code/file/game/page creation, keep startup/doctrine context out unless the user explicitly asks for it.',
      '- You may use a few relevant file or verification tools before/after writing when it improves the result.',
      '- Prefer a complete, polished first version over artificial size limits, while keeping the task focused enough for one turn.',
      '- If the request is broad, create the best complete first version and mention any natural follow-up expansion.',
    )
  }

  return lines.join('\n')
}

function compactGoogleGeminiArtifactTask(message: string, filenameHints: string[]) {
  const withoutIdentity = message
    .replace(/^You are [^\n]+?\.\nDo not claim to be any other person or agent\.\nIf any prior persona conflicts with this identity, discard it now\.\n+/i, '')
    .replace(/^Filename resolution hints \(auto-detected from workspace\):[\s\S]*?\n\n/i, '')
    .trim()
  const target = filenameHints.length ? filenameHints[0] : ''
  const lower = withoutIdentity.toLowerCase()

  if (/asteroids/.test(lower) && /\.html?$/i.test(target)) {
    return [
      `Create ${target} as a polished playable Asteroids-style HTML5 canvas game.`,
      'Include ship rotation/thrust, bullets, asteroids, score, lives/restart, and responsive presentation.',
      'One self-contained HTML file. No external assets. Keep scope focused enough for one turn.',
    ].join(' ')
  }

  if (/\bgame\b/.test(lower) && /\.html?$/i.test(target)) {
    return [
      trimTask(withoutIdentity, 1100),
      `Target file: ${target}.`,
      'Create it as a polished playable HTML5 canvas game matching the full request.',
      'One self-contained HTML file. No external assets. Include complete controls, HUD, restart flow, and useful game states.',
    ].join(' ')
  }

  if (target) {
    return `${trimTask(withoutIdentity, 1100)} Create a complete working first version; target file: ${target}.`
  }

  return `${trimTask(withoutIdentity, 1200)} Create a complete working first version.`
}

function deriveAgentAliases(agentId: string, displayName: string) {
  const aliases = new Set<string>()
  aliases.add(agentId.toLowerCase())
  aliases.add(agentId.replace(/^hn-/, '').toLowerCase())
  for (const token of displayName.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (token) aliases.add(token)
  }
  return Array.from(aliases).slice(0, 24)
}


async function syncAgentDerivedFiles(agentId: string, local: AgentLocalConfig) {
  const canonicalDir = canonicalDoctrineRoot(agentId)
  const runtimeDir = openclawAgentFolder(agentId)
  const codexDir = codexAgentProfilePath(agentId)
  const targets = uniqueStrings(canonicalDir, runtimeDir, codexDir)

  const stripManagedBlocks = (content: string) => {
    const normalized = (content || '').replace(/\r\n/g, '\n')
    const next = normalized.replace(
      /(^|\n)\s*<!--\s*CONTROL_CENTER:[^\n]*_START\s*-->\n[\s\S]*?\n\s*<!--\s*CONTROL_CENTER:[^\n]*_END\s*-->\s*(?=\n|$)/g,
      '$1',
    )
    return `${next.trimEnd()}\n`
  }

  const scrubManagedBlocksAtPath = async (filePath: string) => {
    if (!(await fileExists(filePath))) return
    const current = await readTextFileWithLockRetry(filePath)
    if (!current.includes('CONTROL_CENTER:')) return
    const cleaned = stripManagedBlocks(current)
    if (cleaned !== current) {
      await writeTextFileWithLockRetry(filePath, cleaned)
    }
  }

  const mdsPayload = {
    agentId,
    generatedAt: new Date().toISOString(),
    mds: local.mds,
    attributes: local.attributes,
    profile: {
      role: local.profile.role,
      className: local.profile.className,
      level: local.profile.level,
      skills: local.profile.skills,
      stats: local.profile.stats,
    },
  }

  for (const file of AGENT_RESOURCE_FILES) {
    if (file !== AGENT_MDS_FILE) await seedCanonicalResourceIfMissing(agentId, file)
  }

  const canonicalMarkdownFiles = await fs.readdir(canonicalDir, { withFileTypes: true })
    .then((entries) => entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name))
    .catch(() => [])
  const mirroredFiles = uniqueStrings(
    ...AGENT_RESOURCE_FILES.filter((file) => file !== AGENT_MDS_FILE && file.toLowerCase().endsWith('.md')),
    ...canonicalMarkdownFiles,
  )

  for (const dir of targets) {
    await fs.mkdir(dir, { recursive: true })

    for (const file of mirroredFiles) {
      await scrubManagedBlocksAtPath(path.join(dir, file))
      if (!samePath(dir, canonicalDir)) {
        await copyFileOverwrite(path.join(canonicalDir, file), path.join(dir, file))
      }
    }

    await writeTextFileWithLockRetry(path.join(dir, AGENT_MDS_FILE), `${JSON.stringify(mdsPayload, null, 2)}\n`)
  }
}

function composeAgentDoctrinePrompt(
  agentId: string,
  message: string,
  executionWorkspace?: string,
  doctrineWorkspace?: string,
  continuation = false,
) {
  if (continuation) return composeAutomniaContinuationPrompt(message)

  const profileDir = doctrineWorkspace || openclawAgentFolder(agentId)
  const vertexCompactMode = shouldUseGoogleVertexCompactMode(agentId)
  const vertexCompactArtifactMode = shouldUseGoogleVertexCompactArtifactMode(agentId, message)
  const vertexCompactDirective = googleVertexCompactTurnDirective(agentId, message)
  if (vertexCompactArtifactMode) {
    const filenameHints = extractFilenameHints(message).slice(0, 5)
    const compactTask = compactGoogleGeminiArtifactTask(message, filenameHints)
    return [
      'Google Vertex Gemini compact tool-write turn.',
      executionWorkspace ? `Workspace: ${executionWorkspace}` : '',
      filenameHints.length
        ? `Target file(s): ${filenameHints.join(', ')}`
        : 'Target file(s): infer from task; create the requested file directly in Workspace.',
      'Available tools: write, read, edit, exec, process, memory_search, memory_get, session_status.',
      'Use tools freely when they help: write/edit the artifact, read it back, run a lightweight verification command, or check memory only if the request asks for prior context.',
      'Avoid broad startup/doctrine/team/project-file reads; inspect only directly relevant files.',
      'Preserve ISO-8601 timestamps, UUIDs, and numeric measurements exactly; they are not phone numbers.',
      'No hard character cap: make the artifact complete and polished, but keep the scope focused enough for one turn.',
      'Final reply: changed file path plus concise verification or blocker only.',
      '',
      `Compact task: ${compactTask}`,
    ].filter(Boolean).join('\n')
  }

  if (isAutomniaOpenClawModel(readAgentPrimaryModelIdSync(agentId))) {
    const identity = readAutomniaCompactAgentIdentitySync(agentId, executionWorkspace)
    const memory = readAutomniaCompactMemorySnippetSync(agentId, executionWorkspace, doctrineWorkspace)
    return [
      'Automnia credits compact runtime context:',
      `Name: ${identity.name || agentId}`,
      `Role: ${identity.role || 'active Automnia agent'}`,
      identity.workspace ? `Workspace: ${identity.workspace}` : '',
      `Memory snippet: ${memory || 'none loaded; use memory_get or read only when needed.'}`,
      'Tools: read, write, edit, exec, process, memory_get, session_status.',
      'For anything else, read the relevant local docs or skill file only when this task requires it; do not preload docs or workspace files.',
      'Preserve ISO-8601 timestamps, UUIDs, and numeric measurements exactly; they are not phone numbers.',
      'Keep the turn focused on the current request and keep the final reply concise.',
      '',
      message,
    ].filter(Boolean).join('\n')
  }

  return [
    'Interactive runtime context:',
    `- Doctrine folder: ${profileDir}`,
    executionWorkspace ? `- Workspace folder: ${executionWorkspace}` : '',
    vertexCompactMode
      ? 'Startup: Doctrine files are available, but for Google Vertex Gemini read only files needed for this turn.'
      : 'Answer directly from the active conversation when enough context is already available. Do not read every doctrine, workspace, or team file just to begin a turn.',
    'Use tools whenever live state, an external action, or evidence is needed. Tool availability is not limited by the response speed or reasoning level.',
    'Before changing workspace files, read the applicable AGENTS.md and only the files relevant to the requested change. Read doctrine, MDS.json, or an enabled SKILL.md only when it is relevant to the request.',
    `Shared skill root: ${SHARED_SKILLS_ROOT}. Never use ~/skills for Control Center skills; if MDS lists an absolute SKILL.md path, read that exact path.`,
    vertexCompactDirective,
    executionWorkspace
      ? 'Project files live in Workspace; doctrine/state markdown stays in Doctrine.'
      : '',
    executionWorkspace
      ? `Append TEAM_SYNC via POST http://127.0.0.1:${PORT}/api/team-sync/append JSON { agentId, role, note, filePath }; do not overwrite it.`
      : '',
    executionWorkspace ? 'Search Workspace before asking for files; fix obvious filename typos and proceed.' : '',
    'Do concrete edits when asked. Do not role-play. Do not claim host actions without command/result evidence.',
    'Give concise, safe operational updates for visible work only: files read, commands run, browser actions, tool failures, retries, approvals, tests, and finalizing.',
    'Never reveal hidden reasoning, private prompts, cookies, bearer tokens, API keys, passwords, .env values, or full sensitive local paths in status or final output. Preserve ISO-8601 timestamps, UUIDs, and numeric measurements exactly; they are not phone numbers.',
    'Do not report success until the relevant file, command, browser, or tool result has been observed. If verification cannot run, say why.',
    `Reply as ${agentId}: changed files, commands/checks run with pass/fail status, browser/tool actions if relevant, blocker or next step, and remaining risks. Persist important memory to files when useful.`,
    '',
    message,
  ].filter(Boolean).join('\n')
}

function composeDirectProviderPrompt(agentId: string, message: string, executionWorkspace?: string) {
  return [
    `You are ${agentId}.`,
    executionWorkspace ? `Current execution workspace: ${executionWorkspace}` : '',
    'Answer the user directly and concisely using the information already present in the conversation.',
    'This direct streaming path has no filesystem, terminal, browser, or app-control tools.',
    'Do not claim to inspect files, run commands, open apps, or edit the workspace from this path.',
    'If the request requires tools or workspace edits, state the specific missing tool action without telling the user to send a slash command.',
    'Never role-play, use theatrical personas, or stylized historical voices unless the user explicitly requests it.',
    '',
    message,
  ].filter(Boolean).join('\n')
}

const MISSION_PROMPT_DUMP_PATH = path.join(WORKSPACE_ROOT, 'MISSION_PROMPT_DUMP.txt')

async function appendAgentPromptDump(params: {
  route: string
  agent: string
  sessionId: string
  thinking: string
  fastMode?: FastModePreference
  timeoutSeconds: number
  cwd: string
  requestMessage: string
  finalMessage: string
  intentMessage?: string
  note?: string
}) {
  const finalMessage = params.finalMessage || ''
  const requestMessage = params.requestMessage || ''
  const section = [
    '',
    '='.repeat(120),
    `Captured: ${new Date().toISOString()}`,
    `Route: ${params.route}`,
    `Agent: ${params.agent}`,
    `Session: ${params.sessionId}`,
    `Thinking: ${params.thinking}`,
    `Fast mode: ${params.fastMode || 'default'}`,
    `Timeout seconds: ${params.timeoutSeconds}`,
    `Run cwd: ${params.cwd}`,
    params.note ? `Note: ${params.note}` : '',
    `Request message chars: ${requestMessage.length}`,
    `Final --message chars: ${finalMessage.length}`,
    `Final rough token estimate (chars/4): ${Math.ceil(finalMessage.length / 4)}`,
    '',
    '--- intentMessage/display text ---',
    params.intentMessage?.trim() || '(none)',
    '',
    '--- request message before backend doctrine wrapper ---',
    requestMessage,
    '',
    '--- FINAL openclaw --message payload ---',
    finalMessage,
    '',
  ].filter((line) => line !== '').join('\n')

  try {
    await fs.appendFile(MISSION_PROMPT_DUMP_PATH, `${section}\n`, 'utf-8')
  } catch (error) {
    console.warn(`[prompt-dump] failed to write ${MISSION_PROMPT_DUMP_PATH}:`, error)
  }
}

async function appendGoogleVertexPayloadDump(params: {
  route: string
  agent: string
  modelId: string
  thinking: ThinkingLevel
  endpoint: string
  targetRelativePath: string
  prompt: string
  body: Record<string, unknown>
}) {
  const prompt = params.prompt || ''
  const section = [
    '',
    '='.repeat(120),
    `Captured: ${new Date().toISOString()}`,
    `Route: ${params.route}`,
    `Agent: ${params.agent}`,
    `Model: ${params.modelId}`,
    `Thinking: ${params.thinking}`,
    `Target file: ${params.targetRelativePath}`,
    `Endpoint: ${params.endpoint}`,
    'Auth: omitted',
    `Prompt chars: ${prompt.length}`,
    `Payload rough token estimate (chars/4): ${Math.ceil(JSON.stringify(params.body).length / 4)}`,
    '',
    '--- FINAL Google Vertex REST prompt text ---',
    prompt,
    '',
    '--- FINAL Google Vertex REST JSON body (auth omitted) ---',
    JSON.stringify(params.body, null, 2),
    '',
  ].join('\n')

  try {
    await fs.appendFile(MISSION_PROMPT_DUMP_PATH, `${section}\n`, 'utf-8')
  } catch (error) {
    console.warn(`[prompt-dump] failed to write ${MISSION_PROMPT_DUMP_PATH}:`, error)
  }
}

function buildDispatchExecutionDirective(member: {
  id: string
  name?: string
  role?: string
  className?: string
}) {
  const roleHint = `${member.role || ''} ${member.className || ''}`.toLowerCase()
  if (/(coordinator|architect|lead|planner)/.test(roleHint)) {
    return [
      'Role directive (coordination lead):',
      '- Define a concise mission statement tied to the user goal.',
      '- Claim a clear ownership slice in TEAM_SYNC.md and avoid vague planning-only output.',
      '- Deliver concrete edits in the target file(s) within this same turn.',
    ].join('\n')
  }

  if (/(reviewer|auditor|qa|quality)/.test(roleHint)) {
    return [
      'Role directive (review/quality):',
      '- Focus on quality hardening: accessibility, consistency, edge-case handling, and cleanup.',
      '- If you find issues, fix them directly in the same turn instead of only listing them.',
      '- Document verification evidence briefly (what changed + what was checked).',
    ].join('\n')
  }

  return [
    'Role directive (implementation):',
    '- Implement concrete UI/UX improvements directly in code this turn.',
    '- Prefer shipping edits over asking exploratory follow-up questions when the file exists.',
    '- Record your ownership and completion update in TEAM_SYNC.md style output when relevant.',
  ].join('\n')
}

const WEBSITE_CONTRIBUTION_LANES = [
  'Improve hero/header clarity and first-impression visual impact.',
  'Improve section structure and readability (spacing, hierarchy, typography).',
  'Improve interaction polish (hover/focus states, transitions, button affordances).',
  'Improve accessibility and responsive behavior (semantics, contrast, mobile layout).',
]

function isSharedWebsiteCollaboration(assignments: Array<{ message: string }>) {
  if (assignments.length < 2) return false
  const normalized = assignments.map((entry) => entry.message.trim().toLowerCase())
  const allSameMessage = normalized.every((entry) => entry === normalized[0])
  if (!allSameMessage) return false
  return /(website|index\.html|html\s+file|single\s+file|one\s+file|each\s+of\s+you|all\s+of\s+you|different)/i.test(normalized[0])
}

function targetFileForWebsiteCollab(message: string, notes: string[]) {
  for (const note of notes) {
    const mapped = note.match(/->\s*([^\s].*)$/)
    if (mapped?.[1]) return mapped[1].trim()
  }

  const hint = extractFilenameHints(message).find((entry) => /\.html?$/i.test(entry))
  return hint || 'index.html'
}

function buildWebsiteContributionDirective(params: {
  active: boolean
  assignmentIndex: number
  totalAssignments: number
  message: string
  resolutionNotes: string[]
}) {
  if (!params.active) return ''
  const lane = WEBSITE_CONTRIBUTION_LANES[params.assignmentIndex % WEBSITE_CONTRIBUTION_LANES.length]
  const targetFile = targetFileForWebsiteCollab(params.message, params.resolutionNotes)

  return [
    'Shared website collaboration mode:',
    `- Collaborate on one shared file: ${targetFile}`,
    `- Your unique lane (${params.assignmentIndex + 1}/${params.totalAssignments}): ${lane}`,
    '- Do not duplicate teammates\' lanes; implement only your lane plus minimal integration edits.',
    '- If the file does not exist in execution workspace, create it and proceed immediately.',
    '- End your reply with this exact block:',
    'CONTRIBUTION_REPORT',
    '- file: <path>',
    '- lane: <what you uniquely added>',
    '- summary: <1-2 lines>',
  ].join('\n')
}

function normalizeExecutionWorkspacePath(workspacePath: string) {
  const normalized = path.resolve(workspacePath || '')
  const marker = `${path.sep}.openclaw${path.sep}agents${path.sep}`
  const idx = normalized.toLowerCase().indexOf(marker.toLowerCase())
  if (idx <= 0) return normalized
  return normalized.slice(0, idx)
}

function buildDefaultAgentLocalConfig(params: {
  agentId: string
  entry?: AgentConfigEntry
  profile?: AgentProfile
  defaultsModel?: { primary?: string; fallbacks?: string[] }
  defaultsWorkspace?: string
  defaultsSandbox?: AgentSandboxConfig
  existing?: AgentLocalConfig
}): AgentLocalConfig {
  const now = new Date().toISOString()
  const profile = sanitizeProfile({
    ...(params.existing?.profile || {}),
    ...(params.profile || {}),
    stats: {
      ...(params.existing?.profile?.stats || {}),
      ...(params.profile?.stats || {}),
    },
  })
  const canonicalFolder = defaultAgentWorkspace(params.agentId)
  const entryName = params.entry?.identity?.name || params.entry?.name || ''
  const displayName =
    params.existing?.agent.displayName ||
    entryName ||
    params.agentId
  const identityName = params.existing?.identity.name || entryName || displayName
  const model = normalizeModelWithFallback(params.existing?.model || params.entry?.model, params.defaultsModel)
  const configuredWorkspace =
    resolveWorkspacePath(params.existing?.routing.workspace) ||
    resolveWorkspacePath(params.entry?.workspace) ||
    resolveWorkspacePath(params.defaultsWorkspace) ||
    defaultAgentWorkspace(params.agentId)
  const workspace = normalizeExecutionWorkspacePath(
    configuredWorkspace,
  )
  const identityAvatar = firstConfigSafeAgentAvatar(
    workspace,
    params.existing?.identity.avatar,
    params.entry?.identity?.avatar,
    profile.avatar,
  )
  const sandbox = normalizeSandboxConfig({
    ...(params.existing?.sandbox ||
      params.entry?.sandbox ||
      params.defaultsSandbox ||
      { mode: 'off', scope: 'agent', workspaceAccess: 'rw' }),
    workspaceRoot: workspace,
  })

  return {
    schemaVersion: 1,
    agent: {
      id: params.agentId,
      displayName,
      aliases: params.existing?.agent.aliases?.length ? params.existing.agent.aliases : deriveAgentAliases(params.agentId, displayName),
      tags: params.existing?.agent.tags || [],
      createdAt: params.existing?.agent.createdAt || now,
      updatedAt: params.existing?.agent.updatedAt || now,
    },
    identity: {
      name: identityName,
      emoji: params.entry?.identity?.emoji || params.existing?.identity.emoji || '@',
      theme: params.entry?.identity?.theme || params.existing?.identity.theme || 'adventurer',
      avatar: identityAvatar,
    },
    routing: {
      workspace,
      canonicalFolder,
    },
    model,
    profile,
    attributes: params.existing?.attributes || {
      intelligence: 80,
      speed: 80,
      precision: 80,
      creativity: 80,
      stability: 80,
      compute: 80,
      parallelism: 4,
    },
    soul: params.existing?.soul || {
      personality: 'analytical',
      autonomyLevel: 72,
      riskTolerance: 48,
      reflectionDepth: 62,
      goalOrientation: 84,
      persistence: 88,
      alignmentMode: 'balanced',
    },
    heartbeat: params.existing?.heartbeat || {
      tickIntervalMs: 3000,
      maxExecutionTimeMs: 900000,
      continuous: true,
      idleTimeoutMs: 180000,
      recoveryMode: true,
    },
    mds: params.existing?.mds || {
      maxContextTokens: 128000,
      delegationAllowed: true,
      subAgentSpawnLimit: 8,
      toolAccess: [],
      capabilities: {
        codeGeneration: true,
        planning: true,
        research: true,
        orchestration: true,
        memoryManagement: true,
      },
    },
    memory: {
      journalDir: path.join(workspace, 'memory'),
      retentionDays: params.existing?.memory?.retentionDays ?? 180,
    },
    runtime: {
      thinkingDefault: params.existing?.runtime?.thinkingDefault || 'medium',
      timeoutSeconds: normalizeWorkTimeoutSeconds(params.existing?.runtime?.timeoutSeconds) ?? 900,
      parallelPreferred: params.existing?.runtime?.parallelPreferred ?? true,
      fastModeDefault: normalizeFastModePreference(
        params.existing?.runtime?.fastModeDefault ?? params.entry?.fastModeDefault,
        DEFAULT_OPENCLAW_FAST_MODE,
      ),
    },
    auth: params.existing?.auth || {
      providers: {},
    },
    sandbox,
    tools: normalizeAgentToolsConfig(params.existing?.tools || params.entry?.tools || {}),
  }
}

function resolveDoctrineWorkspaceForRun(agentId: string, executionWorkspace: string, _canonicalFolder?: string) {
  void _canonicalFolder
  const canonical = canonicalDoctrineRoot(agentId).trim()
  const normalizedExecution = path.resolve(executionWorkspace || canonical)
  const normalizedCanonical = path.resolve(canonical)
  if (samePath(normalizedExecution, normalizedCanonical)) return normalizedCanonical
  if (CANONICAL_DOCTRINE_ONLY) {
    return scopedAgentWorkspaceStateDir(normalizedExecution, agentId)
  }
  return normalizedCanonical
}

async function ensureAgentLocalConfig(params: {
  agentId: string
  entry?: AgentConfigEntry
  profile?: AgentProfile
  defaultsModel?: { primary?: string; fallbacks?: string[] }
  defaultsWorkspace?: string
  defaultsSandbox?: AgentSandboxConfig
}) {
  const filePath = agentLocalConfigPath(params.agentId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const existing = await readAgentLocalConfigFromCandidates(agentLocalConfigPathCandidates(params.agentId)) || undefined

  const next = buildDefaultAgentLocalConfig({ ...params, existing })
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  const current = await fs.readFile(filePath, 'utf-8').catch(() => null)
  if (current !== serialized) {
    await writeTextFileWithLockRetry(filePath, serialized)
  }
  await rememberAgentLocalConfigCache(filePath, next)
  return next
}

function applyLocalConfigToGlobal(
  agentId: string,
  local: AgentLocalConfig,
  config: { agents?: { list?: AgentConfigEntry[]; defaults?: { workspace?: string } } },
) {
  if (!config.agents) config.agents = {}
  if (!config.agents.list) config.agents.list = []

  let target = config.agents.list.find((entry) => entry.id === agentId)
  if (!target) {
    target = { id: agentId }
    config.agents.list.push(target)
  }

  const executionWorkspace =
    resolveWorkspacePath(local.routing.workspace) ||
    resolveWorkspacePath(local.routing.canonicalFolder) ||
    resolveWorkspaceForAgent(target, agentId, config.agents?.defaults?.workspace)
  const normalizedExecutionWorkspace = normalizeExecutionWorkspacePath(path.resolve(executionWorkspace))
  const avatar = configSafeAgentAvatar(local.identity.avatar, normalizedExecutionWorkspace)
  target.workspace = normalizedExecutionWorkspace
  target.agentDir = path.resolve(openclawAgentFolder(agentId))
  target.name = local.identity.name || local.agent.displayName || agentId
  target.identity = {
    name: local.identity.name,
    emoji: local.identity.emoji,
    theme: local.identity.theme,
    ...(avatar ? { avatar } : {}),
  }
  const projectedModel = modelSelectionForActiveBillingRoute(modelSelectionForOpenClawConfig(local.model))
  target.model = {
    primary: projectedModel.primary,
    ...(projectedModel.fallbacks?.length ? { fallbacks: projectedModel.fallbacks } : {}),
  }
  target.fastModeDefault = openClawFastModeDefault(local.runtime.fastModeDefault)
  target.skills = resolveOpenClawAgentSkillFilter(local)
  target.sandbox = normalizeSandboxConfig({
    ...local.sandbox,
    workspaceRoot: normalizedExecutionWorkspace,
  })
  target.tools = local.sandbox.mode === 'off'
    ? unrestrictedAgentToolsConfig()
    : normalizeAgentToolsConfig(local.tools)
  applyNoBootstrapAgentConfig(target)
}

async function syncAgentProjectionToGlobal(agentId: string) {
  const config = await readOpenclawConfig()
  const entry = (config.agents?.list || []).find((item) => item.id === agentId)
  const profiles = await readPartyProfiles()
  const defaultsModel = config.agents?.defaults?.model || {}
  const defaultsWorkspace = config.agents?.defaults?.workspace
  const defaultsSandbox = (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox
  const local = await ensureAgentLocalConfig({
    agentId,
    entry,
    profile: profiles.agents[agentId],
    defaultsModel,
    defaultsWorkspace,
    defaultsSandbox,
  })
  applyLocalConfigToGlobal(agentId, local, config)
  await writeOpenclawConfig(config)
  return { local, config }
}

async function ensureAgentSandboxCompatibleWithHost(agentId: string) {
  const config = await readOpenclawConfig()
  const entry = (config.agents?.list || []).find((item) => item.id === agentId)
  const profiles = await readPartyProfiles()
  const local = await ensureAgentLocalConfig({
    agentId,
    entry,
    profile: profiles.agents[agentId],
    defaultsModel: config.agents?.defaults?.model || {},
    defaultsWorkspace: config.agents?.defaults?.workspace,
    defaultsSandbox: (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox,
  })

  if (local.sandbox.mode === 'off') {
    const unrestrictedTools = unrestrictedAgentToolsConfig()
    if (JSON.stringify(local.tools) !== JSON.stringify(unrestrictedTools)) {
      local.tools = unrestrictedTools
      local.sandbox = normalizeSandboxConfig({
        ...local.sandbox,
        mode: 'off',
        scope: 'agent',
        workspaceAccess: 'rw',
      })
      local.agent.updatedAt = new Date().toISOString()
      await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
      await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
      applyLocalConfigToGlobal(agentId, local, config)
      await writeOpenclawConfig(config)
    }
    return { changed: false, local, message: '' }
  }

  if (!sandboxRequiresDocker(local.sandbox) || isDockerCliAvailable()) {
    return { changed: false, local, message: '' }
  }

  const message = dockerUnavailableSandboxMessage(agentId)
  local.sandbox = normalizeSandboxConfig({
    ...local.sandbox,
    mode: 'off',
    scope: local.sandbox.scope || 'agent',
    workspaceAccess: local.sandbox.workspaceAccess || 'rw',
  })
  local.tools = unrestrictedAgentToolsConfig()
  applyExecutionWorkspaceToLocalConfig(local, local.routing.workspace)
  local.agent.updatedAt = new Date().toISOString()
  await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
  await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
  await syncAgentDerivedFiles(agentId, local)
  applyLocalConfigToGlobal(agentId, local, config)
  await writeOpenclawConfig(config)
  return { changed: true, local, message }
}

async function syncAllAgentLocalConfigs() {
  const [config, profiles] = await Promise.all([readOpenclawConfig(), readPartyProfiles()])
  const defaultsModel = config.agents?.defaults?.model || {}
  const defaultsWorkspace = config.agents?.defaults?.workspace
  const defaultsSandbox = (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox
  const agents = (config.agents?.list || []).filter((entry) => entry.id !== 'main')
  let updated = 0

  for (const entry of agents) {
    const local = await ensureAgentLocalConfig({
      agentId: entry.id,
      entry,
      profile: profiles.agents[entry.id],
      defaultsModel,
      defaultsWorkspace,
      defaultsSandbox,
    })
    applyLocalConfigToGlobal(entry.id, local, config)
    await syncAgentDerivedFiles(entry.id, local)
    if (local.routing.workspace && !samePath(local.routing.workspace, canonicalDoctrineRoot(entry.id))) {
      await syncDoctrineToWorkspace(entry.id, local.routing.workspace)
    }
    updated += 1
  }

  await writeOpenclawConfig(config)
  let sessionModelRowsCleared = 0
  for (const entry of config.agents?.list || []) {
    if (!entry.id || isRetiredAgentId(entry.id)) continue
    const cleanup = await clearDisallowedAutoModelOverridesForAgent(entry.id, entry.model)
    sessionModelRowsCleared += cleanup.cleared.length
  }
  return { updated, sessionModelRowsCleared }
}

function buildMissionPrompt(agent: AgentConfigEntry, profile: AgentProfile): string {
  const agentLabel = agent.identity?.name || agent.name || agent.id
  const classLine = profile.className ? `- Class: ${profile.className}` : ''
  const roleLine = profile.role ? `- Role: ${profile.role}` : ''
  const behaviorLine = profile.behaviorProfile ? `- Behavior: ${profile.behaviorProfile}` : ''
  const mottoLine = profile.motto ? `- Motto: ${profile.motto}` : ''
  const skillsLine = profile.skills.length ? `- Skills: ${profile.skills.join(', ')}` : '- Skills: none enabled'
  const abilitiesLine = profile.abilities.length ? `- Abilities: ${profile.abilities.join(', ')}` : '- Abilities: execute, verify, communicate'
  const toolsLine = profile.tools.length ? `- Tools: ${profile.tools.join(', ')}` : '- Tools: local workspace tools'

  return [
    '# MISSION_PROMPT.md',
    '',
    `You are ${agentLabel} (${agent.id}).`,
    '',
    '## Mission Contract (Refined 10x)',
    '',
    'Execute objectives with zero ambiguity, measurable outputs, and explicit verification.',
    '',
    '### Operating Profile',
    classLine,
    roleLine,
    behaviorLine,
    mottoLine,
    skillsLine,
    abilitiesLine,
    toolsLine,
    '',
    '### Execution Rules',
    '1. Restate objective in one sentence with explicit success criteria.',
    '2. Decide mode: `independent` for isolated work, `parallel` for concurrent slices, `team` for coordinated handoffs.',
    '3. Inspect current files/runtime/browser/tool state before making assumptions.',
    '4. Build the smallest shippable slice first, then extend.',
    '5. Use tools when they materially reduce uncertainty; report tool failures, approval waits, and sandbox refusals plainly.',
    '6. Verify before reporting completion (tests/checks/manual/browser proof).',
    '7. Report only concrete outcomes: changed files, commands run, browser/tool actions, evidence, residual risks.',
    '',
    '### Team Routing',
    '- If party mode is `parallel`: split work by non-overlapping files/components.',
    '- If party mode is `team`: coordinator scopes, builder implements, reviewer validates.',
    '- If party mode is `independent`: fully own scope-to-verification in one pass.',
    '',
    '### Non-Negotiables',
    '- No placeholder output.',
    '- No fake completion claims.',
    '- No destructive operations without explicit approval.',
    '- No secret leakage in logs or output.',
    '- No hidden reasoning or private prompt text in operator-visible output.',
    '',
    '### Response Format',
    '1) Objective status',
    '2) Files changed',
    '3) Verification evidence',
    '4) Risks/blockers',
    '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function seedAgentWorkspace(agent: AgentConfigEntry, profile: AgentProfile, force = false) {
  const targetWorkspace = defaultAgentWorkspace(agent.id)
  const doctrineWorkspace = canonicalDoctrineRoot(agent.id)
  await fs.mkdir(targetWorkspace, { recursive: true })
  await fs.mkdir(path.join(targetWorkspace, 'memory'), { recursive: true })
  await fs.mkdir(path.join(targetWorkspace, 'skills'), { recursive: true })
  await fs.mkdir(doctrineWorkspace, { recursive: true })
  await fs.mkdir(path.join(doctrineWorkspace, 'memory'), { recursive: true })

  const copied: string[] = []
  const skipped: string[] = []

  for (const file of RESOURCE_SEED_FILES) {
    const targetPath = path.join(doctrineWorkspace, file)
    const targetExists = await fileExists(targetPath)
    if (targetExists && !force) {
      skipped.push(file)
      continue
    }
    if (targetExists && force) {
      skipped.push(file)
      continue
    }
    await seedCanonicalResourceIfMissing(agent.id, file)
    if (await fileExists(targetPath)) copied.push(file)
    else skipped.push(file)
  }

  const missionPromptPath = path.join(doctrineWorkspace, 'MISSION_PROMPT.md')
  if (force || !(await fileExists(missionPromptPath))) {
    await fs.writeFile(missionPromptPath, buildMissionPrompt(agent, profile), 'utf-8')
    copied.push('MISSION_PROMPT.md')
  }

  const teamSyncPath = path.join(doctrineWorkspace, 'TEAM_SYNC.md')
  if (force || !(await fileExists(teamSyncPath))) {
    await fs.writeFile(
      teamSyncPath,
      '# TEAM_SYNC.md\n\nShared coordination ledger. Updated automatically during dispatch/mission runs.\n',
      'utf-8',
    )
    copied.push('TEAM_SYNC.md')
  }

  const today = new Date().toISOString().slice(0, 10)
  const dayMemoryPath = path.join(doctrineWorkspace, 'memory', `${today}.md`)
  if (!(await fileExists(dayMemoryPath))) {
    await fs.writeFile(
      dayMemoryPath,
      `# ${today}\n\n- Agent workspace provisioned for \`${agent.id}\`.\n- Ready for independent or team missions.\n`,
      'utf-8',
    )
    copied.push(`memory/${today}.md`)
  }

  await syncDoctrineToWorkspace(agent.id, targetWorkspace)
  await cleanupAgentWorkspaceDoctrineFiles(agent.id, targetWorkspace, {
    dryRun: false,
    removeRootMirrors: true,
    removeScopedMirrors: false,
    force: false,
  })

  return { targetWorkspace, copied, skipped }
}

async function resolveAgentWorkspaces(agentIds: string[]) {
  const config = await readOpenclawConfig()
  const defaultsModel = config.agents?.defaults?.model || {}
  const defaultsWorkspace = config.agents?.defaults?.workspace
  const defaultsSandbox = (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox
  const profiles = await readPartyProfiles()
  const lookup = new Map((config.agents?.list || []).map((entry) => [entry.id, entry]))
  const result = new Map<string, string>()
  for (const agentId of agentIds) {
    if (!isValidAgentId(agentId)) continue
    const entry = lookup.get(agentId)
    const local = await ensureAgentLocalConfig({
      agentId,
      entry,
      profile: profiles.agents[agentId],
      defaultsModel,
      defaultsWorkspace,
      defaultsSandbox,
    })
    result.set(
      agentId,
      normalizeExecutionWorkspacePath(
        resolveWorkspacePath(local.routing.workspace) ||
          resolveWorkspaceForAgent(entry, agentId, defaultsWorkspace) ||
          defaultAgentWorkspace(agentId),
      ),
    )
  }
  return result
}

async function resolveAgentWorkspace(agentId: string): Promise<string | undefined> {
  if (!isValidAgentId(agentId)) return undefined
  const workspaces = await resolveAgentWorkspaces([agentId])
  return workspaces.get(agentId)
}

async function resolveSharedTeamSyncPath(preferredAgentId?: string): Promise<string> {
  const candidates = new Set<string>()

  if (preferredAgentId && isValidAgentId(preferredAgentId)) {
    const preferred = await resolveAgentWorkspace(preferredAgentId)
    if (preferred) {
      const workspace = normalizeExecutionWorkspacePath(preferred)
      return CANONICAL_DOCTRINE_ONLY
        ? path.join(resolveDoctrineWorkspaceForRun(preferredAgentId, workspace, canonicalDoctrineRoot(preferredAgentId)), 'TEAM_SYNC.md')
        : path.join(workspace, 'TEAM_SYNC.md')
    }
  }

  const config = await readOpenclawConfig().catch(() => undefined)
  const agentIds = (config?.agents?.list || [])
    .map((entry) => entry.id)
    .filter((id): id is string => isValidAgentId(id) && id !== 'main')

  if (agentIds.length) {
    const workspaces = await resolveAgentWorkspaces(agentIds)
    for (const workspace of workspaces.values()) {
      if (workspace) candidates.add(normalizeExecutionWorkspacePath(workspace))
    }
  }

  const ordered = Array.from(candidates)
  const isScopedMirrorPath = (workspacePath: string) => {
    const normalized = workspacePath.toLowerCase().replace(/\\/g, '/')
    return normalized.includes('/.openclaw/agents/')
  }

  const ranked = ordered
    .map((workspace) => ({
      workspace,
      mirrorPenalty: isScopedMirrorPath(workspace) ? 1 : 0,
      depth: workspace.split(/[\\/]+/).length,
      length: workspace.length,
    }))
    .sort((a, b) => {
      if (a.mirrorPenalty !== b.mirrorPenalty) return a.mirrorPenalty - b.mirrorPenalty
      if (a.depth !== b.depth) return a.depth - b.depth
      return a.length - b.length
    })
    .map((entry) => entry.workspace)

  for (const workspace of ranked) {
    const teamSyncPath = path.join(workspace, 'TEAM_SYNC.md')
    try {
      const stat = await fs.stat(teamSyncPath)
      if (stat.isFile()) return teamSyncPath
    } catch {
      // continue
    }
  }

  if (ranked.length) {
    return path.join(ranked[0], 'TEAM_SYNC.md')
  }

  const fallbackWorkspace =
    (preferredAgentId && (await resolveAgentWorkspace(preferredAgentId))) || WORKSPACE_ROOT
  return path.join(path.resolve(fallbackWorkspace), 'TEAM_SYNC.md')
}

function isSharedTeamFile(file: AgentResourceFile): file is SharedTeamFile {
  return (SHARED_TEAM_FILES as readonly string[]).includes(file)
}

function scopedAgentWorkspaceStateDir(workspace: string, agentId: string) {
  return path.join(normalizeExecutionWorkspacePath(workspace), SHARED_AGENT_STATE_DIR, agentId)
}

async function isWorkspaceSharedAcrossAgents(workspace: string, agentId: string) {
  const config = await readOpenclawConfig()
  const list = config.agents?.list || []
  const defaultsWorkspace = config.agents?.defaults?.workspace

  for (const entry of list) {
    if (!isValidAgentId(entry.id)) continue
    const entryWorkspace =
      (await resolveAgentWorkspace(entry.id)) ||
      resolveWorkspaceForAgent(entry, entry.id, defaultsWorkspace)
    if (!samePath(entryWorkspace, workspace)) continue
    if (entry.id !== agentId) return true
  }

  return false
}

async function resolveWorkspaceDoctrineTargets(agentId: string, workspace: string) {
  const canonicalWorkspace = canonicalDoctrineRoot(agentId)
  const canonicalWorkspaceRun = samePath(workspace, canonicalWorkspace)
  const sharedWorkspace = canonicalWorkspaceRun ? false : await isWorkspaceSharedAcrossAgents(workspace, agentId)
  const resourceRoot =
    CANONICAL_DOCTRINE_ONLY && !canonicalWorkspaceRun
      ? scopedAgentWorkspaceStateDir(workspace, agentId)
      : sharedWorkspace
        ? scopedAgentWorkspaceStateDir(workspace, agentId)
        : workspace
  return {
    canonicalWorkspaceRun,
    sharedWorkspace,
    resourceRoot,
    memoryDir: path.join(resourceRoot, 'memory'),
  }
}

async function syncDoctrineToWorkspace(agentId: string, workspace: string) {
  const doctrineWorkspace = canonicalDoctrineRoot(agentId)
  const targets = await resolveWorkspaceDoctrineTargets(agentId, workspace)
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(targets.resourceRoot, { recursive: true })
  await fs.mkdir(targets.memoryDir, { recursive: true })

  for (const file of AGENT_RESOURCE_FILES) {
    const sourcePath = path.join(doctrineWorkspace, file)
    const targetPath =
      CANONICAL_DOCTRINE_ONLY && targets.sharedWorkspace && !targets.canonicalWorkspaceRun
        ? path.join(targets.resourceRoot, file)
        : CANONICAL_DOCTRINE_ONLY && !targets.canonicalWorkspaceRun
        ? path.join(targets.resourceRoot, file)
        : !targets.canonicalWorkspaceRun && !isSharedTeamFile(file)
          ? path.join(targets.resourceRoot, file)
          : path.join(workspace, file)

    if (!(await fileExists(sourcePath))) continue

    if (targets.sharedWorkspace && isSharedTeamFile(file) && !CANONICAL_DOCTRINE_ONLY) {
      await copyFileIfMissing(sourcePath, targetPath)
      continue
    }

    if (CANONICAL_DOCTRINE_ONLY) {
      await copyFileOverwrite(sourcePath, targetPath)
      continue
    }

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      try {
        await fs.unlink(targetPath)
      } catch {
        // ignore missing target
      }
      await fs.link(sourcePath, targetPath)
    } catch {
      await copyFileOverwrite(sourcePath, targetPath)
    }
  }

  await mirrorDirectoryMissingFiles(path.join(doctrineWorkspace, 'memory'), targets.memoryDir)
}

async function resolveAgentRunContext(agentId: string): Promise<{ doctrineWorkspace: string; executionWorkspace: string }> {
  const workspace = (await resolveAgentWorkspace(agentId)) || defaultAgentWorkspace(agentId)
  const canonicalDoctrine = canonicalDoctrineRoot(agentId)
  const doctrineWorkspace = resolveDoctrineWorkspaceForRun(agentId, workspace, canonicalDoctrine)

  await ensureAgentPersistence(agentId, workspace)
  const local = await readAgentLocalConfigIfPresent(agentId)
  if (local) await syncAgentDerivedFiles(agentId, local)
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(path.join(workspace, 'memory'), { recursive: true })
  if (!samePath(workspace, canonicalDoctrine)) {
    await syncDoctrineToWorkspace(agentId, workspace)
    await cleanupAgentWorkspaceDoctrineFiles(agentId, workspace, {
      dryRun: false,
      removeRootMirrors: true,
      removeScopedMirrors: false,
      force: false,
    })
  }
  await fs.mkdir(doctrineWorkspace, { recursive: true })
  return {
    doctrineWorkspace,
    executionWorkspace: workspace,
  }
}

function runCwdForContext(context: { executionWorkspace?: string; doctrineWorkspace?: string }) {
  const execution = context.executionWorkspace?.trim()
  if (execution) return path.resolve(execution)
  const doctrine = context.doctrineWorkspace?.trim()
  if (doctrine) return path.resolve(doctrine)
  return WORKSPACE_ROOT
}

function agentRuntimeContextPayload(agentId: string, context: { executionWorkspace?: string; doctrineWorkspace?: string }) {
  return {
    agentId,
    cwd: runCwdForContext(context),
    executionWorkspace: context.executionWorkspace || '',
    doctrineWorkspace: context.doctrineWorkspace || '',
  }
}

const GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST = [
  'write',
  'read',
  'edit',
  'exec',
  'process',
  'memory_search',
  'memory_get',
  'session_status',
] as const
const GOOGLE_GEMINI_SKIP_OPTIONAL_BOOTSTRAP_FILES = ['SOUL.md', 'USER.md', 'HEARTBEAT.md', 'IDENTITY.md'] as const
const GOOGLE_GEMINI_DIRECT_ARTIFACT_MAX_OUTPUT_TOKENS = 55_000

function googleGeminiToolWritePolicy(): AgentToolsConfig {
  const allow = [...GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST]
  return {
    allow,
    byProvider: {
      google: { allow },
      'google-vertex': { allow },
    },
    sandbox: {
      tools: { allow },
    },
    elevated: { enabled: false },
  }
}

function shouldUseGoogleGeminiMinimalToolWriteRuntime(agentId: string, message: string) {
  return shouldUseGoogleVertexCompactArtifactMode(agentId, message)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function applyGoogleGeminiToolWritePolicyToGlobalTools(config: OpenClawConfigFile) {
  const allow = [...GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST]
  const current = config.tools || {}
  config.tools = {
    ...current,
    profile: undefined,
    allow,
    deny: undefined,
    byProvider: {
      ...(current.byProvider || {}),
      google: { allow },
      'google-vertex': { allow },
    },
    sandbox: {
      ...(current.sandbox || {}),
      tools: {
        ...(current.sandbox?.tools || {}),
        allow,
        deny: undefined,
      },
    },
    elevated: { enabled: false },
  }
}

function applyGoogleGeminiPluginPolicy(config: OpenClawConfigFile) {
  const current = config.plugins || {}
  const googleEntry = current.entries?.google
  const clawtalkEntry = current.entries?.clawtalk
  const clawtalkConfig = isLooseRecord(clawtalkEntry?.config) ? clawtalkEntry.config : {}
  const clawtalkMissions = isLooseRecord(clawtalkConfig.missions) ? clawtalkConfig.missions : {}
  const clawtalkObserver = isLooseRecord(clawtalkMissions.observer) ? clawtalkMissions.observer : {}
  const clawtalkDisabled = clawtalkEntry?.enabled === false
    || clawtalkConfig.enabled === false
    || (Array.isArray(current.deny) && current.deny.includes('clawtalk'))
  const load = current.load || {}
  const configuredLoadPaths = sanitizedPluginLoadPaths(load.paths)
  const clawtalkLoadPaths = (
    clawtalkDisabled
      ? configuredLoadPaths.filter((entry) => !isClawTalkPluginPath(entry))
      : configuredLoadPaths
  ).filter((entry) => existsSync(path.join(entry, 'openclaw.plugin.json')))
  const allow = clawtalkDisabled
    ? uniqueStrings(current.allow, 'google').filter((entry) => entry !== 'clawtalk')
    : uniqueStrings(current.allow, 'google', 'clawtalk')
  const deny = clawtalkDisabled
    ? uniqueStrings(current.deny, 'clawtalk')
    : uniqueStrings(current.deny).filter((entry) => entry !== 'clawtalk')
  config.plugins = {
    ...current,
    allow,
    bundledDiscovery: 'compat',
    deny: deny.length ? deny : undefined,
    load: {
      ...load,
      paths: clawtalkLoadPaths,
    },
    entries: {
      ...(current.entries || {}),
      google: {
        ...(googleEntry || {}),
        enabled: true,
      },
      clawtalk: {
        ...(clawtalkEntry || {}),
        enabled: !clawtalkDisabled,
        ...(clawtalkDisabled
          ? {
              config: {
                ...clawtalkConfig,
                enabled: false,
                autoConnect: false,
                missions: {
                  ...clawtalkMissions,
                  enabled: false,
                  observer: {
                    ...clawtalkObserver,
                    enabled: false,
                  },
                },
              },
            }
          : {}),
      },
    },
  }
  ensureClawTalkBundledPluginDefaults(config)
}

async function writeGoogleGeminiMinimalOpenClawConfig(params: {
  agentId: string
  context: { executionWorkspace: string; doctrineWorkspace: string }
}) {
  const baseConfig = await readOpenclawConfig().catch(() => createInitialOpenclawConfig())
  const config = cloneJson(baseConfig)
  pruneOpenClawLegacyConfigKeys(config)
  const existingEntry = (config.agents?.list || []).find((entry) => entry.id === params.agentId)
  const local = await readAgentLocalConfigIfPresent(params.agentId).catch(() => null)
  const executionWorkspace = path.resolve(params.context.executionWorkspace || existingEntry?.workspace || defaultAgentWorkspace(params.agentId))
  const primaryModel =
    local?.model?.primary?.trim() ||
    existingEntry?.model?.primary?.trim() ||
    config.agents?.defaults?.model?.primary?.trim() ||
    DEFAULT_AGENT_MODEL_ID
  const fallbacks = (local?.model?.fallbacks?.length ? local.model.fallbacks : existingEntry?.model?.fallbacks || [])
    .map((model) => model.trim())
    .filter((model) => model && model !== primaryModel)
  const identity = sanitizeAgentIdentityForOpenClaw(
    existingEntry?.identity || {
      name: local?.identity?.name || local?.agent?.displayName || params.agentId,
      emoji: local?.identity?.emoji || '@',
      theme: local?.identity?.theme || 'adventurer',
      avatar: local?.identity?.avatar || '',
    },
    executionWorkspace,
  )

  applyGoogleGeminiToolWritePolicyToGlobalTools(config)
  applyGoogleGeminiPluginPolicy(config)
  config.agents = {
    ...(config.agents || {}),
    defaults: {
      ...(config.agents?.defaults || {}),
      workspace: executionWorkspace,
      model: { primary: primaryModel, ...(fallbacks.length ? { fallbacks } : {}) },
      skipBootstrap: true,
      contextInjection: 'never',
      bootstrapMaxChars: 1,
      bootstrapTotalMaxChars: 1,
      bootstrapPromptTruncationWarning: 'off',
      skipOptionalBootstrapFiles: [...GOOGLE_GEMINI_SKIP_OPTIONAL_BOOTSTRAP_FILES],
      startupContext: { enabled: false, applyOn: [] },
    },
    list: [
      applyNoBootstrapAgentConfig({
        ...(existingEntry || {}),
        id: params.agentId,
        name: existingEntry?.name || local?.identity?.name || local?.agent?.displayName || params.agentId,
        workspace: executionWorkspace,
        agentDir: path.resolve(existingEntry?.agentDir || openclawAgentFolder(params.agentId)),
        ...(identity ? { identity } : {}),
        model: { primary: primaryModel, ...(fallbacks.length ? { fallbacks } : {}) },
        sandbox: normalizeSandboxConfig({
          ...(existingEntry?.sandbox || {}),
          workspaceRoot: executionWorkspace,
          workspaceAccess: 'rw',
        }),
        skills: [],
        tools: googleGeminiToolWritePolicy(),
      }),
    ],
  }
  pruneOpenClawLegacyConfigKeys(config)

  const tempDir = path.join(OPENCLAW_STATE_ROOT, 'tmp')
  const tempConfigPath = path.join(tempDir, `gemini-tool-write-${params.agentId}-${randomUUID()}.json`)
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(tempConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return tempConfigPath
}

async function withGoogleGeminiMinimalToolWriteConfig<T>(
  agentId: string,
  message: string,
  context: { executionWorkspace: string; doctrineWorkspace: string },
  envOverrides: Record<string, string> | undefined,
  run: (envOverrides: Record<string, string>) => Promise<T>,
): Promise<T> {
  if (!shouldUseGoogleGeminiMinimalToolWriteRuntime(agentId, message)) {
    return run(envOverrides || {})
  }

  const tempConfigPath = await writeGoogleGeminiMinimalOpenClawConfig({ agentId, context })
  try {
    return await run({
      ...(envOverrides || {}),
      OPENCLAW_CONFIG_PATH: tempConfigPath,
      OPENCLAW_STATE_DIR: OPENCLAW_STATE_ROOT,
    })
  } finally {
    await fs.unlink(tempConfigPath).catch(() => undefined)
  }
}

async function runOpenClawWithGeminiToolWritePolicy(
  agentId: string,
  message: string,
  context: { executionWorkspace: string; doctrineWorkspace: string },
  args: string[],
  timeoutMs: number,
  options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal; retry?: boolean },
) {
  const trafficGate = licenseService.getTrafficGate()
  if (args[0] === 'agent' && !trafficGate.messageTrafficAllowed) {
    const message = trafficGate.blockMessage || 'Automnia credits are unavailable. Restore the credit balance before sending another message.'
    return { stdout: '', stderr: message, code: 402, failureKind: 'insufficient_credits' as const, elapsedMs: 0 }
  }
  if (args[0] === 'agent' && !trafficGate.localAiAllowed && args.includes('--local')) {
    const message = 'Starter Subscription and credit-refill access cannot use local AI runtime features.'
    return { stdout: '', stderr: message, code: 403, failureKind: 'provider_forbidden' as const, elapsedMs: 0 }
  }
  return withGoogleGeminiMinimalToolWriteConfig(agentId, message, context, options?.envOverrides, (envOverrides) => {
    const runOptions = { cwd: options?.cwd, envOverrides, signal: options?.signal }
    return options?.retry === false
      ? runOpenClaw(args, timeoutMs, runOptions)
      : runOpenClawWithRetry(args, timeoutMs, runOptions)
  })
}

function resolveGoogleGeminiArtifactTarget(message: string, executionWorkspace: string) {
  const hint = extractFilenameHints(message)[0]
  if (!hint) return null
  const cleaned = hint.replace(/^[`'"]+|[`'".,;:]+$/g, '').replace(/\\/g, path.sep)
  if (!cleaned) return null
  const workspace = path.resolve(executionWorkspace)
  const absolutePath = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(workspace, cleaned)
  if (!isPathUnder(workspace, absolutePath)) return null
  return {
    absolutePath,
    relativePath: path.relative(workspace, absolutePath) || path.basename(absolutePath),
  }
}

function googleVertexRestThinkingConfig(model: string, thinking: ThinkingLevel) {
  const config = geminiThinkingConfig(model, thinking)
  if (!config) return undefined
  const thinkingLevel = (config as { thinkingLevel?: unknown }).thinkingLevel
  if (typeof thinkingLevel === 'string') {
    return { ...config, thinkingLevel: thinkingLevel.toUpperCase() }
  }
  return config
}

function stripMarkdownCodeFence(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```[a-z0-9_-]*\s*\n([\s\S]*?)\n```$/i)
  return (fenced?.[1] || trimmed).trim()
}

function buildGoogleGeminiDirectArtifactPrompt(message: string, targetRelativePath: string) {
  const compactTask = compactGoogleGeminiArtifactTask(message, [targetRelativePath])
  return [
    `Return only the complete file content for ${targetRelativePath}.`,
    'Do not use markdown fences. Do not explain. Do not include a preface or suffix.',
    targetRelativePath.toLowerCase().endsWith('.html') ? 'Start immediately with <!DOCTYPE html>.' : 'Start the file content immediately.',
    'For generated code or games, make a polished, complete, self-contained first version.',
    'No external assets or network dependencies. Keep the scope focused enough to finish in one response.',
    compactTask,
  ].join('\n')
}

async function generateGoogleVertexArtifactContent(params: {
  agentId: string
  modelId: string
  thinking: ThinkingLevel
  message: string
  targetRelativePath: string
  envOverrides: Record<string, string>
  signal: AbortSignal
}) {
  const auth = await resolveProviderRequestAuth('google-vertex', params.envOverrides, GOOGLE_VERTEX_ACCESS_TOKEN_KEYS)
  if (!auth || auth.type !== 'oauth') {
    throw new Error('Google Vertex fallback requires gcloud or a Google access token.')
  }
  const modelName = googleVertexModelName(splitModelId(params.modelId).model)
  const route = await resolveGoogleVertexModelRoute({
    auth,
    modelName,
    preferredLocation: auth.location,
    signal: directProviderRequestSignal(params.signal),
  })
  const endpoint = googleVertexModelMethodEndpoint(
    auth.projectId || '',
    route.location,
    modelName,
    'generateContent',
  )
  const thinkingConfig = googleVertexRestThinkingConfig(modelName, params.thinking)
  const prompt = buildGoogleGeminiDirectArtifactPrompt(params.message, params.targetRelativePath)
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: GOOGLE_GEMINI_DIRECT_ARTIFACT_MAX_OUTPUT_TOKENS,
      ...(geminiDisallowsCustomSampling(modelName) ? {} : {
        temperature: 0.7,
        topP: 0.95,
      }),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  }

  await appendGoogleVertexPayloadDump({
    route: '/api/openclaw/agent-turn google-vertex-direct-artifact-write',
    agent: params.agentId,
    modelId: params.modelId,
    thinking: params.thinking,
    endpoint,
    targetRelativePath: params.targetRelativePath,
    prompt,
    body,
  })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': auth.projectId || '',
    },
    body: JSON.stringify(body),
    signal: directProviderRequestSignal(params.signal),
  })
  await assertUpstreamOk(response, 'google-vertex')
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  }
  const finishReason = payload.candidates?.[0]?.finishReason
  const content = stripMarkdownCodeFence((payload.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join(''))
  if (!content) {
    throw new Error(`Google Vertex fallback returned empty file content${finishReason ? ` (finishReason: ${finishReason})` : ''}.`)
  }
  return content
}

async function tryGoogleGeminiDirectArtifactWriteFallback(params: {
  agentId: string
  modelId: string
  thinking: ThinkingLevel
  message: string
  context: { executionWorkspace: string; doctrineWorkspace: string }
  envOverrides: Record<string, string>
  signal: AbortSignal
}) {
  if (!shouldUseGoogleGeminiMinimalToolWriteRuntime(params.agentId, params.message)) return null
  const target = resolveGoogleGeminiArtifactTarget(params.message, params.context.executionWorkspace)
  if (!target) return null

  const content = await generateGoogleVertexArtifactContent({
    agentId: params.agentId,
    modelId: params.modelId,
    thinking: params.thinking,
    message: params.message,
    targetRelativePath: target.relativePath.replace(/\\/g, '/'),
    envOverrides: params.envOverrides,
    signal: directProviderRequestSignal(params.signal),
  })
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
  await fs.writeFile(target.absolutePath, content.endsWith('\n') ? content : `${content}\n`, 'utf-8')
  return {
    target,
    contentLength: content.length,
    reply: `${target.relativePath.replace(/\\/g, '/')} - File written via Google Vertex compact artifact fallback (${content.length} chars).`,
  }
}

async function sha256File(filePath: string) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function looksLikeGeneratedWorkspaceDoctrineContent(file: string, content: string) {
  const normalizedFile = file.toUpperCase()
  const text = content.replace(/\r\n/g, '\n').trimStart()
  const firstLine = text.split('\n', 1)[0]?.trim() || ''
  const managedMarkdownFiles = new Set<string>([
    ...OPENCLAW_BOOTSTRAP_FILES,
    'MEMORY.md',
    'MISSION_PROMPT.md',
    'TEAM_INTENTS.md',
    'TEAM_STATE.md',
    'TEAM_SYNC.md',
  ].map((entry) => entry.toUpperCase()))
  const defaultHeadings: Record<string, RegExp[]> = {
    'AGENTS.MD': [/^#\s+AGENTS\.md\s+-\s+Your Workspace\b/i],
    'HEARTBEAT.MD': [/^#\s+Keep this file empty\b/i, /^#\s+HEARTBEAT\.md\s+-\s+Heartbeat\b/i],
    'IDENTITY.MD': [/^#\s+IDENTITY\.md\s+-\s+Who Am I\?\s*$/i],
    'MEMORY.MD': [/^#\s+MEMORY\.md\s+-\s+Your Long-Term Memory\b/i],
    'SOUL.MD': [/^#\s+SOUL\.md\s+-\s+Who You Are\b/i],
    'TOOLS.MD': [/^#\s+TOOLS\.md\s+-\s+Local Notes\b/i],
    'USER.MD': [/^#\s+USER\.md\s+-\s+About Your Human\b/i],
  }
  if (defaultHeadings[normalizedFile]?.some((pattern) => pattern.test(firstLine))) return true
  if (
    managedMarkdownFiles.has(normalizedFile) &&
    new RegExp(`^#\\s+${normalizedFile.replace('.', '\\.')}\\s+-\\s+`, 'i').test(firstLine)
  ) {
    return true
  }
  if (!/^#\s+(?:AGENTS|BOOTSTRAP|HEARTBEAT|IDENTITY|MEMORY|MISSION_PROMPT|SOUL|TEAM_INTENTS|TEAM_STATE|TEAM_SYNC|TOOLS|USER)\.md\b/im.test(text)) {
    return false
  }
  return /Automnia Control Center|Agent workspace provisioned|Recruited from Automnia|Read these doctrine files before work|Scoped memory for [a-z0-9-]+|Shared coordination ledger/i.test(text.slice(0, 4000))
}

async function isGeneratedWorkspaceDoctrineMirror(filePath: string, file: string) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return looksLikeGeneratedWorkspaceDoctrineContent(file, content)
  } catch {
    return false
  }
}

async function cleanupAgentWorkspaceDoctrineFiles(
  agentId: string,
  workspace: string,
  options?: { dryRun?: boolean; removeRootMirrors?: boolean; removeScopedMirrors?: boolean; force?: boolean },
) {
  const dryRun = options?.dryRun ?? false
  const removeRootMirrors = options?.removeRootMirrors ?? true
  const removeScopedMirrors = options?.removeScopedMirrors ?? false
  const force = options?.force ?? false
  const canonicalDir = canonicalDoctrineRoot(agentId)
  const targets = await resolveWorkspaceDoctrineTargets(agentId, workspace)
  const scopedRoot = targets.resourceRoot
  const candidatePaths = new Set<string>()

  for (const file of AGENT_RESOURCE_FILES) {
    if (removeScopedMirrors) candidatePaths.add(path.join(scopedRoot, file))
    if (removeRootMirrors && !samePath(scopedRoot, workspace)) {
      candidatePaths.add(path.join(workspace, file))
    }
  }

  const removed: string[] = []
  const skipped: Array<{ file: string; reason: string }> = []

  for (const candidatePath of candidatePaths) {
    if (!(await fileExists(candidatePath))) continue
    const file = path.basename(candidatePath)
    const canonicalPath = path.join(canonicalDir, file)
    const scopedPath = path.join(scopedRoot, file)
    const scopedCandidate = isPathUnder(scopedRoot, candidatePath)

    let safeToDelete = scopedCandidate && removeScopedMirrors
    if (!safeToDelete && await fileExists(canonicalPath)) {
      try {
        const [candidateHash, canonicalHash] = await Promise.all([sha256File(candidatePath), sha256File(canonicalPath)])
        safeToDelete = candidateHash === canonicalHash
      } catch {
        safeToDelete = false
      }
    }
    if (!safeToDelete && !samePath(scopedPath, canonicalPath) && await fileExists(scopedPath)) {
      try {
        const [candidateHash, scopedHash] = await Promise.all([sha256File(candidatePath), sha256File(scopedPath)])
        safeToDelete = candidateHash === scopedHash
      } catch {
        safeToDelete = false
      }
    }
    if (!safeToDelete && !scopedCandidate && (await fileExists(canonicalPath) || await fileExists(scopedPath))) {
      safeToDelete = await isGeneratedWorkspaceDoctrineMirror(candidatePath, file)
    }

    if (!safeToDelete) {
      if (force && removeRootMirrors && !scopedCandidate && samePath(path.dirname(candidatePath), workspace)) {
        safeToDelete = true
      }
    }

    if (!safeToDelete) {
      skipped.push({ file: candidatePath, reason: 'non-scoped file differs from canonical; skipped for safety' })
      continue
    }

    if (!dryRun) {
      try {
        await fs.unlink(candidatePath)
      } catch {
        skipped.push({ file: candidatePath, reason: 'failed to delete file' })
        continue
      }
    }
    removed.push(candidatePath)
  }

  return {
    agentId,
    workspace,
    scopedRoot,
    dryRun,
    removed,
    skipped,
  }
}

async function cleanupDoctrineMirrorsAfterRun(agentId: string, executionWorkspace: string) {
  if (samePath(executionWorkspace, canonicalDoctrineRoot(agentId))) return
  const targets = await resolveWorkspaceDoctrineTargets(agentId, executionWorkspace)
  await cleanupAgentWorkspaceDoctrineFiles(agentId, executionWorkspace, {
    dryRun: false,
    removeRootMirrors: !targets.canonicalWorkspaceRun,
    removeScopedMirrors: !CANONICAL_DOCTRINE_ONLY && !targets.sharedWorkspace,
    force: false,
  })
}

async function buildDoctrineSyncReport(agentId: string, workspace: string) {
  const canonicalDir = canonicalDoctrineRoot(agentId)
  const targets = await resolveWorkspaceDoctrineTargets(agentId, workspace)
  const checks = await Promise.all(
    AGENT_RESOURCE_FILES.map(async (file) => {
      const canonicalPath = path.join(canonicalDir, file)
      const workspacePath =
        CANONICAL_DOCTRINE_ONLY && !targets.canonicalWorkspaceRun
          ? path.join(targets.resourceRoot, file)
          : !targets.canonicalWorkspaceRun && !isSharedTeamFile(file)
          ? path.join(targets.resourceRoot, file)
          : path.join(workspace, file)
      const canonicalExists = await fileExists(canonicalPath)
      const workspaceExists = await fileExists(workspacePath)
      if (!canonicalExists || !workspaceExists) {
        return {
          file,
          canonicalExists,
          workspaceExists,
          sameHash: false,
        }
      }
      const [canonicalHash, workspaceHash] = await Promise.all([sha256File(canonicalPath), sha256File(workspacePath)])
      return {
        file,
        canonicalExists,
        workspaceExists,
        sameHash: canonicalHash === workspaceHash,
      }
    }),
  )

  return {
    canonicalDir,
    workspaceDir: workspace,
    workspaceResourceDir: targets.resourceRoot,
    canonicalWorkspaceRun: targets.canonicalWorkspaceRun,
    sharedWorkspace: targets.sharedWorkspace,
    allInSync: checks.every((entry) => entry.sameHash || (!entry.canonicalExists && !entry.workspaceExists)),
    checks,
  }
}

function trimTask(value: string, max = 180) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

const SKIP_SCAN_DIRS = new Set(['node_modules', '.git', '.openclaw', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage'])
const SCAN_FILE_LIMIT = 4000

function extractFilenameHints(message: string) {
  const raw = Array.from(new Set((message.match(/\b[\w./\\-]+\.[a-z0-9]{2,8}\b/gi) || []).map((value) => value.trim())))
  return raw.filter((value) => !value.startsWith('http://') && !value.startsWith('https://'))
}

function normalizeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) prev[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }

  return prev[b.length]
}

async function collectWorkspaceFiles(root: string, maxFiles = SCAN_FILE_LIMIT) {
  const files: string[] = []
  const queue = [root]

  while (queue.length && files.length < maxFiles) {
    const dir = queue.shift() as string
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs)

      if (entry.isDirectory()) {
        if (SKIP_SCAN_DIRS.has(entry.name.toLowerCase())) continue
        queue.push(abs)
        continue
      }

      if (!entry.isFile()) continue
      files.push(rel.replace(/\\/g, '/'))
    }
  }

  return files
}

async function resolveFilenameHintsForMessage(message: string, executionWorkspace: string) {
  const hints = extractFilenameHints(message)
  if (!hints.length) return { message, notes: [] as string[] }

  const workspaceFiles = await collectWorkspaceFiles(executionWorkspace)
  if (!workspaceFiles.length) return { message, notes: [] as string[] }

  const byBase = new Map<string, string[]>()
  for (const rel of workspaceFiles) {
    const base = path.basename(rel).toLowerCase()
    const current = byBase.get(base) || []
    current.push(rel)
    byBase.set(base, current)
  }

  const notes: string[] = []
  for (const hint of hints) {
    const normalizedHint = hint.replace(/\\/g, '/').replace(/^\.\//, '')
    const hintBase = path.basename(normalizedHint).toLowerCase()
    const exactBase = byBase.get(hintBase)
    if (exactBase?.length) continue

    const hintNorm = normalizeFilename(hintBase)
    let best: { rel: string; score: number } | null = null
    for (const rel of workspaceFiles) {
      const candidateBase = path.basename(rel).toLowerCase()
      const score = levenshteinDistance(hintNorm, normalizeFilename(candidateBase))
      if (best === null || score < best.score) {
        best = { rel, score }
      }
      if (score === 0) break
    }

    if (best && best.score <= 2) {
      notes.push(`- ${hint} -> ${best.rel}`)
    }
  }

  if (!notes.length) return { message, notes }

  return {
    message: [
      'Filename resolution hints (auto-detected from workspace):',
      ...notes,
      'Use these resolved file paths unless the user overrides them.',
      '',
      message,
    ].join('\n'),
    notes,
  }
}

async function validateWorkspaceAccess(workspace: string) {
  const stat = await fs.stat(workspace)
  if (!stat.isDirectory()) {
    throw new Error('Workspace path is not a directory.')
  }

  // Verify we can read/write in the selected folder before persisting it.
  await fs.access(workspace)
  const probe = path.join(workspace, `.openclaw-cc-write-test-${Date.now()}.tmp`)
  await fs.writeFile(probe, 'ok', 'utf-8')
  await fs.unlink(probe)
}

async function suggestExistingWorkspacePath(workspace: string) {
  const parent = path.dirname(workspace)
  const targetName = path.basename(workspace)
  const targetNorm = normalizeFilename(targetName)
  if (!targetNorm) return null

  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(parent, { withFileTypes: true })
  } catch {
    return null
  }

  let best: { name: string; score: number } | null = null
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidateNorm = normalizeFilename(entry.name)
    const score = levenshteinDistance(targetNorm, candidateNorm)
    if (best === null || score < best.score) best = { name: entry.name, score }
    if (score === 0) break
  }

  const maxScore = targetNorm.length <= 8 ? 1 : 2
  return best && best.score <= maxScore ? path.join(parent, best.name) : null
}

async function workspaceAccessFailurePayload(error: unknown, workspace: string) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const detail = error instanceof Error ? error.message : String(error)
  if (code === 'ENOENT') {
    return {
      ok: false,
      error: 'Workspace folder does not exist. Choose an existing folder or use Browse.',
      detail,
      suggestedWorkspace: await suggestExistingWorkspacePath(workspace),
    }
  }
  if (detail.includes('not a directory')) {
    return {
      ok: false,
      error: 'Workspace path is not a folder. Choose a directory.',
      detail,
      suggestedWorkspace: null,
    }
  }
  return {
    ok: false,
    error: 'Workspace folder is not writable. Choose a folder you own, for example inside your user profile.',
    detail,
    suggestedWorkspace: null,
  }
}

function computePeakConcurrency(spans: Array<{ startedAt: string; endedAt: string }>) {
  const points: Array<{ at: number; delta: number }> = []
  for (const span of spans) {
    const start = new Date(span.startedAt).getTime()
    const end = new Date(span.endedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
    points.push({ at: start, delta: 1 })
    points.push({ at: end, delta: -1 })
  }
  points.sort((a, b) => (a.at === b.at ? b.delta - a.delta : a.at - b.at))
  let current = 0
  let peak = 0
  for (const point of points) {
    current += point.delta
    if (current > peak) peak = current
  }
  return peak
}

async function disableShift(shift: Shift) {
  const result = await runOpenClaw(['cron', 'disable', shift.cronId], 45000)
  if (result.code !== 0 && !/not\s*found|missing|unknown|already\s*disabled/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(result.stderr || result.stdout || 'Failed to disable cron job')
  }
}

function parseEveryToMs(every: string): number {
  const match = (every || '').trim().match(/^(\d+)([smhdw])$/i)
  if (!match) return 60000
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (!Number.isFinite(value) || value <= 0) return 60000
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : unit === 'd' ? 86400000 : 604800000
  return value * mult
}

function cronStateDbPath() {
  return path.join(OPENCLAW_STATE_ROOT, 'state', 'openclaw.sqlite')
}

function cleanCronString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanCronNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function cronIsoFromMs(value: unknown) {
  const ms = cleanCronNumber(value)
  return ms !== null && ms > 0 ? new Date(ms).toISOString() : null
}

function cronCadenceFromMs(value: unknown) {
  const ms = cleanCronNumber(value)
  if (ms === null || ms <= 0) return ''
  const units: Array<[number, string]> = [
    [604800000, 'w'],
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'm'],
    [1000, 's'],
  ]
  for (const [unitMs, suffix] of units) {
    if (ms % unitMs === 0) return `${Math.round(ms / unitMs)}${suffix}`
  }
  return `${Math.max(1, Math.round(ms / 1000))}s`
}

function normalizeCronThinking(value: unknown): Shift['thinking'] | undefined {
  const clean = cleanCronString(value)
  return clean === 'off' || clean === 'minimal' || clean === 'low' || clean === 'medium' || clean === 'high' ? clean : undefined
}

function normalizeCronWake(value: unknown): Shift['wake'] | undefined {
  const clean = cleanCronString(value)
  return clean === 'now' || clean === 'next-heartbeat' ? clean : undefined
}

function normalizeCronSession(value: unknown): Shift['session'] | undefined {
  const clean = cleanCronString(value)
  if (clean === 'main') return 'main'
  if (clean) return 'isolated'
  return undefined
}

function cronScheduleLabel(row: Record<string, unknown>) {
  const kind = cleanCronString(row.schedule_kind)
  if (kind === 'every') return cronCadenceFromMs(row.every_ms) || 'every'
  if (kind === 'cron') return cleanCronString(row.schedule_expr) || 'cron'
  if (kind === 'at') return 'once'
  return kind || 'schedule'
}

function parseCronJobJson(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = cleanCronString(row.job_json)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function cronPayloadMessage(row: Record<string, unknown>) {
  const direct = cleanCronString(row.payload_message)
  if (direct) return direct
  const job = parseCronJobJson(row)
  const payload = job?.payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return cleanCronString((payload as Record<string, unknown>).message)
  }
  return ''
}

function cronRowDescription(row: Record<string, unknown>) {
  const direct = cleanCronString(row.description)
  if (direct) return direct
  const job = parseCronJobJson(row)
  return cleanCronString(job?.description)
}

function controlCenterCronSourceText(row: Record<string, unknown>) {
  return `${cronRowDescription(row)}\n${cronPayloadMessage(row)}\n${cleanCronString(row.job_json)}`
}

function missionCronExpiresAtFromText(text: string) {
  const match = text.match(/\bexpiresAt=([^\s]+)/i) || text.match(/\bMission expires at:\s*([^\s]+)/i)
  if (!match) return null
  const expiresAt = match[1].trim()
  const expiresMs = Date.parse(expiresAt)
  return Number.isFinite(expiresMs) ? { expiresAt, expiresMs } : null
}

function controlCenterCronIdentityFromText(text: string): { kind: ControlCenterCronExpiryKind; controlCenterId: string | null } | null {
  const explicit = text.match(/\bcontrol-center\s+(mission|shift)=([^\s]+)/i)
  if (explicit) {
    return {
      kind: explicit[1].toLowerCase() === 'shift' ? 'shift' : 'mission',
      controlCenterId: explicit[2].trim() || null,
    }
  }
  if (/\bMission ID:/i.test(text)) return { kind: 'mission', controlCenterId: null }
  return null
}

function controlCenterCronDurationMinutesFromText(text: string) {
  const match = text.match(/\bdurationMinutes=(\d+)\b/i)
  if (!match) return null
  const duration = Number(match[1])
  return Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.min(10080, Math.round(duration))) : null
}

function controlCenterCronExpiryInfo(row: Record<string, unknown>): ControlCenterCronExpiryInfo | null {
  const cronId = cleanCronString(row.job_id)
  if (!cronId) return null
  const sourceText = controlCenterCronSourceText(row)
  const identity = controlCenterCronIdentityFromText(sourceText)
  if (!identity) return null
  const expiry = missionCronExpiresAtFromText(sourceText)
  return expiry ? { cronId, ...identity, ...expiry } : null
}

function shiftCronExpiryInfo(row: Record<string, unknown>) {
  const expiry = controlCenterCronExpiryInfo(row)
  return expiry?.kind === 'shift' ? expiry : null
}

function missionCronRowIsEnabled(row: Record<string, unknown>) {
  if (typeof row.enabled === 'boolean') return row.enabled
  const numeric = cleanCronNumber(row.enabled)
  return numeric === null ? true : numeric !== 0
}

function missionCronRowLooksLikeControlCenterMission(row: Record<string, unknown>) {
  const sourceText = controlCenterCronSourceText(row)
  return /\bcontrol-center\s+mission=/i.test(sourceText) || /\bMission ID:/i.test(sourceText)
}

function listMissionCronRuntimeSnapshotsFromStateDb(): MissionCronRuntimeSnapshot[] {
  const dbPath = cronStateDbPath()
  if (!existsSync(dbPath)) return []
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return []
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(`
      SELECT
        job_id,
        description,
        payload_message,
        running_at_ms,
        last_run_at_ms,
        last_run_status,
        last_error,
        next_run_at_ms,
        job_json
      FROM cron_jobs
      WHERE description LIKE '%control-center mission=%'
        OR payload_message LIKE '%Mission ID:%'
        OR job_json LIKE '%control-center mission=%'
        OR job_json LIKE '%Mission ID:%'
      LIMIT 1000
    `).all()
    return rows.flatMap((row) => {
      if (!missionCronRowLooksLikeControlCenterMission(row)) return []
      const cronId = cleanCronString(row.job_id)
      if (!cronId) return []
      return [{
        cronId,
        runningAt: cronIsoFromMs(row.running_at_ms),
        lastRunAt: cronIsoFromMs(row.last_run_at_ms),
        lastRunStatus: cleanCronString(row.last_run_status) || null,
        lastError: row.last_error ? redactSensitiveText(String(row.last_error)) : null,
        nextRunAt: cronIsoFromMs(row.next_run_at_ms),
      }]
    })
  } catch (error) {
    pushGatewayLog('stderr', `mission cron runtime reconciliation unavailable: ${redactSensitiveText(String(error))}`)
    return []
  } finally {
    try {
      db?.close?.()
    } catch {
      // Ignore close failures on read-only status snapshots.
    }
  }
}

function unavailableMissionCronReconciliationSnapshot(error: string): MissionCronReconciliationSnapshot {
  return {
    available: false,
    activeCronIds: new Set(),
    disabledCronIds: new Set(),
    knownCronIds: new Set(),
    error,
  }
}

function listMissionCronReconciliationSnapshotFromStateDb(): MissionCronReconciliationSnapshot {
  const dbPath = cronStateDbPath()
  if (!existsSync(dbPath)) return unavailableMissionCronReconciliationSnapshot(`OpenClaw cron state database not found: ${dbPath}`)
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return unavailableMissionCronReconciliationSnapshot('node:sqlite DatabaseSync is unavailable')
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(`
      SELECT
        job_id,
        description,
        enabled,
        payload_message,
        job_json
      FROM cron_jobs
      WHERE description LIKE '%control-center mission=%'
        OR payload_message LIKE '%Mission ID:%'
        OR job_json LIKE '%control-center mission=%'
        OR job_json LIKE '%Mission ID:%'
      LIMIT 1000
    `).all()
    const activeCronIds = new Set<string>()
    const disabledCronIds = new Set<string>()
    const knownCronIds = new Set<string>()
    for (const row of rows) {
      if (!missionCronRowLooksLikeControlCenterMission(row)) continue
      const cronId = cleanCronString(row.job_id)
      if (!cronId) continue
      knownCronIds.add(cronId)
      if (missionCronRowIsEnabled(row)) {
        activeCronIds.add(cronId)
      } else {
        disabledCronIds.add(cronId)
      }
    }
    return { available: true, activeCronIds, disabledCronIds, knownCronIds }
  } catch (error) {
    return unavailableMissionCronReconciliationSnapshot(redactSensitiveText(String(error)))
  } finally {
    try {
      db?.close?.()
    } catch {
      // Ignore close failures on read-only status snapshots.
    }
  }
}

function listActiveControlCenterCronExpiryRowsFromStateDb(): ControlCenterCronExpiryInfo[] {
  const dbPath = cronStateDbPath()
  if (!existsSync(dbPath)) return []
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return []
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(`
      SELECT
        job_id,
        description,
        payload_message,
        job_json
      FROM cron_jobs
      WHERE enabled = 1
        AND (
          description LIKE '%control-center mission=%'
          OR description LIKE '%control-center shift=%'
          OR payload_message LIKE '%Mission ID:%'
          OR payload_message LIKE '%control-center shift=%'
          OR job_json LIKE '%control-center mission=%'
          OR job_json LIKE '%control-center shift=%'
          OR job_json LIKE '%Mission ID:%'
        )
      LIMIT 500
    `).all()
    return rows
      .map((row) => controlCenterCronExpiryInfo(row))
      .filter((row): row is ControlCenterCronExpiryInfo => Boolean(row))
  } finally {
    try {
      db?.close?.()
    } catch {
      // Ignore close failures on read-only status snapshots.
    }
  }
}

async function sweepExpiredMissionCronJobs(reason = 'mission cron expiry sweep') {
  if (missionCronExpirySweepInFlight) return missionCronExpirySweepInFlight
  missionCronExpirySweepInFlight = (async () => {
    const now = Date.now()
    const expired = listActiveControlCenterCronExpiryRowsFromStateDb().filter((row) => row.expiresMs <= now)
    for (const row of expired) {
      const result = await runOpenClaw(['cron', 'disable', row.cronId], 45000).catch((error) => ({
        stdout: '',
        stderr: String(error),
        code: 1,
      }))
      const label = row.kind === 'shift' ? 'scheduled shift cron' : 'mission cron'
      if (result.code === 0 || /not\s*found|missing|unknown|already\s*disabled/i.test(`${result.stdout}\n${result.stderr}`)) {
        clearShiftRuntimeStateForCronId(row.cronId)
        invalidateRuntimeStatusCache()
        pushGatewayLog('lifecycle', `${reason}: disabled expired ${label} ${row.cronId} (expired ${row.expiresAt})`)
      } else {
        pushGatewayLog('stderr', `${reason}: failed disabling expired ${label} ${row.cronId}: ${redactSensitiveText(result.stderr || result.stdout)}`)
      }
    }
  })().finally(() => {
    missionCronExpirySweepInFlight = null
  })
  return missionCronExpirySweepInFlight
}

function startMissionCronExpirySweep() {
  if (missionCronExpirySweepTimer) return
  missionCronExpirySweepTimer = setInterval(() => {
    void sweepExpiredMissionCronJobs('scheduled mission cron expiry sweep').catch(() => undefined)
  }, MISSION_CRON_EXPIRY_SWEEP_MS)
  missionCronExpirySweepTimer.unref?.()
  void sweepExpiredMissionCronJobs('startup mission cron expiry sweep').catch(() => undefined)
}

function stopMissionCronExpirySweep() {
  if (!missionCronExpirySweepTimer) return
  clearInterval(missionCronExpirySweepTimer)
  missionCronExpirySweepTimer = null
}

function shiftToRuntimeCronJob(shift: Shift): RuntimeCronJobSummary {
  return {
    ...shift,
    source: 'control-center',
    status: 'active',
    scheduleKind: shift.scheduleKind || 'every',
    scheduleLabel: shift.scheduleLabel || shift.every,
    nextRunAt: null,
    endsAt: shift.endsAt,
    message: redactSensitiveText(shift.message),
    payloadKind: 'agentTurn',
  }
}

function cronRowToRuntimeCronJob(row: Record<string, unknown>, shift?: Shift): RuntimeCronJobSummary | null {
  const cronId = cleanCronString(row.job_id)
  if (!cronId) return null
  const controlCenterExpiry = controlCenterCronExpiryInfo(row)
  const nextRunAt = cronIsoFromMs(row.next_run_at_ms)
  const runningAt = cronIsoFromMs(row.running_at_ms)
  const createdAt = cronIsoFromMs(row.created_at_ms) || new Date().toISOString()
  const scheduleLabel = cronScheduleLabel(row)
  const timeoutSeconds = cleanCronNumber(row.payload_timeout_seconds)
  return {
    id: shift?.id || `cron:${cronId}`,
    cronId,
    source: shift || controlCenterExpiry ? 'control-center' : 'openclaw',
    status: runningAt ? 'running' : 'active',
    name: shift?.name || cleanCronString(row.name) || 'OpenClaw cron job',
    agent: shift?.agent || cleanCronString(row.agent_id) || 'default',
    every: shift?.every || scheduleLabel,
    durationMinutes: shift?.durationMinutes ?? 0,
    message: redactSensitiveText(shift?.message || cronPayloadMessage(row)),
    model: shift?.model || cleanCronString(row.payload_model) || undefined,
    thinking: shift?.thinking || normalizeCronThinking(row.payload_thinking),
    timeoutSeconds: shift?.timeoutSeconds || (timeoutSeconds !== null ? timeoutSeconds : undefined),
    wake: shift?.wake || normalizeCronWake(row.wake_mode),
    session: shift?.session || normalizeCronSession(row.session_target),
    announce: shift?.announce ?? cleanCronString(row.delivery_mode) === 'announce',
    startedAt: shift?.startedAt || createdAt,
    endsAt: shift ? shift.endsAt : controlCenterExpiry?.expiresAt || nextRunAt,
    nextRunAt,
    scheduleKind: cleanCronString(row.schedule_kind) || undefined,
    scheduleLabel,
    payloadKind: cleanCronString(row.payload_kind) || undefined,
    lastError: row.last_error ? redactSensitiveText(String(row.last_error)) : null,
  }
}

function listActiveCronJobsFromStateDb(limit?: number): { active: RuntimeCronJobSummary[]; activeCount: number } {
  const inMemoryJobs = Array.from(activeShifts.values()).map(shiftToRuntimeCronJob)
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(500, Math.round(limit as number)))
    : null
  const dbPath = cronStateDbPath()
  if (!existsSync(dbPath)) {
    return {
      active: normalizedLimit ? inMemoryJobs.slice(0, normalizedLimit) : inMemoryJobs,
      activeCount: inMemoryJobs.length,
    }
  }
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) {
      return {
        active: normalizedLimit ? inMemoryJobs.slice(0, normalizedLimit) : inMemoryJobs,
        activeCount: inMemoryJobs.length,
      }
    }
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rowsStatement = db.prepare(`
      SELECT
        job_id,
        name,
        description,
        enabled,
        created_at_ms,
        agent_id,
        schedule_kind,
        schedule_expr,
        schedule_tz,
        every_ms,
        at,
        session_target,
        wake_mode,
        payload_kind,
        payload_message,
        payload_model,
        payload_thinking,
        payload_timeout_seconds,
        delivery_mode,
        next_run_at_ms,
        running_at_ms,
        last_run_status,
        last_error,
        job_json
      FROM cron_jobs
      WHERE enabled = 1
      ORDER BY COALESCE(next_run_at_ms, running_at_ms, created_at_ms) ASC, name ASC
      ${normalizedLimit ? 'LIMIT ?' : ''}
    `)
    const rows = normalizedLimit ? rowsStatement.all(normalizedLimit) : rowsStatement.all()
    const countRow = normalizedLimit
      ? db.prepare('SELECT COUNT(*) AS active_count FROM cron_jobs WHERE enabled = 1').get?.()
      : null
    const shiftsByCronId = new Map(Array.from(activeShifts.values()).map((shift) => [shift.cronId, shift]))
    const jobsByCronId = new Map<string, RuntimeCronJobSummary>()
    for (const row of rows) {
      const job = cronRowToRuntimeCronJob(row, shiftsByCronId.get(cleanCronString(row.job_id)))
      if (job) jobsByCronId.set(job.cronId, job)
    }

    // OpenClaw persists a newly-added job asynchronously. Include the
    // Control Center's in-memory registration during that short window so a
    // successful create cannot flash in the UI and then disappear.
    for (const job of inMemoryJobs) {
      if (!jobsByCronId.has(job.cronId)) jobsByCronId.set(job.cronId, job)
    }

    const active = Array.from(jobsByCronId.values())
      .sort((left, right) => {
        const leftTime = Date.parse(left.nextRunAt || left.endsAt || left.startedAt)
        const rightTime = Date.parse(right.nextRunAt || right.endsAt || right.startedAt)
        return (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER)
          - (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER)
      })
    const persistedCount = cleanCronNumber(countRow?.active_count)
    return {
      active: normalizedLimit ? active.slice(0, normalizedLimit) : active,
      activeCount: normalizedLimit && persistedCount !== null
        ? Math.max(persistedCount, active.length)
        : active.length,
    }
  } finally {
    try {
      db?.close?.()
    } catch {
      // Ignore close failures on read-only status snapshots.
    }
  }
}

function listActiveCronJobViews(options: { sqlite?: boolean; limit?: number } = {}): { active: RuntimeCronJobSummary[]; activeCount: number; error?: string } {
  const inMemoryJobs = Array.from(activeShifts.values()).map(shiftToRuntimeCronJob)
  const normalizedLimit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(500, Math.round(options.limit as number)))
    : null
  if (options.sqlite === false) {
    return {
      active: normalizedLimit ? inMemoryJobs.slice(0, normalizedLimit) : inMemoryJobs,
      activeCount: inMemoryJobs.length,
    }
  }
  try {
    return listActiveCronJobsFromStateDb(normalizedLimit || undefined)
  } catch (error) {
    return {
      active: normalizedLimit ? inMemoryJobs.slice(0, normalizedLimit) : inMemoryJobs,
      activeCount: inMemoryJobs.length,
      error: redactSensitiveText(String(error)),
    }
  }
}

function cronRowToRehydratedControlCenterShift(row: Record<string, unknown>): Shift | null {
  const expiry = shiftCronExpiryInfo(row)
  if (!expiry || expiry.expiresMs <= Date.now()) return null
  const cronId = cleanCronString(row.job_id)
  if (!cronId) return null
  const startedAt = cronIsoFromMs(row.created_at_ms) || new Date().toISOString()
  const startedMs = Date.parse(startedAt)
  const inferredDurationMinutes = Number.isFinite(startedMs)
    ? Math.max(1, Math.min(10080, Math.ceil((expiry.expiresMs - startedMs) / 60000)))
    : Math.max(1, Math.min(10080, Math.ceil((expiry.expiresMs - Date.now()) / 60000)))
  const timeoutSeconds = cleanCronNumber(row.payload_timeout_seconds)
  return {
    id: expiry.controlCenterId || `cron:${cronId}`,
    name: cleanCronString(row.name) || 'Scheduled shift',
    agent: cleanCronString(row.agent_id) || 'default',
    every: cronScheduleLabel(row),
    durationMinutes: controlCenterCronDurationMinutesFromText(controlCenterCronSourceText(row)) || inferredDurationMinutes,
    message: cronPayloadMessage(row),
    model: cleanCronString(row.payload_model) || undefined,
    thinking: normalizeCronThinking(row.payload_thinking),
    timeoutSeconds: timeoutSeconds !== null ? timeoutSeconds : undefined,
    wake: normalizeCronWake(row.wake_mode),
    session: normalizeCronSession(row.session_target),
    announce: cleanCronString(row.delivery_mode) === 'announce',
    cronId,
    startedAt,
    endsAt: expiry.expiresAt,
  }
}

function listRehydratableControlCenterShiftsFromStateDb(): Shift[] {
  const dbPath = cronStateDbPath()
  if (!existsSync(dbPath)) return []
  let db: SqliteDatabase | null = null
  try {
    const sqlite = optionalRequire('node:sqlite') as SqliteModule
    if (!sqlite?.DatabaseSync) return []
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(`
      SELECT
        job_id,
        name,
        description,
        created_at_ms,
        agent_id,
        schedule_kind,
        schedule_expr,
        every_ms,
        session_target,
        wake_mode,
        payload_message,
        payload_model,
        payload_thinking,
        payload_timeout_seconds,
        delivery_mode,
        job_json
      FROM cron_jobs
      WHERE enabled = 1
        AND (
          description LIKE '%control-center shift=%'
          OR payload_message LIKE '%control-center shift=%'
          OR job_json LIKE '%control-center shift=%'
        )
      LIMIT 500
    `).all()
    return rows
      .map((row) => cronRowToRehydratedControlCenterShift(row))
      .filter((shift): shift is Shift => Boolean(shift))
  } catch (error) {
    pushGatewayLog('stderr', `scheduled shift recovery skipped: ${redactSensitiveText(String(error))}`)
    return []
  } finally {
    try {
      db?.close?.()
    } catch {
      // Ignore close failures on read-only recovery snapshots.
    }
  }
}

function rehydrateControlCenterShiftRuntimeStateFromCronDb() {
  const recoveredShifts = listRehydratableControlCenterShiftsFromStateDb()
  let restored = 0
  for (const shift of recoveredShifts) {
    if (activeShifts.has(shift.id) || Array.from(activeShifts.values()).some((entry) => entry.cronId === shift.cronId)) continue
    activeShifts.set(shift.id, shift)
    armShiftExpiryTimer(shift)
    restored += 1
  }
  if (restored) {
    pushGatewayLog('lifecycle', `rehydrated ${restored} scheduled shift cron job(s) from OpenClaw state after restart`)
    invalidateRuntimeStatusCache()
  }
}

function clearShiftRuntimeState(shift: Shift) {
  const timer = shiftTimers.get(shift.id)
  if (timer) {
    clearTimeout(timer)
    shiftTimers.delete(shift.id)
  }
  activeShifts.delete(shift.id)
}

function clearShiftRuntimeStateForCronId(cronId: string) {
  const matchingShifts = Array.from(activeShifts.values()).filter((shift) => shift.cronId === cronId)
  for (const shift of matchingShifts) clearShiftRuntimeState(shift)
}

async function expireShiftAfterDuration(shift: Shift, reason = 'scheduled shift duration expired') {
  const current = activeShifts.get(shift.id)
  const target = current?.cronId === shift.cronId ? current : shift
  try {
    await disableShift(target)
    clearShiftRuntimeState(target)
    invalidateRuntimeStatusCache()
    pushGatewayLog('lifecycle', `${reason}: disabled scheduled shift ${target.cronId}${target.endsAt ? ` (expired ${target.endsAt})` : ''}`)
    return
  } catch (error) {
    shiftTimers.delete(target.id)
    pushGatewayLog('stderr', `${reason}: failed disabling scheduled shift ${target.cronId}: ${redactSensitiveText(String(error))}`)
  }
}

function armShiftExpiryTimer(shift: Shift) {
  if (!shift.endsAt) return
  const expiresMs = Date.parse(shift.endsAt)
  if (!Number.isFinite(expiresMs)) return
  const existing = shiftTimers.get(shift.id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    void expireShiftAfterDuration(shift).catch((error) => {
      shiftTimers.delete(shift.id)
      pushGatewayLog('stderr', `scheduled shift duration expiry failed for ${shift.cronId}: ${redactSensitiveText(String(error))}`)
    })
  }, Math.max(0, expiresMs - Date.now()))
  timer.unref?.()
  shiftTimers.set(shift.id, timer)
}

function clearManagedBatch(batchId: string) {
  const timers = managedBatchTimers.get(batchId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  managedBatchTimers.delete(batchId)
}

async function startManagedTeamSyncOrchestrator(args: {
  batchId: string
  runId: string
  targetFile: string
  leadAgent: string
  shifts: Shift[]
  durationMinutes: number
  leadEvery: string
  workerEvery: string
}) {
  const sharedTeamSyncPath = await resolveSharedTeamSyncPath(args.leadAgent)
  await ensureTeamSyncFile(sharedTeamSyncPath)

  const leadShift = args.shifts.find((shift) => shift.agent === args.leadAgent)
  if (!leadShift) return
  const workerShifts = args.shifts.filter((shift) => shift.agent !== args.leadAgent)
  const workerAgents = workerShifts.map((shift) => shift.agent)
  if (!workerAgents.length) return

  let leadTick = 0
  let workerTick = 0
  const leadMs = parseEveryToMs(args.leadEvery)
  const workerMs = parseEveryToMs(args.workerEvery)

  const append = async (agentId: string, role: string, note: string) => {
    const timestamp = new Date().toISOString()
    const line = `${timestamp} | ${role} | ${agentId} | run=${args.runId} | ${note}`
    await fs.appendFile(sharedTeamSyncPath, `${line}\n`, 'utf-8')
  }

  const runShiftCronOnce = async (shift: Shift) => {
    const timeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(shift.agent, shift.timeoutSeconds)
    const cliTimeoutMs = agentWorkTimeoutWrapperMs(timeoutSeconds)
    return runOpenClaw(
      ['cron', 'run', shift.cronId, '--timeout', String(cliTimeoutMs)],
      cliTimeoutMs + OPENCLAW_AGENT_RUNTIME_WRAPPER_GRACE_MS,
    ).catch(() => ({ stdout: '', stderr: '', code: 1 }))
  }

  const leadTimer = setInterval(async () => {
    leadTick += 1
    await runShiftCronOnce(leadShift)
    const uiTaskTemplates = [
      'Redesign the hero section with stronger value proposition hierarchy, clearer subheading structure, and an improved primary/secondary CTA layout including spacing and alignment refinements',
      'Implement a polished visual system pass covering typography scale, paragraph rhythm, heading contrast, and consistent spacing tokens across all major sections for higher readability',
      'Upgrade interactive controls with richer button states (hover/focus/active/disabled), stronger accessibility focus indicators, and improved affordance clarity for clickable elements',
      'Refactor page responsiveness for mobile/tablet by improving breakpoints, stacking behavior, content wrapping, and touch-friendly spacing while preserving desktop visual balance',
      'Introduce a premium surface style language using refined cards, subtle borders, layered backgrounds, and consistent section framing to improve depth and overall cohesion',
      'Improve information architecture and scanability by restructuring section order, adding concise supporting microcopy, and clarifying visual flow from top narrative to final call-to-action',
    ]
    const nextFocus = uiTaskTemplates[(leadTick - 1) % uiTaskTemplates.length]
    await append(args.leadAgent, 'lead', `REVIEW tick=${leadTick} file=${args.targetFile} next=${nextFocus}.`).catch(() => undefined)
    for (let index = 0; index < workerAgents.length; index += 1) {
      const owner = workerAgents[index]
      const task = uiTaskTemplates[(leadTick + index) % uiTaskTemplates.length]
      await append(
        args.leadAgent,
        'lead',
        `IDEA${index + 1} owner=${owner} file=${args.targetFile} task=${task} (tick ${leadTick}).`,
      ).catch(() => undefined)
    }
    await append(args.leadAgent, 'lead', `COMPLETE owner=${args.leadAgent} file=${args.targetFile} change=lead cycle ${leadTick} executed.`).catch(() => undefined)
  }, leadMs)

  const workerTimer = setInterval(async () => {
    workerTick += 1
    for (const shift of workerShifts) {
      await runShiftCronOnce(shift)
      await append(shift.agent, 'worker', `COMPLETE owner=${shift.agent} file=${args.targetFile} change=worker cycle ${workerTick} executed assigned idea.`).catch(() => undefined)
    }
  }, workerMs)

  const stopTimer = setTimeout(() => clearManagedBatch(args.batchId), args.durationMinutes * 60000 + 5000)
  managedBatchTimers.set(args.batchId, [leadTimer, workerTimer, stopTimer])
}

async function getPartyMembers() {
  const [config, profiles] = await Promise.all([readOpenclawConfig(), readPartyProfiles()])
  const defaultsModel = config.agents?.defaults?.model || {}
  const defaultsWorkspace = config.agents?.defaults?.workspace
  const defaultsSandbox = (config.agents?.defaults as { sandbox?: AgentSandboxConfig } | undefined)?.sandbox
  const recovered = await recoverLocalAgentEntries(config, profiles)
  if (recovered.length) {
    if (!config.agents) config.agents = {}
    config.agents.list = [...(config.agents.list || []), ...recovered]
    await writeOpenclawConfig(config).catch(() => undefined)
  }
  const agents = (config.agents?.list || []).filter((agent) => agent.id !== 'main' && !isRetiredAgentId(agent.id))

  return Promise.all(
    agents.map(async (agent) => {
      const local = await ensureAgentLocalConfig({
        agentId: agent.id,
        entry: agent,
        profile: profiles.agents[agent.id],
        defaultsModel,
        defaultsWorkspace,
        defaultsSandbox,
      })
      const profile = sanitizeProfile(local.profile)
    const activeMission = listMissions().find((mission) => mission.status === 'active' && mission.party.includes(agent.id))

      return {
        id: agent.id,
        isDefault: agent.default === true,
        name: local.identity.name || local.agent.displayName || agent.id,
        aliases: local.agent.aliases || [],
        emoji: local.identity.emoji || '@',
        theme: local.identity.theme || '',
        workspace: normalizeExecutionWorkspacePath(local.routing.workspace || ''),
        doctrineWorkspace: resolveDoctrineWorkspaceForRun(
          agent.id,
          normalizeExecutionWorkspacePath(local.routing.workspace || defaultAgentWorkspace(agent.id)),
          local.routing.canonicalFolder,
        ),
        avatar: local.identity.avatar || profile.avatar || '',
        skills: profile.skills,
        abilities: profile.abilities,
        tools: profile.tools,
        behaviorProfile: profile.behaviorProfile,
        className: profile.className,
        role: profile.role,
        sandbox: local.sandbox,
        toolsPolicy: local.tools,
        model: local.model,
        heartbeat: local.heartbeat,
        mds: local.mds,
        runtime: local.runtime,
        motto: profile.motto,
        bio: profile.bio,
        level: profile.level,
        stats: profile.stats,
        activeMission: activeMission ? missionView(activeMission) : null,
      }
    }),
  )
}

async function resolveShiftLeadAgent(requestedAgent?: string): Promise<string> {
  if (requestedAgent?.trim()) return requestedAgent.trim()
  const party = await getPartyMembers().catch(() => [])
  if (!party.length) throw new Error('No party members available to select a lead agent.')
  const sorted = [...party].sort((a, b) => (b.level || 0) - (a.level || 0))
  return sorted[0].id
}

async function getAgentToAgentPolicy() {
  const config = await readOpenclawConfig()
  const policy = config.tools?.agentToAgent
  return {
    enabled: policy?.enabled !== false,
    allow: Array.isArray(policy?.allow) ? policy.allow.filter(Boolean) : [],
  }
}

function isAgentAllowedByPolicy(agentId: string, allow: string[]) {
  if (!allow.length) return true
  return allow.includes(agentId)
}

async function resolveSkillsCommandContext(agentId?: string) {
  if (!agentId || !isValidAgentId(agentId)) {
    return { cwd: WORKSPACE_ROOT, envOverrides: undefined as Record<string, string> | undefined }
  }
  const workspace = (await resolveAgentWorkspace(agentId)) || defaultAgentWorkspace(agentId)
  const envOverrides = await getAgentAuthEnv(agentId)
  return { cwd: workspace, envOverrides }
}

type DoctorFindingCategory =
  | 'gateway'
  | 'plugin'
  | 'auth'
  | 'secret'
  | 'session'
  | 'cron'
  | 'skills'
  | 'config'
  | 'sandbox'
  | 'memory'
  | 'provider'
  | 'channel'
  | 'runtime'
  | 'unknown'

type DoctorGuidedActionKind =
  | 'doctor_repair'
  | 'plugin_inspect'
  | 'provider_auth'
  | 'secret_audit'
  | 'session_cleanup_preview'
  | 'cron_diagnostics'
  | 'gateway_status'
  | 'skills_check'
  | 'config_lint'
  | 'sandbox_lint'
  | 'memory_status'
  | 'model_status'
  | 'channel_status'
  | 'operator_review'

type DoctorGuidedAction = {
  kind: DoctorGuidedActionKind
  label: string
  detail: string
  command?: string[]
  surface?: 'monitor' | 'plugins' | 'provider-auth' | 'missions' | 'skills' | 'terminal'
  allowsDoctorRepair?: boolean
}

type DoctorFinding = {
  checkId: string
  category: DoctorFindingCategory
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string
  ocPath?: string
  fixHint?: string
  repairAction?: string
  guidedAction?: DoctorGuidedAction
}

type DoctorCheck = {
  id: string
  label: string
  ok: boolean
  severity: 'info' | 'warning' | 'error'
  failureKind?: FailureKind
  evidence: string
  elapsedMs?: number
  repairAction?: string
  findings?: DoctorFinding[]
}

type DoctorRunRecord = {
  id: string
  startedAt: string
  endedAt: string
  ok: boolean
  checks: DoctorCheck[]
  summary: string
}

type DoctorRepairRunRecord = {
  id: string
  startedAt: string
  endedAt: string
  ok: boolean
  command: {
    args: string[]
    code: number
    elapsedMs: number
    detail: string
    failureKind?: FailureKind
    timedOut?: boolean
  }
  doctor: DoctorRunRecord
}

type DoctorDiagnosticsSummary = {
  lastRun: DoctorRunRecord | null
  recent: DoctorRunRecord[]
  warningCount: number
  errorCount: number
  lastRunAt: string | null
  cache: {
    source: 'sqlite-ledger' | 'jsonl-ledger' | 'empty' | 'cache'
    refreshedAt: number
    refreshing: boolean
  }
}

const DOCTOR_DIAGNOSTIC_HISTORY_LIMIT = 6
const DOCTOR_DIAGNOSTIC_CACHE_MS = Math.max(
  2_000,
  Math.min(60_000, Number(process.env.CONTROL_CENTER_DOCTOR_DIAGNOSTIC_CACHE_MS || 10_000)),
)
let doctorDiagnosticsSummaryCache: { builtAt: number; summary: DoctorDiagnosticsSummary } | null = null
let doctorDiagnosticsSummaryInFlight: Promise<DoctorDiagnosticsSummary> | null = null

function normalizeDoctorFindingSeverity(value: unknown): DoctorFinding['severity'] {
  if (value === 'error' || value === 'warning' || value === 'info') return value
  if (typeof value === 'string' && /\b(?:fatal|fail|failed|err|error)\b/i.test(value)) return 'error'
  return 'warning'
}

function normalizeDoctorFindingCategory(value: unknown): DoctorFindingCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'gateway' ||
    normalized === 'plugin' ||
    normalized === 'auth' ||
    normalized === 'secret' ||
    normalized === 'session' ||
    normalized === 'cron' ||
    normalized === 'skills' ||
    normalized === 'config' ||
    normalized === 'sandbox' ||
    normalized === 'memory' ||
    normalized === 'provider' ||
    normalized === 'channel' ||
    normalized === 'runtime' ||
    normalized === 'unknown'
  ) {
    return normalized
  }
  return null
}

function categorizeDoctorFinding(parts: Array<string | undefined>): DoctorFindingCategory {
  const text = parts.filter(Boolean).join(' ').toLowerCase()
  if (/\b(secretref|secret|token|password|credential ref|keyref|tokenref)\b/.test(text)) return 'secret'
  if (/\b(auth|oauth|credential|api[-_\s]?key|profile|login|re[-\s]?auth)\b/.test(text)) return 'auth'
  if (/\b(plugin|manifest|registry|dependency|dependencies|extension|clawhub|bundle)\b/.test(text)) return 'plugin'
  if (/\b(gateway|service|supervisor|port|listener|readyz|healthz|restart)\b/.test(text)) return 'gateway'
  if (/\b(session|transcript|lock|dm\s?scope|context|compaction)\b/.test(text)) return 'session'
  if (/\b(cron|schedule|scheduler|job|webhook)\b/.test(text)) return 'cron'
  if (/\b(skill|skills|workshop|clawhub skill)\b/.test(text)) return 'skills'
  if (/\b(sandbox|docker|podman|container)\b/.test(text)) return 'sandbox'
  if (/\b(memory|qmd|embedding|dream|recall)\b/.test(text)) return 'memory'
  if (/\b(model|provider|catalog|routing|openai|anthropic|gemini|codex)\b/.test(text)) return 'provider'
  if (/\b(channel|telegram|discord|slack|whatsapp|imessage|matrix|sms|talk)\b/.test(text)) return 'channel'
  if (/\b(config|schema|migration|legacy|openclaw\.json|settings)\b/.test(text)) return 'config'
  if (/\b(runtime|process|node|binary|version)\b/.test(text)) return 'runtime'
  return 'unknown'
}

function defaultDoctorFindingRepairAction(category: DoctorFindingCategory): string | undefined {
  switch (category) {
    case 'plugin':
      return 'Inspect the plugin in Plugins; run Doctor repair when the finding points to stale plugin state or dependency recovery.'
    case 'auth':
      return 'Open Provider Auth and refresh the affected provider credentials before retrying runtime work.'
    case 'secret':
      return 'Resolve the SecretRef source or replace the credential reference without exposing the secret value.'
    case 'gateway':
      return 'Use Gateway status and Doctor repair before forcing a restart while active work is queued.'
    case 'session':
      return 'Close stale sessions or run Doctor repair when the finding identifies recoverable session state.'
    case 'cron':
      return 'Inspect scheduled missions and run OpenClaw cron diagnostics before disabling or editing jobs.'
    case 'skills':
      return 'Open Skills and repair missing requirements or disable unavailable skills intentionally.'
    case 'config':
      return 'Review the referenced OpenClaw config path and apply the documented migration or Doctor repair.'
    case 'sandbox':
      return 'Install or repair the configured sandbox runtime, or disable sandboxing for agents that do not need it.'
    case 'memory':
      return 'Repair the memory backend or switch to a configured provider before relying on memory search.'
    case 'provider':
      return 'Refresh the model/provider catalog and repair provider auth before retrying model-routed work.'
    case 'channel':
      return 'Inspect the channel plugin setup and Gateway channel status before sending another test message.'
    case 'runtime':
      return 'Verify the embedded OpenClaw runtime and rerun Doctor after the runtime repair completes.'
    default:
      return undefined
  }
}

function doctorFindingSearchText(finding: Pick<DoctorFinding, 'checkId' | 'message' | 'path' | 'ocPath' | 'fixHint' | 'repairAction'>) {
  return [finding.checkId, finding.message, finding.path, finding.ocPath, finding.fixHint, finding.repairAction]
    .filter(Boolean)
    .join(' ')
}

function inferredDoctorTargetId(finding: Pick<DoctorFinding, 'checkId' | 'message' | 'path' | 'ocPath' | 'fixHint' | 'repairAction'>, patterns: RegExp[]) {
  const text = doctorFindingSearchText(finding)
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const raw = match?.[1]?.trim()
    if (raw && /^[A-Za-z0-9@._/-]{1,80}$/.test(raw)) {
      return redactSensitiveText(raw).slice(0, 80)
    }
  }
  return null
}

function doctorActionCommand(args: string[]): string[] {
  return args.map((arg) => redactSensitiveText(arg).slice(0, 120))
}

function doctorLintCommandForCheck(checkId: string) {
  if (checkId && checkId !== 'openclaw-doctor') {
    return doctorActionCommand(['openclaw', 'doctor', '--lint', '--only', checkId, '--json'])
  }
  return doctorActionCommand(['openclaw', 'doctor', '--lint', '--json'])
}

function doctorGuidedActionForFinding(finding: Omit<DoctorFinding, 'guidedAction'>): DoctorGuidedAction | undefined {
  const text = doctorFindingSearchText(finding).toLowerCase()
  const pluginId = inferredDoctorTargetId(finding, [
    /\bplugins\.entries\.([A-Za-z0-9@._/-]+)/i,
    /\bplugin[:=\s]+([A-Za-z0-9@._/-]+)/i,
  ])
  const providerId = inferredDoctorTargetId(finding, [
    /\bmodels\.providers\.([A-Za-z0-9._-]+)/i,
    /\bauth\.order\.([A-Za-z0-9._-]+)/i,
    /\bprovider[:=\s]+([A-Za-z0-9._-]+)/i,
  ])
  const channelId = inferredDoctorTargetId(finding, [
    /\bchannels\.([A-Za-z0-9._-]+)/i,
    /\bchannel[:=\s]+([A-Za-z0-9._-]+)/i,
  ])
  const repairSafeFinding = /\b(stale|legacy|missing|dependency|dependencies|registry|quarantine|migration|service|supervisor|lock|transcript|orphan|config)\b/.test(text)

  switch (finding.category) {
    case 'plugin':
      return {
        kind: 'plugin_inspect',
        label: pluginId ? `Inspect ${pluginId} plugin` : 'Inspect plugin diagnostics',
        detail: 'Use manifest/dependency diagnostics before changing plugin config; run Doctor repair only for stale config or dependency recovery findings.',
        command: pluginId
          ? doctorActionCommand(['openclaw', 'plugins', 'inspect', pluginId, '--json'])
          : doctorActionCommand(['openclaw', 'plugins', 'doctor']),
        surface: 'plugins',
        ...(repairSafeFinding ? { allowsDoctorRepair: true } : {}),
      }
    case 'auth':
      return {
        kind: 'provider_auth',
        label: providerId ? `Refresh ${providerId} auth` : 'Refresh provider auth',
        detail: 'Inspect provider auth eligibility before retrying runtime work; live probes may consume provider quota.',
        command: providerId
          ? doctorActionCommand(['openclaw', 'models', 'status', '--probe-provider', providerId, '--json'])
          : doctorActionCommand(['openclaw', 'models', 'status', '--json']),
        surface: 'provider-auth',
      }
    case 'secret':
      return {
        kind: 'secret_audit',
        label: 'Audit SecretRefs',
        detail: 'Run a read-only SecretRef audit; use exec-backed checks only after explicit operator approval.',
        command: doctorActionCommand(['openclaw', 'secrets', 'audit', '--check']),
        surface: 'terminal',
      }
    case 'session':
      return {
        kind: 'session_cleanup_preview',
        label: 'Preview session cleanup',
        detail: 'Preview maintenance before enforcing; close targeted stale sessions from Monitor when possible.',
        command: doctorActionCommand(['openclaw', 'sessions', 'cleanup', '--all-agents', '--dry-run', '--json']),
        surface: 'monitor',
        ...(repairSafeFinding ? { allowsDoctorRepair: true } : {}),
      }
    case 'cron':
      return {
        kind: 'cron_diagnostics',
        label: 'Inspect cron jobs',
        detail: 'List scheduled jobs and recent run state before disabling or editing a job.',
        command: doctorActionCommand(['openclaw', 'cron', 'list']),
        surface: 'missions',
      }
    case 'gateway':
      return {
        kind: 'gateway_status',
        label: 'Inspect Gateway status',
        detail: 'Use deep Gateway status before restart; prefer safe restart when active work is still draining.',
        command: doctorActionCommand(['openclaw', 'gateway', 'status', '--deep', '--require-rpc', '--json']),
        surface: 'monitor',
        ...(repairSafeFinding ? { allowsDoctorRepair: true } : {}),
      }
    case 'skills':
      return {
        kind: 'skills_check',
        label: 'Check skill readiness',
        detail: 'Inspect missing bins, env, config, or OS requirements before disabling a skill.',
        command: doctorActionCommand(['openclaw', 'skills', 'check', '--json']),
        surface: 'skills',
      }
    case 'config':
      return {
        kind: 'config_lint',
        label: 'Re-run focused Doctor lint',
        detail: 'Review the referenced config path and apply the documented migration only after confirming the finding.',
        command: doctorLintCommandForCheck(finding.checkId),
        surface: 'terminal',
        ...(repairSafeFinding ? { allowsDoctorRepair: true } : {}),
      }
    case 'sandbox':
      return {
        kind: 'sandbox_lint',
        label: 'Inspect sandbox readiness',
        detail: 'Confirm Docker/Podman availability or disable sandboxing for agents that do not need it.',
        command: doctorLintCommandForCheck(finding.checkId),
        surface: 'terminal',
      }
    case 'memory':
      return {
        kind: 'memory_status',
        label: 'Inspect memory status',
        detail: 'Check the memory backend before relying on transcript indexing or reranked search.',
        command: doctorActionCommand(['openclaw', 'memory', 'status', '--deep']),
        surface: 'terminal',
      }
    case 'provider':
      return {
        kind: 'model_status',
        label: providerId ? `Check ${providerId} models` : 'Check model/provider status',
        detail: 'Validate model routing and auth state before retrying provider-routed work.',
        command: providerId
          ? doctorActionCommand(['openclaw', 'models', 'status', '--probe-provider', providerId, '--json'])
          : doctorActionCommand(['openclaw', 'models', 'status', '--json']),
        surface: 'provider-auth',
      }
    case 'channel':
      return {
        kind: 'channel_status',
        label: channelId ? `Probe ${channelId} channel` : 'Probe channel status',
        detail: 'Use channel status probes for live account/socket health; sessions only prove stored conversations.',
        command: channelId
          ? doctorActionCommand(['openclaw', 'channels', 'status', '--channel', channelId, '--probe', '--json'])
          : doctorActionCommand(['openclaw', 'channels', 'status', '--probe', '--json']),
        surface: 'plugins',
      }
    case 'runtime':
      return {
        kind: 'doctor_repair',
        label: 'Run Doctor repair after review',
        detail: 'Use the documented non-interactive Doctor repair fallback when runtime state needs migration or recovery.',
        command: doctorActionCommand(['openclaw', 'doctor', '--fix', '--non-interactive', '--yes', '--no-workspace-suggestions']),
        surface: 'monitor',
        allowsDoctorRepair: true,
      }
    default:
      if (finding.fixHint || finding.repairAction) {
        return {
          kind: 'operator_review',
          label: 'Review Doctor guidance',
          detail: 'Follow the structured finding hint before choosing a repair path.',
          surface: 'monitor',
        }
      }
      return undefined
  }
}

function normalizeDoctorFinding(value: unknown): DoctorFinding | null {
  if (!isLooseRecord(value)) return null
  const message = stringField(value, ['message', 'summary', 'detail', 'reason'])
  if (!message) return null
  const checkId = stringField(value, ['checkId', 'id', 'code']) || 'openclaw-doctor'
  const pathValue = stringField(value, ['path'])
  const ocPath = stringField(value, ['ocPath'])
  const fixHint = stringField(value, ['fixHint', 'hint'])
  const repairAction = stringField(value, ['repairAction'])
  const category = normalizeDoctorFindingCategory(value.category)
    || categorizeDoctorFinding([checkId, message, pathValue, ocPath, fixHint, repairAction])
  const defaultRepairAction = repairAction || (fixHint ? undefined : defaultDoctorFindingRepairAction(category))
  const normalized = {
    checkId: redactSensitiveText(checkId).slice(0, 120),
    category,
    severity: normalizeDoctorFindingSeverity(value.severity),
    message: redactSensitiveText(message).slice(0, 360),
    ...(pathValue ? { path: redactSensitiveText(pathValue).slice(0, 180) } : {}),
    ...(ocPath ? { ocPath: redactSensitiveText(ocPath).slice(0, 180) } : {}),
    ...(fixHint ? { fixHint: redactSensitiveText(fixHint).slice(0, 360) } : {}),
    ...(defaultRepairAction ? { repairAction: redactSensitiveText(defaultRepairAction).slice(0, 360) } : {}),
  }
  const guidedAction = doctorGuidedActionForFinding(normalized)
  return {
    ...normalized,
    ...(guidedAction ? { guidedAction } : {}),
  }
}

function normalizeDoctorCheck(value: unknown): DoctorCheck | null {
  if (!isLooseRecord(value)) return null
  const id = stringField(value, ['id']) || ''
  const label = stringField(value, ['label']) || id
  const severity = value.severity === 'error' || value.severity === 'warning' || value.severity === 'info'
    ? value.severity
    : 'info'
  const evidence = stringField(value, ['evidence']) || ''
  if (!id || !label) return null
  const findings = Array.isArray(value.findings)
    ? value.findings.map(normalizeDoctorFinding).filter((finding): finding is DoctorFinding => Boolean(finding)).slice(0, 12)
    : []
  return {
    id,
    label,
    ok: value.ok === true,
    severity,
    ...(typeof value.failureKind === 'string' && value.failureKind.trim() ? { failureKind: value.failureKind.trim() as FailureKind } : {}),
    evidence: redactSensitiveText(evidence).slice(0, 800),
    ...(typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) ? { elapsedMs: Math.max(0, Math.round(value.elapsedMs)) } : {}),
    ...(typeof value.repairAction === 'string' && value.repairAction.trim() ? { repairAction: redactSensitiveText(value.repairAction.trim()).slice(0, 500) } : {}),
    ...(findings.length ? { findings } : {}),
  }
}

function normalizeDoctorRunRecord(value: unknown): DoctorRunRecord | null {
  if (!isLooseRecord(value)) return null
  const id = stringField(value, ['id']) || ''
  const startedAt = stringField(value, ['startedAt']) || ''
  const endedAt = stringField(value, ['endedAt']) || startedAt
  if (!id || !startedAt || Number.isNaN(Date.parse(startedAt))) return null
  const checks = Array.isArray(value.checks)
    ? value.checks.map(normalizeDoctorCheck).filter((check): check is DoctorCheck => Boolean(check))
    : []
  return {
    id,
    startedAt,
    endedAt: !Number.isNaN(Date.parse(endedAt)) ? endedAt : startedAt,
    ok: value.ok === true,
    checks: checks.slice(0, 16),
    summary: redactSensitiveText(stringField(value, ['summary']) || 'Doctor run completed.').slice(0, 500),
  }
}

function buildDoctorDiagnosticsSummary(records: DoctorRunRecord[], source: DoctorDiagnosticsSummary['cache']['source']): DoctorDiagnosticsSummary {
  const recent = records
    .filter((record) => isRuntimeMonitorEntryVisible(record.endedAt || record.startedAt))
    .sort((a, b) => Date.parse(b.endedAt || b.startedAt) - Date.parse(a.endedAt || a.startedAt))
    .slice(0, DOCTOR_DIAGNOSTIC_HISTORY_LIMIT)
  const lastRun = recent[0] || null
  return {
    lastRun,
    recent,
    warningCount: lastRun?.checks.filter((check) => check.severity === 'warning').length || 0,
    errorCount: lastRun?.checks.filter((check) => check.severity === 'error').length || 0,
    lastRunAt: lastRun?.endedAt || lastRun?.startedAt || null,
    cache: {
      source,
      refreshedAt: Date.now(),
      refreshing: false,
    },
  }
}

function cachedDoctorDiagnosticsSummary(source: DoctorDiagnosticsSummary['cache']['source'] = 'cache'): DoctorDiagnosticsSummary {
  const cached = doctorDiagnosticsSummaryCache?.summary
  if (!cached) return buildDoctorDiagnosticsSummary([], 'empty')
  return {
    ...cached,
    cache: {
      ...cached.cache,
      source,
      refreshing: Boolean(doctorDiagnosticsSummaryInFlight),
    },
  }
}

async function readDoctorDiagnosticsSummary(
  forceRefresh = false,
  options: { sqlite?: boolean } = {},
): Promise<DoctorDiagnosticsSummary> {
  const now = Date.now()
  if (!forceRefresh && doctorDiagnosticsSummaryCache && now - doctorDiagnosticsSummaryCache.builtAt <= DOCTOR_DIAGNOSTIC_CACHE_MS) {
    return cachedDoctorDiagnosticsSummary('cache')
  }
  if (!forceRefresh && doctorDiagnosticsSummaryInFlight) return doctorDiagnosticsSummaryInFlight

  doctorDiagnosticsSummaryInFlight = (async () => {
    const raw = await runtimeLedgerStore.readDiagnosticRuns<unknown>(
      DOCTOR_DIAGNOSTIC_HISTORY_LIMIT * 3,
      options,
    ).catch(() => [])
    const records = raw
      .map(normalizeDoctorRunRecord)
      .filter((record): record is DoctorRunRecord => Boolean(record))
    const summary = buildDoctorDiagnosticsSummary(
      records,
      records.length ? (options.sqlite === false ? 'jsonl-ledger' : 'sqlite-ledger') : 'empty',
    )
    doctorDiagnosticsSummaryCache = { builtAt: Date.now(), summary }
    return summary
  })().finally(() => {
    doctorDiagnosticsSummaryInFlight = null
  })

  return doctorDiagnosticsSummaryInFlight
}

async function diskFreeSpaceCheck(): Promise<DoctorCheck> {
  const label = 'Disk free space'
  const startedAt = Date.now()
  try {
    const statfs = await fs.statfs(WORKSPACE_ROOT)
    const freeBytes = Number(statfs.bavail) * Number(statfs.bsize)
    const freeGb = freeBytes / (1024 ** 3)
    const severity: DoctorCheck['severity'] = freeGb < 1 ? 'error' : freeGb < 5 ? 'warning' : 'info'
    return {
      id: 'disk',
      label,
      ok: freeGb >= 1,
      severity,
      ...(freeGb < 1 ? { failureKind: 'disk_low' as FailureKind } : {}),
      evidence: `${freeGb.toFixed(1)} GB free at ${WORKSPACE_ROOT}`,
      elapsedMs: Date.now() - startedAt,
      ...(freeGb < 5 ? { repairAction: 'Free disk space before long agent turns, plugin updates, or media jobs.' } : {}),
    }
  } catch (error) {
    return {
      id: 'disk',
      label,
      ok: false,
      severity: 'warning',
      evidence: `Disk probe unavailable: ${redactSensitiveText(String(error))}`,
      elapsedMs: Date.now() - startedAt,
    }
  }
}

function runtimeVersionCheckPayload() {
  const runtime = resolvedOpenClawRuntimeInfo()
  const expected = RECOMMENDED_OPENCLAW_VERSION
  const current = runtime.version || ''
  const ok = Boolean(current && current === expected)
  const warning = current && current !== expected
  return {
    ok,
    current: current || null,
    expected,
    embedded: runtime.embedded,
    bin: runtime.bin,
    node: runtime.node,
    severity: ok ? 'info' : warning ? 'warning' : 'error',
    message: ok
      ? `OpenClaw runtime matches ${expected}.`
      : warning
        ? `OpenClaw runtime is ${current}; recommended stable target is ${expected}.`
        : `OpenClaw runtime version could not be detected; recommended stable target is ${expected}.`,
  }
}

function authDoctorCheck(): DoctorCheck {
  const providers = Object.keys(AUTH_PROVIDER_CATALOG).map((provider) => providerAuthStatus(provider))
  const configured = providers.filter((provider) => provider.configured)
  const oauthProviders = providers.filter((provider) => provider.oauth?.supported)
  const expired = oauthProviders.filter((provider) => {
    const expiresAt = provider.oauth?.expiresAt || 0
    return Boolean(provider.oauth?.configured && expiresAt && expiresAt <= Date.now() + 60_000 && !provider.oauth.refreshAvailable)
  })
  const refreshable = oauthProviders.filter((provider) => {
    const expiresAt = provider.oauth?.expiresAt || 0
    return Boolean(provider.oauth?.configured && expiresAt && expiresAt <= Date.now() + 60_000 && provider.oauth.refreshAvailable)
  })
  const unavailable = oauthProviders.filter((provider) => provider.oauth?.supported && !provider.oauth.available && provider.oauth.missing?.length)
  const severity: DoctorCheck['severity'] = expired.length ? 'error' : refreshable.length || unavailable.length ? 'warning' : configured.length ? 'info' : 'warning'
  return {
    id: 'auth',
    label: 'Provider auth',
    ok: !expired.length,
    severity,
    ...(expired.length ? { failureKind: 'auth_expired' as FailureKind } : {}),
    evidence: [
      `${configured.length}/${providers.length} providers configured.`,
      expired.length ? `Expired/near-expired OAuth: ${expired.map((entry) => entry.provider).join(', ')}.` : '',
      refreshable.length ? `OAuth refresh available: ${refreshable.map((entry) => entry.provider).join(', ')}.` : '',
      unavailable.length ? `OAuth setup missing: ${unavailable.map((entry) => entry.provider).join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    repairAction: expired.length
      ? 'Open Provider Auth and reconnect the expired OAuth provider.'
      : unavailable.length
        ? 'Open Provider Auth and complete the missing OAuth client configuration.'
        : undefined,
  }
}

function probeQmdCommand(command: string) {
  try {
    const result = spawnSync(command, ['--version'], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env },
      encoding: 'utf-8',
      shell: false,
      timeout: 4000,
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    return {
      ok: !result.error && result.status === 0,
      detail: result.error ? result.error.message : output || `exit ${result.status ?? 'unknown'}`,
    }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}

function qmdMemoryDoctorCheck(config: OpenClawConfigFile): DoctorCheck {
  const optimization = openClawOptimizationStatus(config)
  const command = config.memory?.qmd?.command?.trim() || 'qmd'
  const probe = probeQmdCommand(command)
  if (!optimization.memory.qmdEnabled) {
    return {
      id: 'qmd-memory',
      label: 'QMD memory',
      ok: true,
      severity: 'info',
      evidence: probe.ok
        ? `Builtin memory backend active; QMD is available via ${command} for opt-in transcript indexing.`
        : 'Builtin memory backend active; QMD is not enabled, so no sidecar is required.',
      repairAction: probe.ok ? 'Set memory.backend to qmd when you want session transcript indexing and reranked local search.' : undefined,
    }
  }
  return {
    id: 'qmd-memory',
    label: 'QMD memory',
    ok: probe.ok,
    severity: probe.ok ? 'info' : 'warning',
    failureKind: probe.ok ? undefined : 'process_error',
    evidence: probe.ok
      ? `QMD backend enabled with ${optimization.memory.qmdSearchMode} search; session indexing ${optimization.memory.qmdSessionsEnabled ? 'enabled' : 'disabled'}.`
      : `QMD backend enabled but ${command} is unavailable: ${redactSensitiveText(probe.detail)}`,
    repairAction: probe.ok ? undefined : 'Install QMD on the gateway PATH or set memory.qmd.command to its absolute path.',
  }
}

type OpenClawDoctorLintFinding = DoctorFinding

function normalizeOpenClawDoctorLintFinding(value: unknown): OpenClawDoctorLintFinding | null {
  return normalizeDoctorFinding(value)
}

function openClawDoctorLintFindingsFromValue(value: unknown): OpenClawDoctorLintFinding[] {
  const records = Array.isArray(value)
    ? value
    : isLooseRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : []
  return records
    .map(normalizeOpenClawDoctorLintFinding)
    .filter((finding): finding is OpenClawDoctorLintFinding => Boolean(finding))
    .slice(0, 12)
}

function parseOpenClawDoctorLintFindings(result: OpenClawResult): OpenClawDoctorLintFinding[] {
  const stdoutParsed = parseOpenClawJsonOutput(result.stdout)
  const stdoutFindings = openClawDoctorLintFindingsFromValue(stdoutParsed)
  if (stdoutFindings.length || result.stdout.trim()) return stdoutFindings
  return openClawDoctorLintFindingsFromValue(parseOpenClawJsonOutput(result.stderr))
}

function openClawDoctorLintFindingEvidence(finding: OpenClawDoctorLintFinding): string {
  const location = finding.ocPath || finding.path || ''
  return `${finding.severity} ${finding.category} ${finding.checkId}${location ? ` (${location})` : ''}: ${finding.message}`
}

async function openClawDoctorLintCheck(): Promise<DoctorCheck> {
  const label = 'OpenClaw Doctor lint'
  const args = ['doctor', '--lint', '--json', '--severity-min', 'warning']
  const lint = await boundedOperation(label, 45_000, async (signal) => runOpenClaw(args, 40_000, { signal }))
  if (!lint.ok || !lint.value) {
    return {
      id: 'openclaw-doctor-lint',
      label,
      ok: false,
      severity: 'warning',
      failureKind: lint.failureKind,
      evidence: lint.error || 'OpenClaw doctor --lint did not complete.',
      elapsedMs: lint.elapsedMs,
      repairAction: 'Run OpenClaw Doctor lint from a terminal to inspect the structured health-check failure.',
    }
  }

  const result = lint.value
  const findings = parseOpenClawDoctorLintFindings(result)
  const structuredFindings = findings
    .map((finding) => normalizeDoctorFinding(finding))
    .filter((finding): finding is DoctorFinding => Boolean(finding))
  const commandFailed = result.code > 1
  const errorFindings = structuredFindings.filter((finding) => finding.severity === 'error')
  const evidence = structuredFindings.length
    ? `${structuredFindings.length} warning/error finding(s): ${structuredFindings.slice(0, 3).map(openClawDoctorLintFindingEvidence).join(' | ')}`
    : result.code === 0
      ? 'OpenClaw doctor --lint returned no warning/error findings.'
      : compactOpenClawCommandOutput(result, `openclaw ${args.join(' ')} exited ${result.code}`)
  const primaryFindingAction = structuredFindings.find((finding) => finding.fixHint || finding.repairAction)
  return {
    id: 'openclaw-doctor-lint',
    label,
    ok: result.code === 0 && structuredFindings.length === 0,
    severity: commandFailed || errorFindings.length ? 'error' : structuredFindings.length || result.code !== 0 ? 'warning' : 'info',
    failureKind: commandFailed ? result.failureKind || classifyFailureKind(`${result.stdout}\n${result.stderr}`, 'failed') : undefined,
    evidence: evidence.slice(0, 800),
    elapsedMs: Math.max(lint.elapsedMs, result.elapsedMs || 0),
    repairAction: primaryFindingAction?.fixHint || primaryFindingAction?.repairAction || (commandFailed
      ? 'Run OpenClaw Doctor lint from a terminal; the lint command failed before returning structured findings.'
      : structuredFindings.length
        ? 'Review the lint finding before running Doctor repair or changing OpenClaw config.'
        : undefined),
    ...(structuredFindings.length ? { findings: structuredFindings } : {}),
  }
}

async function runDoctorChecks(): Promise<{ id: string; startedAt: string; endedAt: string; ok: boolean; checks: DoctorCheck[]; summary: string }> {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const checks: DoctorCheck[] = []

  checks.push(await diskFreeSpaceCheck())

  const version = runtimeVersionCheckPayload()
  checks.push({
    id: 'runtime-version',
    label: 'OpenClaw runtime version',
    ok: version.ok,
    severity: version.severity as DoctorCheck['severity'],
    evidence: version.message,
    repairAction: version.ok ? undefined : 'Rebuild/package with the expected OpenClaw beta runtime or set OPENCLAW_BIN to the desired runtime.',
  })

  const configCheck = await boundedOperation('OpenClaw config parse', 8000, async () => readOpenclawConfig())
  checks.push({
    id: 'config',
    label: 'OpenClaw config parse',
    ok: configCheck.ok,
    severity: configCheck.ok ? 'info' : 'error',
    failureKind: configCheck.failureKind,
    evidence: configCheck.ok ? `Parsed ${OPENCLAW_CONFIG_PATH}` : configCheck.error || 'Config parse failed.',
    elapsedMs: configCheck.elapsedMs,
    repairAction: configCheck.ok ? undefined : 'Fix malformed JSON/config entries in the OpenClaw config file.',
  })

  if (configCheck.ok && configCheck.value) {
    const optimization = openClawOptimizationStatus(configCheck.value)
    checks.push({
      id: 'context-pruning',
      label: 'Session pruning',
      ok: optimization.contextPruning.enabled,
      severity: optimization.contextPruning.enabled ? 'info' : 'warning',
      evidence: optimization.contextPruning.enabled
        ? `Cache-TTL pruning active; ttl=${optimization.contextPruning.ttl}, keepLastAssistants=${optimization.contextPruning.keepLastAssistants ?? 'default'}, hardClear=${optimization.contextPruning.hardClear ? 'on' : 'off'}.`
        : `Context pruning mode is ${optimization.contextPruning.mode}.`,
      repairAction: optimization.contextPruning.enabled ? undefined : 'Set agents.defaults.contextPruning.mode to cache-ttl.',
    })
    const isolated = optimization.session.dmScope !== 'main'
    const maintenanceOn = optimization.session.maintenanceMode === 'enforce'
    checks.push({
      id: 'session-policy',
      label: 'Session policy',
      ok: isolated && maintenanceOn,
      severity: isolated && maintenanceOn ? 'info' : 'warning',
      evidence: `dmScope=${optimization.session.dmScope}; maintenance=${optimization.session.maintenanceMode}; pruneAfter=${optimization.session.pruneAfter ?? 'default'}; maxEntries=${optimization.session.maxEntries ?? 'default'}.`,
      repairAction: isolated && maintenanceOn ? undefined : 'Use per-channel-peer DM isolation and enforce session maintenance for multi-channel agents.',
    })
    checks.push(qmdMemoryDoctorCheck(configCheck.value))
  }

  checks.push(await openClawDoctorLintCheck())

  const gatewayCheck = await boundedOperation('Gateway health', 5000, async () => fetchGatewayHealthPayload())
  const gatewayLifecycleLedger = await boundedOperation('Gateway lifecycle ledger', 3000, async () => readGatewayLedgerSnapshot(80))
  const gatewayStabilityCheck = await boundedOperation('Gateway stability diagnostics', 3000, async () => readGatewayStabilitySnapshot(8))
  const gatewayDoctorRestartSnapshot = gatewayLifecycleLedger.value?.restart || null
  const gatewayDoctorRestartTimeline = gatewayRestartLifecycleTimelineWithMemory(
    gatewayDoctorRestartSnapshot,
    gatewayLifecycleLedger.value?.recentRestarts || [],
  )
  const gatewayHealthy = Boolean(gatewayCheck.value?.healthy)
  const gatewayDoctorRestartDiagnostics = gatewayRestartDiagnostics(
    gatewayHealthy,
    gatewayDoctorRestartTimeline,
    gatewayStabilityCheck.value || gatewayStabilityUnavailable('diagnostics.stability', gatewayStabilityCheck.error),
  )
  const gatewayLifecycleState = gatewayLifecycle.lifecycleSnapshot()
  const gatewayDoctorLastRestart = gatewayDoctorRestartTimeline[0] || gatewayDoctorRestartSnapshot || null
  const gatewayDoctorLastRestartAt = gatewayLifecycleState.lastRestartAt || gatewayDoctorLastRestart?.at || null
  const gatewayDoctorLastRestartReason = gatewayLifecycleState.lastRestartReason || gatewayDoctorLastRestart?.reason || null
  const gatewayDoctorLastRestartOutcome = gatewayLifecycleState.lastRestartOutcome || gatewayDoctorLastRestart?.outcome || null
  const gatewayDoctorRestartEvidence = gatewayDoctorRestartTimeline.length > 1
    ? `Recent restarts: ${gatewayDoctorRestartTimeline
      .slice(0, 3)
      .map((entry) => `${entry.outcome} at ${entry.at}: ${entry.reason}`)
      .join(' | ')}.`
    : gatewayDoctorLastRestartReason
      ? `Last restart ${gatewayDoctorLastRestartOutcome || 'requested'}${gatewayDoctorLastRestartAt ? ` at ${gatewayDoctorLastRestartAt}` : ''}: ${gatewayDoctorLastRestartReason}.`
      : ''
  const gatewayLifecycleEvidence = [
    gatewayLifecycleState.lastHealthyAt ? `Last healthy at ${gatewayLifecycleState.lastHealthyAt}.` : '',
    gatewayDoctorRestartEvidence,
    `Restart diagnostics: ${gatewayDoctorRestartDiagnostics.summary}`,
  ].filter(Boolean).join(' ')
  checks.push({
    id: 'gateway',
    label: 'Gateway health',
    ok: gatewayHealthy && !gatewayDoctorRestartDiagnostics.needsAttention,
    severity: gatewayHealthy && !gatewayDoctorRestartDiagnostics.needsAttention ? 'info' : 'warning',
    failureKind: gatewayHealthy ? undefined : 'gateway_disconnect',
    evidence: gatewayCheck.ok
      ? `Gateway ${gatewayHealthy ? 'healthy' : 'not healthy'} on port ${GATEWAY_HTTP_PORT}.${gatewayLifecycleEvidence ? ` ${gatewayLifecycleEvidence}` : ''}`
      : gatewayCheck.error || `Gateway probe failed on port ${GATEWAY_HTTP_PORT}.`,
    elapsedMs: Math.max(gatewayCheck.elapsedMs, gatewayLifecycleLedger.elapsedMs, gatewayStabilityCheck.elapsedMs),
    repairAction: gatewayDoctorRestartDiagnostics.repairAction || (gatewayHealthy ? undefined : 'Use Restart Gateway in the Runtime Monitor.'),
  })

  const pluginCheck = await boundedOperation('Plugin controls', 12_000, async () => listPluginControls())
  const brokenPlugins = pluginCheck.value?.plugins.filter((plugin) => plugin.missingDependencies.length || /broken|error|failed/i.test(plugin.status)) || []
  checks.push({
    id: 'plugins',
    label: 'Plugin loader health',
    ok: pluginCheck.ok && !brokenPlugins.length,
    severity: brokenPlugins.length ? 'warning' : pluginCheck.ok ? 'info' : 'error',
    failureKind: brokenPlugins.length || !pluginCheck.ok ? 'plugin_loader_error' : undefined,
    evidence: pluginCheck.ok
      ? `${pluginCheck.value?.plugins.length || 0} plugins indexed${brokenPlugins.length ? `; ${brokenPlugins.length} need repair.` : '.'}`
      : pluginCheck.error || 'Plugin scan failed.',
    elapsedMs: pluginCheck.elapsedMs,
    repairAction: brokenPlugins.length ? 'Open Plugins and inspect loader errors/missing dependencies.' : undefined,
  })

  checks.push(authDoctorCheck())

  const skillsCheck = await boundedOperation('Skills folder', 6000, async () => fs.readdir(SHARED_SKILLS_ROOT, { withFileTypes: true }))
  const skillCount = skillsCheck.value?.filter((entry) => entry.isDirectory()).length || 0
  checks.push({
    id: 'skills',
    label: 'Skills library',
    ok: skillsCheck.ok,
    severity: skillsCheck.ok ? 'info' : 'warning',
    evidence: skillsCheck.ok ? `${skillCount} shared skills indexed.` : skillsCheck.error || 'Skills folder unavailable.',
    elapsedMs: skillsCheck.elapsedMs,
    repairAction: skillsCheck.ok ? undefined : 'Create the shared skills folder or run a ClawHub skill install.',
  })

  const cronCheck = await boundedOperation('Cron list', 18_000, async () => runOpenClaw(['cron', 'list'], 15_000))
  checks.push({
    id: 'cron',
    label: 'Cron missions',
    ok: Boolean(cronCheck.ok && cronCheck.value?.code === 0),
    severity: cronCheck.ok && cronCheck.value?.code === 0 ? 'info' : 'warning',
    failureKind: cronCheck.value?.failureKind || cronCheck.failureKind,
    evidence: cronCheck.ok
      ? previewRuntimeOutput(cronCheck.value?.stdout || cronCheck.value?.stderr || `OpenClaw cron exited ${cronCheck.value?.code ?? 'unknown'}`, 220)
      : cronCheck.error || 'Cron probe failed.',
    elapsedMs: cronCheck.elapsedMs,
    repairAction: cronCheck.ok && cronCheck.value?.code === 0 ? undefined : 'Run OpenClaw cron diagnostics or disable stale cron jobs.',
  })

  const catalog = getFastAvailableModelsCatalog()
  checks.push({
    id: 'models',
    label: 'Model catalog cache',
    ok: Boolean(catalog.models.length),
    severity: catalog.refreshing ? 'warning' : 'info',
    evidence: `${catalog.models.length} models available from ${catalog.source}${catalog.refreshing ? '; refresh in progress.' : '.'}`,
    repairAction: catalog.models.length ? undefined : 'Refresh provider catalog after configuring model providers.',
  })

  const ok = checks.every((check) => check.ok || check.severity !== 'error')
  const summary = ok
    ? `Doctor completed with ${checks.filter((check) => check.severity === 'warning').length} warning(s).`
    : `Doctor found ${checks.filter((check) => check.severity === 'error').length} error(s).`
  const endedAt = new Date().toISOString()
  const result = { id, startedAt, endedAt, ok, checks, summary }
  void runtimeLedgerStore.appendDiagnosticRun(result).catch(() => undefined)
  doctorDiagnosticsSummaryCache = {
    builtAt: Date.now(),
    summary: buildDoctorDiagnosticsSummary([result, ...(doctorDiagnosticsSummaryCache?.summary.recent || [])], 'sqlite-ledger'),
  }
  return result
}

async function runDoctorRepair(): Promise<DoctorRepairRunRecord> {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const args = ['doctor', '--fix', '--non-interactive', '--yes', '--no-workspace-suggestions']
  pushGatewayLog('lifecycle', 'operator requested OpenClaw Doctor repair from Runtime Monitor')
  const result = await runOpenClaw(args, GATEWAY_CONFIG_DOCTOR_TIMEOUT_MS)
  openclawConfigCache = null
  modelCatalogService.invalidateAvailableModels()
  invalidateRuntimeStatusCache()
  const detail = compactOpenClawCommandOutput(result, `openclaw ${args.join(' ')} exited ${result.code}`)
  if (result.code === 0) {
    pushGatewayLog('lifecycle', 'OpenClaw Doctor repair completed from Runtime Monitor')
  } else {
    pushGatewayLog('lifecycle', `OpenClaw Doctor repair failed from Runtime Monitor: ${detail}`)
  }
  const doctor = await runDoctorChecks()
  const endedAt = new Date().toISOString()
  return {
    id,
    startedAt,
    endedAt,
    ok: result.code === 0 && doctor.ok,
    command: {
      args,
      code: result.code,
      elapsedMs: Math.max(0, Math.round(result.elapsedMs || Date.parse(endedAt) - Date.parse(startedAt) || 0)),
      detail,
      ...(result.failureKind ? { failureKind: result.failureKind } : {}),
      ...(result.timedOut ? { timedOut: true } : {}),
    },
    doctor,
  }
}

registerDiagnosticsRoutes(app, {
  cachedDoctorDiagnosticsSummary,
  diskFreeSpaceCheck,
  gatewayChatEnabled: () => CONTROL_CENTER_GATEWAY_AGENT_SESSIONS && CONTROL_CENTER_GATEWAY_CHAT_CLIENT && !FORCE_LOCAL_AGENT_RUNTIME,
  gatewayChatPrewarmedAt: () => gatewayChatService.prewarmedAt(),
  gatewayChatPrewarming: () => gatewayChatService.prewarming(),
  gatewayChatPrewarmOnStartup: CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP,
  gatewayChatReady: () => gatewayChatService.ready(),
  gatewayChatRuntimeSnapshot,
  openClawAgentRunDefaultsReady: () => openclawAgentRunDefaultsReady,
  openClawOptimizationScorecard: buildOpenClawOptimizationScorecard,
  readDoctorDiagnosticsSummary,
  recommendedOpenClawVersion: RECOMMENDED_OPENCLAW_VERSION,
  redactSensitiveText,
  resolvedOpenClawRuntimeInfo,
  runDoctorChecks,
  runDoctorRepair,
  runtimeLedgerStatus: runtimeLedgerStore.status,
  runtimeVersionCheckPayload,
  workspaceRoot: WORKSPACE_ROOT,
})

registerCommandConsoleFileRoutes(app, {
  controlFiles: controlFilesService,
  persistCommandConsoleUpload,
  uploadLimitBytes: COMMAND_CONSOLE_UPLOAD_LIMIT_BYTES,
})

registerOpenClawCommandRoutes(app, {
  activeShifts: () => Array.from(activeShifts.values()),
  getPartyMembers,
  invalidateRuntimeStatusCache,
  listMissionViews: () => listMissions().map((mission) => missionView(mission)),
  listPluginControls,
  missionFeed: () => missionFeed.slice(0, 120),
  openclawConfigPath: OPENCLAW_CONFIG_PATH,
  parseOpenClawCommandInput,
  pluginCommandResult: (args, result) => pluginCommandResult(args, result),
  pluginCommandString,
  pushGatewayLog,
  redactSensitiveText,
  runOpenClaw,
})

const runtimeRecoveryService = createRuntimeRecoveryService({
  clearAgentTurnSessions,
  clearBrowserProbeCache: () => browserProbeCache.clear(),
  clearGatewayRuntimeMonitorHistory: () => gatewayLogService.clearRuntimeMonitorHistory(),
  clearRecentOpenClawRuns: () => {
    recentOpenClawRuns.length = 0
  },
  clearShutdownPinnedTimers,
  closeOAuthCallbackServersForProcessExit,
  closeOAuthCallbackServersForShutdown,
  closeRuntimeLedger: runtimeLedgerStore.close,
  getActiveOpenClawRunCount: () => activeOpenClawRuns.size,
  getRecentOpenClawRunCount: () => recentOpenClawRuns.length,
  invalidateGatewayLedgerSnapshotCache,
  invalidateRuntimeStatusCache,
  markShuttingDown: () => {
    shuttingDown = true
  },
  pauseGatewayAutoRestart: () => gatewayLifecycle.pauseAutoRestart(),
  persistAllMissionRecords,
  pushGatewayLog,
  setRuntimeMonitorClearedAtMs: (value) => {
    runtimeMonitorClearedAtMs = value
  },
  stopAllPluginSetupTerminalSessions,
  stopControlCenterGatewayClient,
  stopGateway,
  stopGatewayHealthMonitor,
  stopGatewayRuntime,
  stopMissionCronExpirySweep,
  sweepOpenClawSessionLocks,
  terminateAllOpenClawRuns,
  terminateAllOpenClawRunsNow,
  writeRuntimeMonitorClearMarker,
})

const runtimeActionService = createRuntimeActionService({
  abortOpenClawRun: abortOpenClawRunById,
  abortGatewayRuntimeSessionsForClose,
  abortStaleGatewayChatWaiters,
  cleanupOpenClawSessionLocks,
  closeRuntimeSessions,
  ensureGatewayRunning,
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  gatewayListenerPidForPort,
  gatewayStatusSnapshot,
  invalidateRuntimeStatusCache,
  isGatewayHealthy,
  openAgentSessionSnapshots,
  readExternalChannelActivityEntries,
  readExternalGatewayLogEntries,
  runtimeRecovery: runtimeRecoveryService,
  scheduleOpenClawSessionLockSweep,
  startGatewayHealthMonitor,
  stopGatewayRuntime,
  summarizeGatewayActivity,
  tryRestartGatewayService,
})

registerRuntimeRoutes(app, {
  getGatewayActivityFeed,
  getRuntimeStatusPayload,
  getRuntimeSummaryPayload,
  isValidAgentId,
  runtimeActions: runtimeActionService,
})

registerPluginRoutes(app, {
  clawTalkPluginId: CLAWTALK_PLUGIN_ID,
  isCreditsOnlyEntitlement: () => licenseService.isUsagePriorityLocked(),
  invalidateRuntimeStatusCache,
  installOpenClawPlugin,
  listPluginControls,
  pluginErrorDetail,
  pluginErrorStatus,
  pluginIdPattern: PLUGIN_ID_PATTERN,
  pluginRuntime: activePluginRuntimeService(),
  pluginRuntimeStatePath: PLUGIN_RUNTIME_STATE_PATH,
  redactSensitiveText,
  savePluginDirectConfig,
  schedulePluginGatewayRestart,
  searchOpenClawPlugins,
  setOpenClawPluginEnabledForControlCenter,
  setupClawTalkPlugin,
  tryRestartGatewayService,
  uninstallOpenClawPlugin,
  updateAllOpenClawPlugins,
  updateOpenClawPlugin,
  writeSseEvent,
})







const RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md',
  'TOOLS.md',
  'MISSION_PROMPT.md',
]

function normalizeRecruitMarkdownFileName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!cleaned) return ''
  const withExtension = cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`
  return /^[^\\/]+\.md$/i.test(withExtension) ? withExtension : ''
}

const RECRUIT_PERSONALITY_DEPTH_LABELS = ['Basic', 'Guided', 'Detailed', 'Signature', 'Max'] as const

function normalizeRecruitPersonalityDepth(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 3
  return Math.min(RECRUIT_PERSONALITY_DEPTH_LABELS.length, Math.max(1, Math.round(numeric)))
}

function recruitPersonalityDepthGuidance(value: unknown) {
  const depth = normalizeRecruitPersonalityDepth(value)
  const label = RECRUIT_PERSONALITY_DEPTH_LABELS[depth - 1]
  const shared = [
    `- Persona detail: ${label} (${depth}/5).`,
    '- Build only from the supplied name, class, role, behavior profile, level, capabilities, and draft context.',
    '- Do not invent private biography, credentials, relationships, secrets, or external account details.',
    '- If the name resembles a real person, create an inspired operational agent persona; do not claim the agent is that person.',
  ]

  if (depth <= 1) {
    return [
      ...shared,
      '- Keep personality lightweight: one concise operating style, a few decision rules, and practical boundaries.',
      '- Avoid elaborate voice mimicry, backstory, catchphrases, or cadence sections.',
    ].join('\n')
  }

  if (depth === 2) {
    return [
      ...shared,
      '- Add clear traits, preferred working patterns, collaboration style, and guardrails.',
      '- Include a short voice profile, but keep cadence notes minimal and utilitarian.',
    ].join('\n')
  }

  if (depth === 3) {
    return [
      ...shared,
      '- Produce a detailed persona with motivations, working preferences, decision posture, communication tone, and failure handling.',
      '- Add reusable voice notes for phrasing, pacing, directness, and how the agent explains uncertainty.',
    ].join('\n')
  }

  if (depth === 4) {
    return [
      ...shared,
      '- Produce signature-level doctrine: voice, cadence, rituals, pressure behavior, escalation style, and collaboration habits.',
      '- Make MISSION_PROMPT.md and SOUL.md carry specific behavioral texture future turns can follow consistently.',
      '- Include examples of phrasing patterns without copying protected text or turning the agent into a deceptive impersonation.',
    ].join('\n')
  }

  return [
    ...shared,
    '- Produce a near-complete persona configuration with voice cadence, phrasing habits, rhythm, decision posture, rituals, boundaries, and failure modes.',
    '- Make the personality close to the supplied person/role seed when enough detail is provided, but keep it framed as an agent persona.',
    '- Add specific "speaks like", "avoids", "when blocked", "when confident", and "when challenged" guidance where it fits the requested files.',
    '- Encode cadence in operational terms: sentence length, pacing, directness, humor level, evidence habits, and how it handles disagreement.',
  ].join('\n')
}

function extractRecruitAutoForgeJson(raw: string) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidates = [trimmed, fenced].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (isLooseRecord(parsed)) return parsed
    } catch {
      // Try a bounded object slice below.
    }
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
        if (isLooseRecord(parsed)) return parsed
      } catch {
        // Keep trying other candidates.
      }
    }
  }
  throw new Error(`Model did not return a JSON object. Preview: ${trimTask(raw, 400)}`)
}

function recruitAutoForgePrompt(input: {
  name: string
  agentId?: string
  className: string
  role: string
  behaviorProfile?: string
  level?: number
  personalityDepth?: number
  capabilities: Record<string, boolean>
  files: string[]
  currentFiles: Record<string, string>
}) {
  const capabilityLines = Object.entries(input.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([key]) => `- ${key}`)
    .join('\n') || '- none declared'
  const currentFileContext = input.files
    .map((file) => {
      const draft = input.currentFiles[file]?.trim()
      return draft ? `### ${file}\n${trimTask(draft, 900)}` : `### ${file}\n(no draft)`
    })
    .join('\n\n')

  return [
    'You are the Automnia Agent Auto Forge.',
    'Generate complete bootstrap doctrine markdown for a newly recruited coding agent.',
    'Return only strict JSON. No prose, no markdown fences, no comments.',
    '',
    'Required JSON shape:',
    '{"files":[{"file":"IDENTITY.md","content":"# IDENTITY.md - ...\\n..."}]}',
    '',
    'Rules:',
    '- Include exactly one entry for every requested file name.',
    '- Every content value must be a complete Markdown document string.',
    '- Keep the agent identity coherent with the name, class, and role.',
    '- Make the files operational: identity, behavior, workflow, tools, memory, heartbeat, and mission framing should be usable on first run.',
    '- Do not invent secrets, credentials, real private facts, or external account details.',
    '- Use concise, direct engineering language.',
    '',
    'Personality depth guidance:',
    recruitPersonalityDepthGuidance(input.personalityDepth),
    '',
    'Agent seed:',
    `- Name: ${input.name}`,
    `- Agent ID: ${input.agentId || 'not assigned yet'}`,
    `- Class: ${input.className}`,
    `- Role: ${input.role}`,
    `- Behavior profile: ${input.behaviorProfile || 'hybrid'}`,
    `- Level: ${input.level || 18}`,
    `- Persona detail level: ${normalizeRecruitPersonalityDepth(input.personalityDepth)}/5`,
    '- Enabled capabilities:',
    capabilityLines,
    '',
    'Requested files:',
    input.files.map((file) => `- ${file}`).join('\n'),
    '',
    'Current draft context, for continuity only:',
    currentFileContext,
  ].join('\n')
}

function normalizeRecruitAutoForgeFiles(parsed: Record<string, unknown>, expectedFiles: string[]) {
  const fileMap = new Map<string, { file: string; content: string }>()
  const addEntry = (fileValue: unknown, contentValue: unknown) => {
    if (typeof fileValue !== 'string' || typeof contentValue !== 'string') return
    const file = normalizeRecruitMarkdownFileName(fileValue)
    const content = contentValue.trim()
    if (!file || !content) return
    fileMap.set(file.toLowerCase(), { file, content: content.endsWith('\n') ? content : `${content}\n` })
  }

  const files = parsed.files
  if (Array.isArray(files)) {
    for (const item of files) {
      if (!isLooseRecord(item)) continue
      addEntry(item.file, item.content)
    }
  }

  const markdown = parsed.markdown
  if (isLooseRecord(markdown)) {
    for (const [file, content] of Object.entries(markdown)) addEntry(file, content)
  }

  const expected = expectedFiles.map(normalizeRecruitMarkdownFileName).filter(Boolean)
  const missing = expected.filter((file) => !fileMap.has(file.toLowerCase()))
  if (missing.length) {
    throw new Error(`Model response omitted required markdown file(s): ${missing.join(', ')}`)
  }

  return expected.map((file) => fileMap.get(file.toLowerCase())!)
}

async function generateRecruitAutoForgeMarkdown(input: {
  modelId: string
  prompt: string
  signal: AbortSignal
}) {
  const canonicalModelId = canonicalAgentModelId(input.modelId)
  const { provider: modelProvider, model } = splitModelId(canonicalModelId)
  const isCodexSubscriptionTurn = isOpenAiCodexSubscriptionModel(canonicalModelId)
  let provider = isCodexSubscriptionTurn ? 'openai' : modelProvider
  let providerConfig = STREAMING_PROVIDER_CONFIG[provider]
  if (!providerConfig) {
    const error = new Error(`Auto Forge inference is not wired for provider "${provider || modelProvider}". Select OpenAI, OpenAI Codex, Anthropic, Google, Google Vertex, or DeepSeek.`)
    ;(error as Error & { statusCode?: number; provider?: string }).statusCode = 400
    ;(error as Error & { statusCode?: number; provider?: string }).provider = provider || modelProvider
    throw error
  }

  await ensureLocalAuthStoreLoaded().catch(() => undefined)
  const authProblem = modelAuthProblem(canonicalModelId)
  if (authProblem) {
    const error = new Error(`Missing auth for ${authProblem.provider}. Connect this provider before using Auto Forge.`)
    ;(error as Error & { statusCode?: number; provider?: string; providerStatus?: unknown }).statusCode = 409
    ;(error as Error & { statusCode?: number; provider?: string; providerStatus?: unknown }).provider = authProblem.provider
    ;(error as Error & { statusCode?: number; provider?: string; providerStatus?: unknown }).providerStatus = authProblem.providerStatus
    throw error
  }

  const envOverrides = getLocalAuthEnv()
  const openAiSubscriptionAuth = isCodexSubscriptionTurn
    ? await resolveOpenAiSubscriptionRequestAuth(envOverrides)
    : null
  if (openAiSubscriptionAuth) {
    provider = openAiSubscriptionAuth.provider
    providerConfig = openAiSubscriptionAuth.providerConfig
  }
  const requestAuth: ProviderRequestAuth | null = openAiSubscriptionAuth
    ? openAiSubscriptionAuth.requestAuth
    : await resolveProviderRequestAuth(provider, envOverrides, providerConfig.envKeys)

  if (!requestAuth) {
    const error = new Error(`No usable credential is configured for ${provider}. Connect the provider or set the required environment key before using Auto Forge.`)
    ;(error as Error & { statusCode?: number; provider?: string }).statusCode = 401
    ;(error as Error & { statusCode?: number; provider?: string }).provider = provider
    throw error
  }

  const messages: ProviderConversationMessage[] = [{ role: 'user', content: input.prompt }]
  const emit: StreamEmitter = () => undefined
  const thinking: ThinkingLevel = 'minimal'
  const effectiveKind: StreamingProviderKind = provider === 'openai' && requestAuth.type === 'oauth'
    ? 'openai-codex-responses'
    : providerConfig.kind

  if (providerConfig.kind === 'openai-compatible') {
    if (requestAuth.type !== 'apiKey') throw new Error(`${provider} Auto Forge requires an API key credential.`)
    return streamOpenAiCompatibleCompletion({
      provider,
      model,
      endpoint: providerConfig.endpoint || '',
      apiKey: requestAuth.value,
      messages,
      thinking,
      signal: input.signal,
      emit,
    })
  }

  if (effectiveKind === 'openai-responses') {
    if (requestAuth.type !== 'apiKey') throw new Error('OpenAI Auto Forge requires an API key credential.')
    return streamOpenAiResponsesCompletion({
      provider,
      model,
      endpoint: providerConfig.endpoint || 'https://api.openai.com/v1/responses',
      apiKey: requestAuth.value,
      messages,
      thinking,
      signal: input.signal,
      emit,
    })
  }

  if (effectiveKind === 'openai-codex-responses') {
    if (requestAuth.type !== 'oauth') throw new Error('OpenAI Codex Auto Forge requires an OpenAI Codex OAuth credential.')
    return streamOpenAICodexResponsesCompletion({
      model,
      accessToken: requestAuth.accessToken,
      messages,
      thinking,
      sessionId: randomUUID(),
      signal: input.signal,
      emit,
    })
  }

  if (providerConfig.kind === 'anthropic-messages') {
    return streamAnthropicMessage({
      model,
      auth: requestAuth,
      messages,
      thinking,
      signal: input.signal,
      emit,
    })
  }

  if (providerConfig.kind === 'gemini-vertex-generate-content') {
    return streamGoogleVertexContent({
      model,
      auth: requestAuth,
      messages,
      thinking,
      signal: input.signal,
      emit,
    })
  }

  return streamGeminiContent({
    model,
    auth: requestAuth,
    messages,
    thinking,
    signal: input.signal,
    emit,
  })
}















export type PartyManagementRoutesContext = {
  CANONICAL_DOCTRINE_ONLY: typeof CANONICAL_DOCTRINE_ONLY
  RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES: typeof RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES
  WORKSPACE_ROOT: typeof WORKSPACE_ROOT
  agencyAgentTemplateSourceRoot: typeof AGENCY_AGENT_TEMPLATE_SOURCE_ROOT
  agencyAgentTemplateStateFilePath: typeof AGENCY_AGENT_TEMPLATE_STATE_PATH
  agencyAgentTemplateStateKey: typeof CONTROL_CENTER_STATE_KEYS.agencyAgentTemplates
  agentLocalConfigPath: typeof agentLocalConfigPath
  applyExecutionWorkspaceToLocalConfig: typeof applyExecutionWorkspaceToLocalConfig
  applyLocalConfigToGlobal: typeof applyLocalConfigToGlobal
  assertAvatarImageUploadSignature: typeof assertAvatarImageUploadSignature
  assertAvatarUploadBytes: typeof assertAvatarUploadBytes
  avatarUploadLimitBytes: typeof AVATAR_UPLOAD_LIMIT_BYTES
  avatarUploadLimitErrorMessage: typeof avatarUploadLimitErrorMessage
  avatarUploadFileName: typeof avatarUploadFileName
  canonicalAgentModelId: typeof canonicalAgentModelId
  canonicalDoctrineRoot: typeof canonicalDoctrineRoot
  cleanupAgentWorkspaceDoctrineFiles: typeof cleanupAgentWorkspaceDoctrineFiles
  clearAgentTurnSessions: typeof clearAgentTurnSessions
  clearDisallowedAutoModelOverridesForAgent: typeof clearDisallowedAutoModelOverridesForAgent
  configSafeAgentAvatar: typeof configSafeAgentAvatar
  contentTypeFromExt: typeof contentTypeFromExt
  defaultAgentWorkspace: typeof defaultAgentWorkspace
  deriveAgentAliases: typeof deriveAgentAliases
  ensureAgentLocalConfig: typeof ensureAgentLocalConfig
  ensureAgentPersistence: typeof ensureAgentPersistence
  ensureConfiguredModelAllowlist: typeof ensureConfiguredModelAllowlist
  extractRecruitAutoForgeJson: typeof extractRecruitAutoForgeJson
  generateRecruitAutoForgeMarkdown: typeof generateRecruitAutoForgeMarkdown
  getAgentById: typeof getAgentById
  getPartyMembers: typeof getPartyMembers
  isLegacyGenericRecruitAttributes: typeof isLegacyGenericRecruitAttributes
  isLegacyGenericRecruitHeartbeat: typeof isLegacyGenericRecruitHeartbeat
  isLegacyGenericRecruitMds: typeof isLegacyGenericRecruitMds
  isLegacyGenericRecruitRuntime: typeof isLegacyGenericRecruitRuntime
  isLegacyGenericRecruitSoul: typeof isLegacyGenericRecruitSoul
  isOpenAiCodexSubscriptionModel: typeof isOpenAiCodexSubscriptionModel
  isRetiredAgentId: typeof isRetiredAgentId
  isValidAgentId: typeof isValidAgentId
  modelAuthProblem: typeof modelAuthProblem
  modelSelectionBlocked: typeof modelSelectionBlocked
  normalizeAgentMdsState: typeof normalizeAgentMdsState
  normalizeAgentToolsConfig: typeof normalizeAgentToolsConfig
  normalizeModelWithFallback: typeof normalizeModelWithFallback
  normalizeRecruitAutoForgeFiles: typeof normalizeRecruitAutoForgeFiles
  normalizeRecruitMarkdownFileName: typeof normalizeRecruitMarkdownFileName
  normalizeRecruitPersonalityDepth: typeof normalizeRecruitPersonalityDepth
  normalizeSandboxConfig: typeof normalizeSandboxConfig
  persistAgentAvatarBytes: typeof persistAgentAvatarBytes
  persistAgentAvatarFromPath: typeof persistAgentAvatarFromPath
  purgeAgentState: typeof purgeAgentState
  readAgencyAgentTemplateCatalog: typeof runtimeLedgerStore.readAgencyAgentTemplateCatalog
  readControlCenterStateRecord: typeof readControlCenterStateRecord
  readOpenclawConfig: typeof readOpenclawConfig
  readPartyProfiles: typeof readPartyProfiles
  recoverLocalAgentEntries: typeof recoverLocalAgentEntries
  recruitAttributesFromProfile: typeof recruitAttributesFromProfile
  recruitAutoForgePrompt: typeof recruitAutoForgePrompt
  recruitHeartbeatDefaults: typeof recruitHeartbeatDefaults
  recruitMdsDefaults: typeof recruitMdsDefaults
  recruitRuntimeDefaults: typeof recruitRuntimeDefaults
  recruitSoulDefaults: typeof recruitSoulDefaults
  rememberAgentLocalConfigCache: typeof rememberAgentLocalConfigCache
  resolveDoctrineWorkspaceForRun: typeof resolveDoctrineWorkspaceForRun
  runOpenClaw: typeof runOpenClaw
  samePath: typeof samePath
  sanitizeProfile: typeof sanitizeProfile
  schedulePluginGatewayRestart: typeof schedulePluginGatewayRestart
  seedAgentWorkspace: typeof seedAgentWorkspace
  splitModelId: typeof splitModelId
  syncAgentDerivedFiles: typeof syncAgentDerivedFiles
  syncAgentProjectionToGlobal: typeof syncAgentProjectionToGlobal
  terminateOpenClawRunsForSession: typeof terminateOpenClawRunsForSession
  validateWorkspaceAccess: typeof validateWorkspaceAccess
  workspaceAccessFailurePayload: typeof workspaceAccessFailurePayload
  writeAgencyAgentTemplateCatalog: typeof runtimeLedgerStore.writeAgencyAgentTemplateCatalog
  writeControlCenterStateRecord: typeof writeControlCenterStateRecord
  writeOpenclawConfig: typeof writeOpenclawConfig
  writePartyProfiles: typeof writePartyProfiles
  writeTextFileWithLockRetry: typeof writeTextFileWithLockRetry
}

const partyManagementRoutesContext: PartyManagementRoutesContext = {
  CANONICAL_DOCTRINE_ONLY,
  RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES,
  WORKSPACE_ROOT,
  agencyAgentTemplateSourceRoot: AGENCY_AGENT_TEMPLATE_SOURCE_ROOT,
  agencyAgentTemplateStateFilePath: AGENCY_AGENT_TEMPLATE_STATE_PATH,
  agencyAgentTemplateStateKey: CONTROL_CENTER_STATE_KEYS.agencyAgentTemplates,
  agentLocalConfigPath,
  applyExecutionWorkspaceToLocalConfig,
  applyLocalConfigToGlobal,
  assertAvatarImageUploadSignature,
  assertAvatarUploadBytes,
  avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES,
  avatarUploadLimitErrorMessage,
  avatarUploadFileName,
  canonicalAgentModelId,
  canonicalDoctrineRoot,
  cleanupAgentWorkspaceDoctrineFiles,
  clearAgentTurnSessions,
  clearDisallowedAutoModelOverridesForAgent,
  configSafeAgentAvatar,
  contentTypeFromExt,
  defaultAgentWorkspace,
  deriveAgentAliases,
  ensureAgentLocalConfig,
  ensureAgentPersistence,
  ensureConfiguredModelAllowlist,
  extractRecruitAutoForgeJson,
  generateRecruitAutoForgeMarkdown,
  getAgentById,
  getPartyMembers,
  isLegacyGenericRecruitAttributes,
  isLegacyGenericRecruitHeartbeat,
  isLegacyGenericRecruitMds,
  isLegacyGenericRecruitRuntime,
  isLegacyGenericRecruitSoul,
  isOpenAiCodexSubscriptionModel,
  isRetiredAgentId,
  isValidAgentId,
  modelAuthProblem,
  modelSelectionBlocked,
  normalizeAgentMdsState,
  normalizeAgentToolsConfig,
  normalizeModelWithFallback,
  normalizeRecruitAutoForgeFiles,
  normalizeRecruitMarkdownFileName,
  normalizeRecruitPersonalityDepth,
  normalizeSandboxConfig,
  persistAgentAvatarBytes,
  persistAgentAvatarFromPath,
  purgeAgentState,
  readAgencyAgentTemplateCatalog: runtimeLedgerStore.readAgencyAgentTemplateCatalog,
  readControlCenterStateRecord,
  readOpenclawConfig,
  readPartyProfiles,
  recoverLocalAgentEntries,
  recruitAttributesFromProfile,
  recruitAutoForgePrompt,
  recruitHeartbeatDefaults,
  recruitMdsDefaults,
  recruitRuntimeDefaults,
  recruitSoulDefaults,
  rememberAgentLocalConfigCache,
  resolveDoctrineWorkspaceForRun,
  runOpenClaw,
  samePath,
  sanitizeProfile,
  schedulePluginGatewayRestart,
  seedAgentWorkspace,
  splitModelId,
  syncAgentDerivedFiles,
  syncAgentProjectionToGlobal,
  terminateOpenClawRunsForSession,
  validateWorkspaceAccess,
  workspaceAccessFailurePayload,
  writeAgencyAgentTemplateCatalog: runtimeLedgerStore.writeAgencyAgentTemplateCatalog,
  writeControlCenterStateRecord,
  writeOpenclawConfig,
  writePartyProfiles,
  writeTextFileWithLockRetry,
}

registerPartyManagementRoutes(app, partyManagementRoutesContext)

registerFilesystemRoutes(app, {
  agentLocalConfigPath,
  applyLocalConfigToGlobal: (agentId, local, config) => applyLocalConfigToGlobal(agentId, local as AgentLocalConfig, config),
  canonicalResourcePath,
  deriveAgentAliases,
  editorResourceFiles: EDITOR_RESOURCE_FILES,
  ensureAgentLocalConfig: (params) => ensureAgentLocalConfig(params),
  extractIdentityNameFromMarkdown,
  getAgentById,
  isMarkdownResourceFile,
  isValidAgentId,
  mirrorSharedTeamFile: (file, content) => mirrorSharedTeamFile(file as SharedTeamFile, content),
  pickerSessions: pickerSessionService,
  propagateDisplayNameAcrossAgentFiles: (agentId, previousName, local) => propagateDisplayNameAcrossAgentFiles(agentId, previousName, local as AgentLocalConfig),
  readAgentLocalConfigIfPresent,
  rememberAgentLocalConfigCache: (filePath, local) => rememberAgentLocalConfigCache(filePath, local as AgentLocalConfig),
  resetAgentTurnSessionsForAgentContextChange,
  resolveAgentResourceContext: (agentId, seedFiles) => resolveAgentResourceContext(agentId, seedFiles as readonly AgentResourceFile[] | undefined),
  resolveWorkspaceForAgent,
  samePath,
  saveAgentFileToCodexProfile,
  sharedTeamFiles: SHARED_TEAM_FILES,
  syncAgentDerivedFiles: (agentId, local) => syncAgentDerivedFiles(agentId, local as AgentLocalConfig),
  syncDoctrineToWorkspace,
  workspaceRoot: WORKSPACE_ROOT,
  writeOpenclawConfig: (config) => writeOpenclawConfig(config),
  writeTextFileWithLockRetry,
})

registerPartyCoordinationRoutes(app, {
  CANONICAL_DOCTRINE_ONLY,
  ENABLE_HOST_ACTION_SHORTCUTS,
  agentWorkTimeoutWrapperMs,
  appendAgentDailyMemory,
  appendAgentPromptDump,
  buildBrowserRecoveryInstruction,
  buildDispatchExecutionDirective,
  buildWebsiteContributionDirective,
  checkBrowserPreflight,
  cleanupDoctrineMirrorsAfterRun,
  composeAgentDoctrinePrompt,
  computePeakConcurrency,
  detectHostActionRequest,
  ensureTeamSyncFile,
  extractAgentReply,
  getAgentAuthEnv,
  getAgentToAgentPolicy,
  getPartyMembers,
  hasBrowserRelayDisconnected,
  hasBrowserRelayPortConflict,
  isAgentAllowedByPolicy,
  isBrowserServiceReadyOnlyReply,
  isPathUnder,
  isRetiredAgentId,
  isSharedWebsiteCollaboration,
  isValidAgentId,
  launchChromeHost,
  resolveAgentRunContext,
  resolveEffectiveAgentWorkTimeoutSeconds,
  resolveFilenameHintsForMessage,
  resolveSharedTeamSyncPath,
  runCwdForContext,
  runOpenClaw,
  runOpenClawWithGeminiToolWritePolicy,
  samePath,
  shouldRouteBrowserIntentThroughBrowserPlugin,
  splitTextForAppend,
  trimTask,
  tryReleaseBrowserRelayPort,
  tryRestartGatewayService,
  withAgentRuntimeFlags,
  writeTeamSyncSnapshot,
})

registerMissionRoutes(app, {
  buildMissionLifecycleProjection: buildReconciledMissionLifecycleProjection,
  listMissionReports,
  missionStateService,
  readMissionEvents: (limit) => runtimeLedgerStore.readMissionEvents<MissionLifecycleEvent>(limit).catch(() => []),
})

const gatewayAgentTurnService = createGatewayAgentTurnService({
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  openClawAgentTurnTimeoutFloorSeconds: OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS,
  trafficGate: () => licenseService.getTrafficGate(),
  reconcileBillingAccess: async () => {
    // Refresh the provisioner-owned entitlement and then confirm the live
    // Gateway route. A successful route reconciliation is enough to retry a
    // stale-origin/auth failure; the traffic gate still blocks a confirmed
    // zero balance for credits-only accounts.
    await licenseService.refresh().catch(() => undefined)
    try {
      await synchronizeBillingRouteWithGateway()
      return licenseService.isActive()
    } catch {
      return false
    }
  },
  isValidAgentId,
  isRetiredAgentId,
  streamObserver: gatewayChatStreamObserver,
  ensureOpenclawAgentRunConfigDefaults,
  readOpenclawConfig,
  ensureAgentRuntimeHealthPreflight: async (agentId, runtimeConfig) => {
    await ensureAgentRuntimeHealthPreflight(agentId, runtimeConfig as OpenClawConfigFile)
  },
  ensureAgentSandboxCompatibleWithHost,
  startGatewayHealthMonitor,
  ensureGatewayRunning,
  isGatewayHealthy,
  isClawTalkSetupIntentMessage,
  isClawTalkIntentMessage,
  buildClawTalkRuntimeInstruction,
  readAgentPrimaryModelIdSync,
  isGoogleGeminiModelId,
  thinkingForOpenClawRuntimeModel,
  resolveEffectiveAgentFastMode,
  resolveEffectiveAgentWorkTimeoutSeconds,
  resolveAgentRunContext,
  agentTurnSessionScope,
  agentTurnSessions,
  deleteProviderConversationHistory: (sessionId) => {
    providerConversationHistories.delete(sessionId)
  },
  resolveFilenameHintsForMessage,
  getPartyMembers,
  composeAgentDoctrinePrompt,
  runCwdForContext,
  agentWorkTimeoutWrapperMs,
  appendAgentPromptDump,
  runGatewayChatTurn: runControlCenterGatewayChatTurn,
  extractAgentReply,
})

const runGatewayAgentTurnForStream = gatewayAgentTurnService.runGatewayAgentTurnForStream

const bufferedAgentTurnService = createBufferedAgentTurnService({
  registerGatewayChatStreamObserver,
  runGatewayAgentTurnForStream,
  delayMs,
  prewarmControlCenterGatewayAgentRuntime: (source) => {
    void prewarmControlCenterGatewayAgentRuntime(source)
  },
  activeOpenClawRuns: () => activeOpenClawRuns.values(),
  postLocalJsonNoHeaderTimeout,
  unwrapCanonicalApiPayload,
  trimTask,
  sanitizeUserVisibleRuntimeText,
  redactHiddenReasoningAndSecrets,
  classifyFailureKind,
})

const runBufferedAgentTurnForStream = bufferedAgentTurnService.runBufferedAgentTurnForStream

const agentRuntimeService = createAgentRuntimeService({
  controlCenterGatewayAgentSessions: CONTROL_CENTER_GATEWAY_AGENT_SESSIONS,
  forceLocalAgentRuntime: FORCE_LOCAL_AGENT_RUNTIME,
  allowLocalAgentRuntimeFallback: CONTROL_CENTER_ALLOW_LOCAL_AGENT_FALLBACK,
  controlCenterGatewayChatClient: CONTROL_CENTER_GATEWAY_CHAT_CLIENT,
  gatewayHttpPort: GATEWAY_HTTP_PORT,
  trafficGate: () => licenseService.getTrafficGate(),
  runOpenClawWithGeminiToolWritePolicy,
  withAgentRuntimeFlags,
  ensureGatewayRunning,
  startGatewayHealthMonitor,
  isGatewayHealthy,
  runControlCenterGatewayChatTurn,
  classifyFailureKind,
  redactSensitiveText,
})

const runControlCenterAgentRuntimeTurn = agentRuntimeService.runControlCenterAgentRuntimeTurn

const agentStreamingService = createAgentStreamingService({
  streamingProviderConfig: STREAMING_PROVIDER_CONFIG,
  isValidAgentId,
  isRetiredAgentId,
  parseAgentRuntimeShortcut,
  agentRuntimeShortcutReason,
  bufferedAgentRuntimeReason,
  getHostedRelayCredentials: () => licenseService.getActiveRelayCredentials(),
  trafficGate: () => licenseService.getTrafficGate(),
  reconcileHostedCreditBalance: async () => {
    const status = await licenseService.refresh()
    return { creditBalance: status.creditBalance }
  },
  synchronizeHostedBillingRoute: () => synchronizeBillingRouteWithGateway(),
  runBufferedAgentTurnForStream,
  resolveAgentPrimaryModelId,
  openAiCodexEmbeddedRuntimeReason,
  googleGeminiEmbeddedRuntimeReason,
  splitModelId,
  isOpenAiCodexSubscriptionModel,
  getAgentAuthEnv,
  resolveOpenAiSubscriptionRequestAuth,
  resolveProviderRequestAuth,
  anthropicSubscriptionAvailable: () => Boolean(providerAuthStatus('anthropic').subscriptionAuth?.configured),
  streamingCapabilityForModel,
  resolveAgentRunContext,
  agentTurnSessionScope,
  agentTurnSessions,
  deleteProviderConversationHistory: (sessionId) => {
    providerConversationHistories.delete(sessionId)
  },
  resolveFilenameHintsForMessage,
  getPartyMembers,
  composeDirectProviderPrompt,
  providerConversationMessagesForRequest,
  streamOpenAiCompatibleCompletion,
  streamOpenAiResponsesCompletion,
  streamOpenAICodexResponsesCompletion,
  streamAnthropicMessage,
  streamGoogleVertexContent,
  streamGeminiContent,
  classifyFailureKind,
  redactHiddenReasoningAndSecrets,
  appendAgentDailyMemory,
  trimTask,
  cleanupDoctrineMirrorsAfterRun,
  sanitizeUserVisibleRuntimeText,
  saveProviderConversationTurn,
  buildDoctrineSyncReport,
  agentRuntimeContextPayload,
  providerConversationMessageCount: (sessionId) => providerConversationHistories.get(sessionId)?.messages.length || 0,
})

const streamProviderAgentTurn = agentStreamingService.streamProviderAgentTurn

let billingRouteSyncPromise: Promise<void> = Promise.resolve()
let billingRouteSyncLoop: Promise<void> | null = null
let billingRouteSyncVersion = 0
let gatewayPausedForTrafficGate = false

async function synchronizeBillingRoutePass(version: number) {
  const beforeConfig = await readOpenclawConfig().catch(() => null)
  const beforeRoute = automniaBillingRouteSnapshot(beforeConfig)
  await synchronizeOpenClawBillingRoute()
  const afterConfig = await readOpenclawConfig().catch(() => null)
  const afterRoute = automniaBillingRouteSnapshot(afterConfig)

  // A newer request owns the desired state. Do not restart the Gateway for a
  // superseded route; the loop will apply only the latest policy next.
  if (version !== billingRouteSyncVersion) return

  const gate = licenseService.getTrafficGate()
  if (gate.blocked) {
    gatewayPausedForTrafficGate = true
    await stopGatewayRuntime('Automnia traffic gate blocked Gateway and channel traffic').catch((error) => {
      pushGatewayLog('stderr', `Gateway stop for the Automnia traffic gate failed: ${String(error)}`, 'warning')
    })
    pushGatewayLog('lifecycle', gate.blockMessage || 'Gateway and channel traffic paused by the Automnia traffic gate.', 'warning')
    return
  }
  if (gatewayPausedForTrafficGate) {
    gatewayPausedForTrafficGate = false
    await ensureGatewayRunning()
    startGatewayHealthMonitor()
  }

  // Ignore unrelated/dynamic OpenClaw metadata. A route change is first sent
  // through the authenticated config.patch RPC, which OpenClaw hot-reloads
  // for models and agents. A full restart is reserved for a failed patch or a
  // Gateway that cannot confirm the exact route.
  if (beforeRoute !== afterRoute) {
    const hotReload = await applyBillingRouteViaGatewayConfigPatch(afterConfig || await readOpenclawConfig())
    if (version !== billingRouteSyncVersion) return
    if (!hotReload.ok) {
      pushGatewayLog(
        'lifecycle',
        `Usage priority changed; Gateway hot reload was unavailable, so Automnia is restarting the Gateway automatically. ${trimTask(hotReload.detail, 240)}`,
        'warning',
      )
      console.warn(`[license-restart] Gateway billing route hot reload unavailable: ${trimTask(hotReload.detail, 320)}`)
      const restart = await tryRestartGatewayService({ force: true, reason: 'subscription tier change synchronization' })
      if (!restart.restarted) {
        const detail = restart.detail ? ` ${restart.detail}` : ''
        pushGatewayLog('stderr', `Usage priority route could not become ready after the automatic Gateway restart.${detail}`, 'error')
        throw new Error(`OpenClaw route changed but the Gateway did not become ready.${detail}`)
      }
    } else {
      pushGatewayLog('lifecycle', `Usage priority route active before the next agent call (${hotReload.elapsedMs}ms).`)
      console.log(`[license-restart] ${hotReload.detail} in ${hotReload.elapsedMs}ms`)
    }
  } else {
    console.log('[license-restart] OpenClaw configuration did not change, skipping gateway restart')
  }
}

const synchronizeBillingRouteWithGateway = () => {
  billingRouteSyncVersion += 1
  if (!billingRouteSyncLoop) {
    const loop = (async () => {
      while (true) {
        const version = billingRouteSyncVersion
        try {
          await synchronizeBillingRoutePass(version)
        } catch (error) {
          // If another switch arrived while this pass failed, its desired
          // state is still actionable; retry the latest version instead of
          // surfacing a stale failure to the settings request.
          if (version !== billingRouteSyncVersion) continue
          throw error
        }
        if (version === billingRouteSyncVersion) {
          // A successful pass clears the barrier. If the loop rejects, the
          // rejected promise intentionally remains visible to agent turns so
          // they cannot run against an unconfirmed route.
          billingRouteSyncPromise = Promise.resolve()
          return
        }
      }
    })()
    billingRouteSyncLoop = loop
    billingRouteSyncPromise = loop
    void loop.finally(() => {
      if (billingRouteSyncLoop === loop) {
        billingRouteSyncLoop = null
      }
    }).catch(() => undefined)
  }
  return billingRouteSyncLoop || Promise.resolve()
}

registerAgentTurnRoutes(app, {
  AUTH_TOKEN,
  CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK,
  ENABLE_HOST_ACTION_SHORTCUTS,
  MIN_BROWSER_TIMEOUT_SECONDS,
  OPENCLAW_AGENT_TURN_TIMEOUT_FLOOR_SECONDS,
  OPENCLAW_STATE_ROOT,
  OPENCLAW_TIMEOUT_RECOVERY_SECONDS,
  PORT,
  SSE_DELTA_CHUNK_CHARS,
  SSE_FINAL_TEXT_LIMIT,
  agentRuntimeContextPayload,
  agentTurnSessionScope,
  agentTurnSessions,
  agentWorkTimeoutWrapperMs,
  appendAgentDailyMemory,
  appendAgentPromptDump,
  buildBrowserRecoveryInstruction,
  buildClawTalkRuntimeInstruction,
  buildDoctrineSyncReport,
  buildRuntimeTimeoutContinuationInstruction,
  checkBrowserPreflight,
  classifyFailureKind,
  cleanupDoctrineMirrorsAfterRun,
  cleanupOpenClawSessionLocks,
  clearAgentTurnSessions,
  compactClawTalkConsoleValue,
  compactFinalSsePayload,
  compactHttpJsonPayload,
  composeAgentDoctrinePrompt,
  delayMs,
  detectHostActionRequest,
  emitClawTalkConsoleFrame,
  ensureAgentRuntimeHealthPreflight,
  ensureAgentSandboxCompatibleWithHost,
  ensureOpenclawAgentRunConfigDefaults,
  extractAgentReply,
  fileExists,
  getAgentAuthEnv,
  getAgentToAgentPolicy,
  getPartyMembers,
  hasBrowserRelayDisconnected,
  hasBrowserRelayPortConflict,
  initializeSseResponse,
  isAgentAllowedByPolicy,
  isAgentRuntimeTimeoutResult,
  isBrowserServiceReadyOnlyReply,
  isClawTalkIntentMessage,
  isClawTalkSetupIntentMessage,
  isContextOverflowReply,
  isEmptyAgentNoResponseReply,
  isGoogleGeminiModelId,
  isHostedCreditsActive: () => {
    const hosted = licenseService.getActiveRelayCredentials()
    return Boolean(hosted && hosted.usagePriority !== 'byok_only')
  },
  hostedUsagePriority: () => {
    return effectiveHostedUsagePriority()
  },
  hostedCreditsOnlyBlocker: () => {
    const status = licenseService.getStatus()
    if (!status.active || status.usagePriority !== 'automnia_only' || status.creditBalance !== 0 || !licenseService.isUsagePriorityLocked()) return null
    return 'Automnia credits are unavailable because the confirmed balance is 0. Refill your Automnia credits in Settings → Account & License to continue.'
  },
  awaitBillingRouteReady: () => billingRouteSyncPromise,
  billingRoutePresentation: () => {
    const status = licenseService.getStatus()
    const usagePriority = effectiveHostedUsagePriority()
    if (!status.active || !usagePriority) return null
    const billingRoute = usagePriority === 'automnia_only'
      ? 'automnia-only'
      : usagePriority === 'automnia_first_with_provider_fallback'
        ? 'automnia-first'
        : usagePriority === 'provider_first'
          ? 'provider-first'
          : 'provider-only'
    return { usagePriority, billingRoute }
  },
  isRetiredAgentId,
  isValidAgentId,
  launchChromeHost,
  openClawErrorResult,
  parseAgentRuntimeShortcut,
  parseDelegationIntent,
  providerConversationHistories,
  readAgentPrimaryModelIdSync,
  readOpenclawConfig,
  redactHiddenReasoningAndSecrets,
  redactSensitiveText,
  rememberClawTalkConsoleMirror,
  resolveAgentReference,
  resolveAgentRunContext,
  resolveEffectiveAgentWorkTimeoutSeconds,
  resolveFilenameHintsForMessage,
  resolveGoogleGeminiArtifactTarget,
  runControlCenterAgentRuntimeTurn,
  runCwdForContext,
  runtimeTimeoutResumeAdvice,
  shouldRouteBrowserIntentThroughBrowserPlugin,
  shouldUseGoogleGeminiMinimalToolWriteRuntime,
  splitTextForSse,
  streamProviderAgentTurn,
  thinkingForOpenClawRuntimeModel,
  trimTask,
  tryGoogleGeminiDirectArtifactWriteFallback,
  tryReleaseBrowserRelayPort,
  tryRestartGatewayService,
  unwrapCanonicalApiPayload,
  withRuntimeTimeoutResumeAdvice,
  writeSseEvent,
})

registerClawTalkConsoleRoutes(app, {
  clawTalkConsoleClients,
  clawTalkConsoleEvents,
  initializeSseResponse,
  isRetiredAgentId,
  isValidAgentId,
  recordClawTalkConsoleFinal(input) {
    const context = resolveClawTalkConsoleMirrorContext({
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      prompt: input.prompt,
    })
    const emitted = emitClawTalkConsoleFrame('final', context, {
      ok: input.ok,
      reply: input.reply || 'No response returned.',
      transport: input.transport,
      buffered: input.buffered,
      liveTokens: input.liveTokens,
      consoleBridgeFinal: true,
    })
    return { emitted, clawTalkRunId: context.clawTalkRunId }
  },
  writeSseEvent,
})


registerBrowserRoutes(app, { checkBrowserPreflight })


async function createShiftFromPayload(input: StartShiftPayload): Promise<Shift> {
  const { name, message } = input
  const scheduleKind = input.scheduleKind || 'every'
  const schedule = (input.schedule || input.every || '').trim()
  if (!schedule) throw new Error('A schedule value is required')
  if (scheduleKind === 'every' && !/^\d+[smhdw]$/u.test(schedule)) {
    throw new Error('Use an interval like 15m, 2h, 1d, or 1w')
  }
  const every = schedule
  const durationMinutes = computeShiftDurationMinutes(input)
  const defaults = await readHeartbeatRuntimeDefaults().catch(() => DEFAULT_HEARTBEAT_RUNTIME)

  const resolvedAgent = await resolveShiftLeadAgent(input.agent || (defaults.leadAgent === 'auto-highest-level' ? undefined : defaults.leadAgent)).catch(
    () => input.agent || defaults.leadAgent,
  )
  if (!resolvedAgent || resolvedAgent === 'auto-highest-level') {
    throw new Error('Could not resolve a lead agent for this heartbeat shift.')
  }

  const mergedDefaults = await resolveHeartbeatRuntimeDefaultsForAgent(resolvedAgent).catch(() => defaults)

  const resolvedModel = (input.model || mergedDefaults.model || '').trim()
  if (resolvedModel && modelSelectionBlocked(resolvedModel)) {
    const blocked = new Error(CREDITS_ONLY_MODEL_ACCESS_MESSAGE) as Error & { statusCode?: number }
    blocked.statusCode = 403
    throw blocked
  }
  const resolvedThinking = input.thinking || mergedDefaults.thinking
  const resolvedTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(
    resolvedAgent,
    input.timeoutSeconds ?? mergedDefaults.timeoutSeconds,
  )
  const resolvedWake = input.wake || mergedDefaults.wake
  const resolvedSession = input.session || mergedDefaults.session
  const requestedAnnounce = input.announce ?? mergedDefaults.announce
  const resolvedAnnounce = false
  const shiftId = randomUUID()
  const startedAt = new Date().toISOString()
  const endsAt = new Date(Date.now() + durationMinutes * 60_000).toISOString()
  if (requestedAnnounce && resolvedSession === 'isolated') {
    console.warn('[shifts/cron] chat announce requested without an explicit Control Center delivery target; forcing --no-deliver')
  }
  const runContext = await resolveAgentRunContext(resolvedAgent)
  const sharedTeamSyncPath = await resolveSharedTeamSyncPath(resolvedAgent)
  const heartbeatPrompt = composeAgentDoctrinePrompt(
    resolvedAgent,
    [
      message,
      '',
      'TEAM_SYNC logging contract (required):',
      '- Do not overwrite TEAM_SYNC.md.',
      '- Use append-only updates for TEAM_SYNC entries.',
      `- Preferred method: POST http://127.0.0.1:${PORT}/api/team-sync/append with Content-Type application/json and body JSON.stringify({ agentId, role, runId, note, filePath }).`,
      `- Required TEAM_SYNC filePath: ${sharedTeamSyncPath}`,
      `- If HTTP append is unavailable, append directly to ${sharedTeamSyncPath} (append-only, no overwrite).`,
      '',
      'Shift directive (highest priority for this run):',
      '- Execute the assignment above now, even if HEARTBEAT.md says no pending work.',
      '- Do not return HEARTBEAT_OK for this run unless execution is impossible after trying.',
      '- If execution is impossible, report the exact blocker and the command/tool attempt that failed.',
      '- If execution succeeds, include concrete evidence: changed file path(s) and a short result.',
      '',
      'Heartbeat execution rule:',
      `- For project files, write in execution workspace: ${runContext.executionWorkspace}`,
      '- Keep doctrine/state markdown in doctrine workspace only.',
    ].join('\n'),
    runContext.executionWorkspace,
    runContext.doctrineWorkspace,
  )

  const cronArgs = [
    'cron',
    'add',
    '--agent',
    resolvedAgent,
    '--name',
    name,
    '--description',
    `control-center shift=${shiftId} expiresAt=${endsAt} durationMinutes=${durationMinutes}`,
    ...(scheduleKind === 'cron' ? ['--cron', schedule] : scheduleKind === 'at' ? ['--at', schedule] : ['--every', schedule]),
    ...(resolvedSession === 'main' ? ['--system-event', heartbeatPrompt] : ['--message', heartbeatPrompt]),
    '--thinking',
    resolvedThinking,
    '--timeout-seconds',
    String(resolvedTimeoutSeconds),
    '--wake',
    resolvedWake,
    '--session',
    resolvedSession,
    ...(resolvedModel ? ['--model', resolvedModel] : []),
    ...(resolvedSession === 'isolated' ? ['--no-deliver'] : []),
    '--json',
  ]

  const cronResult = await runOpenClaw(cronArgs, 90000)
  if (cronResult.code !== 0) throw new Error(cronResult.stderr || cronResult.stdout || 'Failed to create cron job')

  let cronId = ''
  try {
    const raw = JSON.parse(cronResult.stdout)
    cronId = raw?.id || raw?.job?.id || ''
  } catch {
    const possible = cronResult.stdout.match(/[a-f0-9-]{12,}/i)
    cronId = possible?.[0] || ''
  }
  if (!cronId) throw new Error(`Cron job created but id was not parsed: ${cronResult.stdout}`)

  const shift: Shift = {
    id: shiftId,
    name,
    agent: resolvedAgent,
    every,
    scheduleKind,
    scheduleLabel: schedule,
    durationMinutes,
    message,
    model: resolvedModel || undefined,
    thinking: resolvedThinking,
    timeoutSeconds: resolvedTimeoutSeconds,
    wake: resolvedWake,
    session: resolvedSession,
    announce: resolvedAnnounce,
    cronId,
    startedAt,
    endsAt,
  }

  activeShifts.set(shift.id, shift)
  armShiftExpiryTimer(shift)
  invalidateRuntimeStatusCache()
  return shift
}

registerShiftRoutes(app, {
  activeShifts,
  clearShiftRuntimeState,
  createShiftFromPayload,
  invalidateRuntimeStatusCache,
  isValidAgentId,
  listActiveCronJobViews,
  mergeHeartbeatRuntimeDefaults,
  modelSelectionBlocked,
  readHeartbeatRuntimeDefaults,
  readHeartbeatRuntimePerAgent,
  runOpenClaw,
  startManagedTeamSyncOrchestrator,
  sweepExpiredMissionCronJobs,
  writeHeartbeatRuntimeDefaults,
  writeHeartbeatRuntimePerAgent,
})

registerProviderAuthRoutes(app, {
  anthropicOAuthRedirectUri: ANTHROPIC_OAUTH_REDIRECT_URI,
  authEnvMap: AUTH_ENV_MAP,
  authProviderCatalog: AUTH_PROVIDER_CATALOG,
  ensureProviderAuthReady: ensureLocalAuthStoreLoaded,
  fallbackAvailableModels,
  getFastAvailableModelsCatalog,
  googleOAuthRedirectUri: GOOGLE_OAUTH_REDIRECT_URI,
  localAuthPath: LOCAL_AUTH_PATH,
  oauthSessions,
  openAiCodexOAuthRedirectUri: OPENAI_CODEX_OAUTH_REDIRECT_URI,
  parseOpenAICodexAuthorizationInput,
  completeOpenAICodexOAuthSession,
  persistProviderAuth,
  updateProviderOAuthSettings: providerAuthService.updateProviderOAuthSettings,
  providerAuthStatus,
  refreshAvailableModelsCache,
  isCreditsOnlyEntitlement: () => licenseService.isUsagePriorityLocked(),
  creditsOnlyAvailableModels: () => [{
    id: AUTOMNIA_OPENCLAW_MODEL,
    alias: 'Default model',
    provider: AUTOMNIA_OPENCLAW_PROVIDER_ID,
    name: 'Gemini 3.7 Flash',
  }],
  removeProviderAuth,
  startGoogleOAuthSession,
  startAnthropicOAuthSession,
  startOpenAICodexOAuthSession,
  submitAnthropicOAuthManualInput,
  providerAccessAllowed: () => licenseService.getTrafficGate().providerAccessAllowed,
})

const speechTranscriptionService = createSpeechTranscriptionService({
  resolveOpenAiApiKey: async () => {
    await ensureLocalAuthStoreLoaded().catch(() => undefined)
    const processEnvironment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    const requestAuth = await resolveProviderRequestAuth('openai', {
      ...processEnvironment,
      ...getLocalAuthEnv(),
    }, AUTH_ENV_MAP.openai || ['OPENAI_API_KEY'])
    return requestAuth?.type === 'apiKey' ? requestAuth.value : ''
  },
})

registerSpeechRoutes(app, {
  speechTranscription: speechTranscriptionService,
  localAiAllowed: () => licenseService.getTrafficGate().localAiAllowed,
})

registerSkillRoutes(app, {
  findSkillContent,
  installClawHubSkillWithRetry,
  invalidateSkillLibraryCache,
  listSkillsFromRoot,
  readAgentSkillLibrary,
  readSkillEntryFromDir,
  resolveSkillsCommandContext,
  runOpenClaw,
  runOpenClawWithManagedSkillsWorkspace,
  sharedSkillsRoot: SHARED_SKILLS_ROOT,
  slugifySkillId,
  writeLearnedSkill,
})

export type AgentConfigRoutesContext = {
  KNOWN_UNAVAILABLE_MODEL_IDS: typeof KNOWN_UNAVAILABLE_MODEL_IDS
  agentLocalConfigPath: typeof agentLocalConfigPath
  applyExecutionWorkspaceToLocalConfig: typeof applyExecutionWorkspaceToLocalConfig
  applyLocalConfigToGlobal: typeof applyLocalConfigToGlobal
  canonicalAgentModelId: typeof canonicalAgentModelId
  clearDisallowedAutoModelOverridesForAgent: typeof clearDisallowedAutoModelOverridesForAgent
  deriveAgentAliases: typeof deriveAgentAliases
  ensureAgentLocalConfig: typeof ensureAgentLocalConfig
  ensureConfiguredModelAllowlist: typeof ensureConfiguredModelAllowlist
  getAgentById: typeof getAgentById
  isLegacyGenericRecruitAttributes: typeof isLegacyGenericRecruitAttributes
  isLegacyGenericRecruitHeartbeat: typeof isLegacyGenericRecruitHeartbeat
  isLegacyGenericRecruitMds: typeof isLegacyGenericRecruitMds
  isLegacyGenericRecruitRuntime: typeof isLegacyGenericRecruitRuntime
  isLegacyGenericRecruitSoul: typeof isLegacyGenericRecruitSoul
  modelAuthProblem: typeof modelAuthProblem
  modelSelectionForActiveBillingRoute: typeof modelSelectionForActiveBillingRoute
  modelSelectionBlocked: typeof modelSelectionBlocked
  normalizeAgentMdsState: typeof normalizeAgentMdsState
  normalizeAgentToolsConfig: typeof normalizeAgentToolsConfig
  normalizeModelWithFallback: typeof normalizeModelWithFallback
  normalizeSandboxConfig: typeof normalizeSandboxConfig
  propagateDisplayNameAcrossAgentFiles: typeof propagateDisplayNameAcrossAgentFiles
  readPartyProfiles: typeof readPartyProfiles
  recruitAttributesFromProfile: typeof recruitAttributesFromProfile
  recruitHeartbeatDefaults: typeof recruitHeartbeatDefaults
  recruitMdsDefaults: typeof recruitMdsDefaults
  recruitRuntimeDefaults: typeof recruitRuntimeDefaults
  recruitSoulDefaults: typeof recruitSoulDefaults
  rememberAgentLocalConfigCache: typeof rememberAgentLocalConfigCache
  resetAgentTurnSessionsForAgentContextChange: typeof resetAgentTurnSessionsForAgentContextChange
  resetAgentTurnSessionsForModelChange: typeof resetAgentTurnSessionsForModelChange
  sanitizeProfile: typeof sanitizeProfile
  schedulePluginGatewayRestart: typeof schedulePluginGatewayRestart
  syncAgentDerivedFiles: typeof syncAgentDerivedFiles
  syncAllAgentLocalConfigs: typeof syncAllAgentLocalConfigs
  validateWorkspaceAccess: typeof validateWorkspaceAccess
  writeOpenclawConfig: typeof writeOpenclawConfig
  writePartyProfiles: typeof writePartyProfiles
  writeTextFileWithLockRetry: typeof writeTextFileWithLockRetry
}

const agentConfigRoutesContext: AgentConfigRoutesContext = {
  KNOWN_UNAVAILABLE_MODEL_IDS,
  agentLocalConfigPath,
  applyExecutionWorkspaceToLocalConfig,
  applyLocalConfigToGlobal,
  canonicalAgentModelId,
  clearDisallowedAutoModelOverridesForAgent,
  deriveAgentAliases,
  ensureAgentLocalConfig,
  ensureConfiguredModelAllowlist,
  getAgentById,
  isLegacyGenericRecruitAttributes,
  isLegacyGenericRecruitHeartbeat,
  isLegacyGenericRecruitMds,
  isLegacyGenericRecruitRuntime,
  isLegacyGenericRecruitSoul,
  modelAuthProblem,
  modelSelectionForActiveBillingRoute,
  modelSelectionBlocked,
  normalizeAgentMdsState,
  normalizeAgentToolsConfig,
  normalizeModelWithFallback,
  normalizeSandboxConfig,
  propagateDisplayNameAcrossAgentFiles,
  readPartyProfiles,
  recruitAttributesFromProfile,
  recruitHeartbeatDefaults,
  recruitMdsDefaults,
  recruitRuntimeDefaults,
  recruitSoulDefaults,
  rememberAgentLocalConfigCache,
  resetAgentTurnSessionsForAgentContextChange,
  resetAgentTurnSessionsForModelChange,
  sanitizeProfile,
  schedulePluginGatewayRestart,
  syncAgentDerivedFiles,
  syncAllAgentLocalConfigs,
  validateWorkspaceAccess,
  writeOpenclawConfig,
  writePartyProfiles,
  writeTextFileWithLockRetry,
}

registerAgentConfigRoutes(app, agentConfigRoutesContext)

registerAuthRoutes(app, {
  authToken: AUTH_TOKEN,
  loginAttempts,
  sessionTokens,
  accountAuth: accountAuthService,
  onLogout: async () => {
    // Do not leave the previous account's hosted key/model route active after
    // an explicit account logout. Deactivation is local-only; the provisioner
    // account and its credits remain untouched for the next sign-in.
    try {
      licenseService.deactivate()
    } finally {
      await synchronizeBillingRouteWithGateway()
    }
  },
  cancelOAuthSession,
  ensureProviderAuthReady: ensureLocalAuthStoreLoaded,
  getLocalProviderOAuth: providerAuthService.getLocalProviderOAuth,
  oauthSessions,
  startGoogleOAuthSession,
  startGoogleAccountOAuthSession,
})
registerLicenseRoutes(app, {
  licenseService,
  synchronizeOpenClawBillingRoute: synchronizeBillingRouteWithGateway,
  pushGatewayLog,
})

const { staticRoot: STATIC_ROOT } = registerStaticUi(app, {
  staticDir: process.env.CONTROL_CENTER_STATIC_DIR?.trim(),
  contentTypeFromExt,
  isInsidePath,
})
installControlPlaneErrorHandler(app)

controlServer = app.listen(PORT, '127.0.0.1', () => {
  console.log(`OpenClaw Control Center API running at http://127.0.0.1:${PORT}`)
  console.log(`Workspace root: ${WORKSPACE_ROOT}`)
  if (STATIC_ROOT) console.log(`Static UI root: ${STATIC_ROOT}`)
  if (AUTH_TOKEN_SOURCE === 'generated') {
    console.log(`Generated local Control Center login token: ${AUTH_TOKEN}`)
    console.log('Set CONTROL_CENTER_TOKEN before startup to choose a stable local token.')
  }
  // Keep historical ledger migration out of the readiness path. It is safe to
  // resume in the background once the local desktop API is available.
  scheduleLegacyRuntimeLedgerImport()
  void (async () => {
    await hydrateRecentOpenClawRunsFromLedger()
    await hydrateMissionRecordsFromLedger()
    rehydrateControlCenterShiftRuntimeStateFromCronDb()
  })().catch((error) => {
    console.warn('[startup-recovery] runtime, mission, or shift hydration skipped:', error)
  })
  void sweepOpenClawSessionLocks('app startup', { minIntervalMs: 0, minAgeMs: 0 }).catch((error) => {
    console.warn('[session-lock] startup cleanup skipped:', error)
  })
  startMissionCronExpirySweep()
  void ensureLocalAuthStoreLoaded()
    .then(async (store) => {
      if (!STARTUP_AUTH_PROFILE_SYNC) {
        console.log('[auth-profile-sync] startup sync skipped; run provider save/OAuth flow to propagate credentials.')
        return
      }
      for (const [provider, config] of Object.entries(store.providers)) {
        await syncStoredProviderAuthProfiles(provider, config)
      }
    })
    .then(() => {
      if (!STARTUP_AGENT_CONFIG_SYNC) {
        console.log('[agent-config-sync] startup sync skipped; use /api/party/configs/sync for full propagation.')
        return { updated: 0, sessionModelRowsCleared: 0 }
      }
      return syncAllAgentLocalConfigs()
    })
    .then((result) => {
      console.log(`[agent-config-sync] synced ${result.updated} agent config file(s)`)
    })
    .catch((error) => {
      console.error('[agent-config-sync] startup sync failed:', error)
    })
  if (AUTO_START_GATEWAY) {
    if (gatewayAutostartTimer) clearTimeout(gatewayAutostartTimer)
    gatewayAutostartTimer = setTimeout(() => {
      gatewayAutostartTimer = null
      if (shuttingDown) return
      void ensureGatewayRunning()
    }, 1000)
    gatewayAutostartTimer.unref?.()
    startGatewayHealthMonitor()
    if (CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP) {
      scheduleControlCenterGatewayAgentRuntimePrewarm('startup')
    } else {
      console.log('[gateway] control center chat prewarm skipped at startup; gateway client will connect lazily.')
    }
  } else {
    console.log('[gateway] auto-start disabled; gateway will start lazily for browser turns.')
  }
})
controlServer.on('error', (error: NodeJS.ErrnoException) => {
  const code = error.code || 'UNKNOWN'
  const detail = code === 'EADDRINUSE'
    ? `Control Center API port ${PORT} is already in use. Close the stale app-owned process or free the port, then restart.`
    : code === 'EACCES'
      ? `Control Center API port ${PORT} cannot be opened because access was denied.`
      : `Control Center API server failed to bind: ${error.message || String(error)}`
  console.error(`[control-server] ${detail}`)

  const runningInsideElectron = Boolean((process.versions as Record<string, string | undefined>).electron)
  if (!runningInsideElectron || process.env.CONTROL_CENTER_EXIT_ON_PORT_ERROR === '1') {
    process.exitCode = 1
    setTimeout(() => process.exit(1), 25)
  }
})
const CONTROL_SERVER_REQUEST_TIMEOUT_MS = Number(process.env.CONTROL_CENTER_REQUEST_TIMEOUT_MS || 7_260_000)
controlServer.requestTimeout = Number.isFinite(CONTROL_SERVER_REQUEST_TIMEOUT_MS) && CONTROL_SERVER_REQUEST_TIMEOUT_MS >= 60_000
  ? CONTROL_SERVER_REQUEST_TIMEOUT_MS
  : 7_260_000
controlServer.headersTimeout = 65_000
controlServer.timeout = controlServer.requestTimeout + 30_000
