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

### 2026-06-30 - Phase F plugin diagnostics service extraction

Completed verified plan items: 59.

Evidence:

- `server/services/plugins/pluginDiagnosticsService.ts` now owns ClawTalk setup input normalization, doctor output parsing, redacted command summaries, doctor/runtime inspect polling, optional install fallback, manifest repair registry refresh, Gateway restart handling, and final plugin controls refresh.
- `server/controlPlane.ts` now composes `createPluginDiagnosticsService(...)` with explicit dependencies for plugin inventory/install/runtime services, ClawTalk config persistence, OpenClaw command execution, Gateway restart, redaction, and manifest repair. The control plane exposes only the thin `setupClawTalkPlugin` delegate for plugin routes.
- `server/routes/pluginRoutes.ts` keeps the existing `/api/plugins/clawtalk/setup` route/API shape and continues to receive ClawTalk setup behavior through route options.
- `tests/pluginDiagnosticsService.test.ts` covers installed ClawTalk setup with redacted doctor output, missing ClawTalk install fallback, invalid API-key/server install-approval rejection, manifest repair registry refresh, restart handling, and runtime/doctor verification failure reporting.
- `scripts/smoke-plugin-diagnostics-service.ts` is wired as `npm run smoke:plugin-diagnostics-service` and into `npm run test:ci`; `scripts/smoke-server-entrypoint-boundary.ts` now asserts ClawTalk doctor/setup internals stay in the plugin diagnostics service, not in `server/controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after the extraction.
- Verification passed: `node --import tsx --test tests/pluginDiagnosticsService.test.ts`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`131` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, and `git diff --check`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Risks and notes:

- `npm run smoke:plugins-control-plane` currently fails before this slice's service smokes with `PluginsPanel is missing API-client endpoint /api/openclaw/command` at `scripts/smoke-plugins-control-plane.ts:92:3`. `src/components/plugins/PluginsPanel.tsx` was already modified before this run; this broad-suite blocker is recorded for the next UI/plugin coverage pass and was not caused by the diagnostics service extraction.

Still open from Phase F:

- Items 60-65: add remaining plugin not-found, install-failure, redacted-error, disabled-state, unavailable-channel, and Plugins page state coverage now that plugin inventory, install, diagnostics, and runtime services are extracted.

Next:

- Continue Phase F with item 60: add tests for plugin not found, while preserving the existing PluginsPanel smoke blocker evidence if that pre-existing UI edit is still present.

### 2026-06-30 - Phase F plugin not-found coverage

Completed verified plan items: 60.

Evidence:

- `server/routes/pluginRoutes.ts` now verifies valid dynamic plugin ids against `listPluginControls()` before plugin update, uninstall, runtime inspect, direct config save, enable/disable toggle, or plugin-specific setup-terminal startup. Missing plugins now return canonical `404` `plugin_not_found` envelopes before any OpenClaw command, config write, runtime inspect, terminal spawn, or toggle mutation runs.
- `tests/pluginRoutes.test.ts` covers missing-plugin update, uninstall, inspect, config, toggle, and setup-terminal requests, proves secret-like request bodies are not echoed in the not-found envelope, and confirms known plugins still pass the guard and execute mutations.
- `src/components/plugins/PluginsPanel.tsx` restored the shared `apiRequest`/`pluginApiData` caller for `/api/openclaw/command`, resolving the previously recorded `smoke:plugins-control-plane` blocker without reintroducing raw `fetch` or manual JSON body handling.
- `src/dystopai-app-theme.css` now imports the pre-existing local `99-mission-quiet-redesign.css` before `95-typography-polish.css`, preserving that local stylesheet while keeping the enforced typography-polish-last UI contract.
- `docs/generated/server-index-architecture.md` remains at `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes after this coverage slice; no plugin domain logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:plugins-control-plane`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:shell-production-ui`, `npm run smoke:ui-font-sizes`, `npm run typecheck`, `npm run test:unit` (`133` tests), `npm run lint`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `git diff --check`, and `npm test`.
- The first `npm test` attempt failed at `smoke:shell-production-ui` because an untracked local mission stylesheet was imported after `95-typography-polish.css`; after moving that import before typography polish, `npm run smoke:shell-production-ui`, `npm run smoke:ui-font-sizes`, and full `npm test` passed end to end.

Still open from Phase F:

- Items 61-65: add plugin install-failure, redacted-error, disabled-state, unavailable-channel, and Plugins page state coverage.

Next:

- Continue Phase F with item 61: add tests for plugin install failure, building on the plugin install service and route coverage now in place.

### 2026-06-30 - Phase F plugin install-failure coverage

Completed verified plan items: 61.

Evidence:

- `tests/pluginRoutes.test.ts` now covers `/api/plugins/install` command failure through the extracted plugin route boundary, proving numeric OpenClaw/plugin command errors return canonical `502` `plugin_command_failed` envelopes.
- The install-failure route test verifies raw secret material from a failed install command is redacted by the route/API envelope path and that the submitted install spec is not echoed in the error response.
- The plugin route harness now mirrors production plugin error status mapping and redaction dependencies instead of using an unconditional status stub.
- `scripts/smoke-plugin-install-service.ts` now pins both service-level install/activation failure redaction coverage and route-level install-failure envelope coverage.
- `src/dystopai-app-theme.css` again imports the pre-existing local `99-mission-quiet-redesign.css` before `95-typography-polish.css`, preserving that stylesheet while satisfying the typography-polish-last shell contract required by the full suite.
- `docs/generated/server-index-architecture.md` remains at `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no plugin install error logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:plugins-control-plane`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit`, `npm run lint`, `npm run smoke:shell-production-ui`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- The first `npm test` attempt failed at `smoke:shell-production-ui` because the local mission stylesheet was after `95-typography-polish.css`; after moving that import before typography polish, `npm run smoke:shell-production-ui` and full `npm test` passed.

Still open from Phase F:

- Items 62-65: add remaining redacted plugin errors, disabled-state, unavailable-channel, and Plugins page state coverage.

Next:

- Continue Phase F with item 62: add tests for redacted plugin errors across the remaining plugin command/API surfaces.

### 2026-06-30 - Phase F plugin redacted-error coverage

Completed verified plan items: 62.

Evidence:

- `tests/pluginRoutes.test.ts` now covers redacted plugin errors across the remaining plugin API surfaces after the install-failure route proof: plugin list, search, update-all, Gateway restart, ClawTalk setup, plugin update, uninstall, runtime inspect, direct config save, setup-terminal start, and enable/disable toggle failures.
- The plugin route harness now simulates per-surface dependency failures and redacts `apiKey=...`, token fields, `sk-...` keys, and ClawTalk `cc_test_...` keys before API envelope details are asserted.
- The route redaction sweep proves failed responses do not echo raw thrown secrets or request-body plugin secrets while still preserving canonical `plugin_command_failed`, `plugin_operation_failed`, and `plugin_terminal_failed` envelopes with the expected HTTP status.
- `scripts/smoke-plugins-control-plane.ts` now pins the redacted-error coverage test, covered endpoint set, and secret-marker assertions so route coverage cannot be removed silently while the Plugins page/API smoke remains in CI.
- `docs/generated/server-index-architecture.md` remains at `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no plugin error logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:plugin-inventory-service`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`135` tests), `npm run lint`, `git diff --check`, and `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- Full `npm test` passed end to end, including plugin route/service smokes, OpenClaw command smoke, all mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Still open from Phase F:

- Items 63-65: add disabled plugin state, channel plugin unavailable state, and Plugins page state coverage.

Next:

- Continue Phase F with item 63: add tests for disabled plugin state, preserving the extracted plugin inventory/install/runtime/diagnostics route behavior and existing Plugins page status distinctions.

### 2026-06-30 - Phase F plugin disabled-state coverage

Completed verified plan items: 63.

Evidence:

- `tests/pluginRoutes.test.ts` now covers disabled plugin state through the extracted route boundary. The route harness can model a known disabled plugin from `listPluginControls()`, verifies `/api/plugins` preserves `enabled: false`, `status: "disabled"`, and disabled-state guidance, and proves `/api/plugins/:pluginId` can enable that known disabled plugin without treating it as missing or invoking runtime inspect.
- `scripts/smoke-plugins-control-plane.ts` now pins the disabled-state route test, disabled plugin fixture, toggle endpoint, and existing Plugins page disabled filter/count/start-state affordances.
- `docs/generated/server-index-architecture.md` remains at `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no plugin disabled-state logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`136` tests), `npm run lint`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end, including the new disabled-state route coverage in `npm run test:unit`, plugin control-plane/service smokes, OpenClaw command smoke, all mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Still open from Phase F:

- Items 64-65: add channel plugin unavailable state and Plugins page state coverage.

Next:

- Continue Phase F with item 64: add tests for channel plugin unavailable state, preserving raw channel metadata projection and route/UI status distinctions.

### 2026-06-30 - Phase F plugin channel-unavailable coverage

Completed verified plan items: 64.

Evidence:

- `tests/pluginRoutes.test.ts` now covers an unavailable communications plugin with channel metadata through the extracted plugin route boundary. `/api/plugins` preserves `enabled: true`, `configuredEnabled: true`, `status: "unavailable"`, `category: "communications"`, channel ids, restart-required state, and operator guidance.
- The unavailable-channel route test also proves `/api/plugins/:pluginId/inspect` treats the unavailable channel plugin as a known plugin, not as missing, and returns the same unavailable status/channel metadata with the runtime inspect payload.
- `src/components/plugins/PluginsPanel.tsx` now uses a dedicated plugin status label before rendering row badges, so special backend statuses such as `unavailable`, `failed`, `configured`, and `managed` are not masked as generic `enabled` when the plugin is enabled.
- `scripts/smoke-plugins-control-plane.ts` now pins the unavailable-channel route fixture and the Plugins page status-label contract alongside the existing disabled, redacted-error, install-failure, and not-found coverage.
- `docs/generated/server-index-architecture.md` remains at `18,882` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no plugin unavailable-state logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:plugin-inventory-service`, `npm run smoke:plugin-install-service`, `npm run smoke:plugin-runtime-service`, `npm run smoke:plugin-diagnostics-service`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`137` tests), `npm run lint`, `npm run smoke:shell-production-ui`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end, including the new unavailable-channel route coverage in `npm run test:unit`, plugin control-plane/service smokes, OpenClaw command smoke, all mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.

### 2026-06-30 - Phase F Plugins page state distinction coverage

Completed verified plan items: 65.

Evidence:

- `src/components/plugins/pluginStateProjection.ts` now owns the Plugins page state classifier, state filters, row-badge tones, and summary counts for `configured`, `missing-auth`, `unavailable`, `failed`, and `disabled` plugin states.
- `src/components/plugins/PluginsPanel.tsx` now uses that classifier for row badges, search text, state filters, and summary chips so failed or unavailable plugins are not masked as generic enabled/setup states.
- `tests/pluginsPanelStateProjection.test.ts` proves the Plugins page classifier distinguishes configured, missing-auth, unavailable, failed, and disabled fixtures, with expected labels, tones, filter matches, and state summary counts.
- `scripts/smoke-plugins-control-plane.ts` now pins the state-projection helper, state filters, summary chips, and page-state test so the Plugins page contract cannot silently drop the beta state distinctions.
- Verification passed: `node --import tsx --test tests/pluginsPanelStateProjection.test.ts`, `node --import tsx --test tests/pluginRoutes.test.ts`, `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts tests/pluginsPanelStateProjection.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run smoke:shell-production-ui`, `npm run smoke:ui-font-sizes`, `npm run typecheck`, `npm run test:unit`, `npm run lint`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end after this slice and the subsequent Phase G cleanup, with `147` unit tests and all plugin, command-console, filesystem, Gateway, runtime, mission, provider, release, security, and CI smokes passing.

Phase F status:

- Items 56-65 are complete and verified.

Next:

- Continue Phase G with item 66 if not already complete in the current worktree, otherwise continue item 68.

### 2026-06-30 - Phase G safe path service extraction

Completed verified plan items: 66.

Evidence:

- `server/services/filesystem/safePathService.ts` now owns safe path equality and containment helpers through `createSafePathService()`, `samePath`, `isPathUnder`, `isInsidePath`, and `assertPathUnder`.
- `server/controlPlane.ts` now composes `createSafePathService()` and delegates the existing static UI, command-console upload, Team Sync append, cleanup, and direct artifact-write path checks through the service-owned helpers instead of local helper functions.
- `tests/safePathService.test.ts` covers exact paths, descendants, traversal attempts, sibling-prefix escapes, root containment, Windows case-insensitive comparison, and assertion failures.
- `scripts/smoke-server-entrypoint-boundary.ts` now pins the safe-path service boundary and prevents `isPathUnder`, `isInsidePath`, or `samePath` helper definitions from returning to `server/controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `18,733` control-plane composition lines, `9` entrypoint lines, and `0` inline routes in the current Phase G working tree.
- Verification passed: `node --import tsx --test tests/safePathService.test.ts`, `npm run typecheck:server`, `npm run smoke:command-console-files`, `npm run smoke:filesystem-control-plane`, `npm run smoke:team-sync-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck`, `npm run test:unit` (`143` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end, including the new safe-path unit coverage, command-console/filesystem/team-sync smokes, all plugin/Gateway/runtime/mission/provider smokes, secret scan, release validation/lifecycle, and CI workflow checks.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase F status:

- Items 56-65 are complete and verified.

Still open from Phase G:

- Items 67-75: extract command-console upload handling, finish control-file/picker service boundaries, and add traversal, symlink, type allowlist, size-limit, avatar-limit, and upload-root escape coverage.

Next:

- Continue Phase G with item 67: extract command-console upload handling into `server/services/filesystem/commandConsoleUploadService.ts`, preserving upload type allowlist, size limits, safe root containment, and existing `/api/files/upload` behavior.

### 2026-06-30 - Phase G command-console upload service extraction

Completed verified plan items: 67.

Evidence:

- `server/services/filesystem/commandConsoleUploadService.ts` now owns command-console upload file naming, MIME fallback, type allowlist, size-limit enforcement, upload-root containment, attachment metadata normalization, and Gateway inline attachment conversion.
- `server/controlPlane.ts` now composes `createCommandConsoleUploadService(...)` with the service-owned safe path containment helper and keeps only thin delegates for `persistCommandConsoleUpload` and `gatewayChatAttachmentsFromTurnAttachments`.
- `tests/commandConsoleUploadService.test.ts` covers sanitized supported upload persistence, unsupported file rejection, size-limit rejection, sibling-root escape rejection, attachment metadata normalization, Gateway payload creation, and oversized inline attachment skipping.
- `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now pin the command-console upload service boundary and prevent file naming or attachment normalization from returning to `server/controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `18,733` control-plane composition lines, `9` entrypoint lines, and `0` inline routes in the current Phase G working tree.
- Verification passed: `node --import tsx --test tests/commandConsoleUploadService.test.ts`, `node --import tsx --test tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts`, `npm run smoke:command-console-files`, `npm run typecheck:server`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`147` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end after the upload service extraction, including command-console/filesystem smokes, plugin state coverage, all Gateway/runtime/mission/provider smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Phase F status:

- Items 56-65 are complete and verified.

Still open from Phase G:

- Items 68-75: finish control-file/picker service boundaries and add traversal, symlink, type allowlist, size-limit, avatar-limit, and upload-root escape coverage.

Next:

- Continue Phase G with item 68: verify or finish control file read/write helper extraction into `server/services/controlFilesService.ts`, then continue path traversal and upload-root escape coverage in items 70 and 75.

### 2026-06-30 - OpenClaw 2026.6.11 runtime and catalog upgrade

Evidence:

- Vendored OpenClaw was refreshed to `openclaw@2026.6.11`, and the bundled Codex runtime was refreshed to exact `@openclaw/codex@2026.6.11`.
- Plugin inventory fallback now preserves OpenClaw 2026.6.11's official external plugin/provider/channel catalogs instead of assuming every official plugin is still bundled under `dist/extensions`.
- Plugin controls and runtime status now carry icon, channel system image, package name, and install spec metadata; the Plugins page renders plugin icons and searches package/install metadata.
- The local OpenClaw docs mirror was re-synced from `https://docs.openclaw.ai` and now contains `2,051` pages.
- Verification passed: `npm run prepare:openclaw-vendor`, `npm run prepare:runtime-bundles`, `npm run docs:openclaw:sync`, `node --import tsx --test tests/pluginInventoryService.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:plugin-inventory-service`, `npm run smoke:openclaw`, `npm run smoke:runtime-reproducibility`, `npm run typecheck`, `npm run test:unit`, `npm run lint`, `npm run smoke:release-evidence`, `npm run smoke:release-validation`, `npm run smoke:misc-control-plane`, `npm run notices:check`, `npm run build:standalone`, `git diff --check`, and full `npm test`.

