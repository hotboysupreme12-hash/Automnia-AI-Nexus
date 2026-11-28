import '../../styles/automnia-theme/162-agent-response-activity.css'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentActivityEvent } from '../../types/nexus'
import { buildWorkParts, statusUpdatesForWork, workDuration, type WorkGroup } from './agentWorkTimeline'
import { StreamedResponseMarkdown } from './ResponseMarkdown'

function pretty(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

function groupLabel(kind: WorkGroup['kind']) {
  if (kind === 'commands') return 'Commands'
  if (kind === 'files') return 'Files'
  if (kind === 'browser') return 'Browser'
  if (kind === 'approvals') return 'Approvals'
  return 'Tools'
}

function statusLabel(kind: WorkGroup['kind'], failed: boolean, finished: boolean, streaming: boolean) {
  if (failed) return 'Failed'
  if (finished) return 'Done'
  if (kind === 'approvals') return streaming ? 'Pending' : 'Unresolved'
  return streaming ? 'Running' : 'Stopped'
}

function commandPreview(command: string) {
  const clean = command.replace(/\s+/g, ' ').trim()
  return clean.length > 92 ? `${clean.slice(0, 91).trimEnd()}…` : clean
}

function workClock(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function WorkIcon({ kind }: { kind: WorkGroup['kind'] }) {
  if (kind === 'commands') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2.5"/><path d="m6 7 2.5 2.5L6 12m4 1h3"/></svg>
  if (kind === 'files') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 3h8l4 4v10H4zM12 3v4h4"/></svg>
  if (kind === 'browser') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M2.5 7.5h15"/></svg>
  if (kind === 'approvals') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 16 5v4.2c0 3.7-2.4 6.5-6 8.3-3.6-1.8-6-4.6-6-8.3V5z"/><path d="m7 9.8 2 2 4-4"/></svg>
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 6v4l2.5 2"/></svg>
}

export const AgentResponseActivityTimeline = memo(function AgentResponseActivityTimeline({ events, streaming, durationMs, progressLines, currentStatus }: {
  events: AgentActivityEvent[]
  streaming: boolean
  durationMs: number
  progressLines: string[]
  currentStatus: string
}) {
  const parts = useMemo(() => buildWorkParts(events), [events])
  const duration = workDuration(durationMs)
  const progress = useMemo(() => statusUpdatesForWork(events, progressLines), [events, progressLines])
  const statusHistory = useMemo(() => {
    const latest = currentStatus.trim()
    const fallback = !progress.length && latest && latest !== 'The agent is working on your request.'
      && statusUpdatesForWork(events, [latest]).includes(latest) ? [latest] : []
    return [...new Set([...progress, ...fallback])].slice(-12)
  }, [currentStatus, events, progress])
  const queuedStatuses = useRef<string[]>([])
  const seenStatuses = useRef(new Set<string>())
  const hasSeededStatusQueue = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [typedStatus, setTypedStatus] = useState('')

  const pumpStatusQueue = useCallback(() => {
    const schedule = (callback: () => void, delay: number) => {
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        callback()
      }, delay)
    }
    const typeNextStatus = () => {
      if (!streaming || timer.current !== undefined) return
      const next = queuedStatuses.current.shift()
      if (!next) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTypedStatus(next)
        schedule(typeNextStatus, 700)
        return
      }

      let visibleCharacters = 0
      setTypedStatus('')
      const revealNextCharacter = () => {
        if (!streaming) return
        visibleCharacters += 1
        setTypedStatus(next.slice(0, visibleCharacters))
        if (visibleCharacters < next.length) schedule(revealNextCharacter, 30)
        else schedule(typeNextStatus, 700)
      }
      schedule(revealNextCharacter, 250)
    }
    typeNextStatus()
  }, [streaming])

  useEffect(() => {
    const unseen = statusHistory.filter((status) => !seenStatuses.current.has(status))
    for (const status of unseen) seenStatuses.current.add(status)
    const startingStatuses = hasSeededStatusQueue.current ? unseen : unseen.slice(-3)
    hasSeededStatusQueue.current = true
    queuedStatuses.current.push(...startingStatuses)
    if (queuedStatuses.current.length > 8) queuedStatuses.current.splice(0, queuedStatuses.current.length - 8)
    while (seenStatuses.current.size > 32) {
      const oldest = seenStatuses.current.values().next().value
      if (oldest === undefined) break
      seenStatuses.current.delete(oldest)
    }
    pumpStatusQueue()
  }, [pumpStatusQueue, statusHistory])

  useEffect(() => {
    if (!streaming) {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      timer.current = undefined
      queuedStatuses.current = []
      return
    }
    pumpStatusQueue()
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [pumpStatusQueue, streaming])

  const visibleStatus = streaming ? typedStatus || 'Starting the request.' : currentStatus.trim() || 'Preparing the request.'
  if (!parts.length && !progress.length && !streaming) return duration ? <div className="dy-work-timeline dy-work-timeline__heading">Worked for {duration}</div> : null
  return (
    <details className="dy-work-timeline">
      <summary className="dy-work-timeline__heading">
        <span className="dy-work-timeline__agent">Agent</span>
        <span className="dy-work-timeline__current" title={visibleStatus} aria-hidden="true">
          <span className="dy-work-timeline__current-text" aria-hidden="true">{streaming ? visibleStatus : duration ? `Worked for ${duration}` : visibleStatus}</span>
          {streaming && <i className="dy-work-timeline__caret" aria-hidden="true" />}
        </span>
        {streaming && <span className="dy-work-timeline__announcement" role="status" aria-live="polite" aria-atomic="true">{currentStatus}</span>}
        <span className="dy-work-timeline__chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="dy-work-timeline__body">
        {parts.map((part) => part.kind === 'commentary' ? (
          <div className="dy-work-timeline__commentary" key={part.id}><StreamedResponseMarkdown text={part.text} animate={false} streaming={false} /></div>
        ) : (
          <section className="dy-work-group" key={part.id} data-kind={part.group.kind}>
            <h3 className="dy-work-group__heading"><WorkIcon kind={part.group.kind} /><span>{groupLabel(part.group.kind)}</span><span className="dy-work-group__count">{part.group.items.length} {part.group.items.length === 1 ? 'call' : 'calls'}</span></h3>
            <ol className="dy-work-group__list">
              {part.group.items.map((item) => (
                <li key={item.id}>
                  <details className="dy-work-step" data-status={item.failed ? 'failed' : item.finished ? 'done' : part.group.kind === 'approvals' ? 'pending' : streaming ? 'running' : 'stopped'}>
                    <summary>
                      <WorkIcon kind={part.group.kind} />
                      <span className="dy-work-step__identity">
                        <span className="dy-work-step__label" title={item.label}>{item.label || 'Tool activity'}</span>
                        {item.command && <code className="dy-work-step__command" title={item.command}>{commandPreview(item.command)}</code>}
                      </span>
                      <em className="dy-work-step__status">{statusLabel(part.group.kind, item.failed, item.finished, streaming)}</em>
                      {workClock(item.timestamp) && <time className="dy-work-step__time" dateTime={item.timestamp} title={item.timestamp}>{workClock(item.timestamp)}</time>}
                      <span className="dy-work-timeline__chevron" aria-hidden="true">⌄</span>
                    </summary>
                    <div className="dy-work-step__content">
                      {item.description && <p className="dy-work-step__description">{item.description}</p>}
                      {item.command && <section><h4>Command</h4><pre tabIndex={0}><code>{item.command}</code></pre></section>}
                      {item.input && <section><h4>Input</h4><pre tabIndex={0}><code>{pretty(item.input)}</code></pre></section>}
                      {item.output && <section><h4>Output</h4><pre tabIndex={0}><code>{pretty(item.output)}</code></pre></section>}
                      {!item.command && !item.input && !item.output && <p>No additional details were returned for this step.</p>}
                      {item.truncated && <p>Some details were shortened by the runtime.</p>}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {progress.length > 0 && (
          <section className="dy-work-group dy-work-progress" aria-label="Progress updates">
            <h3 className="dy-work-progress__heading"><WorkIcon kind="tools" /><span>Progress updates</span></h3>
            <ol className="dy-work-progress__list">{progress.map((line, index) => <li key={`${index}:${line}`} style={{ animationDelay: `${Math.min(index, 12) * 140}ms` }}>{line}</li>)}</ol>
          </section>
        )}
        {!parts.length && !progress.length && <p className="dy-work-timeline__empty">Waiting for activity.</p>}
      </div>
    </details>
  )
})
