import assert from 'node:assert/strict'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import {
  registerPartyCoordinationRoutes,
  type PartyCoordinationRoutesOptions,
} from '../server/routes/partyCoordinationRoutes'

type TeamSyncSnapshotRecord = Parameters<PartyCoordinationRoutesOptions['writeTeamSyncSnapshot']>[0]

async function withPartyServer<T>(
  overrides: Partial<PartyCoordinationRoutesOptions>,
  run: (baseUrl: string, snapshots: TeamSyncSnapshotRecord[], openClawCalls: string[][]) => Promise<T>,
): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automnia-party-routes-'))
  const snapshots: TeamSyncSnapshotRecord[] = []
  const openClawCalls: string[][] = []

  const app = express()
  app.use(express.json())

  const defaultOptions: PartyCoordinationRoutesOptions = {
    CANONICAL_DOCTRINE_ONLY: true,
    ENABLE_HOST_ACTION_SHORTCUTS: false,
    agentWorkTimeoutWrapperMs: (timeoutSeconds) => timeoutSeconds * 1000,
    appendAgentDailyMemory: async () => undefined,
    appendAgentPromptDump: async () => undefined,
    buildBrowserRecoveryInstruction: (task) => task,
    buildDispatchExecutionDirective: (member) => `Role: ${member.role || member.id}`,
    buildWebsiteContributionDirective: () => '',
    checkBrowserPreflight: async () => ({ ok: true, reason: 'ok', message: 'ready' }),
    cleanupDoctrineMirrorsAfterRun: async () => undefined,
    composeAgentDoctrinePrompt: (_agentId, message) => message,
    computePeakConcurrency: (spans) => spans.length,
    detectHostActionRequest: () => null,
    ensureTeamSyncFile: async (filePath) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      try {
        await fs.access(filePath)
      } catch {
        await fs.writeFile(filePath, '# TEAM_SYNC.md\n', 'utf8')
      }
    },
    extractAgentReply: (stdout) => stdout.trim(),
    getAgentAuthEnv: async () => undefined,
    getAgentToAgentPolicy: async () => ({
      enabled: true,
      allow: ['hn-architect', 'engineering-senior-developer', 'hn-coordinator'],
    }),
    getPartyMembers: async () => [
      { id: 'hn-architect', name: 'Elena Vasquez', role: 'Chief Software Architect' },
      { id: 'engineering-senior-developer', name: 'Marcus Vance', role: 'Senior Developer' },
      { id: 'hn-coordinator', name: 'Sarah Cooper', role: 'Scope Commander' },
    ],
    hasBrowserRelayDisconnected: () => false,
    hasBrowserRelayPortConflict: () => false,
    isAgentAllowedByPolicy: (agentId, allow) => allow.length === 0 || allow.includes(agentId),
    isBrowserServiceReadyOnlyReply: () => false,
    isPathUnder: (baseDir, targetPath) => {
      const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath))
      return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
    },
    isRetiredAgentId: (agentId) => agentId === 'retired-agent',
    isSharedWebsiteCollaboration: () => false,
    isValidAgentId: (agentId) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId),
    launchChromeHost: async () => ({ ok: true, detail: 'ok', command: 'chrome' }),
    resolveAgentRunContext: async (agentId) => ({
      executionWorkspace: workspaceDir,
      doctrineWorkspace: path.join(workspaceDir, '.openclaw', 'agents', agentId),
    }),
    resolveEffectiveAgentWorkTimeoutSeconds: async (_agentId, requested) =>
      typeof requested === 'number' ? requested : 60,
    resolveFilenameHintsForMessage: async (message) => ({ message, notes: [] }),
    resolveSharedTeamSyncPath: async (agentId = 'hn-coordinator') =>
      path.join(workspaceDir, '.openclaw', 'agents', agentId, 'TEAM_SYNC.md'),
    runCwdForContext: (context) => context.executionWorkspace || workspaceDir,
    runOpenClaw: async (args) => {
      openClawCalls.push(args)
      return { stdout: 'OK', stderr: '', code: 0 }
    },
    runOpenClawWithGeminiToolWritePolicy: async (_agentId, _message, _context, args) => {
      openClawCalls.push(args)
      return { stdout: 'STEP_DONE', stderr: '', code: 0 }
    },
    samePath: (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(),
    shouldRouteBrowserIntentThroughBrowserPlugin: async () => false,
    splitTextForAppend: (value, maxChars) => {
      const trimmed = value.trim()
      if (!trimmed) return []
      return [trimmed.slice(0, maxChars)]
    },
    trimTask: (value, max = 160) => value.trim().slice(0, max),
    tryReleaseBrowserRelayPort: async () => ({ released: false, detail: 'none' }),
    tryRestartGatewayService: async () => ({ restarted: false, detail: 'none' }),
    withAgentRuntimeFlags: (args) => args,
    writeTeamSyncSnapshot: async (snapshot) => {
      snapshots.push({
        ...snapshot,
        assignments: snapshot.assignments.map((entry) => ({ ...entry })),
        activity: [...snapshot.activity],
      })
    },
    ...overrides,
  }

  registerPartyCoordinationRoutes(app, defaultOptions)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    return await run(baseUrl, snapshots, openClawCalls)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await fs.rm(workspaceDir, { recursive: true, force: true })
  }
}