### 2026-06-30 - Phase G control-file service boundary hardening

Completed verified plan items: 68.

Evidence:

- `server/services/controlFilesService.ts` now owns command-console control-file read/write path resolution, validates the `CONTROL_FILES` allowlist inside the service boundary, and verifies resolved workspace containment before every read or write.
- `server/controlPlane.ts` composes `createControlFilesService(WORKSPACE_ROOT, { isPathUnder })` so the service uses the shared safe-path containment implementation while the composition root stays as wiring.
- `tests/controlFilesService.test.ts` covers allowed control-file read/write behavior, traversal and non-control-file rejection, and containment failures before disk access.
- `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now pin the control-file service boundary, containment check, focused tests, and composition wiring.
- `docs/generated/server-index-architecture.md` was regenerated and still reports `18,733/29,000` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/controlFilesService.test.ts`, `node --import tsx --test tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts`, `npm run smoke:command-console-files`, `npm run smoke:filesystem-control-plane`, `npm run smoke:server-architecture`, `npm run smoke:route-inventory`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`150` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `150` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Phase G status:

- Items 66, 67, and 68 are complete and verified.

Still open from Phase G:

- Items 69-75: extract picker session handling and finish traversal, symlink, type allowlist, size-limit, avatar-limit, and upload-root escape coverage.

Next:

- Continue Phase G with item 69: extract Windows folder/image picker sessions into `pickerSessionService.ts`.

### 2026-06-30 - Phase G picker session service extraction

Completed verified plan items: 69.

Evidence:

- `server/services/filesystem/pickerSessionService.ts` now owns folder/image picker session maps, TTL pruning, session serialization, picker start-path normalization, native picker command execution, Electron dialog fallback, Windows PowerShell launcher generation, Windows result polling, and image-picker avatar persistence through an injected dependency.
- `server/controlPlane.ts` now composes `createPickerSessionService(...)` and passes `pickerSessions: pickerSessionService` to `server/routes/filesystemRoutes.ts`; picker session and native dialog logic no longer lives in the composition root.
- `server/routes/filesystemRoutes.ts` now receives picker behavior through the `PickerSessionService` boundary while preserving the existing `/api/party/folder-picker`, `/api/party/folder-picker/start`, `/api/party/folder-picker/:sessionId`, `/api/party/avatar-picker/start`, and `/api/party/avatar-picker/:sessionId` API envelopes.
- `tests/pickerSessionService.test.ts` covers start-path normalization, cancellation serialization, expired session pruning, injected avatar persistence for selected image sessions, Windows picker output parsing, launcher quoting, and Windows folder/image session finalization without opening real dialogs.
- `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now pin the picker service boundary and prevent picker session/native dialog helpers from returning to `server/controlPlane.ts`.
- `docs/generated/server-index-architecture.md` was regenerated with `17,987` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/pickerSessionService.test.ts`, `node --import tsx --test tests/pickerSessionService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts`, `npm run smoke:filesystem-control-plane`, `npm run smoke:command-console-files`, `npm run smoke:server-architecture`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`154` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `154` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase G status:

- Items 66, 67, 68, and 69 are complete and verified.

Still open from Phase G:

- Items 70-75: add path traversal, symlink escape, upload type allowlist, attachment size-limit, avatar upload-limit, and upload-root escape coverage.

Next:

- Continue Phase G with item 70: add broader path traversal attempt coverage across the extracted filesystem/picker/upload boundaries.

### 2026-06-30 - Phase G path traversal coverage

Completed verified plan items: 70.

Evidence:

