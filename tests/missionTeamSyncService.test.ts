import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createMissionTeamSyncService,
  type MissionTeamSyncServiceOptions,
} from '../server/services/missions/missionTeamSyncService'
import type { TeamSyncAssignment } from '../server/services/missions/missionStateService'

function makeAssignments(): TeamSyncAssignment[] {
  return [{
    agentId: 'agent-a',
    task: 'Implement the Team Sync service extraction with enough detail to prove truncation behavior is owned by the service.',
    status: 'running',
    updatedAt: '2026-06-30T12:00:00.000Z',
    note: 'service boundary test note that should be trimmed in markdown output',
  }, {
    agentId: 'agent-b',
    task: 'Verify snapshot mirroring.',
    status: 'queued',
    updatedAt: '2026-06-30T12:00:05.000Z',
  }]
}

async function createHarness(overrides: Partial<MissionTeamSyncServiceOptions> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-team-sync-'))
  const workspaces = new Map<string, string>([
    ['agent-a', path.join(root, 'workspaces', 'agent-a')],
    ['agent-b', path.join(root, 'workspaces', 'agent-b')],
  ])
  const sharedPaths: string[] = []
  const service = createMissionTeamSyncService({
    canonicalDoctrineOnly: true,
    workspaceRoot: path.join(root, 'workspace-root'),
    canonicalDoctrineRoot: (agentId) => path.join(root, 'canonical', agentId),
    defaultAgentWorkspace: (agentId) => path.join(root, 'default-workspaces', agentId),
    fileExists: async (filePath) => {
      try {
        await readFile(filePath)
        return true
      } catch {
        return false
      }
    },
    resolveAgentWorkspace: async (agentId) => workspaces.get(agentId),
    resolveAgentWorkspaces: async (agentIds) => new Map(agentIds.map((agentId) => [
      agentId,
      workspaces.get(agentId) || path.join(root, 'fallback-workspaces', agentId),
    ])),
    resolveDoctrineWorkspaceForRun: (agentId, executionWorkspace) => path.join(executionWorkspace, '.openclaw', 'agents', agentId),
    resolveSharedTeamSyncPath: async (agentId) => {
      const filePath = path.join(root, 'shared', agentId || 'default', 'TEAM_SYNC.md')
      sharedPaths.push(filePath)
      return filePath
    },
    trimTask: (value, max = 180) => value.replace(/\s+/g, ' ').trim().slice(0, max),
    now: () => new Date('2026-06-30T12:10:00.000Z'),
    ...overrides,
  })

  return { root, service, sharedPaths, workspaces }
}

test('teamSyncMarkdown renders snapshot metadata, assignments, and capped activity', async () => {
  const { root, service } = await createHarness()
  try {
    const activity = Array.from({ length: 82 }, (_, index) => `activity-${index + 1}`)

    const markdown = service.teamSyncMarkdown({
      missionId: 'mission-team-sync',
      title: 'Team Sync Extraction',
      mode: 'instant',
      status: 'running',
      assignments: makeAssignments(),
      activity,
    })

    assert.match(markdown, /Updated: 2026-06-30T12:10:00.000Z/)
    assert.match(markdown, /Mission ID: mission-team-sync/)
    assert.match(markdown, /agent-a \| running \| Implement the Team Sync service extraction/)
    assert.match(markdown, /agent-b \| queued \| Verify snapshot mirroring\./)
    assert.match(markdown, /## Activity Log/)
    assert.match(markdown, /activity-80/)
    assert.doesNotMatch(markdown, /activity-81/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ensureTeamSyncFile repairs missing files without overwriting existing append logs', async () => {
  const { root, service } = await createHarness()
  try {
    const filePath = path.join(root, 'agent', 'TEAM_SYNC.md')

    await service.ensureTeamSyncFile(filePath)
    assert.equal(await readFile(filePath, 'utf8'), '# TEAM_SYNC\n\n## Activity Log\n')

    await writeFile(filePath, '# TEAM_SYNC.md\n\nexisting append-only entry\n', 'utf8')
    await service.ensureTeamSyncFile(filePath)
    assert.equal(await readFile(filePath, 'utf8'), '# TEAM_SYNC.md\n\nexisting append-only entry\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeTeamSyncSnapshot mirrors canonical doctrine snapshots and shared path', async () => {
  const { root, service, sharedPaths, workspaces } = await createHarness()
  try {
    await service.writeTeamSyncSnapshot({
      missionId: 'mission-canonical',
      title: 'Canonical Team Sync',
      mode: 'hours',
      status: 'active',
      assignments: makeAssignments(),
      activity: ['2026-06-30T12:00:00.000Z | scheduler | started'],
    })

    const agentAPath = path.join(workspaces.get('agent-a') || '', '.openclaw', 'agents', 'agent-a', 'TEAM_SYNC.md')
    const agentBPath = path.join(workspaces.get('agent-b') || '', '.openclaw', 'agents', 'agent-b', 'TEAM_SYNC.md')
    const sharedPath = sharedPaths[0]
    assert.ok(sharedPath)
    for (const filePath of [agentAPath, agentBPath, sharedPath]) {
      const content = await readFile(filePath, 'utf8')
      assert.match(content, /Title: Canonical Team Sync/)
      assert.match(content, /Shared agent coordination ledger/)
    }
    assert.deepEqual(sharedPaths.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeTeamSyncSnapshot mirrors legacy workspace-root snapshots when canonical doctrine is disabled', async () => {
  const { root, service, sharedPaths, workspaces } = await createHarness({ canonicalDoctrineOnly: false })
  try {
    await service.writeTeamSyncSnapshot({
      missionId: 'mission-legacy',
      title: 'Legacy Team Sync',
      mode: 'parallel',
      status: 'completed_with_errors',
      assignments: makeAssignments(),
      activity: [],
    })

    const rootPath = path.join(root, 'workspace-root', 'TEAM_SYNC.md')
    const agentAPath = path.join(workspaces.get('agent-a') || '', 'TEAM_SYNC.md')
    const agentBPath = path.join(workspaces.get('agent-b') || '', 'TEAM_SYNC.md')
    for (const filePath of [rootPath, agentAPath, agentBPath]) {
      const content = await readFile(filePath, 'utf8')
      assert.match(content, /Mission ID: mission-legacy/)
      assert.match(content, /Status: completed_with_errors/)
    }
    assert.deepEqual(sharedPaths, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