test('parallel dispatch rejects duplicate concurrent runs of the same agent while sequential mode tracks each step by index', async () => {
  await withPartyServer({}, async (baseUrl, snapshots, openClawCalls) => {
    const duplicateParallel = await fetch(`${baseUrl}/api/party/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'parallel',
        assignments: [
          { agent: 'hn-architect', message: 'Audit service layer' },
          { agent: 'hn-architect', message: 'Audit route layer' },
        ],
      }),
    })
    assert.equal(duplicateParallel.status, 400)
    const duplicatePayload = await duplicateParallel.json()
    assert.equal(duplicatePayload.ok, false)
    assert.equal(duplicatePayload.error.code, 'invalid_payload')
    assert.deepEqual(duplicatePayload.error.detail.agents, ['hn-architect'])
    assert.equal(openClawCalls.length, 0)

    const sequentialRepeat = await fetch(`${baseUrl}/api/party/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sequential',
        assignments: [
          { agent: 'engineering-senior-developer', message: 'Implement route fix' },
          { agent: 'engineering-senior-developer', message: 'Run unit tests' },
        ],
      }),
    })
    assert.equal(sequentialRepeat.status, 200)
    const sequentialPayload = await sequentialRepeat.json()
    assert.equal(sequentialPayload.ok, true)
    assert.equal(sequentialPayload.data.ok, true)
    assert.equal(openClawCalls.length, 2)

    assert.equal(snapshots[0]?.title, 'Sequential Dispatch')
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.assignments.map((entry) => entry.status)),
      [
        ['queued', 'queued'],
        ['running', 'queued'],
        ['completed', 'queued'],
        ['completed', 'running'],
        ['completed', 'completed'],
      ],
    )
    const finalSnapshot = snapshots.at(-1)
    assert.ok(finalSnapshot)
    assert.equal(finalSnapshot.status, 'completed')
  })
})