- `tests/safePathService.test.ts` now covers multi-segment traversal attempts across POSIX and Windows paths, including safe normalized descendants, escapes above the approved root, root-target traversal, and cross-drive Windows escapes.
- `tests/controlFilesService.test.ts` now covers separator-mixed and encoded traversal-shaped control-file names before disk access, proving the service rejects them through the allowlist boundary.
- `tests/commandConsoleUploadService.test.ts` now proves upload source names strip traversal segments before writing, upload-root metadata escapes are ignored, and upload persistence fails before directory creation when the containment guard rejects the resolved write path.
- `server/services/filesystem/pickerSessionService.ts` now resolves relative picker start paths under the provided fallback root and rejects relative traversal starts that would escape that fallback, while preserving absolute path and file-URL behavior.
- `tests/pickerSessionService.test.ts` covers relative picker start paths under fallback, normalized safe dot segments, and traversal starts that fall back instead of escaping.
- `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-command-console-files-control-plane.ts` now pin the new traversal coverage and picker start-path containment contract.
- `docs/generated/server-index-architecture.md` remains at `17,987` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no filesystem traversal logic was added back to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts`, `npm run smoke:filesystem-control-plane`, `npm run smoke:command-console-files`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`159` tests), `npm run lint`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `159` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase G status:

- Items 66, 67, 68, 69, and 70 are complete and verified.

Still open from Phase G:

- Items 71-75: add symlink escape coverage where possible, file type allowlist coverage, attachment size-limit coverage, avatar upload-limit coverage, and upload-root escape confirmation.

Next:

- Continue Phase G with item 71: add symlink escape coverage where locally possible across the extracted filesystem/upload boundaries.

### 2026-06-30 - Phase G symlink escape coverage

Completed verified plan items: 71.

Evidence:

- `server/services/controlFilesService.ts` now checks existing command-console control-file paths with `lstat` and `realpath` before reads or writes, so a control file such as `AGENTS.md` cannot follow a symlink outside the workspace root.
- `server/services/filesystem/commandConsoleUploadService.ts` now resolves the upload root and attachment file with `realpath` before inline Gateway attachment reads, so a saved upload attachment path that is a symlink escape is skipped instead of read.
- `tests/controlFilesService.test.ts` covers a real filesystem symlink from `AGENTS.md` to an outside file and proves both read and write reject it without changing the outside file.
- `tests/commandConsoleUploadService.test.ts` covers a real upload-root symlink to an outside file and proves Gateway inline attachment conversion returns no payload for the escaped target.
- `scripts/smoke-command-console-files-control-plane.ts` now pins the control-file realpath check, upload attachment read realpath check, and symlink escape tests.
- `docs/generated/server-index-architecture.md` remains at `17,987` control-plane composition lines, `9` entrypoint lines, and `0` inline routes; no filesystem symlink logic was added to `server/controlPlane.ts`.
- Verification passed: `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts` (`23` tests), `npm run smoke:filesystem-control-plane`, `npm run smoke:command-console-files`, `npm run typecheck:server`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`161` tests), `npm run lint`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `161` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase G status:

- Items 66, 67, 68, 69, 70, and 71 are complete and verified.

Still open from Phase G:

- Items 72-75: add file type allowlist coverage, attachment size-limit coverage, avatar upload-limit coverage, and upload-root escape confirmation.

Next:

- Continue Phase G with item 72: add tests for file type allowlist behavior across command-console uploads and avatar/image picker boundaries.

### 2026-06-30 - Phase G file type allowlist coverage

Completed verified plan items: 72.

Evidence:

- `server/services/filesystem/avatarFileService.ts` now owns avatar upload file naming, allowed avatar image extensions, MIME fallback mapping for extensionless image uploads, the avatar upload size constant, and managed avatar filename generation.
- `server/controlPlane.ts` imports the avatar file helpers and keeps only persistence orchestration for `persistAgentAvatarBytes` and `persistAgentAvatarFromPath`; avatar filename and allowlist helper definitions no longer live in the composition root.
- `server/services/filesystem/commandConsoleUploadService.ts` now rejects unsupported explicit file extensions before applying MIME fallback, while preserving MIME fallback for extensionless supported uploads.
- `server/services/filesystem/pickerSessionService.ts` now checks selected image paths with the avatar image allowlist before invoking injected avatar persistence, so native picker "All files" selections cannot bypass the service boundary.
- `tests/avatarFileService.test.ts` covers supported avatar extensions, MIME fallback for extensionless uploads, unsupported explicit extension rejection before MIME fallback, and deterministic managed avatar naming.
- `tests/commandConsoleUploadService.test.ts` now covers supported extension uploads, supported MIME fallback uploads, and unsupported explicit extension rejection even when the MIME header is image-like.
- `tests/pickerSessionService.test.ts` now proves unsupported picked image files become an error session before `persistAgentAvatarFromPath` runs.
- `tests/partyAvatarUploadRoutes.test.ts` proves `/api/party/avatar-upload/:agentId` returns a canonical `avatar_upload_failed` envelope for unsupported file types before persistence, while extensionless supported image MIME uploads still persist.
- `scripts/smoke-filesystem-control-plane.ts`, `scripts/smoke-command-console-files-control-plane.ts`, and `scripts/smoke-server-entrypoint-boundary.ts` now pin the avatar file service boundary, upload explicit-extension allowlist behavior, picker allowlist enforcement, and the new test coverage.
- `docs/generated/server-index-architecture.md` was regenerated with `17,953` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `npm run smoke:filesystem-control-plane`, `npm run smoke:command-console-files`, `npm run smoke:server-architecture`, `npm run smoke:skills-control-plane`, `node scripts/report-server-index-architecture.mjs`, `npm run typecheck`, `npm run test:unit` (`168` tests), `npm run lint`, and `npm test`.
- Full `npm test` passed end to end with `168` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase G status:

- Items 66, 67, 68, 69, 70, 71, and 72 are complete and verified.

Still open from Phase G:

- Items 73-75: add attachment size-limit coverage, avatar upload-limit coverage, and upload-root escape confirmation.

Next:

- Continue Phase G with item 73: add tests for attachment size limits across command-console upload persistence and Gateway inline attachment conversion.

### 2026-06-30 - Phase G attachment size-limit coverage

Completed verified plan items: 73.

Evidence:

- `server/services/filesystem/commandConsoleUploadService.ts` now skips Gateway inline attachments whose declared metadata size exceeds the service-owned file/image inline limit before resolving or reading the file, while preserving the post-read byte-length guard for mismatched metadata.
- `tests/commandConsoleUploadService.test.ts` now covers command-console upload persistence exactly at the configured size limit, rejection one byte over the limit without writing a second file, file Gateway attachments at/over the inline limit, image Gateway attachments at/over the inline limit, declared-oversized metadata, and actual oversized file bytes.
- `scripts/smoke-command-console-files-control-plane.ts` now pins the pre-read inline size guard and the new exact-boundary and file/image Gateway inline size-limit tests.
- No filesystem size-limit logic was added back to `server/controlPlane.ts`; `npm run smoke:server-architecture` still reports `17,953/29,000` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/commandConsoleUploadService.test.ts`, `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `npm run smoke:command-console-files`, `npm run smoke:filesystem-control-plane`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`170` tests), `npm run lint`, and `npm test`.
- Full `npm test` passed end to end with `170` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase G status:

- Items 66, 67, 68, 69, 70, 71, 72, and 73 are complete and verified.

Still open from Phase G:

- Items 74-75: add avatar upload-limit coverage and upload-root escape confirmation.

Next:

- Continue Phase G with item 74: add avatar upload-limit coverage across `/api/party/avatar-upload/:agentId` and avatar file persistence.

### 2026-06-30 - Phase G avatar upload-limit coverage

Completed verified plan items: 74.

Evidence:

- `server/services/filesystem/avatarFileService.ts` now owns avatar upload byte/stat-size validators and the shared upload-limit error message, in addition to the `15 MB` limit constant.
- `server/controlPlane.ts` now uses the avatar file service validators for both byte uploads and selected-path avatar persistence, keeping the size-limit rule shared across both persistence paths.
- `server/routes/partyManagementRoutes.ts` now receives `avatarUploadLimitBytes` through composition, uses it for the raw-body parser, and returns canonical `413` `avatar_upload_failed` envelopes for parser-level oversized avatar bodies before persistence runs.
- `tests/avatarFileService.test.ts` covers exact-boundary and over-limit avatar persistence helper behavior, empty uploads, and the shared limit message.
- `tests/partyAvatarUploadRoutes.test.ts` covers exact-boundary route acceptance and oversized route rejection before `persistAgentAvatarBytes` is called.
- `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now pin the shared avatar size validators, route limit injection, and persistence helper usage.
- `docs/generated/server-index-architecture.md` was regenerated with `17,959` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/avatarFileService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `npm run smoke:filesystem-control-plane`, `npm run smoke:command-console-files`, `npm run smoke:server-architecture`, `npm run typecheck:server`, `npm run typecheck`, `npm run test:unit` (`172` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `172` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase G status:

- Items 66, 67, 68, 69, 70, 71, 72, 73, and 74 are complete and verified.

### 2026-06-30 - Phase G upload-root escape confirmation

Completed verified plan items: 75.

Evidence:

- `server/services/filesystem/commandConsoleUploadService.ts` now accepts an `approvedRootDir`, verifies the real upload directory stays under that approved root before writes, creates uploaded files with exclusive `wx` semantics, and re-checks the real uploaded file path after creation.
- `server/controlPlane.ts` composes the command-console upload service with `approvedRootDir: WORKSPACE_ROOT`, keeping workspace containment at the service boundary while the composition root stays as wiring.
- `tests/commandConsoleUploadService.test.ts` now covers symlinked upload directories outside the approved root, preexisting symlink upload targets, sibling-root metadata escapes, inline Gateway symlink escape reads, and the existing upload persistence, allowlist, and size-limit paths.
- `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` now pin approved-root composition, realpath upload write-root validation, exclusive upload creation, and the new upload-root escape tests.
- `docs/generated/server-index-architecture.md` was regenerated with `17,960` control-plane composition lines, `9` entrypoint lines, and `0` inline routes.
- Verification passed: `node --import tsx --test tests/commandConsoleUploadService.test.ts`, `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts`, `npm run smoke:command-console-files`, `npm run smoke:filesystem-control-plane`, `npm run smoke:server-architecture`, `npm run typecheck`, `npm run test:unit` (`174` tests), `npm run lint`, `node scripts/report-server-index-architecture.mjs`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Phase G status:

- Items 66, 67, 68, 69, 70, 71, 72, 73, 74, and 75 are complete and verified.

Next:

- Continue Phase H with item 76: keep `src/store/nexusStore.ts` from growing further before moving renderer API calls into `src/api/*` modules.

### 2026-06-30 - Phase H renderer store growth guard

Completed verified plan items: 76.

Evidence:

- `scripts/smoke-renderer-store-boundary.ts` now pins the Phase H `src/store/nexusStore.ts` baseline at `4,408` logical lines, `18` store-owned `apiRequest` call lines, `20` store-owned `/api/` path literal lines, and exactly `1` direct `fetch`, reserved for `/api/openclaw/agent-turn/stream` SSE parsing.
- `package.json` now exposes `npm run smoke:renderer-store-boundary` and wires it into `npm run test:ci` immediately before the existing `smoke:nexus-control-plane` gate.
- The guard requires future renderer API work to extract calls into `src/api/*` modules or other focused renderer services before adding store surface.
- `src/store/nexusStore.ts` was not changed during this item; item 76 is a repeatable growth boundary before item 77 extraction work starts.
- Verification passed: `npm run smoke:renderer-store-boundary`, `npm run smoke:nexus-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run typecheck`, `npm run lint`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, renderer-store-boundary, and CI smoke suite.

Phase H status:

- Item 76 is complete and verified.

Still open from Phase H:

- Items 77-85: move renderer API calls into `src/api/*` modules, split projection/runtime state out of the growing store, and add persisted-state migration coverage.

Next:

- Continue Phase H with item 77: move API calls into `src/api/*` modules, starting with a focused API family that can be extracted and verified without changing backend behavior.

### 2026-06-30 - Phase H renderer API extraction, party and agent-turn helpers

Completed verified plan items: 77.

Evidence:

- `src/api/party.ts` now owns party overview, avatar URL, agent config save, recruit, recruit-resource save, and retire API request helpers plus the party wire payload types that were embedded in `src/store/nexusStore.ts`.
- `src/api/agentTurns.ts` now owns agent runtime preflight, buffered agent-turn, party prewarm turn, and session-clear API request helpers plus the agent-turn wire payload types that were embedded in the store.
- `src/store/nexusStore.ts` now delegates those requests through the extracted API modules while keeping renderer projection/UI state behavior unchanged for this slice.
- Store-owned JSON API request calls dropped from the Phase H item 76 baseline of `18` to `3`; store-owned `/api/` path literal lines dropped from `20` to `4`; the remaining store API lines are mission start/stop/projection plus the intentionally retained `/api/openclaw/agent-turn/stream` SSE fetch.
- `scripts/smoke-renderer-store-boundary.ts` now ratchets the store boundary to `4,274` logical lines, `3` `apiRequest` call lines, `4` `/api/` path literal lines, and exactly `1` direct SSE fetch, and asserts the new `src/api/party.ts` and `src/api/agentTurns.ts` ownership.
- `scripts/smoke-nexus-control-plane.ts`, `scripts/smoke-agent-turn-control-plane.ts`, `scripts/smoke-filesystem-control-plane.ts`, and `scripts/smoke-config-save-lifecycle.ts` now verify the extracted renderer API helper boundary while preserving backend route-envelope and config-save lifecycle checks.
- Verification passed: `npm run smoke:renderer-store-boundary`, `npm run smoke:nexus-control-plane`, `npm run smoke:agent-turn-control-plane`, `npm run smoke:filesystem-control-plane`, `npm run smoke:config-save`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`174` tests), `git diff --check`, and `npm test`.

