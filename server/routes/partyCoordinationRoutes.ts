import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type OpenClawResultLike = {
  stdout: string
  stderr: string
  code: number
}

type AgentRunContext = {
  executionWorkspace: string
  doctrineWorkspace: string
}

type TeamSyncAssignment = {
  agentId: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt: string
  note?: string
}

type PartyMember = {
  id: string
  name?: string
  aliases?: string[]
  role?: string
  className?: string
  level?: number
}

type HostActionRequest = {
  kind: 'launch-chrome'
  url?: string
}

type BrowserPreflightResult = {
  ok: boolean
  reason: string
  message: string
  detail?: string
}

type HostLaunchResult = {
  ok: boolean
  detail: string
  command: string
}

type FilenameResolution = {
  message: string
  notes: string[]
}

type AgentToAgentPolicy = {
  enabled: boolean
  allow: string[]
}

export type PartyCoordinationRoutesOptions = {
  CANONICAL_DOCTRINE_ONLY: boolean
  ENABLE_HOST_ACTION_SHORTCUTS: boolean
  agentWorkTimeoutWrapperMs: (timeoutSeconds: number) => number
  appendAgentDailyMemory: (agentId: string, entry: string) => Promise<void>
  appendAgentPromptDump: (params: {
    route: string
    agent: string
    sessionId: string
    thinking: string
    timeoutSeconds: number
    cwd: string
    requestMessage: string
    finalMessage: string
    intentMessage?: string
    note?: string
  }) => Promise<void>
  buildBrowserRecoveryInstruction: (originalTask: string) => string
  buildDispatchExecutionDirective: (member: { id: string; name?: string; role?: string; className?: string }) => string
  buildWebsiteContributionDirective: (params: {
    active: boolean
    assignmentIndex: number
    totalAssignments: number
    message: string
    resolutionNotes: string[]
  }) => string
  checkBrowserPreflight: (agentId?: string) => Promise<BrowserPreflightResult>
  cleanupDoctrineMirrorsAfterRun: (agentId: string, executionWorkspace: string) => Promise<unknown>
  composeAgentDoctrinePrompt: (agentId: string, message: string, executionWorkspace?: string, doctrineWorkspace?: string) => string
  computePeakConcurrency: (spans: Array<{ startedAt: string; endedAt: string }>) => number
  detectHostActionRequest: (message: string) => HostActionRequest | null
  ensureTeamSyncFile: (filePath: string) => Promise<void>
  extractAgentReply: (stdout: string, stderr: string) => string
  getAgentAuthEnv: (agentId?: string) => Promise<Record<string, string> | undefined>
  getAgentToAgentPolicy: () => Promise<AgentToAgentPolicy>
  getPartyMembers: () => Promise<PartyMember[]>
  hasBrowserRelayDisconnected: (value: string) => boolean
  hasBrowserRelayPortConflict: (value: string) => boolean
  isAgentAllowedByPolicy: (agentId: string, allow: string[]) => boolean
  isBrowserServiceReadyOnlyReply: (reply: string) => boolean
  isPathUnder: (baseDir: string, targetPath: string) => boolean
  isRetiredAgentId: (agentId: string | undefined) => boolean
  isSharedWebsiteCollaboration: (assignments: Array<{ message: string }>) => boolean
  isValidAgentId: (agentId: string) => boolean
  launchChromeHost: (url?: string) => Promise<HostLaunchResult>
  resolveAgentRunContext: (agentId: string) => Promise<AgentRunContext>
  resolveEffectiveAgentWorkTimeoutSeconds: (agentId: string, requested: unknown) => Promise<number>
  resolveFilenameHintsForMessage: (message: string, executionWorkspace: string) => Promise<FilenameResolution>
  resolveSharedTeamSyncPath: (agentId?: string) => Promise<string>
  runCwdForContext: (context: { executionWorkspace?: string; doctrineWorkspace?: string }) => string
  runOpenClaw: (args: string[], timeoutMs?: number, options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal }) => Promise<OpenClawResultLike>
  runOpenClawWithGeminiToolWritePolicy: (
    agentId: string,
    message: string,
    context: AgentRunContext,
    args: string[],
    timeoutMs: number,
    options?: { cwd?: string; envOverrides?: Record<string, string>; signal?: AbortSignal; retry?: boolean },
  ) => Promise<OpenClawResultLike>
  samePath: (a: string, b: string) => boolean
  shouldRouteBrowserIntentThroughBrowserPlugin: (text: string, hostAction: HostActionRequest | null) => Promise<boolean>
  splitTextForAppend: (value: string, maxChars: number) => string[]
  trimTask: (value: string, max?: number) => string
  tryReleaseBrowserRelayPort: () => Promise<{ released: boolean; detail: string }>
  tryRestartGatewayService: (options?: { force?: boolean; allowExternalTakeover?: boolean; reason?: string }) => Promise<{ restarted: boolean; detail: string }>
  withAgentRuntimeFlags: (args: string[]) => string[]
  writeTeamSyncSnapshot: (params: {
    missionId: string
    title: string
    mode: string
    status: string
    assignments: TeamSyncAssignment[]
    activity: string[]
  }) => Promise<void>
}

