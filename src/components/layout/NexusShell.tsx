import { motion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useState, useTransition } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { AppTab } from '../../store/nexusStore'
import { listCronShifts, stopCronShift, useRuntimeSummaryStatus } from '../../hooks/useRuntimeStatus'
import type { RuntimeCronJob } from '../../hooks/useRuntimeStatus'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import { preloadMissionIconAssets } from '../mission/missionIconAssets'

const PartySelector = lazy(() => import('../party/PartySelector').then((module) => ({ default: module.PartySelector })))
const ActivePartyStrip = lazy(() => import('../party/ActivePartyStrip').then((module) => ({ default: module.ActivePartyStrip })))
const MissionDeploymentPanel = lazy(() => import('../mission/MissionDeploymentPanel').then((module) => ({ default: module.MissionDeploymentPanel })))
const AgentResponseConsole = lazy(() => import('../monitor/AgentResponseConsole').then((module) => ({ default: module.AgentResponseConsole })))
const LiveOperationMonitor = lazy(() => import('../monitor/LiveOperationMonitor').then((module) => ({ default: module.LiveOperationMonitor })))
const PluginsPanel = lazy(() => import('../plugins/PluginsPanel').then((module) => ({ default: module.PluginsPanel })))
const AgentEditorModal = lazy(() => import('../editor/AgentEditorModal').then((module) => ({ default: module.AgentEditorModal })))
const RecruitAgentModal = lazy(() => import('../recruit/RecruitAgentModal').then((module) => ({ default: module.RecruitAgentModal })))

const DYSTOPAI_MARK_SRC = '/brand/dystopai-app-icon.png'
const DYSTOPAI_LOCKUP_SRC = '/brand/dystopai-logo-multi-model-transparent-v2.png'
const RECRUIT_ICON_SRC = '/icons/nav-recruit-flat.png'
const AGENT_CONSOLE_PREF_KEY = 'dystopai-agent-console-visibility'
const AGENT_CONSOLE_WIDTH_PREF_KEY = 'dystopai-agent-console-width'
const AGENT_CONSOLE_MIN_WIDTH = 360
const AGENT_CONSOLE_MAX_WIDTH = 760
const AGENT_REGISTRY_MIN_WIDTH = 640
const AGENT_SPLIT_HANDLE_WIDTH = 18
type ShellNotice = { tone: 'success' | 'warning' | 'error' | 'neutral'; message: string }

