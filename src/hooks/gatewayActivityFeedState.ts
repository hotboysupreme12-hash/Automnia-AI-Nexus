import type { GatewayActivityFeed } from './useGatewayActivityFeed'

export type GatewayActivityFeedSnapshot = {
  feed: GatewayActivityFeed | null
  error: string
}

/** Pure updater: React may evaluate it more than once before committing. */
export function reconcileGatewayActivityFeed(
  previous: GatewayActivityFeedSnapshot,
  feed: GatewayActivityFeed,
): GatewayActivityFeedSnapshot {
  const unchanged = previous.feed?.entries.length === feed.entries.length
    && previous.feed.entries.every((entry, index) => {
      const next = feed.entries[index]
      return entry.id === next.id && entry.timestamp === next.timestamp
        && entry.stream === next.stream && entry.message === next.message
        && entry.level === next.level && entry.source === next.source
        && entry.channel === next.channel && entry.direction === next.direction
    })
  if (unchanged) return previous.error ? { feed: previous.feed, error: '' } : previous
  return { feed, error: '' }
}
