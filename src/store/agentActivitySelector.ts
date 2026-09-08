import type { AgentActivityEvent, AgentResponse } from '../types/nexus'

export type AgentCardActivityStatus = {
  label: string
  detail: string
  kind: 'working' | 'queued' | 'approval' | 'reply'
}

function latestVisibleActivity(response: AgentResponse): AgentActivityEvent | undefined {
  return [...(response.activity || [])].reverse().find((event) => {
    const type = event.type.toLowerCase()
    return !type.startsWith('message.final') && !type.startsWith('run.finished') && Boolean(event.label.trim())
  })
}

function cardActivityStatus(response: AgentResponse): AgentCardActivityStatus {
  const event = latestVisibleActivity(response)
  const type = event?.type.toLowerCase() || ''
  const detail = event?.type === 'message.partial' ? 'Writing a response.' : event?.label.trim() || response.progressLabel?.trim() || 'Working on the current request.'

  if (response.transport === 'command-console-queue' || type.startsWith('run.queued')) {
    return { label: 'Queued', detail, kind: 'queued' }
  }
  if (type.startsWith('approval.')) return { label: 'Needs approval', detail, kind: 'approval' }
  if (type.startsWith('tool.')) return { label: 'Using tools', detail, kind: 'working' }
  if (type.startsWith('browser.')) return { label: 'Browsing', detail, kind: 'working' }
  if (type.startsWith('file.')) return { label: 'Editing files', detail, kind: 'working' }
  if (type.startsWith('command.')) return { label: 'Running command', detail, kind: 'working' }
  if (type === 'message.partial' || type.startsWith('agent.finalizing')) return { label: 'Replying', detail, kind: 'reply' }
  if (type === 'run.model_running' || type === 'agent.working') return { label: 'Thinking', detail, kind: 'working' }
  if (type.startsWith('run.') || type.startsWith('agent.')) return { label: 'Preparing', detail, kind: 'working' }
  return { label: 'Working', detail, kind: 'working' }
}

/** Keep roster subscriptions stable when only answer text changes. */
export function createAgentActivitySelector() {
  let previous = new Map<string, AgentCardActivityStatus>()
  return (state: { agentResponses: AgentResponse[] }) => {
    const next = new Map<string, AgentCardActivityStatus>()
    for (const response of state.agentResponses) {
      if (!response.streaming || next.has(response.agentId)) continue
      const value = cardActivityStatus(response)
      const existing = previous.get(response.agentId)
      next.set(response.agentId, existing && existing.label === value.label && existing.kind === value.kind && existing.detail === value.detail ? existing : value)
    }
    if (next.size === previous.size && [...next].every(([id, value]) => previous.get(id) === value)) return previous
    previous = next
    return next
  }
}
