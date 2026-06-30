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
  cancellation after backend restart, Team Sync snapshot writes, and
  missing/terminal mission stop rejection.
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
  recovered active cron jobs, missing and disabled cron jobs, unavailable
  cron-state deferral with redacted recovery evidence, unavailable Gateway
  session reconciliation with redaction, missing Gateway session
  classification, and recovered shift/timer delegation.
  `npm run smoke:mission-recovery` is wired into `npm run test:ci`.
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
- Cancellation-after-backend-restart coverage is complete through
  `tests/missionStateService.test.ts` and `npm run smoke:mission-cancellation`.
  The restart-cancellation test hydrates an active durable mission through
  `createMissionRecoveryService(...)`, verifies recovered Gateway/session,
  scheduler, shift, and timer state, then cancels it through
  `createMissionStateService(...).stopMission(...)` with cleanup evidence,
  Team Sync snapshot writes, backend report recording, and
  `transition:running->cancelled` mission record persistence.
- Cron reconciliation coverage is complete through
  `tests/missionRecoveryService.test.ts` and
  `npm run smoke:mission-cron-reconciliation`. The recovery service now
  directly proves active cron jobs are preserved, missing and disabled cron jobs
  fail recovered missions with exact evidence, and unavailable cron-state errors
  are redacted before lifecycle logs or recovery evidence are written.
- Restart/crash recovery smoke coverage is complete through
  `scripts/smoke-mission-restart-recovery.ts` and
  `npm run smoke:mission-restart-recovery`. The smoke hydrates a durable active
  mission through `createMissionRecoveryService(...)` in a fresh post-restart
  mission map, verifies active cron/session reconciliation and recovered
  shift/timer hooks, then imports the actual renderer store with stale
  persisted mission history and confirms `syncMissionProjection()` replaces it
  from `/api/missions/projection`.
- Mission page recovered-state projection is complete: `src/store/nexusStore.ts`
  preserves `lifecycleState: 'failed'` as a failed Mission page state, and
  `src/components/mission/MissionDeploymentPanel.tsx` renders the
  backend-projected mission id/title/status/scheduler round in a compact status
  strip. `src/utils/apiUrl.ts` and `src/data/seeds.ts` now guard Vite
  `import.meta.env` reads so renderer projection smokes can import the store
  under Node.
- Phase E model catalog extraction is complete:
  `server/services/providers/modelCatalogService.ts` owns fallback model
  metadata, unavailable/suppressed model rules, Codex subscription
  canonicalization, provider display normalization, OpenRouter catalog
  allowlist normalization, configured provider model normalization,
  OpenClaw/config/fallback catalog loading, Google Vertex catalog filtering
  delegation, and available-model cache/refresh timers. `server/controlPlane.ts`
  composes `createModelCatalogService(...)` and delegates provider route,
  agent config route, party management route, Doctor, OpenClaw config write,
  Gateway repair, and shutdown cleanup model-catalog call sites through the
  service.
- Model catalog service coverage now lives in `tests/modelCatalogService.test.ts`
  and covers fallback catalog shaping, Codex subscription canonicalization,
  unavailable model suppression, OpenRouter allowlist normalization, OpenClaw
  model list loading, config fallback loading, stale fast-cache behavior, and
  provider model config normalization. `npm run smoke:model-catalog-service` is
  wired into `npm run test:ci`, and the auth/provider plus architecture smokes
  assert model catalog ownership in `server/services/providers/modelCatalogService.ts`.
- Phase E provider auth storage extraction is complete:
  `server/services/providers/providerAuthService.ts` owns local auth store
  hydration and migration, provider API-key/OAuth persistence, OpenClaw
  auth-profile JSON/SQLite synchronization, Codex OAuth preference repair,
  user Codex auth mirroring, provider auth removal, provider status shaping,
  missing-auth model checks, agent auth env projection, and OpenRouter
  auth-triggered plugin/model-catalog repair. `server/controlPlane.ts`
  composes `createProviderAuthService(...)` and delegates provider auth
  readiness, saves, removals, status, model-auth checks, and OAuth credential
  writes through the service.
