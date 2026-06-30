# Server Composition Architecture Report

Generated from `server/index.ts` and `server/controlPlane.ts` by `scripts/report-server-index-architecture.mjs`.

## Snapshot

| Metric | Value |
| --- | ---: |
| Executable entrypoint lines | 9 |
| Control-plane composition lines | 22,963 |
| Control-plane bytes | 915,788 |
| Top-level imports | 50 |
| Top-level declarations | 1481 |
| Top-level functions | 1053 |
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
| registerDiagnosticsRoutes | 21179 | 21 |
| registerCommandConsoleFileRoutes | 21201 | 5 |
| registerOpenClawCommandRoutes | 21207 | 15 |
| registerRuntimeRoutes | 21281 | 6 |
| registerPluginRoutes | 21288 | 26 |
| registerPartyManagementRoutes | 21800 | 1 |
| registerFilesystemRoutes | 21802 | 34 |
| registerPartyCoordinationRoutes | 21837 | 44 |
| registerMissionRoutes | 21882 | 6 |
| registerAgentTurnRoutes | 22504 | 85 |
| registerClawTalkConsoleRoutes | 22590 | 24 |
| registerBrowserRoutes | 22616 | 1 |
| registerShiftRoutes | 22739 | 16 |
| registerProviderAuthRoutes | 22756 | 19 |
| registerSkillRoutes | 22776 | 14 |
| registerAgentConfigRoutes | 22871 | 1 |
| registerAuthRoutes | 22873 | 1 |

## Inline Express Routes In The Composition Module

| Method | Route expression | Line | Span |
| --- | --- | ---: | ---: |
| _None_ | | | |

## Largest Top-Level Declarations

