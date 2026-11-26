import { randomUUID } from 'node:crypto'

export type WorkboardTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export type WorkboardEvidence = { label: string; uri: string }

export type WorkboardServiceErrorCode =
  | 'invalid_payload'
  | 'workboard_failed'
  | 'workboard_persistence_failed'
  | 'workboard_task_not_found'
  | 'workboard_cycle'
  | 'workboard_dependency_not_found'
  | 'workboard_prerequisites_open'
  | 'workboard_task_terminal'
  | 'workboard_capacity'
  | 'workboard_comment_capacity'
  | 'workboard_lease_conflict'
  | 'workboard_file_lock_conflict'

export const DEFAULT_WORKBOARD_LEASE_TTL_MS = 60 * 60 * 1000
export const MIN_WORKBOARD_LEASE_TTL_MS = 30 * 1000
export const MAX_WORKBOARD_LEASE_TTL_MS = 8 * 60 * 60 * 1000

export type WorkboardComment = {
  id: string
  body: string
  actor: string
  createdAt: string
  evidence: WorkboardEvidence[]
}

export type WorkboardTask = {
  id: string
  title: string
  description: string
  status: WorkboardTaskStatus
  missionId: string | null
  assignedAgentId: string | null
  leaseOwnerAgentId: string | null
  leaseExpiresAt: string | null
  lastHeartbeatAt: string | null
  claimedFiles: string[]
  dependsOn: string[]
  comments: WorkboardComment[]
  createdAt: string
  updatedAt: string
}

type WorkboardState = { version: 1; tasks: WorkboardTask[] }

export class WorkboardServiceError extends Error {
  readonly status: number
  readonly code: WorkboardServiceErrorCode

  constructor(status: number, code: WorkboardServiceErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'WorkboardServiceError'
  }
}

export type WorkboardServiceOptions = {
  readState: () => unknown | Promise<unknown>
  writeState: (state: WorkboardState) => unknown | Promise<unknown>
  now?: () => Date
  randomId?: () => string
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasAsciiControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x1f) return true
  }
  return false
}

export function normalizeClaimedFilePath(rawPath: string, strict = false): string | null {
  const cleaned = rawPath.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  if (!cleaned || cleaned.length > 320 || hasAsciiControlChar(cleaned)) {
    if (strict) throw new WorkboardServiceError(400, 'invalid_payload', 'Claimed file path must be between 1 and 320 printable characters.')
    return null
  }
  const segments = cleaned.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    if (strict) throw new WorkboardServiceError(400, 'invalid_payload', `Invalid claimed file path: ${rawPath}`)
    return null
  }
  return cleaned
}

export function canonicalClaimedFileKey(filePath: string): string {
  return (normalizeClaimedFilePath(filePath, false) || filePath.trim().replace(/\\/g, '/')).toLowerCase()
}

function dedupeClaimedFiles(files: string[], strict: boolean): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of files) {
    const clean = normalizeClaimedFilePath(item, strict)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(clean)
  }
  if (strict && normalized.length > 50) {
    throw new WorkboardServiceError(400, 'invalid_payload', 'A task can claim at most 50 files at once.')
  }
  return normalized.slice(0, 50)
}

