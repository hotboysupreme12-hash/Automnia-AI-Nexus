# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 17,476 |
| Control-plane bytes | 704,336 |
| Top-level imports | 68 |
| Top-level declarations | 1246 |
| Top-level functions | 843 |
| Inline Express route calls | 0 |
| Extracted route registrations | 17 |
| Imported route modules | 17 |
| Tracked API route contracts | 111 |
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
| server/routes/partyManagementRoutes.ts | 13 |
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
| registerDiagnosticsRoutes | 16170 | 21 |
| registerCommandConsoleFileRoutes | 16192 | 5 |
| registerOpenClawCommandRoutes | 16198 | 15 |
| registerRuntimeRoutes | 16272 | 6 |
| registerPluginRoutes | 16279 | 22 |
| registerPartyManagementRoutes | 16809 | 1 |
| registerFilesystemRoutes | 16811 | 28 |
| registerPartyCoordinationRoutes | 16840 | 44 |
| registerMissionRoutes | 16885 | 6 |
| registerAgentTurnRoutes | 17015 | 85 |
| registerClawTalkConsoleRoutes | 17101 | 24 |
| registerBrowserRoutes | 17127 | 1 |
| registerShiftRoutes | 17250 | 16 |
| registerProviderAuthRoutes | 17267 | 19 |
| registerSkillRoutes | 17287 | 14 |
| registerAgentConfigRoutes | 17384 | 1 |
| registerAuthRoutes | 17386 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | runDoctorChecks | 15968 | 16134 | 167 |
| function | doctorGuidedActionForFinding | 15471 | 15617 | 147 |
| type | OpenClawConfigFile | 1249 | 1386 | 138 |
| function | generateRecruitAutoForgeMarkdown | 16509 | 16637 | 129 |
| function | buildDefaultAgentLocalConfig | 13085 | 13212 | 128 |
| function | createShiftFromPayload | 17130 | 17248 | 119 |
| function | ensureOpenclawRuntimeDefaults | 8714 | 8828 | 115 |
| function | patchedClawTalkCoreBridgeSource | 9863 | 9972 | 110 |
| function | runOpenClaw | 5155 | 5260 | 106 |
| function | streamOpenAiResponsesCompletion | 6007 | 6090 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 14176 | 14258 | 83 |
| function | openAgentSessionSnapshots | 3832 | 3913 | 82 |
| function | defaultAgentResourceContent | 12361 | 12441 | 81 |
| function | generateGoogleVertexArtifactContent | 14019 | 14095 | 77 |
| type | PartyManagementRoutesContext | 16653 | 16729 | 77 |
| variable | partyManagementRoutesContext | 16731 | 16807 | 77 |
| function | startManagedTeamSyncOrchestrator | 15082 | 15156 | 75 |
| type | AgentLocalConfig | 1406 | 1479 | 74 |
| function | purgeAgentState | 12249 | 12320 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 13866 | 13936 | 71 |
| function | approveLocalDevicePairingRequest | 7486 | 7554 | 69 |
| function | inferWorkspaceRuntimeIntent | 6748 | 6815 | 68 |
| function | inspectOpenClawSessionLock | 4746 | 4812 | 67 |
| function | streamGoogleVertexContent | 6536 | 6602 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 11215 | 11281 | 67 |
| function | readOpenclawConfig | 8301 | 8366 | 66 |
| function | repairCodexPluginPostInstallState | 10822 | 10887 | 66 |
| function | syncAgentDerivedFiles | 12771 | 12836 | 66 |
| function | seedAgentWorkspace | 13442 | 13506 | 65 |
| function | repairGatewayTokenConfigSync | 2077 | 2140 | 64 |
| function | cleanupOpenClawSessionLocks | 4894 | 4957 | 64 |
| function | extractAgentReply | 7131 | 7194 | 64 |
| function | tryReleaseTcpPortUnix | 7745 | 7808 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 11082 | 11145 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3149 | 3211 | 63 |
| function | resolveSharedTeamSyncPath | 13545 | 13607 | 63 |
| function | applyGoogleGeminiPluginPolicy | 13802 | 13864 | 63 |
| function | patchedTelegramBotRuntimeSource | 9990 | 10051 | 62 |
| function | getPartyMembers | 15158 | 15217 | 60 |
| function | recruitAutoForgePrompt | 16416 | 16475 | 60 |
| function | buildMissionPrompt | 13382 | 13440 | 59 |
| function | streamGeminiContent | 6303 | 6360 | 58 |
| function | runBrowserToolProbe | 7856 | 7912 | 57 |
| function | writeOpenclawConfig | 9072 | 9127 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6640 | 6694 | 55 |
| function | tryReleaseGatewayPort | 7689 | 7743 | 55 |
| function | tryReleaseBrowserRelayPort | 7634 | 7687 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 10901 | 10954 | 54 |
| function | requestGatewaySessionAbort | 2725 | 2776 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 10229 | 10280 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6206 | 6256 | 51 |
| function | resolveFilenameHintsForMessage | 14383 | 14433 | 51 |
| function | listActiveCronJobsFromStateDb | 14869 | 14919 | 51 |
| function | recruitPersonalityDepthGuidance | 16339 | 16389 | 51 |
| function | inspectOpenClawSessionLocks | 4843 | 4892 | 50 |
| function | savePluginDirectConfig | 10709 | 10758 | 50 |
| function | composeAgentDoctrinePrompt | 12838 | 12887 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 14965 | 15013 | 49 |
| function | readSkillEntryFromDir | 11540 | 11587 | 48 |
| function | appendAgentPromptDump | 12905 | 12952 | 48 |
| function | createInitialOpenclawConfig | 8203 | 8249 | 47 |
| function | ensureClawTalkManifestContracts | 9752 | 9798 | 47 |
| function | normalizeModelWithFallback | 12608 | 12654 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 14692 | 14738 | 47 |
| variable | gatewayLifecycle | 3679 | 3724 | 46 |
| function | streamOpenAiCompatibleCompletion | 5960 | 6005 | 46 |
| function | tryStartBrowserRelay | 7587 | 7632 | 46 |
| function | openClawOptimizationStatus | 8156 | 8201 | 46 |
| function | openClawDoctorLintCheck | 15921 | 15966 | 46 |
| function | terminateProcessTree | 1047 | 1091 | 45 |
| function | checkGoogleVertexModelAvailability | 6415 | 6459 | 45 |
| function | syncDoctrineToWorkspace | 13652 | 13696 | 45 |
| function | streamAnthropicMessage | 6258 | 6301 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 8907 | 8950 | 44 |
| variable | agentStreamingService | 16968 | 17011 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1546 | 1588 | 43 |
| function | normalizeOpenClawConfigModelRefs | 8670 | 8712 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 11719 | 11761 | 43 |
| function | applyLocalConfigToGlobal | 13249 | 13291 | 43 |
| function | spawnText | 3477 | 3518 | 42 |
| function | contentTypeFromExt | 4159 | 4200 | 42 |
| function | toOpenAICodexContext | 6144 | 6185 | 42 |
| function | persistAgentAvatarFromPath | 7000 | 7041 | 42 |
| function | firstJsonSliceFromText | 10370 | 10411 | 42 |
| function | seedCanonicalResourceIfMissing | 11956 | 11997 | 42 |
| function | buildDoctrineSyncReport | 14271 | 14312 | 42 |
| function | prepareOpenClawConfigForGatewayStartup | 3609 | 3649 | 41 |
| function | launchChromeHost | 7043 | 7083 | 41 |
| function | splitPluginCommandLine | 10506 | 10546 | 41 |
| variable | runtimeStatusService | 3773 | 3812 | 40 |
| type | AgentConfigRoutesContext | 17302 | 17341 | 40 |
| variable | agentConfigRoutesContext | 17343 | 17382 | 40 |
| function | appendGoogleVertexPayloadDump | 12954 | 12992 | 39 |
| function | bufferedAgentRuntimeReason | 6817 | 6854 | 38 |
| function | persistAgentAvatarBytes | 6961 | 6998 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 14740 | 14777 | 38 |
| variable | gatewayAgentTurnService | 16892 | 16929 | 38 |
| function | buildAgentRuntimePreflightChecks | 5096 | 5132 | 37 |
| function | normalizePluginSearchResult | 10442 | 10478 | 37 |
| function | handleControlCenterShutdown | 4096 | 4131 | 36 |
| variable | STREAMING_PROVIDER_CONFIG | 5367 | 5402 | 36 |
| function | ensureGatewayStartupPluginDefaults | 9151 | 9186 | 36 |
| function | ensureClawTalkApiKeyMaterial | 9393 | 9428 | 36 |
| function | saveClawTalkSetupConfig | 11346 | 11381 | 36 |
| function | normalizeAgentToolsConfig | 4500 | 4534 | 35 |
| function | parseSkillFrontmatter | 11478 | 11512 | 35 |
| variable | runtimeRecoveryService | 16214 | 16248 | 35 |
| function | clearDisallowedAutoModelOverridesForAgent | 3213 | 3246 | 34 |
| function | isClawTalkIntentMessage | 7233 | 7266 | 34 |
| function | migrateLegacyOpenAiCodexProviderConfig | 8461 | 8494 | 34 |
| function | applyDeepSeekOnlyRuntimeDefaults | 8578 | 8611 | 34 |
| function | resolveAgentResourceContext | 12004 | 12037 | 34 |
| function | syncAllAgentLocalConfigs | 13347 | 13380 | 34 |
| function | cronRowToRuntimeCronJob | 14834 | 14867 | 34 |
| function | finishOpenClawRun | 3001 | 3033 | 33 |
| function | closeControlServerForShutdown | 4062 | 4094 | 33 |
| function | normalizeAgentMdsState | 4319 | 4351 | 33 |
| function | ensureAgentSandboxCompatibleWithHost | 13313 | 13345 | 33 |
| function | looksLikeGeneratedWorkspaceDoctrineContent | 14133 | 14165 | 33 |
| function | authDoctorCheck | 15808 | 15840 | 33 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| runDoctorChecks | 15968 | 16134 | 167 |
| doctorGuidedActionForFinding | 15471 | 15617 | 147 |
| generateRecruitAutoForgeMarkdown | 16509 | 16637 | 129 |
| buildDefaultAgentLocalConfig | 13085 | 13212 | 128 |
| createShiftFromPayload | 17130 | 17248 | 119 |
| ensureOpenclawRuntimeDefaults | 8714 | 8828 | 115 |
| patchedClawTalkCoreBridgeSource | 9863 | 9972 | 110 |
| runOpenClaw | 5155 | 5260 | 106 |
| streamOpenAiResponsesCompletion | 6007 | 6090 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 14176 | 14258 | 83 |
| openAgentSessionSnapshots | 3832 | 3913 | 82 |
| defaultAgentResourceContent | 12361 | 12441 | 81 |
| generateGoogleVertexArtifactContent | 14019 | 14095 | 77 |
| startManagedTeamSyncOrchestrator | 15082 | 15156 | 75 |
| purgeAgentState | 12249 | 12320 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 13866 | 13936 | 71 |
| approveLocalDevicePairingRequest | 7486 | 7554 | 69 |
| inferWorkspaceRuntimeIntent | 6748 | 6815 | 68 |
| inspectOpenClawSessionLock | 4746 | 4812 | 67 |
| streamGoogleVertexContent | 6536 | 6602 | 67 |
| applyOpenClawPluginEnabledToConfig | 11215 | 11281 | 67 |
| readOpenclawConfig | 8301 | 8366 | 66 |
| repairCodexPluginPostInstallState | 10822 | 10887 | 66 |
| syncAgentDerivedFiles | 12771 | 12836 | 66 |
| seedAgentWorkspace | 13442 | 13506 | 65 |
| repairGatewayTokenConfigSync | 2077 | 2140 | 64 |
| cleanupOpenClawSessionLocks | 4894 | 4957 | 64 |
| extractAgentReply | 7131 | 7194 | 64 |
| tryReleaseTcpPortUnix | 7745 | 7808 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 11082 | 11145 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3149 | 3211 | 63 |
| resolveSharedTeamSyncPath | 13545 | 13607 | 63 |
| applyGoogleGeminiPluginPolicy | 13802 | 13864 | 63 |
| patchedTelegramBotRuntimeSource | 9990 | 10051 | 62 |
| getPartyMembers | 15158 | 15217 | 60 |
| recruitAutoForgePrompt | 16416 | 16475 | 60 |
| buildMissionPrompt | 13382 | 13440 | 59 |
| streamGeminiContent | 6303 | 6360 | 58 |
| runBrowserToolProbe | 7856 | 7912 | 57 |
| writeOpenclawConfig | 9072 | 9127 | 56 |
| postLocalJsonNoHeaderTimeout | 6640 | 6694 | 55 |
| tryReleaseGatewayPort | 7689 | 7743 | 55 |
| tryReleaseBrowserRelayPort | 7634 | 7687 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 10901 | 10954 | 54 |
| requestGatewaySessionAbort | 2725 | 2776 | 52 |
| ensureClawTalkBundledPluginDefaults | 10229 | 10280 | 52 |
| streamOpenAICodexResponsesCompletion | 6206 | 6256 | 51 |
| resolveFilenameHintsForMessage | 14383 | 14433 | 51 |
| listActiveCronJobsFromStateDb | 14869 | 14919 | 51 |
| recruitPersonalityDepthGuidance | 16339 | 16389 | 51 |
| inspectOpenClawSessionLocks | 4843 | 4892 | 50 |
| savePluginDirectConfig | 10709 | 10758 | 50 |
| composeAgentDoctrinePrompt | 12838 | 12887 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 14965 | 15013 | 49 |
| readSkillEntryFromDir | 11540 | 11587 | 48 |
| appendAgentPromptDump | 12905 | 12952 | 48 |
| createInitialOpenclawConfig | 8203 | 8249 | 47 |
| ensureClawTalkManifestContracts | 9752 | 9798 | 47 |
| normalizeModelWithFallback | 12608 | 12654 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 14692 | 14738 | 47 |
| streamOpenAiCompatibleCompletion | 5960 | 6005 | 46 |
| tryStartBrowserRelay | 7587 | 7632 | 46 |
| openClawOptimizationStatus | 8156 | 8201 | 46 |
| openClawDoctorLintCheck | 15921 | 15966 | 46 |
| terminateProcessTree | 1047 | 1091 | 45 |
| checkGoogleVertexModelAvailability | 6415 | 6459 | 45 |
| syncDoctrineToWorkspace | 13652 | 13696 | 45 |
| streamAnthropicMessage | 6258 | 6301 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 8907 | 8950 | 44 |
| normalizeOpenClawConfigModelRefs | 8670 | 8712 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 11719 | 11761 | 43 |
| applyLocalConfigToGlobal | 13249 | 13291 | 43 |
| spawnText | 3477 | 3518 | 42 |
| contentTypeFromExt | 4159 | 4200 | 42 |
| toOpenAICodexContext | 6144 | 6185 | 42 |
| persistAgentAvatarFromPath | 7000 | 7041 | 42 |
| firstJsonSliceFromText | 10370 | 10411 | 42 |
| seedCanonicalResourceIfMissing | 11956 | 11997 | 42 |
| buildDoctrineSyncReport | 14271 | 14312 | 42 |
| prepareOpenClawConfigForGatewayStartup | 3609 | 3649 | 41 |
| launchChromeHost | 7043 | 7083 | 41 |
| splitPluginCommandLine | 10506 | 10546 | 41 |
| appendGoogleVertexPayloadDump | 12954 | 12992 | 39 |
| bufferedAgentRuntimeReason | 6817 | 6854 | 38 |
| persistAgentAvatarBytes | 6961 | 6998 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 14740 | 14777 | 38 |
| buildAgentRuntimePreflightChecks | 5096 | 5132 | 37 |
| normalizePluginSearchResult | 10442 | 10478 | 37 |
| handleControlCenterShutdown | 4096 | 4131 | 36 |
| ensureGatewayStartupPluginDefaults | 9151 | 9186 | 36 |
| ensureClawTalkApiKeyMaterial | 9393 | 9428 | 36 |
| saveClawTalkSetupConfig | 11346 | 11381 | 36 |
| normalizeAgentToolsConfig | 4500 | 4534 | 35 |
| parseSkillFrontmatter | 11478 | 11512 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3213 | 3246 | 34 |
| isClawTalkIntentMessage | 7233 | 7266 | 34 |
| migrateLegacyOpenAiCodexProviderConfig | 8461 | 8494 | 34 |
| applyDeepSeekOnlyRuntimeDefaults | 8578 | 8611 | 34 |
| resolveAgentResourceContext | 12004 | 12037 | 34 |
| syncAllAgentLocalConfigs | 13347 | 13380 | 34 |
| cronRowToRuntimeCronJob | 14834 | 14867 | 34 |
| finishOpenClawRun | 3001 | 3033 | 33 |
| closeControlServerForShutdown | 4062 | 4094 | 33 |
| normalizeAgentMdsState | 4319 | 4351 | 33 |
| ensureAgentSandboxCompatibleWithHost | 13313 | 13345 | 33 |
| looksLikeGeneratedWorkspaceDoctrineContent | 14133 | 14165 | 33 |
| authDoctorCheck | 15808 | 15840 | 33 |
| runDoctorRepair | 16136 | 16168 | 33 |
| pluginRuntimeCheck | 5063 | 5094 | 32 |
| compactHttpJsonPayload | 5542 | 5573 | 32 |
| buildDispatchExecutionDirective | 12994 | 13025 | 32 |
| defaultDoctorFindingRepairAction | 15409 | 15440 | 32 |
| readUpstreamSse | 5714 | 5744 | 31 |
| filterGoogleVertexCatalogModels | 6504 | 6534 | 31 |
| ensureEnabledManagedPluginLoadPaths | 9620 | 9650 | 31 |
| recoverLocalAgentEntries | 12576 | 12606 | 31 |
| compactGoogleGeminiArtifactTask | 12728 | 12758 | 31 |
| collectWorkspaceFiles | 14351 | 14381 | 31 |
| normalizeRecruitAutoForgeFiles | 16477 | 16507 | 31 |
| findClawTalkApiKeyInConfigBackups | 9362 | 9391 | 30 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 16731 | 16807 | 77 |
| gatewayLifecycle | 3679 | 3724 | 46 |
| agentStreamingService | 16968 | 17011 | 44 |
| MODEL_RESILIENCE_FALLBACKS | 1546 | 1588 | 43 |
| runtimeStatusService | 3773 | 3812 | 40 |
| agentConfigRoutesContext | 17343 | 17382 | 40 |
| gatewayAgentTurnService | 16892 | 16929 | 38 |
| STREAMING_PROVIDER_CONFIG | 5367 | 5402 | 36 |
| runtimeRecoveryService | 16214 | 16248 | 35 |
| missionSchedulerService | 2339 | 2370 | 32 |
| providerAuthService | 1859 | 1888 | 30 |
| missionRecoveryService | 2410 | 2434 | 25 |
| gatewayChatService | 3401 | 3425 | 25 |
| providerSetupService | 1825 | 1848 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 430 | 452 | 23 |
| runtimeActionService | 16250 | 16270 | 21 |
| missionStateService | 2312 | 2331 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6696 | 6715 | 20 |
| BUILTIN_RETIRED_AGENT_IDS | 12134 | 12153 | 20 |
| browserPreflightService | 7914 | 7932 | 19 |
| AGENT_RESOURCE_FILES | 355 | 369 | 15 |
| oauthCallbackService | 1900 | 1914 | 15 |
| bufferedAgentTurnService | 16933 | 16947 | 15 |
| gatewayLogService | 3338 | 3351 | 14 |
| agentRuntimeService | 16951 | 16964 | 14 |
| RESOURCE_SEED_FILES | 370 | 381 | 12 |
| missionTeamSyncService | 2297 | 2308 | 12 |
| modelCatalogService | 1804 | 1814 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 16308 | 16318 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 13741 | 13750 | 10 |
| DEFAULT_HEARTBEAT_RUNTIME | 8952 | 8960 | 9 |
| missionReportService | 2286 | 2293 | 8 |
| gatewayDiagnostics | 3651 | 3657 | 7 |
| loginAttempts | 186 | 191 | 6 |
| pickerSessionService | 347 | 352 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 13027 | 13032 | 6 |
| OPENCLAW_STATE_ROOT | 252 | 256 | 5 |
| OPENCLAW_CONFIG_PATH | 258 | 262 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 263 | 267 | 5 |
| commandConsoleUploadService | 342 | 346 | 5 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 395 | 399 | 5 |
| SURVIVING_AGENT_IDS | 425 | 429 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1593 | 1597 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1612 | 1616 | 5 |
| DEFAULT_BOOTSTRAP_AGENTS | 1924 | 1928 | 5 |
| STATIC_ROOT | 17388 | 17392 | 5 |
| sessionTokens | 182 | 185 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 295 | 298 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1600 | 1603 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1604 | 1607 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1608 | 1611 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3276 | 3279 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3280 | 3283 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3284 | 3287 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3288 | 3291 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3292 | 3295 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3296 | 3299 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3300 | 3303 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3304 | 3307 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 15354 | 15357 | 4 |
| AGENCY_AGENT_TEMPLATE_SOURCE_ROOT | 277 | 279 | 3 |
| MACOS_GATEWAY_CHAT_EXPLICIT_OPT_IN | 388 | 390 | 3 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 392 | 394 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 400 | 402 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 403 | 405 | 3 |
| FORCE_LOCAL_AGENT_RUNTIME | 406 | 408 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 409 | 411 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 412 | 414 | 3 |
| AUTO_START_GATEWAY | 415 | 417 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 454 | 456 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1162 | 1164 | 3 |
| EDITOR_RESOURCE_FILES | 1483 | 1485 | 3 |
| installOpenClawPlugin | 553 | 554 | 2 |
| updateOpenClawPlugin | 556 | 557 | 2 |
| updateAllOpenClawPlugins | 559 | 560 | 2 |
| uninstallOpenClawPlugin | 562 | 563 | 2 |
| setupClawTalkPlugin | 570 | 571 | 2 |
| inspectOpenClawPluginRuntime | 578 | 579 | 2 |
| pluginRuntimeInspectReady | 581 | 582 | 2 |
| stopAllPluginSetupTerminalSessions | 584 | 585 | 2 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
