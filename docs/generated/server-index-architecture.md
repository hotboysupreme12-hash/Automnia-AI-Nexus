# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 19,040 |
| Control-plane bytes | 767,723 |
| Top-level imports | 57 |
| Top-level declarations | 1266 |
| Top-level functions | 867 |
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
| registerDiagnosticsRoutes | 17260 | 21 |
| registerCommandConsoleFileRoutes | 17282 | 5 |
| registerOpenClawCommandRoutes | 17288 | 15 |
| registerRuntimeRoutes | 17362 | 6 |
| registerPluginRoutes | 17369 | 22 |
| registerPartyManagementRoutes | 17877 | 1 |
| registerFilesystemRoutes | 17879 | 34 |
| registerPartyCoordinationRoutes | 17914 | 44 |
| registerMissionRoutes | 17959 | 6 |
| registerAgentTurnRoutes | 18581 | 85 |
| registerClawTalkConsoleRoutes | 18667 | 24 |
| registerBrowserRoutes | 18693 | 1 |
| registerShiftRoutes | 18816 | 16 |
| registerProviderAuthRoutes | 18833 | 19 |
| registerSkillRoutes | 18853 | 14 |
| registerAgentConfigRoutes | 18948 | 1 |
| registerAuthRoutes | 18950 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 18297 | 18579 | 283 |
| function | runBufferedAgentTurnForStream | 17966 | 18162 | 197 |
| function | runDoctorChecks | 17058 | 17224 | 167 |
| function | doctorGuidedActionForFinding | 16561 | 16707 | 147 |
| type | OpenClawConfigFile | 1167 | 1304 | 138 |
| function | launchWindowsFolderPickerSession | 7111 | 7245 | 135 |
| function | runGatewayAgentTurnForStream | 18164 | 18295 | 132 |
| function | launchWindowsImagePickerSession | 7386 | 7514 | 129 |
| function | generateRecruitAutoForgeMarkdown | 17599 | 17727 | 129 |
| function | buildDefaultAgentLocalConfig | 14043 | 14170 | 128 |
| function | checkBrowserPreflight | 8661 | 8786 | 126 |
| function | createShiftFromPayload | 18696 | 18814 | 119 |
| function | ensureOpenclawRuntimeDefaults | 9552 | 9666 | 115 |
| function | runControlCenterAgentRuntimeTurn | 14941 | 15052 | 112 |
| function | patchedClawTalkCoreBridgeSource | 10691 | 10800 | 110 |
| function | runOpenClaw | 5131 | 5236 | 106 |
| function | streamOpenAiResponsesCompletion | 5983 | 6066 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 15260 | 15342 | 83 |
| function | openAgentSessionSnapshots | 3742 | 3823 | 82 |
| function | defaultAgentResourceContent | 13335 | 13415 | 81 |
| function | setupClawTalkPlugin | 12303 | 12379 | 77 |
| function | generateGoogleVertexArtifactContent | 15096 | 15172 | 77 |
| function | startManagedTeamSyncOrchestrator | 16172 | 16246 | 75 |
| type | AgentLocalConfig | 1324 | 1397 | 74 |
| function | purgeAgentState | 13223 | 13294 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 14824 | 14894 | 71 |
| function | approveLocalDevicePairingRequest | 8233 | 8301 | 69 |
| function | inferWorkspaceRuntimeIntent | 6724 | 6791 | 68 |
| function | inspectOpenClawSessionLock | 4722 | 4788 | 67 |
| function | streamGoogleVertexContent | 6512 | 6578 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 12043 | 12109 | 67 |
| function | repairCodexPluginPostInstallState | 11650 | 11715 | 66 |
| type | PartyManagementRoutesContext | 17743 | 17808 | 66 |
| variable | partyManagementRoutesContext | 17810 | 17875 | 66 |
| function | pickImageWithOsDialog | 7724 | 7788 | 65 |
| function | seedAgentWorkspace | 14400 | 14464 | 65 |
| function | repairGatewayTokenConfigSync | 2010 | 2073 | 64 |
| function | cleanupOpenClawSessionLocks | 4870 | 4933 | 64 |
| function | extractAgentReply | 7878 | 7941 | 64 |
| function | tryReleaseTcpPortUnix | 8492 | 8555 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 11910 | 11973 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3078 | 3140 | 63 |
| function | resolveSharedTeamSyncPath | 14503 | 14565 | 63 |
| function | applyGoogleGeminiPluginPolicy | 14760 | 14822 | 63 |
| function | patchedTelegramBotRuntimeSource | 10818 | 10879 | 62 |
| function | pickFolderWithOsDialog | 7633 | 7692 | 60 |
| function | getPartyMembers | 16248 | 16307 | 60 |
| function | recruitAutoForgePrompt | 17506 | 17565 | 60 |
| function | buildMissionPrompt | 14340 | 14398 | 59 |
| function | streamGeminiContent | 6279 | 6336 | 58 |
| function | runPickerCommand | 7516 | 7573 | 58 |
| function | runBrowserToolProbe | 8603 | 8659 | 57 |
| function | writeOpenclawConfig | 9910 | 9965 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6616 | 6670 | 55 |
| function | tryReleaseGatewayPort | 8436 | 8490 | 55 |
| function | tryReleaseBrowserRelayPort | 8381 | 8434 | 54 |
| function | readOpenclawConfig | 9151 | 9204 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 11729 | 11782 | 54 |
| function | requestGatewaySessionAbort | 2654 | 2705 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 11057 | 11108 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6182 | 6232 | 51 |
| function | resolveFilenameHintsForMessage | 15467 | 15517 | 51 |
| function | listActiveCronJobsFromStateDb | 15959 | 16009 | 51 |
| function | recruitPersonalityDepthGuidance | 17429 | 17479 | 51 |
| function | inspectOpenClawSessionLocks | 4819 | 4868 | 50 |
| function | savePluginDirectConfig | 11537 | 11586 | 50 |
| function | syncAgentDerivedFiles | 13745 | 13794 | 50 |
| function | composeAgentDoctrinePrompt | 13796 | 13845 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 16055 | 16103 | 49 |
| function | readSkillEntryFromDir | 12538 | 12585 | 48 |
| function | appendAgentPromptDump | 13863 | 13910 | 48 |
| function | createInitialOpenclawConfig | 9053 | 9099 | 47 |
| function | ensureClawTalkManifestContracts | 10580 | 10626 | 47 |
| function | normalizeModelWithFallback | 13582 | 13628 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 15782 | 15828 | 47 |
| variable | gatewayLifecycle | 3589 | 3634 | 46 |
| function | streamOpenAiCompatibleCompletion | 5936 | 5981 | 46 |
| function | tryStartBrowserRelay | 8334 | 8379 | 46 |
| function | openClawOptimizationStatus | 9006 | 9051 | 46 |
| function | openClawDoctorLintCheck | 17011 | 17056 | 46 |
| function | terminateProcessTree | 965 | 1009 | 45 |
| function | checkGoogleVertexModelAvailability | 6391 | 6435 | 45 |
| function | syncDoctrineToWorkspace | 14610 | 14654 | 45 |
| function | streamAnthropicMessage | 6234 | 6277 | 44 |
| function | startFolderPickerSession | 7031 | 7074 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 9745 | 9788 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1464 | 1506 | 43 |
| function | normalizeOpenClawConfigModelRefs | 9508 | 9550 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 12717 | 12759 | 43 |
| function | applyLocalConfigToGlobal | 14207 | 14249 | 43 |
| function | spawnText | 3404 | 3445 | 42 |
| function | contentTypeFromExt | 4049 | 4090 | 42 |
| function | toOpenAICodexContext | 6120 | 6161 | 42 |
| function | firstJsonSliceFromText | 11198 | 11239 | 42 |
| function | seedCanonicalResourceIfMissing | 12952 | 12993 | 42 |
| function | buildDoctrineSyncReport | 15355 | 15396 | 42 |
| function | persistAgentAvatarFromPath | 7313 | 7353 | 41 |
| function | launchChromeHost | 7790 | 7830 | 41 |
| function | splitPluginCommandLine | 11334 | 11374 | 41 |
| variable | COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 271 | 310 | 40 |
| variable | runtimeStatusService | 3683 | 3722 | 40 |
| function | appendGoogleVertexPayloadDump | 13912 | 13950 | 39 |
| type | AgentConfigRoutesContext | 18868 | 18906 | 39 |
| variable | agentConfigRoutesContext | 18908 | 18946 | 39 |
| function | prepareOpenClawConfigForGatewayStartup | 3522 | 3559 | 38 |
| function | bufferedAgentRuntimeReason | 6793 | 6830 | 38 |
| function | persistAgentAvatarBytes | 7274 | 7311 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 15830 | 15867 | 38 |
| function | buildAgentRuntimePreflightChecks | 5072 | 5108 | 37 |
| function | normalizePluginSearchResult | 11270 | 11306 | 37 |
| variable | STREAMING_PROVIDER_CONFIG | 5343 | 5378 | 36 |
| function | ensureClawTalkApiKeyMaterial | 10221 | 10256 | 36 |
| function | saveClawTalkSetupConfig | 12266 | 12301 | 36 |
| function | normalizeAgentToolsConfig | 4476 | 4510 | 35 |
| function | parseSkillFrontmatter | 12476 | 12510 | 35 |
| variable | runtimeRecoveryService | 17304 | 17338 | 35 |
| function | clearDisallowedAutoModelOverridesForAgent | 3142 | 3175 | 34 |
| function | startImagePickerSession | 7076 | 7109 | 34 |
| function | isClawTalkIntentMessage | 7980 | 8013 | 34 |
| function | migrateLegacyOpenAiCodexProviderConfig | 9299 | 9332 | 34 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 18297 | 18579 | 283 |
| runBufferedAgentTurnForStream | 17966 | 18162 | 197 |
| runDoctorChecks | 17058 | 17224 | 167 |
| doctorGuidedActionForFinding | 16561 | 16707 | 147 |
| launchWindowsFolderPickerSession | 7111 | 7245 | 135 |
| runGatewayAgentTurnForStream | 18164 | 18295 | 132 |
| launchWindowsImagePickerSession | 7386 | 7514 | 129 |
| generateRecruitAutoForgeMarkdown | 17599 | 17727 | 129 |
| buildDefaultAgentLocalConfig | 14043 | 14170 | 128 |
| checkBrowserPreflight | 8661 | 8786 | 126 |
| createShiftFromPayload | 18696 | 18814 | 119 |
| ensureOpenclawRuntimeDefaults | 9552 | 9666 | 115 |
| runControlCenterAgentRuntimeTurn | 14941 | 15052 | 112 |
| patchedClawTalkCoreBridgeSource | 10691 | 10800 | 110 |
| runOpenClaw | 5131 | 5236 | 106 |
| streamOpenAiResponsesCompletion | 5983 | 6066 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 15260 | 15342 | 83 |
| openAgentSessionSnapshots | 3742 | 3823 | 82 |
| defaultAgentResourceContent | 13335 | 13415 | 81 |
| setupClawTalkPlugin | 12303 | 12379 | 77 |
| generateGoogleVertexArtifactContent | 15096 | 15172 | 77 |
| startManagedTeamSyncOrchestrator | 16172 | 16246 | 75 |
| purgeAgentState | 13223 | 13294 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 14824 | 14894 | 71 |
| approveLocalDevicePairingRequest | 8233 | 8301 | 69 |
| inferWorkspaceRuntimeIntent | 6724 | 6791 | 68 |
| inspectOpenClawSessionLock | 4722 | 4788 | 67 |
| streamGoogleVertexContent | 6512 | 6578 | 67 |
| applyOpenClawPluginEnabledToConfig | 12043 | 12109 | 67 |
| repairCodexPluginPostInstallState | 11650 | 11715 | 66 |
| pickImageWithOsDialog | 7724 | 7788 | 65 |
| seedAgentWorkspace | 14400 | 14464 | 65 |
| repairGatewayTokenConfigSync | 2010 | 2073 | 64 |
| cleanupOpenClawSessionLocks | 4870 | 4933 | 64 |
| extractAgentReply | 7878 | 7941 | 64 |
| tryReleaseTcpPortUnix | 8492 | 8555 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 11910 | 11973 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3078 | 3140 | 63 |
| resolveSharedTeamSyncPath | 14503 | 14565 | 63 |
| applyGoogleGeminiPluginPolicy | 14760 | 14822 | 63 |
| patchedTelegramBotRuntimeSource | 10818 | 10879 | 62 |
| pickFolderWithOsDialog | 7633 | 7692 | 60 |
| getPartyMembers | 16248 | 16307 | 60 |
| recruitAutoForgePrompt | 17506 | 17565 | 60 |
| buildMissionPrompt | 14340 | 14398 | 59 |
| streamGeminiContent | 6279 | 6336 | 58 |
| runPickerCommand | 7516 | 7573 | 58 |
| runBrowserToolProbe | 8603 | 8659 | 57 |
| writeOpenclawConfig | 9910 | 9965 | 56 |
| postLocalJsonNoHeaderTimeout | 6616 | 6670 | 55 |
| tryReleaseGatewayPort | 8436 | 8490 | 55 |
| tryReleaseBrowserRelayPort | 8381 | 8434 | 54 |
| readOpenclawConfig | 9151 | 9204 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 11729 | 11782 | 54 |
| requestGatewaySessionAbort | 2654 | 2705 | 52 |
| ensureClawTalkBundledPluginDefaults | 11057 | 11108 | 52 |
| streamOpenAICodexResponsesCompletion | 6182 | 6232 | 51 |
| resolveFilenameHintsForMessage | 15467 | 15517 | 51 |
| listActiveCronJobsFromStateDb | 15959 | 16009 | 51 |
| recruitPersonalityDepthGuidance | 17429 | 17479 | 51 |
| inspectOpenClawSessionLocks | 4819 | 4868 | 50 |
| savePluginDirectConfig | 11537 | 11586 | 50 |
| syncAgentDerivedFiles | 13745 | 13794 | 50 |
| composeAgentDoctrinePrompt | 13796 | 13845 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 16055 | 16103 | 49 |
| readSkillEntryFromDir | 12538 | 12585 | 48 |
| appendAgentPromptDump | 13863 | 13910 | 48 |
| createInitialOpenclawConfig | 9053 | 9099 | 47 |
| ensureClawTalkManifestContracts | 10580 | 10626 | 47 |
| normalizeModelWithFallback | 13582 | 13628 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 15782 | 15828 | 47 |
| streamOpenAiCompatibleCompletion | 5936 | 5981 | 46 |
| tryStartBrowserRelay | 8334 | 8379 | 46 |
| openClawOptimizationStatus | 9006 | 9051 | 46 |
| openClawDoctorLintCheck | 17011 | 17056 | 46 |
| terminateProcessTree | 965 | 1009 | 45 |
| checkGoogleVertexModelAvailability | 6391 | 6435 | 45 |
| syncDoctrineToWorkspace | 14610 | 14654 | 45 |
| streamAnthropicMessage | 6234 | 6277 | 44 |
| startFolderPickerSession | 7031 | 7074 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 9745 | 9788 | 44 |
| normalizeOpenClawConfigModelRefs | 9508 | 9550 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 12717 | 12759 | 43 |
| applyLocalConfigToGlobal | 14207 | 14249 | 43 |
| spawnText | 3404 | 3445 | 42 |
| contentTypeFromExt | 4049 | 4090 | 42 |
| toOpenAICodexContext | 6120 | 6161 | 42 |
| firstJsonSliceFromText | 11198 | 11239 | 42 |
| seedCanonicalResourceIfMissing | 12952 | 12993 | 42 |
| buildDoctrineSyncReport | 15355 | 15396 | 42 |
| persistAgentAvatarFromPath | 7313 | 7353 | 41 |
| launchChromeHost | 7790 | 7830 | 41 |
| splitPluginCommandLine | 11334 | 11374 | 41 |
| appendGoogleVertexPayloadDump | 13912 | 13950 | 39 |
| prepareOpenClawConfigForGatewayStartup | 3522 | 3559 | 38 |
| bufferedAgentRuntimeReason | 6793 | 6830 | 38 |
| persistAgentAvatarBytes | 7274 | 7311 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 15830 | 15867 | 38 |
| buildAgentRuntimePreflightChecks | 5072 | 5108 | 37 |
| normalizePluginSearchResult | 11270 | 11306 | 37 |
| ensureClawTalkApiKeyMaterial | 10221 | 10256 | 36 |
| saveClawTalkSetupConfig | 12266 | 12301 | 36 |
| normalizeAgentToolsConfig | 4476 | 4510 | 35 |
| parseSkillFrontmatter | 12476 | 12510 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3142 | 3175 | 34 |
| startImagePickerSession | 7076 | 7109 | 34 |
| isClawTalkIntentMessage | 7980 | 8013 | 34 |
| migrateLegacyOpenAiCodexProviderConfig | 9299 | 9332 | 34 |
| applyDeepSeekOnlyRuntimeDefaults | 9416 | 9449 | 34 |
| resolveAgentResourceContext | 13000 | 13033 | 34 |
| syncAllAgentLocalConfigs | 14305 | 14338 | 34 |
| cronRowToRuntimeCronJob | 15924 | 15957 | 34 |
| finishOpenClawRun | 2930 | 2962 | 33 |
| closeControlServerForShutdown | 3972 | 4004 | 33 |
| normalizeAgentMdsState | 4295 | 4327 | 33 |
| ensureAgentSandboxCompatibleWithHost | 14271 | 14303 | 33 |
| looksLikeGeneratedWorkspaceDoctrineContent | 15217 | 15249 | 33 |
| authDoctorCheck | 16898 | 16930 | 33 |
| runDoctorRepair | 17226 | 17258 | 33 |
| pluginRuntimeCheck | 5039 | 5070 | 32 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 17810 | 17875 | 66 |
| gatewayLifecycle | 3589 | 3634 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1464 | 1506 | 43 |
| COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 271 | 310 | 40 |
| runtimeStatusService | 3683 | 3722 | 40 |
| agentConfigRoutesContext | 18908 | 18946 | 39 |
| STREAMING_PROVIDER_CONFIG | 5343 | 5378 | 36 |
| runtimeRecoveryService | 17304 | 17338 | 35 |
| missionSchedulerService | 2272 | 2303 | 32 |
| providerAuthService | 1777 | 1806 | 30 |
| missionRecoveryService | 2343 | 2367 | 25 |
| gatewayChatService | 3329 | 3353 | 25 |
| providerSetupService | 1743 | 1766 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 426 | 448 | 23 |
| runtimeActionService | 17340 | 17360 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 1842 | 1861 | 20 |
| missionStateService | 2245 | 2264 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6672 | 6691 | 20 |
| AGENT_RESOURCE_FILES | 364 | 378 | 15 |
| oauthCallbackService | 1818 | 1832 | 15 |
| gatewayLogService | 3266 | 3279 | 14 |
| RESOURCE_SEED_FILES | 379 | 390 | 12 |
| missionTeamSyncService | 2230 | 2241 | 12 |
| AVATAR_IMAGE_MIME_EXTENSIONS | 313 | 323 | 11 |
| modelCatalogService | 1722 | 1732 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 17398 | 17408 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 14699 | 14708 | 10 |
| COMMAND_CONSOLE_UPLOAD_EXTENSIONS | 261 | 269 | 9 |
| DEFAULT_HEARTBEAT_RUNTIME | 9790 | 9798 | 9 |
| missionReportService | 2219 | 2226 | 8 |
| gatewayDiagnostics | 3561 | 3567 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 13130 | 13136 | 7 |
| loginAttempts | 159 | 164 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 13985 | 13990 | 6 |
| OPENCLAW_STATE_ROOT | 214 | 218 | 5 |
| OPENCLAW_CONFIG_PATH | 220 | 224 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 225 | 229 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1511 | 1515 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1530 | 1534 | 5 |
| STATIC_ROOT | 18952 | 18956 | 5 |
| sessionTokens | 155 | 158 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 253 | 256 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1518 | 1521 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1522 | 1525 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1526 | 1529 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3204 | 3207 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3208 | 3211 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3212 | 3215 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3216 | 3219 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3220 | 3223 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3224 | 3227 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3228 | 3231 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3232 | 3235 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 16444 | 16447 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 397 | 399 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 400 | 402 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 403 | 405 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 406 | 408 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 410 | 412 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 413 | 415 | 3 |
| AUTO_START_GATEWAY | 416 | 418 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 450 | 452 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1080 | 1082 | 3 |
| EDITOR_RESOURCE_FILES | 1401 | 1403 | 3 |
| installOpenClawPlugin | 548 | 549 | 2 |
| updateOpenClawPlugin | 551 | 552 | 2 |
| updateAllOpenClawPlugins | 554 | 555 | 2 |
| uninstallOpenClawPlugin | 557 | 558 | 2 |
| inspectOpenClawPluginRuntime | 565 | 566 | 2 |
| pluginRuntimeInspectReady | 568 | 569 | 2 |
| stopAllPluginSetupTerminalSessions | 571 | 572 | 2 |
| ensureConfiguredModelAllowlist | 1734 | 1735 | 2 |
| ensureOpenRouterModelCatalogAllowlist | 1736 | 1737 | 2 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 7832 | 7833 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 7835 | 7836 | 2 |
| CLAWTALK_DOCTOR_CHECK_RE | 12193 | 12194 | 2 |
| app | 149 | 149 | 1 |
| PORT | 151 | 151 | 1 |
| CONFIGURED_AUTH_TOKEN | 152 | 152 | 1 |
| AUTH_TOKEN | 153 | 153 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
