import { useEffect, useMemo, useRef, useState } from 'react'
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

function directoryFromPickedFolderFile(file: File, filePath: string): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
  const firstFolder = relativePath.split(/[\\/]/).filter(Boolean)[0]
  const absolute = filePath.trim().replace(/[\\/]$/, '')
  if (!absolute || !firstFolder) return ''
  const normalizedAbsolute = absolute.replace(/\\/g, '/')
  const normalizedFolder = firstFolder.replace(/\\/g, '/')
  const normalizedRelative = relativePath.replace(/\\/g, '/')
  const relativeSuffix = `/${normalizedRelative}`
  if (normalizedRelative && normalizedAbsolute.toLowerCase().endsWith(relativeSuffix.toLowerCase())) {
    const prefix = normalizedAbsolute.slice(0, normalizedAbsolute.length - normalizedRelative.length).replace(/\/$/, '')
    return `${prefix}/${normalizedFolder}`
  }
  const suffix = `/${normalizedFolder}`
  if (normalizedAbsolute.toLowerCase().endsWith(suffix.toLowerCase())) {
    return normalizedAbsolute.slice(0, normalizedAbsolute.length - suffix.length) || normalizedAbsolute
  }
  const lastSeparator = Math.max(normalizedAbsolute.lastIndexOf('/'), normalizedAbsolute.lastIndexOf('\\'))
  return lastSeparator > 0 ? normalizedAbsolute.slice(0, lastSeparator) : normalizedAbsolute
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

export function ProjectFolderControl({ targetAgentIds = [], targetScopeLabel = 'Current lanes', className = '', compact = false }: ProjectFolderControlProps) {
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
  const directoryInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    if (!compact || !isExpanded) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) setIsExpanded(false)
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
    const rect = controlRef.current?.getBoundingClientRect()
    if (rect) {
      const panelWidth = Math.min(320, Math.max(0, window.innerWidth - 32))
      const panelHeight = Math.min(360, window.innerHeight * 0.7)
      const below = rect.bottom + 8 + panelHeight <= window.innerHeight - 8
      const top = below ? rect.bottom + 6 : Math.max(8, rect.top - panelHeight - 6)
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - panelWidth - 16))
      setPopoverPosition({ top, left })
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
      }

      if (window.automniaDesktop?.getPathForFile && directoryInputRef.current) {
        directoryInputRef.current.value = ''
        directoryInputRef.current.click()
        setStatus('Choose a folder to continue.')
        return
      }

      setStatus('Folder picking is not available here. Use the agent workspace editor to paste a directory path.')
    } catch (error) {
      setStatus(`Folder picker failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsPicking(false)
    }
  }

  const handleFolderInput = async (files: FileList | null) => {
    const selected = files?.[0]
    if (!selected || !window.automniaDesktop?.getPathForFile) {
      setStatus('No folder selected.')
      return
    }
    setIsPicking(true)
    try {
      const filePath = await Promise.resolve(window.automniaDesktop.getPathForFile(selected))
      const directory = directoryFromPickedFolderFile(selected, filePath)
      if (!directory) throw new Error('Could not read the selected folder path.')
      setPickedFolder(directory)
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
          className="dui-project-folder-control__compact-trigger"
          aria-expanded={isExpanded}
          onClick={toggleCompactPanel}
          title={projectFolder ? `Project folder: ${projectFolder}` : 'Choose a project folder'}
        >
          <span>Project</span>
        </button>
      )}
      {(!compact || isExpanded) && <div
        className="dui-project-folder-control__panel"
        style={compact ? { position: 'fixed', top: popoverPosition.top, left: popoverPosition.left, zIndex: 1000 } : undefined}
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
          <input
            ref={directoryInputRef}
            type="file"
            className="dui-project-folder-control__input"
            onChange={(event) => void handleFolderInput(event.currentTarget.files)}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
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
      </div>}
    </section>
  )
}
