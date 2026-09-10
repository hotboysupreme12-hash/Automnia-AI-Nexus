import type { AgentResponse } from '../types/nexus'

const searchText = new WeakMap<AgentResponse, string>()
export function responseMatchesQuery(entry: AgentResponse, query: string, agentName: string) {
  if (agentName.toLocaleLowerCase().includes(query) || entry.agentId.toLocaleLowerCase().includes(query)) return true
  let text = searchText.get(entry)
  if (text === undefined) {
    text = `${entry.prompt}\n${entry.response}`.toLocaleLowerCase()
    searchText.set(entry, text)
  }
  return text.includes(query)
}

export function indexResponseActivity(responses: AgentResponse[]) {
  const queuedResponsesByAgent = new Map<string, number>()
  const activeResponseByAgent = new Map<string, AgentResponse>()
  let queuedResponseCount = 0
  for (const entry of responses) {
    if (!entry.streaming) continue
    if (entry.transport === 'command-console-queue') {
      queuedResponsesByAgent.set(entry.agentId, (queuedResponsesByAgent.get(entry.agentId) || 0) + 1)
      queuedResponseCount += 1
    } else if (!activeResponseByAgent.has(entry.agentId)) activeResponseByAgent.set(entry.agentId, entry)
  }
  return { queuedResponsesByAgent, activeResponseByAgent, queuedResponseCount }
}

/** Keep DOM work bounded even when a query matches the entire retained history. */
export function selectResponseHistory(
  responses: AgentResponse[],
  query: string,
  agentNameFor: (agentId: string) => string,
  limit: number,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return { entries: responses.slice(0, limit).reverse(), total: responses.length }
  const entries: AgentResponse[] = []
  let total = 0
  for (const entry of responses) {
    if (!responseMatchesQuery(entry, normalizedQuery, agentNameFor(entry.agentId))) continue
    total += 1
    if (entries.length < limit) entries.push(entry)
  }
  return { entries: entries.reverse(), total }
}