function clampLeaseTtlMs(ttlMs?: number): number {
  if (ttlMs === undefined || !Number.isFinite(ttlMs)) return DEFAULT_WORKBOARD_LEASE_TTL_MS
  return Math.min(MAX_WORKBOARD_LEASE_TTL_MS, Math.max(MIN_WORKBOARD_LEASE_TTL_MS, Math.trunc(ttlMs)))
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export function isWorkboardTaskLeaseActive(task: Pick<WorkboardTask, 'status' | 'leaseOwnerAgentId' | 'leaseExpiresAt'>, nowMs: number): boolean {
  if (task.status === 'completed' || task.status === 'cancelled') return false
  if (!task.leaseOwnerAgentId || !task.leaseExpiresAt) return false
  const expiresMs = Date.parse(task.leaseExpiresAt)
  return Number.isFinite(expiresMs) && expiresMs > nowMs
}

function doesTaskHoldFileLocks(task: WorkboardTask, nowMs: number): boolean {
  if (task.status === 'completed' || task.status === 'cancelled' || task.claimedFiles.length === 0) return false
  if (task.leaseExpiresAt) return isWorkboardTaskLeaseActive(task, nowMs)
  return task.status === 'in_progress' && Boolean(task.leaseOwnerAgentId)
}

function normalizeTask(value: unknown): WorkboardTask | null {
  if (!record(value)) return null
  const { id, title, description, status, createdAt, updatedAt } = value
  if (typeof id !== 'string' || !id || typeof title !== 'string' || !title.trim()) return null
  if (!['open', 'in_progress', 'completed', 'cancelled'].includes(String(status))) return null
  const comments = Array.isArray(value.comments) ? value.comments.filter((item): item is WorkboardComment => record(item)
    && typeof item.id === 'string' && typeof item.body === 'string' && typeof item.actor === 'string'
    && typeof item.createdAt === 'string' && Array.isArray(item.evidence)) : []
  const claimedFiles = Array.isArray(value.claimedFiles)
    ? dedupeClaimedFiles(value.claimedFiles.filter((item): item is string => typeof item === 'string'), false)
    : []
  const isTerminal = status === 'completed' || status === 'cancelled'
  return {
    id,
    title: title.trim().slice(0, 120),
    description: typeof description === 'string' ? description.slice(0, 4000) : '',
    status: status as WorkboardTaskStatus,
    missionId: typeof value.missionId === 'string' && value.missionId.trim() ? value.missionId.trim().slice(0, 160) : null,
    assignedAgentId: typeof value.assignedAgentId === 'string' && value.assignedAgentId.trim() ? value.assignedAgentId.trim().slice(0, 160) : null,
    leaseOwnerAgentId: !isTerminal && typeof value.leaseOwnerAgentId === 'string' && value.leaseOwnerAgentId.trim()
      ? value.leaseOwnerAgentId.trim().slice(0, 160)
      : null,
    leaseExpiresAt: !isTerminal ? normalizeIsoTimestamp(value.leaseExpiresAt) : null,
    lastHeartbeatAt: normalizeIsoTimestamp(value.lastHeartbeatAt),
    claimedFiles: isTerminal ? [] : claimedFiles,
    dependsOn: Array.isArray(value.dependsOn) ? Array.from(new Set(value.dependsOn.filter((item): item is string => typeof item === 'string' && item !== id))).slice(0, 50) : [],
    comments: comments.slice(-500),
    createdAt: typeof createdAt === 'string' ? createdAt : new Date(0).toISOString(),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(0).toISOString(),
  }
}

function normalizeState(value: unknown): WorkboardState {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tasks)) return { version: 1, tasks: [] }
  const tasks = value.tasks.map(normalizeTask).filter((task): task is WorkboardTask => Boolean(task)).slice(-1000)
  return { version: 1, tasks }
}

function ensureAcyclic(tasks: WorkboardTask[], taskId: string, dependencies: string[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const dependencyId of dependencies) {
    if (dependencyId === taskId) throw new WorkboardServiceError(400, 'workboard_cycle', 'A task cannot depend on itself.')
    if (!byId.has(dependencyId)) throw new WorkboardServiceError(400, 'workboard_dependency_not_found', `Prerequisite task ${dependencyId} does not exist.`)
    const visited = new Set<string>()
    const reachesTask = (id: string): boolean => {
      if (id === taskId) return true
      if (visited.has(id)) return false
      visited.add(id)
      return (byId.get(id)?.dependsOn || []).some(reachesTask)
    }
    if (reachesTask(dependencyId)) throw new WorkboardServiceError(400, 'workboard_cycle', 'This prerequisite would create a task dependency cycle.')
  }
}

