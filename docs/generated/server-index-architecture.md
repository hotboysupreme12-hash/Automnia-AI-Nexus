# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 28,876 |
| Control-plane bytes | 1,157,117 |
| Top-level imports | 39 |
| Top-level declarations | 1784 |
| Top-level functions | 1263 |
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
| registerDiagnosticsRoutes | 26552 | 21 |
| registerCommandConsoleFileRoutes | 26574 | 5 |
| registerOpenClawCommandRoutes | 26580 | 15 |
| registerRuntimeRoutes | 26618 | 27 |
| registerPluginRoutes | 27182 | 26 |
| registerPartyManagementRoutes | 27694 | 1 |
| registerFilesystemRoutes | 27696 | 34 |
| registerPartyCoordinationRoutes | 27731 | 44 |
| registerMissionRoutes | 27776 | 25 |
| registerAgentTurnRoutes | 28417 | 85 |
| registerClawTalkConsoleRoutes | 28503 | 24 |
| registerBrowserRoutes | 28529 | 1 |
| registerShiftRoutes | 28652 | 16 |
| registerProviderAuthRoutes | 28669 | 19 |
| registerSkillRoutes | 28689 | 14 |
| registerAgentConfigRoutes | 28784 | 1 |
| registerAuthRoutes | 28786 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 28133 | 28415 | 283 |
| function | runBufferedAgentTurnForStream | 27802 | 27998 | 197 |
| class | LightweightGatewayClient | 23299 | 23493 | 195 |
| function | runDoctorChecks | 26351 | 26516 | 166 |
| function | runControlCenterGatewayChatTurn | 23998 | 24157 | 160 |
| function | installOpenClawPlugin | 19083 | 19234 | 152 |
| function | doctorGuidedActionForFinding | 25854 | 26000 | 147 |
| function | ensureGatewayRunningInner | 6178 | 6317 | 140 |
| type | OpenClawConfigFile | 1118 | 1255 | 138 |
| function | runMissionCronRound | 15015 | 15152 | 138 |
| function | launchWindowsFolderPickerSession | 11437 | 11571 | 135 |
| function | runGatewayAgentTurnForStream | 28000 | 28131 | 132 |
| function | launchWindowsImagePickerSession | 11712 | 11840 | 129 |
| function | buildRuntimeStatusPayload | 26646 | 26774 | 129 |
| function | generateRecruitAutoForgeMarkdown | 27416 | 27544 | 129 |
| function | buildDefaultAgentLocalConfig | 21792 | 21919 | 128 |
| function | spawnGateway | 5832 | 5958 | 127 |
| function | checkBrowserPreflight | 13278 | 13403 | 126 |
| function | createShiftFromPayload | 28532 | 28650 | 119 |
| function | ensureOpenclawRuntimeDefaults | 15916 | 16030 | 115 |
| function | runControlCenterAgentRuntimeTurn | 24159 | 24270 | 112 |
| function | patchedClawTalkCoreBridgeSource | 17161 | 17270 | 110 |
| function | runOpenClaw | 8059 | 8164 | 106 |
| function | createRecurringMissionCronJob | 14623 | 14728 | 106 |
| function | startControlCenterGatewayClient | 23707 | 23804 | 98 |
| function | buildRuntimeSummaryPayload | 26776 | 26864 | 89 |
| function | buildBackendMissionReport | 14174 | 14260 | 87 |
| function | googleVertexGcloudStatus | 8761 | 8845 | 85 |
| function | streamOpenAiResponsesCompletion | 10309 | 10392 | 84 |
| function | createMissionCronJob | 14538 | 14621 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 24478 | 24560 | 83 |
| function | openAgentSessionSnapshots | 6526 | 6607 | 82 |
| function | defaultAgentResourceContent | 21084 | 21164 | 81 |
| function | listPluginControls | 19708 | 19785 | 78 |
| function | setupClawTalkPlugin | 20052 | 20128 | 77 |
| function | generateGoogleVertexArtifactContent | 24314 | 24390 | 77 |
| function | ensureGoogleOAuthCallbackServer | 9514 | 9589 | 76 |
| function | startManagedTeamSyncOrchestrator | 25465 | 25539 | 75 |
| type | AgentLocalConfig | 1275 | 1348 | 74 |
| function | missionRolePrompt | 14400 | 14473 | 74 |
| function | purgeAgentState | 20972 | 21043 | 72 |
| function | writeAuthProfileSqlite | 2365 | 2435 | 71 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 22573 | 22643 | 71 |
| function | ensureOpenAICodexOAuthCallbackServer | 9692 | 9761 | 70 |
| function | approveLocalDevicePairingRequest | 12806 | 12874 | 69 |
| function | inferWorkspaceRuntimeIntent | 11050 | 11117 | 68 |
| function | runMissionCronJob | 14788 | 14855 | 68 |
| function | inspectOpenClawSessionLock | 7650 | 7716 | 67 |
| function | streamGoogleVertexContent | 10838 | 10904 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 19787 | 19853 | 67 |
| function | providerAuthStatus | 3254 | 3319 | 66 |
| function | parseGatewayFileLogLine | 5292 | 5357 | 66 |
| function | repairCodexPluginPostInstallState | 19016 | 19081 | 66 |
| type | PartyManagementRoutesContext | 27560 | 27625 | 66 |
| variable | partyManagementRoutesContext | 27627 | 27692 | 66 |
| function | gatewayRestartDiagnostics | 6450 | 6514 | 65 |
| function | pickImageWithOsDialog | 12050 | 12114 | 65 |
| function | seedAgentWorkspace | 22149 | 22213 | 65 |
| function | repairGatewayTokenConfigSync | 3064 | 3127 | 64 |
| function | cleanupOpenClawSessionLocks | 7798 | 7861 | 64 |
| function | extractAgentReply | 12204 | 12267 | 64 |
| function | tryReleaseTcpPortUnix | 13065 | 13128 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 19429 | 19492 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 4344 | 4406 | 63 |
| function | gatewayStatusSnapshot | 6386 | 6448 | 63 |
| function | reconcileMissionGatewaySessions | 13971 | 14033 | 63 |
| function | resolveSharedTeamSyncPath | 22252 | 22314 | 63 |
| function | applyGoogleGeminiPluginPolicy | 22509 | 22571 | 63 |
| function | missionPulseRolePrompt | 14475 | 14536 | 62 |
| function | patchedTelegramBotRuntimeSource | 17288 | 17349 | 62 |
| function | buildPluginControlEntry | 18201 | 18262 | 62 |
| function | pickFolderWithOsDialog | 11959 | 12018 | 60 |
| function | hydrateMissionRecordsFromLedger | 14084 | 14143 | 60 |
| function | getPartyMembers | 25541 | 25600 | 60 |
| function | recruitAutoForgePrompt | 27323 | 27382 | 60 |
| function | buildMissionPrompt | 22089 | 22147 | 59 |
| function | runtimeSummaryPayloadFromStatusPayload | 26866 | 26924 | 59 |
| function | streamGeminiContent | 10605 | 10662 | 58 |
| function | runPickerCommand | 11842 | 11899 | 58 |
| function | getPluginList | 17908 | 17965 | 58 |
| function | runBrowserToolProbe | 13220 | 13276 | 57 |
| function | ensureConfiguredProviderModel | 1924 | 1979 | 56 |
| function | parseClawTalkWsLogLine | 5498 | 5553 | 56 |
| function | writeOpenclawConfig | 16280 | 16335 | 56 |
| function | getRuntimeSummaryPayload | 27125 | 27180 | 56 |
| function | postLocalJsonNoHeaderTimeout | 10942 | 10996 | 55 |
| function | tryReleaseGatewayPort | 13009 | 13063 | 55 |
| function | requestGatewaySessionAbort | 3918 | 3971 | 54 |
| function | normalizeGatewayLogDisplayMessage | 4833 | 4886 | 54 |
| function | tryReleaseBrowserRelayPort | 12954 | 13007 | 54 |
| function | readOpenclawConfig | 15513 | 15566 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 19248 | 19301 | 54 |
| function | minimalRuntimeStatusPayload | 26988 | 27041 | 54 |
| function | loadAvailableModelsFromOpenClaw | 2012 | 2064 | 53 |
| function | discoverGatewayFileLogPaths | 4989 | 5041 | 53 |
| function | refreshPluginListCache | 17848 | 17900 | 53 |
| function | createPlainProcessTerminalModule | 8286 | 8337 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 17527 | 17578 | 52 |
| function | streamOpenAICodexResponsesCompletion | 10508 | 10558 | 51 |
| function | normalizeGatewayStabilityPayload | 23065 | 23115 | 51 |
| function | resolveFilenameHintsForMessage | 24685 | 24735 | 51 |
| function | listActiveCronJobsFromStateDb | 25252 | 25302 | 51 |
| function | recruitPersonalityDepthGuidance | 27246 | 27296 | 51 |
| variable | FALLBACK_MODELS | 1461 | 1510 | 50 |
| function | inspectOpenClawSessionLocks | 7747 | 7796 | 50 |
| function | closeLifecycleHttpServer | 9086 | 9135 | 50 |
| function | savePluginDirectConfig | 18800 | 18849 | 50 |
| function | syncAgentDerivedFiles | 21494 | 21543 | 50 |
| function | composeAgentDoctrinePrompt | 21545 | 21594 | 50 |
| function | abortStaleGatewayChatWaiters | 22827 | 22875 | 49 |
| function | listRehydratableControlCenterShiftsFromStateDb | 25348 | 25396 | 49 |
| function | startPluginSetupTerminalSession | 8401 | 8448 | 48 |
| function | readSkillEntryFromDir | 20287 | 20334 | 48 |
| function | appendAgentPromptDump | 21612 | 21659 | 48 |
| function | waitForGatewayChatRun | 23949 | 23996 | 48 |
| function | tryRestartGatewayService | 13130 | 13176 | 47 |
| function | createInitialOpenclawConfig | 15415 | 15461 | 47 |
| function | ensureClawTalkManifestContracts | 17050 | 17096 | 47 |
| function | normalizeModelWithFallback | 21331 | 21377 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 25075 | 25121 | 47 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 28133 | 28415 | 283 |
| runBufferedAgentTurnForStream | 27802 | 27998 | 197 |
| runDoctorChecks | 26351 | 26516 | 166 |
| runControlCenterGatewayChatTurn | 23998 | 24157 | 160 |
| installOpenClawPlugin | 19083 | 19234 | 152 |
| doctorGuidedActionForFinding | 25854 | 26000 | 147 |
| ensureGatewayRunningInner | 6178 | 6317 | 140 |
| runMissionCronRound | 15015 | 15152 | 138 |
| launchWindowsFolderPickerSession | 11437 | 11571 | 135 |
| runGatewayAgentTurnForStream | 28000 | 28131 | 132 |
| launchWindowsImagePickerSession | 11712 | 11840 | 129 |
| buildRuntimeStatusPayload | 26646 | 26774 | 129 |
| generateRecruitAutoForgeMarkdown | 27416 | 27544 | 129 |
| buildDefaultAgentLocalConfig | 21792 | 21919 | 128 |
| spawnGateway | 5832 | 5958 | 127 |
| checkBrowserPreflight | 13278 | 13403 | 126 |
| createShiftFromPayload | 28532 | 28650 | 119 |
| ensureOpenclawRuntimeDefaults | 15916 | 16030 | 115 |
| runControlCenterAgentRuntimeTurn | 24159 | 24270 | 112 |
| patchedClawTalkCoreBridgeSource | 17161 | 17270 | 110 |
| runOpenClaw | 8059 | 8164 | 106 |
| createRecurringMissionCronJob | 14623 | 14728 | 106 |
| startControlCenterGatewayClient | 23707 | 23804 | 98 |
| buildRuntimeSummaryPayload | 26776 | 26864 | 89 |
| buildBackendMissionReport | 14174 | 14260 | 87 |
| googleVertexGcloudStatus | 8761 | 8845 | 85 |
| streamOpenAiResponsesCompletion | 10309 | 10392 | 84 |
| createMissionCronJob | 14538 | 14621 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 24478 | 24560 | 83 |
| openAgentSessionSnapshots | 6526 | 6607 | 82 |
| defaultAgentResourceContent | 21084 | 21164 | 81 |
| listPluginControls | 19708 | 19785 | 78 |
| setupClawTalkPlugin | 20052 | 20128 | 77 |
| generateGoogleVertexArtifactContent | 24314 | 24390 | 77 |
| ensureGoogleOAuthCallbackServer | 9514 | 9589 | 76 |
| startManagedTeamSyncOrchestrator | 25465 | 25539 | 75 |
| missionRolePrompt | 14400 | 14473 | 74 |
| purgeAgentState | 20972 | 21043 | 72 |
| writeAuthProfileSqlite | 2365 | 2435 | 71 |
| writeGoogleGeminiMinimalOpenClawConfig | 22573 | 22643 | 71 |
| ensureOpenAICodexOAuthCallbackServer | 9692 | 9761 | 70 |
| approveLocalDevicePairingRequest | 12806 | 12874 | 69 |
| inferWorkspaceRuntimeIntent | 11050 | 11117 | 68 |
| runMissionCronJob | 14788 | 14855 | 68 |
| inspectOpenClawSessionLock | 7650 | 7716 | 67 |
| streamGoogleVertexContent | 10838 | 10904 | 67 |
| applyOpenClawPluginEnabledToConfig | 19787 | 19853 | 67 |
| providerAuthStatus | 3254 | 3319 | 66 |
| parseGatewayFileLogLine | 5292 | 5357 | 66 |
| repairCodexPluginPostInstallState | 19016 | 19081 | 66 |
| gatewayRestartDiagnostics | 6450 | 6514 | 65 |
| pickImageWithOsDialog | 12050 | 12114 | 65 |
| seedAgentWorkspace | 22149 | 22213 | 65 |
| repairGatewayTokenConfigSync | 3064 | 3127 | 64 |
| cleanupOpenClawSessionLocks | 7798 | 7861 | 64 |
| extractAgentReply | 12204 | 12267 | 64 |
| tryReleaseTcpPortUnix | 13065 | 13128 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 19429 | 19492 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 4344 | 4406 | 63 |
| gatewayStatusSnapshot | 6386 | 6448 | 63 |
| reconcileMissionGatewaySessions | 13971 | 14033 | 63 |
| resolveSharedTeamSyncPath | 22252 | 22314 | 63 |
| applyGoogleGeminiPluginPolicy | 22509 | 22571 | 63 |
| missionPulseRolePrompt | 14475 | 14536 | 62 |
| patchedTelegramBotRuntimeSource | 17288 | 17349 | 62 |
| buildPluginControlEntry | 18201 | 18262 | 62 |
| pickFolderWithOsDialog | 11959 | 12018 | 60 |
| hydrateMissionRecordsFromLedger | 14084 | 14143 | 60 |
| getPartyMembers | 25541 | 25600 | 60 |
| recruitAutoForgePrompt | 27323 | 27382 | 60 |
| buildMissionPrompt | 22089 | 22147 | 59 |
| runtimeSummaryPayloadFromStatusPayload | 26866 | 26924 | 59 |
| streamGeminiContent | 10605 | 10662 | 58 |
| runPickerCommand | 11842 | 11899 | 58 |
| getPluginList | 17908 | 17965 | 58 |
| runBrowserToolProbe | 13220 | 13276 | 57 |
| ensureConfiguredProviderModel | 1924 | 1979 | 56 |
| parseClawTalkWsLogLine | 5498 | 5553 | 56 |
| writeOpenclawConfig | 16280 | 16335 | 56 |
| getRuntimeSummaryPayload | 27125 | 27180 | 56 |
| postLocalJsonNoHeaderTimeout | 10942 | 10996 | 55 |
| tryReleaseGatewayPort | 13009 | 13063 | 55 |
| requestGatewaySessionAbort | 3918 | 3971 | 54 |
| normalizeGatewayLogDisplayMessage | 4833 | 4886 | 54 |
| tryReleaseBrowserRelayPort | 12954 | 13007 | 54 |
| readOpenclawConfig | 15513 | 15566 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 19248 | 19301 | 54 |
| minimalRuntimeStatusPayload | 26988 | 27041 | 54 |
| loadAvailableModelsFromOpenClaw | 2012 | 2064 | 53 |
| discoverGatewayFileLogPaths | 4989 | 5041 | 53 |
| refreshPluginListCache | 17848 | 17900 | 53 |
| createPlainProcessTerminalModule | 8286 | 8337 | 52 |
| ensureClawTalkBundledPluginDefaults | 17527 | 17578 | 52 |
| streamOpenAICodexResponsesCompletion | 10508 | 10558 | 51 |
| normalizeGatewayStabilityPayload | 23065 | 23115 | 51 |
| resolveFilenameHintsForMessage | 24685 | 24735 | 51 |
| listActiveCronJobsFromStateDb | 25252 | 25302 | 51 |
| recruitPersonalityDepthGuidance | 27246 | 27296 | 51 |
| inspectOpenClawSessionLocks | 7747 | 7796 | 50 |
| closeLifecycleHttpServer | 9086 | 9135 | 50 |
| savePluginDirectConfig | 18800 | 18849 | 50 |
| syncAgentDerivedFiles | 21494 | 21543 | 50 |
| composeAgentDoctrinePrompt | 21545 | 21594 | 50 |
| abortStaleGatewayChatWaiters | 22827 | 22875 | 49 |
| listRehydratableControlCenterShiftsFromStateDb | 25348 | 25396 | 49 |
| startPluginSetupTerminalSession | 8401 | 8448 | 48 |
| readSkillEntryFromDir | 20287 | 20334 | 48 |
| appendAgentPromptDump | 21612 | 21659 | 48 |
| waitForGatewayChatRun | 23949 | 23996 | 48 |
| tryRestartGatewayService | 13130 | 13176 | 47 |
| createInitialOpenclawConfig | 15415 | 15461 | 47 |
| ensureClawTalkManifestContracts | 17050 | 17096 | 47 |
| normalizeModelWithFallback | 21331 | 21377 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 25075 | 25121 | 47 |
| streamOpenAiCompatibleCompletion | 10262 | 10307 | 46 |
| tryStartBrowserRelay | 12907 | 12952 | 46 |
| openClawOptimizationStatus | 15368 | 15413 | 46 |
| openClawDoctorLintCheck | 26304 | 26349 | 46 |
| terminateProcessTree | 909 | 953 | 45 |
| removeProviderAuthProfiles | 2762 | 2806 | 45 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 27627 | 27692 | 66 |
| FALLBACK_MODELS | 1461 | 1510 | 50 |
| MODEL_RESILIENCE_FALLBACKS | 1522 | 1564 | 43 |
| COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 224 | 263 | 40 |
| agentConfigRoutesContext | 28744 | 28782 | 39 |
| PLUGIN_CATALOG | 17580 | 17616 | 37 |
| STREAMING_PROVIDER_CONFIG | 8498 | 8533 | 36 |
| AUTH_PROVIDER_PROFILE_ALIASES | 2457 | 2489 | 33 |
| CLAWTALK_AGENT_TOOL_NAMES | 388 | 410 | 23 |
| DEFAULT_BOOTSTRAP_AGENTS | 2117 | 2136 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 10998 | 11017 | 20 |
| AGENT_RESOURCE_FILES | 326 | 340 | 15 |
| RESOURCE_SEED_FILES | 341 | 352 | 12 |
| AVATAR_IMAGE_MIME_EXTENSIONS | 266 | 276 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 27215 | 27225 | 11 |
| CONTROL_CENTER_STATE_KEYS | 182 | 191 | 10 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 22448 | 22457 | 10 |
| COMMAND_CONSOLE_UPLOAD_EXTENSIONS | 214 | 222 | 9 |
| DEFAULT_HEARTBEAT_RUNTIME | 16154 | 16162 | 9 |
| controlCenterShutdownInFlight | 6805 | 6812 | 8 |
| GOOGLE_VERTEX_LOCATION_KEYS | 1435 | 1441 | 7 |
| PLUGIN_SETUP_TERMINAL_COMMANDS | 8273 | 8279 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 20879 | 20885 | 7 |
| loginAttempts | 87 | 92 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 21734 | 21739 | 6 |
| OPENCLAW_STATE_ROOT | 142 | 146 | 5 |
| OPENCLAW_CONFIG_PATH | 148 | 152 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 153 | 157 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1570 | 1574 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1589 | 1593 | 5 |
| STATIC_ROOT | 28788 | 28792 | 5 |
| sessionTokens | 83 | 86 | 4 |
| GATEWAY_LOG_PATH_DISCOVERY_CACHE_MS | 201 | 204 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 206 | 209 | 4 |
| KNOWN_UNAVAILABLE_MODEL_IDS | 1511 | 1514 | 4 |
| OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS | 1515 | 1518 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1577 | 1580 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1581 | 1584 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1585 | 1588 | 4 |
| EXTERNAL_GATEWAY_LOG_CACHE_MS | 4562 | 4565 | 4 |
| RUNTIME_STATUS_CACHE_MS | 4566 | 4569 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 4570 | 4573 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 4574 | 4577 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 4578 | 4581 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 4582 | 4585 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 4586 | 4589 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 4590 | 4593 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 4594 | 4597 | 4 |
| GATEWAY_CLIENT_READY_TIMEOUT_MS | 22773 | 22776 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 25737 | 25740 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 359 | 361 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 362 | 364 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 365 | 367 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 368 | 370 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 372 | 374 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 375 | 377 | 3 |
| AUTO_START_GATEWAY | 378 | 380 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 412 | 414 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1024 | 1026 | 3 |
| EDITOR_RESOURCE_FILES | 1352 | 1354 | 3 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 12158 | 12159 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 12161 | 12162 | 2 |
| CLAWTALK_DOCTOR_CHECK_RE | 19942 | 19943 | 2 |
| app | 77 | 77 | 1 |
| PORT | 79 | 79 | 1 |
| CONFIGURED_AUTH_TOKEN | 80 | 80 | 1 |
| AUTH_TOKEN | 81 | 81 | 1 |
| AUTH_TOKEN_SOURCE | 82 | 82 | 1 |
| CONTROL_CENTER_FRONTEND_PORT | 93 | 93 | 1 |
| controlServer | 109 | 109 | 1 |
| optionalRequire | 110 | 110 | 1 |
| WORKSPACE_ROOT | 124 | 124 | 1 |
| HOME_DIR | 125 | 125 | 1 |
| NATIVE_OPENCLAW_STATE_ROOT | 126 | 126 | 1 |
| CONFIGURED_OPENCLAW_STATE_ROOT | 141 | 141 | 1 |
| OPENCLAW_PROFILE | 147 | 147 | 1 |
| OPENCLAW_ENV_PATH | 158 | 158 | 1 |
| HEARTBEAT_DEFAULTS_PATH | 163 | 163 | 1 |
| HEARTBEAT_AGENT_DEFAULTS_PATH | 164 | 164 | 1 |
| RETIRED_AGENT_IDS_PATH | 165 | 165 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
