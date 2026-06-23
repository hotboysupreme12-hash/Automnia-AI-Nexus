import { SoulEngine } from './SoulEngine'
import { deriveLevelScaledAttributes } from './AgentStatScaling'
import type { OpenClawAgent, RuntimePreview } from '../types/nexus'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export class RuntimeComposer {
  static compose(agent: OpenClawAgent): RuntimePreview {
    const { heartbeat, mds, soul } = agent
    const attributes = deriveLevelScaledAttributes(agent)
    const soulFx = SoulEngine.derive(soul)
    const behaviorBias =
      agent.behaviorProfile === 'executor'
        ? { temp: -0.06, concurrency: 1.1, depth: 0.8 }
        : agent.behaviorProfile === 'architect'
          ? { temp: -0.02, concurrency: 0.95, depth: 1.2 }
          : agent.behaviorProfile === 'auditor'
            ? { temp: -0.12, concurrency: 0.85, depth: 1.0 }
            : agent.behaviorProfile === 'researcher'
              ? { temp: 0.08, concurrency: 0.9, depth: 1.3 }
              : { temp: 0, concurrency: 1, depth: 1 }

    const intelligenceScale = attributes.intelligence / 100
    const precisionScale = attributes.precision / 100
    const creativityScale = attributes.creativity / 100
    const stabilityScale = attributes.stability / 100
    const computeScale = attributes.compute / 100
    const parallelScale = attributes.parallelism / 100

    const reasoningDepth = Math.round((2 + intelligenceScale * 4 + soulFx.reasoningBoost * 3) * behaviorBias.depth)
    const retryCount = Math.round(1 + stabilityScale * 3 + soulFx.retryBias * 2)

    const temperature = round(clamp(1.15 - precisionScale * 0.85 + soulFx.explorationVariance * 0.2 + behaviorBias.temp, 0.08, 1.25))
    const topP = round(clamp(0.52 + creativityScale * 0.45 + soulFx.explorationVariance * 0.2, 0.5, 0.99))

    const maxTokens = Math.round(
      clamp(700 + mds.maxContextTokens * intelligenceScale * 0.08 + computeScale * 2200, 400, 12000),
    )

    const concurrencyLimit = Math.round(
      clamp(1 + parallelScale * 6 + computeScale * 4 + (mds.delegationAllowed ? soulFx.delegationBias * 2 : 0) * behaviorBias.concurrency, 1, 12),
    )

    const retryAttempts = Math.round(clamp(retryCount + (heartbeat.recoveryMode ? 1 : 0), 1, 8))

    return {
      temperature,
      top_p: topP,
      maxTokens,
      retryAttempts,
      concurrencyLimit,
      reasoningDepth,
      retryCount,
      validationStrictness: round(soulFx.validationStrictness, 3),
      explorationVariance: round(soulFx.explorationVariance, 3),
    }
  }
}