| Kind | Name | Start | End | Lines |
| --- | --- | ---: | ---: | ---: |
| function | streamProviderAgentTurn | 22220 | 22502 | 283 |
| function | runBufferedAgentTurnForStream | 21889 | 22085 | 197 |
| function | runDoctorChecks | 20977 | 21143 | 167 |
| function | installOpenClawPlugin | 15253 | 15404 | 152 |
| function | doctorGuidedActionForFinding | 20480 | 20626 | 147 |
| type | OpenClawConfigFile | 1095 | 1232 | 138 |
| function | launchWindowsFolderPickerSession | 9666 | 9800 | 135 |
| function | runGatewayAgentTurnForStream | 22087 | 22218 | 132 |
| function | launchWindowsImagePickerSession | 9941 | 10069 | 129 |
| function | generateRecruitAutoForgeMarkdown | 21522 | 21650 | 129 |
| function | buildDefaultAgentLocalConfig | 17962 | 18089 | 128 |
| function | checkBrowserPreflight | 11216 | 11341 | 126 |
| function | createShiftFromPayload | 22619 | 22737 | 119 |
| function | ensureOpenclawRuntimeDefaults | 12109 | 12223 | 115 |
| function | runControlCenterAgentRuntimeTurn | 18860 | 18971 | 112 |
| function | patchedClawTalkCoreBridgeSource | 13348 | 13457 | 110 |
| function | runOpenClaw | 6288 | 6393 | 106 |
| function | googleVertexGcloudStatus | 6990 | 7074 | 85 |
| function | streamOpenAiResponsesCompletion | 8538 | 8621 | 84 |
| function | cleanupAgentWorkspaceDoctrineFiles | 19179 | 19261 | 83 |
| function | openAgentSessionSnapshots | 4896 | 4977 | 82 |
| function | defaultAgentResourceContent | 17254 | 17334 | 81 |
| function | listPluginControls | 15878 | 15955 | 78 |
| function | setupClawTalkPlugin | 16222 | 16298 | 77 |
| function | generateGoogleVertexArtifactContent | 19015 | 19091 | 77 |
| function | ensureGoogleOAuthCallbackServer | 7743 | 7818 | 76 |
| function | startManagedTeamSyncOrchestrator | 20091 | 20165 | 75 |
| type | AgentLocalConfig | 1252 | 1325 | 74 |
| function | purgeAgentState | 17142 | 17213 | 72 |
| function | writeAuthProfileSqlite | 2334 | 2404 | 71 |
| function | writeGoogleGeminiMinimalOpenClawConfig | 18743 | 18813 | 71 |
| function | ensureOpenAICodexOAuthCallbackServer | 7921 | 7990 | 70 |
| function | approveLocalDevicePairingRequest | 10788 | 10856 | 69 |
| function | inferWorkspaceRuntimeIntent | 9279 | 9346 | 68 |
| function | inspectOpenClawSessionLock | 5879 | 5945 | 67 |
| function | streamGoogleVertexContent | 9067 | 9133 | 67 |
| function | applyOpenClawPluginEnabledToConfig | 15957 | 16023 | 67 |
| function | providerAuthStatus | 3250 | 3315 | 66 |
| function | repairCodexPluginPostInstallState | 15186 | 15251 | 66 |
| type | PartyManagementRoutesContext | 21666 | 21731 | 66 |
| variable | partyManagementRoutesContext | 21733 | 21798 | 66 |
| function | pickImageWithOsDialog | 10279 | 10343 | 65 |
| function | seedAgentWorkspace | 18319 | 18383 | 65 |
| function | repairGatewayTokenConfigSync | 3033 | 3096 | 64 |
| function | cleanupOpenClawSessionLocks | 6027 | 6090 | 64 |
| function | extractAgentReply | 10433 | 10496 | 64 |
| function | tryReleaseTcpPortUnix | 11047 | 11110 | 64 |
| function | applyPluginToggleViaGatewayConfigPatch | 15599 | 15662 | 64 |
| function | clearDisallowedAutoModelOverrideFromEntry | 4232 | 4294 | 63 |
| function | resolveSharedTeamSyncPath | 18422 | 18484 | 63 |
| function | applyGoogleGeminiPluginPolicy | 18679 | 18741 | 63 |
| function | patchedTelegramBotRuntimeSource | 13475 | 13536 | 62 |
| function | buildPluginControlEntry | 14388 | 14449 | 62 |
| function | pickFolderWithOsDialog | 10188 | 10247 | 60 |
| function | getPartyMembers | 20167 | 20226 | 60 |
| function | recruitAutoForgePrompt | 21429 | 21488 | 60 |
| function | buildMissionPrompt | 18259 | 18317 | 59 |
| function | streamGeminiContent | 8834 | 8891 | 58 |
| function | runPickerCommand | 10071 | 10128 | 58 |
| function | getPluginList | 14095 | 14152 | 58 |
| function | runBrowserToolProbe | 11158 | 11214 | 57 |
| function | ensureConfiguredProviderModel | 1893 | 1948 | 56 |
| function | writeOpenclawConfig | 12467 | 12522 | 56 |
| function | postLocalJsonNoHeaderTimeout | 9171 | 9225 | 55 |
| function | tryReleaseGatewayPort | 10991 | 11045 | 55 |
| function | tryReleaseBrowserRelayPort | 10936 | 10989 | 54 |
| function | readOpenclawConfig | 11706 | 11759 | 54 |
| function | ensureCodexPluginInstalledForOpenAiRuntime | 15418 | 15471 | 54 |
| function | loadAvailableModelsFromOpenClaw | 1981 | 2033 | 53 |
| function | refreshPluginListCache | 14035 | 14087 | 53 |
| function | requestGatewaySessionAbort | 3808 | 3859 | 52 |
| function | createPlainProcessTerminalModule | 6515 | 6566 | 52 |
| function | ensureClawTalkBundledPluginDefaults | 13714 | 13765 | 52 |
| function | streamOpenAICodexResponsesCompletion | 8737 | 8787 | 51 |
| function | resolveFilenameHintsForMessage | 19386 | 19436 | 51 |
| function | listActiveCronJobsFromStateDb | 19878 | 19928 | 51 |
| function | recruitPersonalityDepthGuidance | 21352 | 21402 | 51 |
| variable | FALLBACK_MODELS | 1430 | 1479 | 50 |
| function | inspectOpenClawSessionLocks | 5976 | 6025 | 50 |
| function | closeLifecycleHttpServer | 7315 | 7364 | 50 |
| function | savePluginDirectConfig | 14987 | 15036 | 50 |
| function | syncAgentDerivedFiles | 17664 | 17713 | 50 |
| function | composeAgentDoctrinePrompt | 17715 | 17764 | 50 |
| function | listRehydratableControlCenterShiftsFromStateDb | 19974 | 20022 | 49 |
| function | startPluginSetupTerminalSession | 6630 | 6677 | 48 |
| function | readSkillEntryFromDir | 16457 | 16504 | 48 |
| function | appendAgentPromptDump | 17782 | 17829 | 48 |
| function | createInitialOpenclawConfig | 11608 | 11654 | 47 |
| function | ensureClawTalkManifestContracts | 13237 | 13283 | 47 |
| function | normalizeModelWithFallback | 17501 | 17547 | 47 |
| function | listMissionCronReconciliationSnapshotFromStateDb | 19701 | 19747 | 47 |
| variable | gatewayLifecycle | 4743 | 4788 | 46 |
| function | streamOpenAiCompatibleCompletion | 8491 | 8536 | 46 |
| function | tryStartBrowserRelay | 10889 | 10934 | 46 |
| function | openClawOptimizationStatus | 11561 | 11606 | 46 |
| function | openClawDoctorLintCheck | 20930 | 20975 | 46 |
| function | terminateProcessTree | 886 | 930 | 45 |
| function | removeProviderAuthProfiles | 2731 | 2775 | 45 |
| function | checkGoogleVertexModelAvailability | 8946 | 8990 | 45 |
| function | normalizeOpenClawConfigModelRefs | 12063 | 12107 | 45 |
| function | schemaConfigFieldsFromRaw | 14277 | 14321 | 45 |
| function | syncDoctrineToWorkspace | 18529 | 18573 | 45 |
| function | exchangeGoogleOAuthCodeForTokens | 7535 | 7578 | 44 |
| function | streamAnthropicMessage | 8789 | 8832 | 44 |
| function | startFolderPickerSession | 9586 | 9629 | 44 |
| function | syncModelProviderTimeoutsFromAgentSettings | 12302 | 12345 | 44 |
| variable | MODEL_RESILIENCE_FALLBACKS | 1491 | 1533 | 43 |
| function | runOpenClawWithManagedSkillsWorkspace | 16636 | 16678 | 43 |
| function | applyLocalConfigToGlobal | 18126 | 18168 | 43 |
| function | spawnText | 4558 | 4599 | 42 |
| function | contentTypeFromExt | 5206 | 5247 | 42 |
| function | toOpenAICodexContext | 8675 | 8716 | 42 |
| function | firstJsonSliceFromText | 14451 | 14492 | 42 |
| function | seedCanonicalResourceIfMissing | 16871 | 16912 | 42 |
| function | buildDoctrineSyncReport | 19274 | 19315 | 42 |
| function | persistAgentAvatarFromPath | 9868 | 9908 | 41 |
| function | launchChromeHost | 10345 | 10385 | 41 |
| function | pluginRawFromManifest | 13902 | 13942 | 41 |
| function | knownPluginConfigFields | 14323 | 14363 | 41 |
| function | splitPluginCommandLine | 14688 | 14728 | 41 |

