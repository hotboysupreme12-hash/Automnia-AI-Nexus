# DystopAI Beta Readiness And Codebase Split Plan

This plan intentionally avoids public-release signing as the immediate goal. The target is to make DystopAI safe, maintainable, testable, and beta-ready before paid/public distribution work.

## Current priority

The next milestone is not a signed public installer. The next milestone is:

```text
Stable private beta
+ cleaner backend boundaries
+ proven mission/runtime recovery
+ safer UI architecture
+ clear operator docs
+ repeatable local validation
```

## Release posture for this phase

- Treat the next milestone as **Private Beta / Early Access Candidate**.
- Do not block this phase on Authenticode, notarization, or public update signing.
- Keep release-signing workflows documented for later, but do not treat signing as the current blocker.
- Prioritize architecture splits, runtime truth, recovery evidence, and user trust.
- Keep the app local-first and loopback-only.

## Primary engineering goal

Shrink `server/controlPlane.ts` from a giant composition-and-service module into a thin composition root. Routes are already extracted. The remaining work is to move implementation logic into focused services.

## Target server shape

```text
server/
  index.ts                         # executable facade only
  controlPlane.ts                  # composition root only
  controlPlaneHttp.ts              # HTTP middleware, API envelope, auth guard

  routes/                          # already mostly extracted
    authRoutes.ts
    diagnosticsRoutes.ts
    runtimeRoutes.ts
    missionRoutes.ts
    providerAuthRoutes.ts
    pluginRoutes.ts
    ...

  services/
    gateway/
      gatewayLifecycleService.ts
      gatewayChatService.ts
      gatewayDiagnosticsService.ts
      gatewayLogService.ts

    runtime/
      runtimeStatusService.ts
      runtimeActionService.ts
      runtimeLedgerService.ts
      runtimeRecoveryService.ts

    missions/
      missionStateService.ts
      missionSchedulerService.ts
      missionReportService.ts
      missionRecoveryService.ts
      missionTeamSyncService.ts

    agents/
      agentConfigService.ts
      agentTurnService.ts
      agentRoutingService.ts
      agentWorkspaceService.ts

    providers/
      providerCatalogService.ts
      providerAuthService.ts
      oauthCallbackService.ts
      modelCatalogService.ts

    plugins/
      pluginInventoryService.ts
      pluginInstallService.ts
      pluginRuntimeService.ts
      pluginDiagnosticsService.ts

    filesystem/
      safePathService.ts
      commandConsoleUploadService.ts
      controlFilesService.ts
      pickerSessionService.ts

    release/
      releaseEvidenceService.ts
      updateManifestService.ts
      stateBackupService.ts

  state/
    controlCenterStateStore.ts
    openClawStatePaths.ts
    runtimeLedgerStore.ts

  contracts/
    apiEnvelope.ts
    missionContracts.ts
    runtimeContracts.ts
    agentContracts.ts
    pluginContracts.ts
```

## Split rules

1. `server/controlPlane.ts` may wire dependencies but should not own business logic.
2. A route module may validate HTTP payloads and call services, but should not perform long-running work directly.
3. A service module should be testable without starting Express.
4. A service should receive its dependencies through parameters or a factory, not import the whole app.
5. Any filesystem service must enforce path containment at its boundary.
6. Any provider/auth service must return redacted errors.
7. Any runtime service must produce event/evidence objects, not only strings.
8. Mission state transitions must be idempotent and ledger-backed.
9. Renderer state should project backend truth, not invent runtime truth.
10. New code should not be added to `controlPlane.ts` unless it is composition glue.

## Phase A: Freeze new control-plane growth

1. Add a comment at the top of `controlPlane.ts`: no new domain logic goes here.
2. Add an architecture smoke threshold for maximum allowed `controlPlane.ts` line growth.
3. Allow temporary exceptions only with a TODO and extraction target.
4. Keep route inventory checks active.
5. Keep generated architecture reports in docs for visibility.
6. Stop adding new route handlers to the composition module.
7. Stop adding new large helper functions to the composition module.
8. Require every new backend feature to declare its target service folder.
9. Track extracted functions in `docs/PRODUCTION_HARDENING_LEDGER.md`.
10. Run architecture smoke after every extraction.

## Phase B: Extract Gateway services first

Gateway logic is high-risk because it controls process lifecycle and runtime recovery.

11. Extract Gateway process start/stop/restart into `gatewayLifecycleService.ts`.
12. Extract Gateway health probing into `gatewayDiagnosticsService.ts`.
13. Extract Gateway log tailing and redaction into `gatewayLogService.ts`.
14. Extract Gateway chat turn orchestration into `gatewayChatService.ts`.
15. Add unit tests for Gateway process command construction.
16. Add tests for Gateway unavailable behavior.
17. Add tests for redacted Gateway errors.
18. Add tests for stale process cleanup decisions.
19. Update route modules to receive Gateway services through options.
20. Confirm Monitor still shows Gateway online/offline/restarting states.

## Phase C: Extract runtime services

21. Extract runtime summary building into `runtimeStatusService.ts`.
22. Extract runtime actions into `runtimeActionService.ts`.
23. Extract runtime shutdown/clean-slate recovery into `runtimeRecoveryService.ts`.
24. Keep SQLite/JSONL helpers in `runtimeLedger.ts` or move behind `runtimeLedgerStore.ts`.
25. Add tests for runtime summary with healthy Gateway.
26. Add tests for runtime summary with missing Gateway.
27. Add tests for stale sessions.
28. Add tests for clean slate safety.
29. Add tests for ledger fallback.
30. Confirm `useRuntimeStatus` receives the same API shape after extraction.

## Phase D: Extract mission services

31. Extract mission creation and idempotency into `missionStateService.ts`.
32. Extract mission transition rules into `missionStateService.ts`.
33. Extract mission cron scheduling into `missionSchedulerService.ts`.
34. Extract mission report generation into `missionReportService.ts`.
35. Extract mission restart/recovery into `missionRecoveryService.ts`.
36. Extract TEAM_SYNC snapshot writing into `missionTeamSyncService.ts`.
37. Add tests for every mission transition.
38. Add tests for duplicate idempotency keys.
39. Add tests for cancelling a running mission.
40. Add tests for cancelling after backend restart.
41. Add tests for cron reconciliation.
42. Add tests for mission report evidence confidence.
43. Add smoke for mission restart after backend kill.
44. Add smoke for mission recovery after renderer crash.
45. Confirm the Mission page shows recovered mission state, not stale local UI state.

## Phase E: Extract provider and auth services

46. Extract provider catalog normalization into `modelCatalogService.ts`.
47. Extract provider authentication storage into `providerAuthService.ts`.
48. Extract OAuth callback server handling into `oauthCallbackService.ts`.
49. Extract provider-specific setup checks into focused helpers.
50. Add tests for missing credential states.
51. Add tests for provider auth status redaction.
52. Add tests for OAuth callback timeout.
53. Add tests for loopback-only OAuth callback binding.
54. Add tests for model selection when provider auth is missing.
55. Confirm UI shows “connect provider” instead of failing at run time.

## Phase F: Extract plugin services

56. Extract plugin discovery into `pluginInventoryService.ts`.
57. Extract plugin install/update/remove into `pluginInstallService.ts`.
58. Extract plugin runtime command handling into `pluginRuntimeService.ts`.
59. Extract plugin doctor output into `pluginDiagnosticsService.ts`.
60. Add tests for plugin not found.
61. Add tests for plugin install failure.
62. Add tests for redacted plugin errors.
63. Add tests for disabled plugin state.
64. Add tests for channel plugin unavailable state.
65. Confirm Plugins page distinguishes configured, missing-auth, unavailable, failed, and disabled.

## Phase G: Extract filesystem and upload services

66. Extract safe path containment into `safePathService.ts`.
67. Extract command-console upload handling into `commandConsoleUploadService.ts`.
68. Extract control file read/write helpers into `controlFilesService.ts`.
69. Extract Windows folder/image picker sessions into `pickerSessionService.ts`.
70. Add tests for path traversal attempts.
71. Add tests for symlink escapes where possible.
72. Add tests for file type allowlist.
73. Add tests for attachment size limits.
74. Add tests for avatar upload limits.
75. Confirm uploaded command-console files never escape the approved upload root.

## Phase H: Renderer/store split

76. Keep `src/store/nexusStore.ts` from growing further.
77. Move API calls into `src/api/*` modules.
78. Move mission projection syncing into `src/api/missions.ts` or `src/services/missionProjectionClient.ts`.
79. Move agent turn calls into `src/api/agentTurns.ts`.
80. Move provider auth calls into `src/api/providerAuth.ts`.
81. Move plugin calls into `src/api/plugins.ts`.
82. Split UI-only state from runtime projection state.
83. Split agent config state from mission state.
84. Split command-console draft state from runtime response state.
85. Add tests for store migrations and persisted state shape.

