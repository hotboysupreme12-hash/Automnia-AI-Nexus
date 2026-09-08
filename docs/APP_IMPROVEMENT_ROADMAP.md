# Application improvement roadmap

Updated 2026-09-07. 180 audited improvements: **87 complete, 70 partial, 23 planned**.

Complete means the described implementation is present and its recorded checks pass. Partial includes work that still needs implementation or the stated validation matrix. The full roadmap is not yet complete.

## Verification

- **fullUnitSuite:** 520/520 passed, including SQL fallback/replay, complete report evidence, upload ownership, API contracts, text batching and scheduler idempotency.
- **typecheck:** All application/server/Electron TypeScript checks passed before the latest scroll and responsive-CSS adjustments; final rerun in progress.
- **lint:** Full ESLint passes; final rerun will include the latest visual adjustments.
- **productionBuild:** Vite production build succeeds. Latest measured entry JS 457,019 bytes, CSS 1,708,103 bytes, total interactive JS 1,019,062 bytes. CSS and total JS exceed existing budgets; limits were not raised.
- **smokes:** Config-save, shell, interactive controls, contrast, font sizes, ledger, report and shift contracts pass. Filesystem smoke updated for captured save-agent identity; rerun in progress.
- **browser:** Earlier compact preview checked at 390px with no horizontal overflow and DOM reading order matching mobile placement. Live preview subsequently returned to sign-in; isolated fixture-based visual checks are being prepared.
- The full 180-item roadmap is not complete; partial and planned items remain explicit.
- No paid provider turns or production mission launches were performed.
- Older attachment files without server-owned upload records need to be uploaded again.
- Packaged restart, microphone hardware, forced-color, multi-display and complete interaction QA remain.

## Category progress

| Category | Total | Complete | Partial | Planned |
| --- | ---: | ---: | ---: | ---: |
| Performance and logic | 50 | 35 | 9 | 6 |
| Quality of life | 20 | 11 | 6 | 3 |
| Responsive interface | 30 | 0 | 30 | 0 |
| Smoother operation | 20 | 12 | 6 | 2 |
| Appearance | 20 | 1 | 9 | 10 |
| Product polish | 20 | 17 | 2 | 1 |
| Robustness | 20 | 11 | 8 | 1 |

## Performance and logic

### P01 · Release a timed-out runtime refresh and cancel its underlying probes.

**Status:** partial · **Priority:** P1 · **Effort:** M

Hung refresh generations retire and fresh attempts recover. Physical cancellation across every probe adapter remains.

**Purpose:** the Monitor can recover from one wedged dependency without restarting the app.

**Acceptance:** inject a never-settling probe, expire deadline, restore probe, and verify a subsequent refresh returns new data while the stale result cannot overwrite it.

**Audit evidence:** `server/services/runtime/runtimeStatusService.ts:125`. Locations refer to the audit snapshot and may shift.

### P02 · Run every configuration migration in one pass.

**Status:** complete · **Priority:** P1 · **Effort:** S

All configuration repair helpers run before the changed flag is evaluated.

**Purpose:** one read produces a fully repaired config and avoids repeated write/restart cycles.

**Acceptance:** a fixture requiring avatar cleanup, retired-agent pruning, Telegram repair, and compaction repair receives all repairs on its first read; second read performs no write.

**Audit evidence:** `server/controlPlane.ts:8786`. Locations refer to the audit snapshot and may shift.

### P03 · Serialize configuration read/modify/write transactions, not just final file writes.

**Status:** partial · **Priority:** P1 · **Effort:** M

Configuration snapshots support three-way merge inside the write queue, rebasing unrelated concurrent/external edits and rejecting same-field conflicts. Four merge regressions pass. Complete route-level and external-editor integration coverage remains.

**Purpose:** concurrent model/plugin/agent edits survive.

**Acceptance:** interleave two updates from the same initial revision and confirm both changes persist, including after external config modification.

**Audit evidence:** `server/controlPlane.ts:9756`. Locations refer to the audit snapshot and may shift.

### P04 · Require recovered mission output to belong to the current run.

**Status:** complete · **Priority:** P1 · **Effort:** M

Mission recovery requires current-run timestamp/provenance; scheduler regression fixtures pass.

**Purpose:** failed work cannot inherit success from earlier work.

**Acceptance:** a session contains an old successful answer followed by a current failed run; recovery must retain failure unless new run-specific evidence exists.

**Audit evidence:** `server/services/missions/missionSchedulerService.ts:663`. Locations refer to the audit snapshot and may shift.

### P05 · Keep successful agent answers successful when post-run maintenance fails.

**Status:** complete · **Priority:** P1 · **Effort:** M

Post-response maintenance errors are recorded separately from a successful provider answer.

**Purpose:** users receive completed work promptly and do not unnecessarily rerun paid turns.

**Acceptance:** inject permission errors into each maintenance operation; final answer remains `ok:true`, history is saved, and a maintenance issue is visible.

**Audit evidence:** `server/services/agents/agentStreamingService.ts:569`. Locations refer to the audit snapshot and may shift.

### P06 · Order direct-provider turns per conversation.

**Status:** complete · **Priority:** P1 · **Effort:** M

Direct-provider conversation turns serialize; concurrency regression tests pass.

**Purpose:** overlapping sends cannot silently lose conversation context.

**Acceptance:** start A and B for one session and finish B first; both turns remain correctly ordered or B is explicitly queued; different sessions still run concurrently.

**Audit evidence:** `server/services/agents/agentStreamingService.ts:439`, `server/controlPlane.ts:2862`. Locations refer to the audit snapshot and may shift.

### P07 · Make mission state/event persistence ordered and durably acknowledged.

**Status:** partial · **Priority:** P1 · **Effort:** L

Per-ledger append ordering and immutable snapshots are implemented and tested. End-to-end durable acknowledgement in mission lifecycle callers remains.

**Purpose:** crash recovery observes the latest real lifecycle rather than a stale or half-persisted one.

**Acceptance:** delay early writes, complete later writes first, then restart; newest sequence wins and every acknowledged transition has matching event evidence.

**Audit evidence:** `server/services/missions/missionStateService.ts:431`, `server/runtimeLedger.ts:834`. Locations refer to the audit snapshot and may shift.

### P08 · Fall back to JSONL when an already-open SQLite write fails.

**Status:** complete · **Priority:** P1 · **Effort:** M

SQLite write errors after opening fall back to JSONL even with mirroring disabled. Scoped readers reconcile both stores by stable IDs; injected SQL failure, replay, and restart tests pass.

**Purpose:** lock/disk/database errors do not silently drop the only record of a completed run.

**Acceptance:** force a SQLITE_BUSY/write error after opening the DB; the event is recoverable from fallback storage and the degraded state is reported without duplicate replay.

**Audit evidence:** `server/runtimeLedger.ts:833`. Locations refer to the audit snapshot and may shift.

### P09 · Build mission reports from complete mission evidence.

**Status:** complete · **Priority:** P2 · **Effort:** M

Mission reports await full mission evidence using paged SQLite reads and streaming JSONL reconciliation. Tests retain early failures, retries and operator evidence beyond 2,400 events and after restart.

**Purpose:** long missions retain accurate retries, interventions, failures, and verification evidence.

**Acceptance:** a mission with more than 300 events reports the same totals before and after restart and does not lose its early verification failure.

**Audit evidence:** `server/services/missions/missionReportService.ts:386`, `server/services/missions/missionStateService.ts:413`. Locations refer to the audit snapshot and may shift.

### P10 · Filter mission history in SQL before applying limits.

**Status:** complete · **Priority:** P2 · **Effort:** M

Mission-scoped SQL filters precede limits, with scoped JSONL fallback.

**Purpose:** old mission detail remains complete while fetching less unrelated data.

**Acceptance:** place the requested mission beyond the newest 1,000 global events/100 reports and verify its own paginated history is still retrievable.

**Audit evidence:** `server/services/missions/missionReportService.ts:507`, `server/runtimeLedger.ts:285`. Locations refer to the audit snapshot and may shift.

### P11 · Preserve a complete JSONL row at an exact tail boundary.

**Status:** complete · **Priority:** P2 · **Effort:** S

Tail reads inspect the preceding byte and preserve complete boundary rows; regression fixture passes.

**Purpose:** bounded reads do not silently drop a valid first row.

**Acceptance:** construct a ledger whose 512 KiB boundary starts exactly at a complete row and verify the row is retained; a genuinely partial row is discarded.

**Audit evidence:** `server/runtimeLedger.ts:125`, `server/services/gateway/gatewayLogService.ts:799`. Locations refer to the audit snapshot and may shift.

### P12 · Respect HTTP backpressure for streamed answers and console mirrors.

**Status:** complete · **Priority:** P2 · **Effort:** M

Downstream SSE consumers disconnect at 1 MiB queued output or 15 seconds without drain; direct responses and ClawTalk mirrors use the bounded writer.

**Purpose:** slow/background clients cannot create growing server output buffers or stall other clients.

**Acceptance:** throttle a client while streaming a large answer; queued bytes stay below a defined ceiling, final event ordering is preserved, and other clients remain responsive.

**Audit evidence:** `server/controlPlane.ts:5870`, `server/routes/agentTurnRoutes.ts:455`. Locations refer to the audit snapshot and may shift.

### P13 · Finish and release upstream SSE readers on every terminal path.

**Status:** complete · **Priority:** P2 · **Effort:** S

Upstream SSE readers release on terminal, abort, error, and truncated stream paths.

**Purpose:** final completion is not delayed by an upstream connection left open after `[DONE]`; resources are reclaimed.

**Acceptance:** send `[DONE]` but keep the socket open; the turn must finish promptly. Throw from a frame handler and verify the reader is cancelled/unlocked.

**Audit evidence:** `server/controlPlane.ts:6094`. Locations refer to the audit snapshot and may shift.

### P14 · Enforce the transcript budget on the final one or two messages too.

**Status:** complete · **Priority:** P2 · **Effort:** S

Final oversized history pairs obey the conversation character budget, with truncation context.

**Purpose:** one large request/answer cannot defeat the advertised conversation working-set limit.

**Acceptance:** a single 100,000-character user message and a large reply remain within the configured outbound budget while preserving an explicit user-visible truncation/attachment policy.

**Audit evidence:** `server/controlPlane.ts:2809`. Locations refer to the audit snapshot and may shift.

### P15 · Bound cumulative direct-provider response and reasoning buffers.

**Status:** partial · **Priority:** P2 · **Effort:** M

Raw upstream and compatible-provider buffers are bounded. Audit the SDK Codex streaming path.

**Purpose:** many small valid frames cannot grow memory without bound.

**Acceptance:** stream enough small frames to exceed the budget; memory remains bounded, upstream is cancelled, and saved content has an explicit truncation marker.

**Audit evidence:** `server/controlPlane.ts:6381`. Locations refer to the audit snapshot and may shift.

### P16 · Distinguish upstream stream errors and premature EOF from successful empty replies.

**Status:** partial · **Priority:** P2 · **Effort:** M

Compatible-provider error/empty/EOF classification is tested. Align every remaining provider adapter.

**Purpose:** provider failures produce actionable retry/error state instead of false success.

**Acceptance:** HTTP 200 followed by an error frame, malformed-only frames, or EOF before any answer must yield a classified failure; normal keepalives remain harmless.

**Audit evidence:** `server/controlPlane.ts:6383`, `server/services/agents/agentStreamingService.ts:571`. Locations refer to the audit snapshot and may shift.

### P17 · Reconcile accepted Gateway work before falling back to another transport.

**Status:** partial · **Priority:** P1 · **Effort:** L

Accepted or uncertain Gateway chat dispatch cannot be resubmitted through CLI fallback. Dispatch regressions pass. Reconnection reconciliation and the remaining CLI-to-local fallback path remain.

**Purpose:** avoids duplicate tool actions and duplicate provider work after ambiguous network failures.

**Acceptance:** Gateway accepts a tool-running turn then disconnects before its reply; fallback reconnects to that run or resolves its status, and the test tool executes exactly once.

**Audit evidence:** `server/services/agents/agentRuntimeService.ts:140`. Locations refer to the audit snapshot and may shift.

### P18 · Move synchronous SQLite work off the HTTP event loop.

**Status:** planned · **Priority:** P2 · **Effort:** L

**Purpose:** storage contention cannot block stream heartbeats, cancellations, and health requests.

**Acceptance:** measure event-loop delay and endpoint p95 while a DB lock is held; those endpoints continue serving within an agreed target while storage reports delay.

**Audit evidence:** `server/runtimeLedger.ts:207`. Locations refer to the audit snapshot and may shift.

### P19 · Make legacy ledger migration incremental and resumable.

**Status:** planned · **Priority:** P2 · **Effort:** L

