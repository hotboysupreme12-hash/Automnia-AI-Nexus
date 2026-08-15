import { useMemo, useState } from 'react'
import { useRuntimeSummaryStatus } from '../../hooks/useRuntimeStatus'
import type { GatewayChannelActivity, GatewayLogEntry } from '../../hooks/useRuntimeStatus'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentResponse, OpenClawAgent } from '../../types/nexus'
import { agentPortraitSrc } from '../../utils/portrait'
import {
  CHANNEL_ACTIVITY_RETENTION_OPTIONS,
  saveChannelActivitySettings,
  useChannelActivitySettings,
} from './channelActivitySettings'

const AUTOMNIA_LOGO_SRC = '/brand/automnia-ai-nexus-logo-transparent-cropped.png'
const LOG_LIMIT = 72

type ActivityFilter = 'all' | 'agents' | 'automnia'
type ActivityTone = 'active' | 'success' | 'warning' | 'error' | 'neutral'

type UnifiedActivityItem = {
  id: string
  kind: 'agent' | 'gateway'
  timestamp: string
  title: string
  detail: string
  tone: ActivityTone
  agentId?: string
  source?: string
  meta?: string
  automniaOrigin?: boolean
}

function timestampMs(value: string | undefined) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clock(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function relativeTime(value: string) {
  const ageMs = Math.max(0, Date.now() - timestampMs(value))
  if (ageMs < 60_000) return 'just now'
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function compactText(value: string, max = 420) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

function agentTone(entry: AgentResponse): ActivityTone {
  if (entry.streaming) return 'active'
  return entry.ok ? 'success' : 'error'
}

function gatewayTone(entry: Pick<GatewayLogEntry, 'stream' | 'level' | 'message'>): ActivityTone {
  const level = `${entry.level || ''} ${entry.message}`.toLowerCase()
  if (entry.stream === 'stderr' || /\b(error|failed|failure|blocked|exception)\b/.test(level)) return 'error'
  if (/\b(warn|warning|retry|degraded|unavailable)\b/.test(level)) return 'warning'
  return 'neutral'
}

function directionLabel(direction?: GatewayChannelActivity['direction']) {
  if (direction === 'inbound') return 'Inbound'
  if (direction === 'outbound') return 'Outbound'
  return 'System'
}

function gatewayLogItem(entry: GatewayLogEntry): UnifiedActivityItem {
  const source = entry.channel ? `${entry.channel} · ${entry.stream}` : entry.stream
  return {
    id: `gateway-log-${entry.id}-${entry.timestamp}`,
    kind: 'gateway',
    timestamp: entry.timestamp,
    title: entry.stream === 'channel' ? 'Channel event' : 'Gateway event',
    detail: readableChannelMessage(entry.message),
    tone: gatewayTone(entry),
    source: 'Automnia',
    meta: source,
  }
}

function gatewayActivityItem(entry: GatewayChannelActivity): UnifiedActivityItem {
  return {
    id: `gateway-activity-${entry.id}-${entry.timestamp}`,
    kind: 'gateway',
    timestamp: entry.timestamp,
    title: `${directionLabel(entry.direction)} message`,
    detail: readableChannelMessage(entry.message),
    tone: gatewayTone({ stream: 'channel', level: entry.level, message: entry.message }),
    source: 'Automnia',
    meta: [entry.channel, entry.agentId].filter(Boolean).join(' · ') || 'Gateway channel',
    agentId: entry.agentId,
  }
}

function readableChannelMessage(value: string) {
  const readable = value
    .replace(/\b(?:channel|outcome|duration|sessionKey|scope|mode|model|token)=("[^"]*"|\S+)/giu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return compactText(readable || 'No message content was captured.')
}

function agentActivityItem(entry: AgentResponse): UnifiedActivityItem {
  const automniaOrigin = /gateway|openclaw|clawtalk/i.test(`${entry.transport || ''} ${entry.modelId || ''}`)
  const detail = compactText(entry.response || entry.progressLines?.at(-1) || entry.progressLabel || entry.prompt || 'No response captured.')
  return {
    id: `agent-${entry.id}`,
    kind: 'agent',
    timestamp: entry.timestamp,
    title: entry.streaming ? 'Agent running' : entry.ok ? 'Agent response' : 'Agent run blocked',
    detail,
    tone: agentTone(entry),
    agentId: entry.agentId,
    source: automniaOrigin ? 'Automnia' : entry.transport || entry.modelId || 'Agent runtime',
    meta: entry.durationMs > 0 ? `${(entry.durationMs / 1000).toFixed(1)}s runtime` : undefined,
    automniaOrigin,
  }
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A'
}

function toneLabel(tone: ActivityTone) {
  if (tone === 'active') return 'Live'
  if (tone === 'success') return 'Complete'
  if (tone === 'error') return 'Blocked'
  if (tone === 'warning') return 'Warning'
  return 'Event'
}

function dedupeGatewayItems(items: UnifiedActivityItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${timestampMs(item.timestamp)}|${item.detail.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function ActivityAvatar({ item, agent }: { item: UnifiedActivityItem; agent?: OpenClawAgent }) {
  if (item.kind === 'gateway') {
    return <img src={AUTOMNIA_LOGO_SRC} alt="" className="dui-activity-log__avatar-image" draggable={false} />
  }
  const portrait = agent ? agentPortraitSrc(agent.id, agent.portrait) : ''
  return portrait
    ? <img src={portrait} alt="" className="dui-activity-log__avatar-image" draggable={false} />
    : <span className="dui-activity-log__avatar-fallback">{initials(agent?.name || item.agentId || 'Agent')}</span>
}

export function SettingsActivityLog() {
  const responses = useNexusStore((state) => state.agentResponses)
  const agents = useNexusStore((state) => state.agents)
  const { status, error, refresh } = useRuntimeSummaryStatus(8000)
  const channelActivitySettings = useChannelActivitySettings()
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [query, setQuery] = useState('')

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const gatewayItems = useMemo(() => {
    const logs = (status?.gateway.logs || []).map(gatewayLogItem)
    const activity = (status?.gateway.activity.events || []).map(gatewayActivityItem)
    return dedupeGatewayItems([...logs, ...activity])
      .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
      .slice(0, LOG_LIMIT)
  }, [status?.gateway.activity.events, status?.gateway.logs])
  const agentItems = useMemo(
    () => responses.slice(0, LOG_LIMIT).map(agentActivityItem),
    [responses],
  )
  const items = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...agentItems, ...gatewayItems]
      .filter((item) => filter === 'all' || (filter === 'agents' ? item.kind === 'agent' : item.kind === 'gateway'))
      .filter((item) => !normalizedQuery || `${item.title} ${item.detail} ${item.source || ''} ${item.meta || ''}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
      .slice(0, LOG_LIMIT)
  }, [agentItems, filter, gatewayItems, query])

  const gatewayHealthy = status?.gateway.healthy
  const lastUpdated = status?.generatedAt ? `Updated ${clock(status.generatedAt)}` : error ? 'Gateway snapshot unavailable' : 'Connecting to runtime…'
  const filters: Array<{ id: ActivityFilter; label: string; count: number }> = [
    { id: 'all', label: 'All activity', count: agentItems.length + gatewayItems.length },
    { id: 'agents', label: 'Agent runs', count: agentItems.length },
    { id: 'automnia', label: 'Automnia events', count: gatewayItems.length },
  ]

  return (
    <div className="dui-settings-section" id="settings-section-logs" role="tabpanel">
      <div className="dui-activity-log__hero">
        <div className="dui-activity-log__hero-brand">
          <div className="dui-activity-log__hero-mark"><img src={AUTOMNIA_LOGO_SRC} alt="" draggable={false} /></div>
          <p>Gateway Announcement reports agent runs and Gateway events in one live operational feed.</p>
        </div>
        <div className="dui-activity-log__hero-copy">
          <span>Unified activity</span>
          <h3>Logs</h3>
        </div>
        <div className="dui-activity-log__hero-status" data-state={gatewayHealthy === false ? 'offline' : gatewayHealthy ? 'live' : 'pending'}>
          <i aria-hidden="true" />
          <strong>{gatewayHealthy === false ? 'Gateway offline' : gatewayHealthy ? 'Gateway live' : 'Syncing'}</strong>
          <small>{lastUpdated}</small>
        </div>
      </div>

      <section className="dui-channel-activity-preferences" aria-labelledby="channel-activity-preferences-title">
        <div className="dui-channel-activity-preferences__copy">
          <span>Channel memory</span>
          <strong id="channel-activity-preferences-title">Keep the feed useful</strong>
          <p>The monitor keeps a small rolling history so a refresh never wipes the story you were following.</p>
        </div>
        <div className="dui-channel-activity-preferences__controls">
          <label>
            <span><strong>Keep</strong><small>Newest events visible in Monitor</small></span>
            <select
              value={channelActivitySettings.retentionLimit}
              onChange={(event) => saveChannelActivitySettings({
                ...channelActivitySettings,
                retentionLimit: Number(event.target.value) as typeof channelActivitySettings.retentionLimit,
              })}
            >
              {CHANNEL_ACTIVITY_RETENTION_OPTIONS.map((option) => <option key={option} value={option}>Last {option} events</option>)}
            </select>
          </label>
          <label className="dui-channel-activity-preferences__toggle">
            <span><strong>Automatically trim older events</strong><small>Remove the oldest item when the limit is reached</small></span>
            <input
              type="checkbox"
              checked={channelActivitySettings.autoTrim}
              onChange={(event) => saveChannelActivitySettings({ ...channelActivitySettings, autoTrim: event.target.checked })}
            />
            <i aria-hidden="true" />
          </label>
        </div>
      </section>

      <div className="dui-activity-log__summary" aria-label="Log summary">
        <div><span>Agent runs</span><strong>{agentItems.length}</strong></div>
        <div><span>Automnia events</span><strong>{gatewayItems.length}</strong></div>
        <div><span>Visible now</span><strong>{items.length}</strong></div>
      </div>

      <section className="dui-activity-log__card" aria-label="Unified activity log">
        <div className="dui-activity-log__toolbar">
          <div className="dui-activity-log__filters" role="tablist" aria-label="Log source">
            {filters.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={filter === entry.id} onClick={() => setFilter(entry.id)}>
                {entry.label}<b>{entry.count}</b>
              </button>
            ))}
          </div>
          <div className="dui-activity-log__actions">
            <label className="dui-activity-log__search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter activity…" aria-label="Filter activity" />
            </label>
            <button type="button" className="dui-activity-log__refresh" onClick={refresh} title="Refresh gateway activity">Refresh</button>
          </div>
        </div>

        {error && <div className="dui-activity-log__notice" role="status">{error}. Agent runs remain available while the gateway reconnects.</div>}
        {!items.length ? (
          <div className="dui-activity-log__empty">
            <img src={AUTOMNIA_LOGO_SRC} alt="" draggable={false} />
            <strong>{query || filter !== 'all' ? 'No matching activity' : 'No activity yet'}</strong>
            <span>{query || filter !== 'all' ? 'Try another filter or search term.' : 'New agent responses and gateway events will appear here.'}</span>
          </div>
        ) : (
          <div className="dui-activity-log__list" role="log" aria-live="polite" aria-label="Agent and Automnia activity">
            {items.map((item) => {
              const agent = item.agentId ? agentById.get(item.agentId) : undefined
              const displayName = item.kind === 'gateway' ? 'Automnia' : agent?.name || item.agentId || 'Agent'
              return (
                <article key={item.id} className="dui-activity-log__row" data-kind={item.kind} data-tone={item.tone}>
                  <div className="dui-activity-log__rail" aria-hidden="true" />
                  <div className="dui-activity-log__avatar"><ActivityAvatar item={item} agent={agent} /></div>
                  <div className="dui-activity-log__body">
                    <div className="dui-activity-log__row-head">
                      <div className="dui-activity-log__identity">
                        <strong>{displayName}</strong>
                        <span>{item.title}</span>
                        {item.automniaOrigin && <span className="dui-activity-log__origin"><img src={AUTOMNIA_LOGO_SRC} alt="" draggable={false} />Automnia</span>}
                        <em data-tone={item.tone}>{toneLabel(item.tone)}</em>
                      </div>
                      <time dateTime={item.timestamp} title={new Date(item.timestamp).toLocaleString()}>{clock(item.timestamp)} · {relativeTime(item.timestamp)}</time>
                    </div>
                    <p title={item.detail}>{item.detail}</p>
                    <div className="dui-activity-log__meta">
                      {item.source && <span>{item.kind === 'gateway' ? 'Automnia' : item.source}</span>}
                      {item.meta && <span>{item.meta}</span>}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default SettingsActivityLog
