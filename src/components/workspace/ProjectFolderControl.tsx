import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiErrorMessage, apiRequest } from '../../api/client'
import { useNexusStore } from '../../store/nexusStore'

const PROJECT_FOLDER_STORAGE_KEY = 'automnia:project-folder'
const PROJECT_FOLDER_CHANGED_EVENT = 'automnia:project-folder-changed'

type ProjectFolderControlProps = {
  /** Agents that make up the current context, such as the mission team or chat lanes. */
  targetAgentIds?: string[]
  /** Short label for the scoped target action in the current surface. */
  targetScopeLabel?: string
  className?: string
  compact?: boolean
}

type WorkspaceSavePayload = {
  ok?: boolean
  workspace?: string
  error?: string
  detail?: string
}

type FolderPickerSessionPayload = {
  sessionId?: string
  status?: 'pending' | 'selected' | 'cancelled' | 'error'
  path?: string | null
  cancelled?: boolean
  detail?: string
}

function readProjectFolder(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(PROJECT_FOLDER_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeProjectFolder(path: string): void {
  try {
    window.localStorage.setItem(PROJECT_FOLDER_STORAGE_KEY, path)
  } catch {
    // The folder is still usable for the current session if storage is full.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROJECT_FOLDER_CHANGED_EVENT, { detail: { path } }))
  }
}

const EMPTY_TARGET_IDS: string[] = []

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

export function ProjectFolderControl({ targetAgentIds = EMPTY_TARGET_IDS, targetScopeLabel = 'Current lanes', className = '', compact = false }: ProjectFolderControlProps) {
  const agents = useNexusStore((state) => state.agents)
  const updateAgentMeta = useNexusStore((state) => state.updateAgentMeta)
  const [projectFolder, setProjectFolder] = useState(readProjectFolder)
  const [scope, setScope] = useState<'all' | 'targets'>('all')
  const [isPicking, setIsPicking] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isExpanded, setIsExpanded] = useState(!compact)
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 16 })
  const [status, setStatus] = useState('')
  const controlRef = useRef<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const targetIds = useMemo(
    () => uniqueIds(targetAgentIds).filter((id) => agents.some((agent) => agent.id === id)),
    [agents, targetAgentIds],
  )
  const allAgentIds = useMemo(() => agents.map((agent) => agent.id), [agents])
  const applyIds = scope === 'targets' && targetIds.length ? targetIds : allAgentIds
  const applyLabel = scope === 'targets' && targetIds.length
    ? `Apply to ${targetScopeLabel.toLowerCase()} (${targetIds.length})`
    : `Apply to all ${allAgentIds.length} agents`

  useEffect(() => {
    const sync = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { path?: unknown } : undefined
      if (detail && typeof detail.path === 'string') setProjectFolder(detail.path)
      else setProjectFolder(readProjectFolder())
    }
    window.addEventListener(PROJECT_FOLDER_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PROJECT_FOLDER_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const positionCompactPanel = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    const panel = panelRef.current
    if (!trigger || !panel) return
    const gap = 8
    const edge = 12
    const panelRect = panel.getBoundingClientRect()
    const panelHeight = panelRect.height
    const panelWidth = panelRect.width
    const above = trigger.top - panelHeight - gap >= edge
    const top = above
      ? trigger.top - panelHeight - gap
      : Math.min(trigger.bottom + gap, window.innerHeight - panelHeight - edge)
    const triggerCenter = trigger.left + trigger.width / 2
    const centeredLeft = triggerCenter - panelWidth / 2
    const left = Math.max(edge, Math.min(centeredLeft, window.innerWidth - panelWidth - edge))
    setPopoverPosition({ top: Math.max(edge, top), left })
  }, [])

  useLayoutEffect(() => {
    if (!compact || !isExpanded) return
    positionCompactPanel()
    const reposition = () => positionCompactPanel()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [compact, isExpanded, positionCompactPanel, projectFolder, status, scope, isApplying])

  useEffect(() => {
    if (!compact || !isExpanded) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setIsExpanded(false)
    }
    const dismissOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false)
    }
    const dismissOnResize = () => setIsExpanded(false)
    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('keydown', dismissOnKey)
    window.addEventListener('resize', dismissOnResize)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('keydown', dismissOnKey)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [compact, isExpanded])

  const toggleCompactPanel = () => {
    if (isExpanded) {
      setIsExpanded(false)
      return
    }
    setIsExpanded(true)
  }

  const setPickedFolder = (path: string) => {
    const normalized = path.trim()
    if (!normalized) {
      setStatus('No folder selected.')
      return
    }
    setProjectFolder(normalized)
    writeProjectFolder(normalized)
    setStatus('Folder selected. Apply it to your agent workspaces when ready.')
  }

  const pickFolder = async () => {
    if (isPicking || isApplying) return
    setIsPicking(true)
    setStatus('Opening folder picker…')
    try {
      const nativePicker = window.automniaDesktop?.pickDirectory
      if (nativePicker) {
        try {
          const picked = await nativePicker({ startPath: projectFolder })
          if (picked.path?.trim()) {
            setPickedFolder(picked.path)
            return
          }
          if (picked.cancelled) {
            setStatus(picked.detail || 'No folder selected.')
            return
          }
          if (picked.error || picked.detail) throw new Error(picked.error || picked.detail)
        } catch {
          // Try the server-backed picker used by the Agent Workspace editor.
        }
      }

      const started = await apiRequest<FolderPickerSessionPayload>('/api/party/folder-picker/start', {
        method: 'POST',
        timeoutMs: 30_000,
        body: { startPath: projectFolder },
      })
      if (!started.ok) {
        setStatus(apiErrorMessage(started.error))
        return
      }
      const session = started.data
      if (session.path?.trim()) {
        setPickedFolder(session.path)
        return
      }
      if (session.cancelled || session.status === 'cancelled') {
        setStatus(session.detail || 'No folder selected.')
        return
      }
      if (!session.sessionId) {
        setStatus(session.detail || 'Folder picker could not start.')
        return
      }

      setStatus('Choose a folder in the folder picker.')
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 750))
        const result = await apiRequest<FolderPickerSessionPayload>(
          `/api/party/folder-picker/${encodeURIComponent(session.sessionId)}`,
          { timeoutMs: 10_000 },
        )
        if (!result.ok) {
          setStatus(apiErrorMessage(result.error))
          return
        }
        const picked = result.data
        if (picked.status === 'pending') continue
        if (picked.status === 'selected' && picked.path?.trim()) {
          setPickedFolder(picked.path)
          return
        }
        if (picked.status === 'cancelled' || picked.cancelled) {
          setStatus(picked.detail || 'No folder selected.')
          return
        }
        setStatus(picked.detail || 'Folder picker failed.')
        return
      }
      setStatus('Folder picker timed out. Click Browse to try again.')
    } catch (error) {
      setStatus(`Folder picker failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsPicking(false)
    }
  }

  const applyWorkspace = async () => {
    if (!projectFolder.trim() || !applyIds.length || isApplying) return
    setIsApplying(true)
    setStatus(`Applying folder to ${applyIds.length} agent${applyIds.length === 1 ? '' : 's'}…`)
    const failures: string[] = []
    let applied = 0
    try {
      // The workspace endpoint updates OpenClaw's canonical config and derives
      // the agent's runtime/memory paths. Keep these writes ordered so two
      // agents never race while rewriting the shared config file.
      for (const agentId of applyIds) {
        const result = await apiRequest<WorkspaceSavePayload>('/api/party/workspace', {
          method: 'POST',
          timeoutMs: 90_000,
          body: { agentId, workspace: projectFolder.trim() },
        })
        if (!result.ok) {
          failures.push(`${agentId}: ${apiErrorMessage(result.error)}`)
          continue
        }
        if (!result.data.ok) {
          failures.push(`${agentId}: ${result.data.error || result.data.detail || 'workspace update failed'}`)
          continue
        }
        const finalPath = result.data.workspace || projectFolder.trim()
        updateAgentMeta(agentId, { workspace: finalPath })
        applied += 1
      }
      if (failures.length) {
        setStatus(`${applied} updated. ${failures.length} workspace${failures.length === 1 ? '' : 's'} need attention.`)
      } else {
        setStatus(`All ${applied} selected agent${applied === 1 ? '' : 's'} now use this project folder.`)
      }
    } catch (error) {
      setStatus(`Workspace update failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <section ref={controlRef} className={`dui-project-folder-control ${compact ? 'is-compact' : ''} ${className}`.trim()} aria-label="Project folder">
      {compact && (
        <button
          type="button"
          ref={triggerRef}
          className="dui-project-folder-control__compact-trigger"
          aria-expanded={isExpanded}
          onClick={toggleCompactPanel}
          title={projectFolder ? `Project folder: ${projectFolder}` : 'Choose a project folder'}
        >
          <span>Project</span>
        </button>
      )}
      {(!compact || isExpanded) && (compact ? createPortal(
        <div
          ref={panelRef}
          className="dui-project-folder-control__panel is-floating"
          style={{ position: 'fixed', top: popoverPosition.top, left: popoverPosition.left, zIndex: 10000 }}
        >
        <div className="dui-project-folder-control__head">
          <div>
            <span className="dui-project-folder-control__eyebrow">Project folder</span>
            <strong>{projectFolder ? 'Shared workspace ready' : 'Choose a project workspace'}</strong>
          </div>
          <span className="dui-project-folder-control__agent-count">{allAgentIds.length} agents</span>
        </div>
        <div className="dui-project-folder-control__path-row">
          <span className="dui-project-folder-control__path" title={projectFolder || undefined}>
            {projectFolder || 'No project folder selected'}
          </span>
          <button type="button" className="dui-project-folder-control__browse" onClick={() => void pickFolder()} disabled={isPicking || isApplying}>
            {isPicking ? 'Opening…' : 'Browse'}
          </button>
        </div>
        <div className="dui-project-folder-control__scope" role="group" aria-label="Agents that receive this project folder">
          <button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')} aria-pressed={scope === 'all'}>
            All agents <span>{allAgentIds.length}</span>
          </button>
          <button type="button" className={scope === 'targets' ? 'is-active' : ''} onClick={() => setScope('targets')} disabled={!targetIds.length} aria-pressed={scope === 'targets'}>
            {targetScopeLabel} <span>{targetIds.length}</span>
          </button>
        </div>
        <button type="button" className="dui-project-folder-control__apply" onClick={() => void applyWorkspace()} disabled={!projectFolder || !applyIds.length || isApplying}>
          {isApplying ? 'Syncing workspaces…' : applyLabel}
        </button>
        <p className="dui-project-folder-control__status" role="status" aria-live="polite">
          {status || (projectFolder ? 'Agents will use this folder for code, files, and runtime memory.' : 'Pick a folder, then sync the agents that should use it.')}
        </p>
        </div>,
        document.body,
      ) : (
        <div className="dui-project-folder-control__panel">
          <div className="dui-project-folder-control__head">
            <div><span className="dui-project-folder-control__eyebrow">Project folder</span><strong>{projectFolder ? 'Shared workspace ready' : 'Choose a project workspace'}</strong></div>
            <span className="dui-project-folder-control__agent-count">{allAgentIds.length} agents</span>
          </div>
          <div className="dui-project-folder-control__path-row">
            <span className="dui-project-folder-control__path" title={projectFolder || undefined}>{projectFolder || 'No project folder selected'}</span>
            <button type="button" className="dui-project-folder-control__browse" onClick={() => void pickFolder()} disabled={isPicking || isApplying}>{isPicking ? 'Opening.' : 'Browse'}</button>
          </div>
          <div className="dui-project-folder-control__scope" role="group" aria-label="Agents that receive this project folder">
            <button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')} aria-pressed={scope === 'all'}>All agents <span>{allAgentIds.length}</span></button>
            <button type="button" className={scope === 'targets' ? 'is-active' : ''} onClick={() => setScope('targets')} disabled={!targetIds.length} aria-pressed={scope === 'targets'}>{targetScopeLabel} <span>{targetIds.length}</span></button>
          </div>
          <button type="button" className="dui-project-folder-control__apply" onClick={() => void applyWorkspace()} disabled={!projectFolder || !applyIds.length || isApplying}>{isApplying ? 'Syncing workspaces.' : applyLabel}</button>
          <p className="dui-project-folder-control__status" role="status" aria-live="polite">{status || (projectFolder ? 'Agents will use this folder for code, files, and runtime memory.' : 'Pick a folder, then sync the agents that should use it.')}</p>
        </div>
      ))}
    </section>
  )
}
