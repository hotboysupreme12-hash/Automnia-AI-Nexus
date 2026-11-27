import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentActivityEvent } from '../../types/nexus'

type DiffLine = { kind: 'add' | 'remove' | 'context' | 'meta'; text: string }
type FileEdit = { path: string; action: 'added' | 'removed' | 'modified' | 'changed'; diff: DiffLine[] }
type PopupPosition = { left: number; top: number; placement: 'above' | 'below'; width: number }

const PATH_KEYS = ['path', 'filePath', 'filepath', 'file_path', 'filename', 'file', 'target', 'targetPath', 'relativePath']
const PATCH_KEYS = ['patch', 'diff', 'unifiedDiff', 'unified_diff']
const OLD_TEXT_KEYS = ['oldText', 'old_text', 'oldString', 'old_string', 'before']
const NEW_TEXT_KEYS = ['newText', 'new_text', 'newString', 'new_string', 'after']

function recordFrom(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function stringAt(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function cleanPath(value: string): string {
  const path = value.trim().replace(/^['"`]|['"`,;]+$/g, '').replace(/\\/g, '/')
  if (!path || path.length > 240 || /[\r\n]/.test(path)) return ''
  return path
}

function isFilePath(path: string): boolean {
  return path.includes('/')
    || /\.[A-Za-z0-9]{1,12}$/.test(path)
    || ['dockerfile', 'makefile', 'readme', 'license', 'gemfile', 'procfile', 'justfile'].includes(path.toLowerCase())
}

function pathFromLabel(label: string): string {
  const candidates = label.match(/(?:[A-Za-z]:[\\/])?[A-Za-z0-9_.@-]+(?:[\\/][A-Za-z0-9_.@-]+)+(?:\.[A-Za-z0-9]{1,12})?|\b[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,12}\b/g) || []
  return candidates.map(cleanPath).find((value) => value && /\.[A-Za-z0-9]{1,12}$/.test(value)) || ''
}

function diffFromPair(before: string, after: string): DiffLine[] {
  const oldLines = before ? before.replace(/\r/g, '').split('\n').slice(0, 100) : []
  const newLines = after ? after.replace(/\r/g, '').split('\n').slice(0, 100) : []
  const width = newLines.length + 1
  const table = new Uint16Array((oldLines.length + 1) * width)
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const cell = oldIndex * width + newIndex
      table[cell] = oldLines[oldIndex] === newLines[newIndex]
        ? table[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex], table[cell + 1])
    }
  }
  const diff: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      diff.push({ kind: 'context', text: `  ${oldLines[oldIndex]}` })
      oldIndex += 1
      newIndex += 1
    } else if (oldIndex < oldLines.length && (newIndex >= newLines.length || table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1])) {
      diff.push({ kind: 'remove', text: `- ${oldLines[oldIndex++]}` })
    } else {
      diff.push({ kind: 'add', text: `+ ${newLines[newIndex++]}` })
    }
    if (diff.length >= 52) {
      diff.push({ kind: 'meta', text: '  … diff preview shortened' })
      break
    }
  }
  return diff.filter((line) => line.kind !== 'context' || diff.some((entry) => entry.kind === 'add' || entry.kind === 'remove'))
}

