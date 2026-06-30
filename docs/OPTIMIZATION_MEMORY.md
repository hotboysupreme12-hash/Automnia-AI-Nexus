# DystopAI Optimization Memory

Last updated: 2026-06-30

## Source Of Truth

- Current optimization source ledger: `docs/BETA_CODEBASE_SPLIT_PLAN.md`.
- The plan is an exact copy from GitHub branch `origin/docs/150-point-release-plan`.
- Verified plan blob SHA: `78bada3e29085e2726769b86b6c3720b69feab9f`.
- Detailed evidence and work history stay in `docs/PRODUCTION_HARDENING_LEDGER.md`.

## Future Optimization Rule

Do not treat optimization work as a loose backlog. Map each slice to the beta
split plan before implementation:

1. Freeze new control-plane domain growth.
2. Extract Gateway services.
3. Extract runtime services.
4. Extract mission services.
5. Extract provider/auth services.
6. Extract plugin services.
7. Extract filesystem/upload services.
8. Split renderer API calls and projection state.
9. Run private beta readiness gates and manual beta checks.

## Working Memory

- Keep `server/controlPlane.ts` as composition glue only.
- New backend work should name the service folder it belongs to before code is
  added.
- Phase A guardrails are now active: `controlPlane.ts` starts with the
  no-new-domain-logic guard, `smoke:server-architecture` enforces the guard and
  a `29,000` line ceiling, and `smoke:route-inventory` still owns route drift.
- Phase B Gateway lifecycle extraction is complete: `server/services/gateway/gatewayLifecycleService.ts`
  owns process start/stop/restart state, restart diagnostics, startup timeline,
  health monitor timers, listener PID lookup, and plugin-install pause/resume
  handling. `controlPlane.ts` delegates lifecycle behavior to that service.
- Phase B Gateway diagnostics extraction is complete:
  `server/services/gateway/gatewayDiagnosticsService.ts` owns `/health`,
  `/readyz`, and `diagnostics.stability` probing/normalization with focused
  unit coverage and `npm run smoke:gateway-diagnostics`.
- Phase B Gateway log extraction is complete:
  `server/services/gateway/gatewayLogService.ts` owns log compaction/redaction,
  in-memory log mirroring, `logs.tail` RPC reads, file-log discovery and tail
  snapshots, channel activity parsing, dedupe, current-start filtering, and
  loaded-plugin extraction. `controlPlane.ts` delegates the existing Monitor,
  Doctor, and runtime status call sites to that service.
- Phase B Gateway chat extraction is complete:
  `server/services/gateway/gatewayChatService.ts` owns the persistent loopback
  `gateway-client`, startup readiness, stream observer/waiter state,
  `chat.send`, `chat.history`, `chat.message.get`, `chat.abort`, prewarm state,
  recovery snapshots, Gateway event projection, and final reply shaping.
  `controlPlane.ts` delegates the existing runtime, stream, diagnostics, and
  shutdown call sites to that service.
- Phase B Gateway redacted-error coverage is complete across diagnostics, log,
  and chat services. Chat-specific coverage now verifies redacted `chat.send`
  failures, redacted terminal error payloads returned to callers, and stale
  waiter abort/recovery evidence in `tests/gatewayChatService.test.ts`.
- Phase B Gateway validation is complete: `tests/gatewayLifecycleService.test.ts`
  and `npm run smoke:gateway-lifecycle` now cover stale unhealthy listener
  cleanup decisions, refusal to spawn over a still-busy listener, and
  Monitor-facing `healthy`/`offline`/`restarting` Gateway status snapshots.
  `smoke:server-architecture` now pins lifecycle, diagnostics, log, and chat
  ownership in `server/services/gateway/*` and confirms Gateway behavior reaches
  routes through explicit options.
- Phase C runtime status extraction is complete:
  `server/services/runtime/runtimeStatusService.ts` owns runtime status and
  summary payload construction, status/summary caches, response-deadline
  fallback, cached fallback shaping, Gateway ledger/log/activity projections,
  plugin summary projection, active mission/shift projection, and Monitor
  fallback payloads. `controlPlane.ts` delegates through
  `createRuntimeStatusService(...)` and thin wrappers for the existing runtime
  route call sites.
- Runtime status service coverage now lives in `tests/runtimeStatusService.test.ts`
  and covers healthy Gateway summaries, missing Gateway summaries with Gateway
  ledger evidence, stale session evidence passthrough, and timeout fallback to a
  cached redacted runtime status payload.