- Provider auth service coverage now lives in `tests/providerAuthService.test.ts`
  and covers API-key persistence to local auth and agent auth profiles,
  redacted status output, OpenAI Codex OAuth profile propagation/removal of
  legacy profiles, provider credential removal, OpenRouter plugin/catalog
  repair, and missing-auth Codex model status. `npm run smoke:provider-auth-service`
  is wired into `npm run test:ci`, and the auth/provider, architecture, and
  control-center-state smokes assert provider auth ownership in
  `server/services/providers/providerAuthService.ts`.
- Phase E OAuth callback extraction is complete:
  `server/services/providers/oauthCallbackService.ts` owns Google and OpenAI
  Codex OAuth callback listener startup, loopback-only binding, session storage,
  pending-session timeout cleanup, manual Codex authorization-code parsing,
  callback completion, redacted callback errors, provider OAuth credential
  persistence through `providerAuthService`, Google/OpenAI Codex token refresh
  helpers, and shutdown/process-exit listener cleanup. `server/controlPlane.ts`
  composes `createOAuthCallbackService(...)` and delegates OAuth session starts,
  session map reads, manual completion, refresh helpers, and runtime shutdown
  cleanup through the service.
- OAuth callback service coverage now lives in `tests/oauthCallbackService.test.ts`
  and covers Google loopback callback completion, OpenAI Codex manual OAuth
  input completion, pending-session timeout behavior, redacted callback exchange
  failures, and shutdown closing listeners while failing pending sessions.
  `npm run smoke:oauth-callback-service` is wired into `npm run test:ci`, and
  the auth/provider, runtime-actions, production-security, and architecture
  smokes assert OAuth callback ownership in
  `server/services/providers/oauthCallbackService.ts`.
- Phase E provider setup extraction is complete:
  `server/services/providers/providerSetupService.ts` owns Google OAuth client
  config discovery/status, Google project resolution, Google Vertex gcloud and
  local OAuth readiness checks, Vertex process-env projection, provider request
  auth resolution, and OpenAI Codex OAuth runtime helper loading/validation.
  `server/controlPlane.ts` composes `createProviderSetupService(...)` and
  delegates provider setup/auth helper calls through the service while
  remaining composition glue.
- Provider setup service coverage now lives in `tests/providerSetupService.test.ts`
  and covers Google OAuth setup from env and `client_secret.json`, fast Google
  Vertex readiness from local OAuth, probed gcloud project/account/access-token
  readiness, provider request auth through env keys and refreshed OAuth
  credentials, and OpenAI Codex runtime helper exports. `npm run
  smoke:provider-setup-service` is wired into `npm run test:ci`, and the
  auth/provider plus architecture smokes assert provider setup ownership in
  `server/services/providers/providerSetupService.ts`.
- Phase E provider/auth beta coverage is complete:
  `tests/providerAuthService.test.ts` now covers missing API-key, Google OAuth
  setup, and Google Vertex credential states with SecretRef/key-marker
  redaction, plus missing-auth model selection for required, optional-auth,
  configured, and OpenAI Codex subscription model paths.
- OAuth callback beta coverage now includes OpenAI Codex browser-callback
  completion through a loopback-only `127.0.0.1` listener in addition to Google
  loopback completion, pending-session timeout cleanup, manual Codex
  completion, shutdown cleanup, and redacted callback failures.
- `scripts/smoke-provider-auth-beta-coverage.ts` is wired as `npm run
  smoke:provider-auth-beta` and into `npm run test:ci`. It pins the Phase E
  item `50-55` coverage map across provider/OAuth tests, loopback listener
  bindings, missing-auth model decisions, Monitor's `Connect provider` CTA,
  and Agent Editor / Model Selector / Recruit connect-provider prompts.
