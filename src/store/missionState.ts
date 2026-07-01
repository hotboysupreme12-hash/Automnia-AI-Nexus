import { DEFAULT_MISSION_DRAFT } from '../data/seeds'
import type { MissionDraft, MissionReport, MissionRun } from '../types/nexus'

export const MAX_REPORTS = 30
export const MAX_HISTORY = 40

export interface NexusMissionState {
  missionDraft: MissionDraft
  missionHistory: MissionRun[]
  missionReports: MissionReport[]
}

export function makeMissionState(): NexusMissionState {
  return {
    missionDraft: { ...DEFAULT_MISSION_DRAFT },
    missionHistory: [],
    missionReports: [],
  }
}

export function mergeMissionState(
  data: Partial<NexusMissionState>,
  current: NexusMissionState = makeMissionState(),
): NexusMissionState {
  return {
    missionDraft: data.missionDraft || current.missionDraft,
    missionHistory: (data.missionHistory || current.missionHistory || []).slice(0, MAX_HISTORY),
    missionReports: (data.missionReports || current.missionReports || []).slice(0, MAX_REPORTS),
  }
}

export function partializeMissionState(state: NexusMissionState): NexusMissionState {
  return {
    missionDraft: state.missionDraft,
    missionHistory: state.missionHistory.slice(0, MAX_HISTORY),
    missionReports: state.missionReports.slice(0, MAX_REPORTS),
  }
}
