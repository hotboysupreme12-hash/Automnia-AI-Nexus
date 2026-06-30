# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 17,960 |
| Control-plane bytes | 723,394 |
| Top-level imports | 62 |
| Top-level declarations | 1221 |
| Top-level functions | 834 |
| Inline Express route calls | 0 |
| Extracted route registrations | 17 |
| Imported route modules | 17 |
| Tracked API route contracts | 109 |
| Route modules with API endpoints | 17 |

## Composition Boundary

The executable `server/index.ts` is intentionally a small facade. Server startup, dependency wiring, and remaining legacy ownership live in `server/controlPlane.ts`; extracted HTTP domains live in `server/routes/*`; static catalog and integration assets live outside the executable module.

## Imported Route Modules

- `./routes/agentConfigRoutes`
- `./routes/agentTurnRoutes`
- `./routes/authRoutes`
- `./routes/browserRoutes`
- `./routes/clawTalkConsoleRoutes`
- `./routes/commandConsoleFileRoutes`
- `./routes/diagnosticsRoutes`
- `./routes/filesystemRoutes`
- `./routes/missionRoutes`
- `./routes/openclawCommandRoutes`
- `./routes/partyCoordinationRoutes`
- `./routes/partyManagementRoutes`
- `./routes/pluginRoutes`
- `./routes/providerAuthRoutes`
- `./routes/runtimeRoutes`
- `./routes/shiftRoutes`
- `./routes/skillRoutes`

## API Route Ownership

| Route module | API routes |
| --- | ---: |
| server/routes/pluginRoutes.ts | 16 |
| server/routes/partyManagementRoutes.ts | 11 |
| server/routes/filesystemRoutes.ts | 9 |
| server/routes/runtimeRoutes.ts | 9 |
| server/routes/shiftRoutes.ts | 9 |
| server/routes/skillRoutes.ts | 9 |
| server/routes/diagnosticsRoutes.ts | 7 |
| server/routes/missionRoutes.ts | 7 |
| server/routes/providerAuthRoutes.ts | 7 |
| server/routes/agentConfigRoutes.ts | 5 |
| server/routes/agentTurnRoutes.ts | 4 |
| server/routes/commandConsoleFileRoutes.ts | 4 |
| server/routes/partyCoordinationRoutes.ts | 4 |
| server/routes/authRoutes.ts | 3 |
| server/routes/clawTalkConsoleRoutes.ts | 2 |
| server/routes/openclawCommandRoutes.ts | 2 |
| server/routes/browserRoutes.ts | 1 |

The canonical method-and-path inventory lives in `server/routes/controlPlaneRouteInventory.json` and is enforced by `npm run smoke:route-inventory`.

## Route Registration Calls