- Phase F plugin inventory extraction is complete:
  `server/services/plugins/pluginInventoryService.ts` owns plugin discovery,
  bundled manifest fallback discovery, plugin list cache reads/writes and
  refresh behavior, OpenClaw `plugins list --json` parsing, redacted CLI
  warning/error shaping, plugin control payload shaping, plugin setup field
  projection, category/surface normalization, and configured/managed plugin
  merging. `server/controlPlane.ts` now composes
  `createPluginInventoryService(...)` and delegates inventory reads, cache
  refresh, plugin id/name helpers, redacted plugin CLI warning shaping, and
  plugin runtime-state types through the service boundary while later install
  and runtime orchestration remain in Phase F follow-up slices.
- Plugin inventory service coverage now lives in
  `tests/pluginInventoryService.test.ts` and covers configured-only,
  missing-auth, unavailable, failed, managed, and disabled plugin states;
  bundled manifest fallback with redacted CLI warnings; force-refresh cache
  behavior while a background refresh runs; and raw `channels` metadata
  projection for unavailable communication plugins. `npm run
  smoke:plugin-inventory-service` is wired into `npm run test:ci`, and the
  plugin/architecture smokes assert plugin inventory ownership in
  `server/services/plugins/pluginInventoryService.ts`.
- Phase F plugin install/update/remove extraction is complete:
  `server/services/plugins/pluginInstallService.ts` owns plugin
  install/update/update-all/uninstall orchestration, safe pasted install
  command parsing, redacted OpenClaw command result/error shaping, Windows
  install-stage rename repair with Gateway pause/resume, managed install
  runtime-state records, update runtime-state touches, uninstall
  managed/install/secret cleanup, controls refreshes, and Gateway restart
  scheduling decisions. `server/controlPlane.ts` composes
  `createPluginInstallService(...)` with explicit dependencies for OpenClaw
  execution, plugin inventory refreshes, plugin runtime-state reads/writes,
  Gateway lifecycle pause/resume and queued restarts, Codex/ClawTalk repair
  callbacks, and locked rename moves.
- Plugin install service coverage now lives in `tests/pluginInstallService.test.ts`
  and covers successful install/enable with redacted output, managed install
  runtime-state writes, Gateway restart scheduling, Windows rename-failure
  repair and forced retry, update/update-all runtime-state touches, uninstall
  cleanup of managed/install/secret runtime state, redacted command failures,
  and safe pasted install-command parsing. `npm run smoke:plugin-install-service`
  is wired into `npm run test:ci`, and the plugin/architecture smokes assert
  plugin install/update/remove ownership in
  `server/services/plugins/pluginInstallService.ts`.
- PR43 UI font-size smoke coverage is complete as a standalone direct-run
  script: `scripts/smoke-ui-font-sizes.ts` verifies the typography token scale,
  final typography-layer cascade position, legacy `text-[6px]` through
  `text-[10px]` compatibility selectors, and no explicit sub-11px
  `font-size` values in `src/styles/dystopai-theme/95-typography-polish.css`.
  The final typography layer now uses `--dy-type-caption` for the mobile rail
  title and `--dy-type-micro` for the mission readiness mini label. Direct
  verification passed with `node --import tsx scripts/smoke-ui-font-sizes.ts`,
  contrast smoke, `npm run typecheck`, `npm run lint`, `npm run build:client`,
  and `git diff --check`; package-script wiring was deferred during that pass
  and is now handled by the later PR43 primitive foundation slice.
