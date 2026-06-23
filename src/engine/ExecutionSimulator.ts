import type { RuntimeTickInput, RuntimeTickResult } from '../types/nexus'
import type { RuntimeAdapter } from './adapters/RuntimeAdapter'

export class ExecutionSimulator {
  private readonly adapter: RuntimeAdapter

  constructor(adapter: RuntimeAdapter) {
    this.adapter = adapter
  }

  async runTick(input: RuntimeTickInput): Promise<RuntimeTickResult> {
    return this.adapter.executeTick(input)
  }
}
