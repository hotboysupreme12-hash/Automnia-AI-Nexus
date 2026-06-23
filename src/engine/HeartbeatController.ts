import type { MissionRun, OpenClawAgent } from '../types/nexus'

interface StartHeartbeatOptions {
  agents: OpenClawAgent[]
  mission: MissionRun
  onTick: (agentId: string) => void | Promise<void>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export class HeartbeatController {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private rotationTimer: ReturnType<typeof setInterval> | null = null

  start(options: StartHeartbeatOptions): void {
    this.stopAll()

    const agents = [...options.agents]
    if (!agents.length) return

    if (options.mission.collaborationMode === 'sequential') {
      let idx = 0
      const minInterval = Math.min(...agents.map((agent) => agent.heartbeat.tickIntervalMs || 1000))
      this.rotationTimer = setInterval(() => {
        const current = agents[idx % agents.length]
        void options.onTick(current.id)
        idx += 1
      }, clamp(minInterval, 1000, 24 * 60 * 60 * 1000))
      return
    }

    for (const agent of agents) {
      const interval = agent.heartbeat.tickIntervalMs
      const safeInterval = clamp(interval, 1000, 24 * 60 * 60 * 1000)
      const timer = setInterval(() => {
        void options.onTick(agent.id)
      }, safeInterval)
      this.timers.set(agent.id, timer)
    }
  }

  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()

    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
      this.rotationTimer = null
    }
  }
}
