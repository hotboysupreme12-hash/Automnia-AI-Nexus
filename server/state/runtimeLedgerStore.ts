import path from 'node:path'

import {
  appendDiagnosticRunLedger,
  appendGatewayEventLedger,
  appendMissionEventLedger,
  appendMissionRecordLedger,
  appendMissionReportLedger,
  appendRuntimeRunLedger,
  closeRuntimeLedger,
  configureRuntimeLedger,
  deleteControlCenterState,
  readAgencyAgentTemplateCatalog,
  readControlCenterState,
  readDiagnosticRunLedgerTail,
  readGatewayEventLedgerTail,
  readMissionEventLedgerTail,
  readMissionRecordLedgerTail,
  readMissionReportLedgerTail,
  readRuntimeRunLedgerTail,
  runtimeLedgerStatus,
  scheduleLegacyRuntimeLedgerImport,
  writeAgencyAgentTemplateCatalog,
  writeControlCenterState,
} from '../runtimeLedger'

export type RuntimeLedgerStorePaths = {
  directory: string
  sqlite?: string
  runtimeRunsJsonl: string
  gatewayEventsJsonl: string
  diagnosticRunsJsonl: string
  missionRecordsJsonl: string
  missionEventsJsonl: string
  missionReportsJsonl: string
}

export type RuntimeLedgerAppendOptions = {
  mirrorJsonl?: boolean
  sqlite?: boolean
}

export type RuntimeLedgerReadOptions = {
  sqlite?: boolean
}

export const CONTROL_CENTER_STATE_KEYS = {
  heartbeatDefaults: 'runtime:heartbeat-defaults',
  heartbeatPerAgent: 'runtime:heartbeat-per-agent',
  agencyAgentTemplates: 'agents:agency-templates',
  localAuth: 'auth:local',
  partyProfiles: 'agents:party-profiles',
  pluginListCache: 'plugins:list-cache',
  pluginRuntimeState: 'plugins:runtime-state',
  retiredAgentIds: 'agents:retired-ids',
  runtimeMonitorClear: 'runtime:monitor-clear',
} as const

const CONTROL_CENTER_STATE_NAMESPACE = 'control-center'

export { scheduleLegacyRuntimeLedgerImport }

export function runtimeLedgerPathsForStateRoot(openClawStateRoot: string): Required<RuntimeLedgerStorePaths> {
  const directory = path.join(openClawStateRoot, 'control-center-ledger')
  return {
    directory,
    sqlite: path.join(directory, 'control-center.sqlite'),
    runtimeRunsJsonl: path.join(directory, 'runtime-runs.jsonl'),
    gatewayEventsJsonl: path.join(directory, 'gateway-events.jsonl'),
    diagnosticRunsJsonl: path.join(directory, 'diagnostic-runs.jsonl'),
    missionRecordsJsonl: path.join(directory, 'mission-records.jsonl'),
    missionEventsJsonl: path.join(directory, 'mission-events.jsonl'),
    missionReportsJsonl: path.join(directory, 'mission-reports.jsonl'),
  }
}

export function runtimeMonitorClearMarkerPath(paths: Pick<RuntimeLedgerStorePaths, 'directory'>) {
  return path.join(paths.directory, 'runtime-monitor-clear.json')
}

function normalizeRuntimeLedgerStorePaths(paths: RuntimeLedgerStorePaths): Required<RuntimeLedgerStorePaths> {
  return {
    ...paths,
    sqlite: paths.sqlite || path.join(paths.directory, 'control-center.sqlite'),
  }
}

export function createRuntimeLedgerStore(paths: RuntimeLedgerStorePaths) {
  const normalizedPaths = normalizeRuntimeLedgerStorePaths(paths)
  configureRuntimeLedger(normalizedPaths)

  return {
    paths: normalizedPaths,
    appendRuntimeRun: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendRuntimeRunLedger(value, options),
    appendGatewayEvent: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendGatewayEventLedger(value, options),
    appendDiagnosticRun: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendDiagnosticRunLedger(value, options),
    appendMissionRecord: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendMissionRecordLedger(value, options),
    appendMissionEvent: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendMissionEventLedger(value, options),
    appendMissionReport: (value: Record<string, unknown>, options?: RuntimeLedgerAppendOptions) =>
      appendMissionReportLedger(value, options),
    readRuntimeRuns: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readRuntimeRunLedgerTail<T>(limit, options),
    readGatewayEvents: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readGatewayEventLedgerTail<T>(limit, options),
    readDiagnosticRuns: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readDiagnosticRunLedgerTail<T>(limit, options),
    readMissionRecords: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readMissionRecordLedgerTail<T>(limit, options),
    readMissionEvents: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readMissionEventLedgerTail<T>(limit, options),
    readMissionReports: <T>(limit: number, options?: RuntimeLedgerReadOptions) =>
      readMissionReportLedgerTail<T>(limit, options),
    readControlCenterState: <T>(stateKey: string, options?: RuntimeLedgerReadOptions) =>
      readControlCenterState<T>(CONTROL_CENTER_STATE_NAMESPACE, stateKey, options),
    writeControlCenterState: (stateKey: string, value: unknown, sourcePath?: string, options?: RuntimeLedgerReadOptions) =>
      writeControlCenterState(CONTROL_CENTER_STATE_NAMESPACE, stateKey, value, { ...(options || {}), sourcePath }),
    deleteControlCenterState: (stateKey: string, options?: RuntimeLedgerReadOptions) =>
      deleteControlCenterState(CONTROL_CENTER_STATE_NAMESPACE, stateKey, options),
    readAgencyAgentTemplateCatalog: <T>(options?: RuntimeLedgerReadOptions) =>
      readAgencyAgentTemplateCatalog<T>(options),
    writeAgencyAgentTemplateCatalog: (catalog: unknown, options?: RuntimeLedgerReadOptions) =>
      writeAgencyAgentTemplateCatalog(catalog as never, options),
    status: (options?: RuntimeLedgerReadOptions) => runtimeLedgerStatus(options),
    close: () => closeRuntimeLedger(),
  }
}

export type RuntimeLedgerStore = ReturnType<typeof createRuntimeLedgerStore>
