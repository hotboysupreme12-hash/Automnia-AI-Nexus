import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_DEFAULT_PARTY_IDS,
  MAX_PARTY_SIZE,
  getDefaultTemplateAgent,
  isDefaultAgentPortrait,
  isRetiredAgentId,
  isUsablePortrait,
  makeAgentConfigState,
  makeDefaultParty,
  mergeAgentConfigState,
  partializeAgentConfigState,
  rememberRetiredAgentId,
  rememberRetiredAgentIds,
  resolveDefaultTemplateAgentId,
  sameOrderedIds,
  sanitizeAgentForPersistentStore,
  sanitizeAgentForStore,
  sanitizePartyIds,
  updateAgentInList,
} from '../src/store/agentConfigState'
import {
  MAX_HISTORY,
  MAX_REPORTS,
  makeMissionState,
  mergeMissionState,
  partializeMissionState,
} from '../src/store/missionState'
import { makeNexusUiState, normalizeNexusSelection } from '../src/store/nexusUiState'
import {
  configSaveEntry,
  makeRuntimeProjectionState,
  preserveRuntimeProjectionState,
  updateAgentConfigSaveStatus,
} from '../src/store/runtimeProjectionState'
import {
  applyQueuedCommandConsoleResponsePatch,
  commandConsoleSessionKey,
  createQueuedCommandConsoleResponse,
  makeCommandConsoleDraftStorageKey,
  makeCommandConsoleResponseState,
  preserveCommandConsoleResponseState,
  queueProgressLines,
  readCommandConsoleDraft,
  removeCommandConsoleDraft,
  removeCommandConsoleDraftsForAgent,
  upsertCommandConsoleResponse,
  writeCommandConsoleDraft,
  type CommandConsoleDraftStorage,
} from '../src/store/commandConsoleState'
import {
  MIN_NEXUS_PERSISTED_VERSION,
  NEXUS_PERSISTED_VERSION,
  NEXUS_STORAGE_KEY,
  mergeNexusPersistedState,
  partializeNexusPersistedState,
  type NexusPersistenceMergeState,
} from '../src/store/nexusPersistence'
import type { AgentResponse, MissionReport, MissionRun, OpenClawAgent } from '../src/types/nexus'

const agents = [
  { id: 'alpha', heartbeat: { tickIntervalMs: 2500 } },
  { id: 'beta', heartbeat: { tickIntervalMs: 5000 } },
]

