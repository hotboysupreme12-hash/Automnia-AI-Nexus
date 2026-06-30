# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 17,953 |
| Control-plane bytes | 723,250 |
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
| registerDiagnosticsRoutes | 16181 | 21 |
| registerCommandConsoleFileRoutes | 16203 | 5 |
| registerOpenClawCommandRoutes | 16209 | 15 |
| registerRuntimeRoutes | 16283 | 6 |
| registerPluginRoutes | 16290 | 22 |
| registerPartyManagementRoutes | 16798 | 1 |
| registerFilesystemRoutes | 16800 | 26 |
| registerPartyCoordinationRoutes | 16827 | 44 |
| registerMissionRoutes | 16872 | 6 |
| registerAgentTurnRoutes | 17494 | 85 |
| registerClawTalkConsoleRoutes | 17580 | 24 |
| registerBrowserRoutes | 17606 | 1 |
| registerShiftRoutes | 17729 | 16 |
| registerProviderAuthRoutes | 17746 | 19 |
| registerSkillRoutes | 17766 | 14 |
| registerAgentConfigRoutes | 17861 | 1 |
| registerAuthRoutes | 17863 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 17210 | 17492 | 283 |
| function | runBufferedAgentTurnForStream | 16879 | 17075 | 197 |
| function | runDoctorChecks | 15979 | 16145 | 167 |
| function | doctorGuidedActionForFinding | 15482 | 15628 | 147 |
| type | OpenClawConfigFile | 1130 | 1267 | 138 |
| function | runGatewayAgentTurnForStream | 17077 | 17208 | 132 |
| function | generateRecruitAutoForgeMarkdown | 16520 | 16648 | 129 |
| function | buildDefaultAgentLocalConfig | 12977 | 13104 | 128 |
| function | checkBrowserPreflight | 7766 | 7891 | 126 |
| function | createShiftFromPayload | 17609 | 17727 | 119 |
| function | ensureOpenclawRuntimeDefaults | 8657 | 8771 | 115 |
| function | runControlCenterAgentRuntimeTurn | 13875 | 13986 | 112 |
| function | patchedClawTalkCoreBridgeSource | 9795 | 9904 | 110 |
| function | runOpenClaw | 5008 | 5113 | 106 |
| function | streamOpenAiResponsesCompletion | 5860 | 5943 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 14187 | 14269 | 83 |
| function | openAgentSessionSnapshots | 3705 | 3786 | 82 |
| function | defaultAgentResourceContent | 12269 | 12349 | 81 |
| function | generateGoogleVertexArtifactContent | 14030 | 14106 | 77 |
| function | startManagedTeamSyncOrchestrator | 15093 | 15167 | 75 |
| type | AgentLocalConfig | 1287 | 1360 | 74 |
| function | purgeAgentState | 12157 | 12228 | 72 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 13758 | 13828 | 71 |
| function | approveLocalDevicePairingRequest | 7338 | 7406 | 69 |
| function | inferWorkspaceRuntimeIntent | 6601 | 6668 | 68 |
| function | inspectOpenClawSessionLock | 4599 | 4665 | 67 |
| function | streamGoogleVertexContent | 6389 | 6455 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 11147 | 11213 | 67 |
| function | repairCodexPluginPostInstallState | 10754 | 10819 | 66 |
| type | PartyManagementRoutesContext | 16664 | 16729 | 66 |
| variable | partyManagementRoutesContext | 16731 | 16796 | 66 |
| function | seedAgentWorkspace | 13334 | 13398 | 65 |
| function | repairGatewayTokenConfigSync | 1973 | 2036 | 64 |
| function | cleanupOpenClawSessionLocks | 4747 | 4810 | 64 |
| function | extractAgentReply | 6983 | 7046 | 64 |
| function | tryReleaseTcpPortUnix | 7597 | 7660 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 11014 | 11077 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 3041 | 3103 | 63 |
| function | resolveSharedTeamSyncPath | 13437 | 13499 | 63 |
| function | applyGoogleGeminiPluginPolicy | 13694 | 13756 | 63 |
| function | patchedTelegramBotRuntimeSource | 9922 | 9983 | 62 |
| function | getPartyMembers | 15169 | 15228 | 60 |
| function | recruitAutoForgePrompt | 16427 | 16486 | 60 |
| function | buildMissionPrompt | 13274 | 13332 | 59 |
| function | streamGeminiContent | 6156 | 6213 | 58 |
| function | runBrowserToolProbe | 7708 | 7764 | 57 |
| function | writeOpenclawConfig | 9015 | 9070 | 56 |
| function | postLocalJsonNoHeaderTimeout | 6493 | 6547 | 55 |
| function | tryReleaseGatewayPort | 7541 | 7595 | 55 |
| function | tryReleaseBrowserRelayPort | 7486 | 7539 | 54 |
| function | readOpenclawConfig | 8256 | 8309 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 10833 | 10886 | 54 |
| function | requestGatewaySessionAbort | 2617 | 2668 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 10161 | 10212 | 52 |
| function | streamOpenAICodexResponsesCompletion | 6059 | 6109 | 51 |
| function | resolveFilenameHintsForMessage | 14394 | 14444 | 51 |
| function | listActiveCronJobsFromStateDb | 14880 | 14930 | 51 |
| function | recruitPersonalityDepthGuidance | 16350 | 16400 | 51 |
| function | inspectOpenClawSessionLocks | 4696 | 4745 | 50 |
| function | savePluginDirectConfig | 10641 | 10690 | 50 |
| function | syncAgentDerivedFiles | 12679 | 12728 | 50 |
| function | composeAgentDoctrinePrompt | 12730 | 12779 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 14976 | 15024 | 49 |
| function | readSkillEntryFromDir | 11472 | 11519 | 48 |
| function | appendAgentPromptDump | 12797 | 12844 | 48 |
| function | createInitialOpenclawConfig | 8158 | 8204 | 47 |
| function | ensureClawTalkManifestContracts | 9684 | 9730 | 47 |
| function | normalizeModelWithFallback | 12516 | 12562 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 14703 | 14749 | 47 |
| variable | gatewayLifecycle | 3552 | 3597 | 46 |
| function | streamOpenAiCompatibleCompletion | 5813 | 5858 | 46 |
| function | tryStartBrowserRelay | 7439 | 7484 | 46 |
| function | openClawOptimizationStatus | 8111 | 8156 | 46 |
| function | openClawDoctorLintCheck | 15932 | 15977 | 46 |
| function | terminateProcessTree | 928 | 972 | 45 |
| function | checkGoogleVertexModelAvailability | 6268 | 6312 | 45 |
| function | syncDoctrineToWorkspace | 13544 | 13588 | 45 |
| function | streamAnthropicMessage | 6111 | 6154 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 8850 | 8893 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1427 | 1469 | 43 |
| function | normalizeOpenClawConfigModelRefs | 8613 | 8655 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 11651 | 11693 | 43 |
| function | applyLocalConfigToGlobal | 13141 | 13183 | 43 |
| function | spawnText | 3367 | 3408 | 42 |
| function | contentTypeFromExt | 4012 | 4053 | 42 |
| function | toOpenAICodexContext | 5997 | 6038 | 42 |
| function | firstJsonSliceFromText | 10302 | 10343 | 42 |
| function | seedCanonicalResourceIfMissing | 11886 | 11927 | 42 |
| function | buildDoctrineSyncReport | 14282 | 14323 | 42 |
| function | persistAgentAvatarFromPath | 6853 | 6893 | 41 |
| function | launchChromeHost | 6895 | 6935 | 41 |
| function | splitPluginCommandLine | 10438 | 10478 | 41 |
| variable | runtimeStatusService | 3646 | 3685 | 40 |
| function | appendGoogleVertexPayloadDump | 12846 | 12884 | 39 |
| type | AgentConfigRoutesContext | 17781 | 17819 | 39 |
| variable | agentConfigRoutesContext | 17821 | 17859 | 39 |
| function | prepareOpenClawConfigForGatewayStartup | 3485 | 3522 | 38 |
| function | bufferedAgentRuntimeReason | 6670 | 6707 | 38 |
| function | persistAgentAvatarBytes | 6814 | 6851 | 38 |
| function | listActiveControlCenterCronExpiryRowsFromStateDb | 14751 | 14788 | 38 |
| function | buildAgentRuntimePreflightChecks | 4949 | 4985 | 37 |
| function | normalizePluginSearchResult | 10374 | 10410 | 37 |
| variable | STREAMING_PROVIDER_CONFIG | 5220 | 5255 | 36 |
| function | ensureClawTalkApiKeyMaterial | 9325 | 9360 | 36 |
| function | saveClawTalkSetupConfig | 11278 | 11313 | 36 |
| function | normalizeAgentToolsConfig | 4353 | 4387 | 35 |
| function | parseSkillFrontmatter | 11410 | 11444 | 35 |
| variable | runtimeRecoveryService | 16225 | 16259 | 35 |
| function | clearDisallowedAutoModelOverridesForAgent | 3105 | 3138 | 34 |
| function | isClawTalkIntentMessage | 7085 | 7118 | 34 |
| function | migrateLegacyOpenAiCodexProviderConfig | 8404 | 8437 | 34 |
| function | applyDeepSeekOnlyRuntimeDefaults | 8521 | 8554 | 34 |
| function | resolveAgentResourceContext | 11934 | 11967 | 34 |
| function | syncAllAgentLocalConfigs | 13239 | 13272 | 34 |
| function | cronRowToRuntimeCronJob | 14845 | 14878 | 34 |
| function | finishOpenClawRun | 2893 | 2925 | 33 |
| function | closeControlServerForShutdown | 3935 | 3967 | 33 |
| function | normalizeAgentMdsState | 4172 | 4204 | 33 |
| function | ensureAgentSandboxCompatibleWithHost | 13205 | 13237 | 33 |
| function | looksLikeGeneratedWorkspaceDoctrineContent | 14144 | 14176 | 33 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 17210 | 17492 | 283 |
| runBufferedAgentTurnForStream | 16879 | 17075 | 197 |
| runDoctorChecks | 15979 | 16145 | 167 |
| doctorGuidedActionForFinding | 15482 | 15628 | 147 |
| runGatewayAgentTurnForStream | 17077 | 17208 | 132 |
| generateRecruitAutoForgeMarkdown | 16520 | 16648 | 129 |
| buildDefaultAgentLocalConfig | 12977 | 13104 | 128 |
| checkBrowserPreflight | 7766 | 7891 | 126 |
| createShiftFromPayload | 17609 | 17727 | 119 |
| ensureOpenclawRuntimeDefaults | 8657 | 8771 | 115 |
| runControlCenterAgentRuntimeTurn | 13875 | 13986 | 112 |
| patchedClawTalkCoreBridgeSource | 9795 | 9904 | 110 |
| runOpenClaw | 5008 | 5113 | 106 |
| streamOpenAiResponsesCompletion | 5860 | 5943 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 14187 | 14269 | 83 |
| openAgentSessionSnapshots | 3705 | 3786 | 82 |
| defaultAgentResourceContent | 12269 | 12349 | 81 |
| generateGoogleVertexArtifactContent | 14030 | 14106 | 77 |
| startManagedTeamSyncOrchestrator | 15093 | 15167 | 75 |
| purgeAgentState | 12157 | 12228 | 72 |
| writeGoogleGeminiMinimalOpenClawConfig | 13758 | 13828 | 71 |
| approveLocalDevicePairingRequest | 7338 | 7406 | 69 |
| inferWorkspaceRuntimeIntent | 6601 | 6668 | 68 |
| inspectOpenClawSessionLock | 4599 | 4665 | 67 |
| streamGoogleVertexContent | 6389 | 6455 | 67 |
| applyOpenClawPluginEnabledToConfig | 11147 | 11213 | 67 |
| repairCodexPluginPostInstallState | 10754 | 10819 | 66 |
| seedAgentWorkspace | 13334 | 13398 | 65 |
| repairGatewayTokenConfigSync | 1973 | 2036 | 64 |
| cleanupOpenClawSessionLocks | 4747 | 4810 | 64 |
| extractAgentReply | 6983 | 7046 | 64 |
| tryReleaseTcpPortUnix | 7597 | 7660 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 11014 | 11077 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 3041 | 3103 | 63 |
| resolveSharedTeamSyncPath | 13437 | 13499 | 63 |
| applyGoogleGeminiPluginPolicy | 13694 | 13756 | 63 |
| patchedTelegramBotRuntimeSource | 9922 | 9983 | 62 |
| getPartyMembers | 15169 | 15228 | 60 |
| recruitAutoForgePrompt | 16427 | 16486 | 60 |
| buildMissionPrompt | 13274 | 13332 | 59 |
| streamGeminiContent | 6156 | 6213 | 58 |
| runBrowserToolProbe | 7708 | 7764 | 57 |
| writeOpenclawConfig | 9015 | 9070 | 56 |
| postLocalJsonNoHeaderTimeout | 6493 | 6547 | 55 |
| tryReleaseGatewayPort | 7541 | 7595 | 55 |
| tryReleaseBrowserRelayPort | 7486 | 7539 | 54 |
| readOpenclawConfig | 8256 | 8309 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 10833 | 10886 | 54 |
| requestGatewaySessionAbort | 2617 | 2668 | 52 |
| ensureClawTalkBundledPluginDefaults | 10161 | 10212 | 52 |
| streamOpenAICodexResponsesCompletion | 6059 | 6109 | 51 |
| resolveFilenameHintsForMessage | 14394 | 14444 | 51 |
| listActiveCronJobsFromStateDb | 14880 | 14930 | 51 |
| recruitPersonalityDepthGuidance | 16350 | 16400 | 51 |
| inspectOpenClawSessionLocks | 4696 | 4745 | 50 |
| savePluginDirectConfig | 10641 | 10690 | 50 |
| syncAgentDerivedFiles | 12679 | 12728 | 50 |
| composeAgentDoctrinePrompt | 12730 | 12779 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 14976 | 15024 | 49 |
| readSkillEntryFromDir | 11472 | 11519 | 48 |
| appendAgentPromptDump | 12797 | 12844 | 48 |
| createInitialOpenclawConfig | 8158 | 8204 | 47 |
| ensureClawTalkManifestContracts | 9684 | 9730 | 47 |
| normalizeModelWithFallback | 12516 | 12562 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 14703 | 14749 | 47 |
| streamOpenAiCompatibleCompletion | 5813 | 5858 | 46 |
| tryStartBrowserRelay | 7439 | 7484 | 46 |
| openClawOptimizationStatus | 8111 | 8156 | 46 |
| openClawDoctorLintCheck | 15932 | 15977 | 46 |
| terminateProcessTree | 928 | 972 | 45 |
| checkGoogleVertexModelAvailability | 6268 | 6312 | 45 |
| syncDoctrineToWorkspace | 13544 | 13588 | 45 |
| streamAnthropicMessage | 6111 | 6154 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 8850 | 8893 | 44 |
| normalizeOpenClawConfigModelRefs | 8613 | 8655 | 43 |
| runOpenClawWithManagedSkillsWorkspace | 11651 | 11693 | 43 |
| applyLocalConfigToGlobal | 13141 | 13183 | 43 |
| spawnText | 3367 | 3408 | 42 |
| contentTypeFromExt | 4012 | 4053 | 42 |
| toOpenAICodexContext | 5997 | 6038 | 42 |
| firstJsonSliceFromText | 10302 | 10343 | 42 |
| seedCanonicalResourceIfMissing | 11886 | 11927 | 42 |
| buildDoctrineSyncReport | 14282 | 14323 | 42 |
| persistAgentAvatarFromPath | 6853 | 6893 | 41 |
| launchChromeHost | 6895 | 6935 | 41 |
| splitPluginCommandLine | 10438 | 10478 | 41 |
| appendGoogleVertexPayloadDump | 12846 | 12884 | 39 |
| prepareOpenClawConfigForGatewayStartup | 3485 | 3522 | 38 |
| bufferedAgentRuntimeReason | 6670 | 6707 | 38 |
| persistAgentAvatarBytes | 6814 | 6851 | 38 |
| listActiveControlCenterCronExpiryRowsFromStateDb | 14751 | 14788 | 38 |
| buildAgentRuntimePreflightChecks | 4949 | 4985 | 37 |
| normalizePluginSearchResult | 10374 | 10410 | 37 |
| ensureClawTalkApiKeyMaterial | 9325 | 9360 | 36 |
| saveClawTalkSetupConfig | 11278 | 11313 | 36 |
| normalizeAgentToolsConfig | 4353 | 4387 | 35 |
| parseSkillFrontmatter | 11410 | 11444 | 35 |
| clearDisallowedAutoModelOverridesForAgent | 3105 | 3138 | 34 |
| isClawTalkIntentMessage | 7085 | 7118 | 34 |
| migrateLegacyOpenAiCodexProviderConfig | 8404 | 8437 | 34 |
| applyDeepSeekOnlyRuntimeDefaults | 8521 | 8554 | 34 |
| resolveAgentResourceContext | 11934 | 11967 | 34 |
| syncAllAgentLocalConfigs | 13239 | 13272 | 34 |
| cronRowToRuntimeCronJob | 14845 | 14878 | 34 |
| finishOpenClawRun | 2893 | 2925 | 33 |
| closeControlServerForShutdown | 3935 | 3967 | 33 |
| normalizeAgentMdsState | 4172 | 4204 | 33 |
| ensureAgentSandboxCompatibleWithHost | 13205 | 13237 | 33 |
| looksLikeGeneratedWorkspaceDoctrineContent | 14144 | 14176 | 33 |
| authDoctorCheck | 15819 | 15851 | 33 |
| runDoctorRepair | 16147 | 16179 | 33 |
| pluginRuntimeCheck | 4916 | 4947 | 32 |
| compactHttpJsonPayload | 5395 | 5426 | 32 |
| buildDispatchExecutionDirective | 12886 | 12917 | 32 |
| defaultDoctorFindingRepairAction | 15420 | 15451 | 32 |
| handleControlCenterShutdown | 3969 | 3999 | 31 |
| readUpstreamSse | 5567 | 5597 | 31 |
| filterGoogleVertexCatalogModels | 6357 | 6387 | 31 |
| ensureEnabledManagedPluginLoadPaths | 9552 | 9582 | 31 |
| recoverLocalAgentEntries | 12484 | 12514 | 31 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 16731 | 16796 | 66 |
| gatewayLifecycle | 3552 | 3597 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1427 | 1469 | 43 |
| runtimeStatusService | 3646 | 3685 | 40 |
| agentConfigRoutesContext | 17821 | 17859 | 39 |
| STREAMING_PROVIDER_CONFIG | 5220 | 5255 | 36 |
| runtimeRecoveryService | 16225 | 16259 | 35 |
| missionSchedulerService | 2235 | 2266 | 32 |
| providerAuthService | 1740 | 1769 | 30 |
| missionRecoveryService | 2306 | 2330 | 25 |
| gatewayChatService | 3292 | 3316 | 25 |
| providerSetupService | 1706 | 1729 | 24 |
| CLAWTALK_AGENT_TOOL_NAMES | 390 | 412 | 23 |
| runtimeActionService | 16261 | 16281 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 1805 | 1824 | 20 |
| missionStateService | 2208 | 2227 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 6549 | 6568 | 20 |
| AGENT_RESOURCE_FILES | 328 | 342 | 15 |
| oauthCallbackService | 1781 | 1795 | 15 |
| gatewayLogService | 3229 | 3242 | 14 |
| RESOURCE_SEED_FILES | 343 | 354 | 12 |
| missionTeamSyncService | 2193 | 2204 | 12 |
| modelCatalogService | 1685 | 1695 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 16319 | 16329 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 13633 | 13642 | 10 |
| DEFAULT_HEARTBEAT_RUNTIME | 8895 | 8903 | 9 |
| missionReportService | 2182 | 2189 | 8 |
| gatewayDiagnostics | 3524 | 3530 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 12064 | 12070 | 7 |
| loginAttempts | 175 | 180 | 6 |
| pickerSessionService | 320 | 325 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 12919 | 12924 | 6 |
| OPENCLAW_STATE_ROOT | 230 | 234 | 5 |
| OPENCLAW_CONFIG_PATH | 236 | 240 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 241 | 245 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1474 | 1478 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1493 | 1497 | 5 |
| STATIC_ROOT | 17865 | 17869 | 5 |
| sessionTokens | 171 | 174 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 269 | 272 | 4 |
| commandConsoleUploadService | 316 | 319 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1481 | 1484 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1485 | 1488 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1489 | 1492 | 4 |
| RUNTIME_STATUS_CACHE_MS | 3167 | 3170 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 3171 | 3174 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 3175 | 3178 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 3179 | 3182 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 3183 | 3186 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 3187 | 3190 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 3191 | 3194 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 3195 | 3198 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 15365 | 15368 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 361 | 363 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 364 | 366 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 367 | 369 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 370 | 372 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 374 | 376 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 377 | 379 | 3 |
| AUTO_START_GATEWAY | 380 | 382 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 414 | 416 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1043 | 1045 | 3 |
| EDITOR_RESOURCE_FILES | 1364 | 1366 | 3 |
| installOpenClawPlugin | 513 | 514 | 2 |
| updateOpenClawPlugin | 516 | 517 | 2 |
| updateAllOpenClawPlugins | 519 | 520 | 2 |
| uninstallOpenClawPlugin | 522 | 523 | 2 |
| setupClawTalkPlugin | 530 | 531 | 2 |
| inspectOpenClawPluginRuntime | 538 | 539 | 2 |
| pluginRuntimeInspectReady | 541 | 542 | 2 |
| stopAllPluginSetupTerminalSessions | 544 | 545 | 2 |
| ensureConfiguredModelAllowlist | 1697 | 1698 | 2 |
| ensureOpenRouterModelCatalogAllowlist | 1699 | 1700 | 2 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 6937 | 6938 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 6940 | 6941 | 2 |
| app | 165 | 165 | 1 |
| PORT | 167 | 167 | 1 |
| CONFIGURED_AUTH_TOKEN | 168 | 168 | 1 |
| AUTH_TOKEN | 169 | 169 | 1 |
| AUTH_TOKEN_SOURCE | 170 | 170 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
