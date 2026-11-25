import { useAgentVoiceStore } from '../../speech/agentVoiceStore'
import { BackgroundNotifications } from './BackgroundNotifications'
import { ToolApprovals } from './ToolApprovals'
import { FirstSuccessGuide } from './FirstSuccessGuide'
import { NavigationTooltip } from './NavigationTooltip'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { AppTab } from '../../store/nexusStore'
import { resolveAgentEditorId, type AgentEditorTab } from '../../store/nexusUiState'
import { listCronShifts, stopCronShift, useRuntimeSummaryStatus } from '../../hooks/useRuntimeStatus'
import type { RuntimeCronJob } from '../../hooks/useRuntimeStatus'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import { useWorkspaceScroll } from '../../hooks/useWorkspaceScroll'
import type { HelpNavigationTarget } from '../help/HelpAssistantPanel'
import type { SettingsSectionId } from '../settings/SettingsPanel'
import { ActivePartyStrip } from '../party/ActivePartyStrip'
import { PartySelector } from '../party/PartySelector'
import { applyStoredUiSettings } from '../settings/uiSettings'
import { Button, StatusChip } from '../ui'

const LAZY_IMPORT_RELOAD_WINDOW_MS = 30_000

function isLazyImportFailure(error: unknown): boolean {
  return error instanceof Error && /failed to fetch dynamically imported module|dynamically imported module|importing a module script failed|unable to preload css/i.test(error.message)
}

function recoverableLazyImport<T>(key: string, loader: () => Promise<T>): Promise<T> {
  return loader()
    .then((module) => {
      try {
        window.sessionStorage.removeItem(`automnia.lazy-import-recovery.${key}`)
      } catch {
        // Storage may be unavailable in a restricted renderer; the import is
        // still valid and should continue normally.
      }
      return module
    })
    .catch((error: unknown) => {
      if (!isLazyImportFailure(error) || typeof window === 'undefined') throw error

      const storageKey = `automnia.lazy-import-recovery.${key}`
      const now = Date.now()
      let previousAttempt = 0
      try {
        previousAttempt = Number(window.sessionStorage.getItem(storageKey) || 0)
      } catch {
        // Treat unavailable storage as a first attempt and let the reload
        // establish a clean module graph.
      }

      if (!Number.isFinite(previousAttempt) || now - previousAttempt > LAZY_IMPORT_RELOAD_WINDOW_MS) {
        try {
          window.sessionStorage.setItem(storageKey, String(now))
        } catch {
          // Reload is still the safest recovery when storage is unavailable.
        }
        window.location.reload()
        return new Promise<T>(() => {})
      }

      throw error
    })
}

const StableActivePartyStrip = memo(ActivePartyStrip)
const StablePartySelector = memo(PartySelector)