test('parallel dispatch isolates unexpected runtime rejections, cleans up doctrine mirrors, and preserves surviving parallel work', async () => {
  const cleanedMirrors: string[] = []
  await withPartyServer(
    {
      cleanupDoctrineMirrorsAfterRun: async (agentId) => {
        cleanedMirrors.push(agentId)
      },
      runOpenClawWithGeminiToolWritePolicy: async (agentId) => {
        if (agentId === 'hn-architect') {
          throw new Error('simulated transient spawn failure')
        }
        return { stdout: 'Independent verification complete.', stderr: '', code: 0 }
      },
    },
    async (baseUrl, snapshots) => {
      const response = await fetch(`${baseUrl}/api/party/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'parallel',
          assignments: [
            { agent: 'hn-architect', message: 'Audit recovery state' },
            { agent: 'hn-coordinator', message: 'Run coordination smoke suite' },
          ],
        }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.data.ok, false)
      assert.equal(payload.data.outputs.length, 2)
      assert.equal(payload.data.outputs[0].agent, 'hn-architect')
      assert.equal(payload.data.outputs[0].ok, false)
      assert.match(payload.data.outputs[0].stderr, /simulated transient spawn failure/)
      assert.equal(payload.data.outputs[1].agent, 'hn-coordinator')
      assert.equal(payload.data.outputs[1].ok, true)

      assert.deepEqual(new Set(cleanedMirrors), new Set(['hn-architect', 'hn-coordinator']))
      assert.deepEqual(
        snapshots[0]?.assignments.map((entry) => entry.status),
        ['running', 'running'],
      )
      const finalSnapshot = snapshots.at(-1)
      assert.ok(finalSnapshot)
      assert.equal(finalSnapshot.status, 'completed_with_errors')
      assert.deepEqual(
        finalSnapshot.assignments.map((entry) => entry.status),
        ['failed', 'completed'],
      )
    },
  )
})

test('agent-to-agent handoff publishes mid-handoff TEAM_SYNC running state before downstream agent executes', async () => {
  let callIndex = 0
  let midRunAssignmentStatuses: string[] = []

  await withPartyServer(
    {
      runOpenClaw: async () => {
        callIndex += 1
        if (callIndex === 1) {
          return { stdout: 'HANDOFF_DIRECTIVE\n- mission: patch validation', stderr: '', code: 0 }
        }
        return { stdout: 'Implemented and verified patch.', stderr: '', code: 0 }
      },
    },
    async (baseUrl, snapshots) => {
      const response = await fetch(`${baseUrl}/api/party/agent-to-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgent: 'hn-architect',
          toAgent: 'engineering-senior-developer',
          instruction: 'Harden parallel-health validation',
        }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.data.ok, true)

      assert.equal(snapshots.length, 3)
      assert.deepEqual(
        snapshots[0].assignments.map((entry) => entry.status),
        ['running', 'queued'],
      )
      midRunAssignmentStatuses = snapshots[1].assignments.map((entry) => entry.status)
      assert.deepEqual(midRunAssignmentStatuses, ['completed', 'running'])
      assert.match(snapshots[1].assignments[1].note || '', /executing directive from hn-architect/)
      assert.deepEqual(
        snapshots[2].assignments.map((entry) => entry.status),
        ['completed', 'completed'],
      )
    },
  )

  assert.deepEqual(midRunAssignmentStatuses, ['completed', 'running'])
})

