import type { AgentActivityEvent, AgentResponse, MissionEvent, MissionReport, MissionReportEvidence, MissionRun } from '../types/nexus'

interface MissionReportInput {
  mission: MissionRun
  responses?: AgentResponse[]
  feed?: MissionEvent[]
  generatedAt?: string
}

const REPORT_METRICS = [
  'efficiencyRating',
  'soulDrift',
  'heartbeatStabilityScore',
  'runtimeEfficiency',
  'errors',
  'xpGained',
] as const

function reportId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `mission-report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function millis(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function average(values: number[]): number | null {
  if (!values.length) return null
  return Math.round(sum(values) / values.length)
}

function compactText(...values: Array<string | undefined | null>): string {
  return values.filter(Boolean).join('\n').toLowerCase()
}

function responseText(response: AgentResponse): string {
  return compactText(
    response.response,
    response.failureKind,
    response.progressLabel,
    ...(response.progressLines || []),
  )
}

function countActivity(response: AgentResponse, predicate: (event: AgentActivityEvent) => boolean): number {
  return (response.activity || []).filter(predicate).length
}

function countTextMatches(values: string[], pattern: RegExp): number {
  return values.reduce((count, value) => count + (pattern.test(value) ? 1 : 0), 0)
}

function missionWindowContains(response: AgentResponse, mission: MissionRun): boolean {
  const startedAt = millis(mission.startedAt)
  const endedAt = millis(mission.endedAt)
  const timestamp = millis(response.completedAt) ?? millis(response.timestamp) ?? millis(response.startedAt)
  if (startedAt === null || timestamp === null) return false
  const graceMs = 60_000
  return timestamp >= startedAt - graceMs && (endedAt === null || timestamp <= endedAt + graceMs)
}

function responseBelongsToMission(response: AgentResponse, mission: MissionRun): boolean {
  if (response.missionId) return response.missionId === mission.id
  return mission.selectedAgents.includes(response.agentId) && missionWindowContains(response, mission)
}

function terminalResponses(responses: AgentResponse[]): AgentResponse[] {
  return responses.filter((response) => response.streaming !== true || Boolean(response.completedAt))
}

function evidenceSource(responses: AgentResponse[], feed: MissionEvent[]): MissionReportEvidence['source'] {
  if (responses.length && feed.length) return 'mixed'
  if (responses.length) return 'runtime-responses'
  if (feed.length) return 'mission-feed'
  return 'none'
}

function hasSchedulerEvidence(mission: MissionRun, feed: MissionEvent[]): boolean {
  if (mission.scheduler) return true
  return feed.some((event) => /\b(cron|scheduler|heartbeat|round|job)\b/i.test(event.message))
}

function failureKindMatches(response: AgentResponse, pattern: RegExp): boolean {
  return pattern.test(response.failureKind || '') || pattern.test(response.response || '')
}

function buildUnavailableMetrics(report: Omit<MissionReport, 'id' | 'missionId' | 'generatedAt' | 'skillUnlocks' | 'evidence'>): string[] {
  return REPORT_METRICS.filter((metric) => report[metric] === null)
}

export function buildMissionReport(input: MissionReportInput): MissionReport {
  const missionResponses = (input.responses || []).filter((response) => responseBelongsToMission(response, input.mission))
  const missionFeed = (input.feed || []).filter((event) => event.missionId === input.mission.id)
  const finishedResponses = terminalResponses(missionResponses)
  const failedResponses = finishedResponses.filter((response) => !response.ok)
  const completedResponseCount = finishedResponses.filter((response) => response.ok).length
  const failedResponseCount = failedResponses.length

  const responseActivityCount = (predicate: (event: AgentActivityEvent) => boolean) =>
    missionResponses.reduce((count, response) => count + countActivity(response, predicate), 0)

  const responseTexts = missionResponses.map(responseText)
  const feedTexts = missionFeed.map((event) => compactText(event.message, event.failureKind, event.agentId, event.type))

  const acceptedRuns = Math.max(
    missionResponses.length,
    responseActivityCount((event) => event.type === 'run.accepted'),
    countTextMatches(feedTexts, /\b(accepted|assigned|queued)\b/i),
  )
  const startedRuns = Math.max(
    missionResponses.filter((response) => response.startedAt).length,
    responseActivityCount((event) => event.type === 'run.started' || event.type === 'agent.started'),
    countTextMatches(feedTexts, /\b(started|running|working|round)\b/i),
  )
  const completedRuns = Math.max(
    completedResponseCount,
    responseActivityCount((event) => event.type === 'run.finished' || event.type === 'message.final'),
    countTextMatches(feedTexts.filter((text) => /\bagent\b/.test(text) || /\breplied\b/.test(text)), /\b(completed|finished|replied|done)\b/i),
  )
  const failedRuns = Math.max(
    failedResponseCount,
    responseActivityCount((event) => event.type === 'run.failed'),
    countTextMatches(feedTexts, /\b(failed|blocked|error)\b/i),
  )
  const cancelledRuns = Math.max(
    failedResponses.filter((response) => failureKindMatches(response, /\b(cancelled|canceled|aborted)\b/i)).length,
    responseActivityCount((event) => event.type === 'run.cancelled'),
    countTextMatches(feedTexts, /\b(cancelled|canceled|aborted)\b/i),
  )
  const timedOutRuns = Math.max(
    failedResponses.filter((response) => failureKindMatches(response, /\b(timeout|timed out)\b/i)).length,
    countTextMatches(responseTexts, /\b(timeout|timed out)\b/i),
    countTextMatches(feedTexts, /\b(timeout|timed out)\b/i),
  )
  const retryCount =
    responseActivityCount((event) => event.type === 'run.retrying') +
    countTextMatches(responseTexts, /\bretry(?:ing| attempts?| attempts? used)?\b/i) +
    countTextMatches(feedTexts, /\bretry(?:ing| attempts?)?\b/i)
  const fallbackCount = countTextMatches(responseTexts, /\bfallback|fall back\b/i) + countTextMatches(feedTexts, /\bfallback|fall back\b/i)
  const verificationFailures =
    countTextMatches(responseTexts, /\b(verification|acceptance|test|build)\b.*\b(fail|failed|failure|error)\b/i) +
    countTextMatches(feedTexts, /\b(verification|acceptance|test|build)\b.*\b(fail|failed|failure|error)\b/i)
  const toolFailures =
    responseActivityCount((event) => event.type === 'tool.error' || event.type === 'tool.blocked') +
    countTextMatches(feedTexts, /\btool\b.*\b(fail|failed|error|blocked)\b/i)
  const commandFailures =
    responseActivityCount((event) => event.type === 'command.failed') +
    countTextMatches(responseTexts, /\b(command|npm|pnpm|yarn|node|tsx|tsc|vite)\b.*\b(fail|failed|error|exit code [1-9])\b/i) +
    countTextMatches(feedTexts, /\b(command|npm|pnpm|yarn|node|tsx|tsc|vite)\b.*\b(fail|failed|error|exit code [1-9])\b/i)
  const humanInterventions = responseActivityCount((event) => String(event.type).startsWith('approval.'))

  const queueDelayMs = average(
    missionResponses
      .map((response) => {
        const queued = millis(response.queuedAt)
        const started = millis(response.startedAt)
        return queued !== null && started !== null ? Math.max(0, started - queued) : null
      })
      .filter((value): value is number => value !== null),
  )
  const timeToFirstTokenMs = average(
    missionResponses
      .map((response) => {
        const firstToken = millis(response.firstTokenAt)
        const started = millis(response.startedAt) ?? millis(response.queuedAt)
        return firstToken !== null && started !== null ? Math.max(0, firstToken - started) : null
      })
      .filter((value): value is number => value !== null),
  )
  const totalExecutionDurationMs =
    finishedResponses.length
      ? sum(
          finishedResponses.map((response) => {
            const started = millis(response.startedAt)
            const completed = millis(response.completedAt)
            if (started !== null && completed !== null) return Math.max(0, completed - started)
            return Math.max(0, response.durationMs || 0)
          }),
        )
      : null
  const missionStarted = millis(input.mission.startedAt)
  const missionEnded = millis(input.mission.endedAt)
  const missionWallTimeMs = missionStarted !== null && missionEnded !== null ? Math.max(0, missionEnded - missionStarted) : null
  const tokenUsageValues = missionResponses
    .map((response) => response.tokenCountEstimate)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const tokenUsageEstimate = tokenUsageValues.length ? sum(tokenUsageValues) : null

  const agentParticipation = Array.from(
    new Set([
      ...missionResponses.map((response) => response.agentId),
      ...missionFeed.map((event) => event.agentId).filter((agentId): agentId is string => Boolean(agentId)),
    ]),
  ).filter((agentId) => input.mission.selectedAgents.includes(agentId))

  const terminalRunCount = completedRuns + failedRuns
  const hasTerminalEvidence = terminalRunCount > 0
  const failurePenalty = retryCount * 3 + fallbackCount * 4 + verificationFailures * 10 + commandFailures * 4 + toolFailures * 4
  const efficiencyRating = hasTerminalEvidence ? clampPercent((completedRuns / terminalRunCount) * 100 - failurePenalty) : null
  const runtimeEfficiency = hasTerminalEvidence ? clampPercent((completedRuns / terminalRunCount) * 100 - retryCount * 3 - commandFailures * 5 - toolFailures * 5) : null
  const schedulerEvidence = hasSchedulerEvidence(input.mission, missionFeed)
  const heartbeatStabilityScore = schedulerEvidence
    ? clampPercent(100 - cancelledRuns * 12 - timedOutRuns * 18 - retryCount * 3 - fallbackCount * 4)
    : null
  const errors = missionResponses.length || missionFeed.length ? failedRuns + verificationFailures + toolFailures + commandFailures : null

  const evidenceReport = {
    efficiencyRating,
    soulDrift: null,
    heartbeatStabilityScore,
    runtimeEfficiency,
    errors,
    xpGained: null,
  }

  const evidence: MissionReportEvidence = {
    source: evidenceSource(missionResponses, missionFeed),
    acceptedRuns,
    startedRuns,
    completedRuns,
    failedRuns,
    cancelledRuns,
    timedOutRuns,
    retryCount,
    fallbackCount,
    verificationFailures,
    toolFailures,
    commandFailures,
    humanInterventions,
    agentParticipation,
    queueDelayMs,
    timeToFirstTokenMs,
    totalExecutionDurationMs,
    missionWallTimeMs,
    tokenUsageEstimate,
    unavailableMetrics: buildUnavailableMetrics(evidenceReport),
  }

  return {
    id: reportId(),
    missionId: input.mission.id,
    generatedAt: input.generatedAt || new Date().toISOString(),
    ...evidenceReport,
    skillUnlocks: [],
    evidence,
  }
}