- Phase C runtime action extraction is complete:
  `server/services/runtime/runtimeActionService.ts` owns runtime action
  orchestration for session close, stale Gateway chat aborts, runtime monitor
  clear, desktop runtime shutdown, and Gateway stop/start/restart actions.
  `server/routes/runtimeRoutes.ts` now validates HTTP payloads and delegates
  action behavior through the injected service.
- Runtime action service coverage now lives in `tests/runtimeActionService.test.ts`
  and covers session close cleanup and activity snapshots, stale waiter abort
  cache invalidation, recovery-service delegation for clean-slate/shutdown,
  Gateway stop/start/restart status snapshots, and desktop shutdown reason
  propagation.
- Phase C runtime recovery extraction is complete:
  `server/services/runtime/runtimeRecoveryService.ts` owns runtime shutdown
  cleanup, concurrent shutdown dedupe, process-exit best-effort cleanup, and
  Monitor Clean Slate recovery. `server/controlPlane.ts` composes it with
  explicit dependencies for mission snapshots, session cleanup, active runtime
  termination, Gateway client/runtime shutdown, OAuth callback cleanup, plugin
  setup terminal cleanup, session-lock sweeping, marker persistence, cache
  invalidation, and runtime ledger close.
- Runtime recovery service coverage now lives in
  `tests/runtimeRecoveryService.test.ts` and covers Clean Slate safety without
  stopping active runtime/Gateway work, shutdown in-flight dedupe, structured
  shutdown evidence, warning-tolerant cleanup continuation, and synchronous
  process-exit cleanup.
- Phase C runtime ledger store extraction is complete:
  `server/state/runtimeLedgerStore.ts` owns canonical ledger paths, the
  control-center state namespace keys, runtime/Gateway/diagnostic/mission
  ledger append/read methods, non-blocking status reads, and ledger close
  wiring. `server/controlPlane.ts` composes `createRuntimeLedgerStore(...)` and
  no longer imports raw helpers from `server/runtimeLedger.ts`; that file
  remains the low-level SQLite/JSONL implementation.
- Runtime ledger store coverage now lives in `tests/runtimeLedgerStore.test.ts`
  and covers JSONL fallback diagnostics with malformed-row evidence, JSONL
  append/read fallback across runtime/Gateway/diagnostic/mission ledgers, and
  namespaced control-center state ownership.
- Phase D mission state extraction is complete:
  `server/services/missions/missionStateService.ts` owns mission launch
  idempotency, mission record creation, mission duration/timer arming, mission
  view/progress projection, scheduler initial state, lifecycle event appends,
  mission record persistence, mission start rollback, and operator cancellation
  transitions. `server/routes/missionRoutes.ts` now delegates mission start/stop
  behavior through the injected `missionStateService`.
- Mission state service coverage now lives in `tests/missionStateService.test.ts`
  and covers invalid launch rejection before state mutation, duplicate
  idempotency-key launches, instant scheduler-round delegation, recurring
  scheduler/timer arming, scheduler setup rollback, lifecycle edge persistence,
  successful running-mission cancellation, cleanup-failure cancellation evidence,
  Team Sync snapshot writes, and missing/terminal mission stop rejection.
- Phase D mission scheduler extraction is complete:
  `server/services/missions/missionSchedulerService.ts` owns mission cron
  scheduling, one-shot and recurring cron job creation, OpenClaw cron
  add/run/rm/disable orchestration, instant round timers, mission run
  controllers, scheduler-driven completion, cancellation cleanup, rehydrated
  mission timers, recurring shift rehydration, cron runtime/session reference
  capture, agent memory handoff writes, and Team Sync scheduler evidence
  through injected dependencies.
- Mission scheduler service coverage now lives in
  `tests/missionSchedulerService.test.ts` and covers recurring leader/worker
  arming, cleanup fallback from failed removal to disable, max-cycle completion
  without launching extra work, and instant mission scheduling through cron run
  completion. `npm run smoke:mission-scheduler` is wired into `npm run test:ci`.
- Phase D mission report extraction is complete:
  `server/services/missions/missionReportService.ts` owns backend mission
  report contracts, report evidence scoring, unavailable metric shaping,
  runtime/cron/session reference accounting, durable report listing, mission
  record normalization for projection, feed/event merging, and report-backed
  lifecycle projection. `server/controlPlane.ts` now delegates
  `recordMissionReport`, `listMissionReports`, and
  `buildMissionLifecycleProjection` through the report service.
- Mission report service coverage now lives in
  `tests/missionReportService.test.ts` and covers runtime-backed cron/session
  evidence, mission-feed-only fallback reports, failed cron-job score lowering,
  no-evidence reports with unavailable metrics, and durable-plus-memory
  report/projection merging. `npm run smoke:mission-report-service` is wired
  into `npm run test:ci`.