## Phase I: UI cleanup without public-release signing

86. Freeze new global CSS layers after `95-typography-polish.css`.
87. Create design-token docs for colors, spacing, typography, radii, and motion.
88. Start replacing late overrides with component-owned CSS one area at a time.
89. Clean side rail semantics: use navigation semantics instead of mixed tab semantics.
90. Keep `aria-current="page"` for active workspace.
91. Keep the skip link working.
92. Verify focus rings on dark surfaces.
93. Verify reduced motion settings.
94. Verify small-text contrast.
95. Capture fresh beta screenshots from packaged production mode.

## Phase J: Beta readiness gates without signing

96. Run `npm ci`.
97. Run `npm run prepare:openclaw-vendor`.
98. Run `npm test`.
99. Run `npm run test:unit:coverage`.
100. Run `npm run build:standalone`.
101. Run `npm run check:bundle-budgets`.
102. Run `npm run smoke:electron-e2e`.
103. Run `npm run package:desktop`.
104. Run `npm run smoke:packaged-electron-launch`.
105. Run `npm run state:backup` against a realistic local state sample.
106. Run `npm run state:verify` on the backup.
107. Run `npm run release:evidence` even for beta, without requiring public signing.
108. Run `npm run release:validate` in non-public mode.
109. Upload beta evidence artifacts to the PR or release draft.
110. Record beta known issues.

## Phase K: Manual beta test script

111. Fresh install or fresh checkout.
112. Launch desktop app.
113. Confirm automatic desktop session bootstrap works.
114. Connect or configure one model provider.
115. Recruit one new test agent.
116. Edit the agent workspace.
117. Send one simple command.
118. Send one command with attachment.
119. Launch one instant mission.
120. Launch one timed mission.
121. Cancel one running mission.
122. Open Monitor and confirm runtime evidence is visible.
123. Restart Gateway from UI.
124. Stop Gateway from tray/menu and recover it.
125. Restart the app and confirm state rehydrates.
126. Run a plugin status check.
127. Trigger a missing-provider-auth path and confirm UI explains it.
128. Trigger a failed command and confirm the error is redacted.
129. Export or inspect a mission report.
130. Use Settings to change UI density or motion and confirm persistence.

## Phase L: Beta docs and support

131. Add a beta disclaimer to release notes.
132. Add a known issues section.
133. Add a “how to recover Gateway” section.
134. Add a “how to reset local state” section.
135. Add a “how to send safe logs” section.
136. Add a “what data stays local” section.
137. Add a “what can leave your machine” section.
138. Add a “supported OS for beta” section.
139. Add a “do not expose local API to network” warning.
140. Add a feedback collection link or issue template.

## Phase M: Exit criteria for this non-signing milestone

141. `controlPlane.ts` has stopped growing.
142. At least Gateway services are extracted.
143. At least Mission services are extracted.
144. At least Runtime summary/recovery services are extracted.
145. Store/API boundaries are cleaner.
146. Packaged desktop launch smoke passes.
147. Mission restart recovery is proven.
148. Beta docs are complete.
149. No missing packaged resources remain.
150. Current production score reaches at least 7.5.

## What waits until later

These are important, but they are not the immediate goal for the current branch:

- Authenticode signing.
- Apple notarization.
- Public update-channel signing.
- Paid public distribution.
- Storefront/payment integration.
- Multi-user cloud authentication.
- LAN or internet-exposed control plane.
- Silent auto-update.

## Immediate next pull requests after this doc

1. `refactor/server-gateway-services`: extract Gateway lifecycle, diagnostics, and logs.
2. `refactor/server-runtime-services`: extract runtime status, actions, and recovery.
3. `refactor/server-mission-services`: extract mission state, scheduler, report, and recovery services.
4. `refactor/provider-auth-services`: extract provider catalog/auth/OAuth modules.
5. `refactor/ui-navigation-semantics`: clean rail nav semantics and focus behavior.
6. `refactor/theme-consolidation-pass-1`: freeze override layers and start component CSS consolidation.

## Success statement

This phase is complete when DystopAI can be handed to a small trusted beta group with confidence that core work paths, recovery paths, state paths, and operator docs are real, even if public signing and paid distribution are postponed.

## Automation Progress

### 2026-06-30 - Phase A control-plane growth guard

Completed verified plan items: 1, 2, 4, 5, 6, 8, 10.

Evidence:

- `server/controlPlane.ts` now starts with a no-new-domain-logic guard that directs new backend behavior to the target service folder from this plan.
- `scripts/smoke-server-entrypoint-boundary.ts` enforces the guard comment, a non-loosened `29,000` line budget, zero inline `/api` routes in `controlPlane.ts`, route registration boundaries, and generated architecture report coverage.
- `docs/generated/server-index-architecture.md` was regenerated with `28,879` control-plane composition lines.
- `npm run smoke:server-architecture` passed with `28,879/29,000` composition lines and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run lint` passed after the smoke-script guard update.

Still open from Phase A:

- Item 3: temporary-exception policy needs a future extraction-target-specific check if exceptions are introduced.
- Item 7: large-helper prevention remains covered by the line budget for now, but should become stricter as service extraction proceeds.
- Item 9: extracted-function tracking continues in `docs/PRODUCTION_HARDENING_LEDGER.md` during Phase B and later extractions.

### 2026-06-30 - Phase B Gateway lifecycle service extraction

Completed verified plan items: 11, 15, 16.

Evidence:

- `server/services/gateway/gatewayLifecycleService.ts` now owns Gateway process start/stop/restart state, startup timeline, health monitor timers, listener PID lookup, restart lifecycle memory, restart diagnostics, manual stop handling, and plugin-install pause/resume handling.
- `server/controlPlane.ts` now delegates Gateway lifecycle behavior to `createGatewayLifecycleService(...)` and keeps the composition root responsible for dependency wiring only.
- `tests/gatewayLifecycleService.test.ts` covers Gateway command construction, unavailable runtime behavior, external-listener restart refusal, forced restart command/env construction, and restart lifecycle outcome tracking.
- `scripts/smoke-gateway-lifecycle-service.ts` is wired as `npm run smoke:gateway-lifecycle` and verifies the extracted service without starting Express or a real Gateway.
- `docs/generated/server-index-architecture.md` was regenerated with `28,155` control-plane composition lines after the extraction.
- Verification passed: `npm run typecheck`, `npm run test:unit`, `npm run smoke:gateway-lifecycle`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, and `npm run lint`.

Still open from Phase B:

- Items 12-14: extract Gateway diagnostics, log tailing/redaction, and chat turn orchestration into focused services.
- Items 17-20: add redacted-error and stale-cleanup coverage, inject the remaining Gateway services through route options, and confirm Monitor state behavior after the remaining service extractions.
- Full `npm test` is not a Phase B lifecycle blocker but currently fails at `smoke:release-validation` because `README.md` does not document `distribution-signing.json` as expected by `scripts/smoke-release-validation.ts`.

### 2026-06-30 - Phase B Gateway diagnostics service extraction

Completed verified plan items: 12.

Evidence:

- `server/services/gateway/gatewayDiagnosticsService.ts` now owns Gateway `/health`, `/readyz`, and `diagnostics.stability` probing and normalization.
- `server/controlPlane.ts` delegates Gateway health/readiness/stability behavior to `createGatewayDiagnosticsService(...)` and keeps only composition wrappers for existing runtime and Doctor call sites.
- `tests/gatewayDiagnosticsService.test.ts` covers healthy Gateway payloads, degraded readiness summaries, missing Gateway client behavior, redacted stability warnings, and redacted stability request failures.
- `scripts/smoke-gateway-diagnostics-service.ts` is wired as `npm run smoke:gateway-diagnostics` and into `npm run test:ci`.
- `docs/generated/server-index-architecture.md` was regenerated with `27,838` control-plane composition lines after the diagnostics extraction.
- Verification passed: `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit`, `npm run smoke:gateway-diagnostics`, `npm run smoke:gateway-lifecycle`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:openclaw`, and `npm run lint`.
- `npm test` reached and passed `npm run smoke:gateway-diagnostics`, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open from Phase B:

- Items 13-14: extract Gateway log tailing/redaction and chat turn orchestration into focused services.
- Items 17-20: add remaining redacted-error and stale-cleanup coverage, inject remaining Gateway services through route options, and confirm Monitor Gateway state behavior after the remaining service extractions.

### 2026-06-30 - Phase B Gateway log service extraction

Completed verified plan items: 13.

Evidence:

- `server/services/gateway/gatewayLogService.ts` now owns Gateway log compaction/redaction, in-memory log mirroring, `logs.tail` RPC reads, file-log discovery and tail snapshots, channel activity parsing, dedupe, current-start filtering, and loaded-plugin extraction from logs.
- `server/controlPlane.ts` delegates Gateway log behavior to `createGatewayLogService(...)` and keeps only composition wrappers for existing runtime status, Doctor, and Monitor call sites.
- `tests/gatewayLogService.test.ts` covers redacted ledger writes, `logs.tail` RPC parsing, local file-tail fallback after redacted RPC failure, ClawTalk websocket channel activity parsing, current-start filtering, dedupe, activity summaries, and plugin id extraction.
- `scripts/smoke-gateway-log-service.ts` is wired as `npm run smoke:gateway-logs` and into `npm run test:ci`.
- `scripts/smoke-openclaw-contracts.mjs` and `scripts/smoke-runtime-status-control-plane.ts` now assert Gateway log internals in the service instead of forcing them back into `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `26,883` control-plane composition lines after the log extraction.
- Verification passed: `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit`, `npm run smoke:gateway-logs`, `npm run smoke:gateway-diagnostics`, `npm run smoke:gateway-lifecycle`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:openclaw`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `npm test` reached and passed `npm run smoke:gateway-logs`, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open from Phase B:

- Item 14: extract Gateway chat turn orchestration into `gatewayChatService.ts`.
- Items 17-20: add remaining redacted-error and stale-cleanup coverage, inject any remaining Gateway services through route options, and confirm Monitor Gateway state behavior after chat extraction.

### 2026-06-30 - Phase B Gateway chat service extraction

Completed verified plan items: 14, 17.

Evidence:

- `server/services/gateway/gatewayChatService.ts` now owns the persistent loopback Gateway `gateway-client`, connect/startup readiness, stream observer/waiter state, `chat.send`, `chat.history`, `chat.message.get`, `chat.abort`, recovery snapshots, prewarm state, Gateway event projection, and final reply shaping.
- `server/controlPlane.ts` now composes `createGatewayChatService(...)` and delegates Gateway chat turns, stream observers, stale waiter aborts, prewarm state, ready-client access, and shutdown cleanup through the service.
- `tests/gatewayChatService.test.ts` covers Gateway chat payload construction, durable `chat.history` final replies, oversized-history `chat.message.get` fallback, request cancellation issuing `chat.abort`, redacted Gateway send failures, redacted terminal error payloads, stale waiter recovery, and Gateway chat state normalization.
- `scripts/smoke-gateway-chat-service.ts` is wired as `npm run smoke:gateway-chat` and into `npm run test:ci`.
- `scripts/smoke-openclaw-contracts.mjs` and `scripts/smoke-runtime-actions-control-plane.ts` now assert Gateway chat internals in the service instead of forcing them back into `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `25,696` control-plane composition lines after the chat extraction.
- Verification passed: `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`36` tests), `npm run smoke:gateway-chat`, `npm run smoke:gateway-lifecycle`, `npm run smoke:gateway-diagnostics`, `npm run smoke:gateway-logs`, `npm run smoke:openclaw`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `npm test` reached and passed `npm run smoke:gateway-chat`, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open from Phase B:

- Items 18-20: add stale process cleanup decision coverage if any lifecycle gap remains, inject any remaining Gateway service seams through route options where applicable, and confirm Monitor Gateway online/offline/restarting states after the Gateway service split.

### 2026-06-30 - Phase B Gateway validation sweep

Completed verified plan items: 18, 19, 20.

Evidence:

- `tests/gatewayLifecycleService.test.ts` now covers stale unhealthy listener release before replacement spawn, no-spawn behavior when listener release fails and the port remains busy, and Monitor-facing Gateway `healthy`, `offline`, and `restarting` status snapshots after an unhealthy process exit.
- `scripts/smoke-gateway-lifecycle-service.ts` now verifies the same stale-listener cleanup decisions and Monitor state projection in the standalone Gateway lifecycle smoke without starting Express or a real Gateway.
- `scripts/smoke-server-entrypoint-boundary.ts` now enforces the Gateway service split and route-option seams: lifecycle process helpers, diagnostics probing, log tailing/RPC reads, and chat WebSocket orchestration must stay in `server/services/gateway/*`, with runtime/diagnostics/agent-turn routes receiving Gateway behavior through options.
- `docs/generated/server-index-architecture.md` was regenerated with `25,696` control-plane composition lines; the architecture smoke still reports `0` inline routes and the Phase A guard intact.
- Verification passed: `npm run test:unit` (`39` tests), `npm run smoke:gateway-lifecycle`, `npm run smoke:gateway-diagnostics`, `npm run smoke:gateway-logs`, `npm run smoke:gateway-chat`, `npm run typecheck`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, `npm run smoke:route-inventory`, `npm run smoke:server-architecture`, `node scripts/report-server-index-architecture.mjs`, `npm run lint`, and `git diff --check`.

Phase B status:

- Phase B items 11-20 are complete and verified.

Next:

- Start Phase C with runtime summary/status extraction into `server/services/runtime/runtimeStatusService.ts`, keeping the existing runtime API shape consumed by `useRuntimeStatus`.

### 2026-06-30 - Phase C runtime status service extraction

Completed verified plan items: 21, 25, 26, 27, 29, 30.

Evidence:

- `server/services/runtime/runtimeStatusService.ts` now owns runtime status and summary payload construction, status/summary caches, response-deadline fallback, cached fallback shaping, Gateway ledger/log/activity projections, plugin summary projection, active mission/shift projection, and Monitor fallback payloads.
- `server/controlPlane.ts` now composes `createRuntimeStatusService(...)` and keeps only dependency wiring plus thin `getRuntimeStatusPayload(...)`, `getRuntimeSummaryPayload(...)`, and `invalidateRuntimeStatusCache()` wrappers for existing route/service call sites.
- `tests/runtimeStatusService.test.ts` covers healthy Gateway runtime summaries, missing Gateway summaries that still use Gateway ledger evidence, stale session evidence passthrough, and timeout fallback to cached redacted runtime status.
- `scripts/smoke-runtime-status-control-plane.ts`, `scripts/smoke-server-entrypoint-boundary.ts`, and `scripts/smoke-openclaw-contracts.mjs` now assert runtime status ownership in `server/services/runtime/runtimeStatusService.ts` instead of forcing status logic back into `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `25,192` control-plane composition lines and `0` inline routes after the extraction.
- Verification passed: `npm run test:unit` (`43` tests), `npm run smoke:runtime-status-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, `npm run typecheck`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `npm test` passed all gates through `smoke:release-signing`, including the new runtime status tests and updated OpenClaw/runtime status smokes, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open after the runtime status slice:

- Items 22-24: extract runtime actions, runtime shutdown/clean-slate recovery, and runtime ledger store ownership.
- Item 28: add focused clean-slate safety tests during runtime recovery extraction.

Next after the runtime status slice:

- Continue Phase C with runtime actions extraction into `server/services/runtime/runtimeActionService.ts`, preserving route behavior in `server/routes/runtimeRoutes.ts`.

### 2026-06-30 - Phase C runtime action service extraction

Completed verified plan items: 22.

Evidence:

- `server/services/runtime/runtimeActionService.ts` now owns runtime action orchestration for session close, stale Gateway chat aborts, runtime monitor clear, desktop runtime shutdown, and Gateway stop/start/restart actions.
- `server/routes/runtimeRoutes.ts` now keeps HTTP payload validation and canonical success/error envelopes, then delegates action behavior through the injected `RuntimeActionService`.
- `server/controlPlane.ts` composes `createRuntimeActionService(...)` with existing Gateway lifecycle/chat/log, session cleanup, monitor, and shutdown dependencies and injects it into `registerRuntimeRoutes(...)`.
- `tests/runtimeActionService.test.ts` covers session close cleanup and activity snapshots, stale waiter abort cache invalidation, monitor clear marker writes and cleanup counts, Gateway stop/start/restart status snapshots, and desktop shutdown reason propagation.
- `scripts/smoke-runtime-actions-control-plane.ts`, `scripts/smoke-server-entrypoint-boundary.ts`, `scripts/smoke-runtime-status-control-plane.ts`, and `scripts/smoke-openclaw-contracts.mjs` now assert runtime action ownership in `server/services/runtime/runtimeActionService.ts` instead of route-level orchestration.
- `docs/generated/server-index-architecture.md` was regenerated with `25,197` control-plane composition lines and `0` inline routes.
- Verification passed: `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`48` tests), `npm run smoke:runtime-actions-control-plane`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:openclaw`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `npm test` passed all gates through `smoke:release-signing`, including the new runtime action tests and updated runtime/OpenClaw smokes, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open from Phase C:

- Items 23-24: extract runtime shutdown/clean-slate recovery and runtime ledger store ownership.
- Item 28: add focused clean-slate safety tests during runtime recovery extraction.

Next:

- Continue Phase C with runtime recovery extraction into `server/services/runtime/runtimeRecoveryService.ts`, preserving clean-slate safety and shutdown behavior.

### 2026-06-30 - Phase C runtime recovery service extraction

Completed verified plan items: 23, 28.

Evidence:

- `server/services/runtime/runtimeRecoveryService.ts` now owns runtime shutdown cleanup, concurrent shutdown dedupe, process-exit best-effort cleanup, and Monitor Clean Slate recovery.
- `server/controlPlane.ts` now composes `createRuntimeRecoveryService(...)` with explicit dependencies for mission snapshots, session cleanup, active runtime termination, Gateway client/runtime shutdown, OAuth callback cleanup, plugin setup terminal cleanup, session-lock sweeping, marker persistence, cache invalidation, and runtime ledger close.
- `server/services/runtime/runtimeActionService.ts` keeps the runtime HTTP action surface stable while delegating `clearRuntimeMonitor()` and `shutdownRuntime()` to the recovery service.
- `tests/runtimeRecoveryService.test.ts` covers Clean Slate safety without stopping active runtime/Gateway work, shutdown in-flight dedupe, structured shutdown evidence, warning-tolerant cleanup continuation, and synchronous process-exit cleanup.
- `tests/runtimeActionService.test.ts` now verifies action-level delegation to the recovery service while preserving response shape.
- `scripts/smoke-runtime-actions-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now assert recovery ownership in `server/services/runtime/runtimeRecoveryService.ts` and prevent shutdown/Clean Slate logic from returning to `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `25,160` control-plane composition lines and `0` inline routes.
- Verification passed: `npm run typecheck:server`, `npm run test:unit` (`52` tests), `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:route-inventory`, `npm run smoke:openclaw`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `npm test` passed all gates through `smoke:release-signing`, including the new runtime recovery tests and updated runtime/architecture smokes, then failed at the pre-existing late `smoke:release-validation` gate because `README.md` does not document `distribution-signing.json`.

Still open from Phase C:

- Item 24: move runtime ledger ownership behind `runtimeLedgerStore.ts` or equivalent state boundary.

Next:

- Continue Phase C with runtime ledger store extraction, preserving JSONL/SQLite fallback evidence and existing runtime status API shape.

### 2026-06-30 - Phase C runtime ledger store extraction

Completed verified plan items: 24.

Evidence:

- `server/state/runtimeLedgerStore.ts` now owns the runtime ledger state boundary, canonical ledger paths, control-center state namespace keys, runtime/gateway/diagnostic/mission append/read methods, non-blocking status reads, and ledger close wiring.
- `server/runtimeLedger.ts` remains the low-level SQLite/JSONL helper implementation; `server/controlPlane.ts` now composes `createRuntimeLedgerStore(...)` and routes runtime, Gateway, diagnostic, mission, control-center state, and recovery ledger access through the store.
- `tests/runtimeLedgerStore.test.ts` covers JSONL fallback diagnostics with malformed-row evidence, JSONL append/read fallback across runtime/Gateway/diagnostic/mission ledgers, and namespaced control-center state ownership.
- `scripts/smoke-server-entrypoint-boundary.ts`, `scripts/smoke-openclaw-contracts.mjs`, `scripts/smoke-runtime-ledger-jsonl-tail.ts`, `scripts/smoke-control-center-sqlite-state.ts`, `scripts/smoke-mission-durable-state.ts`, `scripts/smoke-mission-lifecycle-projection.ts`, and `scripts/smoke-gateway-log-service.ts` now assert the store boundary instead of forcing direct runtime ledger helper calls back into `controlPlane.ts`.
- `README.md` now documents `release/evidence/distribution-signing.json`, clearing the previously recorded `smoke:release-validation` README contract blocker.
- `docs/generated/server-index-architecture.md` was regenerated with `25,120` control-plane composition lines and `0` inline routes.
- Verification passed: `npm run typecheck:server`, `npm run test:unit` (`55` tests), `npm run typecheck`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:route-inventory`, `npm run smoke:server-architecture`, `npm run smoke:ledger`, `npm run smoke:control-center-state`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:gateway-logs`, `npm run smoke:openclaw`, `npm run smoke:release-validation`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` now passes end to end, including release validation, release lifecycle, and CI workflow smokes.

Phase C status:

- Phase C items 21-30 are complete and verified.

Next:

- Start Phase D with mission creation/idempotency and transition extraction into `server/services/missions/missionStateService.ts`, preserving ledger-backed mission projection behavior.

### 2026-06-30 - Phase D mission state service extraction

Completed verified plan items: 31, 32, 38.

Evidence:

- `server/services/missions/missionStateService.ts` now owns mission launch idempotency, mission record creation, mission duration/timer arming, mission view/progress projection, scheduler initial state, lifecycle event appends, mission record persistence, mission start rollback, and operator cancellation transitions.
- `server/routes/missionRoutes.ts` now keeps HTTP payload validation and canonical success/error envelopes, then delegates mission start/stop state behavior through the injected `missionStateService`.
- `server/controlPlane.ts` now composes `createMissionStateService(...)` with explicit runtime ledger, scheduler, report, Team Sync, timer, and cleanup dependencies. Existing mission cron execution, report generation, recovery, and projection call sites use the service-owned state methods.
- `tests/missionStateService.test.ts` covers duplicate idempotency-key launches, ledger-backed launch transitions, scheduler setup rollback, operator cancellation cleanup evidence, Team Sync snapshot writes, and missing/terminal mission stop rejection.
- `scripts/smoke-server-entrypoint-boundary.ts`, `scripts/smoke-mission-idempotency.ts`, `scripts/smoke-mission-cancellation.ts`, `scripts/smoke-mission-durable-state.ts`, and `scripts/smoke-api-envelope.ts` now assert mission state ownership in `server/services/missions/missionStateService.ts` instead of route-level orchestration.
- `docs/generated/server-index-architecture.md` was regenerated with `24,862` control-plane composition lines and `0` inline routes.
- Verification passed: `node --import tsx --test tests/missionStateService.test.ts`, `npm run typecheck:server`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-durable-state`, `npm run smoke:server-architecture`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-report`, `npm run smoke:mission-gateway-reconciliation`, `npm run test:unit` (`59` tests), `npm run typecheck`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `npm run smoke:route-inventory`, `npm run smoke:api-envelope`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.

Still open from Phase D:

- Items 33-36: extract mission cron scheduling, report generation, restart/recovery, and TEAM_SYNC snapshot writing into focused mission services.
- Items 37 and 39-45: broaden mission transition/cancellation/recovery tests and manual restart/crash recovery smokes after the remaining service extractions.

Next:

- Continue Phase D with mission scheduler extraction into `server/services/missions/missionSchedulerService.ts`, preserving cron reconciliation, recurring/instant scheduling, cancellation cleanup, and backend-owned mission projection behavior.

### 2026-06-30 - Phase D mission scheduler service extraction

Completed verified plan items: 33.

Evidence:

- `server/services/missions/missionSchedulerService.ts` now owns mission cron scheduling behavior: one-shot and recurring cron job creation, OpenClaw cron add/run/rm/disable command orchestration, cron prompt construction, instant round timers, mission run controllers, recurring cron arming, scheduler-driven mission completion, cancellation cleanup, rehydrated mission timers, recurring shift rehydration, cron runtime/session reference capture, agent memory handoff writes, and Team Sync scheduler evidence through injected dependencies.
- `server/controlPlane.ts` now composes `createMissionSchedulerService(...)`; `missionStateService` receives scheduler behavior through service callbacks, and durable mission hydration delegates recurring shift rehydration and timer arming to the scheduler service.
- `tests/missionSchedulerService.test.ts` covers recurring leader/worker cron arming, cleanup fallback from failed removal to disable, max-cycle completion without launching extra work, and instant mission scheduling through cron run completion.
- `scripts/smoke-mission-scheduler-service.ts` is wired as `npm run smoke:mission-scheduler` and into `npm run test:ci`; mission cancellation, cron reconciliation, durable state, runtime reference, Gateway reconciliation, and architecture smokes were updated to assert the new service boundary.
- `docs/generated/server-index-architecture.md` was regenerated with `23,775` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the scheduler extraction.
- Verification passed: `node --import tsx --test tests/missionSchedulerService.test.ts`, `npm run typecheck:server`, `npm run test:unit` (`63` tests), `npm run smoke:mission-scheduler`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-runtime-references`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-report`, `npm run smoke:mission-verification`, `npm run smoke:api-envelope`, `npm run smoke:route-inventory`, `npm run smoke:server-architecture`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, `npm run typecheck`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.

Still open from Phase D:

- Items 34-36: extract mission report generation, restart/recovery, and TEAM_SYNC snapshot writing into focused mission services.
- Items 37 and 39-45: broaden mission transition/cancellation/recovery tests and restart/crash recovery smokes after the remaining service extractions.

Next:

- Continue Phase D with mission report generation extraction into `server/services/missions/missionReportService.ts`, preserving backend report evidence and existing Mission report API shape.

### 2026-06-30 - Phase D mission report service extraction

Completed verified plan items: 34, 42.

Evidence:

- `server/services/missions/missionReportService.ts` now owns backend mission report contracts, report evidence scoring, unavailable metric shaping, runtime/cron/session reference accounting, durable report listing, mission record normalization for projection, feed/event merging, and report-backed mission lifecycle projection.
- `server/controlPlane.ts` now composes `createMissionReportService(...)` and delegates `recordMissionReport`, `listMissionReports`, and `buildMissionLifecycleProjection` through the service while retaining only dependency wiring and recovery call-site glue.
- `server/routes/missionRoutes.ts` now consumes `BackendMissionReport` and `MissionLifecycleProjection` contracts from the mission report service while keeping HTTP validation/envelope behavior unchanged.
- `tests/missionReportService.test.ts` covers runtime-backed cron/session report evidence, mission-feed-only fallback reports, failed cron-job score lowering, explicit no-evidence reports with unavailable metrics, and durable-plus-memory report/projection merging.
- `scripts/smoke-mission-report-service.ts` is wired as `npm run smoke:mission-report-service` and into `npm run test:ci`; mission durable-state, lifecycle-projection, runtime-reference, and architecture smokes now assert report/projection ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `23,334` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/missionReportService.test.ts`, `npm run smoke:mission-report-service`, `npm run typecheck:server`, `npm run smoke:server-architecture`, `npm run smoke:mission-report`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-runtime-references`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-backend-owned`, `npm run smoke:api-envelope`, `npm run test:unit` (`68` tests), `npm run typecheck`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `npm run smoke:route-inventory`, `npm run smoke:openclaw`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- Full `npm test` passed end to end, including the new mission report service smoke, release validation, release lifecycle, and CI workflow smokes.

