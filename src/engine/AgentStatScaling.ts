import type { CoreAttributes, OpenClawAgent } from '../types/nexus'

export const AGENT_STAT_MAX = 99

export const CORE_ATTRIBUTE_KEYS = [
  'intelligence',
  'speed',
  'precision',
  'creativity',
  'stability',
  'compute',
  'parallelism',
] as const satisfies readonly (keyof CoreAttributes)[]

export function clampAgentStat(value: number | undefined, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(AGENT_STAT_MAX, Math.round(value as number)))
}

export function clampAgentLevel(value: number | undefined, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(AGENT_STAT_MAX, Math.round(value as number)))
}

export function levelStatMultiplier(level: number): number {
  const boundedLevel = clampAgentLevel(level)
  const coreProgress = Math.min(1, (boundedLevel - 1) / 49)
  const apexProgress = Math.max(0, boundedLevel - 50) / 49
  return 0.32 + coreProgress ** 1.28 * 0.68 + apexProgress * 0.12
}

export function levelStatCeiling(level: number): number {
  const boundedLevel = clampAgentLevel(level)
  return Math.min(AGENT_STAT_MAX, Math.round(34 + Math.min(50, boundedLevel) * 1.3 + Math.max(0, boundedLevel - 50) * 0.22))
}

export function scaleStatForLevel(value: number | undefined, level: number, fallback = 50): number {
  const boundedLevel = clampAgentLevel(level)
  const minimum = Math.min(88, 10 + boundedLevel * 1.38)
  const scaled = clampAgentStat(value, fallback) * levelStatMultiplier(boundedLevel)
  return clampAgentStat(Math.max(minimum, scaled), fallback)
}

export function scaleAttributesForLevel(attributes: CoreAttributes, level: number): CoreAttributes {
  return CORE_ATTRIBUTE_KEYS.reduce((next, key) => {
    next[key] = scaleStatForLevel(attributes[key], level)
    return next
  }, {} as CoreAttributes)
}

export function blendCoreAttributes(base: CoreAttributes, overlay: CoreAttributes, overlayWeight = 0.36): CoreAttributes {
  const clampedWeight = Math.max(0, Math.min(1, overlayWeight))
  return CORE_ATTRIBUTE_KEYS.reduce((next, key) => {
    const baseValue = clampAgentStat(base[key])
    const overlayValue = clampAgentStat(overlay[key], baseValue)
    next[key] = clampAgentStat(baseValue * (1 - clampedWeight) + overlayValue * clampedWeight)
    return next
  }, {} as CoreAttributes)
}

export function deriveLevelScaledAttributes(agent: OpenClawAgent, configuredPotential?: CoreAttributes, configuredWeight = 0.36): CoreAttributes {
  const potential = configuredPotential
    ? blendCoreAttributes(agent.attributes, configuredPotential, configuredWeight)
    : agent.attributes
  return scaleAttributesForLevel(potential, agent.level)
}
