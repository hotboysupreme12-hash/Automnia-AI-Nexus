import type { NexusAgentConfigState } from './agentConfigState'
import { mergeAgentConfigState, partializeAgentConfigState } from './agentConfigState'
import type { NexusCommandConsoleResponseState } from './commandConsoleState'
import { preserveCommandConsoleResponseState } from './commandConsoleState'
import type { NexusMissionState } from './missionState'
import { mergeMissionState, partializeMissionState } from './missionState'
import type { NexusUiState } from './nexusUiState'
import { normalizeNexusSelection } from './nexusUiState'
import type { NexusRuntimeProjectionState } from './runtimeProjectionState'
import { preserveRuntimeProjectionState } from './runtimeProjectionState'

export const NEXUS_STORAGE_KEY = 'nexus-v10'
export const NEXUS_PERSISTED_VERSION = 5
export const MIN_NEXUS_PERSISTED_VERSION = 3

export type NexusPersistedPayload = {
  _version: number
} & NexusAgentConfigState & NexusMissionState

export type NexusPersistenceMergeState =
  NexusAgentConfigState &
  NexusMissionState &
  Pick<NexusUiState, 'selectedAgentId' | 'selectedAgentIds'> &
  NexusRuntimeProjectionState &
  NexusCommandConsoleResponseState

type VersionedPersistedState<TState> = Partial<TState> & { _version?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReadablePayload(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !Number.isInteger(value._version)) return false
  const version = value._version as number
  if (version < MIN_NEXUS_PERSISTED_VERSION || version > NEXUS_PERSISTED_VERSION) return false
  for (const key of ['agents', 'missionHistory', 'missionReports']) {
    const items = value[key]
    if (items !== undefined && (!Array.isArray(items) || !items.every(isRecord))) return false
  }
  for (const key of ['activePartyIds', 'confirmedPartyIds', 'retiredAgentIds']) {
    const ids = value[key]
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))) return false
  }
  return value.missionDraft === undefined || isRecord(value.missionDraft)
}

export function mergeNexusPersistedState<TState extends NexusPersistenceMergeState>(
  persisted: unknown,
  current: TState,
): TState {
  if (!isReadablePayload(persisted)) return current
  const data = persisted as VersionedPersistedState<TState>

  try {
    const agentConfig = mergeAgentConfigState(data)
    const missionState = mergeMissionState(data, current)
    const selection = normalizeNexusSelection(agentConfig.agents)
    // Only restore owned data fields. Stored JSON must never replace actions,
    // shell state, or other live properties added to the store in the future.
    return {
      ...current,
      ...agentConfig,
      ...selection,
      ...missionState,
      ...preserveRuntimeProjectionState(current),
      ...preserveCommandConsoleResponseState(current),
    }
  } catch {
    // A damaged nested agent must not prevent the entire desktop from opening.
    return current
  }
}

export function partializeNexusPersistedState<TState extends NexusAgentConfigState & NexusMissionState>(
  state: TState,
): NexusPersistedPayload {
  return {
    _version: NEXUS_PERSISTED_VERSION,
    ...partializeAgentConfigState(state),
    ...partializeMissionState(state),
  }
}
