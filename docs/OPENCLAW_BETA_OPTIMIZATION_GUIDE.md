# OpenClaw 2026.11.5 Upgrade and Automnia Adoption Audit

Audit date: 2026-11-17
Target runtime: OpenClaw `2026.11.5`
Scope: vendored runtime compatibility, official documentation snapshot, and Automnia adoption of Gateway, provider/model, plugin, skill, streaming, and operations capabilities.

## Release and documentation check

- GitHub identifies [v2026.11.5](https://github.com/openclaw/openclaw/releases/tag/v2026.11.5) as the stable release. The corresponding npm artifact is [`openclaw@2026.11.5`](https://www.npmjs.com/package/openclaw/v/2026.11.5), with tarball URL `https://registry.npmjs.org/openclaw/-/openclaw-2026.11.5.tgz` and SRI `sha512-mqPlsGLOe8NS85BfP1vWW9YVwFXchsV75QTkEbyR4csylORxts+fmfZp9+qbD7aPbXQIctyjRk+CPL91fDvxBA==`.
- The OpenClaw docs synchronization completed from `https://docs.openclaw.ai` on 2026-11-17: `docs/openclaw-latest/manifest.json` records 1,463 pages and `failureCount: 0`. The docs crawl still lists v2026.11.4 as the newest release-note page, so release authority was taken from GitHub/npm rather than assuming the docs crawl was current.
- The checked out app uses a vendored Gateway runtime. The version in package metadata, package-lock/shrinkwrap, hydration script, health/recommended-version display, and scorecard must stay aligned. The app’s legacy compatibility endpoints and model/tier policy are outside this guide’s OpenClaw adoption inventory.
- The current OpenClaw docs describe capabilities and contracts. An OpenClaw feature is counted as adopted only when Automnia has source/config evidence for the corresponding end-to-end path. A native OpenClaw feature with no Automnia wiring is not counted as implemented.

The [2026.11.5 release notes](https://github.com/openclaw/openclaw/releases/tag/v2026.11.5) highlight restart-safe queued conversations and final writes, safer rollback after Doctor/Gateway startup failures, Telegram interactive widgets, more reliable memory-index recovery and model fallback, usable device-folder selection, and stricter attachment/browser content boundaries. Other changes cover busy-session message handling, security presets, compaction summary limits, knowledge-page read budgets, Gateway recovery/reload races, and cron scheduling/lifecycle. The harness/plugin session-control break is checked separately below.

## What the status means

- **Implemented**: the app source demonstrates the described path. This does not mean every possible UI or runtime edge case is covered by an end-to-end test.
- **Partial**: related code exists, but coverage, persistence, user visibility, or an explicit Gateway contract is missing.
- **Planned**: the source audit found no complete app integration for the capability. The action column describes a concrete next change.

This is an adoption audit, not a claim that OpenClaw ships 44 independent feature switches. Each scorecard location below is the original app-owned assessment; the adjacent source evidence records the code path reviewed. Sources are from this checkout at the audit date.

## 44-item feature audit

| # | Category | Status | Current app evidence | Specific adoption or enablement change |
|---:|---|---|---|---|
| 1 | Fast path | Partial | `server/openclawOptimizationScorecard.ts:91`; optional fast-mode handling is present in `server/services/gateway/gatewayChatService.ts`. | Carry OpenClaw `fastMode` through every Gateway-backed turn entry point and assert the effective setting in route smokes. |
| 2 | Fast path | Partial | `server/openclawOptimizationScorecard.ts:98`; provider/model selection exists in `server/services/providers/modelCatalogService.ts`, but no durable reasoning-default cache was found. | Cache resolved reasoning defaults by provider/model and invalidate them when model metadata changes. |
| 3 | Fast path | Partial | `server/openclawOptimizationScorecard.ts:112`; Gateway and local fallback paths exist in `server/services/gateway/gatewayChatService.ts` and `server/routes/agentTurnRoutes.ts`. | Assert that a ready Gateway handles console turns and record why a fallback was selected. |
| 4 | Fast path | Planned | `server/openclawOptimizationScorecard.ts:126`; no first-output latency budget gate was found in the CI scripts. | Add a bounded cold/warm first-output smoke with an explicit regression threshold. |
| 5 | Fast path | Planned | `server/openclawOptimizationScorecard.ts:133`; provider setup/auth code exists, but a provider onboarding acceptance checklist was not found. | Add a setup check for auth, model discovery, one bounded request, and capabilities before marking a provider ready. |
| 6 | Recovery | Partial | `server/openclawOptimizationScorecard.ts:203`; diagnostics and repair entry points exist in `server/routes/diagnosticsRoutes.ts` and `server/controlPlane.ts`. | Link diagnosis to safe, guided repair actions and report the result back into the readiness state. |
| 7 | Bounded operations | Partial | `server/openclawOptimizationScorecard.ts:224`; `server/controlPlane.ts` contains output caps, but there is no single shared cap contract across command and diagnostic paths. | Route subprocess stdout/stderr through one bounded collector with explicit truncation metadata. |
| 8 | Bounded operations | Partial | `server/openclawOptimizationScorecard.ts:231`; command-specific timeout handling exists across control-plane operations. | Centralize timeout defaults and overrides, then surface timeout vs. process failure distinctly. |
| 9 | Bounded operations | Partial | `server/openclawOptimizationScorecard.ts:238`; process cleanup exists in `server/controlPlane.ts`, but consistent process-tree semantics are not proven across platforms. | Use one cross-platform process-tree termination helper and verify child-process cleanup on Windows and POSIX. |
| 10 | Bounded operations | Partial | `server/openclawOptimizationScorecard.ts:245`; bounded network calls appear in control-plane/provider code, with no shared request helper across all call sites. | Standardize fetch timeout, response-size cap, abort handling, and safe error summaries. |
| 11 | Bounded operations | Partial | `server/openclawOptimizationScorecard.ts:252`; SSE buffer/stall handling exists in `server/services/agents/downstreamSse.ts`; periodic keepalive delivery is not present. | Emit a bounded SSE heartbeat while upstream work is quiet and preserve client disconnect cancellation. |
| 12 | Recovery | Planned | `server/openclawOptimizationScorecard.ts:259`; no shared retry budget for repair actions was found. | Give each repair a maximum attempt count, delay/backoff, idempotency key, and terminal result. |
| 13 | Recovery | Partial | `server/openclawOptimizationScorecard.ts:266`; queued-run state is handled in `server/services/gateway/gatewayChatService.ts`, but a consistent stuck-queue threshold/action is not exposed. | Detect runs that exceed queue age limits and offer cancel/requeue with a durable reason. |
| 14 | Plugin safety | Partial | `server/openclawOptimizationScorecard.ts:273`; plugin discovery and route management exist in `server/routes/pluginRoutes.ts`, but scan bounds are not consistently exposed. | Bound plugin inventory scans and report scan duration, truncation, and incomplete results. |
| 15 | Plugin safety | Partial | `server/openclawOptimizationScorecard.ts:329`; plugin diagnostics are present in `server/services/plugins/pluginDiagnosticsService.ts`; a durable action ledger is incomplete. | Persist plugin activation, repair, rollback, and disable actions with actor, result, and timestamp. |
| 16 | Provider/model center | Implemented | `server/services/providers/modelCenterService.ts` normalizes versioned per-provider snapshots; `server/routes/providerAuthRoutes.ts` exposes them; `server/state/runtimeLedgerStore.ts` assigns a durable state key. | Keep snapshot fields bounded and derived only from the OpenClaw catalog projection. |
| 17 | Channels/media/files | Planned | `server/openclawOptimizationScorecard.ts:343`; upload routes exist in `server/routes/commandConsoleFileRoutes.ts`; retention/cleanup metadata is not wired end to end. | Persist upload ownership, expiry, and cleanup state and add an expiry worker. |
| 18 | Gateway console | Partial | `server/openclawOptimizationScorecard.ts:378`; `server/services/gateway/gatewayChatService.ts` invokes Gateway `chat.send`. | Add a transport assertion that confirms console submissions use `chat.send` when Gateway is healthy. |
| 19 | Gateway console | Implemented | `server/services/gateway/gatewayChatService.ts:1583` keeps a visible terminal reply on the fast path; `tests/gatewayChatService.test.ts` compares that reply with `chat.history` addressed to the same session key and supplies a different-session fixture to catch route mismatch. The focused contract test passes; it uses a mocked Gateway client, not a live Gateway. | Keep the same-session assertion with Gateway contract changes and add a live runtime smoke when a stable Gateway test fixture is available. |
| 20 | Gateway console | Implemented | `server/openclawOptimizationScorecard.ts:392`; `server/services/gateway/gatewayChatService.ts` requests `tools.effective` only under explicit `toolsEffectiveDiagnostic` opt-in; normal execution uses `chat.send`. | Keep it diagnostic-only and retain an assertion that it never becomes the default execution path. |
| 21 | Gateway console | Partial | `server/openclawOptimizationScorecard.ts:399`; Gateway/local fallback state is represented in `server/routes/agentTurnRoutes.ts`, but reason logging is not uniform. | Record fallback source, destination, trigger, and selected model for every transition. |
| 22 | Gateway console | Partial | `server/openclawOptimizationScorecard.ts:406`; embedded/local runtime selection exists in `server/routes/agentTurnRoutes.ts`, but fallback labels are not consistently attached to responses. | Include an explicit fallback label and reason in every response/diagnostic payload. |
| 23 | Streaming UX | Implemented | `server/openclawOptimizationScorecard.ts:469`; `src/components/monitor/AgentResponseConsole.tsx` remembers prompt text and attachment drafts per target and flushes prompt edits on pagehide/beforeunload. | Keep prompt and attachment draft restoration scoped to the selected target and preserve its reload coverage. |
| 24 | Streaming UX | Planned | `server/openclawOptimizationScorecard.ts:476`; large message lists in `src/components/monitor/AgentResponseConsole.tsx` are not virtualized. | Virtualize long transcripts while preserving scroll position during streaming updates. |
| 25 | Streaming UX | Implemented | `src/utils/failureRecovery.ts` maps known and future `failureKind` values to user-facing recovery guidance; `AgentResponseConsole.tsx:558` renders it for terminal failures; `tests/failureRecovery.test.ts` covers known kinds, safe actions, and unknown kinds. Focused tests and ESLint passed. | Keep the mapping aligned with server failure kinds and avoid automatic retries when a partial tool action may have completed. |
| 26 | Plugin safety | Planned | `server/openclawOptimizationScorecard.ts:539`; plugin activation lives in `server/routes/pluginRoutes.ts`; SecretRef binding validation before activation was not found. | Validate required secret references and their scopes before enabling a plugin. |
| 27 | Plugin safety | Partial | `server/openclawOptimizationScorecard.ts:546`; `server/services/plugins/pluginDiagnosticsService.ts` exposes plugin diagnostics, but repairs are not consistently targeted to one failed action. | Add idempotent repair operations keyed to a plugin and failure class. |
| 28 | Plugin safety | Partial | `server/openclawOptimizationScorecard.ts:553`; Doctor/diagnostic routes exist in `server/routes/diagnosticsRoutes.ts`, but early module-loader failures do not always yield actionable app diagnostics. | Capture plugin load failures before activation and attach an app-owned recovery recommendation. |
| 29 | Skill workshop | Planned | `server/openclawOptimizationScorecard.ts:602`; skill routes exist in `server/routes/skillRoutes.ts`; there is no side-by-side skill diff preview. | Preview the exact file changes and permissions before applying a skill update. |
| 30 | Skill workshop | Planned | `server/openclawOptimizationScorecard.ts:609`; skill install/update routes exist in `server/routes/skillRoutes.ts`; support-file hashing is not tracked. | Hash all installed skill files and compare them during update/health checks. |
| 31 | Skill workshop | Planned | `server/openclawOptimizationScorecard.ts:616`; no skill rollback path was found in `server/routes/skillRoutes.ts`. | Keep a prior verified skill revision and expose a rollback action. |
| 32 | Skill workshop | Planned | `server/openclawOptimizationScorecard.ts:623`; no skill quarantine state was found in `server/routes/skillRoutes.ts`. | Quarantine invalid or changed skills before they can be loaded, with an explicit restore action. |
| 33 | Workboard coordination | Planned | `server/openclawOptimizationScorecard.ts:679`; mission/task flows exist in `server/routes/missionRoutes.ts`, but dedicated OpenClaw Workboard task cards are not wired. | Add task cards backed by durable task identity and map them to Automnia missions. |
| 34 | Workboard coordination | Planned | `server/openclawOptimizationScorecard.ts:686`; mission CRUD exists in `server/routes/missionRoutes.ts`, but a task dependency graph is not represented. | Persist predecessor/dependency edges and prevent invalid execution order. |
| 35 | Workboard coordination | Planned | `server/openclawOptimizationScorecard.ts:693`; missions are managed by `server/routes/missionRoutes.ts`; task-level comments and evidence receipts are not first-class. | Add append-only task comments and evidence links to completion records. |
| 36 | Provider/model center | Implemented | `server/services/providers/modelCenterService.ts` persists schema version, provider/model IDs, catalog source, verification time, context, modalities, tool support, and reasoning metadata through the Control Center state ledger. | Preserve provenance when changing catalog sources or snapshot schemas. |
| 37 | Provider/model center | Implemented | `POST /api/models/probe` requires `confirm: true`; `server/services/providers/modelCenterService.ts` limits each probe to 15 seconds and 8 output tokens, disables tools and fallbacks, stores only a bounded outcome summary, and reduces permission/entitlement failures to a safe reason code. | Keep probes opt-in, rate-limited, and free of stored model output or raw provider errors. |
| 38 | Provider/model center | Planned | `server/openclawOptimizationScorecard.ts:756`; auth status exists in `server/services/providers/providerAuthService.ts`, but proactive token-expiry warnings are not exposed. | Surface expiry/refresh state before a model call fails, without exposing credential material. |
| 39 | Provider/model center | Implemented | `GET /api/party/agent/:agentId/model` returns a structured resolution with requested and resolved model IDs, fallback chain, selection source, and stable reason code from `server/services/providers/modelCenterService.ts`. | Keep the resolution explanation credential-free and aligned with the effective billing-route selection. |
| 40 | Channels/media/files | Partial | `server/openclawOptimizationScorecard.ts:812`; ClawTalk console routes and `src/components/monitor/AgentResponseConsole.tsx` provide conversation state, but connection, pairing, and last-delivery status are not a single durable panel. | Combine connection/pairing state, last delivery, and last error in the ClawTalk panel. |
| 41 | Channels/media/files | Planned | `server/openclawOptimizationScorecard.ts:819`; channel-facing chat routes exist, but an app-wide durable inbound message queue is not wired. | Persist inbound delivery state with deduplication and a bounded retry policy. |
| 42 | Channels/media/files | Planned | `server/openclawOptimizationScorecard.ts:826`; outbound send paths exist, but there is no shared retry ledger for all channel deliveries. | Record each delivery attempt and retry only idempotent failures with a maximum attempt budget. |
| 43 | Channels/media/files | Planned | `server/openclawOptimizationScorecard.ts:833`; upload/media route code exists in `server/routes/commandConsoleFileRoutes.ts`; durable media-job lifecycle state is not wired. | Track media jobs from accepted input through processing, output, failure, and cleanup. |
| 44 | CI/UI operations | Implemented | `scripts/post-upgrade-openclaw-readiness.mjs` verifies the OpenClaw 2026.11.5 package/shrinkwrap/dependency metadata, Codex 2026.11.5 bundle and 0.164.0 harness, API ready/health, Gateway `/healthz`, live runtime version, and provider auth through a safe whitelist; it then runs eight bounded OpenClaw, provider-auth, streaming, and Gateway smokes. `scripts/smoke-post-upgrade-openclaw-readiness.mjs` covers bundle metadata and secret-free provider summaries. | Keep version pins and the bounded smoke list synchronized with each OpenClaw/Codex release. |

### Audit totals

| Status | Count |
|---|---:|
| Implemented | 9 |
| Partial | 18 |
| Planned | 17 |
| **Total reviewed** | **44** |

These counts describe this focused 44-item adoption audit. The broader app scorecard has additional items and computes its own totals. The nine implemented entries cover same-session Gateway reply verification, opt-in `tools.effective` diagnostics, persisted console drafts, terminal failure guidance, scripted post-upgrade readiness, durable provider capability snapshots and provenance, bounded opt-in model probes, and structured model fallback explanations. Stream/chat smokes are deterministic, bounded compatibility checks; the readiness command does not issue a billable live model prompt. The other 35 entries remain partial or planned; they are not called active merely because OpenClaw supports them or because a related app route exists.

## Official OpenClaw references reviewed

- [v2026.11.5 release](https://github.com/openclaw/openclaw/releases/tag/v2026.11.5) and [npm package metadata](https://registry.npmjs.org/openclaw/2026.11.5).
- [Models and providers](https://docs.openclaw.ai/providers/models), [Gateway](https://docs.openclaw.ai/gateway), [session control](https://docs.openclaw.ai/gateway/protocol/rpc-session-control), [streaming](https://docs.openclaw.ai/concepts/streaming), [agent runtime architecture](https://docs.openclaw.ai/agent-runtime-architecture).
- [Plugins](https://docs.openclaw.ai/plugins), [skills](https://docs.openclaw.ai/tools/skills), [credential semantics](https://docs.openclaw.ai/auth-credential-semantics), [CI](https://docs.openclaw.ai/ci), and [media tools](https://docs.openclaw.ai/tools/media-overview).
- A fresh 1,463-page docs mirror was synced and reviewed locally. Its generated 65.6 MiB page set is kept out of this source commit; the committed guide links to the official documentation and release notes.

## Bundled plugin and Codex compatibility audit

### OpenClaw extensions

The prepared 2026.11.5 package contains **75 `openclaw.plugin.json` manifests** in 76 extension directories. Seventy-two manifest directories also have a package file declaring version `2026.11.5`; `active-memory`, `device-pair`, and `talk-voice` are code-only manifest entries included in the 2026.11.5 tarball. `image-generation-core` is the additional 2026.11.5 helper directory without a plugin manifest. This confirms the bundled plugin payload matches the vendored host release; it does not imply all bundled plugins are enabled.

Bundled manifest IDs:

`a2a`, `active-memory`, `admin-http-rpc`, `advisor`, `agent-guidance`, `agentsapi`, `alibaba`, `anthropic`, `apple-fm`, `autoreview`, `azure-speech`, `beam`, `bifrost`, `bonjour`, `browser`, `canvas`, `clawrouter`, `cloudflare`, `code-mode-quickjs`, `copilot-proxy`, `crabbox`, `cua-computer`, `deepgram`, `device-pair`, `document-extract`, `elevenlabs`, `fal`, `file-transfer`, `geolocation`, `github`, `github-copilot`, `google`, `huggingface`, `imap`, `kie`, `knowledge`, `linux-node`, `litellm`, `llm-task`, `lmstudio`, `logbook`, `mcp-events`, `mcp-relay`, `memory-core`, `memory-wiki`, `microsoft`, `microsoft-foundry`, `migrate-claude`, `migrate-hermes`, `minimax`, `nvidia`, `oc-path`, `ollama`, `omlx`, `onepassword`, `openai`, `opencode-go`, `openrouter`, `policy`, `reef`, `requesty`, `runway`, `senseaudio`, `session-share`, `sglang`, `talk-voice`, `telegram`, `together`, `tts-local-cli`, `vault`, `vllm`, `web-readability`, `workboard`, `x`, `xai`.

The app-owned `PLUGIN_CATALOG` in `server/services/plugins/pluginInventoryService.ts` defines Browser, Codex, ClawTalk, Memory Core, OpenAI, DeepSeek, and Google controls. The inspected `C:\Users\hotbo\.openclaw\openclaw.json` had no configured plugin entries, the Control Center plugin install state had no installed rows, and `C:\Users\hotbo\.openclaw\extensions` was empty. No separate third-party package version mismatch was found there. Runtime loaded/enabled status still comes from the live Gateway and is not inferred from the bundled catalog.

### Codex runtime plugin

The separately packaged Codex app-server harness was pinned from the stale `@openclaw/codex@2026.10.6` to the matching `@openclaw/codex@2026.11.5` release. The prepared metadata is in `.cache/runtime-bundles/openclaw-codex/codex/.automnia-runtime-bundle.json`:

| Package | Exact version | Integrity / evidence |
|---|---|---|
| `@openclaw/codex` | `2026.11.5` | `sha512-RmMrIH+drET1QyWDRG8FLLbgHX3YKGxfqawu3HIHsuwOFRm1/MuaO3hIb+8GjICM3Y/1eff5kl2aaNEnHk4GTA==`; [npm metadata](https://registry.npmjs.org/@openclaw/codex/2026.11.5) |
| `@openai/codex` | `0.164.0` | `sha512-TWj7UGyPRe3Pj/A3ddNAxs1te3a/W/xAd+J0LHrrFTmsSfahGMOLF/vn88D3QCIgAT3B1rm1y/Z3NYE0rx6cZQ==` |
| Windows native alias `@openai/codex-win32-x64` | `0.164.0-win32-x64` | `sha512-urWPhwh9YavuoAPIkmVYKBTtd5OtGVL4Ki0Fb28dhK/Mz6Pt4LSy+gbRrZFz5+RXrw9ubvXuXDCcd8beYcWhDg==` |
| `@openclaw/fs-safe` | `0.26.13` | Pinned by the 2026.11.5 Codex package lock. |

The Codex package metadata declares `openclaw.compat.pluginApi: ">=2026.11.5"`, `openclaw.build.openclawVersion: "2026.11.5"`, and peer dependency `openclaw: ">=2026.11.5"`. Its built extension registers with `api.registerAgentHarness(...)`; the harness supplies a host `runAttempt` callback. The Codex dist contains no old `chatAbortControllers`, `chatQueuedTurns`, `expiresAtMs`, or `startDeadlineAtMs` references.

The 2026.11.5 [changelog](https://github.com/openclaw/openclaw/blob/main/CHANGELOG.md) marks harness/plugin session control as breaking: third-party harnesses must register session-keyed active runs inside the host `runAttempt` callback and retain the returned cleanup; plugin RPC handlers must use authorized Gateway method dispatch instead of `chatAbortControllers`/`chatQueuedTurns`; start-owner observations use `startDeadlineAtMs` in place of `expiresAtMs`. The matching 2026.11.5 host SDK exposes `setActiveEmbeddedRun(sessionId, handle, sessionKey, ...)` with a cleanup return value and accepts that cleanup in `clearActiveEmbeddedRun`; its `AgentTurnStartOwner.observe()` declaration contains `startDeadlineAtMs`. The bundled Codex plugin is built for this host contract, and static scans of its published dist found none of the retired controller/expiry identifiers.

### Verification performed

- `npm run prepare:openclaw-vendor` with `AUTOMNIA_REFRESH_OPENCLAW_VENDOR_DEPS=1` completed with exit 0, installed 380 production dependencies from the 2026.11.5 shrinkwrap, and wrote matching tarball integrity/version metadata. A second no-refresh run completed with exit 0 and reported production dependencies already prepared.
- `npm run prepare:runtime-bundles` completed with exit 0; Node `v24.22.1` was already prepared, and the Codex runtime bundle was rebuilt as `@openclaw/codex@2026.11.5` from its exact tarball and lock.
- `npm run smoke:openclaw` completed with exit 0: OpenClaw contract, settled-turn finalization, diagnostic redaction, SSE parser, and agent-turn SSE endpoint checks all passed. The contract smoke now reads the split 2026.11.5 protocol pages and asserts the current `chat.send.idempotencyKey` contract from `rpc-session-control.md`.
- `node --import tsx --test tests/modelCenterService.test.ts tests/providerModelCenterRoutes.test.ts` passed all 9 focused tests; scoped ESLint passed for the model-center service, provider/model routes, and both test files. The server-project typecheck reported one diagnostic outside this change set: `server/services/license/licenseService.ts(139,10): TS6133: 'tierRank' is declared but its value is never read`.
- The 1,463-page docs sync completed with `failureCount: 0`.

## Version and endpoint compatibility notes

The app’s old OpenClaw endpoint shape remains an Automnia-owned integration boundary. This audit does not change provider/model routing or replace that endpoint shape. The 2026.11.5 vendor preparation script retains the Automnia runtime patches; where upstream renamed or moved a bundle, the script must assert the current source marker or a documented native equivalent and fail closed if neither is present.