- Phase D mission recovery extraction is complete:
  `server/services/missions/missionRecoveryService.ts` owns durable mission
  restart hydration, recovered cron reconciliation, missing/disabled cron
  failure transitions, Gateway session reconciliation, redacted
  Gateway-session evidence, and recovered mission rearm orchestration.
  `server/controlPlane.ts` now composes `createMissionRecoveryService(...)`
  and delegates startup mission hydration through
  `missionRecoveryService.hydrateMissionRecordsFromLedger`.
- Mission recovery service coverage now lives in
  `tests/missionRecoveryService.test.ts` and covers active mission hydration,
  missing and disabled cron jobs, unavailable Gateway session reconciliation
  with redaction, missing Gateway session classification, and recovered
  shift/timer delegation. `npm run smoke:mission-recovery` is wired into
  `npm run test:ci`.
- Phase D mission Team Sync extraction is complete:
  `server/services/missions/missionTeamSyncService.ts` owns Team Sync snapshot
  markdown generation, missing `TEAM_SYNC.md` repair, canonical doctrine
  target selection, shared-path mirroring, legacy workspace-root mirroring,
  snapshot writes, assignment metadata rendering, and the `80` entry activity
  cap. `server/controlPlane.ts` now delegates `ensureTeamSyncFile` and
  `writeTeamSyncSnapshot` through the service for mission state, scheduler,
  managed Team Sync orchestration, and party coordination routes.
- Mission Team Sync service coverage now lives in
  `tests/missionTeamSyncService.test.ts` and covers snapshot content, activity
  truncation, missing-file repair without overwriting existing append logs,
  canonical doctrine/shared-path mirroring, and legacy workspace-root
  mirroring. `npm run smoke:mission-team-sync` is wired into
  `npm run test:ci`.
- Phase D mission transition coverage is complete: `tests/missionStateService.test.ts`
  directly verifies `transitionMissionState(...)` lifecycle persistence for
  `draft->validating`, `validating->scheduled`, `scheduled->running`,
  `scheduled->failed`, `running->dispatching`, `dispatching->running`,
  `running->verifying`, `verifying->completed`, `running->failed`, and
  `running->cancelled`, including mission feed events, ledger lifecycle events,
  actor/idempotency/evidence fields, and mission record persist reasons.
- Running-mission cancellation coverage is complete through
  `tests/missionStateService.test.ts` and `npm run smoke:mission-cancellation`,
  including both successful cleanup and cleanup-failure finalization evidence.
- The prior full-suite blocker is resolved: `README.md` now documents
  `release/evidence/distribution-signing.json`, and `npm test` passes end to
  end including release validation.
- Current architecture evidence after the Phase D mission Team Sync extraction
  and transition coverage:
  `npm run smoke:server-architecture` reports `25,192/29,000` control-plane
  composition lines after runtime status extraction and `25,197/29,000`
  composition lines after runtime action extraction, then `25,160/29,000`
  composition lines after runtime recovery extraction, then `25,120/29,000`
  composition lines after runtime ledger store extraction, then
  `24,862/29,000` composition lines after mission state extraction, then
  `23,775/29,000` composition lines after mission scheduler extraction, then
  `23,334/29,000` composition lines after mission report extraction, then
  `23,030/29,000` composition lines after mission recovery extraction, then
  `22,963/29,000` composition lines after mission Team Sync extraction, with
  `9` entry lines and `0` inline routes.
- Runtime, mission, Gateway, plugin, auth, and diagnostic state should become
  structured evidence or ledger events instead of ad hoc strings.
- Renderer state should project backend truth and avoid inventing runtime truth.
- Public signing, paid distribution, storefront work, cloud auth, LAN exposure,
  and silent auto-update wait until private beta recovery and validation are
  proven.
- Phase C items `21-30` are complete and verified.
- Phase D items `31`, `32`, `33`, `34`, `35`, `36`, `37`, `38`, `39`, and `42` are complete and verified.

## Next Optimization Slice

Continue Phase D:

- Add tests for cancelling after backend restart for Phase D item `40`, starting
  from mission recovery hydration and the state-service cancellation path.
- Preserve durable mission hydration, recovered scheduler state, cancellation
  cleanup evidence, Team Sync snapshot writes, and backend-owned lifecycle
  projection behavior.
- Keep `server/controlPlane.ts` as dependency wiring only and keep mission routes
  as HTTP validation/envelope handlers.
- Run focused mission state/recovery tests, mission cancellation/recovery/durable
  smokes, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run
  test:unit`, `npm run lint`, `git diff --check`, and `npm test` after the
  slice.
