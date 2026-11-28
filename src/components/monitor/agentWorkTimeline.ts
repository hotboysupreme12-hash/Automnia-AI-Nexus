import type { AgentActivityEvent } from '../../types/nexus'

export type WorkItem = { id: string; label: string; description: string; timestamp: string; command: string; input: string; output: string; failed: boolean; finished: boolean; truncated: boolean }
export type WorkGroup = { kind: 'commands' | 'files' | 'browser' | 'approvals' | 'tools'; items: WorkItem[] }
export type WorkPart = { kind: 'commentary'; id: string; text: string } | { kind: 'group'; id: string; group: WorkGroup }

const WORK_EVENT_PREFIXES = ['tool.', 'command.', 'file.', 'browser.']

function isWorkEvent(type: string) {
  return WORK_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))
}

function isStatusEvent(type: string) {
  return !type.startsWith('message.') && !isWorkEvent(type)
    && (type.startsWith('agent.') || type.startsWith('run.') || type.startsWith('approval.') || type.startsWith('gateway.'))
}

function isToolNarration(value: string) {
  return /\b(?:is using\s+|just finished using\b|working with\s+|is executing:\s*|is executing a command\b|just finished executing\b|just received command output\b|could not complete (?:the command\b|[\w.-]+\b))/i.test(value)
}

/** Keep the live narration focused on progress; tool calls remain in the work list below. */
export function statusUpdatesForWork(events: AgentActivityEvent[], progressLines: string[]): string[] {
  const workLabels = new Set(events.filter((event) => isWorkEvent(event.type.toLowerCase())).map((event) => event.label.trim()))
  const progress = progressLines.map((line) => line.trim()).filter((line) => line && !/\brun_status\b/i.test(line) && !workLabels.has(line) && !isToolNarration(line))
  const source = progress.length
    ? progress
    : events.filter((event) => isStatusEvent(event.type.toLowerCase())).map((event) => event.label.trim()).filter(Boolean)
  return [...new Set(source)].slice(-12)
}

export function latestWorkStatus(events: AgentActivityEvent[], progressLines: string[]): string {
  return statusUpdatesForWork(events, progressLines).at(-1) || 'The agent is working on your request.'
}

function value(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (typeof payload[key] === 'string' && (payload[key] as string).trim()) return (payload[key] as string).trim()
  return ''
}

/** Preserve event order and combine lifecycle frames only when they share a tool-call ID. */
export function buildWorkParts(events: AgentActivityEvent[]): WorkPart[] {
  const parts: WorkPart[] = []
  const byId = new Map<string, WorkItem>()
  for (const event of events) {
    const type = event.type.toLowerCase()
    if (type === 'message.block' || type === 'message.preview') {
      const text = event.label.trim()
      if (text) parts.push({ kind: 'commentary', id: event.id, text })
      continue
    }
    if (!/^(tool|command|file|browser|approval)\./.test(type)) continue
    const payload = event.payload || {}
    const name = value(payload, 'toolName', 'tool', 'name')
    const command = value(payload, 'command', 'cmd', 'commandLine', 'shellCommand')
    const kind: WorkGroup['kind'] = command || type.startsWith('command.') || /(^|[._-])(exec|shell|command)($|[._-])/i.test(name)
      ? 'commands' : type.startsWith('file.') || /^(read|write|edit|apply_patch)$/i.test(name) ? 'files' : type.startsWith('browser.') || /browser/i.test(name) ? 'browser' : type.startsWith('approval.') ? 'approvals' : 'tools'
    // parentId identifies the containing activity, not this tool invocation.
    // Using it as a fallback merges unrelated calls from the same parent.
    const toolId = value(payload, 'toolId', 'toolCallId')
    const existing = toolId ? byId.get(toolId) : undefined
    const failed = event.severity === 'error' || /\.(error|fail|failed|failure|blocked|denied)$/.test(type)
    const state = value(payload, 'state', 'status', 'phase').toLowerCase()
    const finished = failed || /\.(finished|complete|completed|done|succeeded|success|allowed)$/.test(type) || /^(done|complete|completed|finished|success|successful|succeeded|ok|result|end|allowed)$/.test(state)
    if (existing) {
      existing.description ||= event.label.trim()
      existing.timestamp ||= event.timestamp
      existing.command ||= command
      existing.input ||= value(payload, 'toolInput', 'args', 'arguments', 'input', 'params')
      existing.output = value(payload, 'toolOutput', 'commandOutput', 'output', 'result') || existing.output
      existing.failed ||= failed
      existing.finished ||= finished
      existing.truncated ||= payload.toolInputTruncated === true || payload.toolOutputTruncated === true || payload.commandOutputTruncated === true || payload.commandTruncated === true
      continue
    }
    const action = value(payload, 'toolAction', 'action', 'operation', 'verb')
    const item: WorkItem = {
      id: event.id, label: [name, action && action !== name ? action : ''].filter(Boolean).join(' · ') || event.label.trim(),
      description: event.label.trim(), timestamp: event.timestamp, command,
      input: value(payload, 'toolInput', 'args', 'arguments', 'input', 'params'),
      output: value(payload, 'toolOutput', 'commandOutput', 'output', 'result'), failed, finished,
      truncated: payload.toolInputTruncated === true || payload.toolOutputTruncated === true || payload.commandOutputTruncated === true || payload.commandTruncated === true,
    }
    if (toolId) byId.set(toolId, item)
    const previous = parts.at(-1)
    if (previous?.kind === 'group' && previous.group.kind === kind) previous.group.items.push(item)
    else parts.push({ kind: 'group', id: event.id, group: { kind, items: [item] } })
  }
  return parts
}


export function workDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m${remainder ? ` ${remainder}s` : ''}`
}