**Purpose:** migration work scales with newly appended data rather than all history, with recovery after interruption.

**Acceptance:** import a large fixture, append a small tail, restart migration, and verify only the new tail is processed; interruption resumes without missing/duplicate rows.

**Audit evidence:** `server/runtimeLedger.ts:529`. Locations refer to the audit snapshot and may shift.

### P20 · Reuse prepared SQLite statements for hot ledger operations.

**Status:** complete · **Priority:** P3 · **Effort:** S

Prepared SQLite statements are cached per connection; 20 writes prepare once, and closing recreates the statement.

**Purpose:** reduces SQL preparation/allocation during rapid event writes.

**Acceptance:** statement preparation count stays constant across a repeated append/read workload; benchmark CPU and latency before/after without changing order or payloads.

**Audit evidence:** `server/runtimeLedger.ts:405`. Locations refer to the audit snapshot and may shift.

### P21 · Add a bounded retention policy for durable runtime telemetry.

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** long-running installations do not accumulate unlimited diagnostic data and ever-larger backups.

**Acceptance:** simulate the retention horizon and verify log/database size stabilizes, recent events remain queryable, and retained mission evidence is unchanged.

**Audit evidence:** `server/runtimeLedger.ts:97`. Locations refer to the audit snapshot and may shift.

### P22 · Tail session evidence once instead of reading entire transcripts twice.

**Status:** complete · **Priority:** P2 · **Effort:** M

Session evidence uses one bounded reverse scan instead of repeated complete transcript reads.

**Purpose:** recovery remains responsive for long agent sessions.

**Acceptance:** recover evidence near the end of a large fixture while reading a bounded suffix; if evidence is older, pagination finds it correctly and respects the current-run boundary from item 4.

**Audit evidence:** `server/services/missions/missionSchedulerService.ts:665`. Locations refer to the audit snapshot and may shift.

### P23 · Apply a resource-aware concurrency limit to mission dispatch.

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** large parties do not flood processes, provider connections, and memory; small foreground turns retain capacity.

**Acceptance:** a large party never exceeds configured active work, queued work stops on cancellation, and hierarchical/sequential ordering remains correct.

**Audit evidence:** `server/services/missions/missionSchedulerService.ts:1137`. Locations refer to the audit snapshot and may shift.

### P24 · Publish Team Sync snapshots atomically and in generation order.

**Status:** complete · **Priority:** P2 · **Effort:** M

Team Sync publishes through queued atomic renames and exclusive initialization.

**Purpose:** agents always read a complete current coordination snapshot.

**Acceptance:** continuously read while two snapshots publish with reversed I/O delays; every observed file is complete, the final file is the newest generation, and initialization never overwrites an existing file.

**Audit evidence:** `server/services/missions/missionTeamSyncService.ts:98`. Locations refer to the audit snapshot and may shift.

### P25 · Track result coverage in gateway log caches.

**Status:** complete · **Priority:** P2 · **Effort:** S

Gateway log cache records requested coverage and refreshes when a larger bounded tail is requested; coverage regressions pass.

**Purpose:** Monitor detail consistently receives the requested amount of available history.

**Acceptance:** call a small limit then a larger limit without changing files; larger call returns all available requested entries.

**Audit evidence:** `server/services/gateway/gatewayLogService.ts:1167`. Locations refer to the audit snapshot and may shift.

### P26 · Share in-flight log refreshes across callers.

**Status:** complete · **Priority:** P3 · **Effort:** S

Concurrent Gateway log readers share a single in-flight refresh; coalescing and coverage regressions pass.

**Purpose:** concurrent summary/status/activity requests perform one refresh rather than duplicate I/O.

**Acceptance:** issue concurrent cold reads and count one `logs.tail`/discovery pass; errors clear the in-flight slot and Monitor-clear generations cannot repopulate old entries.

**Audit evidence:** `server/services/gateway/gatewayLogService.ts:715`. Locations refer to the audit snapshot and may shift.

### P27 · Parse newly appended log bytes rather than repeatedly parsing whole tails.

**Status:** planned · **Priority:** P3 · **Effort:** M

**Purpose:** active logging costs track new log bytes instead of repeatedly parsing the same history.

**Acceptance:** append one line to a large file and read only the delta; rotation, same-name replacement, CRLF splits, and partial UTF-8 lines remain correct.

**Audit evidence:** `server/services/gateway/gatewayLogService.ts:819`. Locations refer to the audit snapshot and may shift.

### P28 · Reconcile independent recovered sessions with bounded parallelism.

**Status:** complete · **Priority:** P2 · **Effort:** M

Recovery reconciliation uses bounded parallel workers with an overall deadline.

**Purpose:** one slow session does not serially delay every recovered job.

**Acceptance:** multiple timed-out sessions finish within the agreed overall budget, request concurrency remains capped, and the result for every candidate is preserved.

**Audit evidence:** `server/services/missions/missionRecoveryService.ts:321`. Locations refer to the audit snapshot and may shift.

### P29 · Replace synchronous gcloud subprocess probes on request paths.

**Status:** partial · **Priority:** P2 · **Effort:** M

Request-time gcloud/ADC probes are async, cached, coalesced and abortable. Legacy synchronous status/environment projections remain.

**Purpose:** slow gcloud/auth refresh cannot freeze all server requests.

**Acceptance:** use a deliberately slow fake gcloud executable; status/abort/stream-heartbeat requests still run while auth probing is pending and cancellation terminates the child.

**Audit evidence:** `server/services/providers/providerSetupService.ts:256`. Locations refer to the audit snapshot and may shift.

### P30 · Single-flight OAuth refreshes per provider/account.

**Status:** complete · **Priority:** P2 · **Effort:** M

OAuth refresh is shared per provider/account and cannot overwrite a newly reconnected account.

**Purpose:** avoids token-refresh bursts and stale rotated-token writes.

**Acceptance:** many concurrent requests with one expired token perform one refresh and all receive the same valid credential; a failed refresh clears the single-flight slot for a later retry.

**Audit evidence:** `server/services/providers/providerSetupService.ts:685`. Locations refer to the audit snapshot and may shift.

### P31 · Consolidate the shipped theme cascade

**Status:** partial · **Priority:** P1 · **Effort:** L

Removed 1,660 unreachable selectors and about 244 KB of source CSS from older layers while preserving dynamic classes and compatibility fallbacks. Latest checked bundle CSS is 1,708,103 bytes; CSS and total interactive JS remain over existing budgets.

**Purpose:** Fresh build ships 1,763,113 CSS bytes, exceeding the existing 1,650,000 limit; replace obsolete overlapping rules with owned component rules.

**Acceptance:** Fresh build passes unchanged CSS budgets and responsive screenshots retain intended appearance.

**Audit evidence:** `src/automnia-app-theme.css:1`. Locations refer to the audit snapshot and may shift.

### P32 · Move optional help code out of the initial module graph

**Status:** complete · **Priority:** P2 · **Effort:** S

Help is a separate lazy chunk, loaded on demand.

**Purpose:** HelpAssistantPanel and its content/styles load eagerly although Help is optional; load on demand and prefetch on user intent.

**Acceptance:** Initial entry shrinks; first Help open has a meaningful fallback and retry.

**Audit evidence:** `src/components/layout/NexusShell.tsx:9`. Locations refer to the audit snapshot and may shift.

### P33 · Defer JSON serialization and skip identical durable writes

**Status:** complete · **Priority:** P1 · **Effort:** M

JSON storage serializes a buffered snapshot once per interval, skips identical durable strings, and preserves the previous saved value on quota failure.

**Purpose:** Existing storage debounce receives already-stringified state; buffer the object and serialize once per bounded interval.

**Acceptance:** 100 transient updates produce one serialization/write and continuous updates still periodically flush.

**Audit evidence:** `src/store/nexusStore.ts:150`. Locations refer to the audit snapshot and may shift.

### P34 · Coalesce command draft writes

**Status:** complete · **Priority:** P2 · **Effort:** S

Draft writes buffer typing and flush on route changes, page hide, and unload.

**Purpose:** Typing writes the entire draft to synchronous localStorage on every change; use a short bounded buffer with route-change/pagehide flush.

**Acceptance:** Rapid typing remains responsive and switching recipient or closing preserves final draft.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:896`. Locations refer to the audit snapshot and may shift.

### P35 · Batch ClawTalk text deltas before publishing renderer state

**Status:** complete · **Priority:** P2 · **Effort:** M

ClawTalk token deltas coalesce for 48 ms with bounded buffers. Start/final/error events flush preceding text. Burst, replacement, lane-order and cleanup regressions pass.

**Purpose:** Each frame clones response and runtime state; buffer text per run and flush at a controlled cadence, flushing terminal frames immediately.

**Acceptance:** Burst input preserves exact text/order with substantially fewer store commits.

**Audit evidence:** `src/store/nexusStore.ts:3492`. Locations refer to the audit snapshot and may shift.

### P36 · Reduce repeated scans of response history

**Status:** complete · **Priority:** P2 · **Effort:** M

History activity indexes use one pass, queue positions use a map, and immutable response search text is cached in a WeakMap. An 800-entry fixture verifies ordering, identity, queue counts and changed-text search.

**Purpose:** ClawTalk and direct turn paths repeatedly find/map the response array; maintain indexed updates without invalidating unrelated entries.

**Acceptance:** Large multi-agent fixtures preserve order and update only changed entries.

**Audit evidence:** `src/store/nexusStore.ts:3518`. Locations refer to the audit snapshot and may shift.

### P37 · Isolate composer keystroke state from transcript rendering

**Status:** complete · **Priority:** P2 · **Effort:** M

Transcript mapping is behind a memo boundary with stable response, metadata and callback props. Composer text and voice meter state no longer rebuild its message subtree.

**Purpose:** One large component owns draft, microphone, response list and diagnostics; give composer its own boundary while retaining existing memoized messages.

**Acceptance:** Typing and voice level changes do not rerender the transcript subtree.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:789`. Locations refer to the audit snapshot and may shift.

### P38 · Subscribe registry cards to activity summaries

**Status:** complete · **Priority:** P2 · **Effort:** M

Roster activity selectors retain identity when only streamed answer text changes; regression test verifies it.

**Purpose:** Roster subscribes to full responses just to derive activity; provide stable per-agent activity summaries.

**Acceptance:** Streaming answer text does not recompute an unchanged roster activity map.

**Audit evidence:** `src/components/party/PartySelector.tsx:233`. Locations refer to the audit snapshot and may shift.

### P39 · Expand search intent once per query

**Status:** complete · **Priority:** P2 · **Effort:** S

Search intent expansion happens once per query.

**Purpose:** Token normalization and fuzzy intent expansion run separately for every agent even though search already uses deferred values and an index.

**Acceptance:** Ranking is identical and expansion executes once per deferred query.

**Audit evidence:** `src/components/party/PartySelector.tsx:201`. Locations refer to the audit snapshot and may shift.

### P40 · Bound typo-distance computation

**Status:** complete · **Priority:** P2 · **Effort:** S

Typo distance rejects impossible lengths and stops outside a bounded edit band.

**Purpose:** Levenshtein allocates full rows and compares long unequal words despite a small match threshold; reject length gaps and stop rows above threshold.

**Acceptance:** Known typo matches remain identical; adversarial long searches finish without long UI tasks.

**Audit evidence:** `src/components/party/PartySelector.tsx:162`. Locations refer to the audit snapshot and may shift.

### P41 · Avoid emitting operational log lines for each text delta

**Status:** complete · **Priority:** P2 · **Effort:** S

ClawTalk token deltas no longer create operational log lines.

**Purpose:** Every ClawTalk delta appends a formatted log line although it is answer text, creating repetitive allocation and monitor churn.

**Acceptance:** Start/progress/final/error remain logged while text deltas only update the answer.

**Audit evidence:** `src/store/nexusStore.ts:3605`. Locations refer to the audit snapshot and may shift.

### P42 · Use real elapsed time for ClawTalk uptime

**Status:** complete · **Priority:** P1 · **Effort:** S

ClawTalk uptime uses elapsed time rather than increments per event.

**Purpose:** Uptime advances by 1,000ms for each incoming frame; token frequency therefore distorts activity metrics.

**Acceptance:** A one-second burst of 100 frames reports approximately one second, not 100 seconds.

**Audit evidence:** `src/store/nexusStore.ts:3609`. Locations refer to the audit snapshot and may shift.

### P43 · Release an idle local speech worker

**Status:** complete · **Priority:** P2 · **Effort:** M

Local speech workers release after two idle minutes and restart when needed.

**Purpose:** The worker/model stays alive indefinitely after first use; release after an idle grace period with no requests, recreating on demand.

**Acceptance:** Worker is reused for consecutive dictations and released after idle without interrupting active recognition.

**Audit evidence:** `src/speech/localSpeechClient.ts:23`. Locations refer to the audit snapshot and may shift.

