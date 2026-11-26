import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  assertRegularDestinationFile,
  replaceFileAtomicallyWithLockRetry,
  withSerializedFileLock,
} from '../filesystem/atomicControlFile'
import type { TeamSyncAssignment } from './missionStateService'

export type TeamSyncSnapshotParams = {
  missionId: string
  title: string
  mode: string
  status: string
  assignments: TeamSyncAssignment[]
  activity: string[]
}

export type MissionTeamSyncServiceOptions = {
  canonicalDoctrineOnly: boolean
  workspaceRoot: string
  canonicalDoctrineRoot: (agentId: string) => string
  defaultAgentWorkspace: (agentId: string) => string
  fileExists: (filePath: string) => Promise<boolean>
  resolveAgentWorkspace: (agentId: string) => Promise<string | undefined>
  resolveAgentWorkspaces: (agentIds: string[]) => Promise<Map<string, string>>
  resolveDoctrineWorkspaceForRun: (agentId: string, executionWorkspace: string, canonicalFolder?: string) => string
  resolveSharedTeamSyncPath: (agentId?: string) => Promise<string>
  trimTask: (value: string, max?: number) => string
  now?: () => Date
}

export function createMissionTeamSyncService(options: MissionTeamSyncServiceOptions) {
  const now = () => options.now?.() || new Date()
  let snapshotQueue: Promise<void> = Promise.resolve()

  async function ensureTeamSyncFileUnlocked(destination: string) {
    const existing = await assertRegularDestinationFile(destination, 'TEAM_SYNC.md')
    if (existing) return
    await fs.mkdir(path.dirname(destination), { recursive: true })
    try {
      const handle = await fs.open(destination, 'wx', 0o600)
      try {
        await handle.writeFile('# TEAM_SYNC\n\n## Activity Log\n', 'utf-8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
      await assertRegularDestinationFile(destination, 'TEAM_SYNC.md')
    }
  }

  async function ensureTeamSyncFile(filePath: string) {
    const destination = path.resolve(filePath)
    await withSerializedFileLock(destination, () => ensureTeamSyncFileUnlocked(destination))
  }

  function teamSyncMarkdown(params: TeamSyncSnapshotParams) {
    const rows = params.assignments
      .map(
        (entry) =>
          `- ${entry.agentId} | ${entry.status} | ${options.trimTask(entry.task, 120)} | updated ${entry.updatedAt}${entry.note ? ` | ${options.trimTask(entry.note, 120)}` : ''}`,
      )
      .join('\n')
    const recentActivity = params.activity.slice(0, 80)
    const activity = recentActivity.length ? recentActivity.map((line) => `- ${line}`).join('\n') : '- no activity yet'
    return [
      '# TEAM_SYNC.md',
      '',
      'Shared agent coordination ledger. This file is mirrored to active agent workspaces.',
      '',
      `Updated: ${now().toISOString()}`,
      `Mission ID: ${params.missionId}`,
      `Title: ${params.title}`,
      `Mode: ${params.mode}`,
      `Status: ${params.status}`,
      '',
      '## Active Assignments',
      rows || '- none',
      '',
      '## Activity Log',
      activity,
      '',
      '## Coordination Rules',
      '- Read this file before starting any new task slice.',
      '- Do not edit files owned by another active agent unless reassigned here.',
      '- Record conflicts/blockers immediately in this log.',
      '',
    ].join('\n')
  }

  async function snapshotTargetPaths(params: TeamSyncSnapshotParams) {
    const agentIds = Array.from(new Set(params.assignments.map((entry) => entry.agentId).filter(Boolean)))
    const targets = new Set<string>()

    if (options.canonicalDoctrineOnly) {
      for (const agentId of agentIds) {
        const workspace = (await options.resolveAgentWorkspace(agentId)) || options.defaultAgentWorkspace(agentId)
        targets.add(path.join(
          options.resolveDoctrineWorkspaceForRun(agentId, workspace, options.canonicalDoctrineRoot(agentId)),
          'TEAM_SYNC.md',
        ))
      }
      if (agentIds[0]) {
        targets.add(await options.resolveSharedTeamSyncPath(agentIds[0]))
      }
    } else {
      const workspaces = await options.resolveAgentWorkspaces(agentIds)
      targets.add(path.join(options.workspaceRoot, 'TEAM_SYNC.md'))
      for (const workspace of workspaces.values()) {
        targets.add(path.join(workspace, 'TEAM_SYNC.md'))
      }
    }

    return Array.from(targets)
  }

  async function writeTeamSyncSnapshot(params: TeamSyncSnapshotParams) {
    const markdown = teamSyncMarkdown(params)
    const snapshot = { ...params, assignments: params.assignments.map((entry) => ({ ...entry })), activity: [...params.activity] }
    // Queue before resolving paths: a slow older lookup must not publish after
    // a newer generation, including when missions share coordination targets.
    const pending = snapshotQueue.then(async () => {
      const targets = await snapshotTargetPaths(snapshot)
      const results = await Promise.allSettled(targets.map((filePath) => {
        const destination = path.resolve(filePath)
        return withSerializedFileLock(destination, async () => {
          await fs.mkdir(path.dirname(destination), { recursive: true })
          const existing = await assertRegularDestinationFile(destination, 'TEAM_SYNC.md')
          const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`)
          try {
            const handle = await fs.open(temporary, 'wx', existing ? existing.mode & 0o777 : 0o600)
            try {
              await handle.writeFile(markdown, 'utf-8')
              await handle.sync()
            } finally {
              await handle.close()
            }
            await assertRegularDestinationFile(destination, 'TEAM_SYNC.md')
            await replaceFileAtomicallyWithLockRetry(temporary, destination)
          } finally {
            await fs.unlink(temporary).catch(() => undefined)
          }
        })
      }))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    snapshotQueue = pending.catch(() => undefined)
    return pending
  }

  return {
    ensureTeamSyncFile,
    snapshotTargetPaths,
    teamSyncMarkdown,
    writeTeamSyncSnapshot,
  }
}

export type MissionTeamSyncService = ReturnType<typeof createMissionTeamSyncService>
