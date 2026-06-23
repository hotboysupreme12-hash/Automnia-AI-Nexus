import type { RuntimeTickInput, RuntimeTickResult } from '../../types/nexus'

export interface RuntimeAdapter {
  executeTick(input: RuntimeTickInput): Promise<RuntimeTickResult>
}
