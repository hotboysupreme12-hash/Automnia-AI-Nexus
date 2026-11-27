import { apiRequest, type ApiResult } from './client'

export type WorkboardTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export type WorkboardExecutionState =
  | 'queued'
  | 'running'
  | 'waiting_for_dependency'
  | 'waiting_for_review'
  | 'waiting_for_integration'
  | 'blocked'
  | 'break'
  | 'checkpointing'
  | 'recovering'
  | 'completed'
  | 'failed'

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
  executionState?: WorkboardExecutionState
  missionId: string | null
  assignedAgentId: string | null
  leaseOwnerAgentId: string | null
  leaseExpiresAt: string | null
  lastHeartbeatAt: string | null
  claimedFiles: string[]
  dependsOn: string[]
  waitingDependency?: WorkboardDependencyWait | null
  handoff?: WorkboardHandoff | null
  comments: WorkboardComment[]
  createdAt: string
  updatedAt: string
}

export type CreateWorkboardTaskPayload = {
  title: string
  description?: string
  missionId?: string | null
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  claimedFiles?: string[]
  dependsOn?: string[]
  executionState?: WorkboardExecutionState
  waitingDependency?: {
    dependencyTaskId: string
    responsibleAgentId?: string | null
    deliverable: string
    nextCheckAt?: string | null
    fallbackTask?: string | null
  } | null
}

export type UpdateWorkboardTaskPayload = {
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
  waitingDependency?: {
    dependencyTaskId: string
    responsibleAgentId?: string | null
    deliverable: string
    nextCheckAt?: string | null
    fallbackTask?: string | null
  } | null
  handoff?: {
    fromAgentId: string
    toAgentId: string
    summary: string
    filesModified?: string[]
    testsExecuted?: string
    knownFailures?: string
    nextAction: string
  } | null
  acknowledgeHandoff?: boolean
}

export function fetchWorkboardTasks(): Promise<ApiResult<{ tasks?: WorkboardTask[] }>> {
  return apiRequest('/api/workboard/tasks')
}

export function createWorkboardTask(input: CreateWorkboardTaskPayload) {
  return apiRequest<{ task?: WorkboardTask }>('/api/workboard/tasks', { method: 'POST', body: input })
}

export function updateWorkboardTask(taskId: string, input: UpdateWorkboardTaskPayload) {
  return apiRequest<{ task?: WorkboardTask }>(`/api/workboard/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: input })
}

export function addWorkboardComment(taskId: string, input: { body: string; actor?: string; evidence?: WorkboardEvidence[] }) {
  return apiRequest<{ comment?: WorkboardComment }>(`/api/workboard/tasks/${encodeURIComponent(taskId)}/comments`, { method: 'POST', body: input })
}
