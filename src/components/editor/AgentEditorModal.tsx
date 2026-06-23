import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentSkillEntry, BehaviorProfile, HeartbeatConfig, OpenClawAgent, ThinkingLevel } from '../../types/nexus'
import { apiUrl } from '../../utils/apiUrl'
import { formatModelChoiceLabel, formatModelGroupLabel, groupAvailableModels } from '../../utils/modelGrouping'
import { ProviderAuthModal } from '../auth/ProviderAuthModal'

type EditorTab = 'profile'|'model'|'heartbeat'|'policy'|'workspace'|'skills'|'files'
type AgentMetaPatch = Partial<Pick<OpenClawAgent, 'name'|'portrait'|'className'|'role'|'level'|'behaviorProfile'|'workspace'>>
type HeartbeatPatch = Partial<HeartbeatConfig>
type SandboxMode = NonNullable<NonNullable<OpenClawAgent['sandbox']>['mode']>
type SandboxScope = NonNullable<NonNullable<OpenClawAgent['sandbox']>['scope']>
type SandboxAccess = NonNullable<NonNullable<OpenClawAgent['sandbox']>['workspaceAccess']>

interface AvailableModel { id:string; alias:string; provider:string; name:string }
interface AuthProviderStatus {
  provider:string
  configured:boolean
  envKeys:string[]
  stored?:boolean
  label?:string
  oauth?:{
    supported:boolean
    configured:boolean
    available:boolean
    missing?:string[]
    docs?:string
    redirectUri?:string
    projectId?:string
    accountId?:string
    email?:string
    expiresAt?:number
    clientIdEnvKeys?:string[]
    projectIdEnvKeys?:string[]
  }
}

type AgentConfigPayload = {
  sandbox?:OpenClawAgent['sandbox']
  tools?:{allow?:string[];deny?:string[]}
  model?:OpenClawAgent['model']
  heartbeat?:HeartbeatConfig
  runtime?:{thinkingDefault?:ThinkingLevel;timeoutSeconds?:number;parallelPreferred?:boolean}
}

type AgentConfigPatch = {
  identity?:{name?:string;avatar?:string}
  profile?:{className?:string;role?:string;level?:number;behaviorProfile?:BehaviorProfile}
  runtime?:{thinkingDefault?:ThinkingLevel;timeoutSeconds?:number;parallelPreferred?:boolean}
}
type AgentConfigDirtySection = 'profile'|'model'|'runtime'|'heartbeat'|'policy'
type ApplyAgentConfigOptions = { skipDirty?: boolean }
type DesktopDirectoryPickerPayload = { ok?:boolean; path?:string|null; cancelled?:boolean; error?:string; detail?:string }

declare global {
  interface Window {
    dystopaiDesktop?: {
      getPathForFile?: (file: File) => string | Promise<string>
      pickDirectory?: (options?: { startPath?: string }) => Promise<DesktopDirectoryPickerPayload>
    }
  }
}

type TimedEditorCache<T> = { expiresAt:number; value:T }

const EDITOR_CACHE_MS = 5 * 60 * 1000
const EDITOR_CONFIG_CACHE_MS = 30 * 1000
const EDITOR_AUTH_CACHE_MS = 15 * 1000
const EDITOR_MODEL_FETCH_TIMEOUT_MS = 8000
const EDITOR_PATCH_DEBOUNCE_MS = 500
const IS_WINDOWS_CLIENT = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
let modelsCache: TimedEditorCache<AvailableModel[]> | null = null
let modelsRequest: Promise<AvailableModel[]> | null = null
let authProvidersCache: TimedEditorCache<AuthProviderStatus[]> | null = null
const agentConfigCache = new Map<string, TimedEditorCache<AgentConfigPayload>>()
const skillsCache = new Map<string, TimedEditorCache<AgentSkillEntry[]>>()

const OAUTH_PROVIDER_FALLBACKS: Record<string, AuthProviderStatus> = {
  'openai-codex': {
    provider: 'openai-codex',
    configured: false,
    envKeys: [],
    label: 'OpenAI Codex',
    oauth: {
      supported: true,
      configured: false,
      available: true,
      missing: [],
      redirectUri: 'http://localhost:1455/auth/callback',
    },
  },
}

const authStatusForProvider = (providers: AuthProviderStatus[], provider: string) =>
  providers.find((entry) => entry.provider === provider) || OAUTH_PROVIDER_FALLBACKS[provider]

const isOpenAiCodexSubscriptionModel = (modelId: string) => {
  const [, model = ''] = modelId.trim().split('/')
  return /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(model)
}

const authLabelForProvider = (provider: string, status?: AuthProviderStatus) =>
  status?.label || (provider === 'openai-codex' ? 'OpenAI Codex' : provider)

const authKindForProvider = (status?: AuthProviderStatus) => (status?.oauth?.supported ? 'OAuth' : 'auth')

const isAvailableModel = (value: unknown): value is AvailableModel => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<AvailableModel>
  return typeof entry.id === 'string' && typeof entry.alias === 'string' && typeof entry.provider === 'string' && typeof entry.name === 'string'
}

const safeAvailableModels = (value: unknown): AvailableModel[] =>
  Array.isArray(value) ? value.filter(isAvailableModel) : []

const modelOptionFromId = (modelId: string): AvailableModel | null => {
  const id = modelId.trim()
  if (!id) return null
  const [rawProvider = '', ...modelParts] = id.split('/')
  const provider = isOpenAiCodexSubscriptionModel(id) ? 'openai-codex' : rawProvider || 'model'
  const name = modelParts.join('/') || id
  return { id, alias: name, provider, name }
}

const mergeSelectedModelOptions = (catalog: AvailableModel[], selectedIds: string[]) => {
  const merged = new Map<string, AvailableModel>()
  for (const model of catalog) {
    if (model.id.trim()) merged.set(model.id, model)
  }
  for (const selectedId of selectedIds) {
    const synthetic = modelOptionFromId(selectedId)
    if (synthetic && !merged.has(synthetic.id)) merged.set(synthetic.id, synthetic)
  }
  return Array.from(merged.values())
}

async function loadEditorModels(force = false) {
  const cached = modelsCache && modelsCache.expiresAt > Date.now() ? modelsCache.value : null
  if (!force && cached) return cached
  if (!force && modelsRequest) return modelsRequest

  const path = force ? '/api/models/available?refresh=1' : '/api/models/available?background=0'
  modelsRequest = fetchWithTimeout(apiUrl(path), undefined, EDITOR_MODEL_FETCH_TIMEOUT_MS)
    .then(async (response) => {
      const payload = await readJsonResponse<{ models?: unknown; error?: string; detail?: string }>(response)
      if (!response.ok || payload.error) {
        throw new Error(payload.detail || payload.error || `Models request failed with HTTP ${response.status}`)
      }
      const next = safeAvailableModels(payload.models)
      modelsCache = { expiresAt: Date.now() + EDITOR_CACHE_MS, value: next }
      return next
    })
    .finally(() => {
      modelsRequest = null
    })

  return modelsRequest
}

interface ClawHubSkillResult {
  slug: string
  displayName?: string
  summary?: string
  version?: string | null
  updatedAt?: number | null
  ownerHandle?: string
  owner?: { handle?: string; displayName?: string; image?: string }
}
interface ClawHubSearchPayload { ok:boolean; results?:ClawHubSkillResult[]; error?:string; detail?:string }
interface ClawHubInstallPayload { ok:boolean; alreadyInstalled?:boolean; skill?:AgentSkillEntry; output?:string; error?:string; detail?:string }

const ICON: Record<EditorTab,string> = { profile:'ID', model:'AI', heartbeat:'HB', policy:'SC', workspace:'WS', skills:'SK', files:'MD' }
const EDITOR_TAB_LABEL: Record<EditorTab,string> = {
  profile: 'Profile',
  model: 'Model',
  heartbeat: 'Heartbeat scheduler',
  policy: 'Policy sandbox',
  workspace: 'Workspace',
  skills: 'Skills',
  files: 'Agent files',
}
const EDITOR_TAB_HELP: Record<EditorTab,string> = {
  profile: 'Edit identity, portrait, class, role, level, and behavior.',
  model: 'Choose the primary model, fallbacks, reasoning effort, and work timeout.',
  heartbeat: 'Tune cron cadence, idle timeout, loop mode, and recovery.',
  policy: 'Set sandbox mode, scope, workspace access, and allowed tools.',
  workspace: 'Browse and assign the agent workspace directory.',
  skills: 'Search, install, update, and enable agent skills.',
  files: 'View and edit the agent markdown resource files.',
}
const EDITOR_TABS = Object.keys(ICON) as EditorTab[]
const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const satisfies readonly ThinkingLevel[]
const BEHAVIOR_OPTIONS = ['executor','architect','auditor','researcher','hybrid'] as const satisfies readonly BehaviorProfile[]
const SANDBOX_MODE_OPTIONS = ['off','all','non-main'] as const
const SANDBOX_SCOPE_OPTIONS = ['session','agent','shared'] as const
const SANDBOX_ACCESS_OPTIONS = ['rw','ro','none'] as const

const isOption = <T extends string>(value: string, options: readonly T[]): value is T =>
  (options as readonly string[]).includes(value)

const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`
}

const rangeFillStyle = (
  value: number,
  min: number,
  max: number,
  start = '#22d3ee',
  end = '#67e8f9',
  glow = 'rgba(34, 211, 238, .34)',
) => {
  const bounded = Math.min(max, Math.max(min, value))
  const percentage = max > min ? ((bounded - min) / (max - min)) * 100 : 0
  return {
    '--dy-range-value': `${percentage}%`,
    '--dy-range-start': start,
    '--dy-range-end': end,
    '--dy-range-glow': glow,
  } as CSSProperties
}

const editorRangeStyle = (...args: Parameters<typeof rangeFillStyle>) =>
  rangeFillStyle(...args)

const agentEditorRenderKey = (agent: OpenClawAgent | undefined | null) => {
  if (!agent) return ''
  return [
    agent.id,
    agent.name,
    agent.portrait || '',
    agent.className,
    agent.role,
    String(agent.level),
    agent.behaviorProfile,
    agent.rarity,
    agent.workspace || '',
    (agent.unlockedSkills || []).join(','),
  ].join('\u001f')
}

const WORK_TIMEOUT_PRESETS = [
  { label: 'Quick', seconds: 90 },
  { label: 'Build', seconds: 720 },
  { label: 'Deep', seconds: 1200 },
  { label: 'Long', seconds: 3600 },
]

function compactText(value: string, max = 120) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

function formatClawHubDate(value?: number | null) {
  if (!value || !Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return ''
  }
}

function skillIdKey(value: string) {
  return value.trim().toLowerCase()
}

function sourceLabel(source: AgentSkillEntry['source']) {
  if (source === 'clawhub') return 'clawhub'
  if (source === 'library') return 'shared'
  if (source === 'learned') return 'learned'
  return source
}

function mergeSkillEntries(...groups: Array<AgentSkillEntry[] | undefined>) {
  const byId = new Map<string, AgentSkillEntry>()
  for (const group of groups) {
    for (const skill of group || []) {
      if (!skill.id?.trim()) continue
      byId.set(skill.id, skill)
    }
  }
  return Array.from(byId.values()).sort((a,b)=>a.name.localeCompare(b.name))
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) throw new Error(`Empty server response (${response.status})`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Invalid server JSON (${response.status}): ${text.slice(0, 160)}`)
  }
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && String((error as { name?: unknown }).name) === 'AbortError'
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.trim() || 'Unknown error'
}