### P44 · Cancel obsolete activity-feed requests

**Status:** complete · **Priority:** P2 · **Effort:** S

Activity fetches abort on unmount, changed query limits, or monitor clearing; stale results are ignored.

**Purpose:** Unmount stops timers but leaves the fetch active; abort when the consumer closes or changes its query.

**Acceptance:** Closing Settings cancels its request and obsolete responses cannot update a reopened query.

**Audit evidence:** `src/hooks/useGatewayActivityFeed.ts:41`. Locations refer to the audit snapshot and may shift.

### P45 · Continue local runtime monitoring without internet

**Status:** complete · **Priority:** P1 · **Effort:** S

Loopback runtime polling continues when the internet is offline.

**Purpose:** navigator.onLine currently suppresses even loopback API polling; distinguish local reachability from internet access.

**Acceptance:** A local runtime continues updating while the machine has no network route.

**Audit evidence:** `src/hooks/useRuntimeStatus.ts:1092`. Locations refer to the audit snapshot and may shift.

### P46 · Track successful fetch age independently from semantic changes

**Status:** complete · **Priority:** P2 · **Effort:** S

Successful fetch receipt time is recorded separately from semantic snapshot changes.

**Purpose:** When semantic data is unchanged, the old generatedAt remains in cached status; use a separate successful-fetch timestamp for cache eligibility.

**Acceptance:** Unchanged responses refresh cache freshness without unnecessary React updates.

**Audit evidence:** `src/hooks/useRuntimeStatus.ts:1366`. Locations refer to the audit snapshot and may shift.

### P47 · Unify hidden-window work policy

**Status:** partial · **Priority:** P2 · **Effort:** M

Settings activity and shared runtime polling now honor focus/visibility. Audit all hidden-window timers and Electron background work.

**Purpose:** Electron disables background throttling; shared status has a focus guard but activity feed checks only document.hidden. Propagate actual visibility/focus and keep runtime execution server-owned.

**Acceptance:** Minimized and unfocused windows pause nonessential rendering/polling while server missions continue.

**Audit evidence:** `electron/main.cjs:1888`. Locations refer to the audit snapshot and may shift.

### P48 · Coalesce split-pane CSS writes to animation frames

**Status:** complete · **Priority:** P3 · **Effort:** S

Splitter styles update at most once per animation frame and commit final width on release.

**Purpose:** Dragging already avoids React and commits preferences once, but writes layout CSS on every pointer event; publish only the latest coordinate each frame.

**Acceptance:** High-rate pointer input results in at most one CSS width update per frame and final width persists.

**Audit evidence:** `src/components/layout/NexusShell.tsx:394`. Locations refer to the audit snapshot and may shift.

### P49 · Serve appropriately sized portrait variants

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Lazy loading exists; cards and tiny party avatars can additionally select bounded image derivatives by rendered size and pixel density.

**Acceptance:** Small avatars avoid full portrait downloads and decode memory drops without blurry high-DPI cards.

**Audit evidence:** `src/components/party/AgentCard.tsx:190`. Locations refer to the audit snapshot and may shift.

### P50 · Move optional writable-runtime copying off the Electron main thread

**Status:** complete · **Priority:** P2 · **Effort:** M

Optional writable-runtime provisioning uses asynchronous filesystem copying; Electron type and window-placement checks pass.

**Purpose:** The opt-in non-Windows writable-runtime setup performs recursive synchronous copy; run it asynchronously with staging and progress.

**Acceptance:** Large first-copy fixture keeps desktop window responsive and ready marker appears only after complete copy.

**Audit evidence:** `electron/main.cjs:513`. Locations refer to the audit snapshot and may shift.

## Quality of life

### Q01 · Save and switch named teams

**Status:** complete · **Priority:** P2 · **Effort:** M

Named local teams support saving, loading valid members in order, removal, and mission lock checks.

**Purpose:** The party strip supports arranging and confirming one active team. Named team presets would remove repeated roster assembly.

**Acceptance:** Saving two ordered teams and reopening the app preserves both; switching checks missing agents and restores order without clearing chats.

**Audit evidence:** `src/components/party/ActivePartyStrip.tsx:98`, `src/store/nexusStore.ts:3629`. Locations refer to the audit snapshot and may shift.

### Q02 · Save personal mission templates

**Status:** complete · **Priority:** P2 · **Effort:** M

Named mission templates can be saved, loaded for editing, updated, duplicated, and removed; validation strips execution state.

**Purpose:** Built-in presets already preserve a custom objective. Let users save a complete named template containing objective, evidence, timing and collaboration choices.

**Acceptance:** A custom template can be created, edited, duplicated and used after restart with all selected fields restored.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:384`. Locations refer to the audit snapshot and may shift.

### Q03 · Create a fresh mission from a past run

**Status:** complete · **Priority:** P2 · **Effort:** M

A retained mission can open as a fresh editable draft with currently available agents and no copied run ID.

**Purpose:** History currently displays past missions as plain rows. A Run again action would reuse the useful configuration without copying terminal state.

**Acceptance:** Run again opens an editable draft with prior objective/settings and current agent availability, and deploys under a new mission ID.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:61`. Locations refer to the audit snapshot and may shift.

### Q04 · Browse every retained mission report

**Status:** complete · **Priority:** P2 · **Effort:** M

Report selection covers retained mission history with on-demand loading and retry.

**Purpose:** The report panel always selects missionReports[0]. A report picker would make earlier evidence and outcomes usable.

**Acceptance:** Selecting a historical mission displays its matching report and clearly identifies missing reports without showing the latest unrelated report.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:17`. Locations refer to the audit snapshot and may shift.

### Q05 · Search conversation history by text and agent

**Status:** complete · **Priority:** P2 · **Effort:** M

Retained conversation search matches prompt, response, and agent name.

**Purpose:** The console displays response rows with no conversation search control. Searching would make previous instructions and answers retrievable.

**Acceptance:** Search supports agent, date and status filters, highlights matches, and jumps to the selected message with its surrounding context.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:2046`. Locations refer to the audit snapshot and may shift.

### Q06 · Copy and export complete responses

**Status:** complete · **Priority:** P2 · **Effort:** S

Individual responses copy as plain text and visible conversations export as JSON.

**Purpose:** Responses currently render plain text and restart/cancel actions. Dedicated copy and transcript export would avoid selecting long nested scroll regions manually.

**Acceptance:** Copy preserves the full response including line breaks; transcript export includes role, agent and timestamp and does not silently truncate text.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:663`, `src/components/monitor/AgentResponseConsole.tsx:754`. Locations refer to the audit snapshot and may shift.

### Q07 · Keep a reusable prompt library

**Status:** complete · **Priority:** P3 · **Effort:** M

Saved prompt library persists up to 30 named drafts and supports insertion and removal.

**Purpose:** A searchable set of named prompt snippets would reduce repeated typing while retaining the existing per-route drafts.

**Acceptance:** Insert a snippet with named variables into the current draft, preview resolved text, and save edited snippets without sending them automatically.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1534`, `src/components/monitor/AgentResponseConsole.tsx:2150`. Locations refer to the audit snapshot and may shift.

### Q08 · Edit and reorder queued follow-ups

**Status:** partial · **Priority:** P2 · **Effort:** M

Waiting renderer follow-ups can be edited or moved within their agent queue. Dispatch prompts are rebuilt with existing routing context and attachments, and edits after release explain the conflict. Server-owned queue migration and live race QA remain.

**Purpose:** Queue positions and cancellation already exist. Editing or reordering queued turns would let users refine pending work before it starts.

**Acceptance:** Only unstarted turns can be edited/reordered; server-confirmed queue positions update and attempts to edit a started turn explain the conflict.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:567`, `src/components/monitor/AgentResponseConsole.tsx:1153`. Locations refer to the audit snapshot and may shift.

### Q09 · Attach several files by drop or paste

**Status:** partial · **Priority:** P2 · **Effort:** M

Composer accepts multiple files by input, drop or paste, with eight-file, per-file and total draft-memory bounds, individual previews/removal, and retry of failed uploads. Browser file-picker and provider delivery QA remains.

**Purpose:** The input consumes files[0] and holds one attachment. A multi-file tray with paste/drop support would enable comparison tasks in one turn.

**Acceptance:** Select, drop or paste multiple supported files; each has its own preview/remove control, and a failed upload can be retried without losing successful files.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1616`, `src/components/monitor/AgentResponseConsole.tsx:2172`. Locations refer to the audit snapshot and may shift.

### Q10 · Collect output files in a mission artifact shelf

**Status:** planned · **Priority:** P2 · **Effort:** L

**Purpose:** Results are presented as text and evidence counters. An artifact shelf would make produced files easy to find and open after a run.

**Acceptance:** Produced artifacts show filename, creating run and availability; users can open/reveal them, and moved or deleted files get a recoverable missing-file state.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:679`, `src/components/monitor/MissionReportPanel.tsx:35`. Locations refer to the audit snapshot and may shift.

### Q11 · Save named workspace profiles

**Status:** partial · **Priority:** P3 · **Effort:** M

Named local workspace profiles capture appearance, registry and console layout, support apply, rename, update-to-current, removal and undo. Restore writes related keys as one rollback-capable transaction and preserves draft retention. Recovery and duplicate-name tests pass; full multi-profile browser workflow verification remains.

**Purpose:** Console width/visibility and registry preferences already persist individually. Profiles would switch these together for writing, monitoring or roster work.

**Acceptance:** Two named profiles restore their own console and registry preferences; a profile can be updated, renamed and removed independently.

**Audit evidence:** `src/components/settings/workspaceSettings.ts:158`, `src/components/party/PartySelector.tsx:354`. Locations refer to the audit snapshot and may shift.

### Q12 · Add a searchable command palette

**Status:** complete · **Priority:** P2 · **Effort:** M

Searchable command palette routes to workspaces and settings; keyboard navigation and Ctrl/Cmd+K included.

**Purpose:** Alt-number workspace shortcuts already exist. A palette would expose navigation, agent selection and contextual actions without requiring shortcut memorization.

**Acceptance:** A keyboard shortcut opens a searchable palette; unavailable actions show a reason, and opening it from a text field preserves the draft.

**Audit evidence:** `src/components/layout/NexusShell.tsx:475`. Locations refer to the audit snapshot and may shift.

### Q13 · Favorite models and show recent selections

**Status:** complete · **Priority:** P3 · **Effort:** S

Shared model pickers expose favorites and eight recent selections. Persisted lists are bounded; unavailable models remain labeled and disabled. Preference and rendered-option regressions pass.

**Purpose:** Provider grouping and fallbacks exist. Favorites and recents would reduce searching through long provider model lists.

**Acceptance:** Favorite and recent models appear in stable lists; unavailable or entitlement-blocked entries remain labeled and cannot be selected accidentally.

**Audit evidence:** `src/components/models/ModelPicker.tsx:108`, `src/components/models/ModelPicker.tsx:236`. Locations refer to the audit snapshot and may shift.

### Q14 · Import preferences and export a backup file

**Status:** complete · **Priority:** P2 · **Effort:** M

Versioned preference files export/import with validation and a preview of selected groups.

**Purpose:** Clipboard backup already exists, but the UI has no restore counterpart. A validated file round trip would make those backups practical.

**Acceptance:** Export a versioned JSON file, preview recognized fields on import, apply the selected fields, and reject unsupported/corrupt files without changing settings.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:508`, `src/components/settings/SettingsPanel.tsx:796`. Locations refer to the audit snapshot and may shift.

### Q15 · Choose and test the microphone

**Status:** complete · **Priority:** P2 · **Effort:** M

Voice settings select and locally test a microphone; recording falls back explicitly when the selected device disappears.

**Purpose:** Voice settings cover noise suppression, echo cancellation and gain, but do not let users choose or test a specific microphone.