function ensureNoClaimedFileConflicts(tasks: WorkboardTask[], taskId: string, candidateFiles: string[], nowMs: number) {
  if (!candidateFiles.length) return
  const candidateByKey = new Map(candidateFiles.map((filePath) => [canonicalClaimedFileKey(filePath), filePath]))
  for (const other of tasks) {
    if (other.id === taskId || !doesTaskHoldFileLocks(other, nowMs)) continue
    for (const lockedFile of other.claimedFiles) {
      const conflict = candidateByKey.get(canonicalClaimedFileKey(lockedFile))
      if (conflict) {
        const holder = other.leaseOwnerAgentId || other.assignedAgentId || 'another task'
        throw new WorkboardServiceError(
          409,
          'workboard_file_lock_conflict',
          `File "${conflict}" is already claimed by ${holder} on active task "${other.title}" (${other.id}).`,
        )
      }
    }
  }
}

export type CreateWorkboardTaskInput = {
  title: string
  description?: string
  missionId?: string | null
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  claimedFiles?: string[]
}

export type UpdateWorkboardTaskInput = {
  status?: WorkboardTaskStatus
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  heartbeat?: boolean
  actorAgentId?: string | null
  forceTakeover?: boolean
  claimedFiles?: string[]
  dependsOn?: string[]
}