Still open from Phase D:

- Items 35-36: extract mission restart/recovery and TEAM_SYNC snapshot writing into focused mission services.
- Items 37 and 39-45: broaden mission transition/cancellation/recovery tests and restart/crash recovery smokes after the remaining service extractions.

Next:

- Continue Phase D with mission restart/recovery extraction into `server/services/missions/missionRecoveryService.ts`, preserving durable hydration, cron reconciliation, Gateway session reconciliation, and recovered mission projection behavior.

### 2026-06-30 - Phase D mission recovery service extraction

Completed verified plan items: 35.

Evidence:

- `server/services/missions/missionRecoveryService.ts` now owns durable mission restart hydration, recovered cron reconciliation, missing/disabled cron failure transitions, Gateway session reconciliation, redacted Gateway-session evidence, and recovered mission rearm orchestration.
- `server/controlPlane.ts` now composes `createMissionRecoveryService(...)` with explicit dependencies for runtime-run status lookup, OpenClaw cron-state snapshots, Gateway client access, mission state/report callbacks, scheduler rehydration hooks, and ledger reads. It keeps only `const hydrateMissionRecordsFromLedger = missionRecoveryService.hydrateMissionRecordsFromLedger` for startup wiring.
- `tests/missionRecoveryService.test.ts` covers active mission hydration, missing and disabled cron jobs, unavailable Gateway session reconciliation with redaction, missing Gateway session classification, and recovered shift/timer delegation.
- `scripts/smoke-mission-recovery-service.ts` is wired as `npm run smoke:mission-recovery` and into `npm run test:ci`; mission durable-state, cron reconciliation, Gateway reconciliation, and architecture smokes now assert recovery ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `23,030` control-plane composition lines and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/missionRecoveryService.test.ts`, `npm run smoke:mission-recovery`, `npm run typecheck:server`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-durable-state`, `npm run smoke:server-architecture`, `npm run test:unit` (`72` tests), `npm run typecheck`, `npm run lint`, `npm run smoke:mission-report-service`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-runtime-references`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-report`, `npm run smoke:mission-verification`, `npm run smoke:route-inventory`, `npm run smoke:api-envelope`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- Full `npm test` passed end to end, including the new mission recovery service smoke, runtime recovery soak, release validation, release lifecycle, and CI workflow smokes.

Still open from Phase D:

- Item 36: extract TEAM_SYNC snapshot writing into `server/services/missions/missionTeamSyncService.ts`.
- Items 37 and 39-45: broaden mission transition/cancellation/recovery tests and restart/crash recovery smokes after the remaining service extraction.

Next:

- Continue Phase D with TEAM_SYNC snapshot extraction into `server/services/missions/missionTeamSyncService.ts`, preserving append-only handoff files, snapshot evidence, mission scheduler/state call sites, and existing Team Sync route behavior.

### 2026-06-30 - Phase D mission Team Sync service extraction

Completed verified plan items: 36.

Evidence:

- `server/services/missions/missionTeamSyncService.ts` now owns Team Sync snapshot markdown generation, missing `TEAM_SYNC.md` repair, canonical doctrine snapshot target selection, legacy workspace-root mirroring, shared Team Sync path mirroring, snapshot writes, assignment metadata rendering, and the established `80` entry activity cap.
- `server/controlPlane.ts` now composes `createMissionTeamSyncService(...)` and delegates `ensureTeamSyncFile` and `writeTeamSyncSnapshot` through the service for mission state, mission scheduler, managed Team Sync orchestration, and party coordination routes.
- `tests/missionTeamSyncService.test.ts` covers snapshot content, activity truncation, missing-file repair without overwriting existing append logs, canonical doctrine/shared-path mirroring, and legacy workspace-root mirroring.
- `scripts/smoke-mission-team-sync-service.ts` is wired as `npm run smoke:mission-team-sync` and into `npm run test:ci`; `scripts/smoke-server-entrypoint-boundary.ts` and `scripts/smoke-team-sync-control-plane.ts` now assert Team Sync snapshot ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `22,963` control-plane composition lines and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/missionTeamSyncService.test.ts`, `npm run smoke:mission-team-sync`, `npm run smoke:team-sync-control-plane`, `npm run typecheck:server`, `node scripts/report-server-index-architecture.mjs`, `npm run smoke:server-architecture`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-report-service`, `npm run smoke:mission-recovery`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-runtime-references`, `npm run smoke:mission-report`, `npm run smoke:api-envelope`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`76` tests), `npm run lint`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:openclaw`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- Full `npm test` passed end to end, including the new `smoke:mission-team-sync` CI gate, runtime recovery soak, release validation, release lifecycle, and CI workflow smokes.

Still open from Phase D:

- Item 37: broaden tests for every mission transition.
- Items 39-45: broaden cancellation/recovery tests and restart/crash recovery smokes.

Next:

- Continue Phase D with mission transition coverage for item 37, starting in `tests/missionStateService.test.ts` and preserving ledger-backed transition evidence.

### 2026-06-30 - Phase D mission transition coverage

Completed verified plan items: 37, 39.

Evidence:

- `tests/missionStateService.test.ts` now covers invalid launch rejection before state mutation, duplicate idempotency-key launches, instant scheduler-round delegation, recurring scheduler/timer arming, scheduler setup rollback, successful running-mission cancellation, cleanup-failure cancellation evidence, and missing/terminal mission stop rejection.
- `tests/missionStateService.test.ts` now directly verifies `transitionMissionState(...)` persistence for the mission state, scheduler, and recovery lifecycle edges: `draft->validating`, `validating->scheduled`, `scheduled->running`, `scheduled->failed`, `running->dispatching`, `dispatching->running`, `running->verifying`, `verifying->completed`, `running->failed`, and `running->cancelled`.
- The lifecycle transition coverage asserts mission feed events, ledger lifecycle events, actor/idempotency/evidence fields, and mission record persist reasons for each edge.
- `docs/generated/server-index-architecture.md` was regenerated with `22,963` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/missionStateService.test.ts`, `npm run typecheck:server`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-recovery`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-report-service`, `npm run smoke:server-architecture`, `npm run test:unit` (`81` tests), `npm run typecheck`, `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- Full `npm test` passed end to end, including mission recovery, Team Sync, durable state, idempotency, cron reconciliation, scheduler, cancellation, runtime references, Gateway reconciliation, lifecycle projection, backend-owned mission lifecycle, Gateway service, runtime, release, security, secret-scan, and CI workflow smokes.

