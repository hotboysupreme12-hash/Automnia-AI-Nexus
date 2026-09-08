import type { FastModeDefault, ThinkingLevel } from '../../types/nexus'

export type RuntimeDefaultsDraft = {
  heartbeatSeconds: number
  idleTimeoutSeconds: number
  continuous: boolean
  recoveryMode: boolean
  timeoutMinutes: number
  thinkingDefault: ThinkingLevel
  fastModeDefault: FastModeDefault
  parallelPreferred: boolean
}

export function mixedRuntimeFields(targets: RuntimeDefaultsDraft[]): Set<keyof RuntimeDefaultsDraft> {
  if (targets.length < 2) return new Set()
  return new Set((Object.keys(targets[0]) as Array<keyof RuntimeDefaultsDraft>).filter((key) => targets.some((target) => target[key] !== targets[0][key])))
}

export function buildRuntimePolicyPatch(values: RuntimeDefaultsDraft, keys: Array<keyof RuntimeDefaultsDraft>) {
  const changed = new Set(keys)
  return {
    heartbeat: {
      ...(changed.has('heartbeatSeconds') ? { tickIntervalMs: Math.max(5, Math.min(1800, Math.round(values.heartbeatSeconds))) * 1000 } : {}),
      ...(changed.has('idleTimeoutSeconds') ? { idleTimeoutMs: Math.max(5, Math.min(1800, Math.round(values.idleTimeoutSeconds))) * 1000 } : {}),
      ...(changed.has('continuous') ? { continuous: values.continuous } : {}),
      ...(changed.has('recoveryMode') ? { recoveryMode: values.recoveryMode } : {}),
    },
    runtimePolicy: {
      ...(changed.has('timeoutMinutes') ? { timeoutSeconds: Math.max(1, Math.min(120, Math.round(values.timeoutMinutes))) * 60 } : {}),
      ...(changed.has('thinkingDefault') ? { thinkingDefault: values.thinkingDefault } : {}),
      ...(changed.has('fastModeDefault') ? { fastModeDefault: values.fastModeDefault } : {}),
      ...(changed.has('parallelPreferred') ? { parallelPreferred: values.parallelPreferred } : {}),
    },
  }
}