const TABS: { id: AppTab; label: string; meta: string; railMeta: string; iconSrc: string; tone: string }[] = [
  { id: 'agents', label: 'Agents', meta: 'registry', railMeta: 'Roster', iconSrc: '/icons/nav-agents-flat.png', tone: 'agents' },
  { id: 'missions', label: 'Missions', meta: 'orchestration', railMeta: 'Launch', iconSrc: '/icons/nav-missions-flat.png', tone: 'missions' },
  { id: 'monitor', label: 'Monitor', meta: 'logs', railMeta: 'Live ops', iconSrc: '/icons/nav-monitor-flat.png', tone: 'monitor' },
  { id: 'plugins', label: 'Plugins', meta: 'runtime', railMeta: 'Runtime', iconSrc: '/icons/nav-plugins-flat.png', tone: 'plugins' },
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
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
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
  const { status: runtimeStatus, refresh: refreshRuntimeStatus } = useRuntimeSummaryStatus(8000)
  const gatewayOnline = Boolean(runtimeStatus?.gateway.healthy || runtimeStatus?.gateway.processRunning)
  const cronJobs = runtimeStatus?.shifts?.active || []
  const activeCronCount = runtimeStatus?.shifts?.activeCount ?? cronJobs.length
  const cronJobSummary = cronJobs.slice(0, 4).map((job) => `${job.name} (${job.agent})`).join(', ')
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
  const [, startTabTransition] = useTransition()
  const selectTab = (nextTab: AppTab) => {
    if (nextTab === 'missions') setHasMountedMissionPanel(true)
    startTabTransition(() => setTab(nextTab))
  }
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

      <aside className="dy-human-rail fixed z-40 flex flex-col overflow-hidden">
        <div className="dy-human-rail-head dy-human-rail-head--icon-only flex items-center justify-center" aria-label="DystopAI">
          <img src={DYSTOPAI_MARK_SRC} alt="DystopAI" />
        </div>

        <nav className="dy-human-nav flex flex-col">
          <button
            type="button"
            className="dy-human-nav-action flex items-center gap-3 text-left"
            data-tone="recruit"
            aria-label="Recruit a new agent"
            onClick={() => setRecruitOpen(true)}
          >
            <span className="dy-human-nav-icon" style={navIconStyle(RECRUIT_ICON_SRC)}>
              <img className="dy-human-nav-icon-img" src={RECRUIT_ICON_SRC} alt="" />
            </span>
            <span className="dy-human-nav-copy">
              <strong className="block">Recruit</strong>
              <span className="block">Create</span>
            </span>
          </button>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              aria-label={`${t.label} ${t.railMeta}`}
              aria-current={tab === t.id ? 'page' : undefined}
              data-tone={t.tone}
              className={`flex items-center gap-3 text-left ${tab === t.id ? 'is-active' : ''}`}
            >
              <span className="dy-human-nav-icon" style={navIconStyle(t.iconSrc)}>
                <img className="dy-human-nav-icon-img" src={t.iconSrc} alt="" />
              </span>
              <span className="dy-human-nav-copy">
                <strong className="block">{t.label}</strong>
                <span className="block">{t.railMeta}</span>
              </span>
            </button>
          ))}
        </nav>

      </aside>

      <div className="dy-app-main mx-auto max-w-[1680px] px-4 py-6 sm:px-6 sm:py-8">
        {/* ── HEADER ── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="dy-command-header relative mb-7 overflow-hidden rounded-3xl border border-white/[0.07] bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(8,13,25,0.84)_46%,rgba(6,12,19,0.94))] px-5 py-5 shadow-[0_28px_90px_-54px_rgba(243,189,62,0.45)] backdrop-blur-xl sm:px-7"
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />
          <div className="dy-command-header-inner relative flex flex-wrap items-center justify-between gap-5">
          <div className="brand-lockup dy-logo-fixed flex min-w-[280px] items-center gap-4" aria-label="DystopAI Multi Model Nexus">
            <img
              src={DYSTOPAI_LOCKUP_SRC}
              alt="DystopAI Multi Model Nexus"
              className="dy-logo-lockup object-contain"
              draggable={false}
            />
          </div>

          <div className="dy-status-grid flex flex-wrap items-center justify-end gap-2">
            <span className="badge dy-status-chip" data-tone="neutral">
              <span className="dy-status-value">{agentCount}</span>
              <span className="dy-status-label">Agents</span>
            </span>
            <span className="badge badge--live dy-status-chip" data-tone="live">
              <span className="dy-status-value">{activePartyCount}</span>
              <span className="dy-status-label">In Party</span>
            </span>
            <span
              className={busyAgentCount ? 'badge badge--warn dy-status-chip' : 'badge dy-status-chip'}
              data-status-kind="running-agents"
              data-state={busyAgentCount ? 'active' : 'idle'}
              data-tone={busyAgentCount ? 'warn' : 'neutral'}
              title={busyAgentCount ? `${busyAgentCount} agent${busyAgentCount === 1 ? '' : 's'} running` : 'No agents running'}
            >
              <span className="dy-status-value">{busyAgentCount}</span>
              <span className="dy-status-label">Running</span>
            </span>
            <span className={gatewayOnline ? 'badge badge--success dy-status-chip' : 'badge dy-status-chip'} data-tone={gatewayOnline ? 'success' : 'neutral'}>
              <span className="dy-status-value">{gatewayOnline ? 'ON' : runtimeStatus ? 'OFF' : '...'}</span>
              <span className="dy-status-label">Gateway</span>
            </span>
            <button
              type="button"
              className={activeCronCount ? 'badge badge--live dy-status-chip' : 'badge dy-status-chip'}
              data-tone={activeCronCount ? 'live' : 'neutral'}
              title={cronChipTitle}
              aria-label={cronChipTitle}
              disabled={cronClearBusy || !runtimeStatus}
              onClick={() => selectTab('monitor')}
              onContextMenu={(event) => {
                event.preventDefault()
                void requestClearCronJobs()
              }}
            >
              <span className="dy-status-value">{cronClearBusy ? '...' : runtimeStatus ? activeCronCount : '-'}</span>
              <span className="dy-status-label">Cron</span>
            </button>
            <span className="badge badge--success dy-status-chip" data-tone="success">
              <span className="dy-status-value">{responseCount}</span>
              <span className="dy-status-label">Results</span>
            </span>
            {activeMission && (
              <span className={`badge dy-status-chip ${missionRunning ? 'badge--warn' : 'badge--success'}`} data-tone={missionRunning ? 'warn' : 'success'}>
                <span className="dy-status-value">{activeMission.status}</span>
                <span className="dy-status-label">Mission</span>
              </span>
            )}
          </div>
          {(cronNotice || cronClearTargets.length > 0) && (
            <ActionStatusBanner
              className="relative mt-4 w-full basis-full px-4 text-[11px] leading-relaxed"
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
          </div>
        </motion.header>

        {/* ── TAB BAR ── */}
        <div
          className="dy-top-tabs mb-6 grid gap-2 rounded-3xl border border-white/[0.06] bg-white/[0.025] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:grid-cols-4"
          role="tablist"
          aria-label="DystopAI workspaces"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`nexus-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`nexus-panel-${t.id}`}
              onClick={() => selectTab(t.id)}
              className={`tab-underline rounded-2xl px-5 py-3 text-left transition-all duration-300 ${
                tab === t.id ? 'active' : ''
              }`}
              style={tab === t.id ? {
                color: 'var(--text-0)',
                background: 'linear-gradient(135deg, rgba(185,199,204,0.10), rgba(100,114,120,0.055))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 28px -24px rgba(165,182,190,0.42)',
              } : {
                color: 'var(--text-4)',
              }}
              onMouseEnter={(e) => { if (tab !== t.id) e.currentTarget.style.color = 'var(--text-2)' }}
              onMouseLeave={(e) => { if (tab !== t.id) e.currentTarget.style.color = 'var(--text-4)' }}
            >
              <span className="block text-[13px] font-black tracking-normal">{t.label}</span>
              <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.18em] opacity-55">{t.meta}</span>
            </button>
          ))}
        </div>

        {/* ── TAB CONTENT ── */}
        <motion.div
          id={`nexus-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`nexus-tab-${tab}`}
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
                      <button
                        type="button"
                        className="dy-console-toggle"
                        aria-pressed={!isAgentConsoleVisible}
                        aria-label={isAgentConsoleVisible ? 'Hide command console' : 'Show command console'}
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
                        <span className="dy-console-toggle__icon" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4.5 6.5h11" />
                            <path d="M4.5 10h7" />
                            <path d="M4.5 13.5h11" />
                          </svg>
                        </span>
                        <span>{isAgentConsoleVisible ? 'Hide console' : 'Show console'}</span>
                      </button>
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

        </motion.div>
      </div>

      <Suspense fallback={null}>
        {isEditorOpen && <AgentEditorModal />}
        {isRecruitOpen && <RecruitAgentModal isOpen={isRecruitOpen} onClose={() => setRecruitOpen(false)} />}
      </Suspense>
    </div>
  )
}