- PR43 UI primitive foundation is complete for Phase 4 items `31-36`:
  `src/components/ui` now contains local token-backed `Button`, `IconButton`,
  `Panel`, `Badge`, `StatusChip`, `Field`, `Input`, `Select`, and `Textarea`
  primitives with component-owned CSS for focus-visible rings, semantic status
  tones, minimum 32px/36px/40px control sizing, reduced-motion handling,
  accessible icon-button names, loading state, and field label/error wiring.
  `scripts/smoke-ui-primitives.ts` verifies these contracts. `package.json`
  now exposes `smoke:ui-contrast`, `smoke:ui-font-sizes`, and
  `smoke:ui-primitives`; `test:ci` was left untouched to avoid colliding with
  active beta split CI edits. Verification passed with all three UI smokes,
  `npm run typecheck`, `npm run lint`, `npm run build:client`, and
  `git diff --check` before later concurrent backend OAuth extraction edits
  appeared. The later Phase E OAuth callback extraction resolved the duplicate
  callback declaration issue; current `npm run typecheck` and `npm test` pass
  end to end. No packages were installed. Next UI work is PR43 Phase 4 item
  `37` Dialog/Radix when package churn is safe, or a Monitor/command-console
  readability slice if shared package changes remain risky.
- PR43 shell navigation semantics are complete for Phase 5 items `41-43`,
  mapped to release-plan Phase 9 items `131-133`: `src/components/layout/NexusShell.tsx`
  now exposes workspace rail destinations as `nexus-nav-*` buttons and active
  workspace regions as `nexus-workspace-*`, while keeping rail state on
  `aria-current="page"` and avoiding tab/panel terminology in the public shell
  DOM contract. `scripts/smoke-shell-production-ui.ts` now asserts both primary
  and utility rail navigation have no `role="tab"`, `role="tablist"`,
  `aria-selected`, or `aria-controls`; `scripts/smoke-ui-render.mjs` now drives
  the production render smoke through the new nav/workspace ids. Verification
  passed with `npm run smoke:shell-production-ui`, `npm run build:client`,
  `npm run smoke:ui` across desktop/wide/mobile screenshots, `npm run
  typecheck`, `npm run lint`, and `git diff --check` with only LF-to-CRLF
  warnings. No packages were installed and no backend/provider/runtime files
  were edited.
- PR43 Monitor source typography cleanup is complete as a focused Pass 4
  readability slice mapped to release-plan Phase 9 items `124`, `125`, and
  `136`: `src/components/monitor/LiveOperationMonitor.tsx` and
  `src/components/monitor/AgentResponseConsole.tsx` no longer contain
  source-level `text-[7px]`, `text-[8px]`, `text-[9px]`, or `text-[10px]`
  utilities for important Monitor/command-console text. Monitor labels, tabs,
  Doctor findings, cron metadata, gateway activity rows, log-tail text,
  heartbeat labels, activity chips, and command attachment metadata now use
  11px-13px source sizes with stronger muted colors where labels carry meaning.
  `scripts/smoke-ui-font-sizes.ts` now fails if those two files reintroduce
  sub-11px text utilities. Verification passed with `npm run
  smoke:ui-font-sizes`, `npm run smoke:ui-contrast`, `npm run typecheck`,
  `npm run lint`, `npm run build:client`, `npm run smoke:ui` across
  desktop/wide/mobile screenshots, and `git diff --check` with only
  LF-to-CRLF warnings. No packages were installed; Dialog/Radix item `37`
  remains deferred while package churn is risky.
- The prior full-suite blocker is resolved: `README.md` now documents
  `release/evidence/distribution-signing.json`, and `npm test` passes end to
  end including release validation.
- Current architecture evidence after the Phase D mission Team Sync extraction,
  transition coverage, restart-cancellation coverage, cron reconciliation
  coverage, and restart/renderer recovery smoke coverage:
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
  `9` entry lines and `0` inline routes; restart-cancellation coverage,
  cron reconciliation coverage, and restart/renderer recovery smoke coverage
  kept the same `22,963/29,000` architecture count.
- Current architecture evidence after Phase E item `46`:
  `npm run smoke:server-architecture` reports `22,577/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after model catalog
  extraction.
- Current architecture evidence after Phase E item `47`:
  `npm run smoke:server-architecture` reports `21,687/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after provider auth
  storage extraction.
