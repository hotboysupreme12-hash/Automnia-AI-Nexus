import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type {
  Mission,
  MissionCronCleanupResult,
  MissionCronCleanupSummary,
  MissionCronJob,
  MissionCronJobStatus,
  MissionCronRole,
  MissionFeedEvent,
  MissionStatus,
  TeamSyncAssignment,
} from './missionStateService'

type MissionCronRunReference = {
  cronRunId: string | null
  sessionId: string | null
  sessionKey: string | null
}

export type MissionSchedulerOpenClawResult = {
  stdout: string
  stderr: string
  code: number
  controlCenterRunId?: string
}

export type MissionCronRuntimeDefaults = {
  model: string
  thinking: string
  timeoutSeconds: number
}

type MissionAgentRunContext = {
  executionWorkspace: string
  doctrineWorkspace: string
} & Record<string, unknown>

type MissionActiveShift = {
  id: string
  name: string
  agent: string
  every: string
  durationMinutes: number
  message: string
  model: string | undefined
  thinking: string
  timeoutSeconds: number
  wake: 'now'
  session: 'isolated'
  announce: false
  cronId: string
  startedAt: string
  endsAt: string | null
}

type MissionCronRehydrationState = {
  available: boolean
  activeCronIds: Set<string>
}

export type MissionSchedulerServiceOptions = {
  appendAgentDailyMemory: (agentId: string, text: string) => Promise<unknown>
  clearDisallowedAutoModelOverridesForAgent: (agentId: string) => Promise<unknown>
  clearShiftRuntimeStateForCronId: (cronId: string) => void
  composeAgentDoctrinePrompt: (
    agentId: string,
    prompt: string,
    executionWorkspace: string,
    doctrineWorkspace: string,
  ) => string
  ensureGatewayReadyForCronMission: () => Promise<void>
  ensureTeamSyncFile: (filePath: string) => Promise<unknown>
  extractAgentReply: (stdout: string, stderr: string) => string
  getAgentAuthEnv: (agentId: string) => Promise<Record<string, string>>
  missionAgentTimeoutSeconds: number
  missionLoopTimers: Map<string, NodeJS.Timeout>
  missionRunControllers: Map<string, AbortController>
  missionTimers: Map<string, NodeJS.Timeout>
  missions: Map<string, Mission>
  openClawAgentsRoot: string
  openClawErrorResult: (error: unknown) => MissionSchedulerOpenClawResult
  persistMissionRecord: (mission: Mission, reason: string) => void
  port: number
  pushMissionEvent: (event: Omit<MissionFeedEvent, 'id' | 'at'>) => MissionFeedEvent
  randomId?: () => string
  recordMissionReport: (mission: Mission) => unknown
  redactSensitiveText: (text: string) => string
  resolveAgentRunContext: (agentId: string) => Promise<MissionAgentRunContext>
  resolveMissionCronRuntimeDefaultsForAgent: (agentId: string) => Promise<MissionCronRuntimeDefaults>
  resolveSharedTeamSyncPath: (agentId: string) => Promise<string>
  runCwdForContext: (context: MissionAgentRunContext) => string
  runOpenClaw: (
    args: string[],
    timeoutMs: number,
    options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<MissionSchedulerOpenClawResult>
  setActiveShift: (id: string, shift: MissionActiveShift) => void
  stripAnsi: (text: string) => string
  transitionMissionState: (
    mission: Mission,
    nextState: Mission['lifecycleState'],
    type: MissionFeedEvent['type'],
    message: string,
    options?: {
      actor?: string
      idempotencyKey?: string
      evidence?: Record<string, unknown>
    },
  ) => unknown
  trimTask: (text: string, maxLength: number) => string
  writeTeamSyncSnapshot: (params: {
    missionId: string
    title: string
    mode: Mission['mode']
    status: MissionStatus
    assignments: TeamSyncAssignment[]
    activity: string[]
  }) => Promise<void>
  now?: () => Date
}

function isLooseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function valueAtPath(value: unknown, pathSegments: string[]): unknown {
  let current = value
  for (const segment of pathSegments) {
    if (!isLooseRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function diagnosticTextFromValue(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    return value.map(diagnosticTextFromValue).filter(Boolean).join('; ')
  }
  if (isLooseRecord(value)) {
    for (const key of ['message', 'detail', 'error', 'summary', 'lastError', 'lastDiagnosticSummary']) {
      const text = diagnosticTextFromValue(value[key])
      if (text) return text
    }
  }
  return ''
}

function stringAtAnyPath(value: unknown, paths: string[][]): string {
  for (const pathSegments of paths) {
    const candidate = valueAtPath(value, pathSegments)
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

function uniqueStrings(...items: Array<unknown>): string[] {
  const out = new Set<string>()
  for (const item of items) {
    if (Array.isArray(item)) {
      for (const nested of item) {
        if (typeof nested === 'string' && nested.trim()) out.add(nested.trim())
      }
    } else if (typeof item === 'string' && item.trim()) {
      out.add(item.trim())
    }
  }
  return Array.from(out)
}

export function parseCronIdFromOutput(stdout: string) {
  try {
    const raw = JSON.parse(stdout)
    const id = raw?.id || raw?.job?.id
    if (typeof id === 'string' && id.trim()) return id.trim()
  } catch {
    // Fall through to loose text parsing below.
  }
  const possible = stdout.match(/[a-f0-9-]{12,}/i)
  return possible?.[0] || ''
}

export function missionCronEvery(cadenceSeconds?: number | null) {
  const seconds = Math.max(15, Math.min(24 * 60 * 60, Math.round(Number(cadenceSeconds || 0) || 300)))
  const units: Array<[number, string]> = [
    [7 * 24 * 60 * 60, 'w'],
    [24 * 60 * 60, 'd'],
    [60 * 60, 'h'],
    [60, 'm'],
    [1, 's'],
  ]
  for (const [unitSeconds, suffix] of units) {
    if (seconds >= unitSeconds && seconds % unitSeconds === 0) return `${seconds / unitSeconds}${suffix}`
  }
  return `${seconds}s`
}

function collectParsedAgentRunOutputs(stripAnsi: (text: string) => string, stdout: string, stderr: string): unknown[] {
  const parsed: unknown[] = []
  for (const text of [stdout, stderr]) {
    const trimmed = stripAnsi(text).trim()
    if (!trimmed) continue
    try {
      parsed.push(JSON.parse(trimmed))
      continue
    } catch {
      // Fall through to extracting an embedded JSON object.
    }
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed.push(JSON.parse(trimmed.slice(start, end + 1)))
      } catch {
        // Non-JSON log output.
      }
    }
  }
  return parsed
}

function extractAgentRunDiagnostic(stripAnsi: (text: string) => string, stdout: string, stderr: string): string {
  const directPaths = [
    ['run', 'state', 'lastDiagnosticSummary'],
    ['run', 'state', 'lastError'],
    ['run', 'state', 'error'],
    ['run', 'error'],
    ['result', 'state', 'lastDiagnosticSummary'],
    ['result', 'error'],
    ['state', 'lastDiagnosticSummary'],
    ['lastDiagnosticSummary'],
    ['error'],
    ['message'],
    ['detail'],
  ]
  for (const parsed of collectParsedAgentRunOutputs(stripAnsi, stdout, stderr)) {
    for (const pathSegments of directPaths) {
      const text = diagnosticTextFromValue(valueAtPath(parsed, pathSegments))
      if (text) return text
    }
    const recursive = diagnosticTextFromValue(parsed)
    if (recursive) return recursive
  }
  return ''
}

function isCredibleMissionCronFinalReply(stripAnsi: (text: string) => string, reply: string): boolean {
  const text = stripAnsi(reply || '').trim()
  if (!text || /^(?:error|failed|null|undefined)$/i.test(text)) return false
  if (
    /(?:FailoverError|GatewayTransportError|No credentials found|subscription usage limit|You've reached your Codex subscription usage limit|command .* failed|Start-Process\s*:|Write-ErrorException)/i.test(text)
  ) {
    return false
  }
  return /(?:round\s+\d+\s+complete|changed files?:|verification:|blockers?:|next step:|evidence:|ran `|completed?:)/i.test(text)
}

function isRecoverableMissionCronProviderRateLimit(stripAnsi: (text: string) => string, stdout: string, stderr: string): boolean {
  const text = stripAnsi(`${stderr || ''}\n${stdout || ''}`)
  return /(?:RESOURCE_EXHAUSTED|API rate limit reached|rate_limit|Google Vertex AI API error \(429\)|\b429\b)/i.test(text)
}

function extractCronRunReference(stripAnsi: (text: string) => string, stdout: string, stderr: string): MissionCronRunReference {
  const text = `${stdout || ''}\n${stderr || ''}`
  const parsed = collectParsedAgentRunOutputs(stripAnsi, stdout, stderr)
  const cronRunIdFromJson = parsed.map((entry) => stringAtAnyPath(entry, [
    ['runId'],
    ['run', 'id'],
    ['run', 'runId'],
    ['cronRunId'],
    ['result', 'runId'],
    ['result', 'run', 'id'],
    ['task', 'runId'],
  ])).find(Boolean) || ''
  const sessionIdFromJson = parsed.map((entry) => stringAtAnyPath(entry, [
    ['sessionId'],
    ['session', 'id'],
    ['run', 'sessionId'],
    ['run', 'session', 'id'],
    ['result', 'sessionId'],
    ['result', 'session', 'id'],
    ['task', 'sessionId'],
  ])).find(Boolean) || ''
  const sessionKeyFromJson = parsed.map((entry) => stringAtAnyPath(entry, [
    ['sessionKey'],
    ['session', 'key'],
    ['run', 'sessionKey'],
    ['run', 'session', 'key'],
    ['result', 'sessionKey'],
    ['result', 'session', 'key'],
    ['task', 'sessionKey'],
  ])).find(Boolean) || ''
  const sessionIdMatch =
    /sessionId["'\s:=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text) ||
    /session\s+id["'\s:=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text)
  const runIdMatch =
    /(?:cronRunId|runId)["'\s:=]+([a-z0-9][a-z0-9._:-]{5,160})/i.exec(text) ||
    /(?:cron\s+run|run)\s+id["'\s:=]+([a-z0-9][a-z0-9._:-]{5,160})/i.exec(text)
  const sessionKeyMatch =
    /sessionKey["'\s:=]+([a-z0-9][a-z0-9._:/-]{5,240})/i.exec(text) ||
    /session\s+key["'\s:=]+([a-z0-9][a-z0-9._:/-]{5,240})/i.exec(text)
  return {
    cronRunId: cronRunIdFromJson || runIdMatch?.[1] || null,
    sessionId: sessionIdFromJson || sessionIdMatch?.[1] || null,
    sessionKey: sessionKeyFromJson || sessionKeyMatch?.[1] || null,
  }
}

function missionCronProgressEvidenceSummary(
  stripAnsi: (text: string) => string,
  trimTask: (text: string, maxLength: number) => string,
  text: string,
): string {
  const cleaned = stripAnsi(text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (/TEAM_SYNC\.md/i.test(cleaned) && /(?:ok\s*:\s*True|Successfully|updated|append|replaced)/i.test(cleaned)) {
    return 'durable progress saved to TEAM_SYNC.md before provider rate limit'
  }
  if (/Successfully\s+(?:replaced|created|updated|wrote|edited)/i.test(cleaned)) {
    return trimTask(`durable file change completed before provider rate limit: ${cleaned}`, 180)
  }
  if (isCredibleMissionCronFinalReply(stripAnsi, cleaned)) return cleaned
  return ''
}

function textFromAgentSessionContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as { type?: unknown; text?: unknown; output_text?: unknown }
      if (record.type === 'text' || record.type === 'output_text') {
        return typeof record.text === 'string'
          ? record.text
          : typeof record.output_text === 'string'
            ? record.output_text
            : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function createMissionCronJobNeedsRecovery(job: MissionCronJob) {
  return job.status === 'created' || job.status === 'running'
}

export function createMissionSchedulerService(options: MissionSchedulerServiceOptions) {
  const now = () => options.now?.() || new Date()
  const nowMs = () => now().getTime()
  const isoNow = () => now().toISOString()
  const randomId = () => options.randomId?.() || randomUUID()

  function missionRemainingDurationMinutes(mission: Pick<Mission, 'endAt'>) {
    if (!mission.endAt) return 0
    const remainingMs = new Date(mission.endAt).getTime() - nowMs()
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 1
    return Math.max(1, Math.ceil(remainingMs / 60000))
  }

  function missionCronName(mission: Mission, role: MissionCronRole, agentId: string, round: number) {
    const title = mission.title.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'mission'
    return `mission-${title}-r${round}-${role}-${agentId}`.slice(0, 80)
  }

  function missionRecurringCronName(mission: Mission, role: MissionCronRole, agentId: string) {
    const title = mission.title.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'mission'
    return `mission-${title}-${role}-${agentId}`.slice(0, 80)
  }

  function missionRemainingText(mission: Mission) {
    if (!mission.endAt) return 'No fixed mission end time; stop is manual.'
    const remainingMs = new Date(mission.endAt).getTime() - nowMs()
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Mission time has expired.'
    const minutes = Math.max(1, Math.round(remainingMs / 60000))
    return `Remaining mission time: about ${minutes} minute(s).`
  }

  function missionEvidenceBlock() {
    return [
      'Mission evidence:',
      '- Satisfy the mission objective with concrete evidence.',
      '- Report changed files, checks run, manual proof, blockers, and residual risks where relevant.',
    ].join('\n\n')
  }

  function missionRolePrompt(params: {
    mission: Mission
    agentId: string
    role: MissionCronRole
    round: number
    sharedTeamSyncPath: string
    executionWorkspace: string
    doctrineWorkspace: string
  }) {
    const { mission, agentId, role, round, sharedTeamSyncPath, executionWorkspace, doctrineWorkspace } = params
    const team = mission.party.join(', ')
    const roleDirective = (() => {
      if (role === 'leader') {
        return [
          'You are the slot-1 mission leader for this cron-controlled round.',
          'Read TEAM_SYNC.md and current project state, then append clear assignments for every teammate.',
          'Use named agent ids, concrete files/checks when possible, blockers, and expected evidence.',
          'Do not declare the whole mission complete unless this is an instant mission and evidence is already sufficient.',
        ].join('\n')
      }
      if (role === 'reviewer') {
        return [
          'You are the mission review leader for this cron-controlled round.',
          'Read TEAM_SYNC.md and summarize what each lane proved, what remains blocked, and what the next round should do.',
          mission.mode === 'instant'
            ? 'For instant missions, write FINAL_VERDICT: PASS only when evidence satisfies the mission objective; otherwise write FINAL_VERDICT: FAIL with blockers.'
            : 'For timed, loop, and watch missions, write CYCLE_REVIEW with next assignments. Do not end the mission; the scheduler controls continuation.',
        ].join('\n')
      }
      return [
        `You are worker agent ${agentId} in this cron-controlled mission round.`,
        'Read TEAM_SYNC.md first and execute the newest assignment for your agent id.',
        'If no assignment is present, claim one useful non-overlapping task that advances the mission and append your claim.',
        'Return concrete evidence: files changed, checks run, source facts gathered, blockers, and the next handoff.',
      ].join('\n')
    })()

    return options.composeAgentDoctrinePrompt(
      agentId,
      [
        `/new Mission cron run: "${mission.title}"`,
        `Mission ID: ${mission.id}`,
        `Round: ${round}`,
        `Role: ${role}`,
        `Mode: ${mission.mode}`,
        `Collaboration: ${mission.collaborationMode || 'leader-first'}`,
        `Type: ${mission.missionType || 'orchestration'}`,
        `Team: ${team}`,
        missionRemainingText(mission),
        '',
        roleDirective,
        '',
        'Mission objective:',
        mission.brief,
        '',
        missionEvidenceBlock(),
        '',
        'TEAM_SYNC logging contract:',
        '- Do not overwrite TEAM_SYNC.md.',
        '- Use append-only updates for claims, status, evidence, blockers, and handoffs.',
        `- Preferred method: POST http://127.0.0.1:${options.port}/api/team-sync/append with Content-Type application/json and body JSON.stringify({ agentId, role, runId, note, filePath }).`,
        `- Required TEAM_SYNC filePath: ${sharedTeamSyncPath}`,
        `- If HTTP append is unavailable, append directly to ${sharedTeamSyncPath} (append-only, no overwrite).`,
        '',
        'Cron execution rule:',
        `- This is a scheduled mission wakeup, not a generic heartbeat. Execute the role now.`,
        '- Do not return HEARTBEAT_OK unless execution is impossible after trying.',
        '- If blocked, report the exact blocker and the command/tool attempt that failed.',
        `- For project files, write in execution workspace: ${executionWorkspace}`,
      ].join('\n'),
      executionWorkspace,
      doctrineWorkspace,
    )
  }

  function missionPulseRolePrompt(params: {
    mission: Mission
    agentId: string
    role: MissionCronRole
    sharedTeamSyncPath: string
    executionWorkspace: string
    doctrineWorkspace: string
  }) {
    const { mission, agentId, role, sharedTeamSyncPath, executionWorkspace, doctrineWorkspace } = params
    const team = mission.party.join(', ')
    const solo = mission.party.length === 1
    const roleDirective = role === 'leader' && !solo
      ? [
          'You are the slot-1 mission leader for this recurring cron pulse.',
          'Read TEAM_SYNC.md and current project state, then refresh clear assignments for every teammate.',
          'Also execute one leader-owned slice when that advances the mission; do not only plan if useful work is available.',
        ].join('\n')
      : [
          `You are ${solo ? 'the mission agent' : `worker agent ${agentId}`} for this recurring cron pulse.`,
          'Execute one concrete, useful slice of the mission objective now.',
          'For generative objectives, create a brand-new output each pulse rather than repeating prior work.',
          'Return concrete evidence: files changed, checks run, source facts gathered, blockers, and the next handoff.',
        ].join('\n')

    return options.composeAgentDoctrinePrompt(
      agentId,
      [
        `/new Mission cron pulse: "${mission.title}"`,
        `Mission ID: ${mission.id}`,
        `Role: ${role}`,
        `Mode: ${mission.mode}`,
        `Cadence: every ${missionCronEvery(mission.cadenceSeconds)}`,
        ...(mission.endAt ? [`Mission expires at: ${mission.endAt}`] : []),
        `Collaboration: ${mission.collaborationMode || 'leader-first'}`,
        `Type: ${mission.missionType || 'orchestration'}`,
        `Team: ${team}`,
        missionRemainingText(mission),
        '',
        roleDirective,
        '',
        'Mission objective:',
        mission.brief,
        '',
        missionEvidenceBlock(),
        '',
        'TEAM_SYNC logging contract:',
        '- Do not overwrite TEAM_SYNC.md.',
        '- Use append-only updates for claims, status, evidence, blockers, and handoffs.',
        `- Preferred method: POST http://127.0.0.1:${options.port}/api/team-sync/append with Content-Type application/json and body JSON.stringify({ agentId, role, runId, note, filePath }).`,
        `- Required TEAM_SYNC filePath: ${sharedTeamSyncPath}`,
        `- If HTTP append is unavailable, append directly to ${sharedTeamSyncPath} (append-only, no overwrite).`,
        '',
        'Cron execution rule:',
        '- This is a recurring scheduled mission pulse. Execute now; do not wait for another scheduler.',
        '- Do not return HEARTBEAT_OK unless execution is impossible after trying.',
        '- If blocked, report the exact blocker and the command/tool attempt that failed.',
        `- For project files, write in execution workspace: ${executionWorkspace}`,
      ].join('\n'),
      executionWorkspace,
      doctrineWorkspace,
    )
  }

  async function agentSessionCandidateFiles(agentId: string, sessionId: string, startedAt?: string | null): Promise<string[]> {
    const sessionDir = path.join(options.openClawAgentsRoot, agentId, 'sessions')
    const candidates: string[] = []
    if (sessionId) candidates.push(path.join(sessionDir, `${sessionId}.jsonl`))
    if (!candidates.length) {
      const startedMs = startedAt ? Date.parse(startedAt) : 0
      const entries = await fs.readdir(sessionDir, { withFileTypes: true }).catch(() => [])
      const recent = await Promise.all(entries
        .filter((entry) => entry.isFile() && /^[0-9a-f-]+\.jsonl$/i.test(entry.name))
        .map(async (entry) => {
          const file = path.join(sessionDir, entry.name)
          const stat = await fs.stat(file).catch(() => null)
          return stat ? { file, mtimeMs: stat.mtimeMs } : null
        }))
      candidates.push(...recent
        .filter((entry): entry is { file: string; mtimeMs: number } => Boolean(entry && (!startedMs || entry.mtimeMs >= startedMs - 30000)))
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, 4)
        .map((entry) => entry.file))
    }
    return uniqueStrings(...candidates)
  }

  async function readLatestAgentSessionFinalReply(agentId: string, sessionId: string, startedAt?: string | null): Promise<string> {
    for (const file of await agentSessionCandidateFiles(agentId, sessionId, startedAt)) {
      const raw = await fs.readFile(file, 'utf-8').catch(() => '')
      if (!raw.trim()) continue
      const lines = raw.trim().split(/\r?\n/)
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as { type?: unknown; message?: { role?: unknown; content?: unknown }; payload?: unknown }
          const message = parsed.message
          if (parsed.type !== 'message' || message?.role !== 'assistant') continue
          const text = textFromAgentSessionContent(message.content)
          if (isCredibleMissionCronFinalReply(options.stripAnsi, text)) return text
        } catch {
          // Keep scanning older session lines.
        }
      }
    }
    return ''
  }

  async function readLatestAgentSessionProgressEvidence(agentId: string, sessionId: string, startedAt?: string | null): Promise<string> {
    for (const file of await agentSessionCandidateFiles(agentId, sessionId, startedAt)) {
      const raw = await fs.readFile(file, 'utf-8').catch(() => '')
      if (!raw.trim()) continue
      const lines = raw.trim().split(/\r?\n/)
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as { type?: unknown; message?: { role?: unknown; content?: unknown; isError?: unknown } }
          const message = parsed.message
          if (parsed.type !== 'message' || message?.role !== 'toolResult' || message.isError === true) continue
          const summary = missionCronProgressEvidenceSummary(options.stripAnsi, options.trimTask, textFromAgentSessionContent(message.content))
          if (summary) return summary
        } catch {
          // Keep scanning older session lines.
        }
      }
    }
    return ''
  }

  async function createMissionCronJob(params: {
    mission: Mission
    agentId: string
    role: MissionCronRole
    round: number
    signal?: AbortSignal
  }): Promise<MissionCronJob> {
    const { mission, agentId, role, round } = params
    const runtime = await options.resolveMissionCronRuntimeDefaultsForAgent(agentId)
    const context = await options.resolveAgentRunContext(agentId)
    const sharedTeamSyncPath = await options.resolveSharedTeamSyncPath(agentId)
    await options.ensureTeamSyncFile(sharedTeamSyncPath)
    await options.clearDisallowedAutoModelOverridesForAgent(agentId).catch(() => undefined)
    console.log(`[mission/cron] create agent=${agentId} role=${role} round=${round} model=${runtime.model || '(gateway-default)'} thinking=${runtime.thinking} timeout=${runtime.timeoutSeconds}s`)
    const prompt = missionRolePrompt({
      mission,
      agentId,
      role,
      round,
      sharedTeamSyncPath,
      executionWorkspace: context.executionWorkspace,
      doctrineWorkspace: context.doctrineWorkspace,
    })
    const name = missionCronName(mission, role, agentId, round)
    const cronArgs = [
      'cron',
      'add',
      '--agent',
      agentId,
      '--name',
      name,
      '--description',
      `control-center mission=${mission.id} role=${role} round=${round}`,
      '--at',
      '+365d',
      '--delete-after-run',
      '--message',
      prompt,
      '--thinking',
      runtime.thinking,
      '--timeout-seconds',
      String(runtime.timeoutSeconds),
      '--wake',
      'now',
      '--session',
      'isolated',
      ...(runtime.model ? ['--model', runtime.model] : []),
      '--no-deliver',
      '--json',
    ]
    await options.ensureGatewayReadyForCronMission()
    const created = await options.runOpenClaw(cronArgs, 90000, {
      cwd: options.runCwdForContext(context),
      envOverrides: await options.getAgentAuthEnv(agentId),
      signal: params.signal,
    })
    if (created.code !== 0) throw new Error(created.stderr || created.stdout || 'Failed to create mission cron job')
    const cronId = parseCronIdFromOutput(created.stdout)
    if (!cronId) throw new Error(`Mission cron job created but id was not parsed: ${created.stdout}`)
    const job: MissionCronJob = {
      id: randomId(),
      cronId,
      missionId: mission.id,
      agentId,
      role,
      round,
      name,
      status: 'created',
      createdAt: isoNow(),
      startedAt: null,
      endedAt: null,
      summary: null,
      runtimeRunId: null,
      cronRunId: null,
      sessionId: null,
      sessionKey: null,
    }
    mission.scheduler.jobs.unshift(job)
    if (mission.scheduler.jobs.length > 160) mission.scheduler.jobs.length = 160
    options.persistMissionRecord(mission, `cron-job-created:${job.id}`)
    options.pushMissionEvent({
      missionId: mission.id,
      type: role === 'worker' ? 'agent_assigned' : 'agent_update',
      agentId,
      message: `Cron job created: ${role} round ${round} (${cronId}) model=${runtime.model || 'gateway-default'}`,
    })
    return job
  }

  async function createRecurringMissionCronJob(params: {
    mission: Mission
    agentId: string
    role: MissionCronRole
    signal?: AbortSignal
  }): Promise<MissionCronJob> {
    const { mission, agentId, role } = params
    const runtime = await options.resolveMissionCronRuntimeDefaultsForAgent(agentId)
    const context = await options.resolveAgentRunContext(agentId)
    const sharedTeamSyncPath = await options.resolveSharedTeamSyncPath(agentId)
    await options.ensureTeamSyncFile(sharedTeamSyncPath)
    await options.clearDisallowedAutoModelOverridesForAgent(agentId).catch(() => undefined)
    const every = missionCronEvery(mission.cadenceSeconds)
    console.log(`[mission/cron] schedule recurring agent=${agentId} role=${role} every=${every} model=${runtime.model || '(gateway-default)'} thinking=${runtime.thinking} timeout=${runtime.timeoutSeconds}s`)
    const prompt = missionPulseRolePrompt({
      mission,
      agentId,
      role,
      sharedTeamSyncPath,
      executionWorkspace: context.executionWorkspace,
      doctrineWorkspace: context.doctrineWorkspace,
    })
    const name = missionRecurringCronName(mission, role, agentId)
    const description = [
      `control-center mission=${mission.id}`,
      `role=${role}`,
      `recurring every=${every}`,
      mission.endAt ? `expiresAt=${mission.endAt}` : '',
    ].filter(Boolean).join(' ')
    const cronArgs = [
      'cron',
      'add',
      '--agent',
      agentId,
      '--name',
      name,
      '--description',
      description,
      '--every',
      every,
      '--message',
      prompt,
      '--thinking',
      runtime.thinking,
      '--timeout-seconds',
      String(runtime.timeoutSeconds),
      '--wake',
      'now',
      '--session',
      'isolated',
      ...(runtime.model ? ['--model', runtime.model] : []),
      '--no-deliver',
      '--json',
    ]
    await options.ensureGatewayReadyForCronMission()
    const created = await options.runOpenClaw(cronArgs, 90000, {
      cwd: options.runCwdForContext(context),
      envOverrides: await options.getAgentAuthEnv(agentId),
      signal: params.signal,
    })
    if (created.code !== 0) throw new Error(created.stderr || created.stdout || 'Failed to create recurring mission cron job')
    const cronId = parseCronIdFromOutput(created.stdout)
    if (!cronId) throw new Error(`Recurring mission cron job created but id was not parsed: ${created.stdout}`)
    const createdAt = isoNow()
    const job: MissionCronJob = {
      id: randomId(),
      cronId,
      missionId: mission.id,
      agentId,
      role,
      round: 0,
      name,
      status: 'created',
      createdAt,
      startedAt: null,
      endedAt: null,
      summary: null,
      runtimeRunId: null,
      cronRunId: null,
      sessionId: null,
      sessionKey: null,
    }
    mission.scheduler.jobs.unshift(job)
    if (mission.scheduler.jobs.length > 160) mission.scheduler.jobs.length = 160
    options.persistMissionRecord(mission, `recurring-cron-job-created:${job.id}`)
    options.setActiveShift(`mission:${job.id}`, {
      id: `mission:${job.id}`,
      name,
      agent: agentId,
      every,
      durationMinutes: missionRemainingDurationMinutes(mission),
      message: prompt,
      model: runtime.model || undefined,
      thinking: runtime.thinking,
      timeoutSeconds: runtime.timeoutSeconds,
      wake: 'now',
      session: 'isolated',
      announce: false,
      cronId,
      startedAt: createdAt,
      endsAt: mission.endAt,
    })
    options.pushMissionEvent({
      missionId: mission.id,
      type: role === 'worker' ? 'agent_assigned' : 'agent_update',
      agentId,
      message: `Recurring cron pulse armed: ${role} every ${every} (${cronId}) model=${runtime.model || 'gateway-default'}`,
    })
    return job
  }

  function missionCronCleanupResult(
    job: MissionCronJob,
    previousStatus: MissionCronJobStatus,
    ok: boolean,
    action: MissionCronCleanupResult['action'],
    detail: string | null = null,
  ): MissionCronCleanupResult {
    return {
      jobId: job.id,
      cronId: job.cronId,
      agentId: job.agentId,
      previousStatus,
      status: job.status,
      ok,
      action,
      detail,
    }
  }

  function summarizeMissionCronCleanupResults(results: MissionCronCleanupResult[]): MissionCronCleanupSummary {
    return {
      attempted: results.length,
      removed: results.filter((result) => result.action === 'removed').length,
      disabled: results.filter((result) => result.action === 'disabled').length,
      failed: results.filter((result) => !result.ok).length,
      results,
    }
  }

  async function removeMissionCronJob(job: MissionCronJob, signal?: AbortSignal): Promise<MissionCronCleanupResult> {
    const previousStatus = job.status
    const remove = await options.runOpenClaw(['cron', 'rm', job.cronId, '--json'], 45000, { signal }).catch((error) => ({
      stdout: '',
      stderr: String(error),
      code: 1,
    }))
    if (remove.code === 0 || /not\s*found|missing|unknown/i.test(`${remove.stdout}\n${remove.stderr}`)) {
      job.status = job.status === 'completed' || job.status === 'failed' ? job.status : 'removed'
      options.clearShiftRuntimeStateForCronId(job.cronId)
      return missionCronCleanupResult(job, previousStatus, true, 'removed')
    }
    const disable = await options.runOpenClaw(['cron', 'disable', job.cronId], 45000, { signal }).catch((error) => ({
      stdout: '',
      stderr: String(error),
      code: 1,
    }))
    if (disable.code === 0) {
      job.status = 'disabled'
      options.clearShiftRuntimeStateForCronId(job.cronId)
      return missionCronCleanupResult(job, previousStatus, true, 'disabled')
    }
    const detail = options.redactSensitiveText(options.trimTask(`${remove.stderr || remove.stdout || ''}\n${disable.stderr || disable.stdout || ''}`.trim() || 'OpenClaw cron cleanup failed', 500))
    if (job.status !== 'completed' && job.status !== 'failed') job.status = 'failed'
    job.endedAt ||= isoNow()
    job.summary = detail
    return missionCronCleanupResult(job, previousStatus, false, 'unchanged', detail)
  }

  async function runMissionCronJob(job: MissionCronJob, signal?: AbortSignal) {
    const mission = options.missions.get(job.missionId)
    if (!mission || mission.status !== 'active') return { ok: false, summary: 'mission is not active' }
    const runtime = await options.resolveMissionCronRuntimeDefaultsForAgent(job.agentId)
    const context = await options.resolveAgentRunContext(job.agentId)
    const envOverrides = await options.getAgentAuthEnv(job.agentId)
    const waitTimeout = `${Math.max(60, runtime.timeoutSeconds + 60)}s`
    await options.ensureGatewayReadyForCronMission()
    job.status = 'running'
    job.startedAt = isoNow()
    mission.scheduler.activeJobId = job.id
    options.persistMissionRecord(mission, `cron-job-running:${job.id}`)
    options.pushMissionEvent({
      missionId: mission.id,
      type: 'agent_update',
      agentId: job.agentId,
      message: `Cron ${job.role} round ${job.round} started`,
    })

    const result = await options.runOpenClaw(
      ['cron', 'run', job.cronId, '--wait', '--expect-final', '--wait-timeout', waitTimeout, '--timeout', String((runtime.timeoutSeconds + 90) * 1000)],
      (runtime.timeoutSeconds + 120) * 1000,
      { cwd: options.runCwdForContext(context), envOverrides, signal },
    ).catch(options.openClawErrorResult)
    await options.clearDisallowedAutoModelOverridesForAgent(job.agentId).catch(() => undefined)
    const exitOk = result.code === 0
    const rawExtractedReply = options.extractAgentReply(result.stdout, result.stderr)
    const rawCredibleReply = isCredibleMissionCronFinalReply(options.stripAnsi, rawExtractedReply)
    const cronRunReference = extractCronRunReference(options.stripAnsi, result.stdout, result.stderr)
    job.runtimeRunId = result.controlCenterRunId || null
    job.cronRunId = cronRunReference.cronRunId
    job.sessionId = cronRunReference.sessionId
    job.sessionKey = cronRunReference.sessionKey
    const cronRunSessionId = cronRunReference.sessionId || ''
    const recoveredReply = exitOk || rawCredibleReply
      ? ''
      : await readLatestAgentSessionFinalReply(job.agentId, cronRunSessionId, job.startedAt)
    const progressEvidence = exitOk || rawCredibleReply || recoveredReply || !isRecoverableMissionCronProviderRateLimit(options.stripAnsi, result.stdout, result.stderr)
      ? ''
      : await readLatestAgentSessionProgressEvidence(job.agentId, cronRunSessionId, job.startedAt)
    const extractedReply = recoveredReply || rawExtractedReply
    const ok = exitOk || rawCredibleReply || Boolean(recoveredReply) || Boolean(progressEvidence)
    const combinedOutput = options.stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim()
    const lowSignalReply = /^(error|failed)$/i.test((extractedReply || '').trim())
    const diagnosticSummary = extractAgentRunDiagnostic(options.stripAnsi, result.stdout, result.stderr)
    const summary = options.trimTask(progressEvidence || (extractedReply && !lowSignalReply ? extractedReply : diagnosticSummary || combinedOutput) || extractedReply || (ok ? 'completed' : 'failed'), 220)
    job.status = ok ? 'completed' : 'failed'
    job.endedAt = isoNow()
    job.summary = summary
    if (mission.scheduler.activeJobId === job.id) mission.scheduler.activeJobId = null
    options.persistMissionRecord(mission, `cron-job-${job.status}:${job.id}`)
    options.pushMissionEvent({
      missionId: mission.id,
      type: 'agent_update',
      agentId: job.agentId,
      message: ok ? `${job.agentId} cron ${job.role} round ${job.round} completed: ${summary}` : `${job.agentId} cron ${job.role} round ${job.round} failed: ${summary}`,
      evidence: {
        cronId: job.cronId,
        runtimeRunId: job.runtimeRunId,
        cronRunId: job.cronRunId,
        sessionId: job.sessionId,
        sessionKey: job.sessionKey,
      },
    })
    await options.appendAgentDailyMemory(job.agentId, `[mission:${mission.id}] cron ${job.role} round ${job.round} ${ok ? 'completed' : 'failed'} | ${options.trimTask(summary, 200)}`)
    await removeMissionCronJob(job, signal).catch(() => undefined)
    return { ok, summary, stdout: result.stdout, stderr: result.stderr, code: result.code }
  }

  function clearMissionController(missionId: string) {
    const timer = options.missionLoopTimers.get(missionId)
    if (timer) {
      clearTimeout(timer)
      options.missionLoopTimers.delete(missionId)
    }
    const controller = options.missionRunControllers.get(missionId)
    if (controller) {
      controller.abort()
      options.missionRunControllers.delete(missionId)
    }
  }

  async function cleanupMissionCronJobs(mission: Mission) {
    const jobs = mission.scheduler.jobs.filter((job) => job.status === 'created' || job.status === 'running')
    const settled = await Promise.allSettled(jobs.map((job) => removeMissionCronJob(job)))
    const results = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value
      const job = jobs[index]
      const detail = options.redactSensitiveText(options.trimTask(String(result.reason), 500))
      if (job) {
        const previousStatus = job.status
        if (job.status !== 'completed' && job.status !== 'failed') job.status = 'failed'
        job.endedAt ||= isoNow()
        job.summary = detail
        return missionCronCleanupResult(job, previousStatus, false, 'unchanged', detail)
      }
      return {
        jobId: 'unknown',
        cronId: 'unknown',
        agentId: 'unknown',
        previousStatus: 'failed',
        status: 'failed',
        ok: false,
        action: 'unchanged',
        detail,
      } satisfies MissionCronCleanupResult
    })
    return summarizeMissionCronCleanupResults(results)
  }

  function missionCronCleanupFailureSummary(error: unknown): MissionCronCleanupSummary {
    const detail = options.redactSensitiveText(options.trimTask(String(error), 500))
    return {
      attempted: 0,
      removed: 0,
      disabled: 0,
      failed: 1,
      results: [{
        jobId: 'unknown',
        cronId: 'unknown',
        agentId: 'unknown',
        previousStatus: 'failed',
        status: 'failed',
        ok: false,
        action: 'unchanged',
        detail,
      }],
    }
  }

  async function startRecurringMissionCronJobs(mission: Mission, assignments: TeamSyncAssignment[], activity: string[]) {
    const every = missionCronEvery(mission.cadenceSeconds)
    mission.scheduler.status = 'waiting'
    mission.scheduler.nextRoundAt = new Date(nowMs() + mission.scheduler.cycleIntervalMs).toISOString()
    mission.scheduler.lastError = null

    try {
      for (const agentId of mission.party) {
        const role: MissionCronRole = mission.party.length === 1 ? 'worker' : agentId === mission.party[0] ? 'leader' : 'worker'
        await createRecurringMissionCronJob({ mission, agentId, role })
        const state = assignments.find((entry) => entry.agentId === agentId)
        if (state) {
          state.status = 'queued'
          state.updatedAt = isoNow()
          state.note = `recurring cron pulse armed every ${every}`
        }
      }
    } catch (error) {
      mission.scheduler.status = 'failed'
      mission.scheduler.lastError = String(error)
      options.persistMissionRecord(mission, 'recurring-cron-setup-failed')
      await cleanupMissionCronJobs(mission).catch(() => undefined)
      throw error
    }

    activity.unshift(`${isoNow()} | scheduler | recurring cron pulses armed every ${every}`)
    if (activity.length > 80) activity.length = 80
    await options.writeTeamSyncSnapshot({
      missionId: mission.id,
      title: mission.title,
      mode: mission.mode,
      status: mission.status,
      assignments,
      activity,
    })
    options.persistMissionRecord(mission, 'recurring-cron-armed')
  }

  async function completeCronMission(mission: Mission, status: MissionStatus, note: string, assignments: TeamSyncAssignment[], activity: string[]) {
    clearMissionController(mission.id)
    mission.status = status
    mission.completedAt = isoNow()
    mission.endAt ||= mission.completedAt
    mission.scheduler.status = status === 'completed' ? 'completed' : 'stopped'
    mission.scheduler.nextRoundAt = null
    mission.scheduler.activeJobId = null
    const cleanup = await cleanupMissionCronJobs(mission).catch(missionCronCleanupFailureSummary)
    if (cleanup.failed > 0) {
      mission.scheduler.status = 'failed'
      mission.scheduler.lastError = `Mission cron cleanup failed for ${cleanup.failed} job(s).`
      options.pushMissionEvent({
        missionId: mission.id,
        type: 'agent_update',
        message: `Mission cron cleanup failed for ${cleanup.failed} job(s).`,
        actor: 'scheduler',
        evidence: { cleanup },
      })
    }
    options.transitionMissionState(mission, status === 'completed' ? 'completed' : 'cancelled', status === 'completed' ? 'mission_completed' : 'mission_cancelled', note, {
      idempotencyKey: `${mission.id}:${status}:${mission.completedAt}`,
      evidence: {
        round: mission.scheduler.round,
        jobs: mission.scheduler.jobs.length,
        failedJobs: mission.scheduler.jobs.filter((job) => job.status === 'failed').length,
        cleanup,
      },
    })
    options.recordMissionReport(mission)
    await options.writeTeamSyncSnapshot({
      missionId: mission.id,
      title: mission.title,
      mode: mission.mode,
      status: mission.status,
      assignments: assignments.map((entry) => ({
        ...entry,
        status: status === 'completed' ? (entry.status === 'failed' ? 'failed' : 'completed') : 'cancelled',
        updatedAt: isoNow(),
        note: entry.note || note,
      })),
      activity: [`${isoNow()} | ${note}`, ...activity].slice(0, 80),
    })
  }

  function scheduleNextMissionRound(mission: Mission, assignments: TeamSyncAssignment[], activity: string[], delayMs: number) {
    const existing = options.missionLoopTimers.get(mission.id)
    if (existing) clearTimeout(existing)
    const nextAt = new Date(nowMs() + delayMs).toISOString()
    mission.scheduler.status = 'waiting'
    mission.scheduler.nextRoundAt = nextAt
    const timer = setTimeout(() => {
      options.missionLoopTimers.delete(mission.id)
      void runMissionCronRound(mission.id, assignments, activity)
    }, delayMs)
    options.missionLoopTimers.set(mission.id, timer)
    options.persistMissionRecord(mission, 'next-round-scheduled')
  }

  async function runMissionCronRound(missionId: string, assignments: TeamSyncAssignment[], activity: string[]) {
    const mission = options.missions.get(missionId)
    if (!mission || mission.status !== 'active') return
    if (mission.endAt && nowMs() >= new Date(mission.endAt).getTime()) {
      await completeCronMission(mission, 'completed', `Mission completed: ${mission.title}`, assignments, activity)
      return
    }
    if (mission.scheduler.status === 'running') return
    if (mission.scheduler.maxCycles !== null && mission.scheduler.round >= mission.scheduler.maxCycles) {
      await completeCronMission(mission, 'completed', `Mission completed after ${mission.scheduler.round} cron cycle(s): ${mission.title}`, assignments, activity)
      return
    }

    const controller = new AbortController()
    options.missionRunControllers.set(mission.id, controller)
    mission.scheduler.status = 'running'
    mission.scheduler.round += 1
    mission.scheduler.nextRoundAt = null
    mission.scheduler.lastError = null
    const round = mission.scheduler.round
    const leaderAgentId = mission.party[0]
    const workers = mission.party.length > 1 ? mission.party.slice(1) : mission.party.slice(0, 1)
    options.transitionMissionState(mission, 'dispatching', 'agent_update', `Cron mission round ${round} dispatching.`, {
      actor: 'scheduler',
      idempotencyKey: `${mission.id}:round-${round}:dispatching`,
      evidence: { round, policy: mission.scheduler.policy },
    })
    options.transitionMissionState(mission, 'running', 'agent_update', `Cron mission round ${round} running.`, {
      actor: 'scheduler',
      idempotencyKey: `${mission.id}:round-${round}:running`,
      evidence: { round, partySize: mission.party.length },
    })
    const roundTask = [
      mission.brief,
      '',
      `Cron-controlled mission round ${round}.`,
      `Scheduler policy: leader-first; workers run only after the leader cron pass finishes.`,
      mission.mode === 'instant'
        ? 'This is a Strike mission. Complete one full leader -> worker -> review cycle, then close with a final verdict.'
        : 'Keep moving until the mission scheduler stops the run. If prior work is done, assign or execute the next useful slice.',
    ].join('\n')

    try {
      for (const state of assignments) {
        state.status = 'running'
        state.task = roundTask
        state.updatedAt = isoNow()
        state.note = `cron round ${round} running`
      }
      activity.unshift(`${isoNow()} | scheduler | cron round ${round} started`)
      if (activity.length > 80) activity.length = 80
      await options.writeTeamSyncSnapshot({
        missionId: mission.id,
        title: mission.title,
        mode: mission.mode,
        status: mission.status,
        assignments,
        activity,
      })

      if (leaderAgentId) {
        const leadJob = await createMissionCronJob({ mission, agentId: leaderAgentId, role: 'leader', round, signal: controller.signal })
        const leadResult = await runMissionCronJob(leadJob, controller.signal)
        const leadState = assignments.find((entry) => entry.agentId === leaderAgentId)
        if (leadState) {
          leadState.status = leadResult.ok ? 'running' : 'failed'
          leadState.updatedAt = isoNow()
          leadState.note = leadResult.ok ? `cron round ${round} assignments refreshed` : options.trimTask(leadResult.summary, 120)
        }
        activity.unshift(`${isoNow()} | ${leaderAgentId} | leader cron ${leadResult.ok ? 'completed' : 'failed'} round ${round} | ${options.trimTask(leadResult.summary, 160)}`)
      }

      const latestAfterLead = options.missions.get(mission.id)
      if (!latestAfterLead || latestAfterLead.status !== 'active') return

      const workerResults: Array<{ agentId: string; result: Awaited<ReturnType<typeof runMissionCronJob>> }> = []
      for (const agentId of workers) {
        if (controller.signal.aborted || options.missions.get(mission.id)?.status !== 'active') break
        const job = await createMissionCronJob({ mission, agentId, role: 'worker', round, signal: controller.signal })
        workerResults.push({ agentId, result: await runMissionCronJob(job, controller.signal) })
      }
      for (const { agentId, result } of workerResults) {
        const state = assignments.find((entry) => entry.agentId === agentId)
        if (state) {
          state.status = result.ok ? 'completed' : 'failed'
          state.updatedAt = isoNow()
          state.note = result.ok ? `cron round ${round} step complete` : options.trimTask(result.summary, 120)
        }
        activity.unshift(`${isoNow()} | ${agentId} | worker cron ${result.ok ? 'completed' : 'failed'} round ${round} | ${options.trimTask(result.summary, 160)}`)
        if (activity.length > 80) activity.length = 80
      }

      if (leaderAgentId && options.missions.get(mission.id)?.status === 'active') {
        const reviewJob = await createMissionCronJob({ mission, agentId: leaderAgentId, role: 'reviewer', round, signal: controller.signal })
        const reviewResult = await runMissionCronJob(reviewJob, controller.signal)
        const leadState = assignments.find((entry) => entry.agentId === leaderAgentId)
        if (leadState) {
          leadState.status = reviewResult.ok ? 'completed' : 'failed'
          leadState.updatedAt = isoNow()
          leadState.note = reviewResult.ok ? `cron round ${round} reviewed` : options.trimTask(reviewResult.summary, 120)
        }
        activity.unshift(`${isoNow()} | ${leaderAgentId} | review cron ${reviewResult.ok ? 'completed' : 'failed'} round ${round} | ${options.trimTask(reviewResult.summary, 160)}`)
      }

      await options.writeTeamSyncSnapshot({
        missionId: mission.id,
        title: mission.title,
        mode: mission.mode,
        status: mission.status,
        assignments,
        activity,
      })
    } catch (error) {
      const latest = options.missions.get(mission.id)
      if (latest) {
        latest.scheduler.status = 'failed'
        latest.scheduler.lastError = String(error)
      }
      options.pushMissionEvent({
        missionId: mission.id,
        type: 'agent_update',
        message: `Cron mission round ${round} failed: ${options.trimTask(String(error), 180)}`,
      })
    } finally {
      options.missionRunControllers.delete(mission.id)
      const latest = options.missions.get(mission.id)
      if (latest && latest.status === 'active') {
        const remainingMs = latest.endAt ? new Date(latest.endAt).getTime() - nowMs() : Number.POSITIVE_INFINITY
        if (latest.mode === 'instant') {
          await completeCronMission(latest, 'completed', `Mission completed by cron Strike cycle: ${latest.title}`, assignments, activity)
        } else if (remainingMs <= 0) {
          await completeCronMission(latest, 'completed', `Mission completed by cron timer: ${latest.title}`, assignments, activity)
        } else {
          scheduleNextMissionRound(latest, assignments, activity, latest.scheduler.cycleIntervalMs)
        }
      }
    }
  }

  function rehydrateRecurringMissionShifts(mission: Mission, cronState: MissionCronRehydrationState) {
    const every = missionCronEvery(mission.cadenceSeconds)
    for (const job of mission.scheduler.jobs) {
      if (!createMissionCronJobNeedsRecovery(job)) continue
      if (cronState.available && !cronState.activeCronIds.has(job.cronId)) continue
      options.setActiveShift(`mission:${job.id}`, {
        id: `mission:${job.id}`,
        name: job.name,
        agent: job.agentId,
        every,
        durationMinutes: missionRemainingDurationMinutes(mission),
        message: `Rehydrated mission cron pulse for ${mission.title}`,
        model: undefined,
        thinking: 'medium',
        timeoutSeconds: options.missionAgentTimeoutSeconds,
        wake: 'now',
        session: 'isolated',
        announce: false,
        cronId: job.cronId,
        startedAt: job.createdAt,
        endsAt: mission.endAt,
      })
    }
  }

  function armRehydratedMissionTimer(mission: Mission, assignments: TeamSyncAssignment[], activity: string[]) {
    if (mission.status !== 'active') return
    if (mission.endAt) {
      const remainingMs = Date.parse(mission.endAt) - nowMs()
      if (Number.isFinite(remainingMs) && remainingMs > 0) {
        const timer = setTimeout(() => {
          const target = options.missions.get(mission.id)
          if (!target || target.status !== 'active') return
          options.missionTimers.delete(mission.id)
          void completeCronMission(target, 'completed', `Mission completed by rehydrated cron timer: ${target.title}`, assignments, activity)
        }, remainingMs)
        options.missionTimers.set(mission.id, timer)
      } else {
        void completeCronMission(mission, 'completed', `Mission completed during restart recovery: ${mission.title}`, assignments, activity)
      }
    }

    if (mission.mode === 'instant') {
      const nextRoundAtMs = mission.scheduler.nextRoundAt ? Date.parse(mission.scheduler.nextRoundAt) : NaN
      const delayMs = Number.isFinite(nextRoundAtMs) ? Math.max(0, nextRoundAtMs - nowMs()) : 0
      scheduleNextMissionRound(mission, assignments, activity, delayMs)
    }
  }

  return {
    armRehydratedMissionTimer,
    cleanupMissionCronJobs,
    clearMissionController,
    completeCronMission,
    createMissionCronJob,
    createRecurringMissionCronJob,
    missionCronCleanupFailureSummary,
    missionCronEvery,
    missionCronJobNeedsRecovery: createMissionCronJobNeedsRecovery,
    rehydrateRecurringMissionShifts,
    removeMissionCronJob,
    runMissionCronJob,
    runMissionCronRound,
    scheduleNextMissionRound,
    startRecurringMissionCronJobs,
  }
}

export type MissionSchedulerService = ReturnType<typeof createMissionSchedulerService>