**Acceptance:** Users can select an available microphone and run a local level/playback test; unplugging it explains the fallback device and preserves the preference.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:635`. Locations refer to the audit snapshot and may shift.

### Q16 · Preview a schedule and skip its next occurrence

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Pause controls and next-run display already exist. Previewing the next five occurrences before launch and skipping one occurrence would improve scheduling confidence.

**Acceptance:** Preview displays timezone and five fire times from the actual scheduler rules; Skip next skips exactly one occurrence and resumes the original cadence.

**Audit evidence:** `src/components/monitor/HeartbeatSchedulerPanel.tsx:279`, `src/components/monitor/LiveOperationMonitor.tsx:109`, `src/components/monitor/LiveOperationMonitor.tsx:1121`. Locations refer to the audit snapshot and may shift.

### Q17 · Notify on completion or required attention

**Status:** partial · **Priority:** P2 · **Effort:** M

Opt-in background completion/attention notifications observe transitions without polling, suppress repeat terminal updates and keep message content private. Permission controls are in Workspace settings. Failures-only mode, quiet hours and navigation to the exact run remain.

**Purpose:** Run status is visible in the app. Configurable desktop completion/failure notifications would let users work elsewhere without monitoring the window.

**Acceptance:** Notification preferences support failures-only and quiet hours; one terminal event produces one notification whose click opens the correct run.

**Audit evidence:** `src/components/layout/NexusShell.tsx:159`, `src/components/monitor/AgentResponseConsole.tsx:570`. Locations refer to the audit snapshot and may shift.

### Q18 · Bookmark important runs and answers

**Status:** partial · **Priority:** P3 · **Effort:** M

Response and mission report bookmarks retain local snapshots with notes, search, export, undo removal and explicit missing-original notices. Bounded schema recovery tests pass. Cross-restart browser workflow verification remains.

**Purpose:** The activity feed is transiently ordered and capped. Bookmarks would retain a direct route to decisions and useful answers.

**Acceptance:** Bookmark a response or run, add a short note, and reopen it after restart; deleting an underlying record leaves an explicit unavailable entry.

**Audit evidence:** `src/components/settings/SettingsActivityLog.tsx:180`, `src/components/monitor/AgentResponseConsole.tsx:525`. Locations refer to the audit snapshot and may shift.

### Q19 · Clone an existing custom agent

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Recruit already supports agency templates and a clean slate. Cloning a user's tuned agent would preserve useful policy work when creating a specialist variant.

**Acceptance:** Clone opens the recruit draft with a unique ID/name and chosen profile/policy/files; sessions, live state and credentials are not copied as independent secrets.

**Audit evidence:** `src/components/recruit/RecruitAgentModal.tsx:389`, `src/components/recruit/RecruitAgentModal.tsx:739`. Locations refer to the audit snapshot and may shift.

### Q20 · Add a guided first-success checklist

**Status:** partial · **Priority:** P2 · **Effort:** M

Persistent first-success guide reflects agent/model/team/finished-response state and links to setup steps. It stays collapsed for an existing team. Live provider configuration and completion browser verification remain.

**Purpose:** Authentication gates and help playbooks exist. A resumable setup checklist would connect sign-in, provider, agent and first verified result.

**Acceptance:** Checklist items reflect actual configured state, deep-link to each setup step, resume after restart and finish after a small successful test run.

**Audit evidence:** `src/App.tsx:20`, `src/components/help/HelpAssistantPanel.tsx:474`. Locations refer to the audit snapshot and may shift.

## Responsive interface

### UI01 · Repair the roster filter cascade

**Status:** partial · **Priority:** P1 · **Effort:** M

Roster toolbar cascade repaired and checked at 390px. Remaining 320px/zoom/splitter matrix pending.

**Purpose:** Parent preview at 390px found sort/rarity/theme selectors and List beyond the visible panel, despite no document overflow

**Acceptance:** Verify every filter's bounding box is inside its panel at 320/390/768px and while resizing the console.

**Audit evidence:** `src/styles/automnia-theme/90-reference-screenshot.css:4811`, `src/styles/automnia-theme/100-operator-experience.css:2241`. Locations refer to the audit snapshot and may shift.

### UI02 · Rebuild the compact header's status layout as a single owned grid, resetting inherited alignment and track sizing

**Status:** partial · **Priority:** P1 · **Effort:** M

Compact status grid repaired and checked at 390px. Enlarged-text and remaining status matrix pending.

**Purpose:** Parent 390×844 preview showed tiny empty-looking status boxes consuming roughly 300px vertically

**Acceptance:** Verify actual label/value visibility and header height at 320–600px, enlarged text, and all loading/offline states; do not rely solely on document scrollWidth.

**Audit evidence:** `src/styles/automnia-theme/90-reference-screenshot.css:562`, `src/styles/automnia-theme/106-responsive-ux.css:162`. Locations refer to the audit snapshot and may shift.

### UI03 · Keep Settings and Help discoverable in compact navigation: use an explicit overflow menu or labeled compact layout, with overflow affordances and active-item reveal

**Status:** partial · **Priority:** P1 · **Effort:** M

All navigation destinations are visible in checked compact layout. Complete keyboard/touch and screen-size matrix.

**Purpose:** Parent preview placed Settings at x361–419 and Help at x419–477 in a 390px viewport

**Acceptance:** Horizontal scrolling exists; the improvement is discoverability and guaranteed keyboard/touch access. Verify all seven destinations can be found and activated without guessing a hidden swipe.

**Audit evidence:** `src/styles/automnia-theme/106-responsive-ux.css:93`. Locations refer to the audit snapshot and may shift.

### UI04 · Keep the composer within reach on short laptops by offering a compact party summary and chat-first stacked layout

**Status:** partial · **Priority:** P1 · **Effort:** M

Compact stacked layout prioritizes chat. Verify short laptops and 200% scaling.

**Purpose:** Parent 1024×768 preview showed two party rows plus registry before chat

**Acceptance:** Verify a focused command can be entered without first scrolling through the roster at 1024×768, 1366×768, and 200% zoom.

**Audit evidence:** `src/styles/automnia-theme/132-responsive-viewport.css:30`. Locations refer to the audit snapshot and may shift.

### UI05 · Introduce a shared modal focus lifecycle: save invoker, focus first meaningful element, trap Tab, inert background, and restore focus

**Status:** partial · **Priority:** P1 · **Effort:** M

Shared dialog focus trap, inert background and invoker restoration implemented. Complete nested auth/overlay interaction checks.

**Purpose:** Prevent keyboard users from landing behind overlays

**Acceptance:** Verify Tab/Shift+Tab remain inside each modal and focus returns to the originating control, including provider auth opened from an editor.

**Audit evidence:** `src/components/help/HelpAssistantPanel.tsx:371`, `src/components/auth/ProviderAuthModal.tsx:336`, `src/components/monitor/LiveOperationMonitor.tsx:746`. Locations refer to the audit snapshot and may shift.

### UI06 · Give agent/model editors correct dialog semantics and a shared close-key contract

**Status:** partial · **Priority:** P1 · **Effort:** S

Editor/model dialogs have titles and close-key handling. File autosave failures now keep the editor open; finish interaction QA.

**Purpose:** Screen readers identify the current task and keyboard closing respects saves

**Acceptance:** Verify announced titles, nested-modal Escape behavior, and autosave completion before editor closure.

**Audit evidence:** `src/components/editor/AgentEditorModal.tsx:1490`, `src/components/party/ModelSelectorModal.tsx:314`. Locations refer to the audit snapshot and may shift.

### UI07 · Make party removal reachable without hover

**Status:** partial · **Priority:** P1 · **Effort:** S

Party removal is exposed to focus/touch; complete touch matrix.

**Purpose:** Keyboard and touch users can remove any selected member

**Acceptance:** Verify removal with keyboard only and on a touch simulator without synthetic hover.

**Audit evidence:** `src/components/party/ActivePartyStrip.tsx:187`. Locations refer to the audit snapshot and may shift.

### UI08 · Add accessible party reordering controls beside existing HTML drag-and-drop

**Status:** partial · **Priority:** P2 · **Effort:** M

Party reorder controls added alongside drag/drop; complete mission-lock and edge-slot checks.

**Purpose:** Party order can be managed with touch, switch input, and keyboard

**Acceptance:** Validate first/last slots, mission-locked state, and equivalent resulting order across input methods.

**Audit evidence:** `src/components/party/ActivePartyStrip.tsx:198`. Locations refer to the audit snapshot and may shift.

### UI09 · Complete tab semantics and navigation in agent settings and recruit files

**Status:** partial · **Priority:** P2 · **Effort:** M

Editor/recruit tabs support roving Arrow/Home/End navigation; complete assistive-technology QA.

**Purpose:** Long tab rows become efficient for keyboard users

**Acceptance:** Verify one tab stop per group, matching panel labels, arrow navigation, and scrolling the selected tab into view.

**Audit evidence:** `src/components/editor/AgentEditorModal.tsx:1510`, `src/components/recruit/RecruitAgentModal.tsx:1955`. Locations refer to the audit snapshot and may shift.

### UI10 · Complete custom model-listbox keyboard interaction

**Status:** partial · **Priority:** P2 · **Effort:** M

Model menus support keyboard selection, typeahead and disabled options; complete multi-dialog QA.

**Purpose:** Hundreds of models can be selected predictably without tabbing through each option

**Acceptance:** Validate opening focus, selection, typeahead, disabled states, and focus return.

**Audit evidence:** `src/components/models/ModelPicker.tsx:398`. Locations refer to the audit snapshot and may shift.

### UI11 · Position model menus relative to available viewport space using a portal/popover with collision handling

**Status:** partial · **Priority:** P2 · **Effort:** M

Model menus portal into available viewport space; complete 390px/768px/zoom collision matrix.

**Purpose:** Prevent menus from being clipped by scrolling/overflow ancestors near the lower edge

**Acceptance:** Validate bottom/right-edge triggers in all modals at 390px, 768px, and 200% zoom.

**Audit evidence:** `src/components/models/ModelPicker.tsx:435`. Locations refer to the audit snapshot and may shift.

### UI12 · Generate instance-unique model-picker IDs with useId

**Status:** partial · **Priority:** P2 · **Effort:** S

Model picker instance IDs use useId; verify concurrent identical-provider instances.

**Purpose:** Multiple picker instances or layered dialogs keep aria-controls connected to the correct popup

**Acceptance:** Validate two identical-provider pickers mounted simultaneously with unique IDs and correct accessibility relationships.

**Audit evidence:** `src/components/models/ModelPicker.tsx:346`. Locations refer to the audit snapshot and may shift.

### UI13 · Associate all mission labels and units with their inputs using the existing Field primitive

**Status:** partial · **Priority:** P1 · **Effort:** S

Mission inputs gained associated labels/names; audit remaining units and all fields.

**Purpose:** Voice control and screen readers can distinguish title, interval, and interval units

**Acceptance:** Verify label clicking focuses its field and accessibility names remain meaningful without placeholder text.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:491`. Locations refer to the audit snapshot and may shift.

### UI14 · Expose launch readiness as a named meter plus a textual checklist of missing requirements

**Status:** partial · **Priority:** P2 · **Effort:** S

Form readiness is a named meter with a checklist and links to missing inputs; screen-reader QA remains.

**Purpose:** Users understand why launch is blocked without relying on color or hover