Phase H status:

- Items 76 and 77 are complete and verified.

Still open from Phase H:

- Items 78-85: move mission projection syncing out of `src/store/nexusStore.ts`, move remaining agent/provider/plugin API families into `src/api/*`, split UI-only state from backend projection state, and add persisted-state migration coverage.

Next:

- Continue Phase H with item 78: move mission projection syncing into `src/api/missions.ts` or `src/services/missionProjectionClient.ts` without changing backend mission truth.

### 2026-06-30 - Phase H mission API extraction

Completed verified plan items: 78.

Evidence:

- `src/api/missions.ts` now owns the renderer mission wire contracts and JSON request helpers for mission projection, mission start, and mission stop.
- `src/store/nexusStore.ts` now delegates mission projection/start/stop requests through `src/api/missions.ts` while preserving the existing backend-to-renderer mission projection merge, failed lifecycle preservation, report retention, and polling behavior.
- Store-owned JSON API request calls dropped from the item 77 baseline of `3` to `0`; store-owned `/api/` path literal lines dropped from `4` to `1`, which is the intentionally retained `/api/openclaw/agent-turn/stream` SSE fetch.
- `scripts/smoke-renderer-store-boundary.ts` now ratchets the store boundary to `4,229` logical lines, `0` store-owned `apiRequest` calls, `1` `/api/` path literal, and exactly one direct SSE fetch. It also asserts that mission projection/start/stop endpoints live in `src/api/missions.ts`.
- Mission source-inspection smokes now follow the new boundary: durable-state, idempotency, cancellation, backend-owned lifecycle, lifecycle-projection, and restart-recovery checks assert mission API ownership in `src/api/missions.ts` while keeping renderer projection behavior in `src/store/nexusStore.ts`.
- Verification passed: `npm run smoke:renderer-store-boundary`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-restart-recovery`, `npm run smoke:mission-durable-state`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-report`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`174` tests), `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, and 78 are complete and verified.

Still open from Phase H:

- Items 79-85: move the remaining agent-turn SSE call and provider/plugin API families into focused renderer API modules, split UI-only state from backend projection state, and add persisted-state migration coverage.

Next:

- Continue Phase H with item 79: move the remaining agent-turn stream request out of `src/store/nexusStore.ts` and into `src/api/agentTurns.ts` or a focused renderer SSE client without changing stream parsing behavior.

### 2026-06-30 - Phase H agent-turn stream API extraction

Completed verified plan items: 79.

Evidence:

- `src/api/agentTurns.ts` now owns the renderer agent-turn SSE transport helper for `/api/openclaw/agent-turn/stream`, including the direct `fetch`, event-stream content-type gate, shared `createSseFrameParser()` frame iteration, and non-SSE JSON/text fallback handling.
- `src/store/nexusStore.ts` now delegates streaming transport through `sendStreamingAgentTurn(...)` and keeps only the live UI projection callbacks for `start`, `status`, `progress`, `delta`, `error`, and `final` frames, preserving malformed final metadata fallback, model/transport metadata capture, abort-without-buffered-retry behavior, and final response projection.
- Store-owned backend calls dropped from the item 78 baseline of `1` direct SSE fetch and `1` `/api/` path literal to `0` direct fetches and `0` `/api/` path literals.
- `scripts/smoke-renderer-store-boundary.ts` now ratchets the store boundary to `4,214` logical lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches while asserting `src/api/agentTurns.ts` owns the stream endpoint and SSE frame iteration.
- Agent-turn, Nexus, runtime-actions, and OpenClaw source smokes now assert the split between API-owned stream transport/frame reading and store-owned live projection behavior.
- Verification passed: `npm run smoke:renderer-store-boundary`, `npm run smoke:agent-turn-control-plane`, `npm run smoke:nexus-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run typecheck`, `npm run smoke:openclaw`, `npm run lint`, `npm run test:unit` (`174` tests), `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw stream, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, and 79 are complete and verified.

### 2026-06-30 - Phase H provider auth API extraction

Completed verified plan items: 80.

Evidence:

- `src/api/providerAuth.ts` now owns the renderer provider-auth wire contracts and API helpers for provider status reads, API-key saves, OAuth session starts, OAuth polling, manual OAuth completion, safe provider-status filtering, provider auth labels, auth kind labels, and OpenAI Codex effective-auth fallback behavior.
- `src/components/auth/ProviderAuthModal.tsx` now delegates provider status refresh, OAuth start, OAuth polling, and manual OAuth submission through `src/api/providerAuth.ts`, while preserving local credential clearing, readiness verification, gcloud refresh behavior, OAuth browser/manual paths, and redacted API envelope handling.
- `src/components/editor/AgentEditorModal.tsx`, `src/components/party/ModelSelectorModal.tsx`, and `src/components/recruit/RecruitAgentModal.tsx` now use the shared provider-auth helpers for provider status refreshes and API-key saves instead of owning `/api/auth/providers` endpoint literals.
- `scripts/smoke-auth-provider-model-control-plane.ts`, `scripts/smoke-auth-control-plane.ts`, `scripts/smoke-config-save-lifecycle.ts`, and `scripts/smoke-renderer-store-boundary.ts` now assert the new renderer provider-auth API boundary, prove components no longer own provider-auth endpoint literals, and keep provider setup/status and missing-auth UX contracts pinned.
- `src/store/nexusStore.ts` stayed at the item `79` ratchet: `4,214` logical lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches.
- Verification passed: `npm run smoke:auth-provider-model`, `npm run smoke:config-save`, `npm run smoke:auth`, `npm run smoke:renderer-store-boundary`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`174` tests), `npm run smoke:provider-auth-beta`, `npm run smoke:nexus-control-plane`, `git diff --check`, direct `rg` confirmation of no `/api/auth/providers` literals in `src/components`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw stream, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, and 80 are complete and verified.

Still open from Phase H:

- Items 81-85: move plugin API calls into focused renderer API modules, split UI-only state from backend projection state, split agent config/mission/command-console state, and add persisted-state migration coverage.

Next:

- Continue Phase H with item 81: move plugin calls into `src/api/plugins.ts` without changing plugin status, setup, install/update/remove, runtime command, or state-projection behavior.

### 2026-06-30 - Phase H plugin API extraction

Completed verified plan items: 81.

Evidence:

- `src/api/plugins.ts` now owns the renderer plugin wire contracts and API helpers for plugin list/refresh, ClawHub search, install, enable/disable, update, update-all, runtime inspect, Gateway restart, uninstall, direct plugin setup saves, ClawTalk setup, and the plugin-panel OpenClaw command runner.
- `src/components/plugins/PluginsPanel.tsx` now delegates plugin transport through `src/api/plugins.ts` while preserving plugin cache updates, state filters, setup modal behavior, install/update/remove notices, runtime inspect projection, Gateway restart notices, and OpenClaw command output handling.
- `src/components/plugins/pluginStateProjection.ts` now consumes plugin entry/config field types from `src/api/plugins.ts`, keeping backend plugin payload shape in the renderer API boundary while preserving the beta-state classifier.
- `scripts/smoke-plugins-control-plane.ts`, `scripts/smoke-openclaw-command-control-plane.ts`, and `scripts/smoke-renderer-store-boundary.ts` now assert the new plugin renderer API boundary and prove `PluginsPanel` does not own plugin endpoint literals or direct JSON API calls.
- `src/store/nexusStore.ts` stayed at the item `79` ratchet: `4,214` logical lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches.
- Verification passed: `npm run smoke:plugins-control-plane`, `npm run smoke:openclaw-command-control-plane`, `npm run smoke:renderer-store-boundary`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`174` tests), direct `rg` confirmation of no plugin endpoint/API-client ownership in `src/components/plugins`, `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, 80, and 81 are complete and verified.

Still open from Phase H:

- Items 82-85: split UI-only state from runtime projection state, split agent config state from mission state, split command-console draft state from runtime response state, and add persisted-state migration coverage.

Next:

- Continue Phase H with item 82: split UI-only state from runtime projection state without changing backend runtime truth or persisted state shape.

### 2026-06-30 - Phase H UI/runtime projection state split

Completed verified plan items: 82.

Evidence:

- `src/store/nexusUiState.ts` now owns the renderer shell UI state contract: `AppTab`, tab state, selected-agent state, editor-open state, and selection normalization.
- `src/store/runtimeProjectionState.ts` now owns the volatile runtime projection contract: active mission projection, mission feed, agent responses, busy agents, operation states, session warm state, and agent config save-status projection helpers.
- `src/store/nexusStore.ts` now composes persisted operator state, UI-only state, runtime projection state, and coordination state through explicit interfaces instead of keeping all volatile fields in the main store interface.
- Initial state, simulation reset, and persistence merge now use the extracted UI/runtime projection helpers while preserving the existing local-storage partialize shape: operator configuration and completed mission summaries persist; active runtime projection remains volatile.
- `tests/nexusStoreStateSplit.test.ts` covers UI-only state construction, runtime projection reset construction, and persistence-merge behavior that preserves current volatile responses while clearing warm/save internals.
- `scripts/smoke-renderer-store-boundary.ts` now pins the item `82` state split, verifies the new modules do not own each other's fields, and ratchets `src/store/nexusStore.ts` to `4,149` logical lines, `0` store-owned `apiRequest` calls, `0` `/api/` path literals, and `0` direct fetches.
- Verification passed: `node --import tsx --test tests/nexusStoreStateSplit.test.ts`, `npm run smoke:renderer-store-boundary`, `npm run smoke:nexus-control-plane`, `npm run smoke:agent-turn-control-plane`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:config-save`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`177` tests), `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `177` unit tests and the full renderer-store, Nexus, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, 80, 81, and 82 are complete and verified.

### 2026-06-30 - Phase H agent config and mission state split

Completed verified plan items: 83.

Evidence:

- `src/store/agentConfigState.ts` now owns the renderer agent roster, retired-agent set, active/confirmed party state, seed-agent/default-party helpers, party sanitization, portrait persistence sanitization, and persisted agent config merge/partialize helpers.
- `src/store/missionState.ts` now owns the persisted mission draft, mission history, mission reports, history/report trim limits, mission initial state, and mission merge/partialize helpers.
- `src/store/nexusStore.ts` now composes `NexusAgentConfigState` and `NexusMissionState` separately from UI-only, runtime projection, and coordination state, preserving the existing local-storage payload shape while removing the mixed `NexusPersistedState` interface.
- `tests/nexusStoreStateSplit.test.ts` now covers agent-config state construction, party sanitization, persisted portrait sanitization, legacy default-party hydration repair, mission-state construction, and mission history/report trimming.
- `scripts/smoke-renderer-store-boundary.ts` now pins the agent-config and mission-state module ownership, verifies those modules do not own each other's fields, prevents `nexusStore.ts` from reintroducing a mixed persisted state interface, and ratchets `src/store/nexusStore.ts` to `3,936` logical lines with `0` store-owned API requests, `0` API path literals, and `0` direct fetches.
- Verification passed: `node --import tsx --test tests/nexusStoreStateSplit.test.ts`, `npm run smoke:renderer-store-boundary`, `npm run smoke:nexus-control-plane`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:agent-turn-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:config-save`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`180` tests), `npm test`, and `git diff --check`.
- Full `npm test` passed end to end with `180` unit tests and the full renderer-store, Nexus, mission, command-console, filesystem, plugin, Gateway, runtime, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, 80, 81, 82, and 83 are complete and verified.

Still open from Phase H:

- Items 84-85: split command-console draft state from runtime response state and add persisted-state migration coverage.

Next:

- Continue Phase H with item 84: split command-console draft state from runtime response state without changing command-console queue, session, or response projection behavior.

### 2026-06-30 - Phase H command-console draft and response state split

Completed verified plan items: 84.

Evidence:

- `src/store/commandConsoleState.ts` now owns command-console draft state helpers, draft storage keys, localStorage read/write/remove behavior, retired-agent draft cleanup, command-console response/busy-lane state, session keys, queue progress labels, queued response projection, and queued response duration patching.
- `src/store/runtimeProjectionState.ts` no longer owns `agentResponses` or `busyAgentIds`; it now stays focused on active mission projection, mission feed, operation states, session warm state, and agent config save-status projection.
- `src/store/nexusStore.ts` now composes `NexusCommandConsoleResponseState` separately from runtime projection state, initializes it with `makeCommandConsoleResponseState()`, preserves volatile command-console responses through `preserveCommandConsoleResponseState(current)`, delegates queued response construction/patching to `commandConsoleState`, and delegates retired-agent command draft cleanup through `removeCommandConsoleDraftsForAgent(...)`.
- `src/components/monitor/AgentResponseConsole.tsx` now consumes command-console draft helpers from `src/store/commandConsoleState.ts` instead of owning command draft localStorage access or draft-state shape.
- `tests/nexusStoreStateSplit.test.ts` now covers runtime projection without command-console response keys, command-console response preservation, command-console draft read/write/remove/retired-agent cleanup, session key generation, queue progress labels, queued response projection, and queued response duration patching.
- `scripts/smoke-renderer-store-boundary.ts` now pins the item `84` boundary, verifies draft storage ownership is outside `AgentResponseConsole`, verifies command-console responses are outside `runtimeProjectionState`, and ratchets `src/store/nexusStore.ts` to `3,889` logical lines with `0` store-owned API request calls, `0` API path literals, and `0` direct fetches.
- Verification passed: `node --import tsx --test tests/nexusStoreStateSplit.test.ts` (`10` tests), `npm run smoke:renderer-store-boundary`, `npm run smoke:nexus-control-plane`, `npm run smoke:agent-turn-control-plane`, `npm run smoke:runtime-actions-control-plane`, `npm run smoke:config-save`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`184` tests), `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `184` unit tests and the full renderer-store, Nexus, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, 80, 81, 82, 83, and 84 are complete and verified.

Still open from Phase H:

- Item 85: add persisted-state migration coverage.

Next:

- Continue Phase H with item 85: add persisted-state migration coverage for the split store modules and the existing `nexus-v10` persisted payload shape.

### 2026-06-30 - Phase H persisted-state migration coverage

Completed verified plan items: 85.

Evidence:

- `src/store/nexusPersistence.ts` now owns the renderer `nexus-v10` persistence contract: storage key, current persisted payload version `5`, minimum accepted version `3`, persisted-state merge, and persisted payload partialization.
- `src/store/nexusStore.ts` delegates Zustand `merge` and `partialize` to `mergeNexusPersistedState(...)` and `partializeNexusPersistedState(...)`, keeping the store as composition while preserving the existing `nexus-v10` payload shape.
- `tests/nexusStoreStateSplit.test.ts` now covers missing/stale persisted version rejection, legacy default-party hydration through split modules, mission history/report trimming, volatile runtime projection preservation, volatile command-console response preservation, warm/save-state clearing, and compact persisted payload keys.
- `scripts/smoke-renderer-store-boundary.ts` now pins `src/store/nexusPersistence.ts` as the persistence boundary and verifies the item `85` migration/partialize tests are present; `scripts/smoke-mission-report-truth.ts` now follows the new persistence boundary for mission report persistence.
- `src/store/nexusStore.ts` remains below the item `84` ratchet at `3,865/3,889` logical lines with `0` store-owned API request calls, `0` API path literals, and `0` direct fetches.
- Verification passed: `node --import tsx --test tests/nexusStoreStateSplit.test.ts` (`13` tests), `npm run smoke:renderer-store-boundary`, `npm run smoke:mission-report`, `npm run smoke:nexus-control-plane`, `npm run smoke:config-save`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`187` tests), `git diff --check`, and `npm test`.
- Full `npm test` passed end to end with `187` unit tests and the full renderer-store, Nexus, mission, command-console, filesystem, plugin, Gateway, runtime, provider, release, security, secret-scan, and CI smoke suite.

Phase H status:

- Items 76, 77, 78, 79, 80, 81, 82, 83, 84, and 85 are complete and verified.

Next:

- Continue Phase I with item 86: freeze new global CSS layers after `95-typography-polish.css` before further UI cleanup.

### 2026-06-30 - Phase L beta docs and support

Completed verified plan items: 131, 132, 133, 134, 135, 136, 137, 138, 139, and 140.

Evidence:

- `CHANGELOG.md` now includes a private beta disclaimer, supported beta OS expectations, known issues, the loopback-only local API warning, and the beta feedback URL.
- `docs/BETA_SUPPORT.md` now owns the beta support runbook with known issues, Gateway recovery, local state reset, safe-log sharing, local data boundaries, external data boundaries, supported OS notes, and the network-exposure warning.
- `DATA_HANDLING.md` now has explicit "what data stays local" and "what can leave your machine" sections.
- `README.md` and `docs/USER_GUIDE.md` now link to the beta support runbook from the local safety, documentation, and troubleshooting paths.
- `.github/ISSUE_TEMPLATE/beta_feedback.yml` adds a structured beta feedback template with version, OS, install type, Gateway/provider/plugin state, safe log excerpt, and a required safety check before sharing logs.

Phase L status:

- Items 131-140 are complete.

### 2026-06-30 - Phase I UI cleanup and packaged beta screenshots

Completed verified plan items: 86, 87, 88, 89, 90, 91, 92, 93, 94, and 95.

Evidence:

- `src/dystopai-app-theme.css` now ends at `95-typography-polish.css`; the former late `99-mission-quiet-redesign.css` global layer is removed from the theme cascade, and `scripts/smoke-shell-production-ui.ts` rejects any future `dystopai-theme` layer above `95`.
- Mission-specific late overrides now live in component-owned CSS through `src/components/mission/MissionDeploymentPanel.css`, imported directly by `src/components/mission/MissionDeploymentPanel.tsx`, so new mission visual work no longer needs a global late override layer.
- `docs/DESIGN_TOKENS.md` documents colors, spacing, typography, radii, motion, and accessibility notes, including the frozen final global layer and the component-owned CSS rule for future visual work.
- `src/styles/tokens.css` now exposes motion-duration tokens and reduced-motion overrides; `src/styles/accessibility.css` keeps token-backed focus rings, dark-surface focus halo, explicit reduced-motion handling, and OS reduced-motion handling.
- `scripts/smoke-shell-production-ui.ts` verifies navigation semantics, `aria-current="page"` for primary and utility navigation, the keyboard skip link and focusable main landmark, visible focus rings, reduced motion, no late global theme layers, and the mission component-owned CSS boundary.
- `scripts/smoke-ui-font-sizes.ts` and `scripts/smoke-ui-contrast-tokens.ts` now verify the final typography/component mission CSS small-text floor, token contrast pairs, mission text contrast pairs, motion tokens, and design-token documentation coverage.
- `electron/main.cjs`, `scripts/capture-packaged-beta-screenshots.ts`, `scripts/package-desktop.cjs`, `scripts/after-pack.cjs`, `scripts/windows-electron-launcher.cs`, and `package.json` now support unsigned packaged-dir screenshot capture without public signing credentials.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports with no broken images or horizontal overflow and refreshed static UI screenshots under `output/playwright`.
- `npm run package:desktop:unsigned` passed and produced `release/win-unpacked` with the packaged app, launcher, Electron runtime, bundled OpenClaw resources, `app.asar`, `dist/index.html`, and `dist-server/index.cjs`.
- `npm run capture:packaged-beta-screenshots` passed and captured 12 packaged production screenshots plus a manifest under `output/packaged-beta-screenshots/2026-07-01T00-15-52-033Z`.
- Verification passed: `npm run smoke:shell-production-ui`, `npm run smoke:ui-font-sizes`, `npm run smoke:ui-contrast`, `npm run typecheck`, `npm run lint`, `npm run test:unit` (`187` tests), `npm run build:client`, `npm run smoke:ui`, `npm run package:desktop:unsigned`, `npm run capture:packaged-beta-screenshots`, and `npm test`.
- Full `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Phase I status:

- Items 86-95 are complete and verified.

Next:

- Continue Phase J with item 96: run `npm ci` as the first beta readiness gate before the remaining Phase J validation sequence.

### 2026-06-30 - Phase J initial beta readiness gates

Completed verified plan items: 96, 97, 98, 99, 100, and 101.

Evidence:

- `npm ci` passed from a clean dependency install, adding `561` packages and auditing `562` packages.
- `npm run prepare:openclaw-vendor` passed and confirmed OpenClaw `2026.6.11` production dependencies were already prepared.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `npm run test:unit:coverage` passed with `187` tests and aggregate coverage of `88.59%` lines, `75.58%` branches, and `87.11%` functions.
- `npm run build:standalone` passed, producing the production client bundle and `dist-server/index.cjs`.
- `npm run check:bundle-budgets` passed with entry JS `493,462` bytes / `154,541` gzip bytes, entry CSS `1,222,691` bytes / `155,244` gzip bytes, and total JS `783,501` bytes / `241,568` gzip bytes, all within the current budgets.

Phase J status:

- Items 96, 97, 98, 99, 100, and 101 are complete and verified.

Still open from Phase J:

- Items 102-110: Electron E2E smoke, desktop package, packaged launch smoke, state backup/verify, release evidence/validation, beta artifact upload or local artifact note, and known-issues recording.

Risks and notes:

- `npm ci` reported existing dependency-audit warnings: `8` vulnerabilities (`2` low, `2` moderate, `2` high, and `2` critical), plus deprecated transitive packages. This pass did not change dependency versions during gate validation.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next:

- Continue Phase J with item 102: run `npm run smoke:electron-e2e`, then proceed through packaging, packaged-launch, state backup/verify, and release evidence gates in order.

### 2026-06-30 - Phase J beta package, backup, and release evidence gates

Completed verified plan items: 102, 103, 104, 105, 106, 107, 108, and 110.

Evidence:

- `npm run smoke:electron-e2e` passed, covering unpackaged Electron startup, tray behavior, renderer journey, renderer recovery, external-navigation policy, and startup-error handling.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked` with the packaged app, launcher, Electron runtime, bundled OpenClaw resources, `app.asar`, `dist/index.html`, and `dist-server/index.cjs`.
- `npm run smoke:packaged-electron-launch` passed against `release/win-unpacked/DystopAI.exe`.
- The first `npm run state:backup` attempt against the real local `.openclaw` state failed because plugin-skill junctions were treated as fatal symbolic links. `scripts/lib/runtime-state-backup.cjs` now skips symlink entries without following their targets, records them in `backup-manifest.json`, and verifies skipped-entry manifest safety.
- `node --test tests/runtime-state-backup.test.cjs` passed with focused coverage for symlink skips, skipped-entry manifest verification, unsafe skipped paths, duplicate paths, restore safety, and checksum tamper detection.
- `npm run smoke:release-lifecycle` passed after updating the release lifecycle contract to require symlink skip recording rather than symlink traversal.
- `npm run state:backup` then passed against the realistic local OpenClaw state, creating `C:\Users\hotbo\DystopAI Backups\dystopai-state-2026-07-01_00-44-32-388` with `33,475` verified regular files, `2,793,015,447` bytes, and `4` skipped symlink entries including plugin-skill junctions.
- `npm run state:verify` passed against that exact backup path and verified `33,475` files plus `4` skipped symlink entries.
- `npm run release:evidence` passed and regenerated `release/evidence/dystopai-sbom.cdx.json`, `release/evidence/checksums.sha256`, and `release/evidence/release-evidence.json`.
- `npm run release:validate` passed in non-public mode with `35,683` checksums, `35,665` packaged artifact files under `release`, and `635` SBOM components. It correctly skipped update-channel, checksum-signature, and consumer-distribution signing validation because no public signing evidence is present for this beta milestone.
- `npm test` passed after the state-backup symlink change with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- Beta known issues are recorded in `CHANGELOG.md`, `docs/BETA_SUPPORT.md`, and `release/evidence/phase-j-beta-readiness-2026-06-30/BETA_KNOWN_ISSUES.md`, including unsigned/non-public validation, dependency audit warnings, and symlink-skipped state backup behavior.

Phase J status:

- Items 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, and 110 are complete and verified.

Blocked from Phase J:

- Item 109 is locally staged but not uploaded: `gh pr list --head main --state open` returned `[]`, `gh release list` returned `[]`, and the current open PRs are unrelated branches `#43`, `#42`, `#38`, and `#37`. Local evidence remains staged at `release/phase-j-beta-readiness-2026-06-30-evidence.zip` and canonical release evidence remains under `release/evidence/`.

Risks and notes:

- `npm ci` still reports the previously recorded `8` dependency-audit findings (`2` low, `2` moderate, `2` high, `2` critical); dependency remediation was not part of this gate pass.
- Public signing, signed update-channel evidence, and consumer distribution lifecycle evidence remain intentionally outside the private beta milestone.

Next:

- Continue Phase K with item 111, the fresh install or fresh checkout manual beta test script. At this checkpoint, Phase J item 109 still lacked a PR or draft-release upload target; it is resolved in the 2026-07-01 evidence upload entry below.

### 2026-07-01 - Phase K fresh checkout setup

Completed verified plan items: 111.

Evidence:

- `scripts/smoke-fresh-checkout-setup.ts` now provides a repeatable fresh-checkout style smoke for Phase K. It snapshots the current tracked plus unignored untracked source files into an isolated workspace while excluding generated/install artifacts such as `node_modules`, `dist`, `dist-server`, `release`, and `output`.
- `package.json` exposes the check as `npm run smoke:fresh-checkout`.
- `npm run smoke:fresh-checkout` passed against an isolated source snapshot with `3,414` copied files and `118,115,195` copied source bytes.
- Inside the isolated snapshot, the smoke passed `npm ci`, `npm run prepare:openclaw-vendor`, `npm run build:standalone`, and `npm run smoke:server-architecture`.
- Fresh-checkout evidence was written under `release/evidence/phase-k-manual-beta-2026-07-01/`, including command logs, `fresh-checkout-smoke.json`, and `FRESH_CHECKOUT_SMOKE.md`.
- The isolated workspace was removed after successful verification so installed dependencies and build outputs did not pollute the working repository.
- Additional verification passed: `npm run lint`, `npm run smoke:ci-workflow`, and `git diff --check`. `git diff --check` reported only the existing LF-to-CRLF working-copy warnings.

Phase K status:

- Item 111 is complete and verified.

Still open from Phase K:

- Items 112-130: launch desktop app, bootstrap session, provider setup, agent recruit/edit, command-console paths, missions, Monitor/Gateway recovery, plugin status, redacted errors, report inspection, and Settings persistence checks.

Phase J carry-forward:

- Item 109 was resolved after this Phase K setup pass by creating a draft prerelease target and uploading the staged beta evidence bundle. See `2026-07-01 - Phase J evidence bundle upload completion` below.

Next:

- Continue Phase K with item 112: launch the desktop app from the beta build/test environment, then proceed through the remaining manual beta script items in order.

### 2026-07-01 - Phase K desktop launch and session bootstrap

Completed verified plan items: 112 and 113.

Evidence:

- `electron/main.cjs` now has an E2E-only desktop-session bootstrap assertion that runs from the packaged renderer, invokes the narrow `window.dystopaiDesktop.bootstrapControlCenterSession()` preload bridge, verifies the returned session token against `/api/auth/status`, and logs only token length rather than token material.
- `scripts/smoke-phase-k-desktop-launch.ts` now launches `release/win-unpacked/DystopAI.exe` from the packaged production directory with isolated `user-data`, OpenClaw state, workspace root, and loopback-only ports.
- `package.json` exposes the check as `npm run smoke:phase-k-desktop-launch`.
- `scripts/smoke-auth-control-plane.ts` now pins the desktop bootstrap E2E hook and package script so the bridge coverage cannot silently disappear.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked` with the updated Electron main process, packaged app, launcher, Electron runtime, bundled OpenClaw resources, `app.asar`, `dist/index.html`, and `dist-server/index.cjs`.
- `npm run smoke:phase-k-desktop-launch` passed. It verified packaged app launch, Control Center readiness, packaged renderer load, navigation-policy self-test, desktop-session bootstrap bridge invocation, token acceptance by auth status, and quit cleanup. Evidence was written under `release/evidence/phase-k-manual-beta-2026-07-01/` as `05-desktop-launch-bootstrap.log`, `desktop-launch-bootstrap.json`, and `DESKTOP_LAUNCH_BOOTSTRAP.md`.
- `desktop-launch-bootstrap.json` recorded `completedItems: [112, 113]`, `mode: packaged-production-dir`, launcher path `release/win-unpacked/DystopAI.exe`, and a bootstrapped session token length of `43` without storing token material.
- Additional verification passed: `npm run typecheck:electron`, `npm run smoke:auth`, `npm run smoke:packaged-electron-launch`, `npm run smoke:electron-e2e`, `npm run typecheck`, `npm run lint`, `npm test`, and `git diff --check`.
- Full `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` reported only the existing LF-to-CRLF working-copy warnings already present in this worktree.

Phase K status:

- Items 111, 112, and 113 are complete and verified.

Still open from Phase K:

- Items 114-130: provider setup, agent recruit/edit, command-console paths, missions, Monitor/Gateway recovery, plugin status, redacted errors, report inspection, and Settings persistence checks.

Next:

- Continue Phase K with item 114: connect or configure one model provider, recording exact local evidence or a credentials blocker before continuing to the next unblocked manual beta item.

### 2026-07-01 - Phase J evidence bundle upload completion

Completed verified plan items: 109.

Evidence:

- Created a draft prerelease target in `hotboysupreme12-hash/DystopAI-Core`: `Phase J Beta Readiness Evidence (2026-06-30)` with tag `phase-j-beta-readiness-2026-06-30`.
- Rebuilt `release/phase-j-beta-readiness-2026-06-30-evidence.zip` after updating `release/evidence/phase-j-beta-readiness-2026-06-30/UPLOAD_STATUS.md` and `BETA_READINESS_SUMMARY.md` to reference the draft prerelease target instead of the earlier blocked state.
- Uploaded `phase-j-beta-readiness-2026-06-30-evidence.zip` to the draft prerelease.
- Verified the draft prerelease remains a draft/prerelease, targets commit `2ca947c3290c44cf53737fb63fc2411f772c452f`, and includes the uploaded asset with GitHub-reported digest `sha256:5da8bbc10e611eb737b5e3a0f3a9be15a5f93ffc9a73b01cfc79e5abf17cae5b`.
- Final local bundle SHA-256: `5DA8BBC10E611EB737B5E3A0F3A9BE15A5F93FFC9A73B01CFC79E5ABF17CAE5B`.
- Current draft release URL: `https://github.com/hotboysupreme12-hash/DystopAI-Core/releases/tag/untagged-ff25989c71a0efedb4d4`.

Phase J status:

- Items 96-110 are complete and verified for the private beta readiness milestone.

Next:

- Continue Phase K with item 117: send one simple command.

### 2026-07-01 - Phase K provider, recruit, and workspace edit

Completed verified plan items: 114, 115, and 116.

Evidence:

- `scripts/smoke-phase-k-provider-agent.ts` now launches the control plane with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and workspace roots, then signs in through `/api/auth/login`.
- `package.json` exposes the check as `npm run smoke:phase-k-provider-agent`.
- `scripts/smoke-auth-provider-model-control-plane.ts` pins the Phase K provider/agent smoke, its package script, the `/api/auth/providers` provider-status route, the `/api/party/recruit` route, the `/api/party/workspace` route, and the provider evidence redaction guard.
- `npm run smoke:phase-k-provider-agent` passed and wrote `release/evidence/phase-k-manual-beta-2026-07-01/provider-agent-smoke.json`, `PROVIDER_AGENT_SMOKE.md`, and `06-provider-agent-smoke.log`.
- The provider evidence recorded `completedItems: [114, 115, 116]`, no blocked items, and one configured model provider: `google-vertex` with boolean readiness only. The redacted snapshot stores provider IDs, labels, env key names, and configured/stored booleans; it does not store provider tokens, OAuth codes, API keys, or bearer values.
- The same smoke recruited `phase-k-beta-agent` through `/api/party/recruit`, edited its workspace through `/api/party/workspace`, and verified the edited workspace through both `/api/party/agent/:agentId/config` and `/api/party/overview`.
- Verification passed: `npm run smoke:phase-k-provider-agent`, `npm run smoke:auth-provider-model`, `npm run typecheck`, and `npm run lint`.

Phase K status:

- Items 111, 112, 113, 114, 115, and 116 are complete and verified.

Still open from Phase K:

- Items 117-130: simple command, command with attachment, instant/timed missions, cancellation, Monitor evidence, Gateway restart/stop/recovery, plugin status, missing-provider-auth path, redacted failed command, mission report inspection, and Settings persistence.

Next:

- Continue Phase K with item 117: send one simple command in isolated beta state, then item 118 for a command with attachment.