function diffFromPatch(value: string): DiffLine[] {
  const sourceLines = value.replace(/\r/g, '').split('\n')
  if (!sourceLines.some((line) => line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('@@'))) return []
  const diff = sourceLines
    .filter((line) => line.startsWith('@@') || line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .slice(0, 52)
    .map((text): DiffLine => ({
      kind: text.startsWith('+') ? 'add' : text.startsWith('-') ? 'remove' : text.startsWith('@@') ? 'meta' : 'context',
      text,
    }))
  return diff.some((line) => line.kind === 'add' || line.kind === 'remove') ? diff : []
}

function editsFromPatch(patch: string, fallbackPath: string, action: FileEdit['action']): FileEdit[] {
  const chunks = patch.split(/(?=^diff --git )/m)
  const sections = chunks.length > 1 ? chunks : patch.split(/(?=^--- a\/)/m)
  const edits = sections.flatMap((section): FileEdit[] => {
    const pathMatch = section.match(/^\+\+\+\s+b\/(.+)$/m) || section.match(/^---\s+a\/(.+)$/m)
    const path = cleanPath(pathMatch?.[1] || fallbackPath)
    const diff = diffFromPatch(section)
    return path && diff.length ? [{ path, action, diff }] : []
  })
  return edits.length ? edits : fallbackPath ? [{ path: fallbackPath, action, diff: diffFromPatch(patch) }] : []
}

function eventFileEdits(event: AgentActivityEvent): FileEdit[] {
  const type = event.type.toLowerCase()
  const payload = event.payload || {}
  const input = recordFrom(payload.toolInput)
  const output = recordFrom(payload.toolOutput || payload.commandOutput)
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const command = typeof payload.command === 'string' ? payload.command : ''
  const actionText = [type, toolName, String(payload.toolAction || ''), event.label, command].join(' ').toLowerCase()
  const writeCommand = /(?:git\s+apply|apply_patch|patch\s+-|(?:set-content|out-file|tee)\b|(?:cat|echo|printf)\b.{0,120}(?:>{1,2})|(?:touch|rm|mv|cp)\s|(?:writefile|write_file|edit_file|patch_file))/i.test(command)
  const hasMutationSignal = /(?:write|edit|patch|apply[_ .-]?patch|create|delete|remove|rename|move|save)/i.test(actionText)
  const isFileWrite = type === 'file.writing' || type === 'file.patching'
    || (/^file\.(?:finished|updated|created|deleted|removed)$/.test(type) && hasMutationSignal)
    || (/^tool\./.test(type) && hasMutationSignal)
    || (/^command\./.test(type) && (hasMutationSignal || writeCommand))
  if (!isFileWrite) return []

  let path = cleanPath(stringAt(input, PATH_KEYS) || stringAt(output, PATH_KEYS))
  const patch = stringAt(input, PATCH_KEYS) || stringAt(output, PATCH_KEYS) || (/(?:diff --git|^\+\+\+ |^--- |^@@ )/m.test(command) ? command : '')
  if (!path) path = pathFromLabel(event.label) || pathFromLabel(command)
  const action: FileEdit['action'] = /\b(?:delete|remove|deleted|removed)\b/.test(actionText)
    ? 'removed'
    : /\b(?:create|created|new file|added)\b/.test(actionText)
      ? 'added'
      : /\b(?:write|writing|edit|editing|patch|patching|modified|updated|saved)\b/.test(actionText)
        ? 'modified'
        : 'changed'
  if (patch) {
    const patchedFiles = editsFromPatch(patch, path, action)
    if (patchedFiles.length) return patchedFiles.filter((file) => isFilePath(file.path))
  }
  if (!path || !isFilePath(path)) return []
  const oldText = stringAt(input, OLD_TEXT_KEYS) || stringAt(output, OLD_TEXT_KEYS)
  const newText = stringAt(input, NEW_TEXT_KEYS) || stringAt(output, NEW_TEXT_KEYS)
  const diff = oldText || newText ? diffFromPair(oldText, newText) : []
  return [{ path, action, diff }]
}

function collectFileEdits(events: AgentActivityEvent[]): FileEdit[] {
  const files = new Map<string, FileEdit>()
  for (const event of events) {
    for (const edit of eventFileEdits(event)) {
      const key = edit.path.toLowerCase()
      const previous = files.get(key)
      files.set(key, {
        ...edit,
        diff: edit.diff.length >= (previous?.diff.length || 0) ? edit.diff : previous?.diff || [],
      })
    }
  }
  return [...files.values()]
}

function scheduleClose(timer: { current: number | null }, setOpen: (open: boolean) => void) {
  if (timer.current !== null) window.clearTimeout(timer.current)
  timer.current = window.setTimeout(() => setOpen(false), 130)
}

export const AgentResponseCodeChanges = memo(function AgentResponseCodeChanges({ events }: { events: AgentActivityEvent[] }) {
  const files = useMemo(() => collectFileEdits(events), [events])
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const additions = files.reduce((count, file) => count + file.diff.filter((line) => line.kind === 'add').length, 0)
  const removals = files.reduce((count, file) => count + file.diff.filter((line) => line.kind === 'remove').length, 0)

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(460, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    const placement = rect.top > 360 ? 'above' : 'below'
    setPosition({ left, top: placement === 'above' ? rect.top : rect.bottom, placement, width })
  }, [])

  const openPreview = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    updatePosition()
    setOpen(true)
  }
  const closePreviewSoon = () => scheduleClose(closeTimer, setOpen)
  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && (buttonRef.current?.contains(next) || popoverRef.current?.contains(next))) return
    closePreviewSoon()
  }

  useEffect(() => {
    if (!open) return
    const positionFrame = window.requestAnimationFrame(updatePosition)
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.cancelAnimationFrame(positionFrame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [open, updatePosition])

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])
  if (!files.length) return null

  const label = files.length === 1 ? 'Edited 1 file' : `Edited ${files.length} files`
  const portal = open && position && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popoverRef}
      className="dy-code-changes-popover"
      role="dialog"
      aria-label="File changes preview"
      data-placement={position.placement}
      style={{ '--dy-code-popover-left': `${position.left}px`, '--dy-code-popover-top': `${position.top}px`, '--dy-code-popover-width': `${position.width}px` } as CSSProperties}
      onMouseEnter={() => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }}
      onMouseLeave={closePreviewSoon}
      onFocusCapture={() => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !popoverRef.current?.contains(next)) closePreviewSoon()
      }}
    >
      <header className="dy-code-changes-popover__header">
        <div><strong>{label}</strong><span>Change preview</span></div>
        <button type="button" aria-label="Close file changes preview" title="Close" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="dy-code-changes-popover__files">
        {files.map((file) => (
          <section key={file.path} className="dy-code-changes-file">
            <header>
              <code title={file.path}>{file.path}</code>
              <span data-change={file.action}>{file.action}</span>
            </header>
            {file.diff.length ? (
              <pre aria-label={`Diff preview for ${file.path}`}>
                {file.diff.map((line, index) => <span key={`${index}:${line.text}`} data-kind={line.kind}>{line.text || ' '}</span>)}
              </pre>
            ) : (
              <p className="dy-code-changes-file__empty">File activity was recorded, but this run did not include a line-by-line patch preview.</p>
            )}
          </section>
        ))}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div className="dy-code-changes">
      <button
        ref={buttonRef}
        type="button"
        className="dy-code-changes__card"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Hover to preview file changes"
        onMouseEnter={openPreview}
        onMouseLeave={closePreviewSoon}
        onFocus={openPreview}
        onBlur={handleBlur}
        onClick={openPreview}
      >
        <span className="dy-code-changes__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z" /><path d="M14 4v5h4M8 13h8M8 16h5" /></svg></span>
        <span className="dy-code-changes__title"><strong>{label}</strong><small>Workspace changes</small></span>
        {(additions > 0 || removals > 0) && <span className="dy-code-changes__counts"><b>+{additions}</b><i>−{removals}</i></span>}
        <span className="dy-code-changes__view">View changes <span aria-hidden="true">↗</span></span>
      </button>
      {portal}
    </div>
  )
})