**Acceptance:** Verify all requirements and changing readiness are accessible by touch and screen reader.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:722`. Locations refer to the audit snapshot and may shift.

### UI15 · Add selection semantics to view and effort controls

**Status:** partial · **Priority:** P2 · **Effort:** S

Roster view, mission choice and model controls expose selected/pressed state. Complete selection-control accessibility matrix remains.

**Purpose:** Assistive technology can report the selected list/grid mode and effort

**Acceptance:** Validate one selected value and the same result after reload.

**Audit evidence:** `src/components/party/PartySelector.tsx:538`, `src/components/party/ModelSelectorModal.tsx:417`. Locations refer to the audit snapshot and may shift.

### UI16 · Extend authentication scroll accommodation to short wide windows, not only narrow phones

**Status:** partial · **Priority:** P1 · **Effort:** S

Shared/auth overlay sizing accommodates short viewports; complete short-wide setup test.

**Purpose:** Account setup remains reachable in landscape and split-screen windows

**Acceptance:** Verify the full setup form, error message, submit, and footer at 880×600 and 1024×600, as well as 200% text zoom.

**Audit evidence:** `src/styles/automnia-theme/106-responsive-ux.css:328`, `src/components/auth/LoginModal.tsx:84`. Locations refer to the audit snapshot and may shift.

### UI17 · Make overlay sizing follow dynamic/visual viewport height and safe areas

**Status:** partial · **Priority:** P2 · **Effort:** S

Shared dialog safe-area and dynamic-height sizing implemented; software keyboard/orientation checks remain.

**Purpose:** Browser toolbars and virtual keyboards no longer cover focused fields or save controls

**Acceptance:** Verify open keyboards, orientation changes, and a short Electron window.

**Audit evidence:** `src/components/auth/ProviderAuthModal.tsx:339`, `src/components/party/ModelSelectorModal.tsx:314`, `src/components/monitor/LiveOperationMonitor.tsx:749`. Locations refer to the audit snapshot and may shift.

### UI18 · Align reading/tab order with the mobile visual order

**Status:** partial · **Priority:** P2 · **Effort:** M

Pane DOM order follows the computed grid layout so mobile reading/tab order matches chat-before-registry placement while desktop order follows its columns. Mobile DOM order checked; full responsive/assistive-technology matrix remains.

**Purpose:** Keyboard traversal matches what a user sees

**Acceptance:** Validate tab and screen-reader order after switching between desktop and mobile breakpoints without losing the current draft.

**Audit evidence:** `src/components/layout/NexusShell.tsx:886`, `src/styles/automnia-theme/104-responsive-fit.css:160`. Locations refer to the audit snapshot and may shift.

### UI19 · Allow agent cards to grow with content and user text settings rather than fixing min/max height together

**Status:** partial · **Priority:** P2 · **Effort:** M

Authoritative responsive card sizing permits height to grow with content instead of fixing matching minimum/maximum heights. Enlarged-text and action visibility visual checks remain.

**Purpose:** Long roles, localization, and larger fonts keep actions visible

**Acceptance:** Validate long names, long model IDs, 200% text scaling, and each simple/detailed/theme mode.

**Audit evidence:** `src/styles/automnia-theme/132-responsive-viewport.css:80`, `src/components/party/AgentCard.tsx:226`. Locations refer to the audit snapshot and may shift.

### UI20 · Make roster column selection depend on available panel width and minimum readable card width

**Status:** partial · **Priority:** P2 · **Effort:** M

Roster columns use panel width and minimum readable rem widths with auto-fill instead of viewport-only fixed counts. Split-pane and multi-viewport visual checks remain.

**Purpose:** Cards stay usable in narrow split panes on otherwise wide monitors

**Acceptance:** Validate live splitter movement and all density/display modes, rather than only full-window breakpoints.

**Audit evidence:** `src/styles/automnia-theme/132-responsive-viewport.css:71`. Locations refer to the audit snapshot and may shift.

### UI21 · Add visible names/tooltips to icon-only collapsed desktop navigation

**Status:** partial · **Priority:** P2 · **Effort:** S

Collapsed navigation has portal tooltips for keyboard focus and pointer hover, including Recruit, Settings and Help. Tooltip placement is viewport-clamped and dismissed on Escape, scroll, resize or blur. Multi-viewport tooltip collision verification remains.

**Purpose:** New users can identify custom pictograms with mouse or keyboard

**Acceptance:** Verify label visibility without covering the next action, including Settings and Help.

**Audit evidence:** `src/styles/automnia-theme/104-responsive-fit.css:101`, `src/components/layout/NexusShell.tsx:627`. Locations refer to the audit snapshot and may shift.

### UI22 · Include top safe-area height in the main content offset

**Status:** partial · **Priority:** P2 · **Effort:** S

Compact shell accounts for top safe area; physical inset/orientation QA remains.

**Purpose:** Notched/mobile landscape screens keep the first heading below the navigation

**Acceptance:** Validate nonzero safe-area insets and both orientations.

**Audit evidence:** `src/styles/automnia-theme/106-responsive-ux.css:41`. Locations refer to the audit snapshot and may shift.

### UI23 · Add a coarse-pointer target-size override to shared controls and compact party actions

**Status:** partial · **Priority:** P2 · **Effort:** M

Shared controls and compact party actions have a coarse-pointer target-size override. Real touch-device matrix remains.

**Purpose:** Touch laptops/tablets get forgiving targets without changing desktop density

**Acceptance:** Validate at least 44px hit areas, no overlaps, and continued scrolling on touch.

**Audit evidence:** `src/styles/tokens.css:41`, `src/styles/automnia-theme/128-active-party-density.css:19`. Locations refer to the audit snapshot and may shift.

### UI24 · Extend Windows forced-color support beyond focus rings

**Status:** partial · **Priority:** P2 · **Effort:** M

Forced-color rules cover controls, surfaces, selection and status distinctions. Windows high-contrast validation remains.

**Purpose:** High-contrast users can distinguish selected, disabled, and destructive controls

**Acceptance:** Validate actual forced-color mode, including native select arrows and selected party/chat states.

**Audit evidence:** `src/styles/accessibility.css:64`. Locations refer to the audit snapshot and may shift.

### UI25 · Restore a readable minimum text scale for operational status metadata

**Status:** partial · **Priority:** P1 · **Effort:** M

Console font-size smoke passes after raising undersized metadata. Complete computed-size review at all zoom levels.

**Purpose:** HiDPI and lower-acuity users can read status without magnifying the whole app

**Acceptance:** Verify computed sizes and representative output at 100%, 125%, 200%, plus the app's default zoom.

**Audit evidence:** `src/styles/automnia-theme/124-chat-status-clarity.css:56`, `src/styles/automnia-theme/128-active-party-density.css:70`. Locations refer to the audit snapshot and may shift.

### UI26 · Synchronize splitter accessibility values with the actual clamped range

**Status:** partial · **Priority:** P2 · **Effort:** S

Splitter minimum, maximum and current ARIA values track the clamped available range. Multi-size keyboard validation remains.

**Purpose:** Screen readers announce real current and maximum widths

**Acceptance:** Verify initial default width, resizing, Home/End, and window shrink/grow with all ARIA values matching measured geometry.

**Audit evidence:** `src/components/layout/NexusShell.tsx:895`. Locations refer to the audit snapshot and may shift.

### UI27 · Preserve the user's preferred scale and restore it at startup instead of always applying the default zoom

**Status:** partial · **Priority:** P2 · **Effort:** M

Window zoom persists, with Ctrl/Cmd +/-/0 and wheel changes. Pure preference validation passes; packaged restart QA remains.

**Purpose:** Scale preferences survive restarts and moving between different-DPI displays

**Acceptance:** Validate retained zoom after restart, browser-style zoom commands, and a 100% fallback if preferences are invalid.

**Audit evidence:** `electron/main.cjs:2075`. Locations refer to the audit snapshot and may shift.

### UI28 · Remember window bounds/display and re-clamp them to the available monitor after setup changes

**Status:** partial · **Priority:** P2 · **Effort:** M

Window bounds/display/maximized state persist and re-clamp on display changes. Geometry tests pass; physical docking QA remains.

**Purpose:** The app reopens where users work and remains recoverable after unplugging a monitor

**Acceptance:** Verify secondary portrait/ultrawide display, 720p work area, docking/undocking, and previously maximized windows.

**Audit evidence:** `electron/main.cjs:1868`. Locations refer to the audit snapshot and may shift.

### UI29 · Make full truncated names/model details available by focus/tap, not only title hover

**Status:** partial · **Priority:** P2 · **Effort:** S

Full model labels wrap in menus. Complete focused/touch details for all truncated surfaces.

**Purpose:** Long identifiers remain distinguishable on compact cards

**Acceptance:** Validate two models differing only in their suffix, screen reader output, and a touch detail popover.

**Audit evidence:** `src/components/party/AgentCard.tsx:269`, `src/components/models/ModelPicker.tsx:452`. Locations refer to the audit snapshot and may shift.

### UI30 · Announce streaming progress at useful boundaries, separately from token updates

**Status:** partial · **Priority:** P2 · **Effort:** M

Response status announcements occur at useful lifecycle boundaries separately from token text. Screen-reader announcement QA remains.

**Purpose:** Screen readers are not repeatedly interrupted by growing text

**Acceptance:** Validate a multi-agent stream: concise status transitions and completion announcement, with the full response available for normal reading.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:663`. Locations refer to the audit snapshot and may shift.

## Smoother operation

### S01 · Keep each workspace view state when navigating

**Status:** partial · **Priority:** P2 · **Effort:** M

Roster search/page, settings section/search, plugin query/expansion, monitor tab/page, report selection and Help state survive workspace unmounts. Remaining editor/view state and full navigation matrix need verification.

**Purpose:** Persist filters, selected subtab and local form state per workspace without keeping background polling active.

**Acceptance:** Leave filtered Monitor, visit Agents, return to the same filter/subtab.

**Audit evidence:** `src/components/layout/NexusShell.tsx:255`. Locations refer to the audit snapshot and may shift.

### S02 · Restore each workspace scroll position

**Status:** partial · **Priority:** P2 · **Effort:** M

Per-workspace window and nested registry/settings/plugin scroll positions are captured, frozen before navigation, and restored while lazy layout settles. User input takes control. Browser navigation validation remains incomplete because the live preview lost authentication.

**Purpose:** Switching large workspaces should return to the previous reading location.

**Acceptance:** Scroll a long workspace, navigate away/back, and recover its position without jumping after content loads.

**Audit evidence:** `src/components/layout/NexusShell.tsx:255`. Locations refer to the audit snapshot and may shift.

### S03 · Use panel-shaped loading placeholders

**Status:** complete · **Priority:** P2 · **Effort:** M

Destination-shaped loading placeholders replace the generic spinner.

**Purpose:** The generic Refreshing spinner replaces each lazy workspace; reserve matching header/content space.

**Acceptance:** Slow chunk loading preserves surrounding geometry and announces the loading state.

**Audit evidence:** `src/components/layout/NexusShell.tsx:134`. Locations refer to the audit snapshot and may shift.

### S04 · Prefetch likely next panels on navigation intent

**Status:** complete · **Priority:** P2 · **Effort:** M

Navigation focus/hover prefetches the corresponding lazy panel.

**Purpose:** Secondary panels already lazy-load; warm their chunk on pointer intent or keyboard focus using the same cached loader.

**Acceptance:** First navigation after hover/focus reuses one request and does not fetch every panel at startup.

**Audit evidence:** `src/components/layout/NexusShell.tsx:75`. Locations refer to the audit snapshot and may shift.

### S05 · Focus chat when its lazy component actually mounts

**Status:** complete · **Priority:** P2 · **Effort:** M

Console focus waits for its mount-ready event instead of retrying a fixed number of frames.

**Purpose:** Current focus loop stops after 12 animation frames and can miss slow chunk loads; use an explicit mount-ready signal.

**Acceptance:** Open chat through Help with a delayed chunk; composer receives focus once without stealing later user focus.

**Audit evidence:** `src/components/layout/NexusShell.tsx:500`. Locations refer to the audit snapshot and may shift.

### S06 · Show freshness beside cached runtime state

**Status:** partial · **Priority:** P2 · **Effort:** M

Runtime freshness uses receipt and source-snapshot age, displays cached-state age, and offers refresh. The age timer pauses when hidden. Complete stale/error browser scenarios remain.

**Purpose:** Cached data is retained on failure; consistently display last successful observation age and a refresh action.

**Acceptance:** A stale snapshot cannot be mistaken for current health and refreshing does not blank useful data.

**Audit evidence:** `src/hooks/useRuntimeStatus.ts:1378`. Locations refer to the audit snapshot and may shift.

### S07 · Recover a connected but silent event stream

**Status:** complete · **Priority:** P2 · **Effort:** M

A silent SSE connection aborts after 45 seconds without bytes and reconnects.

**Purpose:** The stream read can wait indefinitely without an idle heartbeat watchdog.

**Acceptance:** A stalled connection reconnects after its heartbeat grace period with a visible recoverable state.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1108`. Locations refer to the audit snapshot and may shift.

### S08 · Resume event delivery from the last acknowledged cursor

**Status:** complete · **Priority:** P2 · **Effort:** M

Reconnect sends the last acknowledged event ID; the server replays only newer retained events and reports an expired cursor.

**Purpose:** Reconnect rebuilds a connection without a client cursor; extend the existing stream protocol to replay missed events.

**Acceptance:** Disconnect during a run, reconnect, and observe every event exactly once.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1084`. Locations refer to the audit snapshot and may shift.

### S09 · Use jittered reconnect backoff and reset after stable service

**Status:** complete · **Priority:** P2 · **Effort:** M

Reconnect backoff includes jitter and resets after a stable connection period.

**Purpose:** Linear retry delays synchronize multiple clients and reset as soon as headers arrive.

**Acceptance:** Repeated immediate disconnects back off; a stable connection restores the initial retry policy.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1131`. Locations refer to the audit snapshot and may shift.

### S10 · Expose jump-to-latest and unread response count

**Status:** complete · **Priority:** P2 · **Effort:** M

Conversation exposes jump-to-latest and unread response count.

**Purpose:** Auto-follow already stops away from the bottom; give the reader an explicit return path.

**Acceptance:** Read an older response while new replies arrive, then return to latest with one action.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1180`. Locations refer to the audit snapshot and may shift.

### S11 · Preserve the transcript anchor when older responses are revealed

**Status:** complete · **Priority:** P2 · **Effort:** M

Revealing older retained responses preserves the scroll anchor.

**Purpose:** The console renders only 60 of 80 retained responses; offer older messages without shifting the current reading anchor.

**Acceptance:** Load older messages and keep the current top-visible message at the same pixel offset.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:977`. Locations refer to the audit snapshot and may shift.

### S12 · Maintain attachment state per recipient draft

**Status:** partial · **Priority:** P2 · **Effort:** M

Attachment drafts are retained separately per recipient/workspace session, including uploaded results and per-file retry state; clearing drafts aborts uploads and revokes previews. File-upload and recipient-switch browser QA remains.

**Purpose:** Text drafts are scoped by route; attachment ownership should switch together with the corresponding text draft.

**Acceptance:** Switch recipients with an attachment and return to the correct draft without sending it to another route.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:884`. Locations refer to the audit snapshot and may shift.

