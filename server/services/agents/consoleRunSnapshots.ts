type Frame = Record<string, unknown>

/** Server-owned chat projection. Active turns survive event-ring eviction and renderer loss. */
export class ConsoleRunSnapshots {
  private readonly runs = new Map<string, Frame>()

  private readonly completedLimit: number

  constructor(completedLimit = 200) { this.completedLimit = completedLimit }

  record(frame: Frame): Frame {
    const key = String(frame.responseId || frame.clawTalkRunId || '')
    if (!key) return frame
    const previous = this.runs.get(key)
    const terminal = frame.event === 'final' || frame.event === 'error'
    const text = typeof frame.text === 'string' ? frame.text : ''
    let reply = String(previous?.text || '')
    if (frame.event === 'delta') reply = frame.replace ? text : reply + text
    else if (terminal) {
      const finalText = typeof frame.reply === 'string' && frame.reply ? frame.reply : text
      // Compacted final payloads can omit or truncate text already delivered as tokens.
      if (finalText && (!frame.sseCompacted || !reply)) reply = finalText
      if (!reply && typeof frame.message === 'string') reply = frame.message
    }
    const snapshot: Frame = {
      ...previous, ...frame,
      snapshot: true,
      replace: true,
      event: frame.event,
      progressText: !terminal && frame.event !== 'delta'
        ? frame.message || frame.detail || text || previous?.progressText
        : previous?.progressText,
      text: reply,
      startedAt: previous?.startedAt || frame.timestamp,
      label: typeof frame.label === 'string' ? frame.label : previous?.label || 'Working',
    }
    this.runs.set(key, snapshot)
    const completed = [...this.runs.entries()].filter(([, run]) => run.event === 'final' || run.event === 'error')
    for (const [id] of completed.slice(0, Math.max(0, completed.length - this.completedLimit))) this.runs.delete(id)
    // Recoverable UI turns use absolute text, making replay and simultaneous streams idempotent.
    return frame.responseId ? snapshot : frame
  }

  values(): Frame[] { return [...this.runs.values()] }

  clear(agentId?: string) {
    for (const [id, run] of this.runs) {
      if (!agentId || run.agentId === agentId) this.runs.delete(id)
    }
  }
}