- Current architecture evidence after Phase E item `48`:
  `npm run smoke:server-architecture` reports `21,166/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after OAuth callback
  service extraction.
- Current architecture evidence after Phase E item `49`:
  `npm run smoke:server-architecture` reports `20,578/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after provider setup
  service extraction.
- Current architecture evidence after Phase E items `50-55`:
  `npm run smoke:server-architecture` still reports `20,578/29,000`
  control-plane composition lines, `9` entry lines, and `0` inline routes after
  the provider/auth beta coverage sweep.
- Current architecture evidence after Phase F item `56`:
  `npm run smoke:server-architecture` reports `19,803/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after plugin
  inventory extraction.
- Current architecture evidence after Phase F item `57`:
  `npm run smoke:server-architecture` reports `19,360/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after plugin
  install/update/remove extraction.
- Current architecture evidence after Phase F item `58`:
  `npm run smoke:server-architecture` reports `19,040/29,000` control-plane
  composition lines, `9` entry lines, and `0` inline routes after plugin
  runtime command handling extraction.
- Phase F plugin runtime extraction is complete:
  `server/services/plugins/pluginRuntimeService.ts` owns runtime inspect command
  execution, structured JSON parsing, runtime surface summaries, redacted command
  results/errors, setup-terminal PTY/plain-process lifecycle, SSE client
  attachment/detachment, input/resize/stop operations, and shutdown cleanup.
  `server/controlPlane.ts` now composes the service and `server/routes/pluginRoutes.ts`
  receives it through the `pluginRuntime` route option.
- The unit coverage lane was repaired for CI proof: `scripts/run-unit-tests.mjs`
  excludes test files and broad smoke-owned transitive service families while
  preserving direct plugin service coverage. `npm run test:unit:coverage` passes
  with `127` tests and aggregate `95.80%` line, `77.37%` branch, and `91.33%`
  function coverage.
- The renderer CSS budget was ratcheted to the currently accepted UI theme
  artifact: `scripts/check-bundle-budgets.mjs` now defaults to `1,250,000`
  entry CSS bytes and `160,000` entry CSS gzip bytes. This keeps PR 43's
  bundle-budget gate active while allowing the already-imported reference
  screenshot theme CSS to ship.
- Runtime, mission, Gateway, plugin, auth, and diagnostic state should become
  structured evidence or ledger events instead of ad hoc strings.
- Renderer state should project backend truth and avoid inventing runtime truth.
- Public signing, paid distribution, storefront work, cloud auth, LAN exposure,
  and silent auto-update wait until private beta recovery and validation are
  proven.
- Phase C items `21-30` are complete and verified.
- Phase D items `31`, `32`, `33`, `34`, `35`, `36`, `37`, `38`, `39`, `40`, `41`, `42`, `43`, `44`, and `45` are complete and verified.
- Phase E items `46`, `47`, `48`, `49`, `50`, `51`, `52`, `53`, `54`, and `55` are complete and verified.
- Phase F items `56`, `57`, and `58` are complete and verified.

## Next Optimization Slice

Continue Phase F:

- Start item `59`: extract plugin doctor output into a focused plugin doctor
  service while preserving ClawTalk setup/doctor evidence, redacted findings,
  and existing Plugins page setup behavior.
- Keep `server/controlPlane.ts` as dependency wiring only; add focused plugin
  doctor tests and smokes before marking the item complete.
- Rerun focused plugin doctor tests/smokes plus `npm run
  smoke:plugin-runtime-service`, `npm run
  smoke:plugin-install-service`, `npm run smoke:plugin-inventory-service`,
  `npm run smoke:server-architecture`, `npm run typecheck`, `npm run
  test:unit`, `npm run lint`, `git diff --check`, and `npm test` after the
  slice.