export function createWorkboardService(options: WorkboardServiceOptions) {
  const currentDate = () => options.now?.() || new Date()
  const makeId = () => options.randomId?.() || randomUUID()
  let mutationQueue: Promise<void> = Promise.resolve()

  async function read() {
    return normalizeState(await options.readState())
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function persist(state: WorkboardState) {
    const result = await options.writeState(state)
    if (result === false) throw new WorkboardServiceError(503, 'workboard_persistence_failed', 'Workboard changes could not be saved.')
  }

  function ensureDependenciesComplete(task: WorkboardTask, tasks: WorkboardTask[]) {
    const byId = new Map(tasks.map((entry) => [entry.id, entry]))
    const incomplete = task.dependsOn.filter((id) => byId.get(id)?.status !== 'completed')
    if (incomplete.length) throw new WorkboardServiceError(409, 'workboard_prerequisites_open', 'Complete every prerequisite task before starting or completing this task.')
  }

  return {
    async listTasks() {
      const state = await read()
      return state.tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    createTask(input: CreateWorkboardTaskInput) {
      return serialize(async () => {
        const title = input.title.trim()
        if (!title || title.length > 120) throw new WorkboardServiceError(400, 'invalid_payload', 'Task title must be between 1 and 120 characters.')
        const state = await read()
        if (state.tasks.length >= 1000) throw new WorkboardServiceError(409, 'workboard_capacity', 'Workboard has reached its 1,000 task limit.')
        const nowDate = currentDate()
        const nowMs = nowDate.getTime()
        const timestamp = nowDate.toISOString()
        const claimedFiles = input.claimedFiles ? dedupeClaimedFiles(input.claimedFiles, true) : []
        const assignedAgentId = input.assignedAgentId?.trim().slice(0, 160) || null
        const explicitLeaseOwner = input.leaseOwnerAgentId === undefined
          ? (claimedFiles.length > 0 ? assignedAgentId : null)
          : (input.leaseOwnerAgentId?.trim().slice(0, 160) || null)

        const taskId = makeId()
        ensureNoClaimedFileConflicts(state.tasks, taskId, claimedFiles, nowMs)

        const ttlMs = clampLeaseTtlMs(input.leaseTtlMs)
        const task: WorkboardTask = {
          id: taskId,
          title,
          description: (input.description || '').trim().slice(0, 4000),
          status: 'open',
          missionId: input.missionId?.trim().slice(0, 160) || null,
          assignedAgentId: assignedAgentId || explicitLeaseOwner,
          leaseOwnerAgentId: explicitLeaseOwner,
          leaseExpiresAt: explicitLeaseOwner ? new Date(nowMs + ttlMs).toISOString() : null,
          lastHeartbeatAt: explicitLeaseOwner ? timestamp : null,
          claimedFiles,
          dependsOn: [],
          comments: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        state.tasks.push(task)
        await persist(state)
        return task
      })
    },
    updateTask(taskId: string, input: UpdateWorkboardTaskInput) {
      return serialize(async () => {
        const state = await read()
        const task = state.tasks.find((entry) => entry.id === taskId)
        if (!task) throw new WorkboardServiceError(404, 'workboard_task_not_found', 'Workboard task not found.')
        if (
          task.status === 'completed' &&
          (
            input.status !== undefined ||
            input.assignedAgentId !== undefined ||
            input.dependsOn !== undefined ||
            input.leaseOwnerAgentId !== undefined ||
            input.claimedFiles !== undefined ||
            input.heartbeat !== undefined
          )
        ) {
          throw new WorkboardServiceError(409, 'workboard_task_terminal', 'Completed tasks are immutable; create a follow-up task instead.')
        }

        const nowDate = currentDate()
        const nowMs = nowDate.getTime()
        const timestamp = nowDate.toISOString()
        const activeLease = isWorkboardTaskLeaseActive(task, nowMs)
        const actorAgentId = input.actorAgentId?.trim().slice(0, 160) || null
        const requestedLeaseOwner = input.leaseOwnerAgentId === undefined
          ? undefined
          : (input.leaseOwnerAgentId?.trim().slice(0, 160) || null)
        const requestedAssignee = input.assignedAgentId === undefined
          ? undefined
          : (input.assignedAgentId?.trim().slice(0, 160) || null)

        if (activeLease && task.leaseOwnerAgentId && !input.forceTakeover) {
          const conflictingActor =
            (actorAgentId && actorAgentId !== task.leaseOwnerAgentId) ||
            (requestedLeaseOwner !== undefined && requestedLeaseOwner !== task.leaseOwnerAgentId) ||
            (requestedAssignee !== undefined && requestedAssignee !== task.leaseOwnerAgentId)
          if (conflictingActor) {
            throw new WorkboardServiceError(
              409,
              'workboard_lease_conflict',
              `Task "${task.title}" has an active lease owned by ${task.leaseOwnerAgentId} until ${task.leaseExpiresAt}. Wait for lease expiry or coordinate a handoff.`,
            )
          }
        }

        const dependencies = input.dependsOn === undefined
          ? task.dependsOn
          : Array.from(new Set(input.dependsOn.map((id) => id.trim()).filter(Boolean)))
        if (input.dependsOn !== undefined) {
          if (dependencies.length > 50) throw new WorkboardServiceError(400, 'invalid_payload', 'A task can have at most 50 prerequisites.')
          ensureAcyclic(state.tasks, task.id, dependencies)
        }

        const nextStatus = input.status ?? task.status
        const isNextTerminal = nextStatus === 'completed' || nextStatus === 'cancelled'
        const candidate = { ...task, dependsOn: dependencies }
        if (input.dependsOn !== undefined && nextStatus === 'in_progress') ensureDependenciesComplete(candidate, state.tasks)
        if (input.status) {
          if (input.status === 'in_progress' || input.status === 'completed') ensureDependenciesComplete(candidate, state.tasks)
        }

        const nextClaimedFiles = isNextTerminal
          ? []
          : input.claimedFiles === undefined
            ? task.claimedFiles
            : dedupeClaimedFiles(input.claimedFiles, true)

        if (!isNextTerminal) {
          ensureNoClaimedFileConflicts(state.tasks, task.id, nextClaimedFiles, nowMs)
        }

        const isActorTakeover = Boolean(
          actorAgentId &&
          task.leaseOwnerAgentId &&
          actorAgentId !== task.leaseOwnerAgentId &&
          (!activeLease || input.forceTakeover),
        )
        const isUnownedActorClaim = Boolean(
          actorAgentId &&
          !task.leaseOwnerAgentId &&
          requestedLeaseOwner === undefined,
        )

        const nextAssignedAgentId = requestedAssignee !== undefined
          ? requestedAssignee
          : requestedLeaseOwner !== undefined && requestedLeaseOwner !== null
            ? requestedLeaseOwner
            : isActorTakeover || (actorAgentId && !task.assignedAgentId)
              ? actorAgentId
              : task.assignedAgentId

        let nextLeaseOwner = task.leaseOwnerAgentId
        let nextLeaseExpiresAt = task.leaseExpiresAt
        let nextLastHeartbeatAt = task.lastHeartbeatAt
        const ttlMs = clampLeaseTtlMs(input.leaseTtlMs)

        if (isNextTerminal) {
          nextLeaseOwner = null
          nextLeaseExpiresAt = null
        } else if (requestedLeaseOwner === null) {
          nextLeaseOwner = null
          nextLeaseExpiresAt = null
        } else if (requestedLeaseOwner) {
          nextLeaseOwner = requestedLeaseOwner
          nextLeaseExpiresAt = new Date(nowMs + ttlMs).toISOString()
          nextLastHeartbeatAt = timestamp
        } else if (input.heartbeat) {
          const heartbeatOwner = actorAgentId || nextLeaseOwner || nextAssignedAgentId
          if (!heartbeatOwner) {
            throw new WorkboardServiceError(400, 'invalid_payload', 'Cannot record a heartbeat without an assigned or leased agent.')
          }
          nextLeaseOwner = heartbeatOwner
          nextLeaseExpiresAt = new Date(nowMs + ttlMs).toISOString()
          nextLastHeartbeatAt = timestamp
        } else if (
          (nextStatus === 'in_progress' || nextClaimedFiles.length > 0 || isActorTakeover) &&
          (actorAgentId || nextLeaseOwner || nextAssignedAgentId) &&
          (
            input.status === 'in_progress' ||
            input.claimedFiles !== undefined ||
            input.leaseTtlMs !== undefined ||
            requestedAssignee !== undefined ||
            isActorTakeover
          )
        ) {
          const autoOwner =
            requestedAssignee ??
            (isActorTakeover || isUnownedActorClaim ? actorAgentId : null) ??
            nextLeaseOwner ??
            nextAssignedAgentId
          if (autoOwner) {
            nextLeaseOwner = autoOwner
            nextLeaseExpiresAt = new Date(nowMs + ttlMs).toISOString()
            nextLastHeartbeatAt = timestamp
          }
        }

        task.dependsOn = dependencies
        task.status = nextStatus
        task.assignedAgentId = nextAssignedAgentId
        task.leaseOwnerAgentId = nextLeaseOwner
        task.leaseExpiresAt = nextLeaseExpiresAt
        task.lastHeartbeatAt = nextLastHeartbeatAt
        task.claimedFiles = nextClaimedFiles
        task.updatedAt = timestamp
        await persist(state)
        return task
      })
    },
    addComment(taskId: string, input: { body: string; actor?: string; evidence?: WorkboardEvidence[] }) {
      return serialize(async () => {
        const body = input.body.trim()
        if (!body || body.length > 4000) throw new WorkboardServiceError(400, 'invalid_payload', 'Comment must be between 1 and 4,000 characters.')
        const evidence = (input.evidence || []).slice(0, 10).map((item) => ({ label: item.label.trim().slice(0, 120), uri: item.uri.trim().slice(0, 2048) }))
        const state = await read()
        const task = state.tasks.find((entry) => entry.id === taskId)
        if (!task) throw new WorkboardServiceError(404, 'workboard_task_not_found', 'Workboard task not found.')
        if (task.comments.length >= 500) throw new WorkboardServiceError(409, 'workboard_comment_capacity', 'This task has reached its comment limit.')
        const timestamp = currentDate().toISOString()
        const comment: WorkboardComment = { id: makeId(), body, actor: (input.actor || 'operator').trim().slice(0, 120), createdAt: timestamp, evidence }
        task.comments.push(comment)
        task.updatedAt = comment.createdAt
        await persist(state)
        return comment
      })
    },
  }
}

export type WorkboardService = ReturnType<typeof createWorkboardService>
