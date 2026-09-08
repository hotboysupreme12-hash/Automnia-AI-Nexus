/** Events are held newest-first; replay only events after an acknowledged cursor. */
export function replayAfterCursor<T extends { id?: unknown }>(events: T[], cursor?: string): { events: T[]; gap: boolean } {
  if (!cursor) return { events: [...events].reverse(), gap: false }
  const index = events.findIndex((event) => event.id === cursor)
  return index >= 0 ? { events: events.slice(0, index).reverse(), gap: false } : { events: [...events].reverse(), gap: true }
}
