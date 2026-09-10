import { create } from 'zustand'

export type VoiceInputPhase = 'idle' | 'requesting' | 'recording' | 'processing'

// A pending request survives the console's lazy mount. The recipient is captured
// with the recording, never inferred from the selection when transcription ends.
export const useAgentVoiceStore = create<{
  agentId: string | null
  pendingAgentId: string | null
  phase: VoiceInputPhase
  stopRequested: boolean
  request: (agentId: string) => boolean
  reset: () => void
}>((set, get) => ({
  agentId: null,
  pendingAgentId: null,
  phase: 'idle',
  stopRequested: false,
  request: (agentId) => {
    const state = get()
    if (state.phase === 'recording' && state.agentId === agentId) {
      set({ stopRequested: true })
      return true
    }
    if (state.phase !== 'idle' || state.pendingAgentId) return false
    set({ agentId, pendingAgentId: agentId, phase: 'requesting' })
    return true
  },
  reset: () => set({ agentId: null, pendingAgentId: null, phase: 'idle', stopRequested: false }),
}))
