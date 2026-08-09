import type { MissionReport, MissionRun } from '../types/nexus'
import { apiRequest, type ApiResult } from './client'

export type BackendMissionStatus = 'active' | 'completed' | 'cancelled'

export type BackendMission = {
  id: string
  idempotencyKey?: string
  title: string
  brief: string
  mode: 'instant' | 'hours' | 'days' | 'weeks' | 'continuous' | 'indefinite'
  amount: number | null
  missionType?: string
  collaborationMode?: string
  complexity?: number
  riskTolerance?: number
  cadenceSeconds?: number
  agentCadenceSeconds?: Record<string, number>
  startAt: string
  endAt: string | null
  status: BackendMissionStatus
  party: string[]
  createdAt: string
  completedAt: string | null
  progress?: number | null
  scheduler?: MissionRun['scheduler']
  lifecycleState?: string
}

export type BackendMissionEvent = {
  id: string
  missionId: string
  at: string
  type: 'mission_started' | 'agent_assigned' | 'agent_update' | 'mission_completed' | 'mission_cancelled'
  message: string
  agentId?: string
}

export type BackendMissionsPayload = {
  generatedAt?: string
  missions?: BackendMission[]
  feed?: BackendMissionEvent[]
  events?: unknown[]
  reports?: MissionReport[]
  projection?: {
    source?: string
    missionCount?: number
    activeMissionCount?: number
    durableRecordCount?: number
    memoryRecordCount?: number
  }
}

export type MissionStartRequest = {
  idempotencyKey: string
  title: string
  brief: string
  party: string[]
  mode: BackendMission['mode']
  amount: number | null
  missionType: string
  collaborationMode: string
  complexity: number
  riskTolerance: number
  cadenceSeconds: number
  agentCadenceSeconds: Record<string, number>
}

export type MissionStartPayload = {
  ok?: boolean
  deduped?: boolean
  idempotencyKey?: string | null
  mission?: BackendMission
  error?: string
  detail?: unknown
}

export function fetchMissionProjection(): Promise<ApiResult<BackendMissionsPayload>> {
  return apiRequest<BackendMissionsPayload>('/api/missions/projection')
}

export function startMission(body: MissionStartRequest): Promise<ApiResult<MissionStartPayload>> {
  return apiRequest<MissionStartPayload>('/api/missions/start', {
    method: 'POST',
    body,
  })
}

export function stopMission(missionId: string): Promise<ApiResult<unknown>> {
  return apiRequest('/api/missions/stop', {
    method: 'POST',
    body: { missionId },
    timeoutMs: 120_000,
  })
}