export function registerPartyCoordinationRoutes(app: Express, options: PartyCoordinationRoutesOptions) {
  const {
    CANONICAL_DOCTRINE_ONLY,
    ENABLE_HOST_ACTION_SHORTCUTS,
    agentWorkTimeoutWrapperMs,
    appendAgentDailyMemory,
    appendAgentPromptDump,
    buildBrowserRecoveryInstruction,
    buildDispatchExecutionDirective,
    buildWebsiteContributionDirective,
    checkBrowserPreflight,
    cleanupDoctrineMirrorsAfterRun,
    composeAgentDoctrinePrompt,
    computePeakConcurrency,
    detectHostActionRequest,
    ensureTeamSyncFile,
    extractAgentReply,
    getAgentAuthEnv,
    getAgentToAgentPolicy,
    getPartyMembers,
    hasBrowserRelayDisconnected,
    hasBrowserRelayPortConflict,
    isAgentAllowedByPolicy,
    isBrowserServiceReadyOnlyReply,
    isPathUnder,
    isRetiredAgentId,
    isSharedWebsiteCollaboration,
    isValidAgentId,
    launchChromeHost,
    resolveAgentRunContext,
    resolveEffectiveAgentWorkTimeoutSeconds,
    resolveFilenameHintsForMessage,
    resolveSharedTeamSyncPath,
    runCwdForContext,
    runOpenClaw,
    runOpenClawWithGeminiToolWritePolicy,
    samePath,
    shouldRouteBrowserIntentThroughBrowserPlugin,
    splitTextForAppend,
    trimTask,
    tryReleaseBrowserRelayPort,
    tryRestartGatewayService,
    withAgentRuntimeFlags,
    writeTeamSyncSnapshot,
  } = options

app.post('/api/party/dispatch', async (req, res) => {
  const schema = z.object({
    mode: z.enum(['parallel', 'sequential']).default('parallel'),
    assignments: z
      .array(
        z.object({
          agent: z.string().min(1),
          message: z.string().min(1),
          thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
          timeoutSeconds: z.number().int().min(30).max(7200).optional(),
        }),
      )
      .min(1)
      .max(12),
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

  try {
  const invalidAssignmentAgent = parsed.data.assignments.find(
    (assignment) => !isValidAgentId(assignment.agent) || isRetiredAgentId(assignment.agent),
  )
  if (invalidAssignmentAgent) {
    return apiFailure(res, 400, 'invalid_payload', `Invalid or retired agent id: ${invalidAssignmentAgent.agent}`)
  }

  const party = await getPartyMembers()
  const partyById = new Map(party.map((agent) => [agent.id, agent]))
  const missingAgents = Array.from(new Set(parsed.data.assignments.map((assignment) => assignment.agent))).filter(
    (agentId) => !partyById.has(agentId),
  )
  if (missingAgents.length) {
    return apiFailure(res, 404, 'agent_not_found', 'Dispatch includes agent ids that are not in the party.', {
      agents: missingAgents,
    })
  }

  const dispatchId = randomUUID()
  const activity: string[] = []
  const assignmentsState: TeamSyncAssignment[] = parsed.data.assignments.map((assignment) => ({
    agentId: assignment.agent,
    task: assignment.message,
    status: 'queued',
    updatedAt: new Date().toISOString(),
  }))
  const sharedWebsiteCollaboration = isSharedWebsiteCollaboration(parsed.data.assignments)
  await writeTeamSyncSnapshot({
    missionId: dispatchId,
    title: 'Parallel Dispatch',
    mode: parsed.data.mode,
    status: 'running',
    assignments: assignmentsState,
    activity,
  })

  const runAssignment = async (assignment: (typeof parsed.data.assignments)[number], assignmentIndex: number) => {
    const state = assignmentsState.find((item) => item.agentId === assignment.agent)
    if (state) {
      state.status = 'running'
      state.updatedAt = new Date().toISOString()
    }
    const meta = partyById.get(assignment.agent)
    const agentLabel = meta?.name || assignment.agent
    const assignedTeamIds = parsed.data.assignments.map((entry) => entry.agent)
    const context = await resolveAgentRunContext(assignment.agent)
    const filenameResolution = await resolveFilenameHintsForMessage(assignment.message, context.executionWorkspace)
    const effectiveAssignmentMessage = filenameResolution.message
    const websiteContributionDirective = buildWebsiteContributionDirective({
      active: sharedWebsiteCollaboration,
      assignmentIndex,
      totalAssignments: parsed.data.assignments.length,
      message: assignment.message,
      resolutionNotes: filenameResolution.notes,
    })
    const roleDirective = buildDispatchExecutionDirective({
      id: assignment.agent,
      name: meta?.name,
      role: meta?.role,
      className: meta?.className,
    })
    const hostAction = ENABLE_HOST_ACTION_SHORTCUTS ? detectHostActionRequest(assignment.message) : null

    const assignmentBrowserIntent = await shouldRouteBrowserIntentThroughBrowserPlugin(assignment.message, hostAction)
    if (assignmentBrowserIntent) {
      const preflight = await checkBrowserPreflight(assignment.agent)
      if (!preflight.ok) {
        const startedAt = new Date().toISOString()
        const endedAt = startedAt
        const durationMs = 0
        const failure = preflight.message
        activity.unshift(`${new Date().toISOString()} | ${assignment.agent} | failed | ${trimTask(failure, 160)}`)
        if (activity.length > 80) activity.length = 80
        if (state) {
          state.status = 'failed'
          state.updatedAt = new Date().toISOString()
          state.note = trimTask(preflight.reason, 90)
        }
        await appendAgentDailyMemory(assignment.agent, `[dispatch:${dispatchId}] failed | ${trimTask(failure, 200)}`)
        return {
          agent: assignment.agent,
          ok: false,
          stdout: '',
          stderr: JSON.stringify({
            status: 'error',
            message: preflight.message,
            reason: preflight.reason,
            detail: preflight.detail,
          }),
          code: 1,
          startedAt,
          endedAt,
          durationMs,
        }
      }
    }

    if (hostAction?.kind === 'launch-chrome') {
      const startedAt = new Date().toISOString()
      const startMs = Date.now()
      const launched = await launchChromeHost(hostAction.url)
      const endedAt = new Date().toISOString()
      const durationMs = Date.now() - startMs
      const success = launched.ok
      const hostMessage = success
        ? `Host action executed: launched Google Chrome${hostAction.url ? ` (${hostAction.url})` : ''}.`
        : `Host action failed: could not launch Google Chrome.`
      activity.unshift(`${new Date().toISOString()} | ${assignment.agent} | ${success ? 'completed' : 'failed'} | ${hostMessage}`)
      if (activity.length > 80) activity.length = 80
      if (state) {
        state.status = success ? 'completed' : 'failed'
        state.updatedAt = new Date().toISOString()
        state.note = success ? 'host action completed' : trimTask(launched.detail || 'host action failed', 90)
      }
      await appendAgentDailyMemory(
        assignment.agent,
        `[dispatch:${dispatchId}] host action ${success ? 'completed' : 'failed'} | ${hostMessage}`,
      )
      return {
        agent: assignment.agent,
        ok: success,
        stdout: success
          ? JSON.stringify({
              status: 'ok',
              message: hostMessage,
              command: launched.command,
              detail: launched.detail,
            })
          : '',
        stderr: success
          ? ''
          : JSON.stringify({
              status: 'error',
              message: hostMessage,
              command: launched.command,
              detail: launched.detail,
            }),
        code: success ? 0 : 1,
        startedAt,
        endedAt,
        durationMs,
      }
    }
    const prompt = composeAgentDoctrinePrompt(
      assignment.agent,
      [
      `/new You are ${agentLabel} (${assignment.agent}).`,
      'Respond only as this specific agent.',
      `Assigned team: ${assignedTeamIds.join(', ')}`,
      'Do not answer for teammates unless explicitly asked to coordinate.',
      'For direct format tasks, return only the requested format with no extra commentary.',
      'Read TEAM_SYNC.md first for active teammate ownership and status.',
      roleDirective,
      websiteContributionDirective,
      '',
      'Your assignment:',
      effectiveAssignmentMessage,
      ].join('\n'),
      context.executionWorkspace,
      context.doctrineWorkspace,
    )
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    const sessionId = randomUUID()
    const envOverrides = await getAgentAuthEnv(assignment.agent)
    const runCwd = runCwdForContext(context)
    const effectiveTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(assignment.agent, assignment.timeoutSeconds)
    const effectiveThinking = assignment.thinking
    await appendAgentPromptDump({
      route: '/api/party/dispatch',
      agent: assignment.agent,
      sessionId,
      thinking: effectiveThinking,
      timeoutSeconds: effectiveTimeoutSeconds,
      cwd: runCwd,
      requestMessage: assignment.message,
      intentMessage: assignment.message,
      finalMessage: prompt,
      note: 'dispatch assignment before OpenClaw runtime call',
    })
    let result = await runOpenClawWithGeminiToolWritePolicy(
      assignment.agent,
      effectiveAssignmentMessage,
      context,
      withAgentRuntimeFlags([
        'agent',
        '--agent',
        assignment.agent,
        '--session-id',
        sessionId,
        '--message',
        prompt,
        '--thinking',
        effectiveThinking,
        '--timeout',
        String(effectiveTimeoutSeconds),
        '--json',
      ]),
      agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds),
      { cwd: runCwd, envOverrides },
    )

    let assignmentReply = extractAgentReply(result.stdout, result.stderr)
    if (result.code === 0 && assignmentBrowserIntent && isBrowserServiceReadyOnlyReply(assignmentReply)) {
      const recoveryPrompt = composeAgentDoctrinePrompt(
        assignment.agent,
        [
          `/new You are ${agentLabel} (${assignment.agent}).`,
          'Respond only as this specific agent.',
          'Do not answer for teammates.',
          'Read TEAM_SYNC.md first for active teammate ownership and status.',
          '',
          'Your assignment:',
          buildBrowserRecoveryInstruction(assignment.message),
        ].join('\n'),
        context.executionWorkspace,
        context.doctrineWorkspace,
      )

      const retrySessionId = randomUUID()
      const retry = await runOpenClawWithGeminiToolWritePolicy(
        assignment.agent,
        effectiveAssignmentMessage,
        context,
        withAgentRuntimeFlags([
          'agent',
          '--agent',
          assignment.agent,
          '--session-id',
          retrySessionId,
          '--message',
          recoveryPrompt,
          '--thinking',
          effectiveThinking,
          '--timeout',
          String(effectiveTimeoutSeconds),
          '--json',
        ]),
        agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds),
        { cwd: runCwdForContext(context), envOverrides, retry: false },
      ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))
      result = retry
      assignmentReply = extractAgentReply(retry.stdout, retry.stderr)
    }

    if (result.code === 0 && assignmentBrowserIntent && hasBrowserRelayPortConflict(result.stderr || '')) {
      const released = await tryReleaseBrowserRelayPort()
      if (released.released) {
        const portRecoveryPrompt = composeAgentDoctrinePrompt(
          assignment.agent,
          [
            `/new You are ${agentLabel} (${assignment.agent}).`,
            'Browser relay was recovered after a transient port conflict.',
            buildBrowserRecoveryInstruction(assignment.message),
          ].join('\n'),
          context.executionWorkspace,
          context.doctrineWorkspace,
        )
        const retrySessionId = randomUUID()
        const retry = await runOpenClawWithGeminiToolWritePolicy(
          assignment.agent,
          effectiveAssignmentMessage,
          context,
          withAgentRuntimeFlags([
            'agent',
            '--agent',
            assignment.agent,
            '--session-id',
            retrySessionId,
            '--message',
            portRecoveryPrompt,
            '--thinking',
            effectiveThinking,
            '--timeout',
            String(effectiveTimeoutSeconds),
            '--json',
          ]),
          agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds),
          { cwd: runCwdForContext(context), envOverrides, retry: false },
        ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))
        result = retry
        assignmentReply = extractAgentReply(retry.stdout, retry.stderr)
      }
    }

    if (result.code === 0 && assignmentBrowserIntent && hasBrowserRelayDisconnected(result.stderr || '')) {
      const gateway = await tryRestartGatewayService({ reason: 'party coordination browser relay recovery' })
      if (gateway.restarted) {
        const gatewayRecoveryPrompt = composeAgentDoctrinePrompt(
          assignment.agent,
          [
            `/new You are ${agentLabel} (${assignment.agent}).`,
            'Browser relay gateway was restarted after a transient disconnect.',
            buildBrowserRecoveryInstruction(assignment.message),
          ].join('\n'),
          context.executionWorkspace,
          context.doctrineWorkspace,
        )
        const retrySessionId = randomUUID()
        const retry = await runOpenClawWithGeminiToolWritePolicy(
          assignment.agent,
          effectiveAssignmentMessage,
          context,
          withAgentRuntimeFlags([
            'agent',
            '--agent',
            assignment.agent,
            '--session-id',
            retrySessionId,
            '--message',
            gatewayRecoveryPrompt,
            '--thinking',
            effectiveThinking,
            '--timeout',
            String(effectiveTimeoutSeconds),
            '--json',
          ]),
          agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds),
          { cwd: runCwdForContext(context), envOverrides, retry: false },
        ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))
        result = retry
        assignmentReply = extractAgentReply(retry.stdout, retry.stderr)
      }
    }

    await cleanupDoctrineMirrorsAfterRun(assignment.agent, context.executionWorkspace)
    const endedAt = new Date().toISOString()
    const durationMs = Date.now() - startMs
    const line = `${new Date().toISOString()} | ${assignment.agent} | ${result.code === 0 ? 'completed' : 'failed'} | ${trimTask(
      result.code === 0 ? trimTask(assignmentReply || 'finished assigned task step', 160) : result.stderr || result.stdout || 'unknown error',
      160,
    )}`
    activity.unshift(line)
    if (activity.length > 80) activity.length = 80
    if (state) {
      state.status = result.code === 0 ? 'completed' : 'failed'
      state.updatedAt = new Date().toISOString()
      state.note = result.code === 0 ? 'completed current step' : trimTask(result.stderr || result.stdout || 'failed', 90)
    }
    await appendAgentDailyMemory(
      assignment.agent,
      `[dispatch:${dispatchId}] ${result.code === 0 ? 'completed' : 'failed'}${
        filenameResolution.notes.length ? ` | resolved: ${trimTask(filenameResolution.notes.join('; '), 120)}` : ''
      } | ${trimTask(result.code === 0 ? assignmentReply || 'finished assigned task step' : result.stderr || result.stdout || 'unknown error', 200)}`,
    )
    return {
      agent: assignment.agent,
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      startedAt,
      endedAt,
      durationMs,
    }
  }

  const outputs: Array<Awaited<ReturnType<typeof runAssignment>>> = []
  if (parsed.data.mode === 'parallel') {
    const results = await Promise.all(parsed.data.assignments.map((assignment, index) => runAssignment(assignment, index)))
    outputs.push(...results)
  } else {
    for (const [index, assignment] of parsed.data.assignments.entries()) {
      outputs.push(await runAssignment(assignment, index))
    }
  }

  await writeTeamSyncSnapshot({
    missionId: dispatchId,
    title: 'Parallel Dispatch',
    mode: parsed.data.mode,
    status: outputs.every((item) => item.ok) ? 'completed' : 'completed_with_errors',
    assignments: assignmentsState,
    activity,
  })
  const spans = outputs.map((item) => ({ startedAt: item.startedAt, endedAt: item.endedAt }))
  const earliestStart = spans.length
    ? Math.min(...spans.map((span) => new Date(span.startedAt).getTime()))
    : Date.now()
  const latestEnd = spans.length
    ? Math.max(...spans.map((span) => new Date(span.endedAt).getTime()))
    : Date.now()
  const wallClockMs = Math.max(0, latestEnd - earliestStart)
  const summedDurationMs = outputs.reduce((sum, item) => sum + item.durationMs, 0)
  const peakConcurrency = computePeakConcurrency(spans)

  return apiSuccess(res, {
    ok: outputs.every((item) => item.ok),
    mode: parsed.data.mode,
    outputs,
    telemetry: {
      wallClockMs,
      summedDurationMs,
      peakConcurrency,
      parallelEfficiency: summedDurationMs > 0 ? Number((wallClockMs / summedDurationMs).toFixed(3)) : 1,
    },
  })
  } catch (error) {
    return apiFailure(res, 500, 'party_dispatch_failed', 'Party dispatch failed', String(error))
  }
})

