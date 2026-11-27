import { randomUUID } from 'node:crypto'

export type WorkboardTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export const WORKBOARD_EXECUTION_STATES = [
  'queued',
  'running',
  'waiting_for_dependency',
  'waiting_for_review',
  'waiting_for_integration',
  'blocked',
  'break',
  'checkpointing',
  'recovering',
  'completed',
  'failed',
] as const

export type WorkboardExecutionState = (typeof WORKBOARD_EXECUTION_STATES)[number]

export type WorkboardEvidence = { label: string; uri: string }

export type WorkboardDependencyWait = {
  dependencyTaskId: string
  responsibleAgentId: string | null
  deliverable: string
  waitingSince: string
  nextCheckAt: string | null
  fallbackTask: string | null
}

export type WorkboardHandoff = {
  fromAgentId: string
  toAgentId: string
  summary: string
  filesModified: string[]
  testsExecuted: string
  knownFailures: string
  nextAction: string
  status: 'pending' | 'acknowledged'
  createdAt: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
}

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
  | 'workboard_handoff_conflict'

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
  executionState: WorkboardExecutionState
  missionId: string | null
  assignedAgentId: string | null
  leaseOwnerAgentId: string | null
  leaseExpiresAt: string | null
  lastHeartbeatAt: string | null
  claimedFiles: string[]
  dependsOn: string[]
  waitingDependency: WorkboardDependencyWait | null
  handoff: WorkboardHandoff | null
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

