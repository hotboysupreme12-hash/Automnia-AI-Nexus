/** Dispatch independent chat recipients without coupling their completion times. */
export async function dispatchAgentChat<T>(
  agents: readonly T[],
  parallel: boolean,
  run: (agent: T) => Promise<{ cancelled?: boolean } | void>,
): Promise<void> {
  if (parallel) {
    await Promise.allSettled(agents.map(run))
    return
  }
  for (const agent of agents) {
    const result = await run(agent)
    if (result?.cancelled) break
  }
}