app.post('/api/party/agent-to-agent', async (req, res) => {
  const schema = z.object({
    fromAgent: z.string().min(1),
    toAgent: z.string().min(1),
    instruction: z.string().min(1),
    thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    timeoutSeconds: z.number().int().min(30).max(7200).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

  try {
  const { fromAgent, toAgent, instruction, thinking, timeoutSeconds } = parsed.data
  if (!isValidAgentId(fromAgent) || !isValidAgentId(toAgent)) {
    return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id(s).')
  }
  if (isRetiredAgentId(fromAgent) || isRetiredAgentId(toAgent)) {
    return apiFailure(res, 400, 'invalid_payload', 'Retired agent id cannot be used for agent-to-agent routing.')
  }
  if (fromAgent === toAgent) {
    return apiFailure(res, 400, 'invalid_payload', 'fromAgent and toAgent must be different.')
  }

  const party = await getPartyMembers()
  const partyById = new Map(party.map((agent) => [agent.id, agent]))
  if (!partyById.has(fromAgent) || !partyById.has(toAgent)) {
    return apiFailure(res, 404, 'agent_not_found', 'Both fromAgent and toAgent must exist in party.', {
      fromAgent,
      toAgent,
    })
  }

  const policy = await getAgentToAgentPolicy().catch(() => ({ enabled: true, allow: [] as string[] }))
  if (!policy.enabled) {
    return apiFailure(res, 403, 'party_handoff_failed', 'Agent-to-agent routing is disabled by policy.')
  }
  if (!isAgentAllowedByPolicy(fromAgent, policy.allow) || !isAgentAllowedByPolicy(toAgent, policy.allow)) {
    return apiFailure(res, 403, 'party_handoff_failed', 'Agent-to-agent policy denies this route.', { allow: policy.allow })
  }

  const handoffId = randomUUID()
  const activity: string[] = []
  const assignmentsState: TeamSyncAssignment[] = [
    {
      agentId: fromAgent,
      task: `Draft execution directive for ${toAgent}: ${trimTask(instruction, 140)}`,
      status: 'running',
      updatedAt: new Date().toISOString(),
      note: 'preparing handoff directive',
    },
    {
      agentId: toAgent,
      task: `Execute directive from ${fromAgent}`,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    },
  ]

  await writeTeamSyncSnapshot({
    missionId: handoffId,
    title: `Agent Handoff: ${fromAgent} -> ${toAgent}`,
    mode: 'handoff',
    status: 'running',
    assignments: assignmentsState,
    activity,
  })

  const fromContext = await resolveAgentRunContext(fromAgent)
  const fromEnv = await getAgentAuthEnv(fromAgent)
  const fromEffectiveTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(fromAgent, timeoutSeconds)
  const fromPrompt = composeAgentDoctrinePrompt(
    fromAgent,
    [
      `You are handing off execution to teammate ${toAgent}.`,
      'Produce an actionable execution directive. Do not ask the user clarifying questions unless absolutely required.',
      'Return concise instructions with concrete file-level actions and done conditions.',
      'Output format:',
      'HANDOFF_DIRECTIVE',
      '- mission: <one line>',
      '- target files: <list>',
      '- steps: <numbered>',
      '- done when: <checklist>',
      '',
      'User request to fulfill:',
      instruction,
    ].join('\n'),
    fromContext.executionWorkspace,
    fromContext.doctrineWorkspace,
  )

  const fromSessionId = randomUUID()
  const fromResult = await runOpenClaw(
    withAgentRuntimeFlags([
      'agent',
      '--agent',
      fromAgent,
      '--session-id',
      fromSessionId,
      '--message',
      `/new ${fromPrompt}`,
      '--thinking',
      thinking,
      '--timeout',
      String(fromEffectiveTimeoutSeconds),
      '--json',
    ]),
    agentWorkTimeoutWrapperMs(fromEffectiveTimeoutSeconds),
    { cwd: fromContext.doctrineWorkspace, envOverrides: fromEnv },
  ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))

  const fromReply = extractAgentReply(fromResult.stdout, fromResult.stderr)
  assignmentsState[0] = {
    ...assignmentsState[0],
    status: fromResult.code === 0 ? 'completed' : 'failed',
    updatedAt: new Date().toISOString(),
    note: fromResult.code === 0 ? 'directive prepared' : trimTask(fromResult.stderr || fromResult.stdout || 'failed', 90),
  }
  activity.unshift(`${new Date().toISOString()} | ${fromAgent} | ${fromResult.code === 0 ? 'completed' : 'failed'} | handoff directive`)

  if (fromResult.code !== 0) {
    assignmentsState[1] = {
      ...assignmentsState[1],
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      note: 'upstream handoff failed',
    }
    await writeTeamSyncSnapshot({
      missionId: handoffId,
      title: `Agent Handoff: ${fromAgent} -> ${toAgent}`,
      mode: 'handoff',
      status: 'failed',
      assignments: assignmentsState,
      activity,
    })

    await appendAgentDailyMemory(fromAgent, `[handoff:${handoffId}] failed drafting directive for ${toAgent} | ${trimTask(fromReply, 180)}`)
    return apiSuccess(res, {
      ok: false,
      handoffId,
      from: {
        agent: fromAgent,
        ok: false,
        code: fromResult.code,
        reply: fromReply,
        stdout: fromResult.stdout,
        stderr: fromResult.stderr,
      },
      to: {
        agent: toAgent,
        ok: false,
        code: 1,
        reply: '',
        stdout: '',
        stderr: 'Upstream handoff directive failed.',
      },
    })
  }

  assignmentsState[1] = {
    ...assignmentsState[1],
    status: 'running',
    updatedAt: new Date().toISOString(),
    note: `executing directive from ${fromAgent}`,
  }

  const toContext = await resolveAgentRunContext(toAgent)
  const toEnv = await getAgentAuthEnv(toAgent)
  const toEffectiveTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(toAgent, timeoutSeconds)
  const toPrompt = composeAgentDoctrinePrompt(
    toAgent,
    [
      `You received a directive from teammate ${fromAgent}.`,
      'Execute it now in the execution workspace. Prefer concrete edits over planning-only output.',
      'At end, report exactly what changed and where.',
      '',
      'Directive:',
      fromReply,
      '',
      'Original user request:',
      instruction,
    ].join('\n'),
    toContext.executionWorkspace,
    toContext.doctrineWorkspace,
  )

  const toSessionId = randomUUID()
  const toResult = await runOpenClaw(
    withAgentRuntimeFlags([
      'agent',
      '--agent',
      toAgent,
      '--session-id',
      toSessionId,
      '--message',
      `/new ${toPrompt}`,
      '--thinking',
      thinking,
      '--timeout',
      String(toEffectiveTimeoutSeconds),
      '--json',
    ]),
    agentWorkTimeoutWrapperMs(toEffectiveTimeoutSeconds),
    { cwd: toContext.doctrineWorkspace, envOverrides: toEnv },
  ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))

  const toReply = extractAgentReply(toResult.stdout, toResult.stderr)
  assignmentsState[1] = {
    ...assignmentsState[1],
    status: toResult.code === 0 ? 'completed' : 'failed',
    updatedAt: new Date().toISOString(),
    note: toResult.code === 0 ? 'handoff executed' : trimTask(toResult.stderr || toResult.stdout || 'failed', 90),
  }
  activity.unshift(`${new Date().toISOString()} | ${toAgent} | ${toResult.code === 0 ? 'completed' : 'failed'} | handoff execution`)

  await writeTeamSyncSnapshot({
    missionId: handoffId,
    title: `Agent Handoff: ${fromAgent} -> ${toAgent}`,
    mode: 'handoff',
    status: toResult.code === 0 ? 'completed' : 'completed_with_errors',
    assignments: assignmentsState,
    activity,
  })

  await appendAgentDailyMemory(fromAgent, `[handoff:${handoffId}] directed ${toAgent} | ${trimTask(instruction, 160)}`)
  await appendAgentDailyMemory(
    toAgent,
    `[handoff:${handoffId}] received from ${fromAgent} | ${trimTask(toReply || toResult.stderr || toResult.stdout || 'no response', 180)}`,
  )

  return apiSuccess(res, {
    ok: toResult.code === 0,
    handoffId,
    from: {
      agent: fromAgent,
      ok: fromResult.code === 0,
      code: fromResult.code,
      reply: fromReply,
      stdout: fromResult.stdout,
      stderr: fromResult.stderr,
    },
    to: {
      agent: toAgent,
      ok: toResult.code === 0,
      code: toResult.code,
      reply: toReply,
      stdout: toResult.stdout,
      stderr: toResult.stderr,
    },
  })
  } catch (error) {
    return apiFailure(res, 500, 'party_handoff_failed', 'Agent-to-agent handoff failed', String(error))
  }
})

