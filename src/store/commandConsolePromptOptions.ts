import type { AgentTurnAttachment, FastModeDefault, ThinkingLevel } from '../types/nexus'
import type { CommandConsoleQueuedFollowup } from './commandConsoleState'

export type PromptRunOptions = {
  displayPrompt?: string
  userTurnId?: string
  responseId?: string
  includeRecentContext?: boolean
  freshSession?: boolean
  heartbeatTurn?: boolean
  thinking?: ThinkingLevel
  fastMode?: FastModeDefault
  timeoutSeconds?: number
  attachments?: AgentTurnAttachment[]
  sessionKey?: string
  forceOpenClawRuntime?: boolean
  trackMissionCycle?: boolean
  contextAgentIds?: string[]
}

export type QueuedCommandConsoleFollowup = CommandConsoleQueuedFollowup<PromptRunOptions> & {
  userPrompt: string
  rebuildPrompt: (prompt: string) => string
}