### S13 · Make canceled voice processing settle immediately

**Status:** complete · **Priority:** P2 · **Effort:** M

Speech requests accept AbortSignal and a deadline; cancellation settles immediately.

**Purpose:** Recognition requests lack AbortSignal/deadline handling; expose cancel and settle pending work even if the worker stalls.

**Acceptance:** Cancel a stalled dictation and immediately return to usable typing controls.

**Audit evidence:** `src/speech/localSpeechClient.ts:67`. Locations refer to the audit snapshot and may shift.

### S14 · Keep recorded audio available for a transcription retry

**Status:** complete · **Priority:** P2 · **Effort:** M

Failed or cancelled transcription retains the recording in memory for explicit retry or discard.

**Purpose:** A transient recognition failure should allow retrying the same recording within the current session.

**Acceptance:** Retry after a simulated transient error without recording again; explicitly discard clears the recording.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1265`. Locations refer to the audit snapshot and may shift.

### S15 · Show determinate local speech setup progress

**Status:** complete · **Priority:** P2 · **Effort:** M

Speech model preparation exposes determinate progress when supplied by the worker.

**Purpose:** Progress events exist; expose download/preparation progress separately from recording and recognition.

**Acceptance:** First use clearly distinguishes listening, downloading, preparing and transcribing; ready state settles once.

**Audit evidence:** `src/speech/localSpeechClient.ts:1`. Locations refer to the audit snapshot and may shift.

### S16 · Preserve textarea scrolling during autosizing

**Status:** complete · **Priority:** P2 · **Effort:** M

Composer autosizing preserves its scroll offset and accounts for the visual viewport.

**Purpose:** Autosizing resets height to auto and rereads layout; keep selection and scroll position stable when the editor reaches its height cap.

**Acceptance:** Typing/pasting a long draft keeps caret visible without bouncing the entire workspace.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1209`. Locations refer to the audit snapshot and may shift.

### S17 · Use consistent pending states for long actions

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Show operation-specific progress and disable duplicate invocation until a clear completion or failure.

**Acceptance:** Repeated clicks during a pending mutation cannot launch duplicate requests and failure restores controls.

**Audit evidence:** `src/components/common/ActionStatusBanner.tsx:1`. Locations refer to the audit snapshot and may shift.

### S18 · Restore focus to the initiating control after overlays close

**Status:** partial · **Priority:** P2 · **Effort:** M

Shared focus lifecycle adopted by editor, recruitment, model/auth/help and new dialogs. Complete nested-dialog and remaining overlay audit.

**Purpose:** Dialog cleanup should return the operator to the exact trigger or a safe nearby replacement.

**Acceptance:** Close Recruit/Help/editor by keyboard and continue navigation from the initiating action.

**Audit evidence:** `src/components/layout/NexusShell.tsx:238`. Locations refer to the audit snapshot and may shift.

### S19 · Keep useful content during background refresh

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Treat initial loading and refreshing as distinct states across lists; retain prior rows while refreshing with stale indication.

**Acceptance:** A refresh never collapses a populated list or loses keyboard position.

**Audit evidence:** `src/hooks/useGatewayActivityFeed.ts:37`. Locations refer to the audit snapshot and may shift.

### S20 · Reveal the actionable first validation error

**Status:** partial · **Priority:** P2 · **Effort:** M

Mission readiness links focus missing title/objective inputs or open agent selection. Extend to remaining forms.

**Purpose:** Failed form submission should scroll/focus the first invalid field and retain all other values.

**Acceptance:** Submit an incomplete long form from its footer and land on the invalid field with a clear explanation.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:491`. Locations refer to the audit snapshot and may shift.

## Appearance

### V01 · Unify navigation artwork into one optically balanced icon family

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Consistent silhouettes, stroke weight, and visual size make the rail cleaner at multiple scales

**Acceptance:** Review a single icon contact sheet at 24/32/40px and 1×/2× density.

**Audit evidence:** `src/components/layout/NexusShell.tsx:80`. Locations refer to the audit snapshot and may shift.

### V02 · Establish a clearer primary/secondary action hierarchy on agent cards

**Status:** planned · **Priority:** P2 · **Effort:** S

**Purpose:** The main action becomes recognizable immediately; secondary configuration recedes

**Acceptance:** Review selected/unselected/busy cards across all rarity colors.

**Audit evidence:** `src/styles/automnia-theme/133-agent-card-obsidian.css:58`. Locations refer to the audit snapshot and may shift.

### V03 · Use a stable selection accent for Chat instead of varying selection with rarity

**Status:** planned · **Priority:** P2 · **Effort:** S

**Purpose:** Functional selection reads consistently across a mixed roster while rarity remains on its badge

**Acceptance:** Compare mixed-rarity selected cards in color and grayscale.

**Audit evidence:** `src/styles/automnia-theme/133-agent-card-obsidian.css:81`. Locations refer to the audit snapshot and may shift.

### V04 · Reserve semantic colors for runtime meaning and simplify decorative count colors

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Online/warning/error stand out against quieter counts; users see a coherent status language

**Acceptance:** Review every header state together, including offline and failed.

**Audit evidence:** `src/styles/automnia-theme/127-workspace-status-colors.css:29`. Locations refer to the audit snapshot and may shift.

### V05 · Move overlay surfaces to the same graphite/obsidian token family

**Status:** partial · **Priority:** P2 · **Effort:** M

Shared dialog/auth surfaces use common surface tokens. Review every theme/overlay combination.

**Purpose:** Dialogs look like part of the current shell and honor existing form-chrome preferences

**Acceptance:** Review all overlays under graphite, warm, and obsidian settings.

**Audit evidence:** `src/components/party/ModelSelectorModal.tsx:314`, `src/components/auth/ProviderAuthModal.tsx:339`. Locations refer to the audit snapshot and may shift.

### V06 · Consolidate corner radii into semantic overlay/panel/control levels

**Status:** planned · **Priority:** P3 · **Effort:** M

**Purpose:** Consistent nested corners reduce visual fragmentation

**Acceptance:** Compare all shared surfaces at the same zoom after token adoption.

**Audit evidence:** `src/components/auth/ProviderAuthModal.tsx:339`, `src/styles/automnia-theme/117-model-picker-flat.css:28`, `src/styles/tokens.css:28`. Locations refer to the audit snapshot and may shift.

### V07 · Apply a restrained elevation hierarchy, with stronger shadows only on floating content

**Status:** planned · **Priority:** P3 · **Effort:** M

**Purpose:** Dense rosters feel less visually heavy, while menus and dialogs retain clear depth

**Acceptance:** Review 12-card grids and overlapping menus in default/reduced-glow modes.

**Audit evidence:** `src/styles/automnia-theme/133-agent-card-obsidian.css:20`. Locations refer to the audit snapshot and may shift.

### V08 · Make model popovers opaque enough that underlying content cannot compete with option text

**Status:** partial · **Priority:** P2 · **Effort:** S

Model popovers have opaque surfaces; complete contrasting-background review.

**Purpose:** Cleaner reading over patterned cards and bright controls

**Acceptance:** Review long menus above high-contrast background fixtures and all accent modes.

**Audit evidence:** `src/styles/automnia-theme/117-model-picker-flat.css:38`. Locations refer to the audit snapshot and may shift.

### V09 · Replace the generic centered workspace spinner with shaped loading placeholders for the destination surface

**Status:** complete · **Priority:** P2 · **Effort:** M

Loading placeholders reflect console, settings, monitoring and card-based destinations.

**Purpose:** Loading looks intentional and preserves the expected panel hierarchy

**Acceptance:** Review slow-network transitions into Missions, Monitor, Plugins, and Settings without invented progress percentages.

**Audit evidence:** `src/components/layout/NexusShell.tsx:131`. Locations refer to the audit snapshot and may shift.

### V10 · Design a shared avatar fallback treatment using consistent initials, typography, and neutral background

**Status:** partial · **Priority:** P3 · **Effort:** M

Agent cards, party slots, chat identities and editor portraits share a neutral initials fallback. Unicode/empty-name tests pass; missing-image visual matrix remains.

**Purpose:** Missing portraits look deliberate and identities stay recognizable across surfaces

**Acceptance:** Review absent/broken portraits, duplicate initials, and very long names.

**Audit evidence:** `src/components/editor/AgentEditorModal.tsx:1497`, `src/components/monitor/AgentResponseConsole.tsx:606`, `src/components/party/ActivePartyStrip.tsx:222`. Locations refer to the audit snapshot and may shift.

### V11 · Improve response typography with safe structured Markdown for headings, lists, inline code, and code blocks

**Status:** partial · **Priority:** P2 · **Effort:** M

Completed responses render escaped structured Markdown with safe links and bounded parsing, while streaming stays plain text. URL regressions pass; full typography and accessibility visual review remains.

**Purpose:** Agent output becomes easier to scan and technical content appears composed

**Acceptance:** Validate sanitized links/content, code overflow, nested lists, and streaming stability.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:660`. Locations refer to the audit snapshot and may shift.

### V12 · Reduce repeated uppercase labels and excessive letter spacing in data-dense areas

**Status:** planned · **Priority:** P3 · **Effort:** S

**Purpose:** Sentence-case labels and a consistent hierarchy create calmer forms

**Acceptance:** Review a complete editor screen with title, section, label, hint, and value styles together.

**Audit evidence:** `src/components/models/ModelPicker.tsx:168`, `src/components/editor/AgentEditorModal.tsx:1512`. Locations refer to the audit snapshot and may shift.

### V13 · Style editor identity metadata as a secondary expandable detail rather than a dense inline ID/level/rarity string

**Status:** partial · **Priority:** P3 · **Effort:** S

Editor identity details are secondary expandable metadata with selectable wrapping IDs. Visual and enlarged-text checks remain.

**Purpose:** The identity header feels cleaner while IDs remain easy to reveal/copy

**Acceptance:** Review long IDs and two similarly named agents.

**Audit evidence:** `src/components/editor/AgentEditorModal.tsx:1502`, `src/components/party/ModelSelectorModal.tsx:319`. Locations refer to the audit snapshot and may shift.

### V14 · Align headline metric typography with tabular numerals and predictable widths

**Status:** partial · **Priority:** P3 · **Effort:** S

Shared numeric status chips use tabular numerals and stable minimum widths. Metric layout review across varying counts remains.

**Purpose:** Changing counts look steadier and are easier to compare

**Acceptance:** Review transitions 9→10→100 and mixed-duration values.

**Audit evidence:** `src/styles/automnia-theme/109-monitor-logs.css:96`, `src/components/party/AgentCard.tsx:246`. Locations refer to the audit snapshot and may shift.

### V15 · Give empty/no-match plugin and model states a shared visual pattern: compact icon, useful headline, single next action

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Empty screens look finished and guide the eye toward recovery

**Acceptance:** Review true-empty, filtered-empty, loading, and failed-loading as distinct states.

**Audit evidence:** `src/components/plugins/PluginsPanel.tsx:1395`, `src/components/models/ModelPicker.tsx:382`. Locations refer to the audit snapshot and may shift.

### V16 · Visually group roster tools by purpose: search/filter, view, and appearance

**Status:** planned · **Priority:** P3 · **Effort:** S

**Purpose:** A small separator/label hierarchy reduces toolbar noise while keeping current functions

**Acceptance:** Review the desktop toolbar and compact stacked version after R01.

**Audit evidence:** `src/components/party/PartySelector.tsx:504`. Locations refer to the audit snapshot and may shift.

### V17 · Reduce decorative scaffolding in the agent intro and give the actual workspace title stronger visual priority

**Status:** planned · **Priority:** P3 · **Effort:** S

**Purpose:** The header reads as a clear title and concise description instead of several competing controls

**Acceptance:** Compare the intro alongside real clickable status actions.

**Audit evidence:** `src/styles/automnia-theme/125-agents-workspace-copy.css:19`. Locations refer to the audit snapshot and may shift.

### V18 · Normalize button progress visuals across raw-button callers using the existing Button loading treatment

**Status:** partial · **Priority:** P2 · **Effort:** S

Auth and shared form actions use consistent loading buttons; audit remaining raw buttons.

**Purpose:** Waiting states look consistent and button widths stay stable

**Acceptance:** Review idle/loading/success/error transitions without layout jumps.

**Audit evidence:** `src/components/ui/Button.tsx:42`, `src/components/party/ModelSelectorModal.tsx:448`, `src/components/auth/LoginModal.tsx:166`. Locations refer to the audit snapshot and may shift.

### V19 · Standardize form-success/error appearance and placement

**Status:** partial · **Priority:** P3 · **Effort:** S