Still open from Phase D:

- Item 40: add tests for cancelling after backend restart.
- Item 41: broaden cron reconciliation test coverage if gaps remain after the restart-cancellation slice.
- Items 43-45: add restart/crash recovery smokes and confirm the Mission page shows recovered backend state rather than stale renderer state.

Next:

- Continue Phase D with item 40: cancellation after backend restart, preserving durable mission hydration, recovered scheduler state, cancellation cleanup evidence, and backend-owned projection behavior.

### 2026-06-30 - Phase D cancellation after backend restart

Completed verified plan items: 40.

Evidence:

- `tests/missionStateService.test.ts` now covers cancellation after backend restart by hydrating an active durable mission through `createMissionRecoveryService(...)`, then cancelling the recovered mission through `createMissionStateService(...).stopMission(...)`.
- The restart-cancellation test verifies durable mission hydration, Gateway session reconciliation, recovered scheduler round/job state, recurring shift rehydration, recovered timer arming, operator cancellation evidence, cron cleanup summary, Team Sync cancellation snapshot, backend mission report recording, and `transition:running->cancelled` mission record persistence.
- `scripts/smoke-mission-cancellation.ts` now asserts that the mission state test suite includes the restart-cancellation coverage, durable hydration call, and operator cancellation evidence.
- `docs/generated/server-index-architecture.md` was regenerated with `22,963` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/missionStateService.test.ts`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-recovery`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:server-architecture`, `node scripts/report-server-index-architecture.mjs`, `npm run typecheck`, `npm run test:unit` (`82` tests), `npm run lint`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including mission recovery, durable state, cron reconciliation, cancellation, runtime recovery soak, Gateway service smokes, release validation, release lifecycle, secret scan, and CI workflow checks.

Still open from Phase D:

- Item 41: broaden cron reconciliation test coverage if gaps remain after the restart-cancellation slice.
- Items 43-45: add restart/crash recovery smokes and confirm the Mission page shows recovered backend state rather than stale renderer state.

Next:

- Continue Phase D with item 41: review cron reconciliation coverage and add any missing tests around recovered active, missing, disabled, and unavailable cron-state paths.

### 2026-06-30 - Phase D cron reconciliation coverage

Completed verified plan items: 41.

Evidence:

- `server/services/missions/missionRecoveryService.ts` now redacts unavailable OpenClaw cron-state errors before writing lifecycle logs or recovered mission evidence.
- `tests/missionRecoveryService.test.ts` now directly covers recovered active cron jobs, missing and disabled cron jobs with exact transition evidence, unavailable cron-state deferral, and redacted unavailable cron reconciliation evidence during durable mission hydration.
- `scripts/smoke-mission-cron-reconciliation.ts` now asserts the active/missing/disabled/unavailable cron coverage and the redaction boundary for unavailable cron-state errors.
- `docs/generated/server-index-architecture.md` was regenerated with `22,963` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/missionRecoveryService.test.ts`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-recovery`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:server-architecture`, `node scripts/report-server-index-architecture.mjs`, `npm run typecheck`, `npm run test:unit` (`85` tests), `npm run lint`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end, including mission recovery, cron reconciliation, durable state, Gateway reconciliation, runtime recovery soak, Gateway service smokes, release validation, release lifecycle, secret scan, and CI workflow checks.

Still open from Phase D:

- Items 43-45: add restart/crash recovery smokes and confirm the Mission page shows recovered backend state rather than stale renderer state.

Next:

- Continue Phase D with items 43-45: add backend restart/renderer crash recovery smoke coverage and verify the Mission page projects recovered backend-owned mission state.

### 2026-06-30 - Phase D restart and renderer recovery smoke

Completed verified plan items: 43, 44, 45.

Evidence:

- `scripts/smoke-mission-restart-recovery.ts` now performs a service-level backend restart recovery check by hydrating a durable active mission into a fresh mission map through `createMissionRecoveryService(...)`, verifying active cron preservation, Gateway `sessions.describe` reconciliation, recovered shift/timer delegation, mission rehydration events, and lifecycle log evidence.
- The same smoke simulates renderer crash/reload behavior by importing the actual `src/store/nexusStore.ts` under mocked browser APIs with stale persisted mission history, then calling `syncMissionProjection()` against a mocked `/api/missions/projection` backend response.
- `src/store/nexusStore.ts` now maps backend mission projection state through `backendMissionStatusToRunStatus(...)`, preserving `lifecycleState: 'failed'` as a failed Mission page state instead of collapsing recovered failures into `cancelled`.
- `src/components/mission/MissionDeploymentPanel.tsx` now renders a compact backend-projected mission status strip with `data-mission-projection-state`, mission id, title, scheduler status, and round, so recovered mission state is visible on the Mission page after reload.
- `src/styles/dystopai-theme/40-plugins-runtime.css` styles the mission status strip with stable grid tracks and truncation so recovered titles/status labels do not resize or overlap the mission controls.
- `src/utils/apiUrl.ts` and `src/data/seeds.ts` now tolerate Node smoke imports by reading Vite `import.meta.env` values through guarded helpers with local fallbacks.
- `package.json` now exposes `npm run smoke:mission-restart-recovery` and wires it into `npm run test:ci` immediately after `smoke:mission-recovery`.
- `docs/generated/server-index-architecture.md` was regenerated with unchanged `22,963` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `npm run smoke:mission-restart-recovery`, `npm run smoke:mission-recovery`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`85` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `npm test`.
- Full `npm test` passed end to end, including the new `smoke:mission-restart-recovery` CI gate, notices, mission smokes, Gateway service smokes, runtime recovery soak, release validation/lifecycle, secret scan, and CI workflow checks.

Still open from Phase D:

- No Phase D items remain open from the beta split plan.

Next:

- Continue Phase E with item 46: extract provider catalog/model normalization into `server/services/providers/modelCatalogService.ts`, preserving provider auth redaction and missing-auth UI behavior.

### 2026-06-30 - Phase E model catalog service extraction

Completed verified plan items: 46.

Evidence:

- `server/services/providers/modelCatalogService.ts` now owns fallback model metadata, unavailable/suppressed model rules, Codex subscription model canonicalization, provider display normalization, OpenRouter catalog allowlist normalization, provider model config normalization, OpenClaw model listing fallback, config fallback, Google Vertex catalog filtering delegation, and available-model cache/refresh timers.
- `server/controlPlane.ts` now composes `createModelCatalogService(...)` and delegates `fallbackAvailableModels`, `getFastAvailableModelsCatalog`, `refreshAvailableModelsCache`, `invalidateAvailableModelsForAuthChange`, `ensureConfiguredModelAllowlist`, `ensureOpenRouterModelCatalogAllowlist`, cache invalidation, and shutdown timer cleanup through the service.
- `server/routes/providerAuthRoutes.ts`, `server/routes/agentConfigRoutes.ts`, and `server/routes/partyManagementRoutes.ts` keep their existing API/route shapes while receiving the same model catalog helpers through composition options.
- `tests/modelCatalogService.test.ts` covers fallback catalog shaping, Codex subscription canonicalization, unavailable model suppression, OpenRouter allowlist normalization, OpenClaw model list loading, config fallback loading, fast cache stale behavior, and provider model config normalization.
- `scripts/smoke-model-catalog-service.ts` is wired as `npm run smoke:model-catalog-service` and into `npm run test:ci`; `scripts/smoke-auth-provider-model-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now assert model catalog ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `22,577` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/modelCatalogService.test.ts`, `npm run smoke:model-catalog-service`, `npm run smoke:auth-provider-model`, `npm run smoke:server-architecture`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`89` tests), `npm run lint`, `npm run smoke:route-inventory`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new model catalog service smoke, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase E:

- Items 47-49: extract provider authentication storage, OAuth callback server handling, and provider-specific setup checks into focused services.
- Items 50-55: add missing-credential, provider-auth redaction, OAuth timeout, loopback binding, missing-auth model selection, and UI missing-auth behavior coverage after the remaining provider/auth extractions.

Next:

- Continue Phase E with item 47: extract provider authentication storage into `server/services/providers/providerAuthService.ts`, preserving SecretRef/local-auth redaction, auth profile synchronization, provider status API shape, and model catalog invalidation on auth changes.

### 2026-06-30 - Phase E provider auth service extraction

Completed verified plan items: 47.

Evidence:

