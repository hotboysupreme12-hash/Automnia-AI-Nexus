# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 18,882 |
| Control-plane bytes | 762,068 |
| Top-level imports | 58 |
| Top-level declarations | 1258 |
| Top-level functions | 860 |
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
| registerDiagnosticsRoutes | 17102 | 21 |
| registerCommandConsoleFileRoutes | 17124 | 5 |
| registerOpenClawCommandRoutes | 17130 | 15 |
| registerRuntimeRoutes | 17204 | 6 |
| registerPluginRoutes | 17211 | 22 |
| registerPartyManagementRoutes | 17719 | 1 |
| registerFilesystemRoutes | 17721 | 34 |
| registerPartyCoordinationRoutes | 17756 | 44 |
| registerMissionRoutes | 17801 | 6 |
| registerAgentTurnRoutes | 18423 | 85 |
| registerClawTalkConsoleRoutes | 18509 | 24 |
| registerBrowserRoutes | 18535 | 1 |
| registerShiftRoutes | 18658 | 16 |
| registerProviderAuthRoutes | 18675 | 19 |
| registerSkillRoutes | 18695 | 14 |
| registerAgentConfigRoutes | 18790 | 1 |
| registerAuthRoutes | 18792 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 18139 | 18421 | 283 |
| function | runBufferedAgentTurnForStream | 17808 | 18004 | 197 |
| function | runDoctorChecks | 16900 | 17066 | 167 |
| function | doctorGuidedActionForFinding | 16403 | 16549 | 147 |
| type | OpenClawConfigFile | 1180 | 1317 | 138 |
| function | launchWindowsFolderPickerSession | 7124 | 7258 | 135 |
| function | runGatewayAgentTurnForStream | 18006 | 18137 | 132 |
| function | launchWindowsImagePickerSession | 7399 | 7527 | 129 |
| function | generateRecruitAutoForgeMarkdown | 17441 | 17569 | 129 |
| function | buildDefaultAgentLocalConfig | 13885 | 14012 | 128 |
| function | checkBrowserPreflight | 8674 | 8799 | 126 |
| function | createShiftFromPayload | 18538 | 18656 | 119 |
| function | ensureOpenclawRuntimeDefaults | 9565 | 9679 | 115 |
| function | runControlCenterAgentRuntimeTurn | 14783 | 14894 | 112 |
| function | patchedClawTalkCoreBridgeSource | 10703 | 10812 | 110 |
| function | runOpenClaw | 5144 | 5249 | 106 |
| function | streamOpenAiResponsesCompletion | 5996 | 6079 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 15102 | 15184 | 83 |
| function | openAgentSessionSnapshots | 3755 | 3836 | 82 |
| function | defaultAgentResourceContent | 13177 | 13257 | 81 |
| function | generateGoogleVertexArtifactContent | 14938 | 15014 | 77 |
| function | startManagedTeamSyncOrchestrator | 16014 | 16088 | 75 |
| type | AgentLocalConfig | 1337 | 1410 | 74 |
| function | purgeAgentState | 13065 | 13136 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 14666 | 14736 | 71 |
| function | approveLocalDevicePairingRequest | 8246 | 8314 | 69 |
| function | inferWorkspaceRuntimeIntent | 6737 | 6804 | 68 |
| function | inspectOpenClawSessionLock | 4735 | 4801 | 67 |
| function | streamGoogleVertexContent | 6525 | 6591 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 12055 | 12121 | 67 |
| function | repairCodexPluginPostInstallState | 11662 | 11727 | 66 |
| type | PartyManagementRoutesContext | 17585 | 17650 | 66 |
| variable | partyManagementRoutesContext | 17652 | 17717 | 66 |
| function | pickImageWithOsDialog | 7737 | 7801 | 65 |
| function | seedAgentWorkspace | 14242 | 14306 | 65 |
| function | repairGatewayTokenConfigSync | 2023 | 2086 | 64 |
| function | cleanupOpenClawSessionLocks | 4883 | 4946 | 64 |
| function | extractAgentReply | 7891 | 7954 | 64 |
| function | tryReleaseTcpPortUnix | 8505 | 8568 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 11922 | 11985 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3091 | 3153 | 63 |
| function | resolveSharedTeamSyncPath | 14345 | 14407 | 63 |
| function | applyGoogleGeminiPluginPolicy | 14602 | 14664 | 63 |
| function | patchedTelegramBotRuntimeSource | 10830 | 10891 | 62 |
| function | pickFolderWithOsDialog | 7646 | 7705 | 60 |
| function | getPartyMembers | 16090 | 16149 | 60 |
| function | recruitAutoForgePrompt | 17348 | 17407 | 60 |
| function | buildMissionPrompt | 14182 | 14240 | 59 |
| function | streamGeminiContent | 6292 | 6349 | 58 |
| function | runPickerCommand | 7529 | 7586 | 58 |
| function | runBrowserToolProbe | 8616 | 8672 | 57 |
| function | writeOpenclawConfig | 9923 | 9978 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6629 | 6683 | 55 |
| function | tryReleaseGatewayPort | 8449 | 8503 | 55 |
| function | tryReleaseBrowserRelayPort | 8394 | 8447 | 54 |
| function | readOpenclawConfig | 9164 | 9217 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 11741 | 11794 | 54 |
| function | requestGatewaySessionAbort | 2667 | 2718 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 11069 | 11120 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6195 | 6245 | 51 |
| function | resolveFilenameHintsForMessage | 15309 | 15359 | 51 |
| function | listActiveCronJobsFromStateDb | 15801 | 15851 | 51 |
| function | recruitPersonalityDepthGuidance | 17271 | 17321 | 51 |
| function | inspectOpenClawSessionLocks | 4832 | 4881 | 50 |
| function | savePluginDirectConfig | 11549 | 11598 | 50 |
| function | syncAgentDerivedFiles | 13587 | 13636 | 50 |
| function | composeAgentDoctrinePrompt | 13638 | 13687 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 15897 | 15945 | 49 |
| function | readSkillEntryFromDir | 12380 | 12427 | 48 |
| function | appendAgentPromptDump | 13705 | 13752 | 48 |
| function | createInitialOpenclawConfig | 9066 | 9112 | 47 |
| function | ensureClawTalkManifestContracts | 10592 | 10638 | 47 |
| function | normalizeModelWithFallback | 13424 | 13470 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 15624 | 15670 | 47 |
| variable | gatewayLifecycle | 3602 | 3647 | 46 |
| function | streamOpenAiCompatibleCompletion | 5949 | 5994 | 46 |
| function | tryStartBrowserRelay | 8347 | 8392 | 46 |
| function | openClawOptimizationStatus | 9019 | 9064 | 46 |
| function | openClawDoctorLintCheck | 16853 | 16898 | 46 |
| function | terminateProcessTree | 978 | 1022 | 45 |
| function | checkGoogleVertexModelAvailability | 6404 | 6448 | 45 |
| function | syncDoctrineToWorkspace | 14452 | 14496 | 45 |
| function | streamAnthropicMessage | 6247 | 6290 | 44 |
| function | startFolderPickerSession | 7044 | 7087 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 9758 | 9801 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1477 | 1519 | 43 |
| function | normalizeOpenClawConfigModelRefs | 9521 | 9563 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 12559 | 12601 | 43 |
| function | applyLocalConfigToGlobal | 14049 | 14091 | 43 |
| function | spawnText | 3417 | 3458 | 42 |
| function | contentTypeFromExt | 4062 | 4103 | 42 |
| function | toOpenAICodexContext | 6133 | 6174 | 42 |
| function | firstJsonSliceFromText | 11210 | 11251 | 42 |
| function | seedCanonicalResourceIfMissing | 12794 | 12835 | 42 |
| function | buildDoctrineSyncReport | 15197 | 15238 | 42 |
| function | persistAgentAvatarFromPath | 7326 | 7366 | 41 |
| function | launchChromeHost | 7803 | 7843 | 41 |
| function | splitPluginCommandLine | 11346 | 11386 | 41 |
| variable | COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 275 | 314 | 40 |
| variable | runtimeStatusService | 3696 | 3735 | 40 |
| function | appendGoogleVertexPayloadDump | 13754 | 13792 | 39 |
| type | AgentConfigRoutesContext | 18710 | 18748 | 39 |
| variable | agentConfigRoutesContext | 18750 | 18788 | 39 |
| function | prepareOpenClawConfigForGatewayStartup | 3535 | 3572 | 38 |
| function | bufferedAgentRuntimeReason | 6806 | 6843 | 38 |
| function | persistAgentAvatarBytes | 7287 | 7324 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 15672 | 15709 | 38 |
| function | buildAgentRuntimePreflightChecks | 5085 | 5121 | 37 |
| function | normalizePluginSearchResult | 11282 | 11318 | 37 |
| variable | STREAMING_PROVIDER_CONFIG | 5356 | 5391 | 36 |
| function | ensureClawTalkApiKeyMaterial | 10233 | 10268 | 36 |
| function | saveClawTalkSetupConfig | 12186 | 12221 | 36 |
| function | normalizeAgentToolsConfig | 4489 | 4523 | 35 |
| function | parseSkillFrontmatter | 12318 | 12352 | 35 |
| variable | runtimeRecoveryService | 17146 | 17180 | 35 |
| function | clearDisallowedAutoModelOverridesForAgent | 3155 | 3188 | 34 |
| function | startImagePickerSession | 7089 | 7122 | 34 |
| function | isClawTalkIntentMessage | 7993 | 8026 | 34 |
| function | migrateLegacyOpenAiCodexProviderConfig | 9312 | 9345 | 34 |
| function | applyDeepSeekOnlyRuntimeDefaults | 9429 | 9462 | 34 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 18139 | 18421 | 283 |
| runBufferedAgentTurnForStream | 17808 | 18004 | 197 |
| runDoctorChecks | 16900 | 17066 | 167 |
| doctorGuidedActionForFinding | 16403 | 16549 | 147 |
| launchWindowsFolderPickerSession | 7124 | 7258 | 135 |
| runGatewayAgentTurnForStream | 18006 | 18137 | 132 |
| launchWindowsImagePickerSession | 7399 | 7527 | 129 |
| generateRecruitAutoForgeMarkdown | 17441 | 17569 | 129 |
| buildDefaultAgentLocalConfig | 13885 | 14012 | 128 |
| checkBrowserPreflight | 8674 | 8799 | 126 |
| createShiftFromPayload | 18538 | 18656 | 119 |
| ensureOpenclawRuntimeDefaults | 9565 | 9679 | 115 |
| runControlCenterAgentRuntimeTurn | 14783 | 14894 | 112 |
| patchedClawTalkCoreBridgeSource | 10703 | 10812 | 110 |
| runOpenClaw | 5144 | 5249 | 106 |
| streamOpenAiResponsesCompletion | 5996 | 6079 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 15102 | 15184 | 83 |
| openAgentSessionSnapshots | 3755 | 3836 | 82 |
| defaultAgentResourceContent | 13177 | 13257 | 81 |
| generateGoogleVertexArtifactContent | 14938 | 15014 | 77 |
| startManagedTeamSyncOrchestrator | 16014 | 16088 | 75 |
| purgeAgentState | 13065 | 13136 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 14666 | 14736 | 71 |
| approveLocalDevicePairingRequest | 8246 | 8314 | 69 |
| inferWorkspaceRuntimeIntent | 6737 | 6804 | 68 |
| inspectOpenClawSessionLock | 4735 | 4801 | 67 |
| streamGoogleVertexContent | 6525 | 6591 | 67 |
| applyOpenClawPluginEnabledToConfig | 12055 | 12121 | 67 |
| repairCodexPluginPostInstallState | 11662 | 11727 | 66 |
| pickImageWithOsDialog | 7737 | 7801 | 65 |
| seedAgentWorkspace | 14242 | 14306 | 65 |
| repairGatewayTokenConfigSync | 2023 | 2086 | 64 |
| cleanupOpenClawSessionLocks | 4883 | 4946 | 64 |
| extractAgentReply | 7891 | 7954 | 64 |
| tryReleaseTcpPortUnix | 8505 | 8568 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 11922 | 11985 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3091 | 3153 | 63 |
| resolveSharedTeamSyncPath | 14345 | 14407 | 63 |
| applyGoogleGeminiPluginPolicy | 14602 | 14664 | 63 |
| patchedTelegramBotRuntimeSource | 10830 | 10891 | 62 |
| pickFolderWithOsDialog | 7646 | 7705 | 60 |
| getPartyMembers | 16090 | 16149 | 60 |
| recruitAutoForgePrompt | 17348 | 17407 | 60 |
| buildMissionPrompt | 14182 | 14240 | 59 |
| streamGeminiContent | 6292 | 6349 | 58 |
| runPickerCommand | 7529 | 7586 | 58 |
| runBrowserToolProbe | 8616 | 8672 | 57 |
| writeOpenclawConfig | 9923 | 9978 | 56 |
| postLocalJsonNoHeaderTimeout | 6629 | 6683 | 55 |
| tryReleaseGatewayPort | 8449 | 8503 | 55 |
| tryReleaseBrowserRelayPort | 8394 | 8447 | 54 |
| readOpenclawConfig | 9164 | 9217 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 11741 | 11794 | 54 |
| requestGatewaySessionAbort | 2667 | 2718 | 52 |
| ensureClawTalkBundledPluginDefaults | 11069 | 11120 | 52 |
| streamOpenAICodexResponsesCompletion | 6195 | 6245 | 51 |
| resolveFilenameHintsForMessage | 15309 | 15359 | 51 |
| listActiveCronJobsFromStateDb | 15801 | 15851 | 51 |
| recruitPersonalityDepthGuidance | 17271 | 17321 | 51 |
| inspectOpenClawSessionLocks | 4832 | 4881 | 50 |
| savePluginDirectConfig | 11549 | 11598 | 50 |
| syncAgentDerivedFiles | 13587 | 13636 | 50 |
| composeAgentDoctrinePrompt | 13638 | 13687 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 15897 | 15945 | 49 |
| readSkillEntryFromDir | 12380 | 12427 | 48 |
| appendAgentPromptDump | 13705 | 13752 | 48 |
| createInitialOpenclawConfig | 9066 | 9112 | 47 |
| ensureClawTalkManifestContracts | 10592 | 10638 | 47 |
| normalizeModelWithFallback | 13424 | 13470 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 15624 | 15670 | 47 |
| streamOpenAiCompatibleCompletion | 5949 | 5994 | 46 |
| tryStartBrowserRelay | 8347 | 8392 | 46 |
| openClawOptimizationStatus | 9019 | 9064 | 46 |
| openClawDoctorLintCheck | 16853 | 16898 | 46 |
| terminateProcessTree | 978 | 1022 | 45 |
| checkGoogleVertexModelAvailability | 6404 | 6448 | 45 |
| syncDoctrineToWorkspace | 14452 | 14496 | 45 |
| streamAnthropicMessage | 6247 | 6290 | 44 |
| startFolderPickerSession | 7044 | 7087 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 9758 | 9801 | 44 |
| normalizeOpenClawConfigModelRefs | 9521 | 9563 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 12559 | 12601 | 43 |
| applyLocalConfigToGlobal | 14049 | 14091 | 43 |
| spawnText | 3417 | 3458 | 42 |
| contentTypeFromExt | 4062 | 4103 | 42 |
| toOpenAICodexContext | 6133 | 6174 | 42 |
| firstJsonSliceFromText | 11210 | 11251 | 42 |
| seedCanonicalResourceIfMissing | 12794 | 12835 | 42 |
| buildDoctrineSyncReport | 15197 | 15238 | 42 |
| persistAgentAvatarFromPath | 7326 | 7366 | 41 |
| launchChromeHost | 7803 | 7843 | 41 |
| splitPluginCommandLine | 11346 | 11386 | 41 |
| appendGoogleVertexPayloadDump | 13754 | 13792 | 39 |
| prepareOpenClawConfigForGatewayStartup | 3535 | 3572 | 38 |
| bufferedAgentRuntimeReason | 6806 | 6843 | 38 |
| persistAgentAvatarBytes | 7287 | 7324 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 15672 | 15709 | 38 |
| buildAgentRuntimePreflightChecks | 5085 | 5121 | 37 |
| normalizePluginSearchResult | 11282 | 11318 | 37 |
| ensureClawTalkApiKeyMaterial | 10233 | 10268 | 36 |
| saveClawTalkSetupConfig | 12186 | 12221 | 36 |
| normalizeAgentToolsConfig | 4489 | 4523 | 35 |
| parseSkillFrontmatter | 12318 | 12352 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3155 | 3188 | 34 |
| startImagePickerSession | 7089 | 7122 | 34 |
| isClawTalkIntentMessage | 7993 | 8026 | 34 |
| migrateLegacyOpenAiCodexProviderConfig | 9312 | 9345 | 34 |
| applyDeepSeekOnlyRuntimeDefaults | 9429 | 9462 | 34 |
| resolveAgentResourceContext | 12842 | 12875 | 34 |
| syncAllAgentLocalConfigs | 14147 | 14180 | 34 |
| cronRowToRuntimeCronJob | 15766 | 15799 | 34 |
| finishOpenClawRun | 2943 | 2975 | 33 |
| closeControlServerForShutdown | 3985 | 4017 | 33 |
| normalizeAgentMdsState | 4308 | 4340 | 33 |
| ensureAgentSandboxCompatibleWithHost | 14113 | 14145 | 33 |
| looksLikeGeneratedWorkspaceDoctrineContent | 15059 | 15091 | 33 |
| authDoctorCheck | 16740 | 16772 | 33 |
| runDoctorRepair | 17068 | 17100 | 33 |
| pluginRuntimeCheck | 5052 | 5083 | 32 |
| compactHttpJsonPayload | 5531 | 5562 | 32 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 17652 | 17717 | 66 |
| gatewayLifecycle | 3602 | 3647 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1477 | 1519 | 43 |
| COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 275 | 314 | 40 |
| runtimeStatusService | 3696 | 3735 | 40 |
| agentConfigRoutesContext | 18750 | 18788 | 39 |
| STREAMING_PROVIDER_CONFIG | 5356 | 5391 | 36 |
| runtimeRecoveryService | 17146 | 17180 | 35 |
| missionSchedulerService | 2285 | 2316 | 32 |
| providerAuthService | 1790 | 1819 | 30 |
| missionRecoveryService | 2356 | 2380 | 25 |
| gatewayChatService | 3342 | 3366 | 25 |
| providerSetupService | 1756 | 1779 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 430 | 452 | 23 |
| runtimeActionService | 17182 | 17202 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 1855 | 1874 | 20 |
| missionStateService | 2258 | 2277 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6685 | 6704 | 20 |
| AGENT_RESOURCE_FILES | 368 | 382 | 15 |
| oauthCallbackService | 1831 | 1845 | 15 |
| gatewayLogService | 3279 | 3292 | 14 |
| RESOURCE_SEED_FILES | 383 | 394 | 12 |
| missionTeamSyncService | 2243 | 2254 | 12 |
| AVATAR_IMAGE_MIME_EXTENSIONS | 317 | 327 | 11 |
| modelCatalogService | 1735 | 1745 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 17240 | 17250 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 14541 | 14550 | 10 |
| COMMAND_CONSOLE_UPLOAD_EXTENSIONS | 265 | 273 | 9 |
| DEFAULT_HEARTBEAT_RUNTIME | 9803 | 9811 | 9 |
| missionReportService | 2232 | 2239 | 8 |
| gatewayDiagnostics | 3574 | 3580 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 12972 | 12978 | 7 |
| loginAttempts | 163 | 168 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 13827 | 13832 | 6 |
| OPENCLAW_STATE_ROOT | 218 | 222 | 5 |
| OPENCLAW_CONFIG_PATH | 224 | 228 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 229 | 233 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1524 | 1528 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1543 | 1547 | 5 |
| STATIC_ROOT | 18794 | 18798 | 5 |
| sessionTokens | 159 | 162 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 257 | 260 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1531 | 1534 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1535 | 1538 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1539 | 1542 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3217 | 3220 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3221 | 3224 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3225 | 3228 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3229 | 3232 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3233 | 3236 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3237 | 3240 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3241 | 3244 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3245 | 3248 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 16286 | 16289 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 401 | 403 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 404 | 406 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 407 | 409 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 410 | 412 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 414 | 416 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 417 | 419 | 3 |
| AUTO_START_GATEWAY | 420 | 422 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 454 | 456 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1093 | 1095 | 3 |
| EDITOR_RESOURCE_FILES | 1414 | 1416 | 3 |
| installOpenClawPlugin | 553 | 554 | 2 |
| updateOpenClawPlugin | 556 | 557 | 2 |
| updateAllOpenClawPlugins | 559 | 560 | 2 |
| uninstallOpenClawPlugin | 562 | 563 | 2 |
| setupClawTalkPlugin | 570 | 571 | 2 |
| inspectOpenClawPluginRuntime | 578 | 579 | 2 |
| pluginRuntimeInspectReady | 581 | 582 | 2 |
| stopAllPluginSetupTerminalSessions | 584 | 585 | 2 |
| ensureConfiguredModelAllowlist | 1747 | 1748 | 2 |
| ensureOpenRouterModelCatalogAllowlist | 1749 | 1750 | 2 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 7845 | 7846 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 7848 | 7849 | 2 |
| app | 153 | 153 | 1 |
| PORT | 155 | 155 | 1 |
| CONFIGURED_AUTH_TOKEN | 156 | 156 | 1 |
| AUTH_TOKEN | 157 | 157 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