## Largest Functions

| Function | Start | End | Lines |
| --- | ---: | ---: | ---: |
| streamProviderAgentTurn | 22220 | 22502 | 283 |
| runBufferedAgentTurnForStream | 21889 | 22085 | 197 |
| runDoctorChecks | 20977 | 21143 | 167 |
| installOpenClawPlugin | 15253 | 15404 | 152 |
| doctorGuidedActionForFinding | 20480 | 20626 | 147 |
| launchWindowsFolderPickerSession | 9666 | 9800 | 135 |
| runGatewayAgentTurnForStream | 22087 | 22218 | 132 |
| launchWindowsImagePickerSession | 9941 | 10069 | 129 |
| generateRecruitAutoForgeMarkdown | 21522 | 21650 | 129 |
| buildDefaultAgentLocalConfig | 17962 | 18089 | 128 |
| checkBrowserPreflight | 11216 | 11341 | 126 |
| createShiftFromPayload | 22619 | 22737 | 119 |
| ensureOpenclawRuntimeDefaults | 12109 | 12223 | 115 |
| runControlCenterAgentRuntimeTurn | 18860 | 18971 | 112 |
| patchedClawTalkCoreBridgeSource | 13348 | 13457 | 110 |
| runOpenClaw | 6288 | 6393 | 106 |
| googleVertexGcloudStatus | 6990 | 7074 | 85 |
| streamOpenAiResponsesCompletion | 8538 | 8621 | 84 |
| cleanupAgentWorkspaceDoctrineFiles | 19179 | 19261 | 83 |
| openAgentSessionSnapshots | 4896 | 4977 | 82 |
| defaultAgentResourceContent | 17254 | 17334 | 81 |
| listPluginControls | 15878 | 15955 | 78 |
| setupClawTalkPlugin | 16222 | 16298 | 77 |
| generateGoogleVertexArtifactContent | 19015 | 19091 | 77 |
| ensureGoogleOAuthCallbackServer | 7743 | 7818 | 76 |
| startManagedTeamSyncOrchestrator | 20091 | 20165 | 75 |
| purgeAgentState | 17142 | 17213 | 72 |
| writeAuthProfileSqlite | 2334 | 2404 | 71 |
| writeGoogleGeminiMinimalOpenClawConfig | 18743 | 18813 | 71 |
| ensureOpenAICodexOAuthCallbackServer | 7921 | 7990 | 70 |
| approveLocalDevicePairingRequest | 10788 | 10856 | 69 |
| inferWorkspaceRuntimeIntent | 9279 | 9346 | 68 |
| inspectOpenClawSessionLock | 5879 | 5945 | 67 |
| streamGoogleVertexContent | 9067 | 9133 | 67 |
| applyOpenClawPluginEnabledToConfig | 15957 | 16023 | 67 |
| providerAuthStatus | 3250 | 3315 | 66 |
| repairCodexPluginPostInstallState | 15186 | 15251 | 66 |
| pickImageWithOsDialog | 10279 | 10343 | 65 |
| seedAgentWorkspace | 18319 | 18383 | 65 |
| repairGatewayTokenConfigSync | 3033 | 3096 | 64 |
| cleanupOpenClawSessionLocks | 6027 | 6090 | 64 |
| extractAgentReply | 10433 | 10496 | 64 |
| tryReleaseTcpPortUnix | 11047 | 11110 | 64 |
| applyPluginToggleViaGatewayConfigPatch | 15599 | 15662 | 64 |
| clearDisallowedAutoModelOverrideFromEntry | 4232 | 4294 | 63 |
| resolveSharedTeamSyncPath | 18422 | 18484 | 63 |
| applyGoogleGeminiPluginPolicy | 18679 | 18741 | 63 |
| patchedTelegramBotRuntimeSource | 13475 | 13536 | 62 |
| buildPluginControlEntry | 14388 | 14449 | 62 |
| pickFolderWithOsDialog | 10188 | 10247 | 60 |
| getPartyMembers | 20167 | 20226 | 60 |
| recruitAutoForgePrompt | 21429 | 21488 | 60 |
| buildMissionPrompt | 18259 | 18317 | 59 |
| streamGeminiContent | 8834 | 8891 | 58 |
| runPickerCommand | 10071 | 10128 | 58 |
| getPluginList | 14095 | 14152 | 58 |
| runBrowserToolProbe | 11158 | 11214 | 57 |
| ensureConfiguredProviderModel | 1893 | 1948 | 56 |
| writeOpenclawConfig | 12467 | 12522 | 56 |
| postLocalJsonNoHeaderTimeout | 9171 | 9225 | 55 |
| tryReleaseGatewayPort | 10991 | 11045 | 55 |
| tryReleaseBrowserRelayPort | 10936 | 10989 | 54 |
| readOpenclawConfig | 11706 | 11759 | 54 |
| ensureCodexPluginInstalledForOpenAiRuntime | 15418 | 15471 | 54 |
| loadAvailableModelsFromOpenClaw | 1981 | 2033 | 53 |
| refreshPluginListCache | 14035 | 14087 | 53 |
| requestGatewaySessionAbort | 3808 | 3859 | 52 |
| createPlainProcessTerminalModule | 6515 | 6566 | 52 |
| ensureClawTalkBundledPluginDefaults | 13714 | 13765 | 52 |
| streamOpenAICodexResponsesCompletion | 8737 | 8787 | 51 |
| resolveFilenameHintsForMessage | 19386 | 19436 | 51 |
| listActiveCronJobsFromStateDb | 19878 | 19928 | 51 |
| recruitPersonalityDepthGuidance | 21352 | 21402 | 51 |
| inspectOpenClawSessionLocks | 5976 | 6025 | 50 |
| closeLifecycleHttpServer | 7315 | 7364 | 50 |
| savePluginDirectConfig | 14987 | 15036 | 50 |
| syncAgentDerivedFiles | 17664 | 17713 | 50 |
| composeAgentDoctrinePrompt | 17715 | 17764 | 50 |
| listRehydratableControlCenterShiftsFromStateDb | 19974 | 20022 | 49 |
| startPluginSetupTerminalSession | 6630 | 6677 | 48 |
| readSkillEntryFromDir | 16457 | 16504 | 48 |
| appendAgentPromptDump | 17782 | 17829 | 48 |
| createInitialOpenclawConfig | 11608 | 11654 | 47 |
| ensureClawTalkManifestContracts | 13237 | 13283 | 47 |
| normalizeModelWithFallback | 17501 | 17547 | 47 |
| listMissionCronReconciliationSnapshotFromStateDb | 19701 | 19747 | 47 |
| streamOpenAiCompatibleCompletion | 8491 | 8536 | 46 |
| tryStartBrowserRelay | 10889 | 10934 | 46 |
| openClawOptimizationStatus | 11561 | 11606 | 46 |
| openClawDoctorLintCheck | 20930 | 20975 | 46 |
| terminateProcessTree | 886 | 930 | 45 |
| removeProviderAuthProfiles | 2731 | 2775 | 45 |
| checkGoogleVertexModelAvailability | 8946 | 8990 | 45 |
| normalizeOpenClawConfigModelRefs | 12063 | 12107 | 45 |
| schemaConfigFieldsFromRaw | 14277 | 14321 | 45 |
| syncDoctrineToWorkspace | 18529 | 18573 | 45 |
| exchangeGoogleOAuthCodeForTokens | 7535 | 7578 | 44 |
| streamAnthropicMessage | 8789 | 8832 | 44 |
| startFolderPickerSession | 9586 | 9629 | 44 |
| syncModelProviderTimeoutsFromAgentSettings | 12302 | 12345 | 44 |
| runOpenClawWithManagedSkillsWorkspace | 16636 | 16678 | 43 |
| applyLocalConfigToGlobal | 18126 | 18168 | 43 |
| spawnText | 4558 | 4599 | 42 |
| contentTypeFromExt | 5206 | 5247 | 42 |
| toOpenAICodexContext | 8675 | 8716 | 42 |
| firstJsonSliceFromText | 14451 | 14492 | 42 |
| seedCanonicalResourceIfMissing | 16871 | 16912 | 42 |
| buildDoctrineSyncReport | 19274 | 19315 | 42 |
| persistAgentAvatarFromPath | 9868 | 9908 | 41 |
| launchChromeHost | 10345 | 10385 | 41 |
| pluginRawFromManifest | 13902 | 13942 | 41 |
| knownPluginConfigFields | 14323 | 14363 | 41 |
| splitPluginCommandLine | 14688 | 14728 | 41 |
| refreshGoogleOAuthCredential | 7580 | 7619 | 40 |
| summarizePluginRuntimeInspect | 15804 | 15842 | 39 |
| appendGoogleVertexPayloadDump | 17831 | 17869 | 39 |
| prepareOpenClawConfigForGatewayStartup | 4676 | 4713 | 38 |
| bufferedAgentRuntimeReason | 9348 | 9385 | 38 |
| persistAgentAvatarBytes | 9829 | 9866 | 38 |
| providerConfigFieldsFromSetup | 14238 | 14275 | 38 |