Shared FormFeedback primitive added and adopted in auth forms; complete cross-form adoption.

**Purpose:** Feedback has a dependable visual hierarchy and errors cannot look like neutral success

**Acceptance:** Review long and short messages, retry state, and high-contrast settings.

**Audit evidence:** `src/components/party/ModelSelectorModal.tsx:441`, `src/components/auth/LoginModal.tsx:159`. Locations refer to the audit snapshot and may shift.

### V20 · Provide a coherent document/technical-content skin for the recruit Markdown editor and response code blocks, sharing code font, syntax palette, gutter treatment, and selection colors

**Status:** partial · **Priority:** P3 · **Effort:** M

Saved mission JSON uses a shared readable technical-document surface and response Markdown renders saved answers. Fixed stale recruit-editor CSS selectors after dynamic accessible IDs changed; transparent editing overlay passes desktop/wide/mobile visual QA. Unifying all syntax palettes and form-chrome variants remains.

**Purpose:** Writing agent instructions and reading generated technical output feel like one product

**Acceptance:** Review syntax colors under all form chromes, long lines, selected text, and reduced-motion/high-contrast modes.

**Audit evidence:** `src/components/recruit/RecruitAgentModal.tsx:1955`, `src/index.css:10`. Locations refer to the audit snapshot and may shift.

## Product polish

### F01 · Use accurate run outcome labels

**Status:** complete · **Priority:** P2 · **Effort:** S

Shared outcome labels distinguish complete, failed, blocked, cancelled and timed-out runs in chat and activity.

**Purpose:** Every non-OK completed response becomes Blocked, even though failureKind exists. Distinct failed, cancelled, timed-out and blocked labels explain what happened.

**Acceptance:** Representative outcomes display the same meaningful label in console and activity log, with a suitable next action for each.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:570`, `src/components/settings/SettingsActivityLog.tsx:99`. Locations refer to the audit snapshot and may shift.

### F02 · Label the restart action precisely

**Status:** complete · **Priority:** P2 · **Effort:** S

Gateway action explicitly says Restart gateway.

**Purpose:** The gateway restart button is labeled Reset, which obscures its scope and suggests data reset.

**Acceptance:** The action consistently says Restart gateway/Restarting and explains affected running work using actual runtime behavior.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:760`. Locations refer to the audit snapshot and may shift.

### F03 · Separate gateway availability from extension health

**Status:** complete · **Priority:** P2 · **Effort:** S

Plugin workspace status names gateway availability rather than claiming all extensions are healthy.

**Purpose:** The Plugins workspace says Extensions ON/OFF from gateway process/health alone, so its summary can imply all plugins are running.

**Acceptance:** Gateway state and extension readiness are separately labeled and derived from their authoritative fields; a failed plugin cannot appear covered by an all-healthy claim.

**Audit evidence:** `src/components/layout/NexusShell.tsx:170`, `src/components/layout/NexusShell.tsx:216`. Locations refer to the audit snapshot and may shift.

### F04 · Mark modified presets as customized

**Status:** complete · **Priority:** P2 · **Effort:** S

Changed built-in mission preset fields display Customized.

**Purpose:** A preset is considered active based only on title and mission type, even after its other preset values change.

**Acceptance:** Changing collaboration, risk or complexity marks the preset Customized; restoring all preset values restores its active label.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:374`. Locations refer to the audit snapshot and may shift.

### F05 · Explain report metrics and missing values

**Status:** complete · **Priority:** P2 · **Effort:** S

Report metrics explain estimates and show unavailable measurements clearly.

**Purpose:** Efficiency, Soul Drift and Scheduler Stability have no units or interpretation, and all missing values say Unavailable.

**Acceptance:** Each metric states its unit, interpretation and evidence source; unavailable metrics state whether evidence is pending, unsupported or absent.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:4`, `src/components/monitor/MissionReportPanel.tsx:25`. Locations refer to the audit snapshot and may shift.

### F06 · Show agent names in mission history

**Status:** complete · **Priority:** P2 · **Effort:** S

Mission history/report rows resolve retained agent IDs to current names.

**Purpose:** History joins raw selectedAgents IDs and internal collaboration names, making otherwise familiar work harder to recognize.

**Acceptance:** Rows resolve current names and human collaboration labels, retaining IDs in a details affordance and falling back clearly for deleted agents.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:65`. Locations refer to the audit snapshot and may shift.

### F07 · Use one scheduling vocabulary

**Status:** planned · **Priority:** P3 · **Effort:** S

**Purpose:** The same workflow is described as cron, shift, heartbeat and scheduled run across controls. Stable terms would make setup and support easier.

**Acceptance:** A glossary maps real different concepts; controls use Scheduled task for scheduled jobs and reserve Heartbeat for its distinct agent mechanism.

**Audit evidence:** `src/components/monitor/HeartbeatSchedulerPanel.tsx:276`, `src/components/monitor/HeartbeatSchedulerPanel.tsx:772`, `src/components/monitor/LiveOperationMonitor.tsx:1132`. Locations refer to the audit snapshot and may shift.

### F08 · Identify the report currently on screen

**Status:** complete · **Priority:** P2 · **Effort:** S

Report screen identifies its mission and generation timestamp.

**Purpose:** The report begins with metrics under a generic heading and does not identify the latest mission or generation time.

**Acceptance:** The report header includes mission title, final outcome and generated timestamp, so screenshots and exported views retain context.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:21`. Locations refer to the audit snapshot and may shift.

### F09 · Make evidence identifiers inspectable

**Status:** complete · **Priority:** P2 · **Effort:** S

Evidence identifiers expand and copy without losing full values.

**Purpose:** shortIds permanently abbreviates IDs in the displayed report without a way to retrieve their full values.

**Acceptance:** Every shortened run/session ID has a full-value reveal/copy control and opens the corresponding evidence when retained.

**Audit evidence:** `src/components/monitor/MissionReportPanel.tsx:8`, `src/components/monitor/MissionReportPanel.tsx:47`. Locations refer to the audit snapshot and may shift.

### F10 · Turn an empty model list into a setup path

**Status:** partial · **Priority:** P2 · **Effort:** S

Shared empty-model guidance opens Account setup from both model-picker modes. More specific catalog/auth/entitlement diagnosis and in-place refresh actions remain.

**Purpose:** No models available offers no distinction between a missing account, catalog failure and a genuinely empty result.

**Acceptance:** The empty state uses catalog/auth/entitlement evidence to offer Connect provider, Refresh models or a clearly explained limitation.

**Audit evidence:** `src/components/models/ModelPicker.tsx:215`. Locations refer to the audit snapshot and may shift.

### F11 · Offer agent selection from the empty console

**Status:** complete · **Priority:** P2 · **Effort:** S

Empty chat offers Choose an agent and focuses the registry search.

**Purpose:** No agent selected is informative but leaves the user to find the selection workflow.

**Acceptance:** The empty state includes Choose an agent and Recruit an agent actions, selecting/focusing the resulting target without losing the current draft.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:2042`. Locations refer to the audit snapshot and may shift.

### F12 · Describe mission readiness as form readiness

**Status:** complete · **Priority:** P2 · **Effort:** S

Mission readiness is labelled as form readiness, with runtime checks explained separately.

**Purpose:** The readiness percentage checks only party, title and objective; 100% does not establish runtime, model or auth availability.

**Acceptance:** The current meter explicitly says Form complete, with runtime/provider readiness shown separately or a precise launch-preflight result.

**Audit evidence:** `src/components/mission/MissionDeploymentPanel.tsx:357`. Locations refer to the audit snapshot and may shift.

### F13 · Show mixed values when editing several agents

**Status:** complete · **Priority:** P2 · **Effort:** M

Bulk runtime settings expose mixed values and preserve untouched differences.

**Purpose:** Bulk runtime settings show the first target agent's defaults, making different existing values across the selected set easy to miss.

**Acceptance:** Fields show Mixed when targets differ; only explicitly changed fields apply unless the user selects an explicit replace-all policy.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:303`. Locations refer to the audit snapshot and may shift.

### F14 · Point settings search to the matching control

**Status:** partial · **Priority:** P3 · **Effort:** M

Settings search indexes rendered control labels and hints across categories, returns control/section shortcuts, focuses the matching input and highlights results. Full keyboard/browser verification and time-limited focus highlighting remain.

**Purpose:** Settings search currently filters complete sections by section keywords. Matching exact controls would reduce scanning through large sections.

**Acceptance:** Searching a control label returns its label and section; selecting it reveals and focuses that control with a temporary highlight.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:307`. Locations refer to the audit snapshot and may shift.

### F15 · Make the help availability label truthful

**Status:** complete · **Priority:** P2 · **Effort:** S

Help status reflects current request state and no longer claims it is always online.

**Purpose:** Grounded reasoning online is hard-coded even before a request succeeds and while requests may be failing.

**Acceptance:** The label uses unknown/connecting/available/unavailable states from actual help service checks or recent requests and displays the last successful check.

**Audit evidence:** `src/components/help/HelpAssistantPanel.tsx:456`, `src/components/help/HelpAssistantPanel.tsx:410`. Locations refer to the audit snapshot and may shift.

### F16 · Make failed help answers easy to retry

**Status:** complete · **Priority:** P2 · **Effort:** S

Help failures retain the question and offer an explicit retry without duplicating the user turn.

**Purpose:** A failed answer is inserted as an assistant response and also stored as a global error, while the original draft is cleared.

**Acceptance:** One clear failed-response state preserves the original question and offers Retry or Edit question without duplicating the error text.

**Audit evidence:** `src/components/help/HelpAssistantPanel.tsx:424`. Locations refer to the audit snapshot and may shift.

### F17 · Expose plugin search scope explicitly

**Status:** complete · **Priority:** P2 · **Effort:** S

Plugin search scope has explicit Installed plugins and ClawHub catalog controls.

**Purpose:** Searching the marketplace requires a /clawhub prefix; ordinary text only filters installed plugins. An explicit scope choice would reduce hidden syntax.

**Acceptance:** Installed and Marketplace scopes are visible, preserve their separate queries, and label counts according to the chosen scope.

**Audit evidence:** `src/components/plugins/PluginsPanel.tsx:783`. Locations refer to the audit snapshot and may shift.

### F18 · Keep speech progress language task-focused

**Status:** complete · **Priority:** P3 · **Effort:** S

Speech progress uses recording/transcription language.

**Purpose:** Voice progress exposes off-the-UI-thread and CPU/GPU implementation details during normal dictation.

**Acceptance:** Primary messages say Preparing audio, Downloading model or Transcribing; backend details remain available in a details view.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1274`. Locations refer to the audit snapshot and may shift.

### F19 · Use evidence-based voice mode descriptions

**Status:** complete · **Priority:** P3 · **Effort:** S

Voice descriptions remove unsupported accuracy claims.

**Purpose:** Cloud voice is described as highest accuracy and online accuracy without task-specific measurement. Mode descriptions should communicate actual behavior.