// Keep secondary workspaces lazy while chat is the default landing workspace.
const MissionDeploymentPanel = memo(lazy(() => recoverableLazyImport('mission-deployment-panel', () => import('../mission/MissionDeploymentPanel').then((module) => ({ default: module.MissionDeploymentPanel })))))
const AgentResponseConsole = memo(lazy(() => recoverableLazyImport('agent-response-console', () => import('../monitor/AgentResponseConsole').then((module) => ({ default: module.AgentResponseConsole })))))
const LiveOperationMonitor = memo(lazy(() => recoverableLazyImport('live-operation-monitor', () => import('../monitor/LiveOperationMonitor').then((module) => ({ default: module.LiveOperationMonitor })))))
const PluginsPanel = memo(lazy(() => recoverableLazyImport('plugins-panel', () => import('../plugins/PluginsPanel').then((module) => ({ default: module.PluginsPanel })))))
const SettingsPanel = memo(lazy(() => recoverableLazyImport('settings-panel', () => import('../settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))))
function loadAgentEditorModal() {
  return recoverableLazyImport('agent-editor-modal', () => import('../editor/AgentEditorModal').then((module) => ({ default: module.AgentEditorModal })))
}
let agentEditorModalPromise: ReturnType<typeof loadAgentEditorModal> | null = null
function getAgentEditorModal() {
  if (!agentEditorModalPromise) {
    agentEditorModalPromise = loadAgentEditorModal().catch((error: unknown) => {
      agentEditorModalPromise = null
      throw error
    })
  }
  return agentEditorModalPromise
}
const AgentEditorModal = lazy(getAgentEditorModal)
const RecruitAgentModal = lazy(() => recoverableLazyImport('recruit-agent-modal', () => import('../recruit/RecruitAgentModal').then((module) => ({ default: module.RecruitAgentModal }))))
const HelpAssistantPanel = lazy(() => recoverableLazyImport('help-assistant', () => import('../help/HelpAssistantPanel').then((module) => ({ default: module.HelpAssistantPanel }))))
const CommandPalette = lazy(() => recoverableLazyImport('command-palette', () => import('./CommandPalette').then((module) => ({ default: module.CommandPalette }))))

function prefetchWorkspace(tab: AppTab) {
  const load = {
    chat: () => import('../monitor/AgentResponseConsole'),
    agents: () => Promise.resolve(),
    missions: () => import('../mission/MissionDeploymentPanel'),
    monitor: () => import('../monitor/LiveOperationMonitor'),
    plugins: () => import('../plugins/PluginsPanel'),
    settings: () => import('../settings/SettingsPanel'),
  }[tab]
  void load().catch(() => undefined)
}

function AgentEditorLoadingFallback() {
  return (
    <div
      data-editor-loading="true"
      role="status"
      aria-live="polite"
      aria-label="Loading agent settings"
      className="fixed inset-0 grid place-items-center bg-[#030712]/96 p-4"
      style={{ zIndex: 60 }}
    >
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#080d16] px-5 py-4 text-sm font-semibold text-slate-200 shadow-2xl shadow-black/60">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-200" aria-hidden="true" />
        <span>Opening agent settings…</span>
      </div>
    </div>
  )
}


const AUTOMNIA_LOCKUP_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const AUTOMNIA_BRAND_LABEL = 'Automnia AI Nexus'
const RECRUIT_ICON_SRC = '/icons/nav-recruit-teal.png'
const SETTINGS_ICON_SRC = '/icons/nav-settings-teal.png'
const HELP_ICON_SRC = '/icons/nav-help-teal.png'
const EMPTY_RUNTIME_CRON_JOBS: RuntimeCronJob[] = []
type ShellNotice = { tone: 'success' | 'warning' | 'error' | 'neutral'; message: string }

type PrimaryWorkspace = Exclude<AppTab, 'settings'>

type CronCountBand = 'idle' | 'green' | 'yellow' | 'teal'

function resolveCronCountBand(count: number): CronCountBand {
  if (!Number.isFinite(count) || count <= 0) return 'idle'
  if (count <= 5) return 'green'
  if (count <= 8) return 'yellow'
  return 'teal'
}

const WORKSPACE_META: Record<AppTab, { label: string; railMeta: string; iconSrc: string; tone: string }> = {
  chat: { label: 'Agent Chat', railMeta: 'Conversations', iconSrc: '/icons/generated-graphite/chat.png', tone: 'chat' },
  agents: { label: 'Agents', railMeta: 'Roster', iconSrc: '/icons/nav-agents-teal.png', tone: 'agents' },
  missions: { label: 'Missions', railMeta: 'Launch', iconSrc: '/icons/nav-missions-teal.png', tone: 'missions' },
  monitor: { label: 'Monitor', railMeta: 'Live ops', iconSrc: '/icons/nav-monitor-teal.png', tone: 'monitor' },
  plugins: { label: 'Plugins', railMeta: 'Runtime', iconSrc: '/icons/nav-plugins-teal.png', tone: 'plugins' },
  settings: { label: 'Settings', railMeta: 'System', iconSrc: SETTINGS_ICON_SRC, tone: 'settings' },
}

const PRIMARY_WORKSPACES: { id: PrimaryWorkspace; label: string; railMeta: string; iconSrc: string; tone: string }[] = [
  { id: 'chat', label: 'Agent Chat', railMeta: 'Conversations', iconSrc: '/icons/generated-graphite/chat.png', tone: 'chat' },
  { id: 'agents', label: 'Agents', railMeta: 'Roster', iconSrc: '/icons/nav-agents-teal.png', tone: 'agents' },
  { id: 'missions', label: 'Missions', railMeta: 'Launch', iconSrc: '/icons/nav-missions-teal.png', tone: 'missions' },
  { id: 'monitor', label: 'Monitor', railMeta: 'Live ops', iconSrc: '/icons/nav-monitor-teal.png', tone: 'monitor' },
  { id: 'plugins', label: 'Plugins', railMeta: 'Runtime', iconSrc: '/icons/nav-plugins-teal.png', tone: 'plugins' },
]

function navIconStyle(src: string): CSSProperties {
  return { '--dy-nav-icon': `url("${src}")` } as CSSProperties
}


function PanelLoader({ workspace = 'console' }: { workspace?: AppTab | 'console' }) {
  return (
    <div
      className="min-h-[280px] rounded-xl border border-white/10 p-4 sm:p-6"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${workspace}`}
    >
      <span className="sr-only">Loading {workspace}. Your workspace will appear here.</span>
      <div aria-hidden="true" className="space-y-4 animate-pulse motion-reduce:animate-none">
        <div className="h-5 w-40 rounded bg-white/10" />
        <div className="h-10 rounded-lg bg-white/5" />
        <div className={`grid gap-3 ${workspace === 'plugins' || workspace === 'missions' ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
          {Array.from({ length: workspace === 'console' ? 2 : 3 }, (_, index) => <div key={index} className="space-y-3 rounded-lg border border-white/5 p-4">
            <div className="h-3 w-2/3 rounded bg-white/10" /><div className="h-3 w-full rounded bg-white/5" /><div className="h-3 w-4/5 rounded bg-white/5" />
          </div>)}
        </div>
        {workspace === 'console' && <div className="h-16 rounded-lg border border-white/10 bg-white/5" />}
      </div>
    </div>
  )
}

export function NexusShell() {
  const [approvalsAvailable, setApprovalsAvailable] = useState(true)
  const tab = useNexusStore((s) => s.tab)
  const workspaceScrollRoot = useRef<HTMLDivElement>(null)
  useWorkspaceScroll(tab, workspaceScrollRoot)
  const setTab = useNexusStore((s) => s.setTab)
  const syncPartyOverview = useNexusStore((s) => s.syncPartyOverview)
  const syncMissionProjection = useNexusStore((s) => s.syncMissionProjection)
  const agents = useNexusStore((s) => s.agents)
  const agentCount = useNexusStore((s) => s.agents.length)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const activePartyCount = useNexusStore((s) => s.activePartyIds.length)
  const busyAgentCount = useNexusStore((s) => s.busyAgentIds.length)
  const responseCount = useNexusStore((s) => s.agentResponses.length)
  const activeMission = useNexusStore((s) => s.activeMission)
  const isEditorOpen = useNexusStore((s) => s.isEditorOpen)
  const missionRunning = activeMission?.status === 'running'

  // Warm the settings chunk only after the first paint or when someone reaches
  // a settings trigger. A speculative import failure must never initiate the
  // lazy-import recovery reload; the actual click still uses that recovery.
  useEffect(() => {
    let cancelled = false
    let idleHandle: number | null = null
    let timeoutHandle: number | null = null
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const preload = () => {
      if (!cancelled) void import('../editor/AgentEditorModal').catch(() => undefined)
    }
    const onIntent = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-agent-editor-trigger]')) preload()
    }
    if (idleWindow.requestIdleCallback) idleHandle = idleWindow.requestIdleCallback(preload, { timeout: 2500 })
    else timeoutHandle = window.setTimeout(preload, 1200)
    window.addEventListener('pointerover', onIntent, { passive: true })
    window.addEventListener('focusin', onIntent)
    return () => {
      cancelled = true
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
      window.removeEventListener('pointerover', onIntent)
      window.removeEventListener('focusin', onIntent)
    }
  }, [])
  const activeTab = WORKSPACE_META[tab] || WORKSPACE_META.agents
  // Runtime status is useful context, not a frame-by-frame feed. Keep the
  // Monitor responsive without repeatedly waking the Gateway and renderer on
  // lower-powered PCs; polling also pauses when the window is not focused.
  const runtimeSummaryPollInterval = tab === 'monitor' ? 15000 : 30000
  const { status: runtimeStatus, error: runtimeError, refresh: refreshRuntimeStatus } = useRuntimeSummaryStatus(runtimeSummaryPollInterval)
  const gatewayOnline = Boolean(runtimeStatus?.gateway.healthy || runtimeStatus?.gateway.processRunning)
  const gatewayMigration = runtimeStatus?.gateway.migration?.active === true
  const gatewayMigrationMessage = runtimeStatus?.gateway.migration?.message
    || 'OpenClaw is applying startup migrations. The Gateway may restart several times while this completes.'
  const cronJobs = runtimeStatus?.shifts?.active ?? EMPTY_RUNTIME_CRON_JOBS
  const cronStatusUnavailable = Boolean(runtimeStatus?.shifts?.error)
  const activeCronCount = runtimeStatus?.shifts?.activeCount ?? cronJobs.length
  const cronCountBand = runtimeStatus
    ? cronStatusUnavailable ? 'idle' : resolveCronCountBand(activeCronCount)
    : 'idle'
  const primaryAgent = useMemo(() => {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const candidateIds = [
      missionRunning ? activeMission?.selectedAgents[0] : undefined,
      activePartyIds.find((agentId) => agentsById.get(agentId)?.isDefault),
      agents.find((agent) => agent.isDefault)?.id,
      activePartyIds[0],
      agents[0]?.id,
    ]
    return candidateIds
      .filter((agentId): agentId is string => Boolean(agentId))
      .map((agentId) => agentsById.get(agentId))
      .find((agent) => Boolean(agent))
  }, [activeMission, activePartyIds, agents, missionRunning])
  const workspaceState = gatewayMigration
    ? 'Gateway migration in progress'
    : tab === 'agents' || tab === 'chat'
      ? busyAgentCount
        ? `${busyAgentCount} agent${busyAgentCount === 1 ? '' : 's'} active`
        : gatewayOnline
          ? 'Ready for commands'
          : runtimeStatus
            ? 'Runtime offline'
            : 'Connecting to runtime'
      : tab === 'missions'
        ? missionRunning
          ? 'Mission in progress'
          : gatewayOnline
            ? 'Ready to deploy'
            : runtimeStatus
              ? 'Runtime offline'
              : 'Connecting to runtime'
        : tab === 'monitor'
          ? gatewayOnline ? 'Runtime connected' : runtimeStatus ? 'Runtime offline' : 'Connecting to runtime'
          : tab === 'settings'
            ? 'Settings ready'
            : gatewayOnline ? 'Gateway connected · inspect extension status below' : runtimeStatus ? 'Gateway offline' : 'Checking gateway'
  const workspaceStateTone = gatewayMigration
    ? 'active'
    : tab === 'agents' || tab === 'chat'
      ? busyAgentCount ? 'active' : gatewayOnline ? 'healthy' : runtimeStatus ? 'offline' : 'loading'
      : tab === 'missions'
        ? missionRunning ? 'active' : gatewayOnline ? 'healthy' : runtimeStatus ? 'offline' : 'loading'
        : tab === 'settings'
          ? 'healthy'
          : gatewayOnline
            ? 'healthy'
            : runtimeStatus
              ? 'offline'
              : 'loading'
  const cronJobSummary = useMemo(() => cronJobs.slice(0, 4).map((job) => `${job.name} (${job.agent})`).join(', '), [cronJobs])
  const cronChipTitle = runtimeStatus
    ? cronStatusUnavailable
      ? 'Cron status temporarily unavailable. Open Monitor to retry.'
      : activeCronCount
      ? `${activeCronCount} active/scheduled cron job${activeCronCount === 1 ? '' : 's'}${cronJobSummary ? `: ${cronJobSummary}` : ''}. Right-click to clear.`
      : 'No active/scheduled cron jobs.'
    : 'Loading cron jobs...'
  const [isRecruitOpen, setRecruitOpen] = useState(false)
  const [isHelpOpen, setHelpOpen] = useState(false)
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [clearFailure, setClearFailure] = useState<{ message: string; party: boolean } | null>(null)
  const [retryClearBusy, setRetryClearBusy] = useState(false)
  useEffect(() => {
    const report = (event: Event) => {
      const outcome = (event as CustomEvent<{ ok: boolean; message: string; party: boolean }>).detail
      if (outcome) setClearFailure(outcome.ok ? null : outcome)
    }
    window.addEventListener('automnia:console-clear-result', report)
    return () => window.removeEventListener('automnia:console-clear-result', report)
  }, [])
  useEffect(() => {
    const warn = () => setStorageWarning(true)
    window.addEventListener('automnia:persistence-warning', warn)
    return () => window.removeEventListener('automnia:persistence-warning', warn)
  }, [])
  const [pluginsFocusQuery, setPluginsFocusQuery] = useState('')
  const [settingsFocusSection, setSettingsFocusSection] = useState<SettingsSectionId>('account')
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0)
  const [focusCommandConsole, setFocusCommandConsole] = useState(false)
  const closeHelp = useCallback(() => setHelpOpen(false), [])
  const [cronClearBusy, setCronClearBusy] = useState(false)
  const [cronClearTargets, setCronClearTargets] = useState<RuntimeCronJob[]>([])
  const [cronNotice, setCronNotice] = useState<ShellNotice | null>(null)
  const pendingVoiceAgentId = useAgentVoiceStore((s) => s.pendingAgentId)
  const pendingTabRef = useRef<AppTab | null>(null)
  const tabFrameRef = useRef<number | null>(null)
  const selectTab = useCallback((nextTab: AppTab) => {
    const currentTab = useNexusStore.getState().tab
    if (nextTab === currentTab && pendingTabRef.current == null) return
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('automnia:workspace-leaving'))
    pendingTabRef.current = nextTab
    if (tabFrameRef.current != null) return

    if (typeof window === 'undefined') {
      const targetTab = pendingTabRef.current
      pendingTabRef.current = null
      if (targetTab && targetTab !== currentTab) {
        setTab(targetTab)
      }
      return
    }

    tabFrameRef.current = window.requestAnimationFrame(() => {
      tabFrameRef.current = null
      const targetTab = pendingTabRef.current
      pendingTabRef.current = null
      if (!targetTab || targetTab === useNexusStore.getState().tab) { window.dispatchEvent(new Event('automnia:workspace-staying')); return }
      setTab(targetTab)
    })
  }, [setTab])
  useEffect(() => {
    if (pendingVoiceAgentId) selectTab('chat')
  }, [pendingVoiceAgentId, selectTab])
  const navigateFromHelp = useCallback((target: HelpNavigationTarget) => {
    closeHelp()
    if (target === 'recruit') {
      setRecruitOpen(true)
      return
    }
    if (target.startsWith('agent-editor')) {
      const editorTab = target === 'agent-editor'
        ? 'profile'
        : target.replace('agent-editor-', '') as AgentEditorTab
      const state = useNexusStore.getState()
      const firstVisibleRegistryAgentId = typeof document === 'undefined'
        ? undefined
        : document.querySelector<HTMLElement>('[data-agent-registry-scroll] [data-agent-card="true"]')?.dataset.agentId
      const agentId = resolveAgentEditorId(state.agents, state.selectedAgentId, state.activePartyIds, firstVisibleRegistryAgentId, state.selectedAgentIds)
      if (!agentId) {
        selectTab('agents')
        return
      }
      state.selectAgent(agentId)
      state.openEditor(agentId, editorTab)
      selectTab('agents')
      return
    }
    if (target.startsWith('settings-')) {
      setSettingsFocusSection(target.replace('settings-', '') as SettingsSectionId)
      setSettingsFocusRequest((request) => request + 1)
      selectTab('settings')
      return
    }
    if (target === 'command-console') {
      setFocusCommandConsole(true)
      selectTab('chat')
      return
    }
    if (target === 'plugins-clawtalk' || target === 'plugins-telegram') {
      setPluginsFocusQuery(target === 'plugins-clawtalk' ? 'ClawTalk' : 'Telegram')
      selectTab('plugins')
      return
    }
    if (target === 'agents' || target === 'missions' || target === 'monitor' || target === 'plugins' || target === 'settings') {
      selectTab(target)
    }
  }, [closeHelp, selectTab])
  useEffect(() => {
    const navigate = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const target = event.detail
      if (target !== 'settings-account' && target !== 'plugins' && target !== 'missions' && target !== 'monitor') return
      if (target === 'settings-account') {
        useNexusStore.getState().closeEditor()
        setRecruitOpen(false)
      }
      navigateFromHelp(target as HelpNavigationTarget)
    }
    window.addEventListener('automnia:navigate', navigate)
    return () => window.removeEventListener('automnia:navigate', navigate)
  }, [navigateFromHelp])
  useEffect(() => () => {
    if (tabFrameRef.current != null && typeof window !== 'undefined') window.cancelAnimationFrame(tabFrameRef.current)
  }, [])
  const requestClearCronJobs = async () => {
    if ((!activeCronCount && !cronJobs.length) || cronClearBusy) return
    setCronClearTargets([])
    setCronNotice(null)
    const jobs = await listCronShifts().catch(() => cronJobs)
    if (!jobs.length) {
      refreshRuntimeStatus()
      setCronNotice({ tone: 'neutral', message: 'No active/scheduled cron jobs to clear.' })
      return
    }
    setCronClearTargets(jobs)
    setCronNotice({
      tone: 'warning',
      message: `Review before clearing ${jobs.length} active/scheduled cron job${jobs.length === 1 ? '' : 's'}.`,
    })
  }
  const cancelClearCronJobs = () => {
    setCronClearTargets([])
    setCronNotice({ tone: 'neutral', message: 'Cron clear cancelled.' })
  }
  const confirmClearCronJobs = async () => {
    const jobs = cronClearTargets
    if (!jobs.length || cronClearBusy) return
    setCronClearBusy(true)
    setCronNotice({ tone: 'warning', message: `Clearing ${jobs.length} cron job${jobs.length === 1 ? '' : 's'}...` })
    try {
      const results = await Promise.allSettled(jobs.map((job) => stopCronShift(job.id)))
      const failed = results.filter((result) => result.status === 'rejected')
      refreshRuntimeStatus()
      setCronClearTargets([])
      if (failed.length) {
        setCronNotice({
          tone: 'error',
          message: `Cleared ${jobs.length - failed.length} cron job${jobs.length - failed.length === 1 ? '' : 's'}; ${failed.length} could not be cleared.`,
        })
      } else {
        setCronNotice({
          tone: 'success',
          message: `Cleared ${jobs.length} cron job${jobs.length === 1 ? '' : 's'}.`,
        })
      }
    } finally {
      setCronClearBusy(false)
    }
  }
  useEffect(() => { void syncPartyOverview().catch(() => undefined) }, [syncPartyOverview])
  useEffect(() => { void syncMissionProjection().catch(() => undefined) }, [syncMissionProjection])
  useEffect(() => { applyStoredUiSettings() }, [])
  useEffect(() => {
    const handleWorkspaceShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.defaultPrevented) {
        if (document.querySelector('[aria-modal="true"]')) return
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName
      if (target?.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return

      const shortcuts: Record<string, AppTab | 'recruit'> = {
        '1': 'agents',
        '2': 'missions',
        '3': 'monitor',
        '4': 'plugins',
        '5': 'settings',
        n: 'recruit',
      }
      const action = shortcuts[event.key.toLowerCase()]
      if (!action) return

      event.preventDefault()
      if (action === 'recruit') {
        setRecruitOpen(true)
      } else {
        selectTab(action)
      }
    }

    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [selectTab])
  useEffect(() => {
    if (!focusCommandConsole || tab !== 'chat') return
    const focusConsole = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('.dy-command-textarea')
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      setFocusCommandConsole(false)
    }
    window.addEventListener('automnia:console-ready', focusConsole)
    focusConsole()
    return () => window.removeEventListener('automnia:console-ready', focusConsole)
  }, [focusCommandConsole, tab])
  return (
    <div className={`app-bg relative min-h-screen text-[var(--text-1)] ${tab === 'monitor' ? 'dy-monitor-focus' : ''} ${isEditorOpen ? 'dy-editor-open' : ''}`}>
      <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
        <defs><filter id="automnia-generated-icon-ink" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feComponentTransfer result="shape"><feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 0 1" /></feComponentTransfer>
          <feFlood floodColor="#d3d9df" result="ink" /><feComposite in="ink" in2="shape" operator="in" />
        </filter></defs>
      </svg>
      <ToolApprovals onAvailabilityChange={setApprovalsAvailable} />
      <div className="pointer-events-none fixed inset-0 grid-overlay" />
      <a className="dy-skip-link" href="#automnia-main">Skip to workspace</a>

      <aside className="dy-human-rail fixed z-40 flex flex-col overflow-hidden" aria-label="Automnia AI Nexus navigation">
        <div className="dy-human-rail-head dy-human-rail-head--lockup flex items-center" aria-label={AUTOMNIA_BRAND_LABEL}>
          <img
            className="dy-human-rail-app-icon"
            src="/brand/automnia-ai-nexus-app-icon.png"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <img
            className="dy-human-rail-lockup"
            src={AUTOMNIA_LOCKUP_SRC}
            alt={AUTOMNIA_BRAND_LABEL}
            draggable={false}
          />
        </div>

        <div className="dy-human-rail-navigation">
          <nav className="dy-human-nav flex flex-col" aria-label="Primary navigation">
          <Button
            variant="quiet"
            className="dy-human-nav-action flex items-center gap-3 text-left"
            data-tone="recruit"
            data-nav-label="Recruit a new agent" aria-label="Recruit a new agent"
            onClick={() => setRecruitOpen(true)}
            leadingIcon={(
              <span className="dy-human-nav-icon" style={navIconStyle(RECRUIT_ICON_SRC)}>
                <img className="dy-human-nav-icon-img" src={RECRUIT_ICON_SRC} alt="" />
              </span>
            )}
          >
            <span className="dy-human-nav-copy">
              <strong className="block">Recruit</strong>
              <span className="block">Discover</span>
            </span>
          </Button>
          {PRIMARY_WORKSPACES.map((t) => (
            <Button
              key={t.id}
              id={`nexus-nav-${t.id}`}
              variant="quiet"
              onPointerEnter={() => prefetchWorkspace(t.id)}
              onFocus={() => prefetchWorkspace(t.id)}
              onClick={() => selectTab(t.id)}
              data-nav-label={t.label} aria-label={`${t.label} ${t.railMeta}`}
              aria-current={tab === t.id ? 'page' : undefined}
              data-tone={t.tone}
              className={`flex items-center gap-3 text-left ${tab === t.id ? 'is-active' : ''}`}
              leadingIcon={(
                <span className="dy-human-nav-icon" style={navIconStyle(t.iconSrc)}>
                  <img className="dy-human-nav-icon-img" src={t.iconSrc} alt="" />
                </span>
              )}
            >
              <span className="dy-human-nav-copy">
                <strong className="block">{t.label}</strong>
                <span className="block">{t.railMeta}</span>
              </span>
            </Button>
          ))}
          </nav>

          <div className="dy-human-rail-bottom">
            {!approvalsAvailable && <div className="dy-approvals-status" role="status" title="Approval requests may be unavailable while the connection is being restored.">Approvals reconnecting</div>}
            <nav className="dy-human-nav dy-human-nav--utility flex flex-col" aria-label="Utility navigation">
            <Button
              id="nexus-nav-settings"
              variant="quiet"
              data-tone="settings"
              className={`dy-human-nav-utility flex items-center gap-3 text-left ${tab === 'settings' ? 'is-active' : ''}`}
              data-nav-label="Settings" aria-label="Open runtime settings"
              aria-current={tab === 'settings' ? 'page' : undefined}
              onPointerEnter={() => prefetchWorkspace('settings')}
              onFocus={() => prefetchWorkspace('settings')}
              onClick={() => selectTab('settings')}
              leadingIcon={(
                <span className="dy-human-nav-icon dy-human-nav-icon--settings" aria-hidden="true">
                  <img className="dy-human-nav-icon-img" src={SETTINGS_ICON_SRC} alt="" />
                </span>
              )}
            >
              <span className="dy-human-nav-copy">
                <strong className="block">Settings</strong>
                <span className="block">System</span>
              </span>
            </Button>
            <Button
              variant="quiet"
              data-tone="help"
              className="dy-human-nav-utility flex items-center gap-3 text-left"
              data-nav-label="Help" aria-label="Open Automnia Assistant help"
              onClick={() => setHelpOpen(true)}
              leadingIcon={(
                <span className="dy-human-nav-icon dy-human-nav-icon--help" aria-hidden="true">
                  <img className="dy-human-nav-icon-img" src={HELP_ICON_SRC} alt="" />
                </span>
              )}
            >
              <span className="dy-human-nav-copy">
                <strong className="block">Help</strong>
                <span className="block">Assistant</span>
              </span>
            </Button>
            </nav>

          </div>
        </div>

      </aside>

      <main id="automnia-main" tabIndex={-1} data-workspace={tab} className="dy-app-main mx-auto max-w-[1680px] px-4 py-6 sm:px-6 sm:py-8">
        {/* Workspace header */}
        {tab !== 'chat' && <section className="dy-workspace-context" data-workspace={tab} aria-labelledby="automnia-workspace-title">
          <div className="dy-workspace-context__copy">
            <h1
              id="automnia-workspace-title"
              className="dy-workspace-context__heading"
              aria-label={`Automnia — ${tab === 'agents' ? 'Agent Operations' : activeTab.label}`}
            >
              <span className="dy-workspace-context__tab-label">
                {tab === 'agents' ? 'Agent Operations' : activeTab.label}
              </span>
            </h1>
          </div>
          <div className="dy-workspace-context__meta">
            <div className="dy-status-grid flex flex-wrap items-center justify-end gap-2" aria-label="Workspace status summary">
              <StatusChip
                className="badge dy-status-chip"
                data-tone="neutral"
                data-indicator="agents"
                data-agent-rarity={primaryAgent?.rarity ?? 'none'}
                label="Agents"
                value={agentCount}
                showDot={false}
              />
              <StatusChip
                className="badge badge--live dy-status-chip"
                data-tone="live"
                data-indicator="party"
                data-party-count={Math.min(activePartyCount, 6)}
                label="In Party"
                value={activePartyCount}
                tone="info"
                showDot={false}
              />
              <StatusChip
                className={busyAgentCount ? 'badge badge--warn dy-status-chip' : 'badge dy-status-chip'}
                data-indicator="running"
                data-tone={busyAgentCount ? 'warn' : 'neutral'}
                data-status-kind="running-agents"
                label="Running"
                state={busyAgentCount ? 'active' : 'idle'}
                tone={busyAgentCount ? 'warning' : 'neutral'}
                title={busyAgentCount ? `${busyAgentCount} agent${busyAgentCount === 1 ? '' : 's'} running` : 'No agents running'}
                value={busyAgentCount}
                showDot={false}
              />
              <StatusChip
                className={gatewayMigration ? 'badge badge--warn dy-status-chip' : gatewayOnline ? 'badge badge--success dy-status-chip' : 'badge dy-status-chip'}
                data-indicator="gateway"
                data-tone={gatewayMigration ? 'warn' : gatewayOnline ? 'success' : 'neutral'}
                label="Gateway"
                state={gatewayMigration ? 'migrating' : gatewayOnline ? 'online' : runtimeStatus ? 'offline' : 'loading'}
                tone={gatewayMigration ? 'warning' : gatewayOnline ? 'success' : 'neutral'}
                value={gatewayMigration ? 'MIGRATING' : gatewayOnline ? 'ON' : runtimeStatus ? 'OFF' : '...'}
                title={gatewayMigration ? gatewayMigrationMessage : undefined}
                live={gatewayMigration}
                showDot={false}
              />
              <button
                type="button"
                className={activeCronCount && !cronStatusUnavailable ? 'badge badge--live dy-status-chip' : 'badge dy-status-chip'}
                data-indicator="cron"
                data-cron-band={cronCountBand}
                data-state={cronClearBusy ? 'busy' : runtimeStatus ? cronStatusUnavailable ? 'error' : activeCronCount ? 'active' : 'idle' : 'loading'}
                data-tone={cronStatusUnavailable ? 'warning' : activeCronCount ? 'live' : 'neutral'}
                title={cronChipTitle}
                aria-label={`${cronChipTitle} Activate to open Monitor${activeCronCount && !cronStatusUnavailable ? '; press Delete to review clearing.' : '.'}`}
                aria-keyshortcuts={activeCronCount && !cronStatusUnavailable ? 'Delete' : undefined}
                disabled={cronClearBusy || !runtimeStatus}
                onClick={() => selectTab('monitor')}
                onKeyDown={(event) => {
                  if (event.key !== 'Delete' || !activeCronCount) return
                  event.preventDefault()
                  void requestClearCronJobs()
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  void requestClearCronJobs()
                }}
              >
                <span className="dy-status-value">
                  {cronClearBusy ? '...' : runtimeStatus ? cronStatusUnavailable ? '—' : activeCronCount : '-'}
                </span>
                <span className="dy-status-label">Cron</span>
              </button>
              <StatusChip
                className="badge dy-status-chip"
                data-tone="neutral"
                data-indicator="results"
                label="Results"
                state={responseCount ? 'active' : 'idle'}
                tone="neutral"
                value={responseCount}
                showDot={false}
              />
              {activeMission && (
                <StatusChip
                  className={`badge dy-status-chip ${missionRunning ? 'badge--warn' : 'badge--success'}`}
                  data-tone={missionRunning ? 'warn' : 'success'}
                  label="Mission"
                  tone={missionRunning ? 'warning' : 'success'}
                  value={activeMission.status}
                  showDot={false}
                />
              )}
            </div>
            <div className="dy-workspace-context__state" data-state={workspaceStateTone} role="status" aria-live="polite">
              {workspaceState}
            </div>
            <Button
              variant="quiet"
              size="compact"
              onClick={() => setCommandPaletteOpen(true)}
              aria-keyshortcuts="Control+k Meta+k"
              title="Quick Links (Ctrl/⌘ K)"
            >
              Quick Links
            </Button>
            {gatewayMigration ? (
              <ActionStatusBanner
                className="dy-workspace-context__notice dy-gateway-migration-notice mt-3 w-full text-left text-[11px] leading-relaxed"
                rounded="lg"
                tone="warning"
                message="OpenClaw migration in progress"
                detail={gatewayMigrationMessage}
              />
            ) : null}
          </div>
          {(cronNotice || cronClearTargets.length > 0) && (
            <ActionStatusBanner
              className="dy-workspace-context__notice relative w-full px-4 text-[11px] leading-relaxed"
              rounded="2xl"
              buttonRounded="none"
              actionTextClassName="text-[8px]"
              tone={cronNotice?.tone || (cronClearTargets.length ? 'warning' : 'neutral')}
              message={cronNotice?.message || 'Cron jobs need review.'}
              detail={cronClearTargets.length > 0 ? (
                <>
                  {cronClearTargets.slice(0, 3).map((job) => job.name).join(', ')}
                  {cronClearTargets.length > 3 ? ` +${cronClearTargets.length - 3} more` : ''}
                </>
              ) : undefined}
              detailTitle={cronClearTargets.map((job) => `${job.name} (${job.agent})`).join(', ')}
              confirmLabel="Clear"
              confirmBusyLabel="Clearing"
              confirmAriaLabel={`Clear ${cronClearTargets.length} cron job${cronClearTargets.length === 1 ? '' : 's'}`}
              cancelAriaLabel="Keep cron jobs scheduled"
              busy={cronClearBusy}
              onConfirm={cronClearTargets.length > 0 ? () => void confirmClearCronJobs() : undefined}
              onCancel={cronClearTargets.length > 0 ? cancelClearCronJobs : undefined}
            />
          )}
        </section>}

        <NavigationTooltip />
        <BackgroundNotifications />
        {tab === 'agents' && <FirstSuccessGuide onNavigate={navigateFromHelp} />}
        {storageWarning && <ActionStatusBanner tone="warning" message="Local preferences could not be saved." detail="Your previous saved copy is preserved. Free storage space before closing the app." />}
        {clearFailure && <ActionStatusBanner tone="error" message={clearFailure.message} confirmLabel="Retry clearing sessions" confirmBusyLabel="Clearing sessions" busy={retryClearBusy} onConfirm={() => {
          setRetryClearBusy(true)
          const action = clearFailure.party ? useNexusStore.getState().clearAll : useNexusStore.getState().clearAgentResponses
          void action().finally(() => setRetryClearBusy(false))
        }} />}
        {/* Workspace content */}
        {/* Keep the host node stable. Deferred workspaces each have their own
            boundary key, so React never updates one workspace's Suspense subtree as another. */}
        <div
          id={`nexus-workspace-${tab}`}
          ref={workspaceScrollRoot}
          role="region"
          aria-label={`${activeTab.label} workspace`}
          className="dy-tab-content dy-surface-enter"
        >
          <div className="dy-chat-workspace" hidden={tab !== 'chat'}>
            <Suspense fallback={<PanelLoader workspace="chat" />}>
              <AgentResponseConsole />
            </Suspense>
          </div>

          {tab === 'agents' && (
            <div className="dy-agents-workspace is-console-hidden grid gap-5" data-console-visible="false">
              <div className="dy-active-party-pane min-w-0"><StableActivePartyStrip /></div>
              <div className="agent-registry-pane min-h-0"><StablePartySelector /></div>
            </div>
          )}

          {tab === 'missions' && (
            <div key="missions" className="dy-mission-tab-frame grid gap-5">
              <Suspense key="missions" fallback={<PanelLoader workspace="missions" />}>
                <MissionDeploymentPanel />
              </Suspense>
            </div>
          )}

          {tab === 'monitor' && (
            <Suspense key="monitor" fallback={<PanelLoader workspace="monitor" />}>
              <LiveOperationMonitor status={runtimeStatus} error={runtimeError} onRefresh={refreshRuntimeStatus} />
            </Suspense>
          )}

          {tab === 'plugins' && (
            <Suspense key="plugins" fallback={<PanelLoader workspace="plugins" />}>
              <PluginsPanel focusQuery={pluginsFocusQuery} />
            </Suspense>
          )}

          {tab === 'settings' && (
            <Suspense key="settings" fallback={<PanelLoader workspace="settings" />}>
              <SettingsPanel focusSection={settingsFocusSection} focusRequest={settingsFocusRequest} />
            </Suspense>
          )}

        </div>
      </main>

      {isEditorOpen && <Suspense fallback={<AgentEditorLoadingFallback />}><AgentEditorModal /></Suspense>}
      {isRecruitOpen && <Suspense fallback={null}><RecruitAgentModal isOpen={isRecruitOpen} onClose={() => setRecruitOpen(false)} /></Suspense>}
      {isHelpOpen && <Suspense fallback={<PanelLoader />}><HelpAssistantPanel isOpen onClose={closeHelp} onNavigate={navigateFromHelp} /></Suspense>}
      {isCommandPaletteOpen && <Suspense fallback={null}><CommandPalette onClose={() => setCommandPaletteOpen(false)} onNavigate={navigateFromHelp} /></Suspense>}
    </div>
  )
}