function isExecutionState(value: unknown): value is WorkboardExecutionState {
  return typeof value === 'string' && (WORKBOARD_EXECUTION_STATES as readonly string[]).includes(value)
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

function defaultExecutionStateForStatus(status: WorkboardTaskStatus): WorkboardExecutionState {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'running'
  return 'queued'
}

function normalizeStoredWaitingDependency(value: unknown, isTerminal: boolean): WorkboardDependencyWait | null {
  if (isTerminal || !record(value)) return null
  const dependencyTaskId = typeof value.dependencyTaskId === 'string' ? value.dependencyTaskId.trim().slice(0, 160) : ''
  const deliverable = typeof value.deliverable === 'string' ? value.deliverable.trim().slice(0, 500) : ''
  const waitingSince = normalizeIsoTimestamp(value.waitingSince)
  if (!dependencyTaskId || !deliverable || !waitingSince) return null
  return {
    dependencyTaskId,
    responsibleAgentId: typeof value.responsibleAgentId === 'string' && value.responsibleAgentId.trim()
      ? value.responsibleAgentId.trim().slice(0, 160)
      : null,
    deliverable,
    waitingSince,
    nextCheckAt: normalizeIsoTimestamp(value.nextCheckAt),
    fallbackTask: typeof value.fallbackTask === 'string' && value.fallbackTask.trim()
      ? value.fallbackTask.trim().slice(0, 500)
      : null,
  }
}

function normalizeStoredHandoff(value: unknown): WorkboardHandoff | null {
  if (!record(value)) return null
  const fromAgentId = typeof value.fromAgentId === 'string' ? value.fromAgentId.trim().slice(0, 160) : ''
  const toAgentId = typeof value.toAgentId === 'string' ? value.toAgentId.trim().slice(0, 160) : ''
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 2000) : ''
  const nextAction = typeof value.nextAction === 'string' ? value.nextAction.trim().slice(0, 1000) : ''
  const createdAt = normalizeIsoTimestamp(value.createdAt)
  if (!fromAgentId || !toAgentId || !summary || !nextAction || !createdAt) return null
  const status = value.status === 'acknowledged' ? 'acknowledged' : 'pending'
  const filesModified = Array.isArray(value.filesModified)
    ? dedupeClaimedFiles(value.filesModified.filter((item): item is string => typeof item === 'string'), false)
    : []
  return {
    fromAgentId,
    toAgentId,
    summary,
    filesModified,
    testsExecuted: typeof value.testsExecuted === 'string' ? value.testsExecuted.trim().slice(0, 1000) : '',
    knownFailures: typeof value.knownFailures === 'string' ? value.knownFailures.trim().slice(0, 1000) : '',
    nextAction,
    status,
    createdAt,
    acknowledgedAt: status === 'acknowledged' ? normalizeIsoTimestamp(value.acknowledgedAt) : null,
    acknowledgedBy: status === 'acknowledged' && typeof value.acknowledgedBy === 'string' && value.acknowledgedBy.trim()
      ? value.acknowledgedBy.trim().slice(0, 160)
      : null,
  }
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
  const typedStatus = status as WorkboardTaskStatus
  const comments = Array.isArray(value.comments) ? value.comments.filter((item): item is WorkboardComment => record(item)
    && typeof item.id === 'string' && typeof item.body === 'string' && typeof item.actor === 'string'
    && typeof item.createdAt === 'string' && Array.isArray(item.evidence)) : []
  const claimedFiles = Array.isArray(value.claimedFiles)
    ? dedupeClaimedFiles(value.claimedFiles.filter((item): item is string => typeof item === 'string'), false)
    : []
  const isTerminal = typedStatus === 'completed' || typedStatus === 'cancelled'
  const storedExecutionState = isExecutionState(value.executionState) ? value.executionState : null
  const executionState: WorkboardExecutionState = typedStatus === 'completed'
    ? 'completed'
    : typedStatus === 'cancelled'
      ? (storedExecutionState === 'failed' ? 'failed' : 'queued')
      : storedExecutionState && storedExecutionState !== 'completed'
        ? storedExecutionState
        : defaultExecutionStateForStatus(typedStatus)
  return {
    id,
    title: title.trim().slice(0, 120),
    description: typeof description === 'string' ? description.slice(0, 4000) : '',
    status: typedStatus,
    executionState,
    missionId: typeof value.missionId === 'string' && value.missionId.trim() ? value.missionId.trim().slice(0, 160) : null,
    assignedAgentId: typeof value.assignedAgentId === 'string' && value.assignedAgentId.trim() ? value.assignedAgentId.trim().slice(0, 160) : null,
    leaseOwnerAgentId: !isTerminal && typeof value.leaseOwnerAgentId === 'string' && value.leaseOwnerAgentId.trim()
      ? value.leaseOwnerAgentId.trim().slice(0, 160)
      : null,
    leaseExpiresAt: !isTerminal ? normalizeIsoTimestamp(value.leaseExpiresAt) : null,
    lastHeartbeatAt: normalizeIsoTimestamp(value.lastHeartbeatAt),
    claimedFiles: isTerminal ? [] : claimedFiles,
    dependsOn: Array.isArray(value.dependsOn) ? Array.from(new Set(value.dependsOn.filter((item): item is string => typeof item === 'string' && item !== id))).slice(0, 50) : [],
    waitingDependency: normalizeStoredWaitingDependency(value.waitingDependency, isTerminal),
    handoff: normalizeStoredHandoff(value.handoff),
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

export type WorkboardDependencyWaitInput = {
  dependencyTaskId: string
  responsibleAgentId?: string | null
  deliverable: string
  nextCheckAt?: string | null
  fallbackTask?: string | null
}

export type WorkboardHandoffInput = {
  fromAgentId: string
  toAgentId: string
  summary: string
  filesModified?: string[]
  testsExecuted?: string
  knownFailures?: string
  nextAction: string
}

export type CreateWorkboardTaskInput = {
  title: string
  description?: string
  missionId?: string | null
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  claimedFiles?: string[]
  dependsOn?: string[]
  executionState?: WorkboardExecutionState
  waitingDependency?: WorkboardDependencyWaitInput | null
}

export type UpdateWorkboardTaskInput = {
  status?: WorkboardTaskStatus
  executionState?: WorkboardExecutionState
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  heartbeat?: boolean
  actorAgentId?: string | null
  forceTakeover?: boolean
  claimedFiles?: string[]
  dependsOn?: string[]
  waitingDependency?: WorkboardDependencyWaitInput | null
  handoff?: WorkboardHandoffInput | null
  acknowledgeHandoff?: boolean
}

function buildValidatedDependencyWait(
  input: WorkboardDependencyWaitInput,
  timestamp: string,
): WorkboardDependencyWait {
  const dependencyTaskId = input.dependencyTaskId.trim().slice(0, 160)
  const deliverable = input.deliverable.trim().slice(0, 500)
  if (!dependencyTaskId) throw new WorkboardServiceError(400, 'invalid_payload', 'Dependency task ID is required when recording a dependency wait.')
  if (!deliverable) throw new WorkboardServiceError(400, 'invalid_payload', 'Required deliverable is required when recording a dependency wait.')
  let nextCheckAt: string | null = null
  if (input.nextCheckAt !== undefined && input.nextCheckAt !== null && input.nextCheckAt.trim() !== '') {
    nextCheckAt = normalizeIsoTimestamp(input.nextCheckAt)
    if (!nextCheckAt) throw new WorkboardServiceError(400, 'invalid_payload', 'nextCheckAt must be a valid ISO-8601 timestamp.')
  }
  return {
    dependencyTaskId,
    responsibleAgentId: input.responsibleAgentId?.trim().slice(0, 160) || null,
    deliverable,
    waitingSince: timestamp,
    nextCheckAt,
    fallbackTask: input.fallbackTask?.trim().slice(0, 500) || null,
  }
}

function buildValidatedHandoff(
  input: WorkboardHandoffInput,
  timestamp: string,
): WorkboardHandoff {
  const fromAgentId = input.fromAgentId.trim().slice(0, 160)
  const toAgentId = input.toAgentId.trim().slice(0, 160)
  const summary = input.summary.trim().slice(0, 2000)
  const nextAction = input.nextAction.trim().slice(0, 1000)
  if (!fromAgentId || !toAgentId) {
    throw new WorkboardServiceError(400, 'invalid_payload', 'Both fromAgentId and toAgentId are required for a task handoff.')
  }
  if (fromAgentId === toAgentId) {
    throw new WorkboardServiceError(400, 'invalid_payload', 'Task handoff requires distinct fromAgentId and toAgentId.')
  }
  if (!summary || !nextAction) {
    throw new WorkboardServiceError(400, 'invalid_payload', 'Task handoff requires both a summary of completed work and nextAction.')
  }
  const filesModified = input.filesModified ? dedupeClaimedFiles(input.filesModified, true) : []
  return {
    fromAgentId,
    toAgentId,
    summary,
    filesModified,
    testsExecuted: (input.testsExecuted || '').trim().slice(0, 1000),
    knownFailures: (input.knownFailures || '').trim().slice(0, 1000),
    nextAction,
    status: 'pending',
    createdAt: timestamp,
    acknowledgedAt: null,
    acknowledgedBy: null,
  }
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

  function ensureDependenciesComplete(task: Pick<WorkboardTask, 'dependsOn'>, tasks: WorkboardTask[]) {
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
        if (input.executionState === 'completed') {
          throw new WorkboardServiceError(400, 'invalid_payload', 'New tasks cannot start in the completed execution state.')
        }
        const state = await read()
        if (state.tasks.length >= 1000) throw new WorkboardServiceError(409, 'workboard_capacity', 'Workboard has reached its 1,000 task limit.')
        const nowDate = currentDate()
        const nowMs = nowDate.getTime()
        const timestamp = nowDate.toISOString()
        const claimedFiles = input.claimedFiles ? dedupeClaimedFiles(input.claimedFiles, true) : []
        if (claimedFiles.length > 0 && input.leaseOwnerAgentId === null) {
          throw new WorkboardServiceError(400, 'invalid_payload', 'Claimed files require an active lease owner.')
        }
        const assignedAgentId = input.assignedAgentId?.trim().slice(0, 160) || null
        const explicitLeaseOwner = input.leaseOwnerAgentId === undefined
          ? (claimedFiles.length > 0 ? (assignedAgentId || 'operator') : null)
          : (input.leaseOwnerAgentId?.trim().slice(0, 160) || null)

        const taskId = makeId()
        const waitingDependency = input.waitingDependency
          ? buildValidatedDependencyWait(input.waitingDependency, timestamp)
          : null
        const rawDependencies = [
          ...(input.dependsOn || []).map((id) => id.trim()).filter(Boolean),
          ...(waitingDependency ? [waitingDependency.dependencyTaskId] : []),
        ]
        const dependencies = Array.from(new Set(rawDependencies))
        if (dependencies.length > 50) {
          throw new WorkboardServiceError(400, 'invalid_payload', 'A task can have at most 50 prerequisites.')
        }
        if (dependencies.length > 0) {
          ensureAcyclic(state.tasks, taskId, dependencies)
        }
        ensureNoClaimedFileConflicts(state.tasks, taskId, claimedFiles, nowMs)

        const executionState: WorkboardExecutionState = waitingDependency
          ? (input.executionState ?? 'waiting_for_dependency')
          : (input.executionState ?? 'queued')

        const ttlMs = clampLeaseTtlMs(input.leaseTtlMs)
        const task: WorkboardTask = {
          id: taskId,
          title,
          description: (input.description || '').trim().slice(0, 4000),
          status: 'open',
          executionState,
          missionId: input.missionId?.trim().slice(0, 160) || null,
          assignedAgentId: assignedAgentId || (explicitLeaseOwner && explicitLeaseOwner !== 'operator' ? explicitLeaseOwner : null),
          leaseOwnerAgentId: explicitLeaseOwner,
          leaseExpiresAt: explicitLeaseOwner ? new Date(nowMs + ttlMs).toISOString() : null,
          lastHeartbeatAt: explicitLeaseOwner ? timestamp : null,
          claimedFiles,
          dependsOn: dependencies,
          waitingDependency,
          handoff: null,
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
          (task.status === 'completed' || task.status === 'cancelled') &&
          (
            input.status !== undefined ||
            input.executionState !== undefined ||
            input.assignedAgentId !== undefined ||
            input.dependsOn !== undefined ||
            input.leaseOwnerAgentId !== undefined ||
            input.claimedFiles !== undefined ||
            input.heartbeat !== undefined ||
            input.waitingDependency !== undefined ||
            input.handoff !== undefined ||
            input.acknowledgeHandoff !== undefined
          )
        ) {
          const label = task.status === 'completed' ? 'Completed' : 'Cancelled'
          throw new WorkboardServiceError(409, 'workboard_task_terminal', `${label} tasks are immutable; create a follow-up task instead.`)
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

        const isDesignatedHandoffReceiver = Boolean(
          input.acknowledgeHandoff &&
          task.handoff?.status === 'pending' &&
          (!actorAgentId || actorAgentId === task.handoff.toAgentId),
        )

        if (activeLease && task.leaseOwnerAgentId && !input.forceTakeover && !isDesignatedHandoffReceiver) {
          const isOwnerInitiatingHandoff = Boolean(
            input.handoff &&
            input.handoff.fromAgentId.trim() === task.leaseOwnerAgentId &&
            (!actorAgentId || actorAgentId === task.leaseOwnerAgentId),
          )
          const conflictingActor =
            (actorAgentId && actorAgentId !== task.leaseOwnerAgentId) ||
            (!isOwnerInitiatingHandoff && requestedLeaseOwner !== undefined && requestedLeaseOwner !== null && requestedLeaseOwner !== task.leaseOwnerAgentId) ||
            (!isOwnerInitiatingHandoff && requestedAssignee !== undefined && requestedAssignee !== task.leaseOwnerAgentId)
          if (conflictingActor) {
            throw new WorkboardServiceError(
              409,
              'workboard_lease_conflict',
              `Task "${task.title}" has an active lease owned by ${task.leaseOwnerAgentId} until ${task.leaseExpiresAt}. Wait for lease expiry or coordinate a handoff.`,
            )
          }
        }

        const nextStatus = input.status ?? task.status
        const isNextTerminal = nextStatus === 'completed' || nextStatus === 'cancelled'
        if (!isNextTerminal && input.executionState === 'completed') {
          throw new WorkboardServiceError(400, 'invalid_payload', 'Execution state "completed" requires task status "completed".')
        }

        let nextWaitingDependency = isNextTerminal ? null : task.waitingDependency
        if (!isNextTerminal && input.waitingDependency !== undefined) {
          nextWaitingDependency = input.waitingDependency === null
            ? null
            : buildValidatedDependencyWait(input.waitingDependency, timestamp)
        }

        const baseDependencies = input.dependsOn === undefined
          ? task.dependsOn
          : Array.from(new Set(input.dependsOn.map((id) => id.trim()).filter(Boolean)))
        const dependencies = nextWaitingDependency && !baseDependencies.includes(nextWaitingDependency.dependencyTaskId)
          ? [...baseDependencies, nextWaitingDependency.dependencyTaskId]
          : baseDependencies
        if (input.dependsOn !== undefined || input.waitingDependency !== undefined) {
          if (dependencies.length > 50) throw new WorkboardServiceError(400, 'invalid_payload', 'A task can have at most 50 prerequisites.')
          ensureAcyclic(state.tasks, task.id, dependencies)
        }

        let nextExecutionState: WorkboardExecutionState
        if (nextStatus === 'completed') {
          nextExecutionState = 'completed'
        } else if (nextStatus === 'cancelled') {
          nextExecutionState = input.executionState === 'failed' ? 'failed' : 'queued'
        } else if (input.executionState !== undefined) {
          nextExecutionState = input.executionState
        } else if (input.waitingDependency && nextWaitingDependency) {
          nextExecutionState = 'waiting_for_dependency'
        } else if (input.waitingDependency === null && task.executionState === 'waiting_for_dependency') {
          nextExecutionState = defaultExecutionStateForStatus(nextStatus)
        } else if (input.status !== undefined && input.status !== task.status) {
          nextExecutionState = defaultExecutionStateForStatus(nextStatus)
        } else {
          nextExecutionState = task.executionState
        }

        if (nextExecutionState !== 'waiting_for_dependency' && input.waitingDependency === undefined) {
          nextWaitingDependency = null
        }

        const candidate = { dependsOn: dependencies }
        const enteringWaitingForDependency =
          nextStatus !== 'completed' &&
          nextExecutionState === 'waiting_for_dependency' &&
          (input.executionState === 'waiting_for_dependency' || Boolean(input.waitingDependency))
        if (!enteringWaitingForDependency) {
          if (input.dependsOn !== undefined && nextStatus === 'in_progress') ensureDependenciesComplete(candidate, state.tasks)
          if (input.status && (input.status === 'in_progress' || input.status === 'completed')) {
            ensureDependenciesComplete(candidate, state.tasks)
          }
        }

        if (!isNextTerminal && input.claimedFiles && input.claimedFiles.length > 0 && requestedLeaseOwner === null) {
          throw new WorkboardServiceError(400, 'invalid_payload', 'Claimed files require an active lease owner.')
        }

        let nextHandoff = task.handoff
        if (input.handoff !== undefined) {
          nextHandoff = input.handoff === null ? null : buildValidatedHandoff(input.handoff, timestamp)
        }

        if (input.acknowledgeHandoff) {
          if (!nextHandoff) {
            throw new WorkboardServiceError(409, 'workboard_handoff_conflict', 'No pending handoff exists on this task.')
          }
          if (actorAgentId && actorAgentId !== nextHandoff.toAgentId && !input.forceTakeover) {
            throw new WorkboardServiceError(
              409,
              'workboard_handoff_conflict',
              `Only designated receiver ${nextHandoff.toAgentId} can acknowledge this handoff without forceTakeover.`,
            )
          }
          const acknowledger = actorAgentId || nextHandoff.toAgentId
          nextHandoff = {
            ...nextHandoff,
            status: 'acknowledged',
            acknowledgedAt: timestamp,
            acknowledgedBy: acknowledger,
          }
        }

        const releasingLeaseWithoutReplacement =
          requestedLeaseOwner === null || (Boolean(input.handoff) && requestedLeaseOwner === undefined && !input.acknowledgeHandoff)

        const nextClaimedFiles = isNextTerminal || (releasingLeaseWithoutReplacement && input.claimedFiles === undefined)
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
          (!activeLease || input.forceTakeover || isDesignatedHandoffReceiver),
        )
        const isUnownedActorClaim = Boolean(
          actorAgentId &&
          !task.leaseOwnerAgentId &&
          requestedLeaseOwner === undefined,
        )

        const handoffAssignee = input.handoff ? nextHandoff?.toAgentId : undefined
        const ackAssignee = input.acknowledgeHandoff ? (actorAgentId || nextHandoff?.toAgentId) : undefined

        const nextAssignedAgentId = requestedAssignee !== undefined
          ? requestedAssignee
          : ackAssignee !== undefined
            ? ackAssignee
            : handoffAssignee !== undefined
              ? handoffAssignee
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
        } else if (input.acknowledgeHandoff && nextHandoff) {
          const ackOwner = actorAgentId || nextHandoff.toAgentId
          nextLeaseOwner = ackOwner
          nextLeaseExpiresAt = new Date(nowMs + ttlMs).toISOString()
          nextLastHeartbeatAt = timestamp
        } else if (input.handoff) {
          // Releasing sender lease during handoff allows the receiving agent to claim cleanly upon acknowledgment.
          nextLeaseOwner = null
          nextLeaseExpiresAt = null
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
            nextAssignedAgentId ??
            (nextClaimedFiles.length > 0 ? 'operator' : null)
          if (autoOwner) {
            nextLeaseOwner = autoOwner
            nextLeaseExpiresAt = new Date(nowMs + ttlMs).toISOString()
            nextLastHeartbeatAt = timestamp
          }
        }

        task.dependsOn = dependencies
        task.status = nextStatus
        task.executionState = nextExecutionState
        task.assignedAgentId = nextAssignedAgentId
        task.leaseOwnerAgentId = nextLeaseOwner
        task.leaseExpiresAt = nextLeaseExpiresAt
        task.lastHeartbeatAt = nextLastHeartbeatAt
        task.claimedFiles = nextClaimedFiles
        task.waitingDependency = nextWaitingDependency
        task.handoff = nextHandoff
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
