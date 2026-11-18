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

function normalizeTask(value: unknown): WorkboardTask | null {
  if (!record(value)) return null
  const { id, title, description, status, createdAt, updatedAt } = value
  if (typeof id !== 'string' || !id || typeof title !== 'string' || !title.trim()) return null
  if (!['open', 'in_progress', 'completed', 'cancelled'].includes(String(status))) return null
  const comments = Array.isArray(value.comments) ? value.comments.filter((item): item is WorkboardComment => record(item)
    && typeof item.id === 'string' && typeof item.body === 'string' && typeof item.actor === 'string'
    && typeof item.createdAt === 'string' && Array.isArray(item.evidence)) : []
  return {
    id,
    title: title.trim().slice(0, 120),
    description: typeof description === 'string' ? description.slice(0, 4000) : '',
    status: status as WorkboardTaskStatus,
    missionId: typeof value.missionId === 'string' && value.missionId.trim() ? value.missionId.trim().slice(0, 160) : null,
    assignedAgentId: typeof value.assignedAgentId === 'string' && value.assignedAgentId.trim() ? value.assignedAgentId.trim().slice(0, 160) : null,
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

export function createWorkboardService(options: WorkboardServiceOptions) {
  const now = () => (options.now?.() || new Date()).toISOString()
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
    createTask(input: { title: string; description?: string; missionId?: string | null; assignedAgentId?: string | null }) {
      return serialize(async () => {
        const title = input.title.trim()
        if (!title || title.length > 120) throw new WorkboardServiceError(400, 'invalid_payload', 'Task title must be between 1 and 120 characters.')
        const state = await read()
        if (state.tasks.length >= 1000) throw new WorkboardServiceError(409, 'workboard_capacity', 'Workboard has reached its 1,000 task limit.')
        const timestamp = now()
        const task: WorkboardTask = {
          id: makeId(), title, description: (input.description || '').trim().slice(0, 4000), status: 'open',
          missionId: input.missionId?.trim() || null, assignedAgentId: input.assignedAgentId?.trim() || null,
          dependsOn: [], comments: [], createdAt: timestamp, updatedAt: timestamp,
        }
        state.tasks.push(task)
        await persist(state)
        return task
      })
    },
    updateTask(taskId: string, input: { status?: WorkboardTaskStatus; assignedAgentId?: string | null; dependsOn?: string[] }) {
      return serialize(async () => {
        const state = await read()
        const task = state.tasks.find((entry) => entry.id === taskId)
        if (!task) throw new WorkboardServiceError(404, 'workboard_task_not_found', 'Workboard task not found.')
        if (task.status === 'completed' && (input.status !== undefined || input.assignedAgentId !== undefined || input.dependsOn !== undefined)) {
          throw new WorkboardServiceError(409, 'workboard_task_terminal', 'Completed tasks are immutable; create a follow-up task instead.')
        }

        const dependencies = input.dependsOn === undefined
          ? task.dependsOn
          : Array.from(new Set(input.dependsOn.map((id) => id.trim()).filter(Boolean)))
        if (input.dependsOn !== undefined) {
          if (dependencies.length > 50) throw new WorkboardServiceError(400, 'invalid_payload', 'A task can have at most 50 prerequisites.')
          ensureAcyclic(state.tasks, task.id, dependencies)
        }

        const nextStatus = input.status ?? task.status
        const candidate = { ...task, dependsOn: dependencies }
        if (input.dependsOn !== undefined && nextStatus === 'in_progress') ensureDependenciesComplete(candidate, state.tasks)
        if (input.status) {
          if (input.status === 'in_progress' || input.status === 'completed') ensureDependenciesComplete(candidate, state.tasks)
        }
        task.dependsOn = dependencies
        if (input.status) task.status = input.status
        if (input.assignedAgentId !== undefined) task.assignedAgentId = input.assignedAgentId?.trim() || null
        task.updatedAt = now()
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
        const comment: WorkboardComment = { id: makeId(), body, actor: (input.actor || 'operator').trim().slice(0, 120), createdAt: now(), evidence }
        task.comments.push(comment)
        task.updatedAt = comment.createdAt
        await persist(state)
        return comment
      })
    },
  }
}

export type WorkboardService = ReturnType<typeof createWorkboardService>