## Largest Variable Blocks

| Binding | Start | End | Lines |
| --- | ---: | ---: | ---: |
| partyManagementRoutesContext | 21733 | 21798 | 66 |
| FALLBACK_MODELS | 1430 | 1479 | 50 |
| gatewayLifecycle | 4743 | 4788 | 46 |
| MODEL_RESILIENCE_FALLBACKS | 1491 | 1533 | 43 |
| COMMAND_CONSOLE_UPLOAD_MIME_EXTENSIONS | 228 | 267 | 40 |
| runtimeStatusService | 4837 | 4876 | 40 |
| agentConfigRoutesContext | 22831 | 22869 | 39 |
| PLUGIN_CATALOG | 13767 | 13803 | 37 |
| STREAMING_PROVIDER_CONFIG | 6727 | 6762 | 36 |
| runtimeRecoveryService | 21223 | 21257 | 35 |
| AUTH_PROVIDER_PROFILE_ALIASES | 2426 | 2458 | 33 |
| missionSchedulerService | 3426 | 3457 | 32 |
| missionRecoveryService | 3497 | 3521 | 25 |
| gatewayChatService | 4483 | 4507 | 25 |
| CLAWTALK_AGENT_TOOL_NAMES | 383 | 405 | 23 |
| runtimeActionService | 21259 | 21279 | 21 |
| DEFAULT_BOOTSTRAP_AGENTS | 2086 | 2105 | 20 |
| missionStateService | 3399 | 3418 | 20 |
| ROUTER_TYPO_REPLACEMENTS | 9227 | 9246 | 20 |
| AGENT_RESOURCE_FILES | 321 | 335 | 15 |
| gatewayLogService | 4420 | 4433 | 14 |
| RESOURCE_SEED_FILES | 336 | 347 | 12 |
| missionTeamSyncService | 3384 | 3395 | 12 |
| AVATAR_IMAGE_MIME_EXTENSIONS | 270 | 280 | 11 |
| RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES | 21321 | 21331 | 11 |
| GOOGLE_GEMINI_TOOL_WRITE_ALLOWLIST | 18618 | 18627 | 10 |
| COMMAND_CONSOLE_UPLOAD_EXTENSIONS | 218 | 226 | 9 |
| DEFAULT_HEARTBEAT_RUNTIME | 12347 | 12355 | 9 |
| missionReportService | 3373 | 3380 | 8 |
| GOOGLE_VERTEX_LOCATION_KEYS | 1404 | 1410 | 7 |
| gatewayDiagnostics | 4715 | 4721 | 7 |
| PLUGIN_SETUP_TERMINAL_COMMANDS | 6502 | 6508 | 7 |
| BUILTIN_RETIRED_AGENT_IDS | 17049 | 17055 | 7 |
| loginAttempts | 116 | 121 | 6 |
| WEBSITE_CONTRIBUTION_LANES | 17904 | 17909 | 6 |
| OPENCLAW_STATE_ROOT | 171 | 175 | 5 |
| OPENCLAW_CONFIG_PATH | 177 | 181 | 5 |
| OPENCLAW_GATEWAY_LOG_PATH | 182 | 186 | 5 |
| DEEPSEEK_DEFAULT_FALLBACKS | 1539 | 1543 | 5 |
| OPENAI_DEFAULT_MODEL_IDS | 1558 | 1562 | 5 |
| STATIC_ROOT | 22875 | 22879 | 5 |
| sessionTokens | 112 | 115 | 4 |
| FOLDER_PICKER_TIMEOUT_MS | 210 | 213 | 4 |
| KNOWN_UNAVAILABLE_MODEL_IDS | 1480 | 1483 | 4 |
| OPENCLAW_CONFIG_SUPPRESSED_MODEL_IDS | 1484 | 1487 | 4 |
| GENERATED_DEEPSEEK_DEFAULT_MODEL_IDS | 1546 | 1549 | 4 |
| GENERATED_OPENROUTER_DEEPSEEK_DEFAULT_MODEL_IDS | 1550 | 1553 | 4 |
| GENERATED_DEEPSEEK_ROUTE_MODEL_IDS | 1554 | 1557 | 4 |
| RUNTIME_STATUS_CACHE_MS | 4358 | 4361 | 4 |
| RUNTIME_SUMMARY_CACHE_MS | 4362 | 4365 | 4 |
| GATEWAY_LEDGER_SNAPSHOT_CACHE_MS | 4366 | 4369 | 4 |
| RUNTIME_STATUS_RESPONSE_TIMEOUT_MS | 4370 | 4373 | 4 |
| RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS | 4374 | 4377 | 4 |
| GATEWAY_STARTUP_HEALTH_GRACE_MS | 4378 | 4381 | 4 |
| GATEWAY_STARTUP_HEALTH_CONFIRM_TIMEOUT_MS | 4382 | 4385 | 4 |
| GATEWAY_STARTUP_HEALTH_POLL_MS | 4386 | 4389 | 4 |
| DOCTOR_DIAGNOSTIC_CACHE_MS | 20363 | 20366 | 4 |
| CONTROL_CENTER_GATEWAY_AGENT_SESSIONS | 354 | 356 | 3 |
| CONTROL_CENTER_GATEWAY_CHAT_CLIENT | 357 | 359 | 3 |
| CONTROL_CENTER_GATEWAY_PREWARM_ON_STARTUP | 360 | 362 | 3 |
| CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC | 363 | 365 | 3 |
| CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK | 367 | 369 | 3 |
| CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN | 370 | 372 | 3 |
| AUTO_START_GATEWAY | 373 | 375 | 3 |
| DISABLE_BROWSER_RUNTIME_DEFAULTS | 407 | 409 | 3 |
| LEGACY_TOOL_PROFILE_ALIASES | 1001 | 1003 | 3 |
| EDITOR_RESOURCE_FILES | 1329 | 1331 | 3 |
| VISIBLE_RUNTIME_LOG_PREFIX_RE | 10387 | 10388 | 2 |
| VISIBLE_RUNTIME_LOG_SPLIT_RE | 10390 | 10391 | 2 |
| CLAWTALK_DOCTOR_CHECK_RE | 16112 | 16113 | 2 |
| app | 106 | 106 | 1 |
| PORT | 108 | 108 | 1 |
| CONFIGURED_AUTH_TOKEN | 109 | 109 | 1 |
| AUTH_TOKEN | 110 | 110 | 1 |
| AUTH_TOKEN_SOURCE | 111 | 111 | 1 |
| CONTROL_CENTER_FRONTEND_PORT | 122 | 122 | 1 |
| controlServer | 138 | 138 | 1 |
| optionalRequire | 139 | 139 | 1 |
| WORKSPACE_ROOT | 153 | 153 | 1 |
| HOME_DIR | 154 | 154 | 1 |

## Extraction Guidance

Prioritize seams that satisfy all of the following:

1. The declaration has a narrow dependency surface.
2. The behavior already has smoke or integration coverage.
3. Moving it removes a coherent responsibility, not merely a random line range.
4. The new module exposes a typed service or route dependency contract.
5. The executable entrypoint stays composition-only and the control-plane route budget continues to fall.
