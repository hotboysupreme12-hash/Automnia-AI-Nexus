import { memo, type CSSProperties } from 'react'
import type { AgentActivityEvent } from '../../types/nexus'

const VISIBLE_ACTIVITY_PREFIXES = ['run.', 'agent.', 'tool.', 'command.', 'browser.', 'file.', 'approval.', 'message.']
const IGNORED_ACTIVITY_TYPES = new Set([
  'message.partial',
  'message.final',
  'run.accepted',
  'run.context_building',
  'run.prompt_assembled',
  'run.finished',
])

function payloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function prettyActivityValue(value: string): string {
  const clean = value.trim()
  if (!clean) return ''
  try {
    return JSON.stringify(JSON.parse(clean), null, 2)
  } catch {
    return value
  }
}

function compactPreview(value: string, limit = 112): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1).trim()}…` : clean
}

function activityKind(type: string, toolName: string, command: string): string {
  if (command || type.startsWith('command.')) return 'Command'
  if (type.startsWith('tool.')) return toolName ? `Tool · ${toolName}` : 'Tool'
  if (type.startsWith('browser.')) return 'Browser'
  if (type.startsWith('file.')) return 'File'
  if (type.startsWith('approval.')) return 'Approval'
  if (type.startsWith('run.') || type.startsWith('agent.')) return 'Agent'
  if (type.startsWith('message.')) return 'Response'
  return 'Activity'
}

function activityStatus(event: AgentActivityEvent, streaming: boolean, latest: boolean): string {
  const type = event.type.toLowerCase()
  const payload = event.payload || {}
  const state = payloadString(payload, 'state', 'status', 'phase').toLowerCase()
  if (event.severity === 'error' || /(?:failed|error|blocked|denied)$/.test(type) || /failed|error|blocked|denied/.test(state)) return 'Failed'
  if (/(?:finished|complete|final|allowed)$/.test(type) || /finished|complete|success|allowed|\bok\b/.test(state)) return 'Done'
  if (streaming && latest) return 'In progress'
  if (/(?:started|opening|navigating|reading|clicking|typing|downloading)$/.test(type) || /started|running|pending|call/.test(state)) return 'Started'
  return 'Updated'
}

function messageClock(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function ActivityValue({ label, value, tone }: { label: string; value: string; tone?: 'command' | 'output' }) {
  if (!value) return null
  return (
    <section className="dy-response-activity__value" data-tone={tone || 'input'}>
      <h4>{label}</h4>
      <pre tabIndex={0}><code>{prettyActivityValue(value)}</code></pre>
    </section>
  )
}

export const AgentResponseActivityTimeline = memo(function AgentResponseActivityTimeline({
  events,
  streaming,
}: {
  events: AgentActivityEvent[]
  streaming: boolean
}) {
  const visibleEvents = events.filter((event) => {
    const type = event.type.toLowerCase()
    return !IGNORED_ACTIVITY_TYPES.has(type)
      && Boolean(event.label.trim())
      && VISIBLE_ACTIVITY_PREFIXES.some((prefix) => type.startsWith(prefix))
  })
  const latestEvent = visibleEvents[visibleEvents.length - 1]
  if (!latestEvent) return null
  const latestPayload = latestEvent.payload || {}
  const latestToolName = payloadString(latestPayload, 'toolName', 'tool', 'name')
  const latestToolAction = payloadString(latestPayload, 'toolAction', 'action', 'operation')
  const latestCommand = payloadString(latestPayload, 'command', 'cmd', 'commandLine', 'shellCommand')
  const latestPreview = compactPreview(latestCommand || (latestToolName && latestToolAction ? `${latestToolName} · ${latestToolAction}` : latestToolName) || latestEvent.label)
  const presentedEvent = latestEvent
  const presentedPayload = presentedEvent.payload || {}
  const presentedToolName = payloadString(presentedPayload, 'toolName', 'tool', 'name')
  const presentedToolAction = payloadString(presentedPayload, 'toolAction', 'action', 'operation')
  const presentedCommand = payloadString(presentedPayload, 'command', 'cmd', 'commandLine', 'shellCommand')
  const presentedPreview = compactPreview(presentedCommand || (presentedToolName && presentedToolAction ? `${presentedToolName} · ${presentedToolAction}` : presentedToolName) || presentedEvent.label)
  const presentedTypingSteps = Math.min(48, Math.max(8, presentedPreview.length))

  return (
    <details
      className="dy-response-activity"
      data-streaming={streaming ? 'true' : 'false'}
      aria-label={`${visibleEvents.length} agent activity steps`}
    >
      <summary className="dy-response-activity__header" aria-label={`Activity, ${visibleEvents.length} ${visibleEvents.length === 1 ? 'step' : 'steps'}. ${streaming ? `Working on ${presentedPreview || latestPreview}.` : `Latest: ${presentedPreview || latestPreview}.`} Toggle the full activity history.`}>
        <span className="dy-response-activity__toggle" aria-hidden="true">⌄</span>
        <span className="dy-response-activity__title">Activity</span>
        <span className="dy-response-activity__count">{visibleEvents.length} {visibleEvents.length === 1 ? 'step' : 'steps'}</span>
        <span
          key={`${presentedEvent.id}:${presentedPreview}`}
          className="dy-response-activity__current"
          data-streaming={streaming ? 'true' : 'false'}
          data-reveal="false"
          title={presentedPreview || latestPreview}
          style={{ '--dy-activity-typing-steps': presentedTypingSteps } as CSSProperties}
          aria-live={streaming ? 'polite' : 'off'}
        >
          {presentedPreview}
        </span>
        {streaming && <span className="dy-response-activity__live"><i aria-hidden="true" /> Working</span>}
      </summary>
      <ol className="dy-response-activity__list" role="log" aria-live={streaming ? 'polite' : 'off'} aria-relevant="additions text">
        {visibleEvents.map((event, index) => {
          const payload = event.payload || {}
          const toolName = payloadString(payload, 'toolName', 'tool', 'name')
          const toolAction = payloadString(payload, 'toolAction', 'action', 'operation')
          const command = payloadString(payload, 'command', 'cmd', 'commandLine', 'shellCommand')
          const input = payloadString(payload, 'toolInput', 'args', 'arguments', 'input', 'params')
          const output = payloadString(payload, 'toolOutput', 'commandOutput', 'output', 'result')
          const preview = command || (toolName && toolAction ? `${toolName} · ${toolAction}` : toolName) || event.label
          const status = activityStatus(event, streaming, index === visibleEvents.length - 1)
          const timestamp = messageClock(event.timestamp)
          const inputTruncated = payload.toolInputTruncated === true
          const outputTruncated = payload.toolOutputTruncated === true || payload.commandOutputTruncated === true
          const commandTruncated = payload.commandTruncated === true
          const isLatest = index === visibleEvents.length - 1
          const typingSteps = Math.min(48, Math.max(8, compactPreview(preview || event.label).length))
          return (
            <li key={event.id} className="dy-response-activity__item" style={{ animationDelay: `${Math.min(index, 6) * 24}ms` } as CSSProperties}>
              <details
                className="dy-response-activity__step"
                data-status={status.toLowerCase()}
                data-activity-type={event.type}
                data-typing={streaming && isLatest ? 'true' : 'false'}
                style={{ '--dy-activity-typing-steps': typingSteps } as CSSProperties}
              >
                <summary aria-label={`${activityKind(event.type, toolName, command)}: ${event.label}. ${status}. Click to expand details.`}>
                  <span className="dy-response-activity__marker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="dy-response-activity__kind">{activityKind(event.type, toolName, command)}</span>
                  <span className="dy-response-activity__preview" title={preview}>{compactPreview(preview)}</span>
                  <span className="dy-response-activity__status">{status}</span>
                  {timestamp && <time dateTime={event.timestamp}>{timestamp}</time>}
                  <span className="dy-response-activity__chevron" aria-hidden="true">⌄</span>
                </summary>
                <div className="dy-response-activity__details">
                  <p className="dy-response-activity__label">{event.label}</p>
                  {command && <ActivityValue label="Command" value={command} tone="command" />}
                  {input && <ActivityValue label="Input" value={input} />}
                  {output && <ActivityValue label="Output" value={output} tone="output" />}
                  {inputTruncated && <p className="dy-response-activity__limit">Input shortened to keep the activity stream responsive.</p>}
                  {(outputTruncated || commandTruncated) && <p className="dy-response-activity__limit">Output shortened to keep the activity stream responsive.</p>}
                  {!command && !input && !output && <p className="dy-response-activity__empty">No additional tool details were returned for this step.</p>}
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </details>
  )
})
