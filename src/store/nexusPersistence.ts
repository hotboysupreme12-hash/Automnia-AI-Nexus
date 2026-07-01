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

export function mergeNexusPersistedState<TState extends NexusPersistenceMergeState>(
  persisted: unknown,
  current: TState,
): TState {
  const data = persisted as VersionedPersistedState<TState>
  if (!data._version || data._version < MIN_NEXUS_PERSISTED_VERSION) {
    return current
  }

  const agentConfig = mergeAgentConfigState(data)
  const missionState = mergeMissionState(data, current)
  const selection = normalizeNexusSelection(agentConfig.agents)
  return {
    ...current,
    ...data,
    ...agentConfig,
    ...selection,
    ...missionState,
    ...preserveRuntimeProjectionState(current),
    ...preserveCommandConsoleResponseState(current),
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