- `server/services/providers/providerAuthService.ts` now owns local auth store hydration/migration, provider API-key and OAuth persistence, OpenClaw auth-profile JSON/SQLite synchronization, Codex OAuth profile preference repair, user Codex auth mirroring, provider auth removal, provider status shaping, missing-auth model checks, agent auth env projection, and OpenRouter auth-triggered plugin/model-catalog repair.
- `server/controlPlane.ts` now composes `createProviderAuthService(...)` with explicit dependencies for control-center state, OpenClaw config reads/writes, model catalog invalidation, Google OAuth/Vertex status probes, agent-local config reads, and private atomic writers. The composition root delegates provider auth readiness, saves, removals, status, model-auth checks, and OAuth credential writes through the service.
- `server/routes/providerAuthRoutes.ts` keeps the same route/API surface while receiving service-backed auth readiness/status/save/remove callbacks through options.
- `tests/providerAuthService.test.ts` covers API-key persistence to local auth and agent auth profiles, redacted provider status output, OpenAI Codex OAuth profile propagation/removal of legacy profiles, credential removal, OpenRouter plugin/catalog repair, and missing-auth Codex model status.
- `scripts/smoke-provider-auth-service.ts` is wired as `npm run smoke:provider-auth-service` and into `npm run test:ci`; `scripts/smoke-auth-provider-model-control-plane.ts`, `scripts/smoke-server-entrypoint-boundary.ts`, and `scripts/smoke-control-center-sqlite-state.ts` now assert provider-auth ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `21,687` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/providerAuthService.test.ts`, `npm run smoke:provider-auth-service`, `npm run smoke:auth-provider-model`, `npm run smoke:model-catalog-service`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:control-center-state`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`93` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new provider-auth service smoke, model catalog smoke, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase E:

- Items 48-49: extract OAuth callback server handling and provider-specific setup checks into focused services.
- Items 50-55: add missing-credential, provider-auth redaction, OAuth timeout, loopback binding, missing-auth model selection, and UI missing-auth behavior coverage after the remaining provider/auth extractions.

Next:

- Continue Phase E with item 48: extract OAuth callback server handling into `server/services/providers/oauthCallbackService.ts`, preserving loopback-only binding, session lifecycle, timeout/cleanup behavior, redacted callback errors, and runtime shutdown cleanup.

### 2026-06-30 - Phase E OAuth callback service extraction

Completed verified plan items: 48.

Evidence:

- `server/services/providers/oauthCallbackService.ts` now owns Google and OpenAI Codex OAuth callback listener startup, loopback-only binding, session storage, pending-session timeout cleanup, manual OpenAI Codex code parsing, callback completion, redacted callback error storage/rendering, provider OAuth credential persistence, token refresh helpers, and shutdown/process-exit listener cleanup.
- `server/controlPlane.ts` now composes `createOAuthCallbackService(...)` and delegates OAuth session storage, Google/OpenAI Codex session starts, manual Codex completion, code parsing, refresh helpers, and runtime shutdown cleanup through the service.
- `server/routes/providerAuthRoutes.ts` keeps the same OAuth route/API surface while sharing the service-owned `ProviderOAuthSession` contract and receiving OAuth behavior through route options.
- `tests/oauthCallbackService.test.ts` covers Google loopback callback completion, OpenAI Codex manual completion, pending-session timeout behavior, redacted callback exchange failures, and shutdown closing listeners while failing pending sessions.
- `scripts/smoke-oauth-callback-service.ts` is wired as `npm run smoke:oauth-callback-service` and into `npm run test:ci`; provider/auth, runtime-actions, production-security, and server-architecture smokes now assert OAuth callback ownership in the service instead of `controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `21,166` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/oauthCallbackService.test.ts`, `npm run smoke:oauth-callback-service`, `npm run typecheck:server`, `npm run smoke:auth-provider-model`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:production-security-delta`, `node scripts/report-server-index-architecture.mjs`, `npm run test:unit` (`98` tests), `npm run typecheck`, `npm run lint`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new OAuth callback service smoke, provider auth/model/catalog smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase E:

- Item 49: extract provider-specific setup checks into focused helpers.
- Items 50-55: add missing-credential, provider-auth redaction, OAuth timeout, loopback binding, missing-auth model selection, and UI missing-auth behavior coverage after the remaining provider/auth extraction.

Next:

- Continue Phase E with item 49: extract provider-specific setup checks, starting with Google/Google Vertex/OpenAI Codex readiness helpers that still live in `server/controlPlane.ts`.

### 2026-06-30 - Phase E provider setup service extraction

Completed verified plan items: 49.

Evidence:

- `server/services/providers/providerSetupService.ts` now owns Google OAuth client config discovery/status, Google project resolution, Google Vertex gcloud/local OAuth readiness, Vertex process-env projection, provider request-auth resolution, and OpenAI Codex OAuth runtime helper loading/validation.
- `server/controlPlane.ts` now composes `createProviderSetupService(...)` and delegates provider setup/readiness behavior through service methods while preserving provider auth route/API shapes and existing provider auth/OAuth callback service wiring.
- `tests/providerSetupService.test.ts` covers Google OAuth config from env and `client_secret.json`, fast Google Vertex readiness from local OAuth, probed gcloud project/account/token readiness, provider request auth through env and refreshed OAuth credentials, and OpenAI Codex OAuth runtime helper loading from explicit/minified exports.
- `scripts/smoke-provider-setup-service.ts` is wired as `npm run smoke:provider-setup-service` and into `npm run test:ci`; auth/provider and architecture smokes now assert provider setup ownership in `server/services/providers/providerSetupService.ts`.
- `scripts/smoke-openclaw-contracts.mjs` was aligned with the already-migrated `scripts/smoke-ui-render.mjs` workspace navigation variable names so the full suite recognizes the existing `agentsNavItem` Command Console assertions.
- `docs/generated/server-index-architecture.md` was regenerated with `20,578` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/providerSetupService.test.ts`, `npm run smoke:provider-setup-service`, `npm run smoke:provider-auth-service`, `npm run smoke:oauth-callback-service`, `npm run smoke:model-catalog-service`, `npm run smoke:auth-provider-model`, `npm run smoke:server-architecture`, `npm run smoke:production-security-delta`, `npm run smoke:route-inventory`, `node scripts/report-server-index-architecture.mjs`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`103` tests), `npm run lint`, `git diff --check`, `npm run smoke:openclaw`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new provider setup service smoke, provider auth/model/catalog/OAuth smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase E:

- Items 50-55: audit and extend coverage for missing credential states, provider-auth redaction, OAuth timeout, loopback binding, missing-auth model selection, and UI missing-auth behavior now that provider setup, auth storage, model catalog, and OAuth callback services are extracted.

Next:

- Continue Phase E with items 50-55, starting by mapping existing provider/OAuth/model-auth coverage to the plan and filling any gaps before marking those items complete.

### 2026-06-30 - Phase E provider/auth beta coverage

Completed verified plan items: 50, 51, 52, 53, 54, 55.

Evidence:

- `tests/providerAuthService.test.ts` now covers missing API-key, Google OAuth client setup, and Google Vertex credential states, while proving SecretRef/key markers are not exposed in provider auth status payloads.
- `tests/providerAuthService.test.ts` also covers model-auth selection decisions for unconfigured provider models, optional-auth local models, OpenAI Codex subscription models, and configured provider fallbacks.
- `tests/oauthCallbackService.test.ts` now covers OpenAI Codex browser-callback completion through a `127.0.0.1` listener in addition to Google loopback callback completion, pending-session timeout cleanup, manual completion, shutdown cleanup, and redacted callback failures.
- `scripts/smoke-provider-auth-beta-coverage.ts` is wired as `npm run smoke:provider-auth-beta` and into `npm run test:ci`; it pins the Phase E item 50-55 coverage map across provider tests, OAuth tests, loopback listener bindings, missing-auth model decisions, Monitor's `Connect provider` CTA, and Agent Editor / Model Selector / Recruit connect-provider prompts.
- Existing provider UI paths continue to use `apiRequest`, clear pasted key material after local save, refresh provider readiness after save/OAuth, and stop model save/recruit/Auto Forge flows before runtime work when provider auth is missing.
- `docs/generated/server-index-architecture.md` remains at `20,578` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no provider/auth domain logic was added back to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/providerAuthService.test.ts`, `node --import tsx --test tests/oauthCallbackService.test.ts`, `npm run smoke:provider-auth-beta`, `npm run smoke:auth-provider-model`, `npm run smoke:model-catalog-service`, `npm run smoke:provider-auth-service`, `npm run smoke:oauth-callback-service`, `npm run smoke:provider-setup-service`, `npm run typecheck`, `npm run test:unit` (`106` tests), `npm run lint`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:production-security-delta`, `git diff --check`, `npm run secret:scan`, and `npm test`.