function isFetchNetworkError(error: unknown) {
  return /\b(failed to fetch|networkerror)\b/i.test(errorMessage(error))
}

async function fetchWithTimeout(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1], timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...(init || {}), signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function workspaceStatusIsError(status: string) {
  return /\b(failed|timed out|unavailable|could not|invalid|error)\b/i.test(status)
}

function dirnameFromPath(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index > 0 ? trimmed.slice(0, index) : ''
}

function directoryFromPickedFolderFile(file: File, filePath: string) {
  const absolute = filePath.trim()
  if (!absolute) return ''
  const relativeParts = (file.webkitRelativePath || '').split(/[\\/]/).filter(Boolean)
  if (relativeParts.length <= 1) return dirnameFromPath(absolute)
  let directory = absolute
  for (let index = 0; index < relativeParts.length - 1; index += 1) {
    directory = dirnameFromPath(directory)
    if (!directory) break
  }
  return directory
}

function isSupportedPortraitFile(file: File) {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp|ico|svg)$/i.test(file.name)
}

function mergeAgentConfigPatch(left: AgentConfigPatch, right: AgentConfigPatch): AgentConfigPatch {
  return {
    ...left,
    ...right,
    identity: right.identity ? { ...(left.identity || {}), ...right.identity } : left.identity,
    profile: right.profile ? { ...(left.profile || {}), ...right.profile } : left.profile,
    runtime: right.runtime ? { ...(left.runtime || {}), ...right.runtime } : left.runtime,
  }
}

