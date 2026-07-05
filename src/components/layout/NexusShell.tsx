import { motion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { AppTab } from '../../store/nexusStore'
import { listCronShifts, stopCronShift, useRuntimeSummaryStatus } from '../../hooks/useRuntimeStatus'
import type { RuntimeCronJob } from '../../hooks/useRuntimeStatus'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import { preloadMissionIconAssets } from '../mission/missionIconAssets'
import { applyStoredUiSettings } from '../settings/uiSettings'
import { Button, StatusChip } from '../ui'

const PartySelector = lazy(() => import('../party/PartySelector').then((module) => ({ default: module.PartySelector })))
const ActivePartyStrip = lazy(() => import('../party/ActivePartyStrip').then((module) => ({ default: module.ActivePartyStrip })))
const MissionDeploymentPanel = lazy(() => import('../mission/MissionDeploymentPanel').then((module) => ({ default: module.MissionDeploymentPanel })))
const AgentResponseConsole = lazy(() => import('../monitor/AgentResponseConsole').then((module) => ({ default: module.AgentResponseConsole })))
const LiveOperationMonitor = lazy(() => import('../monitor/LiveOperationMonitor').then((module) => ({ default: module.LiveOperationMonitor })))
const PluginsPanel = lazy(() => import('../plugins/PluginsPanel').then((module) => ({ default: module.PluginsPanel })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
const AgentEditorModal = lazy(() => import('../editor/AgentEditorModal').then((module) => ({ default: module.AgentEditorModal })))
const RecruitAgentModal = lazy(() => import('../recruit/RecruitAgentModal').then((module) => ({ default: module.RecruitAgentModal })))

const AUTOMNIA_LOCKUP_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const AUTOMNIA_BRAND_LABEL = 'Automnia AI Nexus'
const RECRUIT_ICON_SRC = '/icons/nav-recruit-flat.png'
const AGENT_CONSOLE_PREF_KEY = 'dystopai-agent-console-visibility'
const AGENT_CONSOLE_WIDTH_PREF_KEY = 'dystopai-agent-console-width'
const AGENT_CONSOLE_MIN_WIDTH = 360
const AGENT_CONSOLE_MAX_WIDTH = 760
const AGENT_REGISTRY_MIN_WIDTH = 640
const AGENT_SPLIT_HANDLE_WIDTH = 18
const EMPTY_RUNTIME_CRON_JOBS: RuntimeCronJob[] = []
type ShellNotice = { tone: 'success' | 'warning' | 'error' | 'neutral'; message: string }

type PrimaryWorkspace = Exclude<AppTab, 'settings'>

const WORKSPACE_META: Record<AppTab, { label: string; railMeta: string; description: string; iconSrc: string; tone: string }> = {
  agents: { label: 'Agents', railMeta: 'Roster', description: 'Assemble elite specialists, deploy on missions, and command with precision.', iconSrc: '/icons/nav-agents-flat.png', tone: 'agents' },
  missions: { label: 'Missions', railMeta: 'Launch', description: 'Turn objectives into coordinated, scheduled, and verifiable agent work.', iconSrc: '/icons/nav-missions-flat.png', tone: 'missions' },
  monitor: { label: 'Monitor', railMeta: 'Live ops', description: 'Inspect runtime health, active calls, sessions, cron jobs, and recovery evidence.', iconSrc: '/icons/nav-monitor-flat.png', tone: 'monitor' },
  plugins: { label: 'Plugins', railMeta: 'Runtime', description: 'Manage providers, communication channels, tools, and reusable skills.', iconSrc: '/icons/nav-plugins-flat.png', tone: 'plugins' },
  settings: { label: 'Settings', railMeta: 'System', description: 'Tune interface chrome, mission defaults, active-party runtime policy, and maintenance controls.', iconSrc: '/icons/nav-monitor-flat.png', tone: 'settings' },
}

const PRIMARY_WORKSPACES: { id: PrimaryWorkspace; label: string; railMeta: string; description: string; iconSrc: string; tone: string }[] = [
  { id: 'agents', label: 'Agents', railMeta: 'Roster', description: 'Assemble elite specialists, deploy on missions, and command with precision.', iconSrc: '/icons/nav-agents-flat.png', tone: 'agents' },
  { id: 'missions', label: 'Missions', railMeta: 'Launch', description: 'Turn objectives into coordinated, scheduled, and verifiable agent work.', iconSrc: '/icons/nav-missions-flat.png', tone: 'missions' },
  { id: 'monitor', label: 'Monitor', railMeta: 'Live ops', description: 'Inspect runtime health, active calls, sessions, cron jobs, and recovery evidence.', iconSrc: '/icons/nav-monitor-flat.png', tone: 'monitor' },
  { id: 'plugins', label: 'Plugins', railMeta: 'Runtime', description: 'Manage providers, communication channels, tools, and reusable skills.', iconSrc: '/icons/nav-plugins-flat.png', tone: 'plugins' },
]

function navIconStyle(src: string): CSSProperties {
  return { '--dy-nav-icon': `url("${src}")` } as CSSProperties
}

function savedAgentConsoleWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(AGENT_CONSOLE_WIDTH_PREF_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

function clampAgentConsoleWidth(value: number, workspace: HTMLElement): number {
  const workspaceRect = workspace.getBoundingClientRect()
  const workspaceStyle = window.getComputedStyle(workspace)
  const gap = Number.parseFloat(workspaceStyle.columnGap || workspaceStyle.gap || '0') || 0
  const maxFromWorkspace = workspaceRect.width - AGENT_REGISTRY_MIN_WIDTH - gap
  const maxWidth = Math.max(AGENT_CONSOLE_MIN_WIDTH, Math.min(AGENT_CONSOLE_MAX_WIDTH, maxFromWorkspace))
  return Math.round(Math.min(maxWidth, Math.max(AGENT_CONSOLE_MIN_WIDTH, value)))
}

function PanelLoader() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6" role="status" aria-live="polite" aria-label="Loading workspace">
      <div className="h-3 w-32 animate-pulse rounded-full bg-white/[0.08]" />
      <div className="mt-4 grid gap-3">
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
      </div>
    </div>
  )
}

export function NexusShell() {
  const tab = useNexusStore((s) => s.tab)
  const setTab = useNexusStore((s) => s.setTab)
  const syncPartyOverview = useNexusStore((s) => s.syncPartyOverview)
  const syncMissionProjection = useNexusStore((s) => s.syncMissionProjection)
  const agentCount = useNexusStore((s) => s.agents.length)
  const activePartyCount = useNexusStore((s) => s.activePartyIds.length)
  const busyAgentCount = useNexusStore((s) => s.busyAgentIds.length)
  const responseCount = useNexusStore((s) => s.agentResponses.length)
  const activeMission = useNexusStore((s) => s.activeMission)
  const isEditorOpen = useNexusStore((s) => s.isEditorOpen)
  const missionRunning = activeMission?.status === 'running'
  const activeTab = WORKSPACE_META[tab] || WORKSPACE_META.agents
  const { status: runtimeStatus, refresh: refreshRuntimeStatus } = useRuntimeSummaryStatus(8000)
  const gatewayOnline = Boolean(runtimeStatus?.gateway.healthy || runtimeStatus?.gateway.processRunning)
  const cronJobs = runtimeStatus?.shifts?.active ?? EMPTY_RUNTIME_CRON_JOBS
  const activeCronCount = runtimeStatus?.shifts?.activeCount ?? cronJobs.length
  const workspaceState = tab === 'agents'
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
          : gatewayOnline ? 'Gateway extensions online' : runtimeStatus ? 'Gateway extensions offline' : 'Checking extensions'
  const workspaceStateTone = tab === 'agents'
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
    ? activeCronCount
      ? `${activeCronCount} active/scheduled cron job${activeCronCount === 1 ? '' : 's'}${cronJobSummary ? `: ${cronJobSummary}` : ''}. Right-click to clear.`
      : 'No active/scheduled cron jobs.'
    : 'Loading cron jobs...'
  const [isRecruitOpen, setRecruitOpen] = useState(false)
  const [hasMountedMissionPanel, setHasMountedMissionPanel] = useState(tab === 'missions')
  const [cronClearBusy, setCronClearBusy] = useState(false)
  const [cronClearTargets, setCronClearTargets] = useState<RuntimeCronJob[]>([])
  const [cronNotice, setCronNotice] = useState<ShellNotice | null>(null)
  const [isAgentConsoleVisible, setAgentConsoleVisible] = useState(() => {
    try {
      return window.localStorage.getItem(AGENT_CONSOLE_PREF_KEY) !== 'hidden'
    } catch {
      return true
    }
  })
  const [agentConsoleWidth, setAgentConsoleWidth] = useState<number | null>(savedAgentConsoleWidth)
  const [isAgentSplitResizing, setAgentSplitResizing] = useState(false)
  const [agentsWorkspaceNode, setAgentsWorkspaceNode] = useState<HTMLDivElement | null>(null)
  const [agentRegistryPaneNode, setAgentRegistryPaneNode] = useState<HTMLDivElement | null>(null)
  const pendingTabRef = useRef<AppTab | null>(null)
  const tabFrameRef = useRef<number | null>(null)
  const selectTab = useCallback((nextTab: AppTab) => {
    const currentTab = useNexusStore.getState().tab
    if (nextTab === currentTab && pendingTabRef.current == null) return
    pendingTabRef.current = nextTab
    if (tabFrameRef.current != null) return

    if (typeof window === 'undefined') {
      const targetTab = pendingTabRef.current
      pendingTabRef.current = null
      if (targetTab && targetTab !== currentTab) {
        if (targetTab === 'missions') setHasMountedMissionPanel(true)
        setTab(targetTab)
      }
      return
    }

    tabFrameRef.current = window.requestAnimationFrame(() => {
      tabFrameRef.current = null
      const targetTab = pendingTabRef.current
      pendingTabRef.current = null
      if (!targetTab || targetTab === useNexusStore.getState().tab) return
      if (targetTab === 'missions') setHasMountedMissionPanel(true)
      setTab(targetTab)
    })
  }, [setTab])
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
  const commitAgentConsoleWidth = useCallback((nextWidth: number) => {
    setAgentConsoleWidth(nextWidth)
    try {
      window.localStorage.setItem(AGENT_CONSOLE_WIDTH_PREF_KEY, String(nextWidth))
    } catch {
      // Browser storage can be unavailable in hardened profiles.
    }
  }, [])
  const currentAgentConsoleWidth = useCallback((workspace: HTMLElement) => {
    const consolePane = workspace.querySelector<HTMLElement>('.dy-agent-console-pane')
    const measured = consolePane?.getBoundingClientRect().width || agentConsoleWidth || 0
    return clampAgentConsoleWidth(measured || AGENT_CONSOLE_MIN_WIDTH, workspace)
  }, [agentConsoleWidth])
  const handleAgentSplitPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const workspace = agentsWorkspaceNode
    if (!workspace || !isAgentConsoleVisible) return

    event.preventDefault()
    const splitter = event.currentTarget
    splitter.focus({ preventScroll: true })
    const workspaceRect = workspace.getBoundingClientRect()
    const workspaceStyle = window.getComputedStyle(workspace)
    const gap = Number.parseFloat(workspaceStyle.columnGap || workspaceStyle.gap || '0') || 0
    let nextWidth = currentAgentConsoleWidth(workspace)

    const resizeToPointer = (clientX: number) => {
      const rawWidth = workspaceRect.right - clientX - gap
      nextWidth = clampAgentConsoleWidth(rawWidth, workspace)
      setAgentConsoleWidth(nextWidth)
      workspace.style.setProperty('--dy-command-console-width', `${nextWidth}px`)
    }
    const stopResize = () => {
      setAgentSplitResizing(false)
      document.documentElement.classList.remove('dy-agent-split-resizing')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      commitAgentConsoleWidth(nextWidth)
    }
    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault()
      resizeToPointer(moveEvent.clientX)
    }
    const handlePointerUp = () => {
      stopResize()
    }

    setAgentSplitResizing(true)
    document.documentElement.classList.add('dy-agent-split-resizing')
    splitter.setPointerCapture?.(event.pointerId)
    resizeToPointer(event.clientX)
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
  }, [agentsWorkspaceNode, commitAgentConsoleWidth, currentAgentConsoleWidth, isAgentConsoleVisible])
  const handleAgentSplitKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const workspace = agentsWorkspaceNode
    if (!workspace || !isAgentConsoleVisible) return

    const step = event.shiftKey ? 80 : 32
    let nextWidth = currentAgentConsoleWidth(workspace)
    if (event.key === 'ArrowRight') {
      nextWidth -= step
    } else if (event.key === 'ArrowLeft') {
      nextWidth += step
    } else if (event.key === 'Home') {
      nextWidth = AGENT_CONSOLE_MAX_WIDTH
    } else if (event.key === 'End') {
      nextWidth = AGENT_CONSOLE_MIN_WIDTH
    } else {
      return
    }

    event.preventDefault()
    commitAgentConsoleWidth(clampAgentConsoleWidth(nextWidth, workspace))
  }, [agentsWorkspaceNode, commitAgentConsoleWidth, currentAgentConsoleWidth, isAgentConsoleVisible])
  const agentWorkspaceStyle = agentConsoleWidth
    ? ({ '--dy-command-console-width': `${agentConsoleWidth}px` } as CSSProperties)
    : undefined

  useEffect(() => { void syncPartyOverview() }, [syncPartyOverview])
  useEffect(() => { void syncMissionProjection() }, [syncMissionProjection])
  useEffect(() => { void preloadMissionIconAssets() }, [])
  useEffect(() => { applyStoredUiSettings() }, [])
  useEffect(() => {
    const handleWorkspaceShortcut = (event: globalThis.KeyboardEvent) => {
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
    if (tab === 'missions') setHasMountedMissionPanel(true)
  }, [tab])
  useEffect(() => {
    try {
      window.localStorage.setItem(AGENT_CONSOLE_PREF_KEY, isAgentConsoleVisible ? 'visible' : 'hidden')
    } catch {
      // Browser storage can be unavailable in hardened profiles.
    }
  }, [isAgentConsoleVisible])
  useEffect(() => {
    if (tab !== 'agents' || !isAgentConsoleVisible || !agentsWorkspaceNode || !agentConsoleWidth) return

    const clampSavedWidth = () => {
      const clamped = clampAgentConsoleWidth(agentConsoleWidth, agentsWorkspaceNode)
      if (clamped !== agentConsoleWidth) setAgentConsoleWidth(clamped)
    }

    clampSavedWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampSavedWidth)
      return () => window.removeEventListener('resize', clampSavedWidth)
    }

    const observer = new ResizeObserver(clampSavedWidth)
    observer.observe(agentsWorkspaceNode)
    return () => observer.disconnect()
  }, [agentConsoleWidth, agentsWorkspaceNode, isAgentConsoleVisible, tab])
  useEffect(() => {
    if (tab !== 'agents') return
    const workspace = agentsWorkspaceNode
    const registryPane = agentRegistryPaneNode
    if (!workspace || !registryPane) return

    let frameId = 0
    const syncConsoleHeight = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const registryPanel = registryPane.querySelector<HTMLElement>('[data-dui-panel="agent-registry"]')
        const panelTop = (registryPanel ?? registryPane).getBoundingClientRect().top
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight
        const rootStyle = window.getComputedStyle(document.documentElement)
        const appMainStyle = window.getComputedStyle(workspace.closest<HTMLElement>('.dy-app-main') ?? workspace)
        const shellGutter = Number.parseFloat(rootStyle.getPropertyValue('--dui-shell-gutter') || '0') || 0
        const appMainPaddingBottom = Number.parseFloat(appMainStyle.paddingBottom || '0') || 0
        const bottomInset = Math.max(8, shellGutter) + appMainPaddingBottom
        const availableHeight = Math.floor(viewportHeight - panelTop - bottomInset)
        if (availableHeight > 0) {
          workspace.style.setProperty('--dy-agent-registry-pane-height', `${Math.max(320, availableHeight)}px`)
        }
      })
    }

    syncConsoleHeight()
    window.addEventListener('resize', syncConsoleHeight)
    window.visualViewport?.addEventListener('resize', syncConsoleHeight)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (frameId) window.cancelAnimationFrame(frameId)
        window.removeEventListener('resize', syncConsoleHeight)
        window.visualViewport?.removeEventListener('resize', syncConsoleHeight)
      }
    }

    const observer = new ResizeObserver(syncConsoleHeight)
    observer.observe(workspace)
    observer.observe(registryPane)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', syncConsoleHeight)
      window.visualViewport?.removeEventListener('resize', syncConsoleHeight)
      observer.disconnect()
    }
  }, [agentRegistryPaneNode, agentsWorkspaceNode, isAgentConsoleVisible, tab])
  return (
    <div className={`app-bg relative min-h-screen text-[var(--text-1)] ${tab === 'monitor' ? 'dy-monitor-focus' : ''} ${isEditorOpen ? 'dy-editor-open' : ''}`}>
      <div className="pointer-events-none fixed inset-0 grid-overlay" />
      <a className="dy-skip-link" href="#dystopai-main">Skip to workspace</a>

      <aside className="dy-human-rail fixed z-40 flex flex-col overflow-hidden" aria-label="Automnia AI Nexus navigation">
        <div className="dy-human-rail-head dy-human-rail-head--lockup flex items-center" aria-label={AUTOMNIA_BRAND_LABEL}>
          <img
            className="dy-human-rail-lockup"
            src={AUTOMNIA_LOCKUP_SRC}
            alt={AUTOMNIA_BRAND_LABEL}
            draggable={false}
          />
        </div>

        <nav className="dy-human-nav flex flex-col" aria-label="Primary navigation">
          <Button
            variant="quiet"
            className="dy-human-nav-action flex items-center gap-3 text-left"
            data-tone="recruit"
            aria-label="Recruit a new agent"
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
              onClick={() => selectTab(t.id)}
              aria-label={`${t.label} ${t.railMeta}`}
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
          <nav className="dy-human-nav dy-human-nav--utility flex flex-col" aria-label="Utility navigation">
            <Button
              id="nexus-nav-settings"
              variant="quiet"
              className={`dy-human-nav-utility flex items-center gap-3 text-left ${tab === 'settings' ? 'is-active' : ''}`}
              aria-label="Open runtime settings"
              aria-current={tab === 'settings' ? 'page' : undefined}
              onClick={() => selectTab('settings')}
              leadingIcon={(
                <span className="dy-human-nav-icon dy-human-nav-icon--settings" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                    <path d="M19.5 13.5v-3l-2.35-.42a7.72 7.72 0 0 0-.72-1.73l1.36-1.96-2.12-2.12-1.96 1.36c-.55-.31-1.13-.55-1.73-.72L11.55 2.5h-3l-.42 2.35c-.6.17-1.18.41-1.73.72L4.44 4.21 2.32 6.33l1.36 1.96c-.31.55-.55 1.13-.72 1.73L.61 10.45v3l2.35.42c.17.6.41 1.18.72 1.73l-1.36 1.96 2.12 2.12 1.96-1.36c.55.31 1.13.55 1.73.72l.42 2.35h3l.42-2.35c.6-.17 1.18-.41 1.73-.72l1.96 1.36 2.12-2.12-1.36-1.96c.31-.55.55-1.13.72-1.73l2.35-.42Z" />
                  </svg>
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
              className="dy-human-nav-utility flex items-center gap-3 text-left"
              aria-label="Open Automnia AI Nexus documentation"
              onClick={() => window.open('https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus', '_blank', 'noopener,noreferrer')}
              leadingIcon={(
                <span className="dy-human-nav-icon dy-human-nav-icon--help" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.75 9.5a2.35 2.35 0 0 1 4.5 1c0 1.7-2.25 1.85-2.25 3.5" />
                    <path d="M12 17.25h.01" />
                  </svg>
                </span>
              )}
            >
              <span className="dy-human-nav-copy">
                <strong className="block">Help</strong>
                <span className="block">Documentation</span>
              </span>
            </Button>
          </nav>

        </div>

      </aside>

      <main id="dystopai-main" tabIndex={-1} className="dy-app-main mx-auto max-w-[1680px] px-4 py-6 sm:px-6 sm:py-8">
        {/* Workspace header */}
        <section className="dy-workspace-context" data-workspace={tab} aria-labelledby="dystopai-workspace-title">
          <div className="dy-workspace-context__copy">
            <h1 id="dystopai-workspace-title">{activeTab.label}</h1>
            <p>{activeTab.description}</p>
          </div>
          <div className="dy-workspace-context__meta">
            <div className="dy-status-grid flex flex-wrap items-center justify-end gap-2" aria-label="Workspace status summary">
              <StatusChip
                className="badge dy-status-chip"
                data-tone="neutral"
                data-indicator="agents"
                label="Agents"
                value={agentCount}
              />
              <StatusChip
                className="badge badge--live dy-status-chip"
                data-tone="live"
                data-indicator="party"
                label="In Party"
                value={activePartyCount}
                tone="info"
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
              />
              <StatusChip
                className={gatewayOnline ? 'badge badge--success dy-status-chip' : 'badge dy-status-chip'}
                data-indicator="gateway"
                data-tone={gatewayOnline ? 'success' : 'neutral'}
                label="Gateway"
                state={gatewayOnline ? 'online' : runtimeStatus ? 'offline' : 'loading'}
                tone={gatewayOnline ? 'success' : 'neutral'}
                value={gatewayOnline ? 'ON' : runtimeStatus ? 'OFF' : '...'}
              />
              <button
                type="button"
                className={activeCronCount ? 'badge badge--live dy-status-chip' : 'badge dy-status-chip'}
                data-indicator="cron"
                data-state={cronClearBusy ? 'busy' : runtimeStatus ? activeCronCount ? 'active' : 'idle' : 'loading'}
                data-tone={activeCronCount ? 'live' : 'neutral'}
                title={cronChipTitle}
                aria-label={`${cronChipTitle} Activate to open Monitor${activeCronCount ? '; press Delete to review clearing.' : '.'}`}
                aria-keyshortcuts={activeCronCount ? 'Delete' : undefined}
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
                  {cronClearBusy ? '...' : runtimeStatus ? activeCronCount : '-'}
                </span>
                <span className="dy-status-label">Cron</span>
              </button>
              <StatusChip
                className={responseCount ? 'badge badge--success dy-status-chip' : 'badge dy-status-chip'}
                data-tone={responseCount ? 'success' : 'neutral'}
                data-indicator="results"
                label="Results"
                state={responseCount ? 'active' : 'idle'}
                tone={responseCount ? 'success' : 'neutral'}
                value={responseCount}
              />
              {activeMission && (
                <StatusChip
                  className={`badge dy-status-chip ${missionRunning ? 'badge--warn' : 'badge--success'}`}
                  data-tone={missionRunning ? 'warn' : 'success'}
                  label="Mission"
                  tone={missionRunning ? 'warning' : 'success'}
                  value={activeMission.status}
                />
              )}
            </div>
            <div className="dy-workspace-context__state" data-state={workspaceStateTone} role="status" aria-live="polite">
              <span aria-hidden="true" />
              {workspaceState}
            </div>
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
        </section>

        {/* Workspace content */}
        <motion.div
          id={`nexus-workspace-${tab}`}
          role="region"
          aria-label={`${activeTab.label} workspace`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className="dy-tab-content"
        >
          {tab === 'agents' && (
            <Suspense fallback={<PanelLoader />}>
              <div
                ref={setAgentsWorkspaceNode}
                className={`dy-agents-workspace grid gap-5 ${isAgentConsoleVisible ? 'is-console-visible' : 'is-console-hidden'}`}
                data-console-visible={isAgentConsoleVisible ? 'true' : 'false'}
                data-agent-split-resizing={isAgentSplitResizing ? 'true' : 'false'}
                style={agentWorkspaceStyle}
              >
                <div className="dy-active-party-pane min-w-0">
                  <ActivePartyStrip
                    toolbar={
                      <Button
                        variant="quiet"
                        size="compact"
                        className="dy-console-toggle"
                        aria-pressed={!isAgentConsoleVisible}
                        aria-label={isAgentConsoleVisible ? 'Hide command console' : 'Show command console'}
                        leadingIcon={(
                          <span className="dy-console-toggle__icon" aria-hidden="true">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4.5 6.5h11" />
                              <path d="M4.5 10h7" />
                              <path d="M4.5 13.5h11" />
                            </svg>
                          </span>
                        )}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          setAgentConsoleVisible((visible) => !visible)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          setAgentConsoleVisible((visible) => !visible)
                        }}
                      >
                        <span>{isAgentConsoleVisible ? 'Hide console' : 'Show console'}</span>
                      </Button>
                    }
                  />
                </div>
                <div ref={setAgentRegistryPaneNode} className="agent-registry-pane min-h-0">
                  <PartySelector />
                </div>
                {isAgentConsoleVisible && (
                  <div
                    className="dy-agent-split-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize agent registry and command console"
                    aria-valuemin={AGENT_CONSOLE_MIN_WIDTH}
                    aria-valuemax={AGENT_CONSOLE_MAX_WIDTH}
                    aria-valuenow={agentConsoleWidth ?? undefined}
                    tabIndex={0}
                    title="Drag the Agent Registry edge to resize"
                    style={{ '--dy-agent-split-resizer-width': `${AGENT_SPLIT_HANDLE_WIDTH}px` } as CSSProperties}
                    onPointerDown={handleAgentSplitPointerDown}
                    onKeyDown={handleAgentSplitKeyDown}
                  >
                    <span aria-hidden="true" />
                  </div>
                )}
                {isAgentConsoleVisible && (
                  <div className="dy-agent-console-pane min-h-0">
                    <AgentResponseConsole />
                  </div>
                )}
              </div>
            </Suspense>
          )}

          {hasMountedMissionPanel && (
            <div className={`dy-mission-tab-frame grid gap-5 ${tab === 'missions' ? '' : 'dy-tab-panel-hidden'}`} aria-hidden={tab !== 'missions'}>
              <Suspense fallback={<PanelLoader />}>
                <MissionDeploymentPanel />
              </Suspense>
            </div>
          )}

          {tab === 'monitor' && (
            <Suspense fallback={<PanelLoader />}>
              <LiveOperationMonitor />
            </Suspense>
          )}

          {tab === 'plugins' && (
            <Suspense fallback={<PanelLoader />}>
              <PluginsPanel />
            </Suspense>
          )}

          {tab === 'settings' && (
            <Suspense fallback={<PanelLoader />}>
              <SettingsPanel />
            </Suspense>
          )}

        </motion.div>
      </main>

      <Suspense fallback={null}>
        {isEditorOpen && <AgentEditorModal />}
        {isRecruitOpen && <RecruitAgentModal isOpen={isRecruitOpen} onClose={() => setRecruitOpen(false)} />}
      </Suspense>
    </div>
  )
}
