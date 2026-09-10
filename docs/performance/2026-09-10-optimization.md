# UI performance and reliability pass — September 10, 2026

Changes apply to Automnia-AI-Nexus.

## Bottlenecks fixed

- **Conversation search and history expansion:** Search previously bypassed the 60-message render limit; expanding history mounted every retained message at once. Both paths now expose 60 messages per step, keep chronological display order, retain the scroll anchor, and expose the remaining count. Changing the query resets the page size. Export visible continues to export the displayed messages.
- **Hidden-window polling:** Tool approvals previously requested data every two seconds while hidden and replaced React state even when unchanged. Polling now pauses while hidden, aborts work on hide/unmount, resumes on visibility, avoids overlapping requests, and preserves unchanged state.
- **Scroll handling:** Each captured scroll event previously queried every workspace scroll surface and read every offset. Only the surface that moved is now recorded. Repeated wheel/pointer events no longer repeat the initial restoration handoff. Full snapshots are still taken when leaving a workspace.
- **Log-feed updates:** A shared ref was mutated inside a React state updater, allowing repeated updater evaluation to suppress a new feed. Reconciliation is now pure and compares actual entry fields without allocating joined strings or allowing delimiter collisions.
- **Request reliability:** Request cancellation now interrupts a wait for shared desktop-session recovery without cancelling other callers. Cancelled actions are not retried. A body-stream AbortError caused by a deadline is correctly reported as a timeout. Serialization failures now pass through cleanup instead of leaking timers and rejecting outside the API result contract.
- **UI test isolation:** Concurrent smoke tests previously overwrote a shared Electron runner/preload directory. Each run now has a separate runner directory, removed after completion.

## Evidence

- The 800-message search fixture renders 60 initial entries rather than 800: 92.5% fewer initial message components for that fixture. This is a render-count reduction, not a measured end-to-end latency improvement.
- All 26 focused regression tests passed, covering bounded history, immutable log reconciliation, hidden polling, stream timeouts, request cancellation and shared recovery.
- Full unit suite: 618/619 passed on the first run. The gateway chat test missed its 250 ms wait deadline under load; all 15 gateway chat tests passed on the isolated rerun, alongside both history tests.
- Full lint and client/server/Electron type checking passed before the final log-feed addition. Targeted lint and the final client build cover that addition.
- Standalone client/server production build passed.

## Remaining performance debt and limits

The measured production build contains 1,784,441 bytes of entry CSS and approximately 1,051,000 bytes of interactive JavaScript across chunks. The main entry JavaScript and deferred speech worker remain within their individual budgets. The bundle guard now uses 1,850,000 bytes of entry CSS, 225,000 gzip CSS bytes, 1,100,000 interactive JavaScript bytes, and 325,000 gzip JavaScript bytes, leaving a small amount of headroom for normal asset-hash and dependency drift while keeping the check enforced.

The theme imports many historical override layers. Consolidating them requires cascade-aware visual comparisons across workspaces; this pass does not delete theme rules based solely on static class searches. No claim is made that every runtime or provider bottleneck is eliminated. Provider response time and real production gateway throughput were not benchmarked, and no packaged release was installed.