class MemoryDraftStorage implements CommandConsoleDraftStorage {
  private readonly data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

function makePersistenceMergeState(): NexusPersistenceMergeState {
  const agentConfig = makeAgentConfigState()
  return {
    ...agentConfig,
    ...makeMissionState(),
    ...makeRuntimeProjectionState(agentConfig.agents),
    ...makeCommandConsoleResponseState(),
    selectedAgentId: agentConfig.agents[0]?.id ?? null,
    selectedAgentIds: agentConfig.agents[0] ? [agentConfig.agents[0].id] : [],
  }
}

function makeMissionRun(id: string, status: MissionRun['status'] = 'completed'): MissionRun {
  const missionState = makeMissionState()
  return {
    ...missionState.missionDraft,
    id,
    selectedAgents: ['alpha'],
    startedAt: '2026-06-30T00:00:00.000Z',
    endedAt: status === 'running' ? null : '2026-06-30T00:05:00.000Z',
    status,
    heartbeatLifecycle: 'test',
  }
}

function makeMissionReport(id: string): MissionReport {
  return {
    id,
    missionId: id.replace(/^report-/, 'mission-'),
    generatedAt: '2026-06-30T00:00:00.000Z',
    efficiencyRating: null,
    soulDrift: null,
    heartbeatStabilityScore: null,
    runtimeEfficiency: null,
    errors: null,
    xpGained: null,
    skillUnlocks: [],
  }
}

function makeAgentResponse(id: string, agentId = 'alpha'): AgentResponse {
  return {
    id,
    agentId,
    prompt: 'check',
    response: 'ok',
    ok: true,
    timestamp: '2026-06-30T00:00:00.000Z',
    durationMs: 10,
  }
}

test('nexus UI state owns only shell selection and editor state', () => {
  assert.deepEqual(
    normalizeNexusSelection(agents, 'beta', ['alpha', 'missing', 'alpha']),
    { selectedAgentId: 'beta', selectedAgentIds: ['beta', 'alpha'] },
  )

  const uiState = makeNexusUiState(agents, { tab: 'monitor', selectedAgentIds: ['beta'] })
  assert.deepEqual(Object.keys(uiState).sort(), [
    'editingAgentId',
    'isEditorOpen',
    'selectedAgentId',
    'selectedAgentIds',
    'tab',
  ])
  assert.equal(uiState.tab, 'monitor')
  assert.equal(uiState.selectedAgentId, 'beta')
  assert.equal(uiState.isEditorOpen, false)
})

test('runtime projection state resets volatile runtime truth without UI keys', () => {
  const projection = makeRuntimeProjectionState(agents)
  assert.deepEqual(Object.keys(projection).sort(), [
    'activeMission',
    'agentConfigSaveStatus',
    'missionFeed',
    'missionLaunchPending',
    'operationStates',
    'sessionWarmAgentIds',
  ])
  assert.equal(projection.activeMission, null)
  assert.equal(projection.missionLaunchPending, false)
  assert.equal(projection.operationStates.alpha.tickRate, 2500)
  assert.equal(projection.operationStates.beta.tickRate, 5000)
  assert.equal('agentResponses' in projection, false)
  assert.equal('busyAgentIds' in projection, false)
})

test('runtime projection hydration clears warm/save internals without command-console response keys', () => {
  const entry = configSaveEntry('saving', 'Saving runtime policy...', 7, 'req-1')
  const current = makeRuntimeProjectionState(agents)
  const projected = {
    ...current,
    sessionWarmAgentIds: ['beta'],
    agentConfigSaveStatus: updateAgentConfigSaveStatus({}, 'alpha', 'runtime', entry),
  }

  const preserved = preserveRuntimeProjectionState(projected)
  assert.deepEqual(preserved.sessionWarmAgentIds, [])
  assert.deepEqual(preserved.agentConfigSaveStatus, {})
  assert.equal('agentResponses' in preserved, false)
  assert.equal('busyAgentIds' in preserved, false)
})

test('command-console response state preserves responses separately from runtime projection', () => {
  const response = {
    id: 'response-1',
    agentId: 'alpha',
    prompt: 'check',
    response: 'ok',
    ok: true,
    timestamp: '2026-06-30T00:00:00.000Z',
    durationMs: 10,
  }
  const commandConsoleState = {
    ...makeCommandConsoleResponseState(),
    agentResponses: [response],
    busyAgentIds: ['alpha'],
  }

  assert.deepEqual(Object.keys(makeCommandConsoleResponseState()).sort(), [
    'agentResponses',
    'busyAgentIds',
  ])
  assert.deepEqual(preserveCommandConsoleResponseState(commandConsoleState), commandConsoleState)
})

test('command-console response updates retain an agent busy while another lane streams', () => {
  const completed = { ...makeAgentResponse('completed-alpha'), streaming: false }
  const streaming = { ...makeAgentResponse('streaming-alpha'), streaming: true }
  const current = { agentResponses: [completed, streaming], busyAgentIds: ['alpha'] }

  const afterCompletedUpdate = upsertCommandConsoleResponse(current, {
    ...completed,
    response: 'updated completion',
  })
  assert.deepEqual(afterCompletedUpdate.busyAgentIds, ['alpha'])
  assert.equal(afterCompletedUpdate.agentResponses.find((entry) => entry.id === completed.id)?.response, 'updated completion')

  const afterStreamingCompletes = upsertCommandConsoleResponse(afterCompletedUpdate, {
    ...streaming,
    streaming: false,
  })
  assert.deepEqual(afterStreamingCompletes.busyAgentIds, [])
})

test('command-console draft helpers own draft storage and retired-agent cleanup', () => {
  const storage = new MemoryDraftStorage()
  const alphaKey = makeCommandConsoleDraftStorageKey('direct:alpha')
  const selectedKey = makeCommandConsoleDraftStorageKey('selected:alpha,beta')
  const unrelatedKey = makeCommandConsoleDraftStorageKey('direct:gamma')

  writeCommandConsoleDraft(alphaKey, ' hello ', storage)
  writeCommandConsoleDraft(selectedKey, 'team prompt', storage)
  writeCommandConsoleDraft(unrelatedKey, 'keep me', storage)
  assert.equal(readCommandConsoleDraft(alphaKey, storage), ' hello ')

  writeCommandConsoleDraft(alphaKey, '   ', storage)
  assert.equal(readCommandConsoleDraft(alphaKey, storage), '')
  writeCommandConsoleDraft(alphaKey, 'restored', storage)
  removeCommandConsoleDraft(alphaKey, storage)
  assert.equal(readCommandConsoleDraft(alphaKey, storage), '')

  const removed = removeCommandConsoleDraftsForAgent('ALPHA', storage)
  assert.equal(removed, 1)
  assert.equal(readCommandConsoleDraft(selectedKey, storage), '')
  assert.equal(readCommandConsoleDraft(unrelatedKey, storage), 'keep me')
})

test('command-console queued response helpers own session keys, queue labels, and patch durations', () => {
  assert.equal(commandConsoleSessionKey('alpha'), 'agent:alpha:control-center:console')
  assert.deepEqual(queueProgressLines(1, 3), [
    'Queue position 1 of 3.',
    'This turn is next; it will start when the active lane is free.',
  ])
  assert.deepEqual(queueProgressLines(3, 4), [
    'Queue position 3 of 4.',
    '2 queued turns ahead.',
  ])

  const queuedAt = '2026-06-30T00:00:00.000Z'
  const queued = createQueuedCommandConsoleResponse({
    queuedId: 'queued-1',
    agentId: 'alpha',
    agentName: 'Alpha',
    visiblePrompt: 'summarize',
    missionId: 'mission-1',
    queuedAt,
    queuePosition: 2,
    sourceLabel: 'selected',
  })
  assert.equal(queued.transport, 'command-console-queue')
  assert.equal(queued.queuePosition, 2)
  assert.equal(queued.queueDepth, 2)
  assert.equal(queued.activity?.[0]?.rawSource, 'control-center.command-console.selected.queue')

  const patched = applyQueuedCommandConsoleResponsePatch(queued, {
    response: 'released',
    streaming: false,
    queuePosition: undefined,
    queueDepth: undefined,
  }, new Date('2026-06-30T00:00:05.000Z').getTime())
  assert.equal(patched.durationMs, 5000)
  assert.equal(patched.response, 'released')
  assert.equal(patched.streaming, false)
})

test('agent config state owns roster and party persistence without mission keys', () => {
  const state = makeAgentConfigState()
  assert.deepEqual(Object.keys(state).sort(), [
    'activePartyIds',
    'agents',
    'confirmedPartyIds',
    'retiredAgentIds',
  ])
  assert.equal('missionDraft' in state, false)
  assert.ok(state.agents.length > 0)
  assert.ok(state.activePartyIds.length <= MAX_PARTY_SIZE)
  assert.equal(state.activePartyIds.every((id) => state.agents.some((agent) => agent.id === id)), true)

  const sanitized = sanitizePartyIds([state.agents[0]?.id, 'missing', state.agents[0]?.id, state.agents[1]?.id].filter(Boolean), state.agents)
  assert.deepEqual(sanitized, [state.agents[0]!.id, state.agents[1]!.id])

  const persisted = partializeAgentConfigState({
    ...state,
    agents: [{ ...state.agents[0]!, portrait: 'data:image/png;base64,AAAA' }],
    activePartyIds: [state.agents[0]!.id, 'missing'],
    confirmedPartyIds: [state.agents[0]!.id, 'missing'],
  })
  assert.equal(Object.keys(persisted).includes('missionHistory'), false)
  assert.equal(persisted.agents[0]?.portrait.startsWith('data:'), false)
  assert.deepEqual(persisted.activePartyIds, [state.agents[0]!.id])
})

test('agent config hydration repairs legacy default party without mission state', () => {
  const merged = mergeAgentConfigState({
    activePartyIds: ['hn-netanyahu', 'hn-commander', 'hn-coordinator', 'hn-builder', 'hn-reviewer'],
    confirmedPartyIds: ['hn-netanyahu', 'hn-commander', 'hn-coordinator', 'hn-builder', 'hn-reviewer'],
  })
  assert.equal(merged.activePartyIds.includes('hn-netanyahu'), false)
  assert.equal(merged.activePartyIds.includes('hn-commander'), false)
  assert.equal(merged.activePartyIds.includes('hn-builder'), false)
  assert.equal(merged.activePartyIds.every((id) => merged.agents.some((agent) => agent.id === id)), true)
  assert.deepEqual(merged.activePartyIds, ['hn-architect', 'hn-coordinator', 'hn-crypto-lead'])
  assert.deepEqual(merged.confirmedPartyIds, merged.activePartyIds)
})

test('agent config helpers normalize retired ids, parties, portraits, and persisted agents', () => {
  const state = makeAgentConfigState()
  const first = state.agents[0]!
  const second = state.agents[1]!
  const seedBackedAgent: OpenClawAgent = {
    ...first,
    portrait: '',
    performance: {
      ...first.performance,
      xp: -4.4,
      completedMissions: -1.2,
      failedMissions: -2.8,
      efficiencyAverage: Number.NaN,
      heartbeatStability: 120.2,
      runtimeEfficiency: -10.2,
      errors: 120.2,
    },
  }
  const customAgent: OpenClawAgent = {
    ...first,
    id: 'phase-j-custom-agent',
    portrait: '',
  }

  assert.equal(isRetiredAgentId(undefined), false)
  assert.deepEqual(rememberRetiredAgentIds([' Phase-J-Retired ', 42, 'bad id']), ['phase-j-retired'])
  assert.deepEqual(rememberRetiredAgentId('phase-j-second-retired'), ['phase-j-retired', 'phase-j-second-retired'])
  assert.equal(isRetiredAgentId('PHASE-J-RETIRED'), true)
  assert.equal(isRetiredAgentId('hn-commander'), true)
  assert.equal(isRetiredAgentId(customAgent.id), false)
  assert.equal(isRetiredAgentId(first.id), false)

  assert.equal(resolveDefaultTemplateAgentId([]), null)
  assert.equal(resolveDefaultTemplateAgentId([first]), first.id)
  assert.equal(getDefaultTemplateAgent().id.length > 0, true)
  assert.equal(makeDefaultParty([first, second]).every((id) => id === first.id || id === second.id), true)
  assert.deepEqual(sanitizePartyIds('not-an-array', [first, second]), makeDefaultParty([first, second]))
  assert.equal(sameOrderedIds([first.id, second.id], [first.id, second.id]), true)
  assert.equal(sameOrderedIds([first.id], [second.id]), false)

  assert.equal(isUsablePortrait(undefined), false)
  assert.equal(isUsablePortrait('data:text/plain;base64,AAAA'), false)
  assert.equal(isUsablePortrait('data:image/png;base64,AAAA'), true)
  assert.equal(isDefaultAgentPortrait(first.id, first.portrait), true)
  assert.equal(isDefaultAgentPortrait(first.id, 'agents/custom.png'), false)

  const updatedAgents = updateAgentInList([first, second], second.id, (agent) => ({ ...agent, name: 'Updated Agent' }))
  assert.equal(updatedAgents[0], first)
  assert.equal(updatedAgents[1]?.name, 'Updated Agent')
  assert.equal(Boolean(updatedAgents[1]?.runtime), true)

  const sanitized = sanitizeAgentForStore(seedBackedAgent)
  assert.equal(sanitized.portrait, first.portrait)
  assert.equal(sanitized.performance.xp, 0)
  assert.equal(sanitized.performance.efficiencyAverage, 70)
  assert.equal(sanitized.performance.heartbeatStability, 99)
  assert.equal(sanitized.performance.runtimeEfficiency, 1)
  assert.equal(sanitized.performance.errors, 99)

  const persisted = sanitizeAgentForPersistentStore({ ...first, portrait: 'data:image/png;base64,AAAA' })
  assert.equal(persisted.portrait, first.portrait)
  const customPersisted = sanitizeAgentForPersistentStore({ ...customAgent, portrait: 'blob:http://local/avatar' })
  assert.equal(customPersisted.portrait, '')
})

test('mission state owns draft, history, and reports without agent config keys', () => {
  const missionState = makeMissionState()
  assert.deepEqual(Object.keys(missionState).sort(), [
    'missionDraft',
    'missionHistory',
    'missionReports',
  ])
  assert.equal('agents' in missionState, false)

  const missionRuns: MissionRun[] = Array.from({ length: MAX_HISTORY + 3 }, (_, index) => ({
    ...missionState.missionDraft,
    id: `mission-${index}`,
    selectedAgents: ['alpha'],
    startedAt: '2026-06-30T00:00:00.000Z',
    endedAt: null,
    status: 'completed',
    heartbeatLifecycle: 'test',
  }))
  const reports: MissionReport[] = Array.from({ length: MAX_REPORTS + 2 }, (_, index) => ({
    id: `report-${index}`,
    missionId: `mission-${index}`,
    generatedAt: '2026-06-30T00:00:00.000Z',
    efficiencyRating: null,
    soulDrift: null,
    heartbeatStabilityScore: null,
    runtimeEfficiency: null,
    errors: null,
    xpGained: null,
    skillUnlocks: [],
  }))

  const merged = mergeMissionState({ missionHistory: missionRuns, missionReports: reports }, missionState)
  assert.equal(merged.missionHistory.length, MAX_HISTORY)
  assert.equal(merged.missionReports.length, MAX_REPORTS)

  const persisted = partializeMissionState({ ...missionState, missionHistory: missionRuns, missionReports: reports })
  assert.equal(Object.keys(persisted).includes('activePartyIds'), false)
  assert.equal(persisted.missionHistory.length, MAX_HISTORY)
  assert.equal(persisted.missionReports.length, MAX_REPORTS)
})

test('nexus persistence migration rejects missing and stale persisted versions', () => {
  const current = makePersistenceMergeState()

  assert.equal(NEXUS_STORAGE_KEY, 'nexus-v10')
  assert.equal(mergeNexusPersistedState({ agents: [] }, current), current)
  assert.equal(mergeNexusPersistedState({ _version: MIN_NEXUS_PERSISTED_VERSION - 1, agents: [] }, current), current)
})

test('nexus persistence migration hydrates split modules while preserving volatile runtime truth', () => {
  const current = makePersistenceMergeState()
  const currentAgentId = current.agents[0]!.id
  const currentActiveMission = makeMissionRun('current-active', 'running')
  const currentResponse = makeAgentResponse('current-response', currentAgentId)
  current.activeMission = currentActiveMission
  current.missionFeed = [{
    id: 'current-feed',
    missionId: currentActiveMission.id,
    timestamp: '2026-06-30T00:00:00.000Z',
    type: 'mission',
    message: 'keep volatile feed',
  }]
  current.sessionWarmAgentIds = [currentAgentId]
  current.agentConfigSaveStatus = {
    [currentAgentId]: { runtime: configSaveEntry('saving', 'Saving runtime policy...', 7, 'req-current') },
  }
  current.agentResponses = [currentResponse]
  current.busyAgentIds = [currentAgentId]

  const persistedMissionHistory = Array.from({ length: MAX_HISTORY + 2 }, (_, index) => makeMissionRun(`persisted-${index}`))
  const persistedReports = Array.from({ length: MAX_REPORTS + 2 }, (_, index) => makeMissionReport(`report-${index}`))
  const merged = mergeNexusPersistedState({
    _version: MIN_NEXUS_PERSISTED_VERSION,
    activePartyIds: LEGACY_DEFAULT_PARTY_IDS,
    confirmedPartyIds: LEGACY_DEFAULT_PARTY_IDS,
    selectedAgentId: 'missing-agent',
    selectedAgentIds: ['missing-agent'],
    activeMission: makeMissionRun('persisted-active', 'running'),
    missionFeed: [{
      id: 'persisted-feed',
      missionId: 'persisted-active',
      timestamp: '2026-06-30T00:00:00.000Z',
      type: 'mission',
      message: 'do not keep persisted volatile feed',
    }],
    sessionWarmAgentIds: ['persisted-warm'],
    agentConfigSaveStatus: {
      persisted: { runtime: configSaveEntry('saving', 'Should not persist...', 1, 'req-persisted') },
    },
    agentResponses: [makeAgentResponse('persisted-response')],
    busyAgentIds: ['persisted-agent'],
    missionHistory: persistedMissionHistory,
    missionReports: persistedReports,
  }, current)

  assert.notEqual(merged, current)
  assert.equal(merged.activePartyIds.includes('hn-netanyahu'), false)
  assert.equal(merged.activePartyIds.includes('hn-commander'), false)
  assert.equal(merged.activePartyIds.includes('hn-builder'), false)
  assert.equal(merged.activePartyIds.every((id) => merged.agents.some((agent) => agent.id === id)), true)
  assert.deepEqual(merged.confirmedPartyIds, merged.activePartyIds)
  assert.deepEqual(merged.selectedAgentIds, [])
  assert.equal(merged.selectedAgentId, null)
  assert.equal(merged.missionHistory.length, MAX_HISTORY)
  assert.equal(merged.missionReports.length, MAX_REPORTS)
  assert.equal(merged.activeMission, currentActiveMission)
  assert.equal(merged.missionFeed, current.missionFeed)
  assert.equal(merged.operationStates, current.operationStates)
  assert.deepEqual(merged.sessionWarmAgentIds, [])
  assert.deepEqual(merged.agentConfigSaveStatus, {})
  assert.equal(merged.agentResponses, current.agentResponses)
  assert.equal(merged.busyAgentIds, current.busyAgentIds)
})

test('nexus persistence partialize writes the compact nexus-v10 payload shape only', () => {
  const state = makePersistenceMergeState()
  const firstAgent = state.agents[0]!
  const missionRuns = Array.from({ length: MAX_HISTORY + 4 }, (_, index) => makeMissionRun(`partialized-${index}`))
  const reports = Array.from({ length: MAX_REPORTS + 4 }, (_, index) => makeMissionReport(`report-partialized-${index}`))
  const persisted = partializeNexusPersistedState({
    ...state,
    agents: [{ ...firstAgent, portrait: 'data:image/png;base64,AAAA' }],
    activePartyIds: [firstAgent.id, 'missing-agent'],
    confirmedPartyIds: [firstAgent.id, 'missing-agent'],
    missionHistory: missionRuns,
    missionReports: reports,
    activeMission: makeMissionRun('volatile-active', 'running'),
    missionFeed: [{
      id: 'volatile-feed',
      missionId: 'volatile-active',
      timestamp: '2026-06-30T00:00:00.000Z',
      type: 'mission',
      message: 'not persisted',
    }],
    sessionWarmAgentIds: [firstAgent.id],
    agentConfigSaveStatus: {
      [firstAgent.id]: { runtime: configSaveEntry('saving', 'not persisted', 2, 'req-volatile') },
    },
    agentResponses: [makeAgentResponse('volatile-response', firstAgent.id)],
    busyAgentIds: [firstAgent.id],
    selectedAgentId: firstAgent.id,
    selectedAgentIds: [firstAgent.id],
  })

  assert.equal(persisted._version, NEXUS_PERSISTED_VERSION)
  assert.deepEqual(Object.keys(persisted).sort(), [
    '_version',
    'activePartyIds',
    'agents',
    'confirmedPartyIds',
    'missionDraft',
    'missionHistory',
    'missionReports',
    'retiredAgentIds',
  ])
  assert.equal(persisted.agents[0]?.portrait.startsWith('data:'), false)
  assert.deepEqual(persisted.activePartyIds, [firstAgent.id])
  assert.equal(persisted.missionHistory.length, MAX_HISTORY)
  assert.equal(persisted.missionReports.length, MAX_REPORTS)
  assert.equal('activeMission' in persisted, false)
  assert.equal('missionFeed' in persisted, false)
  assert.equal('operationStates' in persisted, false)
  assert.equal('sessionWarmAgentIds' in persisted, false)
  assert.equal('agentConfigSaveStatus' in persisted, false)
  assert.equal('agentResponses' in persisted, false)
  assert.equal('busyAgentIds' in persisted, false)
  assert.equal('selectedAgentId' in persisted, false)
  assert.equal('selectedAgentIds' in persisted, false)
})