| Registration | Line | Span |
| --- | ---: | ---: |
| registerDiagnosticsRoutes | 16184 | 21 |
| registerCommandConsoleFileRoutes | 16206 | 5 |
| registerOpenClawCommandRoutes | 16212 | 15 |
| registerRuntimeRoutes | 16286 | 6 |
| registerPluginRoutes | 16293 | 22 |
| registerPartyManagementRoutes | 16805 | 1 |
| registerFilesystemRoutes | 16807 | 26 |
| registerPartyCoordinationRoutes | 16834 | 44 |
| registerMissionRoutes | 16879 | 6 |
| registerAgentTurnRoutes | 17501 | 85 |
| registerClawTalkConsoleRoutes | 17587 | 24 |
| registerBrowserRoutes | 17613 | 1 |
| registerShiftRoutes | 17736 | 16 |
| registerProviderAuthRoutes | 17753 | 19 |
| registerSkillRoutes | 17773 | 14 |
| registerAgentConfigRoutes | 17868 | 1 |
| registerAuthRoutes | 17870 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 17217 | 17499 | 283 |
| function | runBufferedAgentTurnForStream | 16886 | 17082 | 197 |
| function | runDoctorChecks | 15982 | 16148 | 167 |
| function | doctorGuidedActionForFinding | 15485 | 15631 | 147 |
| type | OpenClawConfigFile | 1134 | 1271 | 138 |
| function | runGatewayAgentTurnForStream | 17084 | 17215 | 132 |
| function | generateRecruitAutoForgeMarkdown | 16523 | 16651 | 129 |
| function | buildDefaultAgentLocalConfig | 12980 | 13107 | 128 |
| function | checkBrowserPreflight | 7769 | 7894 | 126 |
| function | createShiftFromPayload | 17616 | 17734 | 119 |
| function | ensureOpenclawRuntimeDefaults | 8660 | 8774 | 115 |
| function | runControlCenterAgentRuntimeTurn | 13878 | 13989 | 112 |
| function | patchedClawTalkCoreBridgeSource | 9798 | 9907 | 110 |
| function | runOpenClaw | 5012 | 5117 | 106 |
| function | streamOpenAiResponsesCompletion | 5864 | 5947 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 14190 | 14272 | 83 |
| function | openAgentSessionSnapshots | 3709 | 3790 | 82 |
| function | defaultAgentResourceContent | 12272 | 12352 | 81 |
| function | generateGoogleVertexArtifactContent | 14033 | 14109 | 77 |
| function | startManagedTeamSyncOrchestrator | 15096 | 15170 | 75 |
| type | AgentLocalConfig | 1291 | 1364 | 74 |
| function | purgeAgentState | 12160 | 12231 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 13761 | 13831 | 71 |
| function | approveLocalDevicePairingRequest | 7341 | 7409 | 69 |
| function | inferWorkspaceRuntimeIntent | 6605 | 6672 | 68 |
| type | PartyManagementRoutesContext | 16667 | 16734 | 68 |
| variable | partyManagementRoutesContext | 16736 | 16803 | 68 |
| function | inspectOpenClawSessionLock | 4603 | 4669 | 67 |
| function | streamGoogleVertexContent | 6393 | 6459 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 11150 | 11216 | 67 |
| function | repairCodexPluginPostInstallState | 10757 | 10822 | 66 |
| function | seedAgentWorkspace | 13337 | 13401 | 65 |
| function | repairGatewayTokenConfigSync | 1977 | 2040 | 64 |
| function | cleanupOpenClawSessionLocks | 4751 | 4814 | 64 |
| function | extractAgentReply | 6986 | 7049 | 64 |
| function | tryReleaseTcpPortUnix | 7600 | 7663 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 11017 | 11080 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3045 | 3107 | 63 |
| function | resolveSharedTeamSyncPath | 13440 | 13502 | 63 |
| function | applyGoogleGeminiPluginPolicy | 13697 | 13759 | 63 |
| function | patchedTelegramBotRuntimeSource | 9925 | 9986 | 62 |
| function | getPartyMembers | 15172 | 15231 | 60 |
| function | recruitAutoForgePrompt | 16430 | 16489 | 60 |
| function | buildMissionPrompt | 13277 | 13335 | 59 |
| function | streamGeminiContent | 6160 | 6217 | 58 |
| function | runBrowserToolProbe | 7711 | 7767 | 57 |
| function | writeOpenclawConfig | 9018 | 9073 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6497 | 6551 | 55 |
| function | tryReleaseGatewayPort | 7544 | 7598 | 55 |
| function | tryReleaseBrowserRelayPort | 7489 | 7542 | 54 |
| function | readOpenclawConfig | 8259 | 8312 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 10836 | 10889 | 54 |
| function | requestGatewaySessionAbort | 2621 | 2672 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 10164 | 10215 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6063 | 6113 | 51 |
| function | resolveFilenameHintsForMessage | 14397 | 14447 | 51 |
| function | listActiveCronJobsFromStateDb | 14883 | 14933 | 51 |
| function | recruitPersonalityDepthGuidance | 16353 | 16403 | 51 |
| function | inspectOpenClawSessionLocks | 4700 | 4749 | 50 |
| function | savePluginDirectConfig | 10644 | 10693 | 50 |
| function | syncAgentDerivedFiles | 12682 | 12731 | 50 |
| function | composeAgentDoctrinePrompt | 12733 | 12782 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 14979 | 15027 | 49 |
| function | readSkillEntryFromDir | 11475 | 11522 | 48 |
| function | appendAgentPromptDump | 12800 | 12847 | 48 |
| function | createInitialOpenclawConfig | 8161 | 8207 | 47 |
| function | ensureClawTalkManifestContracts | 9687 | 9733 | 47 |
| function | normalizeModelWithFallback | 12519 | 12565 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 14706 | 14752 | 47 |
| variable | gatewayLifecycle | 3556 | 3601 | 46 |
| function | streamOpenAiCompatibleCompletion | 5817 | 5862 | 46 |
| function | tryStartBrowserRelay | 7442 | 7487 | 46 |
| function | openClawOptimizationStatus | 8114 | 8159 | 46 |
| function | openClawDoctorLintCheck | 15935 | 15980 | 46 |
| function | terminateProcessTree | 932 | 976 | 45 |
| function | checkGoogleVertexModelAvailability | 6272 | 6316 | 45 |
| function | syncDoctrineToWorkspace | 13547 | 13591 | 45 |
| function | streamAnthropicMessage | 6115 | 6158 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 8853 | 8896 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1431 | 1473 | 43 |
| function | normalizeOpenClawConfigModelRefs | 8616 | 8658 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 11654 | 11696 | 43 |
| function | applyLocalConfigToGlobal | 13144 | 13186 | 43 |
| function | spawnText | 3371 | 3412 | 42 |
| function | contentTypeFromExt | 4016 | 4057 | 42 |
| function | toOpenAICodexContext | 6001 | 6042 | 42 |
| function | firstJsonSliceFromText | 10305 | 10346 | 42 |
| function | seedCanonicalResourceIfMissing | 11889 | 11930 | 42 |
| function | buildDoctrineSyncReport | 14285 | 14326 | 42 |
| function | persistAgentAvatarFromPath | 6856 | 6896 | 41 |
| function | launchChromeHost | 6898 | 6938 | 41 |
| function | splitPluginCommandLine | 10441 | 10481 | 41 |
| variable | runtimeStatusService | 3650 | 3689 | 40 |
| function | appendGoogleVertexPayloadDump | 12849 | 12887 | 39 |
| type | AgentConfigRoutesContext | 17788 | 17826 | 39 |
| variable | agentConfigRoutesContext | 17828 | 17866 | 39 |
| function | prepareOpenClawConfigForGatewayStartup | 3489 | 3526 | 38 |
| function | bufferedAgentRuntimeReason | 6674 | 6711 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 14754 | 14791 | 38 |
| function | buildAgentRuntimePreflightChecks | 4953 | 4989 | 37 |
| function | persistAgentAvatarBytes | 6818 | 6854 | 37 |
| function | normalizePluginSearchResult | 10377 | 10413 | 37 |
| variable | STREAMING_PROVIDER_CONFIG | 5224 | 5259 | 36 |
| function | ensureClawTalkApiKeyMaterial | 9328 | 9363 | 36 |
| function | saveClawTalkSetupConfig | 11281 | 11316 | 36 |
| function | normalizeAgentToolsConfig | 4357 | 4391 | 35 |
| function | parseSkillFrontmatter | 11413 | 11447 | 35 |
| variable | runtimeRecoveryService | 16228 | 16262 | 35 |
| function | clearDisallowedAutoModelOverridesForAgent | 3109 | 3142 | 34 |
| function | isClawTalkIntentMessage | 7088 | 7121 | 34 |
| function | migrateLegacyOpenAiCodexProviderConfig | 8407 | 8440 | 34 |
| function | applyDeepSeekOnlyRuntimeDefaults | 8524 | 8557 | 34 |
| function | resolveAgentResourceContext | 11937 | 11970 | 34 |
| function | syncAllAgentLocalConfigs | 13242 | 13275 | 34 |
| function | cronRowToRuntimeCronJob | 14848 | 14881 | 34 |
| function | finishOpenClawRun | 2897 | 2929 | 33 |
| function | closeControlServerForShutdown | 3939 | 3971 | 33 |
| function | normalizeAgentMdsState | 4176 | 4208 | 33 |
| function | ensureAgentSandboxCompatibleWithHost | 13208 | 13240 | 33 |
| function | looksLikeGeneratedWorkspaceDoctrineContent | 14147 | 14179 | 33 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 17217 | 17499 | 283 |
| runBufferedAgentTurnForStream | 16886 | 17082 | 197 |
| runDoctorChecks | 15982 | 16148 | 167 |
| doctorGuidedActionForFinding | 15485 | 15631 | 147 |
| runGatewayAgentTurnForStream | 17084 | 17215 | 132 |
| generateRecruitAutoForgeMarkdown | 16523 | 16651 | 129 |
| buildDefaultAgentLocalConfig | 12980 | 13107 | 128 |
| checkBrowserPreflight | 7769 | 7894 | 126 |
| createShiftFromPayload | 17616 | 17734 | 119 |
| ensureOpenclawRuntimeDefaults | 8660 | 8774 | 115 |
| runControlCenterAgentRuntimeTurn | 13878 | 13989 | 112 |
| patchedClawTalkCoreBridgeSource | 9798 | 9907 | 110 |
| runOpenClaw | 5012 | 5117 | 106 |
| streamOpenAiResponsesCompletion | 5864 | 5947 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 14190 | 14272 | 83 |
| openAgentSessionSnapshots | 3709 | 3790 | 82 |
| defaultAgentResourceContent | 12272 | 12352 | 81 |
| generateGoogleVertexArtifactContent | 14033 | 14109 | 77 |
| startManagedTeamSyncOrchestrator | 15096 | 15170 | 75 |
| purgeAgentState | 12160 | 12231 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 13761 | 13831 | 71 |
| approveLocalDevicePairingRequest | 7341 | 7409 | 69 |
| inferWorkspaceRuntimeIntent | 6605 | 6672 | 68 |
| inspectOpenClawSessionLock | 4603 | 4669 | 67 |
| streamGoogleVertexContent | 6393 | 6459 | 67 |
| applyOpenClawPluginEnabledToConfig | 11150 | 11216 | 67 |
| repairCodexPluginPostInstallState | 10757 | 10822 | 66 |
| seedAgentWorkspace | 13337 | 13401 | 65 |
| repairGatewayTokenConfigSync | 1977 | 2040 | 64 |
| cleanupOpenClawSessionLocks | 4751 | 4814 | 64 |
| extractAgentReply | 6986 | 7049 | 64 |
| tryReleaseTcpPortUnix | 7600 | 7663 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 11017 | 11080 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3045 | 3107 | 63 |
| resolveSharedTeamSyncPath | 13440 | 13502 | 63 |
| applyGoogleGeminiPluginPolicy | 13697 | 13759 | 63 |
| patchedTelegramBotRuntimeSource | 9925 | 9986 | 62 |
| getPartyMembers | 15172 | 15231 | 60 |
| recruitAutoForgePrompt | 16430 | 16489 | 60 |
| buildMissionPrompt | 13277 | 13335 | 59 |
| streamGeminiContent | 6160 | 6217 | 58 |
| runBrowserToolProbe | 7711 | 7767 | 57 |
| writeOpenclawConfig | 9018 | 9073 | 56 |
| postLocalJsonNoHeaderTimeout | 6497 | 6551 | 55 |
| tryReleaseGatewayPort | 7544 | 7598 | 55 |
| tryReleaseBrowserRelayPort | 7489 | 7542 | 54 |
| readOpenclawConfig | 8259 | 8312 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 10836 | 10889 | 54 |
| requestGatewaySessionAbort | 2621 | 2672 | 52 |
| ensureClawTalkBundledPluginDefaults | 10164 | 10215 | 52 |
| streamOpenAICodexResponsesCompletion | 6063 | 6113 | 51 |
| resolveFilenameHintsForMessage | 14397 | 14447 | 51 |
| listActiveCronJobsFromStateDb | 14883 | 14933 | 51 |
| recruitPersonalityDepthGuidance | 16353 | 16403 | 51 |
| inspectOpenClawSessionLocks | 4700 | 4749 | 50 |
| savePluginDirectConfig | 10644 | 10693 | 50 |
| syncAgentDerivedFiles | 12682 | 12731 | 50 |
| composeAgentDoctrinePrompt | 12733 | 12782 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 14979 | 15027 | 49 |
| readSkillEntryFromDir | 11475 | 11522 | 48 |
| appendAgentPromptDump | 12800 | 12847 | 48 |
| createInitialOpenclawConfig | 8161 | 8207 | 47 |
| ensureClawTalkManifestContracts | 9687 | 9733 | 47 |
| normalizeModelWithFallback | 12519 | 12565 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 14706 | 14752 | 47 |
| streamOpenAiCompatibleCompletion | 5817 | 5862 | 46 |
| tryStartBrowserRelay | 7442 | 7487 | 46 |
| openClawOptimizationStatus | 8114 | 8159 | 46 |
| openClawDoctorLintCheck | 15935 | 15980 | 46 |
| terminateProcessTree | 932 | 976 | 45 |
| checkGoogleVertexModelAvailability | 6272 | 6316 | 45 |
| syncDoctrineToWorkspace | 13547 | 13591 | 45 |
| streamAnthropicMessage | 6115 | 6158 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 8853 | 8896 | 44 |
| normalizeOpenClawConfigModelRefs | 8616 | 8658 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 11654 | 11696 | 43 |
| applyLocalConfigToGlobal | 13144 | 13186 | 43 |
| spawnText | 3371 | 3412 | 42 |
| contentTypeFromExt | 4016 | 4057 | 42 |
| toOpenAICodexContext | 6001 | 6042 | 42 |
| firstJsonSliceFromText | 10305 | 10346 | 42 |
| seedCanonicalResourceIfMissing | 11889 | 11930 | 42 |
| buildDoctrineSyncReport | 14285 | 14326 | 42 |
| persistAgentAvatarFromPath | 6856 | 6896 | 41 |
| launchChromeHost | 6898 | 6938 | 41 |
| splitPluginCommandLine | 10441 | 10481 | 41 |
| appendGoogleVertexPayloadDump | 12849 | 12887 | 39 |
| prepareOpenClawConfigForGatewayStartup | 3489 | 3526 | 38 |
| bufferedAgentRuntimeReason | 6674 | 6711 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 14754 | 14791 | 38 |
| buildAgentRuntimePreflightChecks | 4953 | 4989 | 37 |
| persistAgentAvatarBytes | 6818 | 6854 | 37 |
| normalizePluginSearchResult | 10377 | 10413 | 37 |
| ensureClawTalkApiKeyMaterial | 9328 | 9363 | 36 |
| saveClawTalkSetupConfig | 11281 | 11316 | 36 |
| normalizeAgentToolsConfig | 4357 | 4391 | 35 |
| parseSkillFrontmatter | 11413 | 11447 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3109 | 3142 | 34 |
| isClawTalkIntentMessage | 7088 | 7121 | 34 |
| migrateLegacyOpenAiCodexProviderConfig | 8407 | 8440 | 34 |
| applyDeepSeekOnlyRuntimeDefaults | 8524 | 8557 | 34 |
| resolveAgentResourceContext | 11937 | 11970 | 34 |
| syncAllAgentLocalConfigs | 13242 | 13275 | 34 |
| cronRowToRuntimeCronJob | 14848 | 14881 | 34 |
| finishOpenClawRun | 2897 | 2929 | 33 |
| closeControlServerForShutdown | 3939 | 3971 | 33 |
| normalizeAgentMdsState | 4176 | 4208 | 33 |
| ensureAgentSandboxCompatibleWithHost | 13208 | 13240 | 33 |
| looksLikeGeneratedWorkspaceDoctrineContent | 14147 | 14179 | 33 |
| authDoctorCheck | 15822 | 15854 | 33 |
| runDoctorRepair | 16150 | 16182 | 33 |
| pluginRuntimeCheck | 4920 | 4951 | 32 |
| compactHttpJsonPayload | 5399 | 5430 | 32 |
| buildDispatchExecutionDirective | 12889 | 12920 | 32 |
| defaultDoctorFindingRepairAction | 15423 | 15454 | 32 |
| handleControlCenterShutdown | 3973 | 4003 | 31 |
| readUpstreamSse | 5571 | 5601 | 31 |
| filterGoogleVertexCatalogModels | 6361 | 6391 | 31 |
| ensureEnabledManagedPluginLoadPaths | 9555 | 9585 | 31 |
| recoverLocalAgentEntries | 12487 | 12517 | 31 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 16736 | 16803 | 68 |
| gatewayLifecycle | 3556 | 3601 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1431 | 1473 | 43 |
| runtimeStatusService | 3650 | 3689 | 40 |
| agentConfigRoutesContext | 17828 | 17866 | 39 |
| STREAMING_PROVIDER_CONFIG | 5224 | 5259 | 36 |
| runtimeRecoveryService | 16228 | 16262 | 35 |
| missionSchedulerService | 2239 | 2270 | 32 |
| providerAuthService | 1744 | 1773 | 30 |
| missionRecoveryService | 2310 | 2334 | 25 |
| gatewayChatService | 3296 | 3320 | 25 |
| providerSetupService | 1710 | 1733 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 394 | 416 | 23 |
| runtimeActionService | 16264 | 16284 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 1809 | 1828 | 20 |
| missionStateService | 2212 | 2231 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6553 | 6572 | 20 |
| AGENT_RESOURCE_FILES | 332 | 346 | 15 |
| oauthCallbackService | 1785 | 1799 | 15 |
| gatewayLogService | 3233 | 3246 | 14 |
| RESOURCE_SEED_FILES | 347 | 358 | 12 |
| missionTeamSyncService | 2197 | 2208 | 12 |
| modelCatalogService | 1689 | 1699 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 16322 | 16332 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 13636 | 13645 | 10 |
| DEFAULT_HEARTBEAT_RUNTIME | 8898 | 8906 | 9 |
| missionReportService | 2186 | 2193 | 8 |
| gatewayDiagnostics | 3528 | 3534 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 12067 | 12073 | 7 |
| loginAttempts | 178 | 183 | 6 |
| pickerSessionService | 324 | 329 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 12922 | 12927 | 6 |
| OPENCLAW_STATE_ROOT | 233 | 237 | 5 |
| OPENCLAW_CONFIG_PATH | 239 | 243 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 244 | 248 | 5 |
| commandConsoleUploadService | 319 | 323 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1478 | 1482 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1497 | 1501 | 5 |
| STATIC_ROOT | 17872 | 17876 | 5 |
| sessionTokens | 174 | 177 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 272 | 275 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1485 | 1488 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1489 | 1492 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1493 | 1496 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3171 | 3174 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3175 | 3178 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3179 | 3182 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3183 | 3186 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3187 | 3190 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3191 | 3194 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3195 | 3198 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3199 | 3202 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 15368 | 15371 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 365 | 367 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 368 | 370 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 371 | 373 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 374 | 376 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 378 | 380 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 381 | 383 | 3 |
| AUTO_START_GATEWAY | 384 | 386 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 418 | 420 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1047 | 1049 | 3 |
| EDITOR_RESOURCE_FILES | 1368 | 1370 | 3 |
| installOpenClawPlugin | 517 | 518 | 2 |
| updateOpenClawPlugin | 520 | 521 | 2 |
| updateAllOpenClawPlugins | 523 | 524 | 2 |
| uninstallOpenClawPlugin | 526 | 527 | 2 |
| setupClawTalkPlugin | 534 | 535 | 2 |
| inspectOpenClawPluginRuntime | 542 | 543 | 2 |
| pluginRuntimeInspectReady | 545 | 546 | 2 |
| stopAllPluginSetupTerminalSessions | 548 | 549 | 2 |
| ensureConfiguredModelAllowlist | 1701 | 1702 | 2 |
| ensureOpenRouterModelCatalogAllowlist | 1703 | 1704 | 2 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 6940 | 6941 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 6943 | 6944 | 2 |
| app | 168 | 168 | 1 |
| PORT | 170 | 170 | 1 |
| CONFIGURED_AUTH_TOKEN | 171 | 171 | 1 |
| AUTH_TOKEN | 172 | 172 | 1 |
| AUTH_TOKEN_SOURCE | 173 | 173 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