**Acceptance:** Cloud/local labels explain processing location, network need and provider; comparative quality claims are shown only when measured and scoped.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:616`, `src/components/monitor/AgentResponseConsole.tsx:1331`. Locations refer to the audit snapshot and may shift.

### F20 · Explain the activity search window

**Status:** complete · **Priority:** P2 · **Effort:** S

Activity search explains its retained count/date window and links to Monitor.

**Purpose:** Search applies after each source is capped at 48 items. A no-results state can be mistaken for a search across all retained history.

**Acceptance:** The feed states the loaded date/count window and distinguishes No match in loaded activity from No activity; a route to older history is explicit.

**Audit evidence:** `src/components/settings/SettingsActivityLog.tsx:16`, `src/components/settings/SettingsActivityLog.tsx:184`. Locations refer to the audit snapshot and may shift.

## Robustness

### B01 · Migrate SQLite columns before creating dependent indexes

**Status:** complete · **Priority:** P1 · **Effort:** S

SQLite migrations add legacy columns before creating dependent indexes; upgrade/reopen test passes.

**Purpose:** The source_key index is created before ALTER adds source_key. An old gateway_events table triggers no such column: source_key, disabling SQLite initialization.

**Acceptance:** An upgrade test starts with the legacy table, migrates it transactionally, retains rows, creates the index and opens successfully on a second run.

**Audit evidence:** `server/runtimeLedger.ts:242`, `server/runtimeLedger.ts:355`. Locations refer to the audit snapshot and may shift.

### B02 · Validate persisted renderer state before merging

**Status:** partial · **Priority:** P1 · **Effort:** M

Persisted store merge rejects malformed/future roots and cannot replace store actions. Full nested mission schemas remain.

**Purpose:** The unknown payload is dereferenced without a null guard, accepts future versions, and spreads arbitrary persisted keys into live state.

**Acceptance:** Null, arrays, malformed nested records and future versions cannot crash or overwrite store actions; supported versions migrate through explicit validated fields.

**Audit evidence:** `src/store/nexusPersistence.ts:33`, `src/store/nexusPersistence.ts:43`. Locations refer to the audit snapshot and may shift.

### B03 · Handle preference storage failures without crashing

**Status:** complete · **Priority:** P1 · **Effort:** M

Preference writes use coherent in-memory fallback, rollback partial storage writes, and report failure.

**Purpose:** Preference writers perform unguarded setItem calls, including a three-key console update. Quota/security failures can throw or leave a partial saved configuration.

**Acceptance:** Denied/quota-full storage preserves usable in-memory settings, reports that saving failed, and never presents a partially written configuration as saved.

**Audit evidence:** `src/components/settings/workspaceSettings.ts:140`, `src/components/settings/workspaceSettings.ts:166`, `src/components/settings/uiSettings.ts:64`, `src/speech/speechSettings.ts:64`. Locations refer to the audit snapshot and may shift.

### B04 · Write control files atomically

**Status:** partial · **Priority:** P1 · **Effort:** M

Canonical agent Markdown files use atomic flushed temp-file replacement; audit remaining control-file writers.

**Purpose:** writeFile directly overwrites instruction and memory files; interruption during writing can leave a truncated file.

**Acceptance:** Write a same-directory temporary file, sync and atomically replace; fault-injection before replacement leaves the full old file and successful saves leave the full new file.

**Audit evidence:** `server/services/controlFilesService.ts:67`. Locations refer to the audit snapshot and may shift.

### B05 · Detect concurrent edits to agent control files

**Status:** partial · **Priority:** P1 · **Effort:** M

Revision-aware atomic saves detect stale/concurrent edits; editor preserves conflicting drafts for comparison. Complete browser conflict workflow QA.

**Purpose:** PUT accepts only content and performs an unconditional overwrite, so editor and agent writes can silently replace each other.

**Acceptance:** Reads return a revision/hash; stale conditional writes receive a conflict with current content, and an explicit merge can be saved safely.

**Audit evidence:** `server/routes/commandConsoleFileRoutes.ts:73`, `server/services/controlFilesService.ts:67`. Locations refer to the audit snapshot and may shift.

### B06 · Report failed backend session clearing

**Status:** partial · **Priority:** P1 · **Effort:** M

Session clearing returns an outcome, preserves history on failure, and exposes retry. Complete mocked-backend end-to-end validation.

**Purpose:** Clear responses resets local state immediately while backend clear failures only go to console.warn. The AI may retain a session the UI implies was reset.

**Acceptance:** The operation returns an outcome and reconciles session IDs; backend failure is visible with retry and the app never silently reuses the supposedly cleared session.

**Audit evidence:** `src/store/nexusStore.ts:3615`, `src/components/settings/SettingsPanel.tsx:801`. Locations refer to the audit snapshot and may shift.

### B07 · Inspect fulfilled failures in Stop all

**Status:** complete · **Priority:** P1 · **Effort:** S

Stop all counts fulfilled responses that report stopped:false as failures.

**Purpose:** Bulk stopping checks only rejected promises, while single-stop correctly inspects stopped/found. A fulfilled {stopped:false,found:true} can be hidden.

**Acceptance:** Every target is reported stopped, already finished or failed; a fulfilled stop failure remains visible with its run ID and retry action.

**Audit evidence:** `src/components/monitor/AgentResponseConsole.tsx:1657`, `src/components/monitor/AgentResponseConsole.tsx:1640`. Locations refer to the audit snapshot and may shift.

### B08 · Continue batch stopping after individual failures

**Status:** complete · **Priority:** P1 · **Effort:** S

Batch job stopping continues through individual failures and aggregates results.

**Purpose:** The first failed stop exits the loop, leaving all later scheduled jobs running without an individual result.

**Acceptance:** A failing first job does not prevent later jobs from being stopped; results identify successes/failures and retry targets only failed jobs.

**Audit evidence:** `src/components/monitor/HeartbeatSchedulerPanel.tsx:389`. Locations refer to the audit snapshot and may shift.

### B09 · Await and aggregate bulk runtime saves

**Status:** complete · **Priority:** P1 · **Effort:** M

Bulk runtime settings await one combined heartbeat/runtime save per agent and aggregate outcomes.

**Purpose:** Bulk Apply announces success before async heartbeat/runtime persistence settles; its setters return void.

**Acceptance:** Apply remains pending until all writes resolve, shows per-agent partial failures and reports success only when the backend has confirmed each requested change.

**Audit evidence:** `src/components/settings/SettingsPanel.tsx:448`, `src/components/settings/SettingsPanel.tsx:463`, `src/store/nexusStore.ts:3665`, `src/store/nexusStore.ts:3697`. Locations refer to the audit snapshot and may shift.

### B10 · Version and serialize cron-default autosaves

**Status:** complete · **Priority:** P1 · **Effort:** M

Cron default autosaves use a serialized save queue and version-aware state.

**Purpose:** The debounced saver can overlap slow requests and any completion clears a shared dirty flag, allowing an older save to mask newer edits.

**Acceptance:** Delay/reorder two writes in a test; only the newest revision becomes saved, dirty status persists until that revision is acknowledged, and stale responses cannot overwrite it.

**Audit evidence:** `src/components/monitor/HeartbeatSchedulerPanel.tsx:235`, `src/components/monitor/HeartbeatSchedulerPanel.tsx:257`, `src/components/monitor/HeartbeatSchedulerPanel.tsx:269`. Locations refer to the audit snapshot and may shift.

### B11 · Validate successful API response schemas

**Status:** partial · **Priority:** P1 · **Effort:** M

API client can validate successful response contracts and returns a safe invalid_response failure without retry. Uploads and scheduler lists/start/batch responses use validators; remaining API surfaces and deeper schemas remain.

**Purpose:** The shared client casts any HTTP-success payload to T, including malformed JSON text or a changed response shape; consumers may fail far from the request.

**Acceptance:** Endpoint decoders reject HTML, missing required fields and wrong types as a structured invalid_response error before updating state, while intentionally bodyless responses still work.

**Audit evidence:** `src/api/client.ts:149`. Locations refer to the audit snapshot and may shift.

### B12 · Expose attachments that could not be delivered inline

**Status:** partial · **Priority:** P2 · **Effort:** M

Upload records disclose inline versus workspace-only delivery, and the composer explains oversized files. Missing/changed records fail visibly before Gateway dispatch. Complete per-response delivery summaries and all-transport handling remain.

**Purpose:** Oversized or missing attachments are silently skipped by gatewayAttachmentsFromTurnAttachments; only a textual path may remain in the prompt.

**Acceptance:** The response reports which files were delivered inline, are local-reference-only or are unavailable; routing blocks or explains unsupported remote access instead of implying full delivery.

**Audit evidence:** `server/services/filesystem/commandConsoleUploadService.ts:350`. Locations refer to the audit snapshot and may shift.

### B13 · Bound retained attachment storage

**Status:** partial · **Priority:** P2 · **Effort:** M

Upload admission now enforces configurable total byte/file budgets with a bounded shared process queue. Defaults are 2 GiB and 2,000 files including metadata; existing uploads are preserved. Concurrent admission and byte-budget regression tests pass. Free-space floor, cross-process reservations and reference-aware expiration remain.

**Purpose:** Uploads have a per-file limit but persist under timestamped paths without retention or aggregate disk budgeting in this service.

**Acceptance:** Enforce a configurable total budget/free-space floor; clean only unreferenced expired uploads and keep files referenced by retained or active runs.

**Audit evidence:** `server/services/filesystem/commandConsoleUploadService.ts:290`. Locations refer to the audit snapshot and may shift.

### B14 · Resolve attachment metadata from server-owned records

**Status:** complete · **Priority:** P2 · **Effort:** M

Uploads have private server-owned ID records with digest, size and type. Inline reads ignore forged client metadata, reject changed bytes and symlink escapes, and remain bounded. Registered uploads work after service restart. Older uploads without records require re-upload.

**Purpose:** Later turns provide attachment path, MIME, kind and size as client metadata; containment is checked but metadata is not resolved from the issued ID.

**Acceptance:** Store upload records by ID with digest/size/type; turns reference IDs, changed bytes or forged metadata are rejected, and valid existing records remain readable.

**Audit evidence:** `server/services/filesystem/commandConsoleUploadService.ts:317`, `server/services/filesystem/commandConsoleUploadService.ts:357`. Locations refer to the audit snapshot and may shift.

### B15 · Redact renderer crash details consistently

**Status:** complete · **Priority:** P1 · **Effort:** S

Renderer crash messages, names, stacks and diagnostics use the shared redactor.

**Purpose:** The error boundary stores raw Error.message/stack and renders them, unlike the API client's diagnostic redaction path.

**Acceptance:** Synthetic errors containing token/key/password values are redacted from displayed/copied diagnostics while safe source, timestamp and useful stack frames remain.

**Audit evidence:** `src/components/system/AppErrorBoundary.tsx:75`, `src/components/system/AppErrorBoundary.tsx:222`. Locations refer to the audit snapshot and may shift.

### B16 · Keep nonfatal async errors from replacing the whole app

**Status:** complete · **Priority:** P2 · **Effort:** M

Nonfatal async errors display a dismissible notice while leaving the workspace mounted.

**Purpose:** Every window error or unhandled rejection sets hasError and replaces the complete workspace, even when React rendering remains healthy.

**Acceptance:** An isolated failed async action yields scoped recovery and diagnostics while active work remains usable; actual render failures still enter the crash boundary.

**Audit evidence:** `src/components/system/AppErrorBoundary.tsx:147`, `src/components/system/AppErrorBoundary.tsx:195`. Locations refer to the audit snapshot and may shift.

### B17 · Bring critical execution paths into coverage gates

**Status:** planned · **Priority:** P2 · **Effort:** M

**Purpose:** Coverage thresholds exclude all routes, agent/gateway/provider services and runtimeLedger, so a high reported percentage does not cover core orchestration.

**Acceptance:** Remove broad exclusions incrementally, publish per-module coverage, and require behavioral tests for scheduling, persistence, gateway failure and billing-route branches before raising the gate.

**Audit evidence:** `scripts/run-unit-tests.mjs:23`. Locations refer to the audit snapshot and may shift.

### B18 · Make scheduled-task creation idempotent

**Status:** partial · **Priority:** P1 · **Effort:** M

Scheduled-job creation journals request IDs before dispatch, coalesces concurrent requests, reconciles lost acknowledgements by durable shift ID, and retains completed receipts across restart. Renderer retries preserve hashed request keys; batch children get stable keys. Tests cover concurrent/restart/reconciliation/truncated receipts. Whole-batch payload identity and coordination replay validation remain.

**Purpose:** Start routes create fresh jobs on each request and do not expose durable idempotency keys. A timeout followed by retry can duplicate recurring work.

**Acceptance:** Retried single/batch requests with one idempotency key return the original job IDs after a lost response or server restart; a new key creates genuinely new jobs.

**Audit evidence:** `server/routes/shiftRoutes.ts:102`, `server/routes/shiftRoutes.ts:140`, `server/routes/shiftRoutes.ts:239`. Locations refer to the audit snapshot and may shift.

### B19 · Surface managed team-sync startup failures

**Status:** complete · **Priority:** P1 · **Effort:** S

Managed team startup failure returns an explicit orchestration outcome and the IDs of preserved jobs. Failure injection verifies managed mode is never reported running after rejection.

**Purpose:** Managed orchestrator startup rejection is swallowed, yet the response still says managedTeamSync is enabled while jobs may already be running.

**Acceptance:** A failed orchestrator start returns a degraded/failed orchestration outcome with affected job IDs, and policy explicitly pauses or preserves those jobs with a recoverable action.

**Audit evidence:** `server/routes/shiftRoutes.ts:243`, `server/routes/shiftRoutes.ts:253`, `server/routes/shiftRoutes.ts:258`. Locations refer to the audit snapshot and may shift.

### B20 · Return partial job creation when entitlement changes mid-batch

**Status:** complete · **Priority:** P1 · **Effort:** M

Entitlement loss mid-batch preserves created job IDs and lists all unstarted agents. The UI retries only known unstarted jobs; ambiguous retry outcomes require checking Monitor. Batch failure tests pass.

**Purpose:** A mid-loop 403 returns immediately even if earlier shifts started; the caller loses the batch's partial-success details and may retry the whole set.

**Acceptance:** Force the second create to fail with 403: the response identifies the already-created jobs and unstarted agents, and retry/cleanup never duplicates or abandons them.

**Audit evidence:** `server/routes/shiftRoutes.ts:210`, `server/routes/shiftRoutes.ts:232`. Locations refer to the audit snapshot and may shift.