test('parallel-health rejects CLI-flag injection, retired agents, duplicates, and non-party agents before execution', async () => {
  await withPartyServer({}, async (baseUrl, _snapshots, openClawCalls) => {
    const flagInjection = await fetch(`${baseUrl}/api/party/parallel-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['--help', 'hn-architect'] }),
    })
    assert.equal(flagInjection.status, 400)
    assert.equal((await flagInjection.json()).error.code, 'invalid_payload')

    const retired = await fetch(`${baseUrl}/api/party/parallel-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['retired-agent', 'hn-architect'] }),
    })
    assert.equal(retired.status, 400)
    assert.equal((await retired.json()).error.code, 'invalid_payload')

    const duplicate = await fetch(`${baseUrl}/api/party/parallel-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['hn-architect', 'hn-architect'] }),
    })
    assert.equal(duplicate.status, 400)
    const duplicateBody = await duplicate.json()
    assert.equal(duplicateBody.error.code, 'invalid_payload')
    assert.deepEqual(duplicateBody.error.detail.agents, ['hn-architect'])

    const missing = await fetch(`${baseUrl}/api/party/parallel-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['hn-architect', 'ghost-agent'] }),
    })
    assert.equal(missing.status, 404)
    const missingBody = await missing.json()
    assert.equal(missingBody.error.code, 'agent_not_found')
    assert.deepEqual(missingBody.error.detail.agents, ['ghost-agent'])
    assert.equal(openClawCalls.length, 0)

    const valid = await fetch(`${baseUrl}/api/party/parallel-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['hn-architect', 'hn-coordinator'] }),
    })
    assert.equal(valid.status, 200)
    const validBody = await valid.json()
    assert.equal(validBody.ok, true)
    assert.equal(validBody.data.ok, true)
    assert.equal(openClawCalls.length, 2)
  })
})

test('agent-to-agent handoff survives daily memory write errors and settles TEAM_SYNC if downstream context setup fails', async () => {
  await withPartyServer(
    {
      appendAgentDailyMemory: async () => {
        throw new Error('disk quota exceeded on daily memory')
      },
      runOpenClaw: async () => ({ stdout: 'Completed handoff work.', stderr: '', code: 0 }),
    },
    async (baseUrl, snapshots) => {
      const okResponse = await fetch(`${baseUrl}/api/party/agent-to-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgent: 'hn-architect',
          toAgent: 'hn-coordinator',
          instruction: 'Verify handoff resilience',
        }),
      })
      assert.equal(okResponse.status, 200)
      const okBody = await okResponse.json()
      assert.equal(okBody.ok, true)
      assert.equal(okBody.data.ok, true)
      assert.equal(snapshots.at(-1)?.status, 'completed')
    },
  )

  await withPartyServer(
    {
      resolveAgentRunContext: async (agentId) => {
        if (agentId === 'engineering-senior-developer') {
          throw new Error('downstream workspace unavailable')
        }
        return {
          executionWorkspace: os.tmpdir(),
          doctrineWorkspace: path.join(os.tmpdir(), '.openclaw', 'agents', agentId),
        }
      },
    },
    async (baseUrl, snapshots) => {
      const failedDownstream = await fetch(`${baseUrl}/api/party/agent-to-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgent: 'hn-architect',
          toAgent: 'engineering-senior-developer',
          instruction: 'Execute downstream step',
        }),
      })
      assert.equal(failedDownstream.status, 200)
      const body = await failedDownstream.json()
      assert.equal(body.ok, true)
      assert.equal(body.data.ok, false)
      assert.equal(body.data.from.ok, true)
      assert.equal(body.data.to.ok, false)
      assert.match(body.data.to.stderr, /downstream workspace unavailable/)
      const finalSnapshot = snapshots.at(-1)
      assert.ok(finalSnapshot)
      assert.equal(finalSnapshot.status, 'completed_with_errors')
      assert.deepEqual(
        finalSnapshot.assignments.map((entry) => entry.status),
        ['completed', 'failed'],
      )
    },
  )
})

test('team-sync append rejects retired and non-party agents while allowing active party agents to append scoped entries', async () => {
  await withPartyServer({}, async (baseUrl) => {
    const retired = await fetch(`${baseUrl}/api/team-sync/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'retired-agent', role: 'worker', note: 'stale write' }),
    })
    assert.equal(retired.status, 400)
    assert.equal((await retired.json()).error.code, 'invalid_payload')

    const nonParty = await fetch(`${baseUrl}/api/team-sync/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'ghost-agent', role: 'worker', note: 'unregistered write' }),
    })
    assert.equal(nonParty.status, 404)
    const nonPartyBody = await nonParty.json()
    assert.equal(nonPartyBody.error.code, 'agent_not_found')
    assert.equal(nonPartyBody.error.detail.agentId, 'ghost-agent')

    const active = await fetch(`${baseUrl}/api/team-sync/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: '  hn-coordinator  ',
        role: 'Operations Lead',
        runId: 'run-t016',
        note: 'Verified T-010..T-013 and hardened party coordination routes.',
      }),
    })
    assert.equal(active.status, 200)
    const activeBody = await active.json()
    assert.equal(activeBody.ok, true)
    assert.equal(activeBody.data.ok, true)
    assert.equal(activeBody.data.agentId, 'hn-coordinator')
    assert.match(activeBody.data.line, /run=run-t016/)

    const blankDispatch = await fetch(`${baseUrl}/api/party/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'parallel',
        assignments: [{ agent: 'hn-coordinator', message: '   ' }],
      }),
    })
    assert.equal(blankDispatch.status, 400)
    assert.equal((await blankDispatch.json()).error.code, 'invalid_payload')
  })
})
