import { apiRequest, type ApiResult } from './client'

export type WorkboardTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export type WorkboardEvidence = { label: string; uri: string }

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

export type CreateWorkboardTaskPayload = {
  title: string
  description?: string
  missionId?: string | null
  assignedAgentId?: string | null
  leaseOwnerAgentId?: string | null
  leaseTtlMs?: number
  claimedFiles?: string[]
}

export type UpdateWorkboardTaskPayload = {
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
