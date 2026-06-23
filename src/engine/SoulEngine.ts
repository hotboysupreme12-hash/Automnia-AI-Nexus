import type { SoulConfig } from '../types/nexus'

export interface SoulModifiers {
  reasoningBoost: number
  retryBias: number
  explorationVariance: number
  validationStrictness: number
  delegationBias: number
}

export class SoulEngine {
  static derive(soul: SoulConfig): SoulModifiers {
    const personalityBias =
      soul.personality === 'analytical'
        ? 0.08
        : soul.personality === 'creative'
          ? 0.18
          : soul.personality === 'aggressive'
            ? 0.12
            : 0.04

    const alignmentPenalty = soul.alignmentMode === 'strict' ? 0.12 : soul.alignmentMode === 'balanced' ? 0.06 : 0.0

    return {
      reasoningBoost: soul.reflectionDepth / 100,
      retryBias: (soul.persistence + soul.goalOrientation) / 200,
      explorationVariance: Math.max(0.05, personalityBias + soul.riskTolerance / 400 - alignmentPenalty),
      validationStrictness: Math.max(0.2, soul.alignmentMode === 'strict' ? 0.92 : soul.alignmentMode === 'balanced' ? 0.7 : 0.45),
      delegationBias: Math.max(0.1, soul.autonomyLevel / 100),
    }
  }

  static summary(soul: SoulConfig): string {
    return `${soul.personality} | autonomy ${soul.autonomyLevel}% | alignment ${soul.alignmentMode}`
  }
}