app.post('/api/party/parallel-health', async (req, res) => {
  const schema = z.object({
    agents: z.array(z.string().min(1)).min(2).max(8).optional(),
    timeoutSeconds: z.number().int().min(30).max(7200).optional(),
    thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('off'),
    prompt: z.string().min(1).max(500).default('Parallel health check: reply HEALTH_OK only.'),
  })
  const parsed = schema.safeParse(req.body ?? {})
  if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

  try {
    const party = await getPartyMembers()
    const pool = (parsed.data.agents?.length ? parsed.data.agents : party.slice(0, 3).map((entry) => entry.id)).filter(Boolean)
    if (pool.length < 2) return apiFailure(res, 400, 'party_coordination_failed', 'Need at least 2 agents for parallel health check.')

    const runOne = async (agentId: string) => {
      const startedAt = new Date().toISOString()
      const startMs = Date.now()
      const sessionId = randomUUID()
      const context = await resolveAgentRunContext(agentId)
      const envOverrides = await getAgentAuthEnv(agentId)
      const effectiveTimeoutSeconds = await resolveEffectiveAgentWorkTimeoutSeconds(agentId, parsed.data.timeoutSeconds)
      const result = await runOpenClaw(
        withAgentRuntimeFlags([
          'agent',
          '--agent',
          agentId,
          '--session-id',
          sessionId,
          '--message',
          composeAgentDoctrinePrompt(agentId, `Read TEAM_SYNC.md first. ${parsed.data.prompt}`, context.executionWorkspace, context.doctrineWorkspace),
          '--thinking',
          parsed.data.thinking,
          '--timeout',
          String(effectiveTimeoutSeconds),
          '--json',
        ]),
        agentWorkTimeoutWrapperMs(effectiveTimeoutSeconds),
        { cwd: runCwdForContext(context), envOverrides },
      ).catch((error) => ({ stdout: '', stderr: String(error), code: 1 }))
      await cleanupDoctrineMirrorsAfterRun(agentId, context.executionWorkspace)
      const endedAt = new Date().toISOString()
      const durationMs = Date.now() - startMs
      return {
        agent: agentId,
        ok: result.code === 0,
        code: result.code,
        reply: extractAgentReply(result.stdout, result.stderr),
        startedAt,
        endedAt,
        durationMs,
      }
    }

    const outputs = await Promise.all(pool.map((agentId) => runOne(agentId)))
    const spans = outputs.map((item) => ({ startedAt: item.startedAt, endedAt: item.endedAt }))
    const earliestStart = Math.min(...spans.map((span) => new Date(span.startedAt).getTime()))
    const latestEnd = Math.max(...spans.map((span) => new Date(span.endedAt).getTime()))
    const wallClockMs = Math.max(0, latestEnd - earliestStart)
    const summedDurationMs = outputs.reduce((sum, item) => sum + item.durationMs, 0)
    const peakConcurrency = computePeakConcurrency(spans)
    const looksParallel = peakConcurrency >= 2 && wallClockMs < summedDurationMs * 0.9

    return apiSuccess(res, {
      ok: outputs.every((item) => item.ok),
      looksParallel,
      outputs,
      telemetry: {
        wallClockMs,
        summedDurationMs,
        peakConcurrency,
        parallelEfficiency: summedDurationMs > 0 ? Number((wallClockMs / summedDurationMs).toFixed(3)) : 1,
      },
      guidance: looksParallel
        ? 'Parallel execution confirmed from server-side process timing.'
        : 'Execution appears staggered. Check runtime queueing, agent availability, or reduce parallel load.',
    })
  } catch (error) {
    return apiFailure(res, 500, 'party_coordination_failed', 'Parallel health check failed', String(error))
  }
})