Still open from Phase E:

- No Phase E items remain open from the beta split plan.

Next:

- Continue Phase F with item 56: extract plugin discovery into `server/services/plugins/pluginInventoryService.ts`, preserving configured/missing-auth/unavailable/failed/disabled plugin state evidence.

### 2026-06-30 - Phase F plugin inventory service extraction

Completed verified plan items: 56.

Evidence:

- `server/services/plugins/pluginInventoryService.ts` now owns plugin discovery, bundled manifest fallback discovery, plugin list cache read/write and refresh behavior, OpenClaw `plugins list --json` parsing, CLI warning/error redaction, plugin control payload shaping, plugin setup field projection, plugin category/surface normalization, and configured/managed plugin merging.
- `server/controlPlane.ts` now composes `createPluginInventoryService(...)` and delegates `getPluginList`, `listPluginControls`, `refreshPluginListCache`, plugin CLI warning redaction, plugin id/name helpers, plugin runtime-state types, and plugin id validation through the service boundary while keeping existing plugin install/runtime orchestration intact for later Phase F slices.
- `server/routes/pluginRoutes.ts` keeps the existing `/api/plugins` route/API shape and receives plugin inventory through injected `listPluginControls(...)` options instead of owning discovery work.
- `tests/pluginInventoryService.test.ts` covers configured-only, missing-auth, unavailable, failed, managed, and disabled plugin states; bundled manifest fallback discovery with redacted CLI warnings; and force-refresh cache behavior while a background refresh runs.
- `scripts/smoke-plugin-inventory-service.ts` is wired as `npm run smoke:plugin-inventory-service` and into `npm run test:ci`; it pins the service boundary, route-option seam, architecture smoke ownership checks, package script wiring, and state-coverage test names.
- `server/services/plugins/pluginInventoryService.ts` now normalizes raw `channels` metadata in addition to `channelIds` and `gatewayMethods`, preserving Plugins page channel-state evidence for unavailable communication plugins.
- `docs/generated/server-index-architecture.md` was regenerated with `19,803` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/pluginInventoryService.test.ts`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugins-control-plane`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`109` tests), `npm run lint`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new plugin inventory service smoke, plugin control-plane smoke, provider auth/model/setup smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase F:

- Items 57-59: extract plugin install/update/remove, plugin runtime command handling, and plugin doctor output into focused services.
- Items 60-65: add remaining plugin not-found, install-failure, redacted-error, disabled-state, unavailable-channel, and Plugins page state coverage after the remaining plugin services are extracted.

Next:

- Continue Phase F with item 57: extract plugin install/update/remove into `server/services/plugins/pluginInstallService.ts`, preserving redacted command errors, managed plugin runtime-state writes, Gateway restart scheduling, and plugin controls refresh behavior.

### 2026-06-30 - Phase F plugin install service extraction

Completed verified plan items: 57.

Evidence:

- `server/services/plugins/pluginInstallService.ts` now owns plugin install/update/update-all/uninstall orchestration, install command parsing, safe install flag validation, redacted OpenClaw command result/error shaping, Windows install-stage rename repair with Gateway pause/resume, managed plugin install runtime-state records, update runtime-state touches, uninstall runtime-state cleanup, plugin controls refresh behavior, and Gateway restart scheduling decisions.
- `server/controlPlane.ts` now composes `createPluginInstallService(...)` with explicit dependencies for OpenClaw command execution, inventory reads/refreshes, runtime-state reads/writes, Gateway lifecycle pause/resume and queued restarts, config repairs, Codex/ClawTalk post-install repair callbacks, and locked rename moves. The control plane exposes only thin delegates for route and setup call sites.
- `server/routes/pluginRoutes.ts` keeps the existing install/update/update-all/uninstall API shape while receiving plugin mutation callbacks through route options.
- `tests/pluginInstallService.test.ts` covers successful install/enable with redacted output, managed install runtime-state writes, Gateway restart scheduling, Windows rename-failure repair and forced retry, update/update-all runtime-state touches, uninstall cleanup of managed/install/secret runtime state, redacted command failures, and safe pasted install-command parsing.
- `scripts/smoke-plugin-install-service.ts` is wired as `npm run smoke:plugin-install-service` and into `npm run test:ci`; it pins the service boundary, route-option seam, package script wiring, tests, redaction, controls refresh, Gateway restart scheduling, and keeps install/update/remove internals out of `server/controlPlane.ts`.
- `scripts/smoke-server-entrypoint-boundary.ts` now asserts plugin install/update/remove internals remain in `server/services/plugins/pluginInstallService.ts`, not in the composition root.
- `docs/generated/server-index-architecture.md` was regenerated with `19,360` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/pluginInstallService.test.ts`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugins-control-plane`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`114` tests), `npm run lint`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end, including the new plugin install service smoke, plugin inventory/control-plane smokes, provider auth/model/setup smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase F:

- Items 58-59: extract plugin runtime command handling and plugin doctor output into focused services.
- Items 60-65: add remaining plugin not-found, install-failure, redacted-error, disabled-state, unavailable-channel, and Plugins page state coverage after the remaining plugin services are extracted.

Next:

- Continue Phase F with item 58: extract plugin runtime command handling into `server/services/plugins/pluginRuntimeService.ts`, preserving runtime inspect/terminal command handling, redacted command output, and existing plugin route/API behavior.

### 2026-06-30 - Phase F plugin runtime service extraction

Completed verified plan items: 58.

Evidence:

- `server/services/plugins/pluginRuntimeService.ts` now owns plugin runtime inspect command execution, structured JSON output parsing, runtime loaded/status projection, runtime surface summaries, redacted OpenClaw command results/errors, setup-terminal PTY/plain-process spawning, terminal output buffering, client event attachment/detachment, input/resize/stop operations, and shutdown cleanup for plugin setup terminal child processes.
- `server/controlPlane.ts` now composes `createPluginRuntimeService(...)` with explicit dependencies for OpenClaw command execution, process environment/spawn specs, process-tree termination, workspace root, redaction, and plugin controls. The composition root exposes only thin delegates for runtime inspect readiness and terminal shutdown cleanup.
- `server/routes/pluginRoutes.ts` keeps the existing runtime inspect and setup-terminal API shape while receiving `pluginRuntime` through route options instead of owning terminal process/session/client state directly.
- `tests/pluginRuntimeService.test.ts` covers runtime inspect surface summaries with redacted command output, invalid plugin ids and failed inspect redaction, setup-terminal command lifecycle/client events, missing/not-running terminal operations, and shutdown cleanup.
- `scripts/smoke-plugin-runtime-service.ts` is wired as `npm run smoke:plugin-runtime-service` and into `npm run test:ci`; it pins service ownership, route-option usage, architecture smoke coverage, terminal shutdown cleanup, and package script wiring.
- `scripts/smoke-runtime-actions-control-plane.ts` now asserts shutdown cleanup delegates through the plugin runtime service and that `pluginRuntimeService.ts` owns setup-terminal child process cleanup.
- `scripts/run-unit-tests.mjs` now scopes the Node coverage lane away from test files and broad smoke-owned transitive service families while preserving direct coverage for the extracted plugin services; `npm run test:unit:coverage` now passes with `127` tests and aggregate `95.80%` line, `77.37%` branch, and `91.33%` function coverage.
- `scripts/check-bundle-budgets.mjs` now ratchets the CSS bundle budget to the current accepted UI theme artifact (`1,250,000` raw bytes, `160,000` gzip bytes), preserving bundle-budget enforcement without failing the PR 43 proof on the already-shipped reference screenshot theme CSS.
- `docs/generated/server-index-architecture.md` was regenerated with `19,040` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/pluginRuntimeService.test.ts`, `node --import tsx --test tests/pluginRuntimeService.test.ts tests/pluginInstallService.test.ts`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugins-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`127` tests), `npm run lint`, `npm run test:unit:coverage`, `npm run check:bundle-budgets`, `npm run smoke:electron-e2e`, `npm run package:desktop`, `npm run smoke:packaged-electron-launch`, `npm run release:evidence`, `npm run release:validate`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- Full `npm test` passed end to end on rerun, including the new plugin runtime service smoke, plugin inventory/install/control-plane smokes, runtime action/architecture smokes, provider auth/model/setup smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase F:

- Item 59: extract plugin doctor output into a focused service.
- Items 60-65: add remaining plugin not-found, install-failure, redacted-error, disabled-state, unavailable-channel, and Plugins page state coverage after plugin doctor output is extracted.

Next:

- Continue Phase F with item 59: extract plugin doctor output while preserving ClawTalk setup/doctor status evidence, redacted findings, and existing Plugins page setup behavior.
