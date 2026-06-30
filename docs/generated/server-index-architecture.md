# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 20,578 |
| Control-plane bytes | 823,807 |
| Top-level imports | 54 |
| Top-level declarations | 1345 |
| Top-level functions | 930 |
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
| registerDiagnosticsRoutes | 18794 | 21 |
| registerCommandConsoleFileRoutes | 18816 | 5 |
| registerOpenClawCommandRoutes | 18822 | 15 |
| registerRuntimeRoutes | 18896 | 6 |
| registerPluginRoutes | 18903 | 26 |
| registerPartyManagementRoutes | 19415 | 1 |
| registerFilesystemRoutes | 19417 | 34 |
| registerPartyCoordinationRoutes | 19452 | 44 |
| registerMissionRoutes | 19497 | 6 |
| registerAgentTurnRoutes | 20119 | 85 |
| registerClawTalkConsoleRoutes | 20205 | 24 |
| registerBrowserRoutes | 20231 | 1 |
| registerShiftRoutes | 20354 | 16 |
| registerProviderAuthRoutes | 20371 | 19 |
| registerSkillRoutes | 20391 | 14 |
| registerAgentConfigRoutes | 20486 | 1 |
| registerAuthRoutes | 20488 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 19835 | 20117 | 283 |
| function | runBufferedAgentTurnForStream | 19504 | 19700 | 197 |
| function | runDoctorChecks | 18592 | 18758 | 167 |
| function | installOpenClawPlugin | 12868 | 13019 | 152 |
| function | doctorGuidedActionForFinding | 18095 | 18241 | 147 |
| type | OpenClawConfigFile | 1112 | 1249 | 138 |
| function | launchWindowsFolderPickerSession | 7283 | 7417 | 135 |
| function | runGatewayAgentTurnForStream | 19702 | 19833 | 132 |
| function | launchWindowsImagePickerSession | 7558 | 7686 | 129 |
| function | generateRecruitAutoForgeMarkdown | 19137 | 19265 | 129 |
| function | buildDefaultAgentLocalConfig | 15577 | 15704 | 128 |
| function | checkBrowserPreflight | 8833 | 8958 | 126 |
| function | createShiftFromPayload | 20234 | 20352 | 119 |
| function | ensureOpenclawRuntimeDefaults | 9724 | 9838 | 115 |
| function | runControlCenterAgentRuntimeTurn | 16475 | 16586 | 112 |
| function | patchedClawTalkCoreBridgeSource | 10963 | 11072 | 110 |
| function | runOpenClaw | 5076 | 5181 | 106 |
| function | streamOpenAiResponsesCompletion | 6155 | 6238 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 16794 | 16876 | 83 |
| function | openAgentSessionSnapshots | 3687 | 3768 | 82 |
| function | defaultAgentResourceContent | 14869 | 14949 | 81 |
| function | listPluginControls | 13493 | 13570 | 78 |
| function | setupClawTalkPlugin | 13837 | 13913 | 77 |
| function | generateGoogleVertexArtifactContent | 16630 | 16706 | 77 |
| function | startManagedTeamSyncOrchestrator | 17706 | 17780 | 75 |
| type | AgentLocalConfig | 1269 | 1342 | 74 |
| function | purgeAgentState | 14757 | 14828 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 16358 | 16428 | 71 |
| function | approveLocalDevicePairingRequest | 8405 | 8473 | 69 |
| function | inferWorkspaceRuntimeIntent | 6896 | 6963 | 68 |
| function | inspectOpenClawSessionLock | 4667 | 4733 | 67 |
| function | streamGoogleVertexContent | 6684 | 6750 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 13572 | 13638 | 67 |
| function | repairCodexPluginPostInstallState | 12801 | 12866 | 66 |
| type | PartyManagementRoutesContext | 19281 | 19346 | 66 |
| variable | partyManagementRoutesContext | 19348 | 19413 | 66 |
| function | pickImageWithOsDialog | 7896 | 7960 | 65 |
| function | seedAgentWorkspace | 15934 | 15998 | 65 |
| function | repairGatewayTokenConfigSync | 1955 | 2018 | 64 |
| function | cleanupOpenClawSessionLocks | 4815 | 4878 | 64 |
| function | extractAgentReply | 8050 | 8113 | 64 |
| function | tryReleaseTcpPortUnix | 8664 | 8727 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 13214 | 13277 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3023 | 3085 | 63 |
| function | resolveSharedTeamSyncPath | 16037 | 16099 | 63 |
| function | applyGoogleGeminiPluginPolicy | 16294 | 16356 | 63 |
| function | patchedTelegramBotRuntimeSource | 11090 | 11151 | 62 |
| function | buildPluginControlEntry | 12003 | 12064 | 62 |
| function | pickFolderWithOsDialog | 7805 | 7864 | 60 |
| function | getPartyMembers | 17782 | 17841 | 60 |
| function | recruitAutoForgePrompt | 19044 | 19103 | 60 |
| function | buildMissionPrompt | 15874 | 15932 | 59 |
| function | streamGeminiContent | 6451 | 6508 | 58 |
| function | runPickerCommand | 7688 | 7745 | 58 |
| function | getPluginList | 11710 | 11767 | 58 |
| function | runBrowserToolProbe | 8775 | 8831 | 57 |
| function | writeOpenclawConfig | 10082 | 10137 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6788 | 6842 | 55 |
| function | tryReleaseGatewayPort | 8608 | 8662 | 55 |
| function | tryReleaseBrowserRelayPort | 8553 | 8606 | 54 |
| function | readOpenclawConfig | 9323 | 9376 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 13033 | 13086 | 54 |
| function | refreshPluginListCache | 11650 | 11702 | 53 |
| function | requestGatewaySessionAbort | 2599 | 2650 | 52 |
| function | createPlainProcessTerminalModule | 5303 | 5354 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 11329 | 11380 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6354 | 6404 | 51 |
| function | resolveFilenameHintsForMessage | 17001 | 17051 | 51 |
| function | listActiveCronJobsFromStateDb | 17493 | 17543 | 51 |
| function | recruitPersonalityDepthGuidance | 18967 | 19017 | 51 |
| function | inspectOpenClawSessionLocks | 4764 | 4813 | 50 |
| function | savePluginDirectConfig | 12602 | 12651 | 50 |
| function | syncAgentDerivedFiles | 15279 | 15328 | 50 |
| function | composeAgentDoctrinePrompt | 15330 | 15379 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 17589 | 17637 | 49 |
| function | startPluginSetupTerminalSession | 5418 | 5465 | 48 |
| function | readSkillEntryFromDir | 14072 | 14119 | 48 |
| function | appendAgentPromptDump | 15397 | 15444 | 48 |
| function | createInitialOpenclawConfig | 9225 | 9271 | 47 |
| function | ensureClawTalkManifestContracts | 10852 | 10898 | 47 |
| function | normalizeModelWithFallback | 15116 | 15162 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 17316 | 17362 | 47 |
| variable | gatewayLifecycle | 3534 | 3579 | 46 |
| function | streamOpenAiCompatibleCompletion | 6108 | 6153 | 46 |
| function | tryStartBrowserRelay | 8506 | 8551 | 46 |
| function | openClawOptimizationStatus | 9178 | 9223 | 46 |
| function | openClawDoctorLintCheck | 18545 | 18590 | 46 |
| function | terminateProcessTree | 910 | 954 | 45 |
| function | checkGoogleVertexModelAvailability | 6563 | 6607 | 45 |
| function | schemaConfigFieldsFromRaw | 11892 | 11936 | 45 |
| function | syncDoctrineToWorkspace | 16144 | 16188 | 45 |
| function | streamAnthropicMessage | 6406 | 6449 | 44 |
| function | startFolderPickerSession | 7203 | 7246 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 9917 | 9960 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1409 | 1451 | 43 |
| function | normalizeOpenClawConfigModelRefs | 9680 | 9722 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 14251 | 14293 | 43 |
| function | applyLocalConfigToGlobal | 15741 | 15783 | 43 |
| function | spawnText | 3349 | 3390 | 42 |
| function | contentTypeFromExt | 3994 | 4035 | 42 |
| function | toOpenAICodexContext | 6292 | 6333 | 42 |
| function | firstJsonSliceFromText | 12066 | 12107 | 42 |
| function | seedCanonicalResourceIfMissing | 14486 | 14527 | 42 |
| function | buildDoctrineSyncReport | 16889 | 16930 | 42 |
| function | persistAgentAvatarFromPath | 7485 | 7525 | 41 |
| function | launchChromeHost | 7962 | 8002 | 41 |
| function | pluginRawFromManifest | 11517 | 11557 | 41 |
| function | knownPluginConfigFields | 11938 | 11978 | 41 |
| function | splitPluginCommandLine | 12303 | 12343 | 41 |
| variable | COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 252 | 291 | 40 |
| variable | runtimeStatusService | 3628 | 3667 | 40 |
| function | summarizePluginRuntimeInspect | 13419 | 13457 | 39 |
| function | appendGoogleVertexPayloadDump | 15446 | 15484 | 39 |
| type | AgentConfigRoutesContext | 20406 | 20444 | 39 |
| variable | agentConfigRoutesContext | 20446 | 20484 | 39 |
| function | prepareOpenClawConfigForGatewayStartup | 3467 | 3504 | 38 |
| function | bufferedAgentRuntimeReason | 6965 | 7002 | 38 |
| function | persistAgentAvatarBytes | 7446 | 7483 | 38 |
| function | providerConfigFieldsFromSetup | 11853 | 11890 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 17364 | 17401 | 38 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 19835 | 20117 | 283 |
| runBufferedAgentTurnForStream | 19504 | 19700 | 197 |
| runDoctorChecks | 18592 | 18758 | 167 |
| installOpenClawPlugin | 12868 | 13019 | 152 |
| doctorGuidedActionForFinding | 18095 | 18241 | 147 |
| launchWindowsFolderPickerSession | 7283 | 7417 | 135 |
| runGatewayAgentTurnForStream | 19702 | 19833 | 132 |
| launchWindowsImagePickerSession | 7558 | 7686 | 129 |
| generateRecruitAutoForgeMarkdown | 19137 | 19265 | 129 |
| buildDefaultAgentLocalConfig | 15577 | 15704 | 128 |
| checkBrowserPreflight | 8833 | 8958 | 126 |
| createShiftFromPayload | 20234 | 20352 | 119 |
| ensureOpenclawRuntimeDefaults | 9724 | 9838 | 115 |
| runControlCenterAgentRuntimeTurn | 16475 | 16586 | 112 |
| patchedClawTalkCoreBridgeSource | 10963 | 11072 | 110 |
| runOpenClaw | 5076 | 5181 | 106 |
| streamOpenAiResponsesCompletion | 6155 | 6238 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 16794 | 16876 | 83 |
| openAgentSessionSnapshots | 3687 | 3768 | 82 |
| defaultAgentResourceContent | 14869 | 14949 | 81 |
| listPluginControls | 13493 | 13570 | 78 |
| setupClawTalkPlugin | 13837 | 13913 | 77 |
| generateGoogleVertexArtifactContent | 16630 | 16706 | 77 |
| startManagedTeamSyncOrchestrator | 17706 | 17780 | 75 |
| purgeAgentState | 14757 | 14828 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 16358 | 16428 | 71 |
| approveLocalDevicePairingRequest | 8405 | 8473 | 69 |
| inferWorkspaceRuntimeIntent | 6896 | 6963 | 68 |
| inspectOpenClawSessionLock | 4667 | 4733 | 67 |
| streamGoogleVertexContent | 6684 | 6750 | 67 |
| applyOpenClawPluginEnabledToConfig | 13572 | 13638 | 67 |
| repairCodexPluginPostInstallState | 12801 | 12866 | 66 |
| pickImageWithOsDialog | 7896 | 7960 | 65 |
| seedAgentWorkspace | 15934 | 15998 | 65 |
| repairGatewayTokenConfigSync | 1955 | 2018 | 64 |
| cleanupOpenClawSessionLocks | 4815 | 4878 | 64 |
| extractAgentReply | 8050 | 8113 | 64 |
| tryReleaseTcpPortUnix | 8664 | 8727 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 13214 | 13277 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3023 | 3085 | 63 |
| resolveSharedTeamSyncPath | 16037 | 16099 | 63 |
| applyGoogleGeminiPluginPolicy | 16294 | 16356 | 63 |
| patchedTelegramBotRuntimeSource | 11090 | 11151 | 62 |
| buildPluginControlEntry | 12003 | 12064 | 62 |
| pickFolderWithOsDialog | 7805 | 7864 | 60 |
| getPartyMembers | 17782 | 17841 | 60 |
| recruitAutoForgePrompt | 19044 | 19103 | 60 |
| buildMissionPrompt | 15874 | 15932 | 59 |
| streamGeminiContent | 6451 | 6508 | 58 |
| runPickerCommand | 7688 | 7745 | 58 |
| getPluginList | 11710 | 11767 | 58 |
| runBrowserToolProbe | 8775 | 8831 | 57 |
| writeOpenclawConfig | 10082 | 10137 | 56 |
| postLocalJsonNoHeaderTimeout | 6788 | 6842 | 55 |
| tryReleaseGatewayPort | 8608 | 8662 | 55 |
| tryReleaseBrowserRelayPort | 8553 | 8606 | 54 |
| readOpenclawConfig | 9323 | 9376 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 13033 | 13086 | 54 |
| refreshPluginListCache | 11650 | 11702 | 53 |
| requestGatewaySessionAbort | 2599 | 2650 | 52 |
| createPlainProcessTerminalModule | 5303 | 5354 | 52 |
| ensureClawTalkBundledPluginDefaults | 11329 | 11380 | 52 |
| streamOpenAICodexResponsesCompletion | 6354 | 6404 | 51 |
| resolveFilenameHintsForMessage | 17001 | 17051 | 51 |
| listActiveCronJobsFromStateDb | 17493 | 17543 | 51 |
| recruitPersonalityDepthGuidance | 18967 | 19017 | 51 |
| inspectOpenClawSessionLocks | 4764 | 4813 | 50 |
| savePluginDirectConfig | 12602 | 12651 | 50 |
| syncAgentDerivedFiles | 15279 | 15328 | 50 |
| composeAgentDoctrinePrompt | 15330 | 15379 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 17589 | 17637 | 49 |
| startPluginSetupTerminalSession | 5418 | 5465 | 48 |
| readSkillEntryFromDir | 14072 | 14119 | 48 |
| appendAgentPromptDump | 15397 | 15444 | 48 |
| createInitialOpenclawConfig | 9225 | 9271 | 47 |
| ensureClawTalkManifestContracts | 10852 | 10898 | 47 |
| normalizeModelWithFallback | 15116 | 15162 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 17316 | 17362 | 47 |
| streamOpenAiCompatibleCompletion | 6108 | 6153 | 46 |
| tryStartBrowserRelay | 8506 | 8551 | 46 |
| openClawOptimizationStatus | 9178 | 9223 | 46 |
| openClawDoctorLintCheck | 18545 | 18590 | 46 |
| terminateProcessTree | 910 | 954 | 45 |
| checkGoogleVertexModelAvailability | 6563 | 6607 | 45 |
| schemaConfigFieldsFromRaw | 11892 | 11936 | 45 |
| syncDoctrineToWorkspace | 16144 | 16188 | 45 |
| streamAnthropicMessage | 6406 | 6449 | 44 |
| startFolderPickerSession | 7203 | 7246 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 9917 | 9960 | 44 |
| normalizeOpenClawConfigModelRefs | 9680 | 9722 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 14251 | 14293 | 43 |
| applyLocalConfigToGlobal | 15741 | 15783 | 43 |
| spawnText | 3349 | 3390 | 42 |
| contentTypeFromExt | 3994 | 4035 | 42 |
| toOpenAICodexContext | 6292 | 6333 | 42 |
| firstJsonSliceFromText | 12066 | 12107 | 42 |
| seedCanonicalResourceIfMissing | 14486 | 14527 | 42 |
| buildDoctrineSyncReport | 16889 | 16930 | 42 |
| persistAgentAvatarFromPath | 7485 | 7525 | 41 |
| launchChromeHost | 7962 | 8002 | 41 |
| pluginRawFromManifest | 11517 | 11557 | 41 |
| knownPluginConfigFields | 11938 | 11978 | 41 |
| splitPluginCommandLine | 12303 | 12343 | 41 |
| summarizePluginRuntimeInspect | 13419 | 13457 | 39 |
| appendGoogleVertexPayloadDump | 15446 | 15484 | 39 |
| prepareOpenClawConfigForGatewayStartup | 3467 | 3504 | 38 |
| bufferedAgentRuntimeReason | 6965 | 7002 | 38 |
| persistAgentAvatarBytes | 7446 | 7483 | 38 |
| providerConfigFieldsFromSetup | 11853 | 11890 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 17364 | 17401 | 38 |
| buildAgentRuntimePreflightChecks | 5017 | 5053 | 37 |
| normalizePluginSearchResult | 12233 | 12269 | 37 |
| ensureClawTalkApiKeyMaterial | 10417 | 10452 | 36 |
| saveClawTalkSetupConfig | 13800 | 13835 | 36 |
| normalizeAgentToolsConfig | 4421 | 4455 | 35 |
| readPluginListDiskCache | 11599 | 11633 | 35 |
| parseSkillFrontmatter | 14010 | 14044 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3087 | 3120 | 34 |
| startImagePickerSession | 7248 | 7281 | 34 |
| isClawTalkIntentMessage | 8152 | 8185 | 34 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 19348 | 19413 | 66 |
| gatewayLifecycle | 3534 | 3579 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1409 | 1451 | 43 |
| COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 252 | 291 | 40 |
| runtimeStatusService | 3628 | 3667 | 40 |
| agentConfigRoutesContext | 20446 | 20484 | 39 |
| PLUGIN_CATALOG | 11382 | 11418 | 37 |
| STREAMING_PROVIDER_CONFIG | 5515 | 5550 | 36 |
| runtimeRecoveryService | 18838 | 18872 | 35 |
| missionSchedulerService | 2217 | 2248 | 32 |
| providerAuthService | 1722 | 1751 | 30 |
| missionRecoveryService | 2288 | 2312 | 25 |
| gatewayChatService | 3274 | 3298 | 25 |
| providerSetupService | 1688 | 1711 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 407 | 429 | 23 |
| runtimeActionService | 18874 | 18894 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 1787 | 1806 | 20 |
| missionStateService | 2190 | 2209 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6844 | 6863 | 20 |
| AGENT_RESOURCE_FILES | 345 | 359 | 15 |
| oauthCallbackService | 1763 | 1777 | 15 |
| gatewayLogService | 3211 | 3224 | 14 |
| RESOURCE_SEED_FILES | 360 | 371 | 12 |
| missionTeamSyncService | 2175 | 2186 | 12 |
| AVATAR_IMAGE_MIME_EXTENSIONS | 294 | 304 | 11 |
| modelCatalogService | 1667 | 1677 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 18936 | 18946 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 16233 | 16242 | 10 |
| COMMAND_CONSOLE_UPLOAD_EXTENSIONS | 242 | 250 | 9 |
| DEFAULT_HEARTBEAT_RUNTIME | 9962 | 9970 | 9 |
| missionReportService | 2164 | 2171 | 8 |
| gatewayDiagnostics | 3506 | 3512 | 7 |
| PLUGIN_SETUP_TERMINAL_COMMANDS | 5290 | 5296 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 14664 | 14670 | 7 |
| loginAttempts | 140 | 145 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 15519 | 15524 | 6 |
| OPENCLAW_STATE_ROOT | 195 | 199 | 5 |
| OPENCLAW_CONFIG_PATH | 201 | 205 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 206 | 210 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1456 | 1460 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1475 | 1479 | 5 |
| STATIC_ROOT | 20490 | 20494 | 5 |
| sessionTokens | 136 | 139 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 234 | 237 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1463 | 1466 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1467 | 1470 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1471 | 1474 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3149 | 3152 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3153 | 3156 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3157 | 3160 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3161 | 3164 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3165 | 3168 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3169 | 3172 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3173 | 3176 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3177 | 3180 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 17978 | 17981 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 378 | 380 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 381 | 383 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 384 | 386 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 387 | 389 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 391 | 393 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 394 | 396 | 3 |
| AUTO_START_GATEWAY | 397 | 399 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 431 | 433 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1025 | 1027 | 3 |
| EDITOR_RESOURCE_FILES | 1346 | 1348 | 3 |
| ensureConfiguredModelAllowlist | 1679 | 1680 | 2 |
| ensureOpenRouterModelCatalogAllowlist | 1681 | 1682 | 2 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 8004 | 8005 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 8007 | 8008 | 2 |
| CLAWTALK_DOCTOR_CHECK_RE | 13727 | 13728 | 2 |
| app | 130 | 130 | 1 |
| PORT | 132 | 132 | 1 |
| CONFIGURED_AUTH_TOKEN | 133 | 133 | 1 |
| AUTH_TOKEN | 134 | 134 | 1 |
| AUTH_TOKEN_SOURCE | 135 | 135 | 1 |
| CONTROL_CENTER_FRONTEND_PORT | 146 | 146 | 1 |
| controlServer | 162 | 162 | 1 |
| optionalRequire | 163 | 163 | 1 |
| WORKSPACE_ROOT | 177 | 177 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
