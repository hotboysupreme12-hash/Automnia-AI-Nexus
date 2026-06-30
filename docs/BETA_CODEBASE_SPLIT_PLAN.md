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