export function AgentEditorModal() {
  const isOpen = useNexusStore((s)=>s.isEditorOpen)
  const closeEditor = useNexusStore((s)=>s.closeEditor)
  const editingAgentId = useNexusStore((s)=>s.editingAgentId)
  const editingAgentRenderKey = useNexusStore((s)=>agentEditorRenderKey(s.editingAgentId?s.agents.find((a)=>a.id===s.editingAgentId):null))
  const agent = useMemo(()=>editingAgentId&&editingAgentRenderKey?useNexusStore.getState().agents.find((a)=>a.id===editingAgentId)??null:null,[editingAgentId,editingAgentRenderKey])
  const activePartyIds = useNexusStore((s)=>s.activePartyIds)
  const updateAgentMeta = useNexusStore((s)=>s.updateAgentMeta)
  const updateHeartbeat = useNexusStore((s)=>s.updateHeartbeat)
  const updateAgentModel = useNexusStore((s)=>s.updateAgentModel)
  const updateAgentRuntimePolicy = useNexusStore((s)=>s.updateAgentRuntimePolicy)
  const setAgentEnabledSkills = useNexusStore((s)=>s.setAgentEnabledSkills)
  const retireAgent = useNexusStore((s)=>s.retireAgent)
  const [tab,setTab] = useState<EditorTab>('profile')

  const [nameDraft,setNameDraft] = useState('')
  const [roleDraft,setRoleDraft] = useState('')
  const [classDraft,setClassDraft] = useState('')
  const [levelDraft,setLevelDraft] = useState('')
  const [portraitDraft,setPortraitDraft] = useState('')
  const [portraitPreviewSrc,setPortraitPreviewSrc] = useState('')
  const [portraitStatus,setPortraitStatus] = useState('')
  const [portraitPicking,setPortraitPicking] = useState(false)
  const portraitRef = useRef<HTMLInputElement|null>(null)

  const [models,setModels] = useState<AvailableModel[]>([])
  const [modelsLoading,setModelsLoading] = useState(false)
  const [authProviders,setAuthProviders] = useState<AuthProviderStatus[]>([])
  const [authModalProvider,setAuthModalProvider] = useState<AuthProviderStatus|null>(null)
  const [primary,setPrimary] = useState('')
  const [fallbacks,setFallbacks] = useState<string[]>([])
  const [thinkingOn,setThinkingOn] = useState(false)
  const [thinkingLevel,setThinkingLevel] = useState<Exclude<ThinkingLevel,'off'>>('minimal')
  const [runtimeTimeoutSeconds,setRuntimeTimeoutSeconds] = useState(720)
  const [ms,setMs] = useState(false); const [msStatus,setMsStatus] = useState('')

  const [tick,setTick] = useState(4200); const [idle,setIdle] = useState(40000)
  const [cont,setCont] = useState(false); const [rec,setRec] = useState(true)
  const heartbeatDraftRef = useRef<HeartbeatConfig|null>(null)
  const heartbeatCommitRef = useRef<HeartbeatConfig|null>(null)
  const heartbeatSaveSeqRef = useRef(0)
  const runtimeCommitRef = useRef<NonNullable<OpenClawAgent['runtimePolicy']>|null>(null)
  const configPatchRef = useRef<AgentConfigPatch|null>(null)
  const configPatchAgentIdRef = useRef('')
  const configPatchTimerRef = useRef<ReturnType<typeof window.setTimeout>|null>(null)
  const configLoadSeqRef = useRef(0)
  const dirtyConfigSectionsRef = useRef<Set<AgentConfigDirtySection>>(new Set())
  const fileListSeqRef = useRef(0)
  const fileContentSeqRef = useRef(0)

  const [sbMode,setSbMode] = useState<SandboxMode>('all')
  const [sbScope,setSbScope] = useState<SandboxScope>('agent')
  const [sbAccess,setSbAccess] = useState<SandboxAccess>('rw')
  const [tAllow,setTAllow] = useState(''); const [tDeny,setTDeny] = useState('')
  const [ps,setPs] = useState(false); const [psStatus,setPsStatus] = useState('')

  const [wsPath,setWsPath] = useState(''); const [wsFolders,setWsFolders] = useState<string[]>([])
  const [wsLoading,setWsLoading] = useState(false); const [wsSaving,setWsSaving] = useState(false)
  const [wsStatus,setWsStatus] = useState('')
  const workspaceDirectoryRef = useRef<HTMLInputElement|null>(null)

  const [sk,setSk] = useState(''); const [skFilter,setSkFilter] = useState<'all'|'enabled'|'disabled'>('all')
  const [installedSkills,setInstalledSkills] = useState<AgentSkillEntry[]>([])
  const [sharedSkillsLoading,setSharedSkillsLoading] = useState(false)
  const [clawHubQuery,setClawHubQuery] = useState('ui')
  const [clawHubResults,setClawHubResults] = useState<ClawHubSkillResult[]>([])
  const [clawHubSearching,setClawHubSearching] = useState(false)
  const [clawHubInstalling,setClawHubInstalling] = useState('')
  const [clawHubUpdating,setClawHubUpdating] = useState('')
  const [clawHubStatus,setClawHubStatus] = useState('')
  const [clawHubError,setClawHubError] = useState('')

  const [rfiles,setRfiles] = useState<string[]>([]); const [rfile,setRfile] = useState('SOUL.md')
  const [rcontent,setRcontent] = useState(''); const [rstatus,setRstatus] = useState('')
  const [rloading,setRloading] = useState(false); const [rcontentLoading,setRcontentLoading] = useState(false)
  const [rsaving,setRsaving] = useState(false)
  const [retireConfirmOpen,setRetireConfirmOpen] = useState(false)
  const [retiring,setRetiring] = useState(false)

  const pSrc = portraitPreviewSrc || portraitDraft || agent?.portrait || ''
  const agentId = agent?.id || ''
  const partySlotIndex = useMemo(()=>agentId?activePartyIds.indexOf(agentId):-1,[activePartyIds,agentId])
  const enabledSkillIds = useMemo(()=>new Set(agent?.unlockedSkills || []),[agent?.unlockedSkills])
  const ul = installedSkills.filter((skill)=>enabledSkillIds.has(skill.id)).length
  const vs = useMemo(()=>{ const q=sk.trim().toLowerCase(); return installedSkills.filter((skill)=>{const on=enabledSkillIds.has(skill.id);if(skFilter==='enabled'&&!on)return false;if(skFilter==='disabled'&&on)return false;return !q||skill.name.toLowerCase().includes(q)||skill.description.toLowerCase().includes(q)||skill.id.toLowerCase().includes(q)||skill.source.toLowerCase().includes(q)})},[enabledSkillIds,installedSkills,sk,skFilter])
  const installedClawHubIds = useMemo(()=>new Set(installedSkills.filter((skill)=>skill.source==='clawhub').map((skill)=>skill.id.toLowerCase())),[installedSkills])
  const sharedClawHubCount = useMemo(()=>installedSkills.filter((skill)=>skill.source==='clawhub').length,[installedSkills])
  const csv = (v:string)=>v.split(',').map((e)=>e.trim()).filter(Boolean)

  const markConfigDirty = useCallback((agentId:string|undefined,...sections:AgentConfigDirtySection[])=>{
    if(!agentId)return
    sections.forEach((section)=>dirtyConfigSectionsRef.current.add(section))
    agentConfigCache.delete(agentId)
  },[])
  const clearConfigDirty = useCallback((...sections:AgentConfigDirtySection[])=>{
    sections.forEach((section)=>dirtyConfigSectionsRef.current.delete(section))
  },[])
  const patchDirtySections = useCallback((patch:AgentConfigPatch): AgentConfigDirtySection[] => {
    const sections: AgentConfigDirtySection[] = []
    if(patch.identity||patch.profile)sections.push('profile')
    if(patch.runtime)sections.push('runtime')
    return sections
  },[])

  const flushPendingConfigPatch = useCallback(async ()=>{
    if(configPatchTimerRef.current){
      window.clearTimeout(configPatchTimerRef.current)
      configPatchTimerRef.current = null
    }
    const patch = configPatchRef.current
    const agentId = configPatchAgentIdRef.current
    configPatchRef.current = null
    configPatchAgentIdRef.current = ''
    if(!patch||!agentId)return
    const response = await fetch(apiUrl(`/api/party/agent/${agentId}/config`),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(patch),
    })
    if(!response.ok)throw new Error(`Agent config save failed (${response.status})`)
    agentConfigCache.delete(agentId)
    clearConfigDirty(...patchDirtySections(patch))
  },[clearConfigDirty,patchDirtySections])

  const scheduleConfigPatch = useCallback((agentId:string,patch:AgentConfigPatch)=>{
    if(configPatchAgentIdRef.current&&configPatchAgentIdRef.current!==agentId){
      void flushPendingConfigPatch().catch(()=>{})
    }
    configPatchAgentIdRef.current = agentId
    markConfigDirty(agentId,...patchDirtySections(patch))
    configPatchRef.current = mergeAgentConfigPatch(configPatchRef.current||{},patch)
    if(configPatchTimerRef.current)window.clearTimeout(configPatchTimerRef.current)
    configPatchTimerRef.current = window.setTimeout(()=>{
      void flushPendingConfigPatch().catch(()=>{})
    },EDITOR_PATCH_DEBOUNCE_MS)
  },[flushPendingConfigPatch,markConfigDirty,patchDirtySections])

  const PM = useCallback((p:AgentMetaPatch)=>{
    if(!agent)return
    const localPatch:AgentMetaPatch={}
    if(typeof p.name==='string'&&p.name!==agent.name)localPatch.name=p.name
    if(typeof p.portrait==='string'&&p.portrait!==agent.portrait)localPatch.portrait=p.portrait
    if(typeof p.className==='string'&&p.className!==agent.className)localPatch.className=p.className
    if(typeof p.role==='string'&&p.role!==agent.role)localPatch.role=p.role
    if(typeof p.level==='number'&&p.level!==agent.level)localPatch.level=p.level
    if(p.behaviorProfile&&p.behaviorProfile!==agent.behaviorProfile)localPatch.behaviorProfile=p.behaviorProfile
    if(!Object.keys(localPatch).length)return
    updateAgentMeta(agent.id,localPatch)
    const i:{name?:string;avatar?:string}={}
    if(typeof localPatch.name==='string')i.name=localPatch.name
    if(typeof localPatch.portrait==='string')i.avatar=localPatch.portrait
    const r:{className?:string;role?:string;level?:number;behaviorProfile?:BehaviorProfile}={}
    if(typeof localPatch.className==='string')r.className=localPatch.className
    if(typeof localPatch.role==='string')r.role=localPatch.role
    if(typeof localPatch.level==='number')r.level=localPatch.level
    if(localPatch.behaviorProfile)r.behaviorProfile=localPatch.behaviorProfile
    scheduleConfigPatch(agent.id,{...(Object.keys(i).length?{identity:i}:{}),...(Object.keys(r).length?{profile:r}:{})})
  },[agent,scheduleConfigPatch,updateAgentMeta])

  const commitProfileDraft = useCallback((field:'name'|'role'|'className'|'level')=>{
    if(!agent)return
    if(field==='name'){
      const next=nameDraft.trim()
      if(next)PM({name:next})
    }else if(field==='role'){
      PM({role:roleDraft.trim()})
    }else if(field==='className'){
      PM({className:classDraft.trim()})
    }else{
      const next=parseInt(levelDraft,10)
      if(next>0&&next<100)PM({level:next})
      else setLevelDraft(String(agent.level))
    }
  },[agent,PM,classDraft,levelDraft,nameDraft,roleDraft])

  const saveHeartbeatConfig = useCallback(async (agentId:string, heartbeat:HeartbeatConfig)=>{
    const seq = ++heartbeatSaveSeqRef.current
    heartbeatDraftRef.current = heartbeat
    const response = await fetch(apiUrl(`/api/party/agent/${agentId}/config`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({heartbeat})})
    if(!response.ok)throw new Error(`Heartbeat save failed (${response.status})`)
    agentConfigCache.delete(agentId)
    if(seq===heartbeatSaveSeqRef.current){
      heartbeatDraftRef.current = null
      clearConfigDirty('heartbeat')
    }
  },[clearConfigDirty])
  const PH = (p:HeartbeatPatch)=>{
    if(!agent)return
    const heartbeat={...agent.heartbeat,tickIntervalMs:tick,idleTimeoutMs:idle,continuous:cont,recoveryMode:rec,...p}
    const previous=heartbeatCommitRef.current||agent.heartbeat
    if(
      previous.tickIntervalMs===heartbeat.tickIntervalMs&&
      previous.idleTimeoutMs===heartbeat.idleTimeoutMs&&
      previous.continuous===heartbeat.continuous&&
      previous.recoveryMode===heartbeat.recoveryMode&&
      previous.maxExecutionTimeMs===heartbeat.maxExecutionTimeMs
    ) return
    heartbeatCommitRef.current=heartbeat
    heartbeatDraftRef.current=heartbeat
    markConfigDirty(agent.id,'heartbeat')
    updateHeartbeat(agent.id,heartbeat)
  }
  const closeWithHeartbeatFlush = async ()=>{try{await flushPendingConfigPatch()}catch{/* local store already has the latest draft */}if(agent&&heartbeatDraftRef.current){try{await saveHeartbeatConfig(agent.id,heartbeatDraftRef.current)}catch{/* store already has the latest local draft */}}closeEditor()}
  const PR = (p:Partial<NonNullable<OpenClawAgent['runtimePolicy']>>)=>{
    if(!agent)return
    const runtime={
      thinkingDefault:(thinkingOn?thinkingLevel:'off') as ThinkingLevel,
      timeoutSeconds:Math.max(30,Math.min(7200,Math.round(runtimeTimeoutSeconds))),
      parallelPreferred:agent.runtimePolicy?.parallelPreferred??true,
      ...p,
    }
    const previous=runtimeCommitRef.current||agent.runtimePolicy
    if(
      previous?.thinkingDefault===runtime.thinkingDefault&&
      previous?.timeoutSeconds===runtime.timeoutSeconds&&
      previous?.parallelPreferred===runtime.parallelPreferred
    ) return
    runtimeCommitRef.current=runtime
    updateAgentRuntimePolicy(agent.id,runtime,{persist:false})
    scheduleConfigPatch(agent.id,{runtime})
  }

  const LdM = useCallback(async (force=false)=>{
    const cached = modelsCache && modelsCache.expiresAt>Date.now() ? modelsCache.value : null
    if(!force&&cached){
      setModels(cached)
      setModelsLoading(false)
      return
    }
    if(modelsCache?.value?.length) setModels(modelsCache.value)
    setModelsLoading(!modelsCache?.value?.length)
    try{
      const next=await loadEditorModels(force)
      setModels(next)
    }catch{
      setModels((current)=>current.length?current:modelsCache?.value||[])
    }finally{
      setModelsLoading(false)
    }
  },[])
  const LdAuth = useCallback(async (force=false)=>{
    const now=Date.now()
    if(!force&&authProvidersCache&&authProvidersCache.expiresAt>now){
      setAuthProviders(authProvidersCache.value)
      return
    }
    try{
      const r=await fetch(apiUrl('/api/auth/providers'))
      const d=(await r.json()) as {providers:AuthProviderStatus[]}
      const next=d.providers||[]
      authProvidersCache={expiresAt:Date.now()+EDITOR_AUTH_CACHE_MS,value:next}
      setAuthProviders(next)
    }catch{
      setAuthProviders(authProvidersCache?.value||[])
    }
  },[])
  const selectedModelIds = useMemo(() => [primary, ...fallbacks].filter(Boolean), [primary, fallbacks])
  const selectableModels = useMemo(() => mergeSelectedModelOptions(models, selectedModelIds), [models, selectedModelIds])
  const providerForModel = (modelId:string)=>selectableModels.find((model)=>model.id===modelId)?.provider || (isOpenAiCodexSubscriptionModel(modelId) ? 'openai-codex' : modelId.split('/')[0]||'')
  const authForProvider = (provider:string)=>authStatusForProvider(authProviders, provider)
  const maybePromptProviderAuth = (modelId:string)=>{const status=authForProvider(providerForModel(modelId));if(status&&!status.configured)setAuthModalProvider(status)}
  const modelGroups = useMemo(() => groupAvailableModels(selectableModels), [selectableModels])
  const fallbackModelGroups = useMemo(() => groupAvailableModels(selectableModels.filter((m) => m.id !== primary)), [selectableModels, primary])
  const SvM = async () => {
    if (!agent) return
    const providerStatus = authForProvider(providerForModel(primary))
    if (providerStatus && !providerStatus.configured) {
      setMsStatus(`Missing ${authLabelForProvider(providerStatus.provider, providerStatus)} ${authKindForProvider(providerStatus)}. Connect this provider before saving.`)
      setAuthModalProvider(providerStatus)
      return
    }
    setMs(true)
    setMsStatus('')
    const thinkingDefault: ThinkingLevel = thinkingOn ? thinkingLevel : 'off'
    const timeoutSeconds = Math.max(30, Math.min(7200, Math.round(runtimeTimeoutSeconds)))
    try {
      const response = await fetch(apiUrl(`/api/party/agent/${agent.id}/config`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: { primary, fallbacks },
          runtime: { thinkingDefault, timeoutSeconds, parallelPreferred: true },
        }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        error?: string
        config?: {
          model?: OpenClawAgent['model']
          runtime?: {
            thinkingDefault?: ThinkingLevel
            timeoutSeconds?: number
            parallelPreferred?: boolean
          }
        }
      }
      if (!response.ok || !data.ok) {
        setMsStatus(data.error || 'Failed.')
        return
      }
      const savedModel = data.config?.model || { primary, fallbacks }
      const savedRuntime = data.config?.runtime || { thinkingDefault, timeoutSeconds, parallelPreferred: true }
      updateAgentModel(agent.id, savedModel)
      setPrimary(savedModel.primary || primary)
      setFallbacks(savedModel.fallbacks || [])
      updateAgentRuntimePolicy(agent.id, {
        thinkingDefault: savedRuntime.thinkingDefault || thinkingDefault,
        timeoutSeconds: savedRuntime.timeoutSeconds || timeoutSeconds,
        parallelPreferred: savedRuntime.parallelPreferred ?? true,
      }, { persist: false })
      setRuntimeTimeoutSeconds(savedRuntime.timeoutSeconds || timeoutSeconds)
      agentConfigCache.delete(agent.id)
      clearConfigDirty('model','runtime')
      setMsStatus(`Saved. Reasoning ${savedRuntime.thinkingDefault || thinkingDefault} - timeout ${formatDuration((savedRuntime.timeoutSeconds || timeoutSeconds) * 1000)}.`)
    } catch (e) {
      setMsStatus(String(e))
    } finally {
      setMs(false)
    }
  }

  const applyAgentConfigPayload = useCallback((agentId:string,config:AgentConfigPayload,options:ApplyAgentConfigOptions={})=>{
    const shouldApply = (section:AgentConfigDirtySection) => !options.skipDirty || !dirtyConfigSectionsRef.current.has(section)
    if(shouldApply('policy')){
      const sb=config.sandbox||{}
      setSbMode(sb.mode||'all')
      setSbScope(sb.scope||'agent')
      setSbAccess(sb.workspaceAccess||'rw')
      const t=config.tools||{}
      setTAllow((t.allow||[]).join(', '))
      setTDeny((t.deny||[]).join(', '))
    }
    if(config.model&&shouldApply('model')){
      setPrimary(config.model.primary||'')
      setFallbacks(config.model.fallbacks||[])
      updateAgentModel(agentId,config.model)
    }
    if(config.heartbeat&&shouldApply('heartbeat')){
      setTick(config.heartbeat.tickIntervalMs)
      setIdle(config.heartbeat.idleTimeoutMs)
      setCont(config.heartbeat.continuous)
      setRec(config.heartbeat.recoveryMode)
      heartbeatCommitRef.current=config.heartbeat
      updateHeartbeat(agentId,config.heartbeat,{persist:false})
    }
    if(config.runtime&&shouldApply('runtime')){
      const rt=config.runtime.thinkingDefault||'off'
      setThinkingOn(rt!=='off')
      setThinkingLevel(rt==='off'?'minimal':rt)
      const timeoutSeconds=Number.isFinite(config.runtime.timeoutSeconds)?Math.max(30,Math.min(7200,Math.round(config.runtime.timeoutSeconds||720))):720
      const runtime={thinkingDefault:rt,timeoutSeconds,parallelPreferred:config.runtime.parallelPreferred??true}
      setRuntimeTimeoutSeconds(timeoutSeconds)
      runtimeCommitRef.current=runtime
      updateAgentRuntimePolicy(agentId,runtime,{persist:false})
    }
  },[updateAgentModel,updateAgentRuntimePolicy,updateHeartbeat])
  const LdP = useCallback(async (force=false)=>{
    const agentId=agent?.id
    if(!agentId)return
    const cached=agentConfigCache.get(agentId)
    if(!force&&cached&&cached.expiresAt>Date.now()){
      applyAgentConfigPayload(agentId,cached.value,{skipDirty:true})
      return
    }
    const seq = ++configLoadSeqRef.current
    try{
      const r=await fetch(apiUrl(`/api/party/agent/${agentId}/config`))
      const d=(await r.json()) as {ok?:boolean;config?:AgentConfigPayload}
      if(seq!==configLoadSeqRef.current)return
      if(d.ok&&d.config){
        agentConfigCache.set(agentId,{expiresAt:Date.now()+EDITOR_CONFIG_CACHE_MS,value:d.config})
        applyAgentConfigPayload(agentId,d.config,{skipDirty:true})
      }
    }catch{/* policy is optional until the agent config exists */}
  },[agent?.id,applyAgentConfigPayload])
  const SvP = async ()=>{if(!agent)return;setPs(true);setPsStatus('');try{const r=await fetch(apiUrl(`/api/party/agent/${agent.id}/config`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sandbox:{mode:sbMode,scope:sbScope,workspaceAccess:sbAccess},tools:{allow:csv(tAllow),deny:csv(tDeny)}})});const d=(await r.json()) as {ok?:boolean;error?:string};if(r.ok&&d.ok){agentConfigCache.delete(agent.id);clearConfigDirty('policy')}setPsStatus(r.ok&&d.ok?'Saved.':d.error||'Failed.')}catch(e){setPsStatus(String(e))}finally{setPs(false)}}

  const LdW = useCallback(async ()=>{const agentId=agent?.id;if(!agentId)return;setWsLoading(true);try{const q=agent?.workspace?`?path=${encodeURIComponent(agent.workspace)}`:'';const r=await fetchWithTimeout(`/api/party/folders${q}`,undefined,20000);const d=(await r.json()) as {base?:string;folders?:string[]};if(r.ok&&d.folders){setWsFolders(d.folders);if(d.base)setWsPath((current)=>current||d.base||'')}}catch(e){setWsFolders([]);if(isAbortError(e))setWsStatus('Folder list timed out. Paste a path manually or try Browse again.')}finally{setWsLoading(false)}},[agent?.id,agent?.workspace])
  const Br = async (f:string)=>{if(!f.trim()){setWsStatus('Enter a path or use default.');return}setWsPath(f);setWsLoading(true);setWsStatus('');try{const r=await fetchWithTimeout(`/api/party/folders?path=${encodeURIComponent(f)}`,undefined,20000);const d=(await r.json()) as {base?:string;folders?:string[];error?:string;detail?:string};if(r.ok&&d.folders){setWsFolders(d.folders);setWsStatus(d.base?`Browsing: ${d.base}`:'')}else{setWsStatus((d.error||d.detail||'Could not list folders')+` (path: ${f})`);setWsFolders([])}}catch(e){setWsStatus(isAbortError(e)?'Browse timed out. Paste a directory path manually and press Set.':isFetchNetworkError(e)?'Browse request failed before the server responded. Check that the backend is running, then try again.':`Browse failed: ${errorMessage(e)}`);setWsFolders([])}finally{setWsLoading(false)}}
  const applyPickedWorkspace = (pickedPath:string)=>{
    const p=pickedPath.trim()
    if(!p)return false
    setWsPath(p)
    setWsStatus(`Selected: ${p}`)
    void Br(p)
    return true
  }
  const PickWorkspaceDirectoryInput = async (files:FileList|null)=>{
    const selected=files?.[0]
    if(!selected){setWsStatus('No folder selected.');return}
    const resolvePath=window.dystopaiDesktop?.getPathForFile
    if(!resolvePath){setWsStatus('Desktop folder path access is not loaded. Restart the desktop app, then try Browse again.');return}
    setWsLoading(true)
    setWsStatus('Reading selected folder...')
    try{
      const selectedFilePath=await Promise.resolve(resolvePath(selected))
      const selectedDirectory=directoryFromPickedFolderFile(selected, selectedFilePath)
      if(!selectedDirectory)throw new Error('Could not read the selected folder path.')
      applyPickedWorkspace(selectedDirectory)
    }catch(e){
      setWsStatus(`Folder picker failed: ${errorMessage(e)}`)
    }finally{
      setWsLoading(false)
    }
  }
  const Pk = async ()=>{
    if(wsLoading)return
    setWsLoading(true)
    setWsStatus('Opening folder picker...')
    try{
      const desktopPicker=window.dystopaiDesktop?.pickDirectory
      if(desktopPicker){
        try{
          const picked=await desktopPicker({startPath:wsPath||agent?.workspace||''})
          if(picked?.path?.trim()){applyPickedWorkspace(picked.path);return}
          if(picked?.cancelled){setWsStatus(picked.detail||'No folder selected.');return}
          if(picked?.error||picked?.detail)throw new Error(picked.error||picked.detail)
        }catch(e){
          setWsStatus(`Native folder picker failed: ${errorMessage(e)}. Trying fallback picker...`)
        }
      }
      if(!desktopPicker&&window.dystopaiDesktop?.getPathForFile&&workspaceDirectoryRef.current){
        setWsLoading(false)
        setWsStatus('')
        workspaceDirectoryRef.current.value=''
        workspaceDirectoryRef.current.click()
        return
      }
      const r=await fetchWithTimeout('/api/party/folder-picker/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startPath:wsPath||agent?.workspace||''})},30000)
      const text=await r.text()
      let d:{ok?:boolean;sessionId?:string;status?:string;path?:string|null;error?:string;detail?:string}
      try{d=JSON.parse(text) as typeof d}catch{throw new Error(text.trim().startsWith('<')?'Folder picker API was not reached. Reinstall/restart the desktop app.':text.slice(0,180).trim()||'Folder picker returned an empty server response. Restart the desktop app, then try Browse again.')}
      if(d.path?.trim()){applyPickedWorkspace(d.path);return}
      if(!r.ok||!d.ok||!d.sessionId){setWsStatus(d.detail||d.error||'Folder picker could not start.');return}
      setWsStatus('Folder picker is open. Choose a folder or cancel it.')
      const deadline=Date.now()+120000
      while(Date.now()<deadline){
        await wait(750)
        const pr=await fetchWithTimeout(`/api/party/folder-picker/${encodeURIComponent(d.sessionId)}`,undefined,10000)
        const pd=await readJsonResponse<{ok?:boolean;status?:string;path?:string|null;error?:string;detail?:string}>(pr)
        if(pd.status==='pending')continue
        if(pd.status==='selected'&&pd.path?.trim()){applyPickedWorkspace(pd.path);return}
        if(pd.status==='cancelled'){setWsStatus(pd.detail||'No folder selected.');return}
        setWsStatus(pd.detail||pd.error||'Folder picker failed.')
        return
      }
      setWsStatus('Folder picker timed out. Paste a directory path manually and press Set, or try Browse again.')
    }catch(e){
      setWsStatus(isAbortError(e)?'Folder picker timed out. Paste a directory path manually and press Set, or try Browse again.':isFetchNetworkError(e)?'Folder picker request was interrupted before the server responded. Paste a directory path manually and press Set, or try Browse again.':`Picker failed: ${errorMessage(e)}`)
    }finally{
      setWsLoading(false)
    }
  }
  const SvW = async ()=>{
    if(!agent)return
    setWsSaving(true)
    setWsStatus('Setting workspace...')
    try{
      const r=await fetchWithTimeout(apiUrl('/api/party/workspace'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId:agent.id,workspace:wsPath})},90000)
      const d=await readJsonResponse<{ok?:boolean;workspace?:string;error?:string;detail?:string;suggestedWorkspace?:string|null}>(r)
      if(r.ok&&d.ok){
        const finalPath=d.workspace||wsPath
        setWsPath(finalPath)
        updateAgentMeta(agent.id,{workspace:finalPath})
        setWsStatus(`Set: ${finalPath}`)
        void Br(finalPath)
      }else if(d.suggestedWorkspace){
        setWsPath(d.suggestedWorkspace)
        setWsStatus(`${d.error||d.detail||'Failed.'} Suggested: ${d.suggestedWorkspace}`)
      }else setWsStatus(d.error||d.detail||`Failed (${r.status}).`)
    }catch(e){
      setWsStatus(isAbortError(e)?'Workspace setting timed out. The server may still be syncing; try Set again.':isFetchNetworkError(e)?'Workspace request failed before the server responded. The desktop app will try to restart the backend automatically; try Set again in a moment.':`Workspace failed: ${errorMessage(e)}`)
    }finally{setWsSaving(false)}
  }

  type AvatarPickerPayload = { ok?:boolean; sessionId?:string; status?:string; path?:string|null; sourcePath?:string|null; avatar?:string|null; previewUrl?:string|null; error?:string; detail?:string }
  const applyPickedPortrait = (payload:AvatarPickerPayload)=>{
    if(!agent)return false
    const storedAvatar=(payload.avatar||payload.path||'').trim()
    const rawPreview=(payload.previewUrl||'').trim()
    const preview=rawPreview ? apiUrl(rawPreview) : (storedAvatar?apiUrl(`/api/party/avatar/${agent.id}?v=${Date.now()}`):'')
    if(!storedAvatar&&!preview)return false
    setPortraitDraft(storedAvatar||preview)
    setPortraitPreviewSrc(preview||storedAvatar)
    updateAgentMeta(agent.id,{portrait:preview||storedAvatar})
    agentConfigCache.delete(agent.id)
    setPortraitStatus('Updated.')
    return true
  }
  const UploadPortraitFile = async (file:File)=>{
    if(!agent)return
    if(!isSupportedPortraitFile(file)){
      setPortraitStatus('Choose an image file.')
      return
    }
    const localPreview = URL.createObjectURL(file)
    setPortraitPicking(true)
    setPortraitPreviewSrc(localPreview)
    setPortraitStatus('Uploading image...')
    try{
      const r=await fetchWithTimeout(apiUrl(`/api/party/avatar-upload/${encodeURIComponent(agent.id)}?filename=${encodeURIComponent(file.name||'avatar')}`),{
        method:'POST',
        headers:{'Content-Type':file.type||'application/octet-stream'},
        body:file,
      },90000)
      const d=await readJsonResponse<AvatarPickerPayload>(r)
      if(!r.ok||!d.ok)throw new Error(d.detail||d.error||'Avatar upload failed.')
      if(!applyPickedPortrait(d)){
        throw new Error('Avatar upload finished but no preview was returned.')
      }
    }catch(e){
      setPortraitPreviewSrc('')
      setPortraitStatus(isAbortError(e)?'Avatar upload timed out. Try a smaller image or try again.':isFetchNetworkError(e)?'Avatar upload failed before the server responded. Restart the backend if this repeats.':`Upload failed: ${errorMessage(e)}`)
    }finally{
      setPortraitPicking(false)
      window.setTimeout(()=>URL.revokeObjectURL(localPreview),30000)
    }
  }
  const PickPortrait = ()=>{
    if(!agent||portraitPicking)return
    setPortraitStatus('')
    portraitRef.current?.click()
  }

  const LdSharedSkills = useCallback(async (agentId:string,force=false)=>{
    const cached=skillsCache.get(agentId)
    if(!force&&cached&&cached.expiresAt>Date.now()){
      setInstalledSkills(cached.value)
      return
    }
    setSharedSkillsLoading(true)
    try {
      const r = await fetch(apiUrl(`/api/skills/library?agentId=${encodeURIComponent(agentId)}${force?'&refresh=1':''}`), { cache: force ? 'no-store' : 'default' })
      const d = await readJsonResponse<{ok?:boolean; shared?:AgentSkillEntry[]; agent?:AgentSkillEntry[]; error?:string}>(r)
      if (r.ok && d.ok) {
        const next=mergeSkillEntries(d.shared, d.agent)
        skillsCache.set(agentId,{expiresAt:Date.now()+EDITOR_CONFIG_CACHE_MS,value:next})
        setInstalledSkills(next)
      }
      else setClawHubError(d.error || 'Could not load shared skills.')
    } catch(e) {
      setClawHubError(`Could not load shared skills: ${String(e)}`)
    } finally {
      setSharedSkillsLoading(false)
    }
  },[])

  const SearchClawHub = useCallback(async ()=>{
    const q = clawHubQuery.trim()
    if(!q){setClawHubError('Enter a ClawHub search term.');return}
    setClawHubSearching(true);setClawHubError('');setClawHubStatus('')
    try {
      const r = await fetch(apiUrl(`/api/skills/clawhub/search?q=${encodeURIComponent(q)}&limit=8`))
      const d = (await r.json()) as ClawHubSearchPayload
      if(!r.ok||!d.ok){setClawHubError(d.error||d.detail||'ClawHub search failed.');return}
      setClawHubResults(d.results||[])
      setClawHubStatus((d.results||[]).length?`Found ${(d.results||[]).length} skills.`:'No ClawHub skills matched that search.')
    } catch(e) {
      setClawHubError(`ClawHub search failed: ${String(e)}`)
    } finally {
      setClawHubSearching(false)
    }
  },[clawHubQuery])

  const InstallClawHub = useCallback(async (skill:ClawHubSkillResult)=>{
    if(!agent)return
    setClawHubInstalling(skill.slug);setClawHubError('');setClawHubStatus('')
    try {
      const r = await fetch(apiUrl('/api/skills/clawhub/install'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:skill.slug})})
      const d = (await r.json()) as ClawHubInstallPayload
      if(!r.ok||!d.ok){setClawHubError(d.error||d.detail||'ClawHub install failed.');return}
      setClawHubStatus(d.alreadyInstalled?`${skill.displayName||skill.slug} is already installed.`:`Installed ${d.skill?.name||skill.displayName||skill.slug} to the shared OpenClaw skills folder.`)
      skillsCache.delete(agent.id)
      await LdSharedSkills(agent.id,true)
    } catch(e) {
      setClawHubError(`ClawHub install failed: ${String(e)}`)
    } finally {
      setClawHubInstalling('')
    }
  },[agent,LdSharedSkills])

  const UpdateClawHub = useCallback(async (skill:ClawHubSkillResult)=>{
    if(!agent)return
    setClawHubUpdating(skill.slug);setClawHubError('');setClawHubStatus('')
    try {
      const r = await fetch(apiUrl('/api/skills/clawhub/update'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:skill.slug})})
      const d = (await r.json()) as ClawHubInstallPayload
      if(!r.ok||!d.ok){setClawHubError(d.error||d.detail||'ClawHub update failed.');return}
      setClawHubStatus(`Updated ${d.skill?.name||skill.displayName||skill.slug}.`)
      skillsCache.delete(agent.id)
      await LdSharedSkills(agent.id,true)
    } catch(e) {
      setClawHubError(`ClawHub update failed: ${String(e)}`)
    } finally {
      setClawHubUpdating('')
    }
  },[agent,LdSharedSkills])

  const ToggleInstalledSkill = useCallback((skill:AgentSkillEntry,on:boolean)=>{
    if(!agent)return
    const currentAgent = useNexusStore.getState().agents.find((entry)=>entry.id===agent.id) || agent
    const current = new Set(currentAgent.unlockedSkills || [])
    if(on) current.add(skill.id)
    else current.delete(skill.id)
    const next = installedSkills.filter((entry)=>current.has(entry.id)).map((entry)=>entry.id)
    setAgentEnabledSkills(agent.id, installedSkills, next)
  },[agent,installedSkills,setAgentEnabledSkills])

  const LdF = useCallback(async ()=>{
    const agentId=agent?.id
    if(!agentId)return
    const seq=++fileListSeqRef.current
    setRloading(true);setRstatus('')
    try{
      const r=await fetchWithTimeout(`/api/party/resources/${agentId}`,undefined,15000)
      const d=(await r.json()) as {ok?:boolean;files?:string[];error?:string}
      if(seq!==fileListSeqRef.current)return
      if(r.ok&&d.ok&&d.files){
        setRfiles(d.files)
        setRfile((current)=>d.files?.includes(current)?current:d.files?.[0]||'SOUL.md')
      }else{
        setRfiles([])
        setRstatus(d.error||'Could not load files.')
      }
    }catch(e){
      if(seq===fileListSeqRef.current){
        setRfiles([])
        setRstatus(isAbortError(e)?'File list timed out. Try Reload.':`Could not load files: ${errorMessage(e)}`)
      }
    }finally{
      if(seq===fileListSeqRef.current)setRloading(false)
    }
  },[agent?.id])
  const LdFC = useCallback(async (f:string)=>{
    const agentId=agent?.id
    if(!agentId)return
    const seq=++fileContentSeqRef.current
    setRcontentLoading(true);setRstatus('')
    try{
      const r=await fetchWithTimeout(`/api/party/resources/${agentId}/${encodeURIComponent(f)}`,undefined,15000)
      const d=(await r.json()) as {ok?:boolean;content?:string;error?:string}
      if(seq!==fileContentSeqRef.current)return
      if(r.ok&&d.ok)setRcontent(d.content||'')
      else{setRcontent('');setRstatus(d.error||`Could not load ${f}.`)}
    }catch(e){
      if(seq===fileContentSeqRef.current){
        setRcontent('')
        setRstatus(isAbortError(e)?`${f} timed out. Try Reload.`:`Could not load ${f}: ${errorMessage(e)}`)
      }
    }finally{
      if(seq===fileContentSeqRef.current)setRcontentLoading(false)
    }
  },[agent?.id])
  const SvF = async ()=>{if(!agent)return;setRsaving(true);try{const r=await fetch(`/api/party/resources/${agent.id}/${encodeURIComponent(rfile)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:rcontent})});const d=(await r.json()) as {ok?:boolean;error?:string};setRstatus(r.ok&&d.ok?'Saved.':d.error||'Failed.')}catch(e){setRstatus(String(e))}finally{setRsaving(false)}}
  const RetireAgent = useCallback(async ()=>{
    if(!agent||retiring)return
    if(configPatchTimerRef.current){
      window.clearTimeout(configPatchTimerRef.current)
      configPatchTimerRef.current=null
    }
    configPatchRef.current=null
    configPatchAgentIdRef.current=''
    setRetiring(true)
    setRstatus('Retiring agent...')
    try{
      await retireAgent(agent.id)
      agentConfigCache.delete(agent.id)
      skillsCache.delete(agent.id)
      setRetireConfirmOpen(false)
    }catch(e){
      setRstatus(`Retire failed: ${errorMessage(e)}`)
      setRetiring(false)
    }
  },[agent,retireAgent,retiring])
  useEffect(()=>{
    const currentAgent=useNexusStore.getState().agents.find((a)=>a.id===editingAgentId)??null
    if(!isOpen||!currentAgent)return
    const runtimePolicy=currentAgent.runtimePolicy
    const think=runtimePolicy?.thinkingDefault||'off'
    const timeoutSeconds=runtimePolicy?.timeoutSeconds||720
    setNameDraft(currentAgent.name)
    setRoleDraft(currentAgent.role)
    setClassDraft(currentAgent.className)
    setLevelDraft(String(currentAgent.level))
    setPortraitDraft(currentAgent.portrait||'')
    setPortraitPreviewSrc('')
    setPortraitStatus('')
    setPortraitPicking(false)
    setTick(currentAgent.heartbeat.tickIntervalMs)
    setIdle(currentAgent.heartbeat.idleTimeoutMs)
    setCont(currentAgent.heartbeat.continuous)
    setRec(currentAgent.heartbeat.recoveryMode)
    heartbeatDraftRef.current=null
    heartbeatCommitRef.current=currentAgent.heartbeat
    setPrimary(currentAgent.model?.primary||'')
    setFallbacks(currentAgent.model?.fallbacks||[])
    setThinkingOn(think!=='off')
    setThinkingLevel(think==='off'?'minimal':think)
    setRuntimeTimeoutSeconds(timeoutSeconds)
    runtimeCommitRef.current=runtimePolicy||{thinkingDefault:think,timeoutSeconds,parallelPreferred:true}
    setMsStatus('')
    setWsPath(currentAgent.workspace||'')
    setWsStatus('')
    setWsFolders([])
    setRfile('SOUL.md')
    setRfiles([])
    setRcontent('')
    setRstatus('')
    setRloading(false)
    setRcontentLoading(false)
    setRetireConfirmOpen(false)
    setRetiring(false)
    setTab('profile')
    setSk('')
    setSkFilter('all')
    setInstalledSkills([])
    setClawHubStatus('')
    setClawHubError('')
    setClawHubResults([])
    dirtyConfigSectionsRef.current.clear()
    configLoadSeqRef.current += 1
  },[isOpen,editingAgentId])
  useEffect(()=>{if(isOpen&&agent?.id&&(tab==='model'||tab==='heartbeat'||tab==='policy'))void LdP()},[isOpen,agent?.id,tab,LdP])
  useEffect(()=>{if(isOpen&&tab==='model'){void LdM();void LdAuth()}},[isOpen,tab,LdM,LdAuth])
  useEffect(()=>{if(isOpen&&agent?.id&&tab==='workspace')void LdW()},[isOpen,agent?.id,tab,LdW])
  useEffect(()=>{if(isOpen&&agent?.id&&tab==='files')void LdF()},[isOpen,agent?.id,tab,LdF])
  useEffect(()=>{if(isOpen&&editingAgentId&&tab==='files'&&rfile)void LdFC(rfile)},[isOpen,editingAgentId,tab,rfile,LdFC])
  useEffect(()=>{if(isOpen&&agent?.id&&tab==='skills')void LdSharedSkills(agent.id)},[isOpen,agent?.id,tab,LdSharedSkills])
  useEffect(()=>()=>{void flushPendingConfigPatch().catch(()=>{})},[flushPendingConfigPatch])

  if(!agent)return null

  const primaryProvider = providerForModel(primary)
  const primaryAuth = primaryProvider ? authForProvider(primaryProvider) : undefined
  const primaryAuthLabel = authLabelForProvider(primaryProvider, primaryAuth)
  const primaryAuthKind = authKindForProvider(primaryAuth)

  return (
    <AnimatePresence>
      {isOpen&&(
        <motion.div data-dui-overlay="agent-editor" data-windows={IS_WINDOWS_CLIENT?'true':'false'} className={`fixed inset-0 z-50 grid place-items-center p-3 ${IS_WINDOWS_CLIENT?'bg-[#030712]/96':'bg-[#030712]/90 backdrop-blur-xl'}`} initial={IS_WINDOWS_CLIENT?false:{opacity:0}} animate={{opacity:1}} exit={IS_WINDOWS_CLIENT?{opacity:1}:{opacity:0}} transition={{duration:IS_WINDOWS_CLIENT?0:0.14}}>
          <motion.div data-dui-modal="agent-editor" data-windows={IS_WINDOWS_CLIENT?'true':'false'} initial={IS_WINDOWS_CLIENT?false:{scale:0.98,y:8}} animate={IS_WINDOWS_CLIENT?{opacity:1}:{scale:1,y:0}} exit={IS_WINDOWS_CLIENT?{opacity:1}:{scale:0.98,y:8}} transition={{duration:IS_WINDOWS_CLIENT?0:0.14}} className={`flex max-h-[78vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0b1120] to-[#060b12] shadow-2xl shadow-black/50 ${IS_WINDOWS_CLIENT?'':'transform-gpu'}`}>

            {/* HEADER */}
            <div data-editor-header className="shrink-0 border-b border-white/[0.06] bg-white/[0.015] px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div data-editor-avatar className="relative h-12 w-12 overflow-hidden rounded-full ring-2 ring-white/10">
                    {pSrc?<img src={pSrc} alt="" className="h-full w-full object-cover"/>:<div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-lg font-black text-slate-600">{agent.name.charAt(0)}</div>}
                    <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent"/>
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-white tracking-tight">{agent.name}</h2>
                    <p className="text-[9px] font-medium text-slate-500">{agent.id} · Lv.{agent.level} · <span className="capitalize">{agent.rarity}</span></p>
                  </div>
                </div>
                <button data-editor-action="done" onClick={()=>void closeWithHeartbeatFlush()} title="Save pending changes and close agent settings" aria-label="Close agent settings" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 transition hover:border-white/20 hover:text-white">Done</button>
              </div>
              <div data-editor-tabs className="mt-3 flex gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
                {EDITOR_TABS.map((t)=>(
                  <button key={t} data-editor-tab data-active={tab===t?'true':'false'} onClick={()=>setTab(t)} title={EDITOR_TAB_HELP[t]} aria-label={EDITOR_TAB_LABEL[t]} className={`flex-1 rounded-md px-1.5 py-2 text-[9px] font-bold uppercase tracking-[0.1em] transition-all ${tab===t?'bg-gradient-to-r from-cyan-500/20 to-blue-500/15 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-cyan-400/20':'text-slate-600 hover:text-slate-400'}`}>
                    <span className="mr-0.5">{ICON[t]}</span>{t}
                  </button>
                ))}
              </div>
            </div>

            {/* BODY */}
            <div data-editor-body className="flex-1 overflow-auto p-4">
              <div data-editor-content className="mx-auto max-w-md">
                {/* PROFILE */}
                {tab==='profile'&&(
                  <div data-editor-panel="profile" className="space-y-4">
                    <div data-editor-card="portrait" className="flex items-center gap-4">
                      <button type="button" data-editor-portrait onClick={()=>void PickPortrait()} disabled={portraitPicking} title="Upload a new portrait image" aria-label="Upload a new portrait image" className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-full ring-2 ring-white/15 transition hover:ring-cyan-400/40 disabled:opacity-60">
                        {pSrc?<img src={pSrc} alt="" className="h-full w-full object-cover"/>:<div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-4xl font-black text-slate-700">{agent.name.charAt(0)}</div>}
                        <div className="absolute inset-0 flex items-end justify-center rounded-full bg-gradient-to-t from-black/70 to-transparent opacity-0 transition group-hover:opacity-100"><span className="pb-1.5 text-[9px] font-bold text-white">Change</span></div>
                      </button>
                      <input ref={portraitRef} type="file" accept="image/*" className="hidden" onChange={(e)=>{const f=e.target.files?.[0];e.currentTarget.value='';if(f)void UploadPortraitFile(f)}}/>
                      <div className="flex-1 space-y-2">
                        <input type="text" value={portraitDraft} onChange={(e)=>{setPortraitDraft(e.target.value);setPortraitPreviewSrc('')}} onBlur={()=>{if(portraitDraft.trim())PM({portrait:portraitDraft.trim()});setPortraitStatus(portraitDraft.trim()?'Updated.':'')}} placeholder="Portrait URL or path" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={()=>void PickPortrait()} disabled={portraitPicking} title="Choose a portrait image file" className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-1.5 text-[9px] font-bold text-cyan-300 hover:bg-cyan-400/[0.1] disabled:opacity-40">{portraitPicking?'Opening...':'Browse'}</button>
                          <button type="button" onClick={()=>{setPortraitDraft('');setPortraitPreviewSrc('');PM({portrait:''});setPortraitStatus('Cleared.')}} title="Remove the current portrait" className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[9px] font-bold text-slate-400 hover:border-white/20">Clear</button>
                        </div>
                        {portraitStatus&&<p className="text-[9px] text-cyan-400">{portraitStatus}</p>}
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {[{l:'Name',v:nameDraft,s:(v:string)=>setNameDraft(v),b:()=>commitProfileDraft('name'),p:'Agent name'},
                        {l:'Role',v:roleDraft,s:(v:string)=>setRoleDraft(v),b:()=>commitProfileDraft('role'),p:'e.g. Scope Commander'},
                        {l:'Class',v:classDraft,s:(v:string)=>setClassDraft(v),b:()=>commitProfileDraft('className'),p:'e.g. Strategist'},
                        {l:'Level',v:levelDraft,s:(v:string)=>setLevelDraft(v),b:()=>commitProfileDraft('level'),p:'1-99'},
                      ].map((f)=>(
                        <div key={f.l} className="space-y-1">
                          <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{f.l}</label>
                          <input type="text" value={f.v} onChange={(e)=>f.s(e.target.value)} onBlur={f.b} onKeyDown={(e)=>{if(e.key==='Enter')e.currentTarget.blur()}} placeholder={f.p} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Behavior</label>
                      <select value={agent.behaviorProfile} onChange={(e)=>{const next=e.target.value;if(isOption(next,BEHAVIOR_OPTIONS))PM({behaviorProfile:next})}} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400/40">
                        <option value="executor">⚡ executor</option><option value="architect">🏗️ architect</option><option value="auditor">🛡️ auditor</option><option value="researcher">🔬 researcher</option><option value="hybrid">🎭 hybrid</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* MODEL */}
                {tab==='model'&&(
                  <div data-editor-panel="model" className="space-y-4">
                    <div>
                      <h3 className="text-xs font-extrabold text-slate-200 mb-1">Primary Model</h3>
                      {modelsLoading&&!primary&&!modelGroups.length?<div className="animate-pulse h-9 rounded-lg bg-white/[0.03]"/>:(
                        <select value={primary} onChange={(e)=>{markConfigDirty(agent.id,'model');setPrimary(e.target.value);maybePromptProviderAuth(e.target.value)}} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400/40">
                          {!primary&&<option value="">Choose a model...</option>}
                          {modelGroups.length?modelGroups.map((group) => (
                            <optgroup key={group.key} label={formatModelGroupLabel(group)}>
                              {group.models.map((m)=><option key={m.id} value={m.id}>{formatModelChoiceLabel(m)}</option>)}
                            </optgroup>
                          )):<option value={primary}>{primary||'No models available'}</option>}
                        </select>
                      )}
                      {primaryProvider==='google-vertex'&&(
                        <span className="mt-2 inline-flex rounded-full border border-sky-300/30 bg-sky-400/[0.08] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.14em] text-sky-200">google-vertex</span>
                      )}
                      {primaryAuth&&(
                        <div className={`mt-2 rounded-lg border px-3 py-2 text-[9px] ${primaryAuth.configured?'border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-300':'border-amber-400/25 bg-amber-400/[0.06] text-amber-200'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span>{primaryAuth.configured?`${primaryAuthLabel} ${primaryAuthKind} connected.`:`${primaryAuthLabel} ${primaryAuthKind} required.`}</span>
                            <button onClick={()=>setAuthModalProvider(primaryAuth)} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-200 hover:border-cyan-300/30 hover:text-cyan-200">
                              {primaryAuth.configured?'Update Auth':'Connect'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-extrabold text-cyan-100">DeepSeek V4 Stack</p>
                          <p className="mt-0.5 text-[9px] text-slate-500">Pro primary, Flash fallback.</p>
                        </div>
                        <button onClick={()=>{markConfigDirty(agent.id,'model');setPrimary('deepseek/deepseek-v4-pro');setFallbacks((p)=>['deepseek/deepseek-v4-flash',...p.filter((id)=>id!=='deepseek/deepseek-v4-pro'&&id!=='deepseek/deepseek-v4-flash')]);maybePromptProviderAuth('deepseek/deepseek-v4-pro')}} title="Apply DeepSeek Pro as primary with Flash fallback" className="rounded-lg border border-cyan-400/25 bg-cyan-400/[0.08] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200 hover:bg-cyan-400/[0.14]">
                          Apply
                        </button>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-extrabold text-slate-200 mb-1">Fallbacks</h3>
                      <div className="max-h-44 space-y-0.5 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-1.5">
                        {fallbackModelGroups.map((group)=>(
                          <div key={group.key} className="space-y-0.5">
                            <div className="px-2.5 pb-1 pt-2 text-[8px] font-extrabold uppercase tracking-[0.14em] text-slate-500 first:pt-0">{formatModelGroupLabel(group)}</div>
                            {group.models.map((m)=>(
                              <label key={m.id} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] text-slate-300 hover:bg-white/[0.04] cursor-pointer transition">
                                <input type="checkbox" checked={fallbacks.includes(m.id)} onChange={()=>{markConfigDirty(agent.id,'model');setFallbacks((p)=>p.includes(m.id)?p.filter((id)=>id!==m.id):[...p,m.id])}} className="rounded accent-cyan-500"/>
                                <span className="flex-1">{m.provider} / {m.name}</span>
                                <span className="text-[9px] text-slate-500">{m.alias}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-extrabold text-violet-100">Reasoning Effort</p>
                          <p className="mt-0.5 text-[9px] text-slate-500">Provider-native effort for this agent.</p>
                        </div>
                        <span className="rounded-full border border-violet-400/20 bg-violet-400/[0.06] px-2.5 py-0.5 text-[9px] font-extrabold capitalize text-violet-200">{thinkingOn?thinkingLevel:'off'}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-1">
                        {REASONING_EFFORT_LEVELS.map((level)=>{
                          const selected = (thinkingOn ? thinkingLevel : 'off') === level
                          return (
                            <button
                              key={level}
                              type="button"
                              aria-pressed={selected}
                              data-editor-preset="reasoning"
                              data-selected={selected ? 'true' : 'false'}
                              onClick={()=>{markConfigDirty(agent.id,'runtime');if(level==='off'){setThinkingOn(false);PR({thinkingDefault:'off'})}else{setThinkingOn(true);setThinkingLevel(level);PR({thinkingDefault:level})}}}
                              title={`Set reasoning effort to ${level}`}
                              className={`dy-agent-editor-preset rounded-md border px-1.5 py-1.5 text-[9px] font-bold capitalize transition ${selected?'border-violet-300/50 bg-violet-400/[0.14] text-violet-100':'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:text-violet-200'}`}
                            >
                              {level}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-extrabold text-amber-100">Work Timeout</p>
                          <p className="mt-0.5 text-[9px] text-slate-500">Idle detector allowance for real agent turns.</p>
                        </div>
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-0.5 text-[9px] font-extrabold tabular-nums text-amber-200">{formatDuration(runtimeTimeoutSeconds*1000)}</span>
                      </div>
                      <input type="range" min={30} max={7200} step={30} value={runtimeTimeoutSeconds}
                        onChange={(e)=>{const value=Number(e.target.value);markConfigDirty(agent.id,'runtime');setRuntimeTimeoutSeconds(value);PR({timeoutSeconds:value})}}
                        onPointerUp={(e)=>PR({timeoutSeconds:Number(e.currentTarget.value)})}
                        onKeyUp={(e)=>PR({timeoutSeconds:Number(e.currentTarget.value)})}
                        onBlur={(e)=>PR({timeoutSeconds:Number(e.currentTarget.value)})}
                        style={editorRangeStyle(runtimeTimeoutSeconds,30,7200,'#f59e0b','#fde68a','rgba(251, 191, 36, .34)')} className="dy-agent-range h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800/80 accent-amber-400" />
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {WORK_TIMEOUT_PRESETS.map((p)=>{
                          const selected = runtimeTimeoutSeconds === p.seconds
                          return (
                            <button
                              key={p.label}
                              type="button"
                              aria-pressed={selected}
                              data-editor-preset="timeout"
                              data-selected={selected ? 'true' : 'false'}
                              onClick={()=>{markConfigDirty(agent.id,'runtime');setRuntimeTimeoutSeconds(p.seconds);PR({timeoutSeconds:p.seconds})}}
                              title={`Set work timeout to ${formatDuration(p.seconds*1000)}`}
                              className={`dy-agent-editor-preset rounded-md border px-2 py-1.5 text-[9px] font-bold transition ${selected?'border-amber-300/50 bg-amber-400/[0.14] text-amber-100':'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:text-amber-200'}`}
                            >
                              {p.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>void SvM()} disabled={ms} className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-300 hover:bg-cyan-400/[0.12] disabled:opacity-40">{ms?'Saving...':'Save'}</button>
                      {msStatus&&<span className={`text-[9px] font-semibold ${msStatus.includes('Failed')?'text-red-400':'text-emerald-400'}`}>{msStatus}</span>}
                    </div>
                  </div>
                )}

                {/* HEARTBEAT */}
                {tab==='heartbeat'&&(
                  <div data-editor-panel="heartbeat" className="space-y-5">
                    {/* Leader auto-detect badge */}
                    {partySlotIndex===0?(
                      <div className="rounded-xl border border-amber-400/30 bg-gradient-to-r from-amber-400/[0.08] to-amber-300/[0.04] px-4 py-3">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-200">★ Party Leader — Spot 1</p>
                        <p className="mt-0.5 text-[9px] text-amber-300/70">Auto-detected. Heartbeat runs first; orchestrates team.</p>
                      </div>
                    ):partySlotIndex>0?(
                      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] px-4 py-3">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200">Party Slot {partySlotIndex+1}</p>
                        <p className="mt-0.5 text-[9px] text-cyan-300/70">Receives directives from leader. Configure independently.</p>
                      </div>
                    ):(
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Not in party</p>
                        <p className="mt-0.5 text-[9px] text-slate-500">Add to party to activate heartbeat.</p>
                      </div>
                    )}

                    {/* Tick interval — auto-saving slider */}
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Wake Interval</label>
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-0.5 text-[9px] font-extrabold tabular-nums text-cyan-200">{formatDuration(tick)}</span>
                      </div>
                      <input type="range" min={1000} max={1800000} step={1000} value={tick}
                        onChange={(e)=>{const value=Number(e.target.value);markConfigDirty(agent.id,'heartbeat');setTick(value);PH({tickIntervalMs:value})}}
                        onPointerUp={(e)=>PH({tickIntervalMs:Number(e.currentTarget.value)})}
                        onKeyUp={(e)=>PH({tickIntervalMs:Number(e.currentTarget.value)})}
                        onBlur={(e)=>PH({tickIntervalMs:Number(e.currentTarget.value)})}
                        style={editorRangeStyle(tick,1000,1800000)}
                        className="dy-agent-range w-full accent-cyan-400 h-2 rounded-full appearance-none bg-slate-800/80 cursor-pointer" />
                      <div className="mt-1 flex justify-between text-[7px] font-semibold text-slate-600">
                        <span>1s</span><span>15m build loop</span><span>30m</span>
                      </div>
                    </div>

                    {/* Idle timeout — auto-saving slider */}
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Idle Timeout</label>
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-0.5 text-[9px] font-extrabold tabular-nums text-cyan-200">{formatDuration(idle)}</span>
                      </div>
                      <input type="range" min={5000} max={1800000} step={5000} value={idle}
                        onChange={(e)=>{const value=Number(e.target.value);markConfigDirty(agent.id,'heartbeat');setIdle(value);PH({idleTimeoutMs:value})}}
                        onPointerUp={(e)=>PH({idleTimeoutMs:Number(e.currentTarget.value)})}
                        onKeyUp={(e)=>PH({idleTimeoutMs:Number(e.currentTarget.value)})}
                        onBlur={(e)=>PH({idleTimeoutMs:Number(e.currentTarget.value)})}
                        style={editorRangeStyle(idle,5000,1800000)}
                        className="dy-agent-range w-full accent-cyan-400 h-2 rounded-full appearance-none bg-slate-800/80 cursor-pointer" />
                      <div className="mt-1 flex justify-between text-[7px] font-semibold text-slate-600">
                        <span>5s</span><span>13m build idle</span><span>30m</span>
                      </div>
                    </div>

                    {/* Mode toggles */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[{l:'Continuous',v:cont,s:(b:boolean)=>{markConfigDirty(agent.id,'heartbeat');setCont(b);PH({continuous:b})},h:'Stays awake between ticks',icon:'🔄'},
                        {l:'Auto-Recovery',v:rec,s:(b:boolean)=>{markConfigDirty(agent.id,'heartbeat');setRec(b);PH({recoveryMode:b})},h:'Retry on failure',icon:'🛟'},
                      ].map((f)=>(
                        <label
                          key={f.l}
                          data-editor-toggle="heartbeat-mode"
                          data-selected={f.v ? 'true' : 'false'}
                          className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 cursor-pointer hover:border-cyan-400/20 transition group"
                        >
                          <span className="text-lg">{f.icon}</span>
                          <div className="flex-1"><p className="text-[11px] font-bold text-slate-200">{f.l}</p><p className="text-[8px] text-slate-500">{f.h}</p></div>
                          <div className={`dy-agent-editor-switch-track relative h-6 w-11 rounded-full transition-colors ${f.v?'bg-cyan-500/80':'bg-slate-700/80'}`}>
                            <div className={`dy-agent-editor-switch-thumb absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${f.v?'translate-x-5':''}`} />
                          </div>
                          <input type="checkbox" checked={f.v} onChange={(e)=>f.s(e.target.checked)} className="hidden" />
                        </label>
                      ))}
                    </div>

                    {/* Quick presets */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600 mb-2">Quick Set</p>
                      <div className="grid grid-cols-5 gap-1.5">
                        {[{l:'⚡ Fast',h:{tickIntervalMs:2000,idleTimeoutMs:15000,continuous:true,recoveryMode:false}},
                          {l:'🎯 Norm',h:{tickIntervalMs:4200,idleTimeoutMs:40000,continuous:false,recoveryMode:true}},
                          {l:'🧠 Deep',h:{tickIntervalMs:7000,idleTimeoutMs:90000,continuous:false,recoveryMode:true}},
                          {l:'🔁 Loop',h:{tickIntervalMs:3000,idleTimeoutMs:20000,continuous:true,recoveryMode:true}},
                          {l:'🏗️ Build',h:{tickIntervalMs:900000,idleTimeoutMs:780000,continuous:true,recoveryMode:true}},
                        ].map((p)=>{
                          const selected = tick===p.h.tickIntervalMs&&idle===p.h.idleTimeoutMs&&cont===p.h.continuous&&rec===p.h.recoveryMode
                          return (
                            <button
                              key={p.l}
                              type="button"
                              aria-pressed={selected}
                              data-editor-preset="quick"
                              data-selected={selected ? 'true' : 'false'}
                              onClick={()=>{markConfigDirty(agent.id,'heartbeat');setTick(p.h.tickIntervalMs);setIdle(p.h.idleTimeoutMs);setCont(p.h.continuous);setRec(p.h.recoveryMode);PH(p.h)}}
                              title={`Apply ${p.l} heartbeat preset`}
                              className="dy-agent-editor-preset rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2.5 text-[9px] font-bold text-slate-300 hover:border-cyan-400/30 hover:bg-cyan-400/[0.05] hover:text-cyan-200 active:scale-95 transition-all"
                            >
                              {p.l}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Auto-save indicator */}
                    <p className="text-center text-[8px] font-semibold text-emerald-400/70">✓ Changes save automatically</p>
                  </div>
                )}

                {/* POLICY */}
                {tab==='policy'&&(
                  <div data-editor-panel="policy" className="space-y-4">
                    <h3 className="text-xs font-extrabold text-slate-200">Sandbox</h3>
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {[{l:'Mode',v:sbMode,s:(x:string)=>{if(isOption(x,SANDBOX_MODE_OPTIONS)){markConfigDirty(agent.id,'policy');setSbMode(x)}},o:SANDBOX_MODE_OPTIONS},
                        {l:'Scope',v:sbScope,s:(x:string)=>{if(isOption(x,SANDBOX_SCOPE_OPTIONS)){markConfigDirty(agent.id,'policy');setSbScope(x)}},o:SANDBOX_SCOPE_OPTIONS},
                        {l:'Access',v:sbAccess,s:(x:string)=>{if(isOption(x,SANDBOX_ACCESS_OPTIONS)){markConfigDirty(agent.id,'policy');setSbAccess(x)}},o:SANDBOX_ACCESS_OPTIONS},
                      ].map((f)=>(
                        <div key={f.l} className="space-y-1">
                          <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{f.l}</label>
                          <select value={f.v} onChange={(e)=>f.s(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400/40">{f.o.map((o)=><option key={o} value={o}>{o}</option>)}</select>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Allow</label>
                        <input type="text" value={tAllow} onChange={(e)=>{markConfigDirty(agent.id,'policy');setTAllow(e.target.value)}} placeholder="read, write, edit" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Deny</label>
                        <input type="text" value={tDeny} onChange={(e)=>{markConfigDirty(agent.id,'policy');setTDeny(e.target.value)}} placeholder="exec, browser" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>void SvP()} disabled={ps} title="Save sandbox and tool policy" className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-300 hover:bg-cyan-400/[0.12] disabled:opacity-40">{ps?'Saving...':'Save'}</button>
                      {psStatus&&<span className={`text-[9px] font-semibold ${psStatus.includes('Failed')?'text-red-400':'text-emerald-400'}`}>{psStatus}</span>}
                    </div>
                  </div>
                )}

                {/* WORKSPACE */}
                {tab==='workspace'&&(
                  <div data-editor-panel="workspace" className="space-y-4">
                    <div>
                      <h3 className="text-xs font-extrabold text-slate-200 mb-1">Directory</h3>
                      <input
                        ref={workspaceDirectoryRef}
                        type="file"
                        className="hidden"
                        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                        onChange={(event)=>{
                          const files=event.currentTarget.files
                          void PickWorkspaceDirectoryInput(files)
                        }}
                      />
                      <div className="flex gap-1.5 mb-2">
                        <input type="text" value={wsPath} onChange={(e)=>setWsPath(e.target.value)} placeholder="/home/.../project" className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>
                      <button onClick={()=>void Pk()} disabled={wsLoading} className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2 text-[9px] font-bold text-cyan-300 hover:bg-cyan-400/[0.1] disabled:opacity-40">{wsLoading?'Working...':'Browse'}</button>
                      </div>
                      {wsFolders.length>0&&(
                        <div className="max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 space-y-0.5">
                          {wsFolders.map((f)=>(
                            <button key={f} onClick={()=>{setWsPath(f);void Br(f)}} className="w-full text-left rounded-md px-2.5 py-1.5 text-[11px] text-cyan-300 font-mono truncate hover:bg-cyan-400/[0.06]">📁 {f}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>void SvW()} disabled={wsSaving||!wsPath.trim()} title="Assign this workspace to the agent" className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-300 hover:bg-cyan-400/[0.12] disabled:opacity-40">{wsSaving?'Setting...':'Set'}</button>
                      {wsStatus&&<span className={`min-w-0 max-w-[520px] break-words text-[9px] font-semibold leading-relaxed ${workspaceStatusIsError(wsStatus)?'text-red-400':'text-emerald-400'}`}>{wsStatus}</span>}
                    </div>
                  </div>
                )}

                {/* SKILLS */}
                {tab==='skills'&&(
                  <div data-editor-panel="skills" className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.04] px-2.5 py-1 text-[9px] font-bold text-cyan-300">Enabled {ul}/{installedSkills.length}</span>
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.04] px-2.5 py-1 text-[9px] font-bold text-emerald-300">{sharedSkillsLoading?'Syncing':`${sharedClawHubCount} ClawHub`}</span>
                      </div>
                      <div className="flex gap-0.5">
                        {(['all','enabled','disabled'] as const).map((f)=>(
                          <button key={f} onClick={()=>setSkFilter(f)} title={`Show ${f} skills`} className={`rounded-md px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] transition ${skFilter===f?'bg-cyan-400/[0.1] text-cyan-200 border border-cyan-400/20':'text-slate-600 hover:text-slate-400 border border-transparent'}`}>{f}</button>
                        ))}
                      </div>
                    </div>
                    <input type="text" value={sk} onChange={(e)=>setSk(e.target.value)} placeholder="Search installed skills..." className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40"/>

                    <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.035] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[11px] font-extrabold text-emerald-100">ClawHub</h3>
                          <p className="mt-0.5 text-[9px] font-medium text-slate-500">Installs save to the shared OpenClaw skills folder.</p>
                        </div>
                        <button type="button" onClick={()=>agent&&void LdSharedSkills(agent.id,true)} disabled={sharedSkillsLoading} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-[0.10em] text-slate-400 hover:border-white/20 hover:text-slate-200 disabled:opacity-40">Refresh</button>
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <input type="text" value={clawHubQuery} onChange={(e)=>setClawHubQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void SearchClawHub()}} placeholder="Search ClawHub..." className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-400/40"/>
                        <button type="button" onClick={()=>void SearchClawHub()} disabled={clawHubSearching||!clawHubQuery.trim()} title="Search ClawHub for shared skills" className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200 hover:bg-emerald-400/[0.14] disabled:opacity-40">{clawHubSearching?'Searching':'Search'}</button>
                      </div>
                      {(clawHubStatus||clawHubError)&&(
                        <p className={`mt-2 text-[9px] font-semibold ${clawHubError?'text-red-300':'text-emerald-300'}`}>{clawHubError||clawHubStatus}</p>
                      )}
                      {clawHubResults.length>0&&(
                        <div className="mt-2 max-h-56 space-y-1.5 overflow-auto pr-1">
                          {clawHubResults.map((result)=>{
                            const installed = installedClawHubIds.has(skillIdKey(result.slug))
                            const owner = result.owner?.handle || result.ownerHandle || result.owner?.displayName || ''
                            const updated = formatClawHubDate(result.updatedAt)
                            return (
                              <div key={result.slug} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-[11px] font-bold text-slate-100">{result.displayName||result.slug}</p>
                                    <p className="mt-0.5 truncate font-mono text-[8px] text-slate-600">{result.slug}{owner?` / ${owner}`:''}{result.version?` / v${result.version}`:''}{updated?` / ${updated}`:''}</p>
                                  </div>
                                  {installed?(
                                    <button type="button" onClick={()=>void UpdateClawHub(result)} disabled={clawHubUpdating===result.slug} title={`Update ${result.displayName||result.slug}`} className="shrink-0 rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-[0.10em] text-cyan-300 hover:bg-cyan-400/[0.12] disabled:opacity-40">{clawHubUpdating===result.slug?'Updating':'Update'}</button>
                                  ):(
                                    <button type="button" onClick={()=>void InstallClawHub(result)} disabled={Boolean(clawHubInstalling)} title={`Install ${result.displayName||result.slug}`} className="shrink-0 rounded-md border border-emerald-400/25 bg-emerald-400/[0.08] px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-[0.10em] text-emerald-200 hover:bg-emerald-400/[0.14] disabled:opacity-40">{clawHubInstalling===result.slug?'Installing':'Install'}</button>
                                  )}
                                </div>
                                {result.summary&&<p className="mt-1.5 text-[9px] leading-snug text-slate-500">{compactText(result.summary)}</p>}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-0.5 max-h-56 overflow-auto">
                      {sharedSkillsLoading&&<p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">Loading installed skills...</p>}
                      {!sharedSkillsLoading&&!installedSkills.length&&<p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">No installed skills found. Install one from ClawHub first.</p>}
                      {!sharedSkillsLoading&&installedSkills.length>0&&!vs.length&&<p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">No installed skills match this filter.</p>}
                      {vs.map((s)=>{const on=enabledSkillIds.has(s.id);return(
                        <label key={s.id} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 cursor-pointer hover:bg-white/[0.04] transition">
                          <input type="checkbox" checked={on} onChange={(e)=>ToggleInstalledSkill(s,e.target.checked)} className="mt-0.5 rounded accent-cyan-500"/>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-[11px] font-bold text-slate-200">{s.name}</p>
                              <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-500">{sourceLabel(s.source)}</span>
                            </div>
                            <p className="mt-0.5 text-[9px] leading-snug text-slate-500">{compactText(s.description,160)}</p>
                            {s.path&&<p className="mt-0.5 truncate font-mono text-[8px] text-slate-700">{s.path}</p>}
                          </div>
                        </label>
                      )})}
                    </div>
                  </div>
                )}

                {/* FILES */}
                {tab==='files'&&(
                  <div data-editor-panel="files" className="space-y-3">
                    <div className="flex gap-1 flex-wrap">
                      {rloading&&rfiles.length===0&&<span className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">Loading files...</span>}
                      {!rloading&&rfiles.length===0&&<span className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">No files loaded</span>}
                      {rfiles.map((f)=>(
                        <button key={f} onClick={()=>setRfile(f)} className={`rounded-md px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] transition ${f===rfile?'bg-cyan-400/[0.08] text-cyan-200 border border-cyan-400/20':'bg-white/[0.02] text-slate-500 hover:text-slate-300 border border-white/[0.05]'}`}>{f}</button>
                      ))}
                    </div>
                    <textarea value={rcontent} onChange={(e)=>setRcontent(e.target.value)} spellCheck readOnly={rloading||rcontentLoading} placeholder={rcontentLoading?`Loading ${rfile}...`:rloading?'Loading agent files...':'Select a markdown file.'} className="h-64 w-full rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 font-mono text-[11px] text-slate-300 leading-relaxed resize-y placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/30"/>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={()=>void SvF()} disabled={rsaving||rloading||rcontentLoading||!rfile} title={`Save ${rfile || 'selected file'}`} className="rounded-lg border border-emerald-400/30 bg-emerald-400/[0.06] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-300 hover:bg-emerald-400/[0.12] disabled:opacity-40">{rsaving?'Saving...':'Save'}</button>
                      <button onClick={()=>void LdFC(rfile)} disabled={rloading||rcontentLoading||!rfile} title={`Reload ${rfile || 'selected file'}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 hover:border-white/20 disabled:opacity-40">{rcontentLoading?'Loading...':'Reload'}</button>
                      {(rstatus||rloading||rcontentLoading)&&<span className="text-[9px] font-semibold text-cyan-400">{rstatus||(rcontentLoading?`Loading ${rfile}...`:'Loading files...')}</span>}
                      <button type="button" onClick={()=>setRetireConfirmOpen(true)} disabled={retiring} title={`Retire ${agent.name}`} className="ml-auto rounded-lg border border-red-400/40 bg-red-500/[0.10] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-red-200 transition hover:border-red-300/70 hover:bg-red-500/[0.18] disabled:opacity-40">{retiring?'Retiring...':'Retire'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      {authModalProvider&&(
        <ProviderAuthModal
          isOpen
          provider={authModalProvider.provider}
          envKeys={authModalProvider.envKeys}
          providerStatus={authModalProvider}
          onClose={()=>setAuthModalProvider(null)}
          onSave={async(apiKey)=>{
            const r=await fetch(`/api/auth/providers/${authModalProvider.provider}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey})})
            if(!r.ok)throw new Error('Failed to save provider key')
            await LdAuth(true)
            setMsStatus(`${authModalProvider.provider} key saved.`)
          }}
          onConnected={()=>LdAuth(true)}
        />
      )}
      {retireConfirmOpen&&(
        <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <motion.div initial={{scale:0.96,y:8,opacity:0}} animate={{scale:1,y:0,opacity:1}} exit={{scale:0.96,y:8,opacity:0}} role="dialog" aria-modal="true" aria-labelledby="retire-agent-title" className="w-full max-w-md rounded-lg border border-red-400/20 bg-[#111417] p-5 shadow-2xl shadow-black/50">
            <p id="retire-agent-title" className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">Retire agent</p>
            <p className="mt-3 text-sm font-semibold text-slate-100">Are you sure you would like to retire this agent?</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">You will permanently delete {agent.name}, including its OpenClaw customizations, profile, sessions, and agent state. The workspace folder will not be deleted.</p>
            <p className="mt-2 text-[11px] font-semibold text-red-200">This cannot be undone.</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={()=>setRetireConfirmOpen(false)} disabled={retiring} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 transition hover:border-white/20 hover:text-white disabled:opacity-40">Cancel</button>
              <button type="button" onClick={()=>void RetireAgent()} disabled={retiring} className="rounded-lg border border-red-300/50 bg-red-500/[0.16] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/[0.24] disabled:opacity-40">{retiring?'Retiring...':'Yes, retire'}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