app.post('/api/team-sync/append', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    role: z.string().min(1).max(40).optional(),
    runId: z.string().min(1).max(120).optional(),
    note: z.string().min(1).max(50000).optional(),
    line: z.string().min(1).max(50000).optional(),
    filePath: z.string().min(1).max(500).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

  const { agentId, role, runId, note, line, filePath } = parsed.data
  if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id')

  try {
    const requestedPath = filePath?.trim() ? path.resolve(filePath.trim()) : undefined
    if (CANONICAL_DOCTRINE_ONLY && requestedPath) {
      const normalizedRequestedPath = requestedPath.replace(/\\/g, '/').toLowerCase()
      const scopedTeamSyncSuffix = `/.openclaw/agents/${agentId.toLowerCase()}/team_sync.md`
      if (path.basename(requestedPath).toLowerCase() === 'team_sync.md' && !normalizedRequestedPath.endsWith(scopedTeamSyncSuffix)) {
        return apiFailure(res, 400, 'team_sync_failed', 'Workspace-root TEAM_SYNC.md is disabled; use the scoped doctrine path.')
      }
    }

    const context = await resolveAgentRunContext(agentId)
    const executionWorkspace = context.executionWorkspace
    const sharedTeamSyncPath = await resolveSharedTeamSyncPath(agentId)
    const targetPath = requestedPath || sharedTeamSyncPath

    if (!isPathUnder(executionWorkspace, targetPath) && !samePath(targetPath, sharedTeamSyncPath)) {
      return apiFailure(res, 400, 'team_sync_failed', 'TEAM_SYNC path must be inside execution workspace', {
        executionWorkspace,
        targetPath,
      })
    }

    if (
      CANONICAL_DOCTRINE_ONLY &&
      samePath(targetPath, path.join(executionWorkspace, 'TEAM_SYNC.md')) &&
      !samePath(targetPath, sharedTeamSyncPath)
    ) {
      return apiFailure(res, 400, 'team_sync_failed', 'Workspace-root TEAM_SYNC.md is disabled; use the scoped doctrine path.')
    }

    if (path.basename(targetPath).toLowerCase() !== 'team_sync.md') {
      return apiFailure(res, 400, 'team_sync_failed', 'Only TEAM_SYNC.md is allowed for this endpoint')
    }

    await ensureTeamSyncFile(targetPath)

    const timestamp = new Date().toISOString()
    const normalizedRole = (role || 'agent').trim()
    const normalizedRunId = (runId || '').trim()
    const appendLines = line?.trim()
      ? splitTextForAppend(line, 4000)
      : splitTextForAppend(note || '', 1800).map((chunk, index, chunks) => [
          timestamp,
          normalizedRole,
          agentId,
          normalizedRunId ? `run=${normalizedRunId}` : '',
          chunks.length > 1 ? `part ${index + 1}/${chunks.length}: ${chunk}` : chunk,
        ]
          .filter(Boolean)
          .join(' | '))

    if (!appendLines.length) return apiFailure(res, 400, 'invalid_payload', 'note or line is required')

    await fs.appendFile(targetPath, `${appendLines.join('\n')}\n`, 'utf-8')

    return apiSuccess(res, {
      ok: true,
      path: targetPath,
      line: appendLines[0],
      lines: appendLines,
      split: appendLines.length,
      agentId,
      runId: normalizedRunId || undefined,
    })
  } catch (error) {
    return apiFailure(res, 500, 'team_sync_failed', 'Failed to append TEAM_SYNC', String(error))
  }
})

}
