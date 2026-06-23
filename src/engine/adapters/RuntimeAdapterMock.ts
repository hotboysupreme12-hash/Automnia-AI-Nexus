import type { RuntimeTickResult } from '../../types/nexus'
import type { RuntimeAdapter } from './RuntimeAdapter'
import type { RuntimeTickInput } from '../../types/nexus'

const PHASES = ['Planning', 'Coordination', 'Execution', 'Validation', 'Optimization']
const TICKS_PER_PHASE = 3
const TOTAL_PHASES = PHASES.length
// Remove hard completion threshold — mock no longer declares "completed" after N ticks.
// The real agent turns (via /api/openclaw/agent-turn) drive actual progress.
// The mock is only used for 'instant' single-cycle missions for XP/report generation.
const TICKS_TO_COMPLETION = Number.MAX_SAFE_INTEGER

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export class RuntimeAdapterMock implements RuntimeAdapter {
  private agentTickNumbers = new Map<string, number>()

  async executeTick(input: RuntimeTickInput): Promise<RuntimeTickResult> {
    // Track per-agent tick count (incremented each time this agent ticks)
    const agentKey = input.agent.id
    const priorTicks = this.agentTickNumbers.get(agentKey) ?? 0
    const currentTick = priorTicks + 1
    this.agentTickNumbers.set(agentKey, currentTick)

    const complexityFactor = input.mission.complexity / 100
    const riskFactor = input.mission.riskTolerance / 100

    // Determine if this agent has completed its full cycle
    const completed = currentTick >= TICKS_TO_COMPLETION
    const phaseIndex = completed ? TOTAL_PHASES - 1 : Math.floor(currentTick / TICKS_PER_PHASE)
    const phase = PHASES[Math.min(phaseIndex, TOTAL_PHASES - 1)]
    const phaseProgress = completed ? 100 : clamp(Math.round(((currentTick % TICKS_PER_PHASE) / TICKS_PER_PHASE) * 100), 10, 100)

    const baseProgress = completed
      ? 100
      : clamp(Math.round(12 + phaseProgress * 0.6 + input.runtimePreview.reasoningDepth * 2 - complexityFactor * 9 + randomInt(-4, 6)), 3, 95)

    const primary = clamp(baseProgress + randomInt(-6, 8), 0, 100)
    const secondary = clamp(baseProgress + randomInt(-8, 6), 0, 100)
    const tertiary = clamp(baseProgress + randomInt(-10, 5), 0, 100)

    const retriesUsed = completed
      ? 0
      : clamp(
          Math.round((riskFactor * 2 + (1 - input.runtimePreview.validationStrictness) * 2 + Math.random() * 2) / 2),
          0,
          input.runtimePreview.retryAttempts,
        )

    const memoryUsageMb = Math.round(clamp(80 + input.runtimePreview.maxTokens / 35 + input.runtimePreview.concurrencyLimit * 18 + randomInt(-20, 26), 40, 980))

    const errorCount = completed ? 0 : randomInt(0, riskFactor > 0.6 ? 2 : 1)

    const log = completed
      ? `${input.agent.id} tick ${currentTick}: ✅ COMPLETED — acceptance evidence delivered for ${input.mission.title}. All ${totalAgentsForLog(input)} agents processed ${TICKS_TO_COMPLETION}+ ticks. ${generatedEvidence(input)}`
      : `${input.agent.id} tick ${currentTick}: ${phase.toLowerCase()} (${phaseProgress}%) at complexity ${input.mission.complexity}%; acceptance evidence still required`

    return {
      phase,
      log,
      retriesUsed,
      memoryUsageMb,
      subtaskBreakdown: [
        { id: `${input.agent.id}-plan`, label: 'Plan', progress: primary },
        { id: `${input.agent.id}-exec`, label: 'Execute', progress: secondary },
        { id: `${input.agent.id}-verify`, label: 'Verify', progress: tertiary },
      ],
      concurrencyUsage: clamp(Math.round(input.runtimePreview.concurrencyLimit * (0.4 + Math.random() * 0.6)), 1, input.runtimePreview.concurrencyLimit),
      errorCount,
      xpDelta: completed
        ? clamp(18 + baseProgress + randomInt(8, 24), 12, 60)
        : clamp(6 + baseProgress - retriesUsed * 2 - errorCount * 3 + randomInt(-3, 5), 1, 36),
      completed,
      acceptanceEvidence: completed
          ? [
            `All ${PHASES.join('/')} phases executed successfully`,
            `Agent ${input.agent.name} completed mission "${input.mission.title}" with the objective satisfied`,
            `Evidence: ${generatedEvidence(input)}`,
          ]
        : undefined,
    }
  }
}

function generatedEvidence(input: RuntimeTickInput): string {
  const missionType = input.mission.missionType
  if (missionType === 'codeGeneration') return 'build passes, tests green, lint clean'
  if (missionType === 'planning') return 'mission plan scoped, risks named, lanes owned'
  if (missionType === 'research') return 'facts gathered, unknowns cited, decisions supported'
  if (missionType === 'orchestration') return 'delegations complete, blockers resolved, synthesis delivered'
  return 'memory updated, continuity files current'
}

function totalAgentsForLog(input: RuntimeTickInput): string {
  const count = input.mission.selectedAgents?.length
  return count ? `${count}` : 'all'
}
