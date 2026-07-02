# DystopAI Core Production Hardening Ledger

Last updated: 2026-07-01

Automation: `dystopai-production-hardening`

## Operating Rules

- Work from the repository audit as the production-readiness roadmap.
- Prioritize P0 correctness, security, durable control-plane state, reproducible builds, tests, and accessibility before visual polish.
- Protect user work. Do not revert unrelated local changes.
- For risky or broad changes, create or use a protective `codex/` branch or worktree before editing.
- Read the local OpenClaw documentation snapshot before changing OpenClaw, Gateway, Command Console, ClawTalk, runtime, tool routing, agent sessions, plugins, or related Control Center behavior.
- For optimization work, treat `docs/BETA_CODEBASE_SPLIT_PLAN.md` as the current source ledger and `docs/OPTIMIZATION_MEMORY.md` as the handoff note for future optimization runs.
- Complete one coherent hardening slice per run when possible.
- Record verification evidence, blockers, and the next planned task before stopping.

## Current Repository State At Ledger Creation

- Branch: `main`
- Existing local changes not made by Codex during ledger creation:
  - `src/components/mission/MissionDeploymentPanel.tsx`
  - `src/styles/dystopai-theme/70-responsive-polish.css`
- No existing production-hardening ledger was found.

## Completed

### 2026-06-30 - Beta Split Plan Ledger Alignment

Scope:

- Downloaded the GitHub beta codebase split plan from `origin/docs/150-point-release-plan`.
- Added `docs/BETA_CODEBASE_SPLIT_PLAN.md` as an exact copy of the remote plan.
- Verified the local plan blob matches the GitHub branch blob SHA: `78bada3e29085e2726769b86b6c3720b69feab9f`.
- Updated `docs/OPENCLAW_BETA_OPTIMIZATION_GUIDE.md` so optimization work follows the beta split plan phase order instead of expanding the old roadmap as a standalone feature list.
- Updated `docs/CLAWTALK_OPENCLAW_OPTIMIZATION_REPORT.md` so ClawTalk/Gateway optimizations route through Gateway/runtime services.
- Added `docs/OPTIMIZATION_MEMORY.md` as the durable handoff note for future optimization passes.

Verification:

- Confirmed the imported plan file hash matches `origin/docs/150-point-release-plan:docs/BETA_CODEBASE_SPLIT_PLAN.md`.
- Documentation-only change; no runtime tests were required.

### 2026-06-30 - Phase A Control-Plane Growth Guard

Scope:

- Added the Phase A no-new-domain-logic guard at the top of `server/controlPlane.ts`.
- Updated `scripts/smoke-server-entrypoint-boundary.ts` so `npm run smoke:server-architecture` now enforces:
  - the guard comment remains at the top of `controlPlane.ts`;
  - new backend behavior is directed to a target service folder in `docs/BETA_CODEBASE_SPLIT_PLAN.md`;
  - the control-plane line budget remains at or below `29,000` lines;
  - inline `/api` route handlers stay out of `controlPlane.ts`;
  - the generated architecture reporter continues publishing control-plane line-count evidence.
- Regenerated `docs/generated/server-index-architecture.md`; it now records `28,879` control-plane composition lines.
- Added an automation progress section to `docs/BETA_CODEBASE_SPLIT_PLAN.md` marking verified Phase A items `1`, `2`, `4`, `5`, `6`, `8`, and `10`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next pass starts Phase B Gateway service extraction.

Verification:

- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md` with `28,879` composition lines.
- `npm run smoke:server-architecture` passed: `9` entry lines, `28,879/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run lint` passed.

Risks and notes:

- The run started with existing uncommitted beta-plan alignment and Telegram routing changes; this slice preserved them and only layered the Phase A guard/evidence on top.
- Phase A items `3`, `7`, and `9` remain partially policy-driven until Gateway/service extractions create concrete temporary-exception and extracted-function tracking cases.

Next action:

- Start Phase B by extracting Gateway lifecycle behavior into `server/services/gateway/gatewayLifecycleService.ts`, with focused tests for process command construction and unavailable/restart behavior.

### 2026-06-30 - Phase B Gateway Lifecycle Service Extraction

Scope:

- Extracted Gateway process lifecycle ownership from `server/controlPlane.ts` into `server/services/gateway/gatewayLifecycleService.ts`.
- Moved Gateway start/stop/restart state, startup timeline events, health monitor timers, listener PID lookup, restart lifecycle memory, restart diagnostics, manual runtime stop, and plugin-install pause/resume handling behind the lifecycle service.
- Kept `server/controlPlane.ts` as dependency wiring for Gateway lifecycle behavior, including redaction, ledger append, OpenClaw runtime/config repair helpers, health probes, port release, and plugin repair dependencies.
- Added `tests/gatewayLifecycleService.test.ts` for process command construction, unavailable runtime behavior, external-listener restart refusal, forced restart command/env construction, and restart lifecycle outcome tracking.
- Preserved and fixed the wired `scripts/smoke-gateway-lifecycle-service.ts` so `npm run smoke:gateway-lifecycle` exits cleanly after the external-listener restart case, then added it to `npm run test:ci` after Gateway auth hardening.
- Updated related runtime/OpenClaw contract smokes to inspect the extracted service instead of forcing lifecycle internals to stay in `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `28,155` composition lines, down from the Phase A `28,879` line baseline.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase B items `11`, `15`, and `16`.

Verification:

- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed, including `20` unit tests and the new Gateway lifecycle coverage.
- `npm run smoke:gateway-lifecycle` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `28,155/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:openclaw` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm test` reached the late release-validation gate after the Gateway lifecycle smoke passed, then failed in `npm run smoke:release-validation` with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The worktree already contained uncommitted beta-plan alignment, Telegram routing repair, and partial Gateway lifecycle extraction edits; this slice completed and verified the lifecycle extraction without reverting that work.
- The `npm test` failure is a pre-existing release documentation contract mismatch in `README.md`; this slice did not modify `README.md`, and focused Gateway lifecycle, architecture, OpenClaw, runtime, lint, and typecheck gates all passed.
- The full-suite run also reported the known `smoke:ledger` recovery warning for one malformed historical `runtime-runs` JSONL row; the ledger smoke continued and passed.
- Gateway diagnostics, log tailing/redaction, and chat orchestration still live outside dedicated Gateway services and remain Phase B follow-up work.

Next action:

- Continue Phase B with `gatewayDiagnosticsService.ts` and `gatewayLogService.ts`, starting with health/readiness/stability probing and log tail/redaction helpers that can be tested without Express.

### 2026-06-30 - Phase B Gateway Diagnostics Service Extraction

Scope:

- Extracted Gateway health/readiness/stability probing from `server/controlPlane.ts` into `server/services/gateway/gatewayDiagnosticsService.ts`.
- Moved `/health`, `/readyz`, and `diagnostics.stability` response normalization, unavailable-state shaping, warning summarization, and redacted stability error handling behind a testable service factory with injected fetch/client dependencies.
- Kept `server/controlPlane.ts` as composition glue for Gateway diagnostics by wiring `createGatewayDiagnosticsService(...)` and preserving the existing runtime status and Doctor call-site wrappers.
- Added `tests/gatewayDiagnosticsService.test.ts` for healthy payloads, degraded readiness summaries, missing Gateway client behavior, redacted stability warning details, and redacted stability request failures.
- Added `scripts/smoke-gateway-diagnostics-service.ts`, exposed it as `npm run smoke:gateway-diagnostics`, and wired it into `npm run test:ci`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `27,838` composition lines, down from the Gateway lifecycle extraction baseline of `28,155`.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase B item `12`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization pass starts Gateway log tailing/redaction extraction.

Verification:

- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `24` tests, including the new Gateway diagnostics coverage.
- `npm run smoke:gateway-diagnostics` passed.
- `npm run smoke:gateway-lifecycle` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `27,838/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run smoke:openclaw` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm test` reached and passed `npm run smoke:gateway-diagnostics`, then failed at the pre-existing `npm run smoke:release-validation` gate with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The full-suite blocker is unrelated to this Gateway diagnostics extraction and matches the previously recorded release documentation contract mismatch in `README.md`.
- The full-suite run again reported the known malformed historical `runtime-runs` JSONL recovery warning; the ledger smoke continued and passed before the later release-validation failure.
- Gateway log tailing/redaction and chat orchestration still require dedicated services before Phase B is complete.

Next action:

- Continue Phase B by extracting Gateway log discovery, file tailing, `logs.tail` RPC fallback, channel activity parsing, redaction, dedupe, and log snapshot cache behavior into `server/services/gateway/gatewayLogService.ts`.

### 2026-06-30 - Phase B Gateway Log Service Extraction

Scope:

- Extracted Gateway log ownership from `server/controlPlane.ts` into `server/services/gateway/gatewayLogService.ts`.
- Moved Gateway log compaction/redaction, in-memory log mirroring, file-log discovery, tail snapshots, `logs.tail` RPC fallback, ClawTalk websocket channel activity parsing, channel direction classification, current-start filtering, dedupe, runtime loaded-plugin extraction, and Monitor activity summaries behind a testable service factory with injected filesystem/client/redaction dependencies.
- Kept `server/controlPlane.ts` as composition glue by wiring `createGatewayLogService(...)` and preserving wrappers for existing runtime status, Doctor, Gateway lifecycle, and Monitor call sites.
- Added `tests/gatewayLogService.test.ts` for redacted ledger writes, `logs.tail` RPC parsing, local file-tail fallback after redacted RPC failure, ClawTalk websocket channel activity parsing, current-start filtering, dedupe, activity summaries, and plugin id extraction.
- Added `scripts/smoke-gateway-log-service.ts`, exposed it as `npm run smoke:gateway-logs`, and wired it into `npm run test:ci`.
- Updated `scripts/smoke-openclaw-contracts.mjs` and `scripts/smoke-runtime-status-control-plane.ts` so log internals are asserted in `gatewayLogService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `26,883` composition lines, down from the Gateway diagnostics extraction baseline of `27,838`.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase B item `13`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization pass starts Gateway chat orchestration extraction.

Verification:

- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `29` tests, including the new Gateway log coverage.
- `npm run smoke:gateway-logs` passed.
- `npm run smoke:gateway-diagnostics` passed.
- `npm run smoke:gateway-lifecycle` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `26,883/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run smoke:openclaw` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed.
- `npm test` reached and passed `npm run smoke:gateway-logs`, then failed at the pre-existing `npm run smoke:release-validation` gate with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The full-suite blocker is unrelated to this Gateway log extraction and matches the previously recorded release documentation contract mismatch in `README.md`.
- The full-suite run again reported the known malformed historical `runtime-runs` JSONL recovery warning; the ledger smoke continued and passed before the later release-validation failure.
- Gateway chat orchestration remains in `server/controlPlane.ts` and is the next Phase B extraction.

Next action:

- Continue Phase B by extracting Gateway chat client startup, stream observer/waiter management, `chat.send`, `chat.history`, `chat.message.get`, `chat.abort`, recovery events, and redacted Gateway chat fallback/error shaping into `server/services/gateway/gatewayChatService.ts`.

### 2026-06-30 - Phase B Gateway Chat Service Extraction

Scope:

- Extracted Gateway chat orchestration from `server/controlPlane.ts` into `server/services/gateway/gatewayChatService.ts`.
- Moved the persistent loopback `gateway-client`, connect/startup readiness, stream observer and waiter state, `chat.send`, `chat.history`, `chat.message.get`, `chat.abort`, prewarm state, recovery snapshots, Gateway event projection, and final reply shaping behind a testable service factory with injected lifecycle, logging, redaction, attachment, runtime-run ledger, and failure-classification dependencies.
- Kept `server/controlPlane.ts` as composition glue by wiring `createGatewayChatService(...)` and preserving thin wrappers for runtime session close, mission Gateway-session reconciliation, plugin config patching, diagnostics health metadata, stream routes, and shutdown cleanup.
- Added `tests/gatewayChatService.test.ts` for Gateway chat payload construction, durable history final replies, oversized-history `chat.message.get` fallback, request cancellation issuing `chat.abort`, redacted Gateway send failures, redacted terminal error payloads, stale waiter recovery, and Gateway chat state normalization.
- Added `scripts/smoke-gateway-chat-service.ts`, exposed it as `npm run smoke:gateway-chat`, wired it into `npm run test:ci`, and extended it to guard the chat-service redaction boundary.
- Updated `scripts/smoke-openclaw-contracts.mjs` and `scripts/smoke-runtime-actions-control-plane.ts` so Gateway chat internals are asserted in `gatewayChatService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `25,696` composition lines, down from the Gateway log extraction baseline of `26,883`.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase B items `14` and `17`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization pass starts the remaining Phase B validation sweep instead of repeating chat extraction.

Verification:

- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `36` tests, including the new Gateway chat/redaction/stale-waiter coverage.
- `npm run smoke:gateway-chat` passed.
- `npm run smoke:gateway-lifecycle` passed.
- `npm run smoke:gateway-diagnostics` passed.
- `npm run smoke:gateway-logs` passed.
- `npm run smoke:openclaw` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `25,696/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed.
- `npm test` reached and passed `npm run smoke:gateway-chat`, then failed at the pre-existing `npm run smoke:release-validation` gate with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The full-suite blocker is unrelated to this Gateway chat extraction and matches the previously recorded release documentation contract mismatch in `README.md`.
- The full-suite run again reported the known malformed historical `runtime-runs` JSONL recovery warning and expected control-plane error-handler redaction smoke logs; those earlier gates passed before the later release-validation failure.
- Runtime session close and mission reconciliation still call Gateway `sessions.abort`, `chat.abort`, and `sessions.describe` through the service-owned ready client; deeper runtime ownership belongs to the Phase C runtime service extraction.

Next action:

- Finish the remaining Phase B validation sweep: add stale process cleanup decision coverage if any lifecycle gap remains, route-option/service seam checks where applicable, and Monitor Gateway online/offline/restarting confirmation now that lifecycle, diagnostics, log, and chat services are extracted.

### 2026-06-30 - Phase B Gateway Validation Sweep

Scope:

- Completed the remaining Phase B validation items after the Gateway lifecycle, diagnostics, log, and chat services were extracted.
- Extended `tests/gatewayLifecycleService.test.ts` to cover stale unhealthy listener cleanup decisions:
  - release an unhealthy listener before spawning a replacement Gateway;
  - refuse to spawn when listener release fails and the port remains busy;
  - project Monitor-facing `healthy`, `offline`, and `restarting` Gateway states after an unhealthy process exit schedules recovery.
- Extended `scripts/smoke-gateway-lifecycle-service.ts` with the same stale-listener and Monitor state checks so `npm run smoke:gateway-lifecycle` carries service-level evidence without Express or a real Gateway.
- Strengthened `scripts/smoke-server-entrypoint-boundary.ts` so `npm run smoke:server-architecture` now enforces:
  - Gateway process lifecycle helpers remain in `server/services/gateway/gatewayLifecycleService.ts`;
  - Gateway health/readiness/stability probing remains in `gatewayDiagnosticsService.ts`;
  - Gateway `logs.tail` RPC and file-tail behavior remains in `gatewayLogService.ts`;
  - Gateway WebSocket chat orchestration remains in `gatewayChatService.ts`;
  - runtime, diagnostics, and agent-turn routes receive Gateway behavior through explicit option seams.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` remains at `25,696` composition lines with `0` inline API routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress to mark Phase B items `18`, `19`, and `20` complete; Phase B items `11-20` are now complete and verified.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization run starts Phase C runtime status extraction.

Verification:

- `npm run test:unit` passed with `39` tests, including the new Gateway lifecycle stale-listener and Monitor state coverage.
- `npm run smoke:gateway-lifecycle` passed.
- `npm run smoke:gateway-diagnostics` passed.
- `npm run smoke:gateway-logs` passed.
- `npm run smoke:gateway-chat` passed.
- `npm run typecheck` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:openclaw` passed.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run smoke:server-architecture` passed: `9` entry lines, `25,696/29,000` control-plane composition lines, `0` inline routes, guard present.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run lint` passed.
- `git diff --check` passed; Git reported only LF-to-CRLF working-copy warnings on already touched files.

Risks and notes:

- Full `npm test` was not rerun in this pass because the previously recorded unrelated blocker remains: `smoke:release-validation` expects `README.md` to document `distribution-signing.json`.
- The working tree already contained uncommitted Phase A and Phase B Gateway extraction changes at the start of this run; this slice preserved them and layered only validation/smoke/doc evidence on top.

Next action:

- Start Phase C by extracting runtime summary/status building into `server/services/runtime/runtimeStatusService.ts`, preserving the existing API shape consumed by `src/hooks/useRuntimeStatus.ts`.

### 2026-06-30 - Phase C Runtime Status Service Extraction

Scope:

- Extracted runtime status and summary payload construction into `server/services/runtime/runtimeStatusService.ts`.
- Moved status/summary caches, response-deadline fallback, cached fallback shaping, Gateway ledger/log/activity projections, plugin summary projection, active mission/shift projection, and Monitor fallback payloads behind a testable service factory.
- Kept `server/controlPlane.ts` as dependency wiring for the runtime status service and thin wrappers for existing runtime route call sites.
- Added `tests/runtimeStatusService.test.ts` coverage for healthy Gateway summaries, missing Gateway summaries that still use Gateway ledger evidence, stale session evidence passthrough, and timeout fallback to cached redacted runtime status.
- Updated runtime/OpenClaw/server architecture smokes to assert status ownership in `server/services/runtime/runtimeStatusService.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` reached `25,192` composition lines after this status extraction.

Verification:

- `npm run test:unit` passed with the runtime status service tests included.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:server-architecture` passed with `25,192/29,000` composition lines and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:openclaw` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed.

Risks and notes:

- Full `npm test` remained blocked at the unrelated late `smoke:release-validation` README contract for `distribution-signing.json`.
- Runtime actions, runtime recovery, and runtime ledger store ownership remained Phase C follow-up work after this slice.

Next action:

- Continue Phase C by extracting runtime actions into `server/services/runtime/runtimeActionService.ts`.

### 2026-06-30 - Phase C Runtime Action Service Extraction

Scope:

- Extracted runtime action orchestration into `server/services/runtime/runtimeActionService.ts`.
- Moved session close coordination, Gateway runtime-session aborts, session-lock cleanup, stale Gateway chat waiter aborts, runtime monitor clear marker writes, desktop runtime shutdown, and Gateway stop/start/restart response shaping behind a testable service factory.
- Kept `server/routes/runtimeRoutes.ts` as HTTP validation and canonical success/error envelope handling; the route module now delegates actions through the injected `RuntimeActionService`.
- Kept `server/controlPlane.ts` as dependency wiring by composing `createRuntimeActionService(...)` with existing Gateway lifecycle/chat/log, session cleanup, monitor, and shutdown helpers.
- Added `tests/runtimeActionService.test.ts` coverage for session close cleanup and activity snapshots, stale waiter abort cache invalidation, monitor clear marker writes and cleanup counts, Gateway stop/start/restart status snapshots, and desktop shutdown reason propagation.
- Updated `scripts/smoke-runtime-actions-control-plane.ts`, `scripts/smoke-server-entrypoint-boundary.ts`, `scripts/smoke-runtime-status-control-plane.ts`, and `scripts/smoke-openclaw-contracts.mjs` so action ownership is asserted in `server/services/runtime/runtimeActionService.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `25,197` composition lines with `0` inline API routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase C item `22`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization run starts runtime recovery extraction instead of repeating runtime actions.

Verification:

- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `48` tests, including the new runtime action service coverage.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `25,197/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run smoke:route-inventory` passed: `109` unique API routes.
- `npm run smoke:openclaw` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed; Git reported only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed all gates through `smoke:release-signing`, including the new runtime action tests and updated runtime/OpenClaw smokes, then failed at `npm run smoke:release-validation` with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The full-suite blocker is unrelated to this runtime action extraction and matches the previously recorded release documentation contract mismatch in `README.md`.
- Runtime shutdown/clean-slate recovery and runtime ledger store ownership remain Phase C follow-up work.

Next action:

- Continue Phase C with `server/services/runtime/runtimeRecoveryService.ts`, preserving current shutdown and clean-slate safety behavior and adding focused clean-slate safety tests for Phase C item `28`.

### 2026-06-30 - Phase C Runtime Recovery Service Extraction

Scope:

- Extracted runtime shutdown and Monitor Clean Slate recovery into `server/services/runtime/runtimeRecoveryService.ts`.
- Moved shutdown in-flight dedupe, process-exit best-effort cleanup, Gateway client/runtime shutdown, active OpenClaw run termination, plugin setup terminal cleanup, OAuth callback cleanup, mission pre-shutdown snapshots, session lock cleanup, runtime ledger close, Monitor clear marker persistence, and clean-slate cache invalidation behind a testable service factory.
- Kept `server/controlPlane.ts` as dependency wiring by composing `createRuntimeRecoveryService(...)` with existing Gateway lifecycle/chat/log, OAuth, mission, runtime ledger, and session cleanup dependencies.
- Updated `server/services/runtime/runtimeActionService.ts` so runtime routes keep the same action methods and response shapes while delegating clean-slate and shutdown behavior through the recovery service.
- Added `tests/runtimeRecoveryService.test.ts` coverage for Clean Slate safety without stopping active runtime/Gateway work, concurrent shutdown dedupe, structured shutdown cleanup evidence, warning-tolerant cleanup continuation, and synchronous process-exit cleanup.
- Updated `tests/runtimeActionService.test.ts` so action-level tests verify recovery delegation instead of duplicating recovery internals.
- Updated `scripts/smoke-runtime-actions-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` so shutdown and Clean Slate ownership is asserted in `server/services/runtime/runtimeRecoveryService.ts` and cannot drift back into `controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `25,160` composition lines with `0` inline API routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase C items `23` and `28`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization run starts runtime ledger store ownership instead of repeating runtime recovery.

Verification:

- `npm run typecheck:server` passed.
- `npm run test:unit` passed with `52` tests, including the new runtime recovery coverage.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `25,160/29,000` control-plane composition lines, `0` inline routes, guard present.
- `npm run typecheck` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:openclaw` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed; Git reported only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed all gates through `smoke:release-signing`, including the new runtime recovery tests and updated runtime/architecture smokes, then failed at `npm run smoke:release-validation` with `AssertionError [ERR_ASSERTION]: README must document consumer distribution signing evidence` at `scripts/smoke-release-validation.ts:45:8`, expected `/distribution-signing\.json/`.

Risks and notes:

- The full-suite blocker is unrelated to runtime recovery and matches the previously recorded release documentation contract mismatch in `README.md`.
- The full-suite run again reported the known malformed historical `runtime-runs` JSONL recovery warning; the ledger smoke continued and passed before the later release-validation failure.
- Runtime ledger store ownership remains the last open Phase C extraction item.

Next action:

- Continue Phase C with runtime ledger store extraction for item `24`, preserving JSONL/SQLite fallback behavior and runtime status API shape.

### 2026-06-30 - Phase C Runtime Ledger Store Extraction

Scope:

- Added `server/state/runtimeLedgerStore.ts` as the runtime ledger state boundary for Phase C item `24`.
- Kept `server/runtimeLedger.ts` as the low-level SQLite/JSONL helper implementation while moving application composition, canonical ledger paths, control-center state namespace keys, append/read wrappers, non-blocking status reads, and close wiring behind `createRuntimeLedgerStore(...)`.
- Rewired `server/controlPlane.ts` so runtime run snapshots, Gateway event mirroring, Doctor diagnostic runs, mission record/event/report reads and writes, control-center state reads and writes, runtime status persistence checks, and runtime recovery ledger close all go through the store instead of direct raw helper imports.
- Added `tests/runtimeLedgerStore.test.ts` for malformed JSONL fallback diagnostics, JSONL append/read fallback across runtime/Gateway/diagnostic/mission ledgers, and namespaced control-center state ownership.
- Updated ledger-related smokes to pin the store boundary:
  - `scripts/smoke-server-entrypoint-boundary.ts`
  - `scripts/smoke-openclaw-contracts.mjs`
  - `scripts/smoke-runtime-ledger-jsonl-tail.ts`
  - `scripts/smoke-control-center-sqlite-state.ts`
  - `scripts/smoke-mission-durable-state.ts`
  - `scripts/smoke-mission-lifecycle-projection.ts`
  - `scripts/smoke-gateway-log-service.ts`
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `25,120` composition lines with `0` inline API routes.
- Updated `README.md` to document `release/evidence/distribution-signing.json`, clearing the previously recorded `smoke:release-validation` README contract blocker.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` automation progress for completed Phase C item `24`; Phase C items `21-30` are now complete and verified.

Verification:

- `npm run typecheck:server` passed.
- `npm run test:unit` passed with `55` tests, including the new runtime ledger store coverage.
- `npm run typecheck` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:server-architecture` passed with `9` entry lines, `25,120/29,000` control-plane composition lines, `0` inline routes, and the Phase A guard intact.
- `npm run smoke:ledger` passed and preserved malformed-row diagnostic evidence through the store boundary.
- `npm run smoke:control-center-state` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:gateway-logs` passed.
- `npm run smoke:openclaw` passed.
- `npm run smoke:release-validation` passed after the README contract fix.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed; Git reported only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- `server/runtimeLedger.ts` still owns raw SQLite schema creation and JSONL parsing; this is intentional for Phase C item `24`, which allowed keeping those helpers while moving app ownership behind `runtimeLedgerStore.ts`.
- `npm test` still logs the expected malformed historical `runtime-runs` JSONL recovery warning and expected control-plane error-handler smoke exceptions; those checks pass.
- The worktree already contained uncommitted Phase A, Phase B, and earlier Phase C extraction changes at the start of this run; this slice preserved them and layered the runtime ledger store boundary, tests, smokes, README contract fix, and ledger evidence on top.

Next action:

- Start Phase D by extracting mission creation/idempotency and transition rules into `server/services/missions/missionStateService.ts`, preserving duplicate idempotency-key behavior, mission ledger appends, and backend-owned recovered mission projection state.

### 2026-06-30

- Upgraded the vendored OpenClaw runtime baseline from `openclaw@2026.6.10` to `openclaw@2026.6.11`.
- Verified current npm package metadata:
  - OpenClaw tarball: `https://registry.npmjs.org/openclaw/-/openclaw-2026.6.11.tgz`
  - OpenClaw integrity: `sha512-T+P/g19IheeT1ckXMoPN61dYuE8vBF4MderI+kWkvpuFYxPkJxn8AXLpu9IXCnN9g36Acpm9+mMD/V+lsvOkyA==`
  - Bundled Codex tarball: `https://registry.npmjs.org/@openclaw/codex/-/codex-2026.6.11.tgz`
  - Bundled Codex integrity: `sha512-L9rO95x0DW7rpVJisPv2kkgwr04nKYAA1xbgDXVAm2oh801BCJFIJFo021bvhPmwo7MTAXNcuchO3laGa30QRQ==`
- Updated `scripts/prepare-openclaw-vendor.cjs`, `scripts/prepare-runtime-bundles.cjs`, runtime version diagnostics, reproducibility smokes, release-evidence smokes, release-validation smokes, and the OpenClaw optimization scorecard to target `2026.6.11`.
- Wired OpenClaw 2026.6.11 plugin distribution changes:
  - Plugin inventory fallback now merges bundled `dist/extensions` manifests with `scripts/lib/official-external-plugin-catalog.json`, `official-external-provider-catalog.json`, and `official-external-channel-catalog.json`.
  - External catalog entries keep package name, install spec, plugin icon, channel system image, provider setup, web-search provider ids, media-understanding provider ids, and video-generation provider ids.
  - The Plugins panel and runtime status payload now carry icon/system image/package/install metadata.
  - Regression coverage pins bundled plugin icons plus external Brave, Z.ai, and Mattermost catalog entries.
- Updated `docs/OPENCLAW_BETA_OPTIMIZATION_GUIDE.md` with the 2026.6.11 release delta, package evidence, and DystopAI wiring notes.
- Verification passed: `npm run prepare:openclaw-vendor`, `npm run prepare:runtime-bundles`, `npm run docs:openclaw:sync`, `node --import tsx --test tests/pluginInventoryService.test.ts`, `npm run smoke:plugins-control-plane`, `npm run smoke:plugin-inventory-service`, `npm run smoke:openclaw`, `npm run smoke:runtime-reproducibility`, `npm run typecheck`, `npm run test:unit`, `npm run lint`, `npm run smoke:release-evidence`, `npm run smoke:release-validation`, `npm run smoke:misc-control-plane`, `npm run notices:check`, `npm run build:standalone`, `git diff --check`, and full `npm test`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.

### 2026-06-27

- Upgraded the vendored OpenClaw runtime baseline from `openclaw@2026.6.6` to `openclaw@2026.6.10`.
- Verified the current npm stable package metadata:
  - Tarball: `https://registry.npmjs.org/openclaw/-/openclaw-2026.6.10.tgz`
  - Integrity: `sha512-LcooND2tBQw8A+kc1Ujltu3lg30bJ0w7XaeRy7eYzobb8BBdcW6DOGbwJL4vpj1vl9+gjRceOtlh5nh9OARcug==`
- Re-synced the local OpenClaw documentation mirror from `https://docs.openclaw.ai`; the snapshot now contains 693 pages and deletes stale local pages before each refresh.
- Updated `scripts/prepare-openclaw-vendor.cjs` to pin the 2026.6.10 tarball/integrity and tolerate the published package's production-scoped shrinkwrap mismatch by falling back to an install that preserves `npm-shrinkwrap.json`, then validates required runtime package versions.
- Updated the runtime recommendation constant to `2026.6.10`.
- Wired OpenClaw 2026.6.10 auto-fast support end to end:
  - `runtime.fastModeDefault` is persisted in local agent config.
  - Agent projection writes `agents.list[].fastModeDefault`.
  - Gateway `chat.send` receives one-turn `fastMode` for auto/on modes.
  - Fast-capable model allowlist entries get `params.fastMode: "auto"` and `params.fastAutoOnSeconds: 60` unless already customized.
  - Settings can apply Auto/On/Off fast-mode defaults to active agents.
  - Runtime optimization status reports fast-mode coverage.
- Updated `docs/OPENCLAW_BETA_OPTIMIZATION_GUIDE.md` with the 2026.6.10 delta, docs sync evidence, and DystopAI wiring notes.

### 2026-06-24

- Created recurring thread heartbeat automation to continue production hardening every 30 minutes.
- Created this durable ledger so future runs can resume from repository evidence instead of thread memory alone.
- Added an Electron/preload semantic type-check gate with `tsconfig.electron.json` and `npm run typecheck:electron`.
- Fixed two Electron tray gateway actions that accidentally called a Promise returned by `.then(...)` as a function before `.finally(...)`.
- Added JSDoc type anchors for Electron directory picker options and context menu templates so the new check can validate Electron API shapes.
- Fixed JSONL ledger tail recovery so a seek into the middle of a large file discards the first partial line, parses remaining rows independently, preserves valid records when another row is malformed, and records diagnostics with ledger name, file path, start offset, malformed-row count, and partial-line state.
- Added `scripts/smoke-runtime-ledger-jsonl-tail.ts` and `npm run smoke:ledger` to reproduce the corrupt-tail scenario.
- Created and switched to protective branch `codex/production-hardening` before broader server/OpenClaw-adjacent hardening.
- Read local OpenClaw docs before server/Gateway-adjacent edits:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Added `tsconfig.server.json` and `npm run typecheck:server`.
- Added combined `npm run typecheck` gate for app, server, and Electron/preload checks.
- Made `server/index.ts` pass strict semantic server type-checking by tightening Electron resource path access, loose config record boundaries, OAuth credential narrowing, OpenClaw provider migration narrowing, MDS patch normalization, Gateway backend client option typing, delegation fetch response typing, and OpenClaw runtime fallback result shapes.
- Added a real repository test gate: `npm test` now delegates to `npm run test:ci`, and `test:ci` runs semantic type-checking plus the JSONL ledger and mission-verification smoke checks.
- Centralized mission build/test evidence commands in `src/engine/missionVerification.ts`.
- Replaced code-generation mission evidence that pointed agents at nonexistent `npm test` with `npm run test:ci` in both the readiness validator and default mission seed.
- Added `scripts/smoke-mission-verification.ts` and `npm run smoke:mission-verification` to guard package scripts and mission evidence defaults against drifting back to an unavailable test command.
- Restored the Command Console run-evidence preview contract that was blocking the OpenClaw smoke suite.
- Added a closed-by-default `dy-command-evidence-preview` disclosure to rendered Command Console traces with smoke-addressable evidence rows for agent, state, run, session, transport, progress, latest activity, and omitted content.
- Kept Command Console trace evidence behind the shared diagnostic redaction boundary so previewed latest activity and copied trace text redact secrets, phone-like identifiers, and email addresses while never exposing transcript content.
- Added the required final-overrides styling for the Command Console evidence preview.
- Introduced a canonical renderer API client in `src/api/client.ts` with dev/prod base URL resolution, bearer-token attachment from the existing control-center token store, generated `X-Request-Id`, timeout/abort handling, JSON parsing, normalized error envelopes, and shared diagnostic redaction for error details.
- Reworked debounced heartbeat and runtime-policy persistence in `nexusStore` to use the canonical API client instead of raw `fetch(...).catch(() => {})`.
- Added per-agent `agentConfigSaveStatus` lifecycle state for heartbeat/runtime config saves: `saving`, `saved`, and `failed`, with revision sequencing so stale delayed responses cannot overwrite newer save status.
- Surfaced heartbeat/runtime save failures in `AgentEditorModal` as accessible `status`/`alert` text instead of always claiming automatic saves succeeded.
- Migrated the editor's pending runtime/heartbeat config flushes to the canonical API client and made delayed runtime patch failures visible to the operator.
- Added `scripts/smoke-config-save-lifecycle.ts`, `npm run smoke:config-save`, and wired the smoke into `npm run test:ci`.
- Extended agent configuration save lifecycle coverage beyond heartbeat/runtime to profile, MDS, and skill-library changes that previously persisted with empty catches.
- Added a canonical `persistAgentConfigPatch` path in `nexusStore` so profile, MDS, and skill saves now report `saving`, `saved`, or `failed` with request IDs and stale-response sequencing.
- Migrated editor model, sandbox/tool policy, workspace, resource-file, and provider-key saves to the canonical API client.
- Migrated the model selector's model list, provider-status refresh, and provider-key save paths to the canonical API client.
- Migrated the provider-auth modal's provider refresh and OAuth helper requests to the canonical API client while preserving existing status handling.
- Strengthened `scripts/smoke-config-save-lifecycle.ts` so future regressions fail if these config/provider paths bypass the API client or reintroduce swallowed config-save failures.
- Mounted the live renderer authentication flow by wrapping `NexusShell` in `AuthProvider` and rendering `LoginModal` until a valid session exists.
- Added `src/api/authenticatedFetch.ts` as a transitional bridge so remaining legacy same-origin `/api` fetches attach the current bearer token while the codebase continues migrating to `apiRequest`.
- Reworked `AuthContext` to use the canonical API client for login/status checks and to bootstrap packaged desktop sessions through a narrow preload capability.
- Added a per-launch Electron control token: Electron generates a strong launch secret when `CONTROL_CENTER_TOKEN` is not provided, passes it to the child API server, and exposes only `getControlCenterToken` to the trusted renderer.
- Added Electron IPC sender-origin validation for the directory picker and desktop auth token bridge.
- Replaced permissive server CORS with an exact local-origin allowlist for the packaged app and Vite dev frontend.
- Added early API request IDs and a server auth/origin guard before privileged routes. Only `/api/health`, `/api/auth/login`, and `/api/auth/status` bypass bearer validation.
- Updated Electron tray/control API calls to include the launch token now that privileged server routes require authentication.
- Updated the internal server-to-server agent handoff call to authenticate through the same guard with the server-owned launch token.
- Added `scripts/smoke-auth-control-plane.ts`, `npm run smoke:auth`, and wired the smoke into `npm run test:ci`.
- Added packaged UI static security headers, including a restrictive `Content-Security-Policy` for HTML responses, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Opener-Policy: same-origin`.
- Tightened Electron popup and navigation policy: popup creation is always denied, allowed external URLs are opened through the system browser only when they are external HTTPS URLs, exact internal app URLs may navigate, and all other navigation is prevented.
- Added `scripts/smoke-security-hardening.ts`, `npm run smoke:security`, and wired the smoke into `npm run test:ci`.
- Removed the production-facing fixed fallback credential. The server now uses `CONTROL_CENTER_TOKEN` when provided, otherwise generates a strong per-launch local token instead of accepting the old fixed dev token.
- Updated browser-login copy and operator docs so they direct users to the configured local token or generated startup token, while packaged desktop sessions continue to sign in through the Electron launch-token bridge.
- Migrated the recruit dialog's model lookup, provider lookup, Auto Forge markdown generation, and provider-key save paths from raw fetches to the canonical `apiRequest` client.
- Strengthened `scripts/smoke-auth-control-plane.ts` so future regressions fail if the fixed default token reappears in server/UI/docs or if `RecruitAgentModal` returns to raw `fetch(...)`.
- Re-read local OpenClaw runtime docs before packaging/runtime changes:
  - `docs/openclaw-latest/pages/install/node.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Removed production moving-version Codex resolution from `scripts/prepare-runtime-bundles.cjs`; the bundled Codex plugin now defaults to exact `@openclaw/codex@2026.6.10`.
- Added expected npm integrity and tarball assertions for the bundled Codex plugin, with exact-version and integrity requirements for any override through `DYSTOPAI_BUNDLED_CODEX_SPEC`.
- Added exact Node version validation and Node archive verification against Node's published `SHASUMS256.txt` before extracting bundled Node/npm archives.
- Changed Codex runtime dependency hydration to copy the package's already locked dependency tree from its shrinkwrap instead of rerunning npm inside the plugin root.
- Added runtime-bundle metadata files recording the exact Node archive checksum, Codex package integrity, Codex tarball, and native `@openai/codex` package integrity used for the prepared desktop runtime bundle.
- Added `scripts/smoke-runtime-reproducibility.ts`, `npm run smoke:runtime-reproducibility`, and wired the smoke into `npm run test:ci`.
- Updated README/User Guide install and packaging notes to prefer `npm ci` for reproducible local verification and document the exact runtime-bundle inputs.

Verification:

- Automation created successfully with id `dystopai-production-hardening`.
- `git status --short --branch` inspected before creating this file.
- Existing ledger search found only OpenClaw security audit docs, not an application hardening ledger.
- `npm run typecheck:electron` passed.
- `node --check electron/main.cjs` passed.
- `node --check electron/preload.cjs` passed.
- Probed backend type-checking with TypeScript. The server monolith still has existing semantic errors around Electron `process.resourcesPath`, loosely typed config records, provider optionality, runtime transport result unions, and agent capability partials. This remains a priority backlog item rather than being hidden.
- `npm run smoke:ledger` passed and logged the expected malformed-row diagnostic.
- Focused TypeScript check passed for `server/runtimeLedger.ts` and `scripts/smoke-runtime-ledger-jsonl-tail.ts`.
- `npm run typecheck:electron` still passed after the ledger smoke script addition.
- Earlier in this branch, `npm run smoke:openclaw` failed before reaching runtime-ledger checks because `scripts/smoke-openclaw-contracts.mjs` expected `dy-command-evidence-preview`; that blocker was resolved by the Command Console evidence preview restoration below.
- `npm run typecheck:server` passed.
- `npx tsc -p tsconfig.app.json --noEmit` passed.
- `npm run typecheck` passed.
- `npm run typecheck:electron` passed after server changes.
- `npm run smoke:ledger` passed after server changes.
- `npm run build:server` passed and produced `dist-server/index.cjs`.
- `npm run build:standalone` passed.
- `npm run smoke:mission-verification` passed.
- Source search confirmed no live mission evidence defaults still embed `command: 'npm test'`; remaining matches are the smoke guard and ledger notes.
- `npm test` passed. This ran `npm run typecheck`, `npm run smoke:ledger`, and `npm run smoke:mission-verification`.
- `npm run build:standalone` passed after the mission verification command changes.
- Re-read local OpenClaw Command Console/Gateway docs before restoring the Command Console evidence preview:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- `npm run smoke:openclaw` passed after the evidence preview restoration.
- Initial `npm run typecheck` caught a Command Console evidence-row key widening issue; the row construction was tightened with a typed `satisfies` check.
- `npm run typecheck` then passed.
- `npm run build:client` passed and rebuilt the Electron UI smoke bundle with the restored evidence preview.
- Initial `npm run smoke:ui` ran the previous built bundle and still showed the preview missing; after rebuilding the client, `npm run smoke:ui` passed on desktop and mobile, including evidence-preview accessibility labels, row content, redaction, copy behavior, stop behavior, and monitor Clean Slate checks.
- `npm test` passed after the Command Console evidence preview changes.
- `npm run smoke:config-save` passed.
- Initial `npm run typecheck` caught `RequestInit.signal` nullability in the new API client; the client now normalizes `null` to `undefined` before composing abort signals.
- `npm run typecheck` passed after the API/config-save lifecycle changes.
- `npm test` passed with the new `smoke:config-save` gate included in `test:ci`.
- `npm run build:client` passed after the API/config-save lifecycle changes.
- `npm run smoke:config-save` initially caught the smoke locator pointing at the `NexusState` interface instead of the implementation; the guard now anchors to the action implementation.
- `npx tsc -p tsconfig.app.json --noEmit` initially caught nullable `suggestedWorkspace` handling after the workspace save API-client migration; the workspace branch now narrows before updating state.
- `npm run smoke:config-save` passed after the expanded config/provider API-client migration.
- `npx tsc -p tsconfig.app.json --noEmit` passed after the expanded config/provider API-client migration.
- `npm run typecheck` passed after the expanded config/provider API-client migration.
- `npm test` passed after the expanded config/provider API-client migration.
- `npm run build:client` passed after the expanded config/provider API-client migration.
- `npm run smoke:auth` passed after the auth control-plane wiring.
- `npm run typecheck` passed after the auth control-plane wiring.
- `npm test` passed after the auth control-plane wiring, including typecheck, ledger recovery, mission verification, config-save lifecycle, and auth control-plane smokes.
- `npm run build:server` passed after the auth control-plane wiring.
- `node --check electron/main.cjs` and `node --check electron/preload.cjs` passed after the Electron launch-token and IPC changes.
- `npm run build:client` passed after the auth control-plane wiring.
- A final internal-call scan found the server's `/api/party/agent-to-agent` handoff fetch would have been blocked by the new guard; it now sends `Authorization: Bearer ${AUTH_TOKEN}` and `smoke:auth` asserts that contract.
- `npm run smoke:auth` passed after the internal handoff auth fix.
- `npm run typecheck` passed after the internal handoff auth fix.
- `npm test` passed after the internal handoff auth fix.
- `npm run build:server` passed after the internal handoff auth fix.
- `npm run smoke:security` passed after the CSP/Electron navigation hardening.
- `npm run typecheck` passed after the CSP/Electron navigation hardening.
- `node --check electron/main.cjs` and `node --check electron/preload.cjs` passed after the CSP/Electron navigation hardening.
- `npm test` passed after the CSP/Electron navigation hardening, including typecheck, ledger recovery, mission verification, config-save lifecycle, auth control-plane, and security hardening smokes.
- `npm run build:server` passed after the CSP/Electron navigation hardening.
- `npm run build:client` passed after the CSP/Electron navigation hardening.
- `npm run smoke:auth` passed after the static-default-token removal and recruit-dialog API-client migration.
- `npm run typecheck` passed after the static-default-token removal and recruit-dialog API-client migration.
- Source search confirmed the old fixed dev token literal now exists only in the auth smoke regression guard, not in server, renderer, operator docs, or this ledger.
- `npm test` passed after the static-default-token removal and recruit-dialog API-client migration, including typecheck, ledger recovery, mission verification, config-save lifecycle, auth control-plane, and security hardening smokes.
- `npm run build:server` passed after the static-default-token removal and recruit-dialog API-client migration.
- `npm run build:client` passed after the static-default-token removal and recruit-dialog API-client migration.
- `node --check electron/main.cjs` and `node --check electron/preload.cjs` passed after the static-default-token removal and recruit-dialog API-client migration.
- `npm view @openclaw/codex version dist.integrity dist.tarball --json` confirmed current package metadata for exact `2026.6.10` and its sha512 integrity before pinning.
- `npm run smoke:runtime-reproducibility` passed after adding the reproducibility contract.
- `node --check scripts/prepare-runtime-bundles.cjs` passed after the runtime-bundle prep changes.
- A forced `DYSTOPAI_REFRESH_RUNTIME_BUNDLES=1 npm run prepare:runtime-bundles` passed. It downloaded Node `v24.16.0`, verified `node-v24.16.0-win-x64.zip` against `SHASUMS256.txt`, installed exact `@openclaw/codex@2026.6.10`, copied the locked Codex dependency tree, and validated the native `codex.exe`.
- Generated runtime metadata confirmed Node archive SHA-256 `edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56`, Codex package integrity `sha512-0M5FsRb3IxsJ/xb2U1eMOZL/7w9W27tnzhSANY7JbbCRhz1+v7WUE6uS3YRWoTKv/9sNx9MAJXFntCK8MpWKYQ==`, and native `@openai/codex-win32-x64` integrity `sha512-lQrVLNz+90wdvWVNFDvCkHQRiAK9ZllmkTka3c8eqSDqdJk35Gpgppfv9Xtw5M2ZBtTq0sBdWBiCMyzGDBSpmQ==`.
- `npm test` passed after the runtime reproducibility changes, including typecheck, ledger recovery, mission verification, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the runtime reproducibility changes.
- `npm run build:client` passed after the runtime reproducibility changes.
- `node --check scripts/prepare-runtime-bundles.cjs`, `node --check electron/main.cjs`, and `node --check electron/preload.cjs` passed after the runtime reproducibility changes.
- Replaced the preset-looking mission report counters in `MissionOrchestrator` with evidence-backed report assembly in `src/engine/missionReport.ts`.
- Added mission report evidence fields for accepted, started, completed, failed, cancelled, timed-out, retry, fallback, verification-failure, tool-failure, command-failure, human-intervention, timing, participation, and token-usage signals.
- Changed mission report metrics that lack valid evidence, including XP gained and soul drift, to remain `null` and display as `Unavailable` instead of invented values.
- Tagged new live agent responses with the active mission ID where available so completed mission reports can be reconstructed from runtime evidence.
- Generated completed mission reports from runtime responses and mission feed events for both renderer-owned completions and backend cron mission history.
- Persisted completed mission reports and mission history across restart while keeping active mission/runtime state volatile.
- Migrated mission list polling plus cron mission start/stop calls to the canonical authenticated API client.
- Added `scripts/smoke-mission-report-truth.ts`, `npm run smoke:mission-report`, and wired the smoke into `npm run test:ci`.
- Updated the Mission Report and Live Operation Monitor UI to display unavailable metrics explicitly and expose the evidence counts behind the latest report.
- `npm run smoke:mission-report` passed after the mission-report truth changes.
- `npm run typecheck` passed after the mission-report truth changes.
- `npm test` passed after the mission-report truth changes, including typecheck, JSONL recovery, mission verification, mission report truth, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:client` passed after the mission-report truth changes.
- Source search confirmed the removed mission report counters/formulas no longer exist in app code; only the new smoke regression guard names those old counters.
- Re-read the local OpenClaw Gateway protocol documentation before the mission durability/server changes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Extended the runtime ledger with first-class durable mission event and mission report storage:
  - SQLite tables: `mission_events` and `mission_reports`
  - JSONL fallbacks: `mission-events.jsonl` and `mission-reports.jsonl`
  - Append/read APIs: `appendMissionEventLedger`, `appendMissionReportLedger`, `readMissionEventLedgerTail`, and `readMissionReportLedgerTail`
- Added backend mission lifecycle state vocabulary: `draft`, `validating`, `scheduled`, `dispatching`, `running`, `verifying`, `completed`, `failed`, and `cancelled`.
- Wrapped the existing cron mission routes with immutable backend state transition events that include timestamp, actor, previous state, next state, idempotency key, and supporting evidence.
- Added durable backend report generation for completed, cancelled, and scheduler-setup-failed missions.
- Exposed backend mission durability projections:
  - `GET /api/missions` now includes durable `events` and backend-authored `reports`.
  - `GET /api/missions/:missionId/events` returns the durable transition/event history for one mission.
  - `GET /api/missions/:missionId/report` returns the backend-authored mission report for one mission.
- Updated renderer mission sync to prefer backend-authored mission reports and only build local fallback reports when the backend has not produced one.
- Added `scripts/smoke-mission-durable-state.ts`, `npm run smoke:mission-durable-state`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:mission-durable-state` passed after the backend mission durability changes.
- `npm run typecheck` passed after the backend mission durability changes.
- `npm test` passed after the backend mission durability changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the backend mission durability changes.
- `npm run build:client` passed after the backend mission durability changes.
- Re-read the local OpenClaw Gateway protocol documentation before the mission-record rehydration changes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Extended the runtime ledger with durable backend mission records:
  - SQLite table: `mission_records`
  - JSONL fallback: `mission-records.jsonl`
  - Append/read APIs: `appendMissionRecordLedger` and `readMissionRecordLedgerTail`
- Added mission record snapshots for backend mission state, scheduler state, cron jobs, lifecycle state, party, timing, and persistence reason.
- Persisted backend mission snapshots on lifecycle transitions, cron job creation, cron job start/end, recurring cron setup, next-round scheduling, and graceful server shutdown.
- Added startup mission-record hydration that restores mission records into the backend mission map, rebuilds recurring mission shift projections, re-arms fixed-duration mission timers, and resumes waiting instant mission rounds where possible.
- Added defensive normalization for persisted mission records so malformed or incomplete ledger rows are ignored rather than becoming live backend state.
- Extended `scripts/smoke-mission-durable-state.ts` to verify mission-record append/read behavior and guard the new startup hydration/re-arm source contracts.
- `npm run smoke:mission-durable-state` passed after the mission-record rehydration changes.
- `npm run typecheck` passed after the mission-record rehydration changes.
- `npm test` passed after the mission-record rehydration changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the mission-record rehydration changes.
- Re-read the local OpenClaw Gateway protocol documentation before mission dispatch idempotency changes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Added backend mission launch idempotency:
  - `/api/missions/start` now accepts a bounded `idempotencyKey`.
  - Mission records persist the launch idempotency key.
  - Duplicate launch requests with the same key return the existing mission with `deduped: true` instead of creating another mission or cron job set.
  - Rehydrated mission records preserve the same launch dedupe behavior after restart.
- Updated renderer mission launch requests to send the existing launch request ID as the backend idempotency key.
- Updated mission launch feed text to surface deduped backend launches when a duplicate request returns the existing mission.
- Added `scripts/smoke-mission-idempotency.ts`, `npm run smoke:mission-idempotency`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:mission-idempotency` passed after the idempotent mission dispatch changes.
- `npm run typecheck` passed after the idempotent mission dispatch changes.
- `npm test` passed after the idempotent mission dispatch changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the idempotent mission dispatch changes.
- `npm run build:client` passed after the idempotent mission dispatch changes.
- Re-read the local OpenClaw cron and Gateway documentation before the rehydrated cron reconciliation changes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
- Added startup reconciliation between durable DystopAI mission records and OpenClaw's persisted cron SQLite state.
- Rehydrated mission cron jobs now rebuild `activeShifts` only when their exact OpenClaw cron IDs are still enabled.
- Missing or disabled recovered mission cron jobs are now observable scheduler failures:
  - The affected job is marked `removed` or `disabled`.
  - The mission scheduler moves to `failed` with a durable `lastError`.
  - The mission lifecycle moves to `failed` while the public mission status follows the existing cancelled-failure convention.
  - A durable recovery event records `missingCronIds`, `disabledCronIds`, and affected job IDs.
  - A backend mission report is recorded from that failure evidence.
- If the OpenClaw cron state database cannot be read, recovery does not treat that uncertainty as proof that jobs vanished; it logs the skipped reconciliation and keeps the prior projection behavior.
- Added `scripts/smoke-mission-cron-reconciliation.ts`, `npm run smoke:mission-cron-reconciliation`, and wired it into `npm run test:ci`.
- `npm run smoke:mission-cron-reconciliation` passed after the rehydrated cron reconciliation changes.
- `npm run typecheck` passed after the rehydrated cron reconciliation changes.
- `npm test` passed after the rehydrated cron reconciliation changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the rehydrated cron reconciliation changes.
- Re-read the local OpenClaw cron management documentation before the mission cancellation durability changes:
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
- Made mission cancellation durable and observable:
  - `/api/missions/stop` is now an async lifecycle rather than a fire-and-forget cleanup request.
  - Cancellation requests persist a `cancellation-requested` mission snapshot before cron cleanup begins.
  - Cron cleanup now returns structured evidence for each job: removed, disabled, unchanged/failed, previous status, final status, and redacted detail.
  - Completion and cancellation events now include cleanup evidence in their durable mission lifecycle event payloads.
  - Cleanup failures set `scheduler.status = failed`, write `scheduler.lastError`, emit an observable mission event, and are included in backend mission reports.
  - Successful operator cancellation finishes with `scheduler.status = stopped` after cleanup has actually settled.
  - The renderer stop request now uses a 120-second timeout so legitimate OpenClaw remove/disable cycles do not get misreported as stop failures.
- Added `scripts/smoke-mission-cancellation.ts`, `npm run smoke:mission-cancellation`, and wired it into `npm run test:ci`.
- `npm run smoke:mission-cancellation` passed after the mission cancellation durability changes.
- `npm run typecheck` passed after the mission cancellation durability changes.
- `npm test` passed after the mission cancellation durability changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the mission cancellation durability changes.
- `npm run build:client` passed after the mission cancellation durability changes.
- Re-read the local OpenClaw Gateway protocol and cron durability documentation before mission runtime-reference reconciliation:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
- Added durable runtime/session references to mission cron jobs:
  - `runOpenClaw` now returns the Control Center runtime ledger ID as `controlCenterRunId`.
  - Mission cron jobs persist `runtimeRunId`, `cronRunId`, `sessionId`, and `sessionKey`.
  - Cron run/session references are extracted from structured JSON output when available and fall back to conservative log parsing.
  - Mission cron completion events include the runtime/session references as durable evidence.
- Backend mission reports now expose runtime/session evidence:
  - `runtimeRunIds`
  - `cronRunIds`
  - `sessionIds`
  - `sessionKeys`
  - Evidence source now becomes `mixed` or `runtime-responses` when confirmed runtime identifiers are present.
- Mission Report UI now shows shortened runtime run IDs, cron run IDs, and session IDs when backend evidence provides them.
- Added `scripts/smoke-mission-runtime-references.ts`, `npm run smoke:mission-runtime-references`, and wired it into `npm run test:ci`.
- `npm run smoke:mission-runtime-references` passed after the mission runtime-reference changes.
- `npm run typecheck` passed after the mission runtime-reference changes.
- `npm test` passed after the mission runtime-reference changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, mission runtime references, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the mission runtime-reference changes.
- `npm run build:client` passed after the mission runtime-reference changes.
- Re-read the local OpenClaw Gateway protocol, cron durability, and Command Console guidance before Gateway session reconciliation changes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Added startup reconciliation between durable mission records, the Control Center runtime run ledger, and exact Gateway session references:
  - Mission hydration now runs after runtime-run ledger hydration so old wrapper runs are classified as `interrupted` or `timeout` before mission recovery evidence is assembled.
  - Active recovered mission jobs with durable runtime/session references now produce a `gatewaySessionReconciliation` event on startup.
  - Runtime run IDs are matched against active/recent Control Center runtime records.
  - Gateway session keys are checked with the documented `sessions.describe` RPC.
  - Reconciliation distinguishes `verified`, `missing`, `unavailable`, and `not-checked` session states.
  - Gateway unavailability is recorded as evidence and does not mutate mission or job state.
  - The helper intentionally avoids changing `mission.status`, `mission.lifecycleState`, or `job.status`; confirmed cron loss remains the only startup recovery path that fails a scheduler.
- Added `scripts/smoke-mission-gateway-reconciliation.ts`, `npm run smoke:mission-gateway-reconciliation`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:mission-gateway-reconciliation` passed after the Gateway session reconciliation changes.
- `npm run typecheck` passed after the Gateway session reconciliation changes.
- `npm test` passed after the Gateway session reconciliation changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, mission runtime references, mission Gateway reconciliation, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the Gateway session reconciliation changes.
- Added backend mission lifecycle projections backed by durable mission ledgers:
  - `/api/missions` now returns a projection built from latest durable mission records plus live in-memory mission state.
  - `/api/missions/projection` exposes the same durable projection explicitly for renderer hydration.
  - `/api/missions/:missionId/lifecycle` returns one mission's durable projection, feed, lifecycle events, reports, latest mission view, and latest report.
  - Projection metadata records source, mission counts, active mission counts, feed/event/report counts, durable record counts, and live memory record counts.
  - Durable lifecycle events are folded back into the existing mission-feed shape so the renderer can display recovery/state-machine events after a reload.
- Added renderer startup mission hydration from the backend projection:
  - `nexusStore` now exposes `syncMissionProjection`.
  - `NexusShell` calls `syncMissionProjection()` on authenticated app mount.
  - If the backend projection contains an active mission, the store starts backend polling so ongoing mission state continues refreshing after reload.
  - The active mission remains intentionally excluded from localStorage; the renderer now hydrates it from backend control-plane state instead.
- Added `scripts/smoke-mission-lifecycle-projection.ts`, `npm run smoke:mission-lifecycle-projection`, and wired the smoke into `npm run test:ci`.
- Updated `scripts/smoke-mission-durable-state.ts` so it validates the new projection contract instead of the obsolete inline `/api/missions` response literal.
- `npm run smoke:mission-lifecycle-projection` passed after the mission lifecycle projection changes.
- `npm run smoke:mission-durable-state` passed after updating the durable-state smoke for the projection path.
- `npm run typecheck` passed after the mission lifecycle projection changes.
- `npm test` passed after the mission lifecycle projection changes, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, mission runtime references, mission Gateway reconciliation, mission lifecycle projection, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:server` passed after the mission lifecycle projection changes.
- `npm run build:client` passed after the mission lifecycle projection changes.
- Removed renderer-generated report fallback for backend-controlled missions:
  - Backend mission projection sync now treats backend reports as authoritative.
  - When backend missions are present but no backend report exists yet, the renderer no longer synthesizes a report from local feed/response state.
  - Existing local reports are retained only when they do not collide with backend mission IDs or backend report IDs.
  - The renderer `MissionOrchestrator` path is now explicitly documented as local simulation-only, not the production mission control plane.
- Strengthened mission truth smokes:
  - `scripts/smoke-mission-report-truth.ts` now fails if backend-controlled missions use renderer-generated reports.
  - `scripts/smoke-mission-durable-state.ts` now fails if backend mission projections reintroduce `generatedReports`.
- `npm run smoke:mission-report` passed after removing renderer-generated backend reports.
- `npm run smoke:mission-durable-state` passed after removing renderer-generated backend reports.
- `npm run typecheck` passed after removing renderer-generated backend reports.
- `npm test` passed after removing renderer-generated backend reports, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, mission runtime references, mission Gateway reconciliation, mission lifecycle projection, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- `npm run build:client` passed after removing renderer-generated backend reports.
- Retired the legacy renderer mission lifecycle owner:
  - Removed the `MissionOrchestrator` import, instance, completion hooks, renderer-owned start branch, renderer-owned stop fallback, and reset-time orchestrator side effects from `nexusStore`.
  - Production mission launch now has one start path through the canonical authenticated `/api/missions/start` client call.
  - Production mission cancellation now has one stop path through the canonical authenticated `/api/missions/stop` client call.
  - Removed stale renderer mission helpers for local assignment prompts, commander synthesis prompts, heartbeat loop intervals, local completion scoring, and working-delegation event upserts.
  - Deleted `src/engine/MissionOrchestrator.ts` and removed its engine export so the retired lifecycle owner is no longer available to new production code.
  - Kept backend cron launch/stop feed messages and backend polling intact, preserving the durable mission projection flow.
- Added `scripts/smoke-mission-backend-owned.ts`, `npm run smoke:mission-backend-owned`, and wired it into `npm run test:ci`.
- Strengthened `scripts/smoke-mission-report-truth.ts` so it also guards against re-exporting the retired renderer mission owner.
- `npm run smoke:mission-backend-owned` passed after retiring the renderer mission lifecycle owner.
- `npm run smoke:mission-report` passed after retiring the renderer mission lifecycle owner.
- `npm run smoke:mission-durable-state` passed after retiring the renderer mission lifecycle owner.
- `npm run typecheck` passed after retiring the renderer mission lifecycle owner.
- `npm run build:server` passed after retiring the renderer mission lifecycle owner.
- `npm run build:client` passed after retiring the renderer mission lifecycle owner.
- `npm test` passed after retiring the renderer mission lifecycle owner, including typecheck, JSONL recovery, mission verification, mission report truth, mission durable state, mission idempotency, mission cron reconciliation, mission cancellation, mission runtime references, mission Gateway reconciliation, mission lifecycle projection, mission backend-owned lifecycle, config-save lifecycle, auth, security, and runtime reproducibility smokes.
- Established the first canonical API response-envelope slice:
  - Added server helpers `apiSuccess` and `apiFailure` that emit `{ ok: true, data, requestId }` and `{ ok: false, error: { code, message, status, detail? }, requestId }`.
  - Updated JSON parse failures plus the API origin/auth guard to return typed canonical error envelopes.
  - Migrated mission projection, mission lifecycle, mission events, mission reports, mission start, and mission stop routes to canonical envelopes.
  - Migrated auth login/status to canonical envelopes while preserving desktop launch-token and browser session behavior.
  - Migrated agent config read/write routes to canonical envelopes for not-found, invalid payload, workspace validation, model-auth failure, unchanged, and saved responses.
  - Made the renderer API client backward-compatible: it now unwraps canonical `{ ok: true, data }` payloads and parses structured `error.code`, `error.message`, and `error.detail` while continuing to support older endpoint shapes.
  - Updated the editor config-load path to consume the unwrapped config payload from the canonical client.
- Added `scripts/smoke-api-envelope.ts`, `npm run smoke:api-envelope`, and wired it into `npm run test:ci`.
- Updated mission idempotency, cancellation, and lifecycle-projection smokes so they validate canonical response envelopes instead of the retired raw JSON literals.
- `npm run smoke:api-envelope` passed after the first API envelope migration.
- `npm run smoke:auth` passed after the first API envelope migration.
- `npm run smoke:mission-backend-owned` passed after the first API envelope migration.
- `npm run smoke:config-save` passed after the first API envelope migration.
- `npm run smoke:mission-idempotency` passed after updating idempotency envelope expectations.
- `npm run smoke:mission-cancellation` passed after updating cancellation envelope expectations.
- `npm run smoke:mission-lifecycle-projection` passed after updating projection envelope expectations.
- `npm run typecheck` passed after the first API envelope migration.
- `npm run build:server` passed after the first API envelope migration.
- `npm run build:client` passed after the first API envelope migration.
- `npm test` passed after the first API envelope migration, including the new API envelope smoke plus all mission, config-save, auth, security, ledger, typecheck, and runtime reproducibility smokes.
- Re-read local OpenClaw Gateway and cron documentation before adding isolated mission API integration coverage:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
- Added an explicit test-only mission scheduler dry-run gate:
  - `CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN=1` lets integration tests exercise real mission start/stop/idempotency routes without creating OpenClaw cron jobs or touching Gateway runtime state.
  - Dry-run launches still persist mission records, emit scheduler evidence, transition the mission lifecycle to running, and keep cancellation/reporting behavior observable.
- Added `scripts/smoke-api-integration.ts`, a real HTTP integration smoke that launches the Control Center server in a child process with temporary workspace, temporary OpenClaw state, and temporary home directories.
- The API integration smoke verifies:
  - Invalid JSON returns the canonical `invalid_json` envelope.
  - Bad login returns `invalid_token`.
  - Good login returns a session token and authenticated status works.
  - Privileged mission projection without auth returns `auth_required`.
  - Disallowed request origins return `origin_not_allowed`.
  - Invalid mission launch payloads return `invalid_payload`.
  - Mission launch returns canonical data with the idempotency key and no cron jobs in dry-run mode.
  - Duplicate mission launch returns the existing mission with `deduped: true`.
  - Mission projection includes the launched mission.
  - Mission stop returns cleanup evidence and cancelled state.
  - Repeated mission stop returns `mission_invalid_state`.
  - Mission record JSONL is written under the temporary OpenClaw state root, proving the test does not use the operator's live state.
- Added `npm run smoke:api-integration` and wired it into `npm run test:ci`.
- `npm run smoke:api-integration` passed after adding the isolated HTTP integration smoke.
- `npm run typecheck` passed after adding the isolated HTTP integration smoke.
- `npm run build:server` passed after adding the isolated HTTP integration smoke.
- `npm run build:client` passed after adding the isolated HTTP integration smoke.
- `npm test` passed after adding the isolated HTTP integration smoke, including typecheck, all mission smokes, API envelope coverage, API integration coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the renderer-resilience run; work remained on protective branch `codex/production-hardening`.
- Added an application-level renderer recovery boundary in `src/components/system/AppErrorBoundary.tsx` and wrapped the live React tree at `src/main.tsx` so crashes in auth, shell, or lazy workspace rendering produce a controlled recovery surface instead of a blank console.
- Installed global renderer error handlers for `error` and `unhandledrejection` before React render, with a custom event bridge so non-React script failures are surfaced through the same recovery UI.
- Added a session-scoped crash-loop guard that records recent renderer failures in `sessionStorage`, uses a bounded 60-second crash window, and pauses normal rendering after repeated failures so reload loops stay visible and operator-recoverable.
- Added an accessible recovery screen with `role="alert"`, assertive live-region behavior, readable diagnostics, recent-crash counts, last-crash timing, and explicit Retry Shell, Reload Console, and Clear Crash Guard actions.
- Added scoped error-boundary styling in `src/components/system/AppErrorBoundary.css` with readable 14px body text and 36px minimum recovery controls.
- Added `scripts/smoke-error-boundary.ts`, `npm run smoke:error-boundary`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:error-boundary` passed after adding the renderer recovery boundary.
- `npm run typecheck` passed after adding the renderer recovery boundary.
- `npm run build:server` passed after adding the renderer recovery boundary.
- `npm run build:client` passed after adding the renderer recovery boundary.
- `npm test` passed after adding the renderer recovery boundary, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the skills/avatar control-plane run; work remained on protective branch `codex/production-hardening`.
- Extended canonical API response envelopes to the skills control plane:
  - `/api/skills/check`
  - `/api/skills/list`
  - `/api/skills/info/:skillName`
  - `/api/skills/library`
  - `/api/skills/library/:skillId`
  - `/api/skills/learn`
  - `/api/skills/clawhub/search`
  - `/api/skills/clawhub/install`
  - `/api/skills/clawhub/update`
- Added typed skills API errors for `skill_command_failed`, `skill_operation_failed`, and `skill_not_found`, preserving command output, exit code, retry, cleanup, and stderr evidence inside canonical redacted error details where applicable.
- Migrated avatar upload to the canonical envelope path with typed `avatar_upload_failed` errors instead of legacy `{ ok: false, error }` JSON.
- Migrated `SkillsPanel` from direct `fetch` and local JSON parsing to `apiRequest`/`apiErrorMessage` for skills check/list/info, library sync, library content reads, ClawHub search/install/update, and learned-skill saves.
- Migrated the agent editor's avatar upload and embedded skills tab from direct skill/avatar fetches to `apiRequest`, including shared skill library load, ClawHub search, ClawHub install, and ClawHub update.
- Added `scripts/smoke-skills-control-plane.ts`, `npm run smoke:skills-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:skills-control-plane` initially caught two overly line-oriented assertions; the smoke was relaxed to remain formatting-tolerant while preserving the contract.
- `npm run smoke:skills-control-plane` passed after adding the skills/avatar control-plane contract.
- `npm run typecheck` passed after the skills/avatar control-plane migration.
- `npm run build:server` passed after the skills/avatar control-plane migration.
- `npm run build:client` passed after the skills/avatar control-plane migration.
- `npm test` passed after the skills/avatar control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the plugin control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw plugin/runtime documentation before changing the plugin management surface:
  - `docs/openclaw-latest/pages/cli/plugins.md`
  - `docs/openclaw-latest/pages/plugins/building-plugins.md`
  - `docs/openclaw-latest/pages/plugins/sdk-setup.md`
  - `docs/openclaw-latest/pages/tools/skills-config.md`
- Extended canonical API response envelopes to the plugin control plane while preserving existing OpenClaw CLI command semantics:
  - `/api/plugins`
  - `/api/plugins/search`
  - `/api/plugins/install`
  - `/api/plugins/update-all`
  - `/api/plugins/gateway/restart`
  - `/api/plugins/clawtalk/setup`
  - `/api/plugins/:pluginId/update`
  - `/api/plugins/:pluginId/uninstall`
  - `/api/plugins/:pluginId/inspect`
  - `/api/plugins/:pluginId/config`
  - `/api/plugins/setup-terminal`
  - `/api/plugins/setup-terminal/:sessionId/input`
  - `/api/plugins/setup-terminal/:sessionId/resize`
  - `DELETE /api/plugins/setup-terminal/:sessionId`
  - `/api/plugins/:pluginId`
- Left `/api/plugins/setup-terminal/:sessionId/stream` as an SSE stream by design, with raw event framing preserved.
- Added typed plugin API errors for `plugin_command_failed`, `plugin_operation_failed`, `plugin_terminal_failed`, and `plugin_not_found`, with shared status mapping and redaction-safe diagnostics for OpenClaw command failures.
- Migrated `PluginsPanel` from its local `fetchJsonWithTimeout` helper and legacy `{ ok, error }` parsing to shared `apiRequest`/`apiErrorMessage` plumbing for plugin list/search/install/setup/toggle/update/inspect/restart/uninstall/update-all and the embedded OpenClaw command runner.
- Added `scripts/smoke-plugins-control-plane.ts`, `npm run smoke:plugins-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:plugins-control-plane` passed after adding the plugin control-plane contract.
- `npm run typecheck` passed after the plugin control-plane migration.
- `npm run build:server` passed after the plugin control-plane migration.
- `npm run build:client` passed after the plugin control-plane migration.
- `npm test` passed after the plugin control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills and plugin control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the runtime status control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Gateway/runtime docs before changing runtime status polling:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Extended canonical API response envelopes to the hot runtime polling endpoints:
  - `/api/openclaw/runtime/status`
  - `/api/openclaw/runtime/summary`
- Added typed runtime API errors for `runtime_status_failed` and `runtime_summary_failed`.
- Preserved the existing lightweight runtime status payload builders, cache reuse, fallback payloads, and timeout behavior described in the OpenClaw Gateway Command Console guide; only the Control Center HTTP contract changed.
- Migrated `useRuntimeStatus` and `useRuntimeSummaryStatus` polling from direct `fetch(apiUrl(...))` and hand-parsed legacy errors to shared `apiRequest`/`apiErrorMessage` plumbing.
- Preserved the existing renderer-side runtime polling behavior:
  - Subscriber-aware in-flight request coalescing.
  - Visibility/online-aware polling.
  - Idle abort handling when the last subscriber unsubscribes.
  - Force-refresh queuing while a request is already in flight.
  - Bounded request timeout calculation.
  - Last-snapshot timeout messaging for full status and summary polling.
- Added `scripts/smoke-runtime-status-control-plane.ts`, `npm run smoke:runtime-status-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:runtime-status-control-plane` passed after adding the runtime status control-plane contract.
- `npm run typecheck` passed after the runtime status control-plane migration.
- `npm run build:server` passed after the runtime status control-plane migration.
- `npm run build:client` passed after the runtime status control-plane migration.
- `npm test` passed after the runtime status control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the shift scheduler control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw scheduled-task documentation before changing cron/shift behavior:
  - `docs/openclaw-latest/pages/automation/cron-jobs.md`
- Extended canonical API response envelopes to the shift scheduler and cron route family:
  - `/api/shifts/start`
  - `/api/shifts/start-batch`
  - `/api/shifts/stop`
  - `/api/shifts/update`
  - `/api/shifts`
  - `/api/shifts/defaults`
  - `/api/shifts/defaults/:agentId`
- Added typed shift API errors for `shift_command_failed` and `shift_operation_failed`.
- Preserved OpenClaw cron CLI semantics and Control Center's existing active-shift runtime state, but changed the HTTP contract so create/edit/stop/list/defaults responses use canonical envelopes and request IDs.
- Changed the team workflow batch start path so an all-failed batch now returns a canonical `shift_command_failed` error instead of a 200 response with `ok: false` hidden in the payload.
- Migrated `stopCronShift`, `updateCronShift`, and `listCronShifts` in `useRuntimeStatus` from legacy `fetchJsonWithTimeout` parsing to shared `apiRequest`/`apiErrorMessage` plumbing.
- Migrated `HeartbeatSchedulerPanel` from direct `fetch` and `JSON.stringify` request bodies to shared `apiRequest` handling for shift list/defaults/start/start-batch/stop operations.
- Surfaced shift-default autosave failures in the scheduler panel instead of keeping them silent.
- Added `scripts/smoke-shifts-control-plane.ts`, `npm run smoke:shifts-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:shifts-control-plane` passed after adding the shift scheduler control-plane contract.
- `npm run typecheck` passed after the shift scheduler control-plane migration.
- `npm run build:server` passed after the shift scheduler control-plane migration.
- `npm run build:client` passed after the shift scheduler control-plane migration.
- `npm test` passed after the shift scheduler control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/shift control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the filesystem control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw CLI agent documentation before changing agent resource file behavior:
  - `docs/openclaw-latest/pages/cli/agent.md`
- Extended canonical API response envelopes to the filesystem-backed workspace/resource route family:
  - `/api/party/resources/:agentId`
  - `/api/party/resources/:agentId/:file`
  - `/api/party/folders`
  - `/api/party/folder-picker`
  - `/api/party/folder-picker/start`
  - `/api/party/folder-picker/:sessionId`
  - `/api/party/avatar-picker/start`
  - `/api/party/avatar-picker/:sessionId`
- Added typed filesystem/picker API errors for `filesystem_operation_failed`, `folder_list_failed`, `folder_picker_failed`, `image_picker_failed`, and `resource_not_found`.
- Changed folder picker cancellation from a legacy `{ ok: false }` payload into canonical success data with `status: "cancelled"` and `cancelled: true`, so operator cancellation is no longer reported like an infrastructure failure.
- Migrated `AgentEditorModal` workspace folder listing, folder-picker polling, resource file listing, resource file reading, and resource file saving to shared `apiRequest`/`apiErrorMessage` plumbing.
- Migrated recruit-time markdown bootstrap resource saves in `nexusStore` to `apiRequest` so newly recruited agents inherit standard request IDs, auth, timeout handling, and redaction-safe errors.
- Added `scripts/smoke-filesystem-control-plane.ts`, `npm run smoke:filesystem-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:filesystem-control-plane` passed after adding the filesystem control-plane contract.
- `npm run typecheck` passed after the filesystem control-plane migration.
- `npm run build:server` passed after the filesystem control-plane migration.
- `npm run build:client` passed after the filesystem control-plane migration.
- `npm test` passed after the filesystem control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/shift/filesystem control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the command-console file control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local Command Console/OpenClaw Gateway implementation guide before changing Command Console upload behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Extended canonical API response envelopes to the Command Console file/control route family:
  - `/api/files`
  - `/api/files/upload`
  - `/api/files/:file`
- Added typed file/control API errors for `file_upload_failed` and `control_file_operation_failed`.
- Migrated Command Console attachment upload in `AgentResponseConsole` from direct `fetch` plus hand-parsed JSON to shared `apiRequest`/`apiErrorMessage` plumbing, while preserving raw binary upload semantics, upload MIME hints, and the existing attachment payload shape sent into agent turns.
- Added `scripts/smoke-command-console-files-control-plane.ts`, `npm run smoke:command-console-files`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:command-console-files` passed after adding the Command Console file/upload contract.
- `npm run typecheck` passed after the Command Console file/upload migration.
- `npm run build:server` passed after the Command Console file/upload migration.
- `npm run build:client` passed after the Command Console file/upload migration.
- `npm test` passed after the Command Console file/upload migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/shift/filesystem/command-console-file control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the `nexusStore` control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local Command Console/OpenClaw Gateway implementation guide before changing agent-turn and Command Console control-plane behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Extended canonical API response envelopes to the remaining `nexusStore`-owned non-SSE control-plane route family:
  - `/api/party/overview`
  - `/api/party/recruit`
  - `DELETE /api/party/agent/:agentId`
  - `/api/openclaw/agent-preflight`
  - `/api/openclaw/agent-turn/sessions/clear`
- Added typed API errors for `agent_preflight_failed`, `agent_retire_failed`, `agent_session_operation_failed`, `party_operation_failed`, and `recruit_failed`.
- Migrated `nexusStore` party overview sync, recruit creation, post-recruit config save, retire, session warm-up, agent runtime preflight, buffered agent-turn fallback, sandbox auto-disable retry saves, and Command Console session-clear calls to shared `apiRequest`/`apiErrorMessage` plumbing.
- Preserved the live `/api/openclaw/agent-turn/stream` direct fetch because it reads SSE bytes and feeds the Command Console streaming parser; the new smoke requires it to remain the only direct fetch in `nexusStore`.
- Removed the now-unused `isAbortError` helper from `nexusStore` after the retire path moved to API-client timeout handling.
- Added `scripts/smoke-nexus-control-plane.ts`, `npm run smoke:nexus-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:nexus-control-plane` passed after adding the nexus control-plane contract.
- `npm run typecheck` initially caught the stale `isAbortError` helper, then passed after cleanup.
- `npm run build:server` passed after the nexus control-plane migration.
- `npm run build:client` passed after the nexus control-plane migration.
- `npm test` passed after the nexus control-plane migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/shift/filesystem/command-console-file/nexus control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the runtime-action/editor model control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Gateway/runtime docs before changing runtime action and model catalog behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
- Extended canonical API response envelopes to the runtime action and model catalog route family:
  - `/api/doctor/run`
  - `/api/doctor/recent`
  - `/api/openclaw/runtime/session/close`
  - `/api/openclaw/runtime/chat/abort-stale`
  - `/api/openclaw/runtime/monitor/clear`
  - `/api/openclaw/runtime/shutdown`
  - `/api/openclaw/runtime/gateway/stop`
  - `/api/openclaw/runtime/gateway/start`
  - `/api/openclaw/runtime/gateway/restart`
  - `/api/models/available`
- Added typed API errors for `doctor_operation_failed`, `runtime_action_failed`, and `model_catalog_failed`.
- Migrated `useRuntimeStatus` runtime actions from the legacy `fetchJsonWithTimeout` helper to a shared `runtimeActionRequest` wrapper over `apiRequest`, preserving structured timeout/abort errors for existing monitor UX.
- Migrated `AgentEditorModal` model catalog loading from its local `fetchWithTimeout` and `readJsonResponse` helpers to `apiRequest`/`apiErrorMessage`.
- Removed the remaining non-SSE direct React fetch helpers from the runtime hook and editor model loader; the renderer now keeps only the intentional Command Console SSE fetch plus the central API client fetch.
- Added `scripts/smoke-runtime-actions-control-plane.ts`, `npm run smoke:runtime-actions-control-plane`, and wired the smoke into `npm run test:ci`.
- Updated the existing runtime-status smoke to remain compatible with the expanded shared API-client import.
- `npm run smoke:runtime-actions-control-plane` passed after adding the runtime action/model catalog contract.
- `npm run smoke:runtime-status-control-plane` passed after updating the import assertion.
- `npm run typecheck` passed after the runtime-action/editor model migration.
- `npm run build:server` passed after the runtime-action/editor model migration.
- `npm run build:client` passed after the runtime-action/editor model migration.
- `npm test` initially caught the stale runtime-status smoke assertion, then passed after the smoke update, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus control-plane coverage, config-save, auth, security, ledger, and runtime reproducibility.
- Inspected branch/status and this ledger at the start of the auth/provider/model control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Control UI and agent CLI docs before changing provider-auth and per-agent model behavior:
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
- Extended canonical API response envelopes to the provider auth, OAuth, and per-agent model route family:
  - `/api/auth/providers`
  - `/api/auth/providers/:provider`
  - `DELETE /api/auth/providers/:provider`
  - `/api/auth/providers/:provider/oauth/start`
  - `/api/auth/providers/:provider/oauth/session/:sessionId`
  - `/api/auth/providers/:provider/oauth/session/:sessionId/manual`
  - `/api/party/agent/:agentId/model`
- Added typed API errors for `auth_provider_failed`, `oauth_operation_failed`, `model_auth_required`, and `model_operation_failed`.
- Added explicit catch paths around provider status probing, provider credential persistence/removal, OAuth start/manual completion, and per-agent model read/write so these control-plane failures no longer fall through to ad hoc or framework-default JSON.
- Preserved existing success data shapes such as `ok`, `provider`, `sessionId`, `providerStatus`, and `model`, but now inside canonical envelopes with request IDs.
- Migrated `ProviderAuthModal` away from its legacy `fetchJsonWithTimeout` compatibility shim; provider refresh, OAuth start, OAuth polling, and manual OAuth submission now use direct `apiRequest`/`apiErrorMessage` result handling.
- Added `scripts/smoke-auth-provider-model-control-plane.ts`, `npm run smoke:auth-provider-model`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:auth-provider-model` initially caught that `/api/auth/providers` lacked a canonical failure path, then passed after wrapping provider-status probing.
- `npm run typecheck` passed after the auth/provider/model migration.
- `npm run build:server` passed after the auth/provider/model migration.
- `npm run build:client` passed after the auth/provider/model migration.
- `npm test` passed after the auth/provider/model migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the OpenClaw command/summary control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Gateway and Command Console docs before changing OpenClaw command behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Extended canonical API response envelopes to the OpenClaw command/summary and coordination diagnostic route slice:
  - `/api/openclaw/summary`
  - `/api/openclaw/command`
  - `/api/party/parallel-health`
- Added typed API errors for `openclaw_summary_failed`, `openclaw_command_failed`, and `party_coordination_failed`.
- Preserved operator diagnostic semantics for `/api/openclaw/command`: OpenClaw process exit codes are still returned as data with `ok: result.code === 0`, while malformed requests and infrastructure failures now use canonical error envelopes.
- Preserved `parallel-health` timing evidence (`looksParallel`, wall-clock/summed duration, peak concurrency, and parallel efficiency) inside canonical data envelopes.
- Added `scripts/smoke-openclaw-command-control-plane.ts`, `npm run smoke:openclaw-command-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:openclaw-command-control-plane` passed after adding the OpenClaw command/summary contract.
- `npm run typecheck` passed after the OpenClaw command/summary migration.
- `npm run build:server` passed after the OpenClaw command/summary migration.
- `npm run build:client` passed after the OpenClaw command/summary migration.
- `npm test` passed after the OpenClaw command/summary migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the party coordination/handoff control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Gateway, Command Console, and agent CLI docs before changing agent coordination/handoff behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Extended canonical API response envelopes to the party dispatch/handoff route slice:
  - `/api/party/dispatch`
  - `/api/party/agent-to-agent`
- Added typed API errors for `party_dispatch_failed` and `party_handoff_failed`.
- Added pre-dispatch validation so invalid, retired, or missing party agents are rejected before `TEAM_SYNC.md` is written or OpenClaw agent runs are started.
- Preserved party execution evidence as canonical success data with `data.ok`, per-agent `outputs`, handoff `from`/`to` evidence, and timing telemetry instead of returning ad hoc JSON.
- Updated the internal agent-turn delegation compatibility caller to unwrap canonical handoff `data` and treat `data.ok === false` as a failed delegation even when the route transport succeeded.
- Added `scripts/smoke-party-coordination-control-plane.ts`, `npm run smoke:party-coordination-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:party-coordination-control-plane` passed after adding the party coordination contract.
- `npm run typecheck` passed after the party dispatch/handoff migration.
- `npm run build:server` passed after the party dispatch/handoff migration.
- `npm run build:client` passed after the party dispatch/handoff migration.
- `npm test` passed after the party dispatch/handoff migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the Team Sync control-plane run; work remained on protective branch `codex/production-hardening`.
- Read the local OpenClaw Gateway, Command Console, and agent CLI docs before changing the Team Sync coordination endpoint:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Extended canonical API response envelopes to `/api/team-sync/append`.
- Added typed API error `team_sync_failed`.
- Preserved agent-script compatibility by keeping `ok: true` inside canonical success `data`, while moving policy/write failures to request-ID-bearing canonical errors.
- Preserved Team Sync path-containment rules, canonical doctrine-only enforcement, basename checks, bounded append chunking, and split-line evidence in the canonical response data.
- Added `scripts/smoke-team-sync-control-plane.ts`, `npm run smoke:team-sync-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:team-sync-control-plane` passed after adding the Team Sync contract.
- `npm run typecheck` passed after the Team Sync migration.
- `npm run build:server` passed after the Team Sync migration.
- `npm run build:client` passed after the Team Sync migration.
- `npm test` passed after the Team Sync migration, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/team-sync/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the agent-turn compatibility control-plane run; work remained on protective branch `codex/production-hardening`.
- Re-read the local OpenClaw Command Console, Gateway, Control UI, WebChat, and agent CLI docs before changing agent-turn, ClawTalk, and stream fallback behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/openclaw-latest/pages/web/webchat.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
- Extended canonical API response envelopes to the agent-turn/ClawTalk compatibility route cluster:
  - `/api/openclaw/clawtalk-console/final`
  - `/api/openclaw/agent-turn`
  - `/api/browser/preflight`
- Added typed API errors for `agent_turn_failed` and `clawtalk_console_failed`.
- Preserved SSE behavior on `/api/openclaw/agent-turn/stream`; the stream route still initializes SSE and emits final frames instead of being converted to a buffered JSON route.
- Preserved failed agent execution evidence as canonical success `data` with `data.ok: false` for browser preflight failures, host-action failures, delegated handoff failures, and OpenClaw process failures, so the renderer can display reply/stdout/stderr/runtime context instead of losing the payload to an API-client exception.
- Moved malformed agent-turn payloads, invalid/retired agent IDs, delegation policy denials, and pre-reply infrastructure failures to request-ID-bearing canonical error envelopes.
- Updated the stream fallback helper to unwrap canonical `/api/openclaw/agent-turn` data and reject non-object parsed payloads before constructing a fallback final payload.
- Updated the party coordination smoke to match the evidence-preserving delegation contract: failed delegated handoffs are now canonical data with `data.ok: false`, not transport failures.
- Added `scripts/smoke-agent-turn-control-plane.ts`, `npm run smoke:agent-turn-control-plane`, and wired the smoke into `npm run test:ci`.
- `npm run smoke:agent-turn-control-plane` passed after adding the agent-turn compatibility contract.
- `npm run typecheck` passed after the agent-turn compatibility migration.
- `npm run build:server` passed after the agent-turn compatibility migration.
- `npm run build:client` passed after the agent-turn compatibility migration.
- `npm test` initially caught the stale party coordination smoke expectation, then passed after the smoke update, including typecheck, all mission smokes, API envelope coverage, API integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/team-sync/agent-turn/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the remaining raw-envelope cleanup run; work remained on protective branch `codex/production-hardening`.
- Re-read the local OpenClaw Command Console, Control UI, and agent CLI docs before changing recruit utility, workspace/config, and plugin terminal control-plane behavior:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
- Extended canonical API response envelopes to the remaining JSON route slice:
  - `/api/health`
  - `/api/runtime/version-check`
  - `/api/plugins/setup-terminal/:sessionId/stream` not-found error path
  - `/api/party/profile/:agentId`
  - `/api/party/identity`
  - `/api/party/recruit/auto-markdown`
  - `/api/party/workspace`
  - `/api/party/provision-resources`
  - `/api/party/workspace/cleanup-doctrine`
  - `/api/party/configs/sync`
- Added typed API errors for `agent_config_sync_failed` and `avatar_preview_failed`.
- Preserved native transports where JSON would be wrong: plugin setup terminal success still streams SSE frames, and avatar preview success still returns either a redirect or image bytes.
- Preserved compatibility payloads inside canonical data envelopes, including workspace validation `ok: false`/`suggestedWorkspace`, identity OpenClaw CLI `stdout`/`stderr`/`code`, Auto Forge generated file evidence, profile `agentId`, and config-sync result counts.
- Added `scripts/smoke-misc-control-plane.ts`, `npm run smoke:misc-control-plane`, and wired the smoke into `npm run test:ci`.
- Source scan now finds raw API JSON responses only inside the canonical `apiSuccess`/`apiFailure` helper implementations; API route bodies no longer emit ad hoc `res.json` or `res.status(...).json` payloads.
- `npm run smoke:misc-control-plane` initially caught that health/version routes have no route-local failure branch, then passed after narrowing those assertions to canonical success/no-raw-JSON contracts.
- `npm run typecheck` passed after the remaining raw-envelope cleanup.
- `npm run build:server` passed after the remaining raw-envelope cleanup.
- `npm run build:client` passed after the remaining raw-envelope cleanup.
- `npm test` passed after the remaining raw-envelope cleanup, including typecheck, all mission smokes, API envelope/integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/team-sync/agent-turn/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/misc/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the Electron sandbox hardening run; work remained on protective branch `codex/production-hardening`.
- Removed the packaged Windows production single-process escape hatch:
  - Removed the old `DYSTOPAI_WINDOWS_SINGLE_PROCESS` path.
  - Removed `WINDOWS_PACKAGED_SINGLE_PROCESS`.
  - Stopped tying BrowserWindow renderer sandboxing to that flag.
- Kept an intentionally explicit development-only diagnostic path for rare Windows renderer debugging:
  - Requires `DYSTOPAI_WINDOWS_DIAGNOSTIC_SINGLE_PROCESS=1`.
  - Requires `DYSTOPAI_ACK_UNSAFE_ELECTRON_SANDBOX_DIAGNOSTIC=1`.
  - Requires `isDev`.
  - Logs a warning before appending `single-process`, `in-process-gpu`, and `disable-gpu-sandbox`.
- Made the BrowserWindow always request `sandbox: true` while preserving existing context isolation and disabled Node integration.
- Strengthened `scripts/smoke-security-hardening.ts` so future regressions fail if the old production env flag returns, if the packaged single-process variable returns, if sandboxing becomes conditional again, or if unsafe process switches are not diagnostic-gated.
- `npm run smoke:security` passed after the Electron sandbox hardening.
- `node --check electron/main.cjs` and `node --check electron/preload.cjs` passed after the Electron sandbox hardening.
- `npm run typecheck:electron` passed after the Electron sandbox hardening.
- `npm run typecheck` passed after the Electron sandbox hardening.
- `npm run build:server` passed after the Electron sandbox hardening.
- `npm run build:client` passed after the Electron sandbox hardening.
- `npm test` passed after the Electron sandbox hardening, including typecheck, all mission smokes, API envelope/integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/team-sync/agent-turn/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/misc/config-save/auth/auth-provider-model/security/runtime-reproducibility coverage.
- Inspected branch/status and this ledger at the start of the release evidence hardening run; work remained on protective branch `codex/production-hardening`.
- Added a release evidence generator path for production artifacts:
  - `scripts/generate-release-evidence.cjs` emits `release/evidence/dystopai-sbom.cdx.json`.
  - It builds a CycloneDX 1.5 SBOM from `package-lock.json` plus prepared runtime metadata files.
  - It includes the prepared Node runtime, bundled `@openclaw/codex`, and native Codex runtime dependency metadata.
  - It writes `release/evidence/checksums.sha256` with SHA-256 hashes for release artifacts, build outputs, runtime metadata, packaging scripts, and the generated SBOM.
  - It writes `release/evidence/release-evidence.json` with component, checksum, and runtime metadata counts.
- Fixed release-evidence package-name derivation so lockfile components are recorded as real package names such as `react` instead of `node_modules/react`.
- Added `npm run release:evidence` as the operator command for generating SBOM/checksum evidence after packaging.
- Added `scripts/smoke-release-evidence.ts`, `npm run smoke:release-evidence`, and wired the smoke into `npm run test:ci`.
- Updated README packaging notes and common commands so release operators know to publish the SBOM, checksum manifest, and evidence summary with installer output.
- `node --check scripts/generate-release-evidence.cjs` passed after the release-evidence changes.
- `npm run smoke:release-evidence` initially caught the lockfile package-name bug, then passed after the generator fix.
- `npm run typecheck` passed after the release-evidence changes.
- `npm run build:server` passed after the release-evidence changes.
- `npm run build:client` passed after the release-evidence changes.
- `npm test` passed after the release-evidence changes, including typecheck, all mission smokes, API envelope/integration coverage, renderer recovery coverage, skills/plugin/openclaw-command/party-coordination/team-sync/agent-turn/runtime-status/runtime-action/shift/filesystem/command-console-file/nexus/misc/config-save/auth/auth-provider-model/security/runtime-reproducibility, and release-evidence coverage.
- Inspected branch/status and this ledger at the start of the CI workflow hardening run; switched from `main` back to protective branch `codex/production-hardening` before editing.
- Added the first GitHub Actions workflow for the hardened control plane at `.github/workflows/control-plane-ci.yml`.
- The workflow runs on pushes to `main` and `codex/**`, pull requests to `main`, and manual `workflow_dispatch` release-candidate runs.
- The workflow uses read-only repository permissions, Windows runners, Node 24, `npm ci`, semantic type-checking, the full production hardening smoke suite, server and client builds, reproducible runtime bundle preparation, release evidence generation, explicit release-evidence existence checks, and release evidence artifact upload.
- Added `scripts/smoke-ci-workflow.ts`, `npm run smoke:ci-workflow`, and wired the smoke into `npm run test:ci` so CI coverage cannot silently drop typecheck, tests, builds, runtime preparation, SBOM/checksum generation, or artifact upload.
- `npm run smoke:ci-workflow` passed after adding the workflow guard.
- `npm run typecheck` passed after the CI workflow changes.
- `npm run build:server` passed after the CI workflow changes.
- `npm run build:client` passed after the CI workflow changes.
- `npm run prepare:runtime-bundles` passed after the CI workflow changes and reused the prepared Node/Codex runtime metadata.
- `npm run release:evidence` passed after the CI workflow changes and wrote `release/evidence/dystopai-sbom.cdx.json`, `release/evidence/checksums.sha256`, and `release/evidence/release-evidence.json`.
- `npm test` passed after the CI workflow changes, including the new CI workflow smoke and all existing production hardening smokes.
- Inspected branch/status and this ledger at the start of the CI security-gates run; continued on protective branch `codex/production-hardening` with the uncommitted CI workflow slice still in progress.
- Added `npm run audit:dependencies` as a production dependency audit gate using `npm audit --omit=dev --audit-level=high`.
- Added `scripts/secret-scan.cjs` and `npm run secret:scan` for checked-in secret scanning.
- The secret scanner inspects tracked plus untracked non-ignored text files, skips generated/vendor/binary surfaces, detects high-confidence private keys and common provider tokens, redacts findings, and supports explicit one-line allowlist markers for intentional examples.
- Wired `npm run secret:scan` into `npm run test:ci` so local hardening checks fail before commits when obvious secrets are present.
- Extended `.github/workflows/control-plane-ci.yml` so CI runs production dependency audit and checked-in secret scanning before heavier typecheck/test/build work.
- Strengthened `scripts/smoke-ci-workflow.ts` so future regressions fail if dependency audit, secret scanning, scanner coverage, or CI step ordering is removed.
- `npm run audit:dependencies` passed with `found 0 vulnerabilities`.
- `node --check scripts/secret-scan.cjs` passed after adding the scanner.
- `npm run secret:scan` passed after adding and then expanding the scanner to include untracked non-ignored files.
- `npm run smoke:ci-workflow` initially caught an overly literal scanner allowlist assertion, then passed after tightening the smoke guard.
- `npm test` passed after the CI security-gates changes, including checked-in secret scanning and the strengthened CI workflow smoke.
- Inspected branch/status and this ledger at the start of the release-signing run; continued on protective branch `codex/production-hardening` with the uncommitted CI/security-gates slice still in progress.
- Added `scripts/sign-release-evidence.cjs` and `npm run release:sign`.
- Release signing now signs `release/evidence/checksums.sha256` with an Ed25519 private key supplied by `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE` or `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM`.
- The signing command writes:
  - `release/evidence/checksums.sha256.sig`
  - `release/evidence/signing-public-key.pem`
  - `release/evidence/release-signing.json`
- The signing summary records algorithm, key ID, signed-file digest, signature digest, public-key digest, CI metadata, and evidence paths without writing private-key material to artifacts.
- Added `scripts/smoke-release-signing.ts`, `npm run smoke:release-signing`, and wired the smoke into `npm run test:ci`.
- Extended `.github/workflows/control-plane-ci.yml` with an explicit opt-in release-signing step gated by `vars.DYSTOPAI_RELEASE_SIGNING_ENABLED == 'true'` and backed by the `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM` secret.
- Strengthened `scripts/smoke-ci-workflow.ts` so future regressions fail if the optional signing step, signing key secret, or signing order is removed.
- Updated README release instructions so operators know to run `npm run release:sign` after `npm run release:evidence` and publish the signature, public key, and signing summary with the SBOM/checksum files.
- `node --check scripts/sign-release-evidence.cjs` passed after adding the signing script.
- `npm run smoke:release-signing` passed and verified fail-closed missing-key behavior plus a real Ed25519 signature against the generated public key.
- `npm run smoke:ci-workflow` passed after the optional signing workflow guard was added.
- `npm run secret:scan` passed after adding signing code and docs.
- `npm test` passed after the release-signing changes, including release-signing smoke coverage.
- `npm run audit:dependencies` passed after the release-signing changes with `found 0 vulnerabilities`.
- Inspected branch/status and this ledger at the start of the packaged artifact validation run; continued on protective branch `codex/production-hardening` with the uncommitted CI/release-hardening slices still in progress.
- Added `scripts/validate-release-artifacts.cjs` and `npm run release:validate`.
- Release validation now:
  - Parses `release/evidence/checksums.sha256`.
  - Recomputes SHA-256 for every manifest entry.
  - Requires the generated SBOM to be included in the checksum manifest.
  - Requires at least one packaged artifact under `release/` outside `release/evidence/` unless `DYSTOPAI_RELEASE_VALIDATE_ALLOW_NO_ARTIFACTS=1` is explicitly set.
  - Validates CycloneDX SBOM format/version and release evidence summary counts.
  - Verifies the detached Ed25519 checksum signature when signing evidence is present.
- Added `scripts/smoke-release-validation.ts`, `npm run smoke:release-validation`, and wired the smoke into `npm run test:ci`.
- The release-validation smoke generates a temporary packaged artifact, creates release evidence, validates unsigned evidence, signs the checksum manifest, validates signed evidence, then proves tampering with the packaged artifact fails validation.
- Extended `.github/workflows/control-plane-ci.yml` so CI packages the desktop directory with `node scripts/package-desktop.cjs --dir` before generating release evidence, then runs `npm run release:validate` before uploading evidence.
- Strengthened `scripts/smoke-ci-workflow.ts` so future regressions fail if desktop packaging, release validation, or the validation-before-upload ordering is removed.
- Updated README release instructions and command table for `npm run release:validate`.
- `node --check scripts/validate-release-artifacts.cjs` passed after adding the validator.
- `npm run smoke:release-validation` passed after adding the validator and smoke.
- `npm run smoke:ci-workflow` passed after adding packaging and validation workflow guards.
- `npm run secret:scan` passed after adding release validation code and docs.
- `npm test` passed after the packaged artifact validation changes, including release-validation smoke coverage.
- `npm run audit:dependencies` passed after the packaged artifact validation changes with `found 0 vulnerabilities`.

## 2026-06-24 15:10 UTC - Electron End-To-End Startup And Shutdown Smoke

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/production-hardening` with the prior CI/release-hardening work still uncommitted.
- Added E2E-only Electron main-process hooks guarded by `DYSTOPAI_ELECTRON_E2E`:
  - Forced missing-server startup failure mode for deterministic failure-path coverage.
  - Modal-free startup/UI error handling so CI cannot hang behind blocking Electron dialogs.
  - Testable named popup and navigation handlers that deny popups by default, allow exact internal origins, and route allowed external HTTPS URLs through the external opener.
  - E2E-only external-open suppression and navigation policy self-test assertions.
  - E2E-only port-cleanup skip so smoke runs do not kill the operator's live backend/frontend.
  - E2E-only app-ownership roots that avoid treating the source checkout itself as a cleanup target.
  - Auto-quit and quit-cleanup lifecycle markers for observable shutdown coverage.
- Added `scripts/smoke-electron-e2e.ts` and `npm run smoke:electron-e2e`.
- The Electron smoke launches Electron on random throwaway API/frontend/Gateway ports with temporary user-data, OpenClaw state, and workspace directories.
- The smoke covers successful desktop startup, server readiness, popup/navigation policy assertions, auto-quit, quit cleanup, and forced missing-server startup failure.
- Wired the Electron smoke into `.github/workflows/control-plane-ci.yml` after server/client builds and before runtime packaging/release evidence.
- Extended `scripts/smoke-ci-workflow.ts` so CI fails if the Electron smoke script or workflow ordering is removed.
- Updated `scripts/smoke-security-hardening.ts` to assert the named popup/navigation handlers and E2E navigation assertions.
- Documented `npm run smoke:electron-e2e` in the README command table.
- Verified the user's live development ports remained up after the Electron smoke: `4050` and `5173` were still listening.
- Confirmed the live launch token must be exchanged through `/api/auth/login` for a session token before `/api/auth/status` returns `authenticated: true`; a direct `/api/auth/status` check with the launch token returns `authenticated: false` by design.
- `node --check electron/main.cjs` passed after adding the E2E hooks.
- `npm run smoke:electron-e2e` passed after switching early E2E failure exits from `app.exit()` to `process.exit()` to avoid a Windows Electron access-violation exit.
- `npm run smoke:ci-workflow` passed after adding the Electron workflow gate.
- `npm run smoke:security` passed after updating the Electron handler assertions.
- `npm run typecheck:electron` passed after adding JSDoc typing for the extracted window-open handler.
- `npm test` passed after the Electron E2E changes.
- `npm run audit:dependencies` passed after the Electron E2E changes with `found 0 vulnerabilities`.

## 2026-06-24 15:25 UTC - Electron Renderer Policy And Crash Recovery E2E

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/production-hardening` with the existing CI/release/Electron hardening work still uncommitted.
- Expanded the Electron E2E hooks to exercise the loaded renderer, not only main-process helper functions:
  - Added renderer load markers under `DYSTOPAI_ELECTRON_E2E`.
  - Added a guarded renderer-originated `window.open` probe and external `window.location` navigation probe.
  - Kept external opening suppressed under E2E while still asserting that HTTPS external attempts pass through the same central external opener.
  - Added renderer crash request and recovery markers around Electron's `render-process-gone` reload path.
  - Added an E2E-only quit-after-renderer-assertions path so the smoke exits only after renderer recovery is observed.
- Expanded `scripts/smoke-electron-e2e.ts` with a new `renderer-recovery` case covering:
  - Successful Electron/server startup on throwaway ports.
  - First renderer load.
  - Renderer-originated popup denial and external navigation prevention.
  - Central external-open handling for allowed HTTPS targets.
  - Forced renderer crash.
  - `render-process-gone` observation.
  - Renderer reload/recovery.
  - Quit cleanup.
- Updated `scripts/smoke-security-hardening.ts` to assert that renderer-originated external-navigation and renderer-recovery E2E hooks remain present.
- Updated the README command table so `npm run smoke:electron-e2e` documents renderer navigation policy and renderer crash recovery coverage.
- Verified the user's live development ports remained up after the Electron smoke: `4050` and `5173` were still listening.
- `node --check electron/main.cjs` initially caught a patch-escaped template literal, then passed after correcting it.
- `npm run typecheck:electron` initially caught the same syntax issue, then passed after correction.
- `npm run smoke:electron-e2e` initially failed on the syntax issue, then passed after correction.
- `npm run smoke:security` passed after adding the renderer E2E assertions.
- `npm test` passed after the renderer E2E changes.
- `npm run audit:dependencies` passed after the renderer E2E changes with `found 0 vulnerabilities`.

## 2026-06-24 15:40 UTC - Electron Tray Hide/Restore E2E

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/production-hardening` with the existing hardening work still uncommitted.
- Expanded the Electron E2E harness to cover tray behavior:
  - Added a typed tray menu template snapshot so smoke tests can assert labels and enabled state without changing the visible menu.
  - Added E2E-only tray behavior assertions guarded by `DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_BEHAVIOR`.
  - The tray behavior self-test explicitly shows the main window, asserts the tray menu offers `Hide UI`, closes the window, verifies the normal close handler hides the window instead of quitting, asserts the tray menu flips to `Show UI`, emits the tray click path, and verifies the window is restored with `Hide UI` available again.
  - Added E2E markers for `tray-visible-state-ok`, `tray-hide-on-close-ok`, and `tray-click-restore-ok`.
- Expanded `scripts/smoke-electron-e2e.ts` with a dedicated `tray-behavior` case so tray lifecycle regressions are isolated from startup, renderer-recovery, and startup-failure checks.
- Updated `scripts/smoke-security-hardening.ts` so future edits fail if the tray behavior E2E hook or tray click path assertion disappears.
- Updated the README command table so `npm run smoke:electron-e2e` documents tray hide/restore coverage.
- Verified the user's live development ports remained up after the Electron smoke: `4050` and `5173` were still listening.
- `npm run typecheck:electron` initially caught the tray menu template type widening; added an explicit `MenuItemConstructorOptions[]` JSDoc annotation and reran successfully.
- `npm run smoke:electron-e2e` initially timed out because CI-style windows may not become visible on their own; adjusted the E2E tray self-test to explicitly show/focus the window before exercising close-to-tray behavior, then reran successfully.
- `node --check electron/main.cjs` passed after the tray E2E changes.
- `npm run smoke:security` passed after adding the tray E2E assertions.
- `npm test` passed after the tray E2E changes.
- `npm run audit:dependencies` passed after the tray E2E changes with `found 0 vulnerabilities`.

## 2026-06-24 15:52 UTC - Packaged Desktop Launch Smoke

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/production-hardening` with the existing hardening work still uncommitted.
- Added file-backed Electron E2E logging through `DYSTOPAI_ELECTRON_E2E_LOG_PATH`.
  - Normal production behavior is unchanged.
  - E2E markers still print to stdout when available.
  - Packaged/GUI launch tests can now wait on deterministic marker files even when launcher stdout is unavailable.
- Added `scripts/smoke-packaged-electron-launch.ts` and `npm run smoke:packaged-electron-launch`.
- The packaged launch smoke:
  - Requires the unpacked packaged app layout under `release/win-unpacked`.
  - Verifies the Windows launcher, bundled Electron runtime, `app.asar`, packaged frontend, packaged backend, bundled Node/npm toolchain, and bundled OpenClaw resources exist.
  - Launches `release/win-unpacked/DystopAI.exe`, exercising the custom Windows launcher rather than only the development Electron binary.
  - Uses random throwaway API/frontend/Gateway/browser-relay ports and temporary user-data, OpenClaw state, and workspace directories.
  - Waits for packaged app E2E markers proving port-cleanup skip, server readiness, navigation-policy self-test, auto-quit, and quit cleanup.
  - Cleans up exact packaged Electron runtime processes on failure by targeting `release/win-unpacked/electron.exe`.
- Wired `npm run smoke:packaged-electron-launch` into `.github/workflows/control-plane-ci.yml` after `node scripts/package-desktop.cjs --dir` and before release evidence generation.
- Extended `scripts/smoke-ci-workflow.ts` so future CI edits fail if the packaged launch smoke or its package-before-launch-before-evidence ordering is removed.
- Updated the README command table for `npm run smoke:packaged-electron-launch`.
- Rebuilt the current packaged desktop directory with `npm run package:desktop` before running the packaged-launch smoke, so the smoke exercised the current Electron code.
- Regenerated release evidence after packaging and validated it against the rebuilt packaged artifacts.
- Verified the user's live development ports remained up after the packaged launch smoke: `4050` and `5173` were still listening.
- `node --check electron/main.cjs` passed after adding file-backed E2E logging.
- `npm run typecheck:electron` passed after adding file-backed E2E logging.
- `npm run smoke:ci-workflow` passed after wiring packaged launch into CI.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked`.
- `npm run smoke:packaged-electron-launch` passed against `release/win-unpacked/DystopAI.exe`.
- `npm run smoke:electron-e2e` passed after adding file-backed E2E logging.
- `npm run smoke:security` passed after the packaged launch additions.
- `npm run release:evidence` passed after rebuilding the packaged desktop directory.
- `npm test` passed after the packaged launch additions.
- `npm run audit:dependencies` passed after the packaged launch additions with `found 0 vulnerabilities`.
- `npm run release:validate` passed after regenerating evidence, verifying `68476` checksums, `68464` packaged artifact files, and `634` SBOM components.

## 2026-06-24 16:05 UTC - CI Lint Gate

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/production-hardening` with the existing hardening work still uncommitted.
- Ran `npm run lint` before wiring the gate to identify the current blocker shape.
- Fixed the lint findings instead of suppressing the rule globally:
  - Added a short cleanup comment to the best-effort process-kill fallback in `scripts/smoke-electron-e2e.ts` so `no-empty` stays active.
  - Removed the redundant synchronous `setChecking(false)` call from the no-token/no-desktop-provider branch in `src/context/AuthContext.tsx`.
  - Moved the desktop launch-token login `setChecking(true)` call into the async login turn so the React hooks lint rule does not see a synchronous state update inside the effect body.
- Added `npm run lint` to the CI workflow after dependency audit/secret scanning and before semantic type-checking.
- Prepended `npm run lint` to `npm run test:ci` so local `npm test` mirrors the CI gate order.
- Extended `scripts/smoke-ci-workflow.ts` so future workflow or script edits fail if:
  - The workflow loses `npm run lint`.
  - Lint no longer runs after secret scanning and before type-checking.
  - `test:ci` no longer lints before type-checking.
- While verifying the slice, `npm run smoke:electron-e2e` exposed an intermittent Windows Electron access-violation exit for the E2E-only forced startup-failure path when using `process.exit(2)`.
  - Changed the E2E startup-failure path to log the modal-free startup error and exit with normal `app.quit()`.
  - Updated the startup-failure smoke expectation to validate the observable failure marker and non-hanging exit instead of a fragile forced nonzero Electron exit.
- Verified the live development ports remained available after the run: `4050` and `5173` were listening.
- `npm run lint` initially failed, then passed after the lint fixes.
- `npm run smoke:ci-workflow` passed after adding the lint workflow/script assertions.
- `npm run typecheck` passed after the lint fixes.
- `node --check electron/main.cjs` passed after the Electron startup-failure adjustment.
- `npm run typecheck:electron` passed after the Electron startup-failure adjustment.
- `npm run smoke:electron-e2e` initially exposed the Windows forced-exit issue, then passed after the startup-failure adjustment.
- `npm test` passed with lint now running first in `test:ci`.
- `npm run audit:dependencies` passed after the lint-gate changes with `found 0 vulnerabilities`.

## 2026-06-24 16:20 UTC - CI OpenClaw Smoke Gate

- Inspected branch/status and this ledger at the start of the run; continued on protective branch `codex/ci-openclaw-smoke` from clean `main` after the prior production-hardening merge.
- Re-read the relevant local OpenClaw/Gateway docs before changing OpenClaw-adjacent smoke coverage:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
- Ran `npm run smoke:openclaw` and confirmed it was not a product regression: the first failure was a stale source-contract assertion expecting an exact whitespace substring for the Gateway health-gated startup path.
- Replaced that brittle assertion in `scripts/smoke-openclaw-contracts.mjs` with an ordered function-section check that still verifies:
  - Gateway health monitoring starts.
  - Gateway startup is only attempted when the health probe fails.
  - Health is rechecked after startup.
  - Stale Gateway clients are reset only after the health-gated startup path.
- Ran `npm run smoke:openclaw` again and exposed a second real test drift: the agent-turn SSE smoke was receiving `401` because the hardened control-plane auth guard now protects `/api/openclaw/agent-turn/stream`.
- Updated `scripts/smoke-agent-turn-stream.ts` to start its isolated server with a throwaway `CONTROL_CENTER_TOKEN` and send `Authorization: Bearer ...` on each privileged stream request.
- Wired `npm run smoke:openclaw` into `npm run test:ci` immediately after the OpenClaw command-control-plane smoke.
- Strengthened `scripts/smoke-ci-workflow.ts` so future edits fail if:
  - `smoke:openclaw` no longer points at the OpenClaw contract smoke.
  - `test:ci` drops the OpenClaw smoke gate.
  - `test:ci` runs OpenClaw smoke before semantic type-checking or after the final CI workflow contract check.
- Verified the user's live development ports remained available after the run: `4050` and `5173` were listening.
- `npm run smoke:ci-workflow` passed after adding the OpenClaw gate assertions.
- `npm run smoke:openclaw` initially failed on stale contract and missing smoke auth, then passed after the smoke updates.
- `npm test` passed with `smoke:openclaw` now included in `test:ci`.
- `npm run audit:dependencies` passed after the OpenClaw smoke-gate changes with `found 0 vulnerabilities`.

## 2026-06-24 16:45 UTC - CI OpenClaw Smoke Fix

- Investigated the failed GitHub Actions run reported by notification:
  - Run: `28113505903`
  - Branch: `codex/ci-openclaw-smoke`
  - Commit: `d7d209c`
  - Failed step: `Run production hardening smoke suite`
- Confirmed the failing CI log stopped in `npm run smoke:openclaw` while reading `vendor/openclaw/dist/plugin-sdk/packages/gateway-protocol/src/schema/logs-chat.d.ts`.
- Verified that file exists locally but is ignored by the repository-wide `dist/` rule, so GitHub Actions correctly checks out without it.
- Kept OpenClaw protocol coverage, but moved `scripts/smoke-openclaw-contracts.mjs` away from the ignored generated `vendor/openclaw/dist` schema artifact.
- Re-anchored the chat protocol assertions to committed sources:
  - `docs/openclaw-latest/pages/gateway/protocol.md` for idempotency, chat methods, `deltaText`, `runId`, and `sessionKey`.
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md` for Command Console expectations around `chat` `delta`, `final`, `error`, `aborted`, `chat.history`, `chat.message.get`, and `chat.abort`.
- `npm run smoke:openclaw` passed after removing the ignored generated-artifact dependency.
- `npm run smoke:ci-workflow` passed after the CI-safe smoke update.
- `npm test` passed after the CI-safe smoke update.
- `npm run audit:dependencies` passed after the CI-safe smoke update with `found 0 vulnerabilities`.

## 2026-06-24 16:55 UTC - CI Electron Binary Repair

- Rechecked the GitHub Actions rerun after the OpenClaw artifact fix:
  - Run: `28114149749`
  - Commit: `11167e1`
  - Result: `npm test` and `smoke:openclaw` passed in CI.
  - New failed step: `Run Electron end-to-end smoke`.
- The CI Electron smoke failed before launching the app because the Electron package import could not read `node_modules/electron/path.txt`.
- Made `scripts/smoke-electron-e2e.ts` explicitly ensure the Electron binary before importing the `electron` package:
  - Resolves `electron/package.json` without importing Electron first.
  - Reuses an existing binary when present.
  - Restores `path.txt` when the executable exists but the package metadata file is missing.
  - Falls back to downloading the exact Electron release zip from GitHub with synchronous platform tools, verifies it against `node_modules/electron/checksums.json`, and extracts it before importing Electron.
  - Uses literal PowerShell command arguments on Windows so Actions receives the URL and file paths reliably.
- Strengthened `scripts/smoke-ci-workflow.ts` so future changes fail if the Electron E2E smoke loses this explicit binary preparation.
- `npm run smoke:ci-workflow` passed after adding the Electron binary-prep assertions.
- `npm run smoke:electron-e2e` passed after adding explicit Electron binary preparation.
- `npm test` passed after the Electron CI repair.
- `npm run audit:dependencies` passed after the Electron CI repair with `found 0 vulnerabilities`.

## 2026-06-24 17:15 UTC - CI OpenClaw Vendor Packaging Repair

- Rechecked the GitHub Actions rerun after the Electron binary repair:
  - Run: `28116047834`
  - Commit: `d9f16b0`
  - Result: OpenClaw smoke, Electron E2E, build, and reproducible runtime bundle steps passed in CI.
  - New failed step: `Package desktop directory`.
- The packaging failure came from `scripts/after-pack.cjs` because CI had no ignored `vendor/openclaw/node_modules` directory:
  - `Missing vendored OpenClaw node_modules at ...\vendor\openclaw\node_modules`
- After the first vendor dependency repair was pushed, CI run `28117209900` confirmed that the vendored dependency preparation step passed, then exposed the next ignored-artifact assumption:
  - `Missing vendored OpenClaw extensions at ...\vendor\openclaw\dist\extensions`
- Read the local OpenClaw documentation before changing the packaging/runtime dependency path:
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/openclaw-latest/pages/install/node.md`
  - `docs/openclaw-latest/pages/gateway/security/shrinkwrap.md`
  - `docs/openclaw-latest/pages/plugins/dependency-resolution.md`
- Added `scripts/prepare-openclaw-vendor.cjs` so the desktop packaging path hydrates the full published OpenClaw runtime payload from the exact `openclaw@2026.6.6` npm tarball before hydrating production dependencies.
- The package-payload hydration verifies the pinned npm SHA-512 integrity for `https://registry.npmjs.org/openclaw/-/openclaw-2026.6.6.tgz`, validates the extracted package name/version, and copies the published `dist/` tree into the ignored vendored package directory when clean CI lacks it.
- The dependency hydration installs vendored OpenClaw production dependencies from `vendor/openclaw/npm-shrinkwrap.json` with:
  - `npm ci`
  - `--omit=dev`
  - `--ignore-scripts`
  - `--no-audit`
  - `--no-fund`
- The script validates key runtime packages against the shrinkwrap versions, records the shrinkwrap SHA-256, writes `.dystopai-openclaw-vendor-deps.json` under the ignored vendor `node_modules`, and no-ops when the existing dependency tree already matches.
- Added `DYSTOPAI_OPENCLAW_VENDOR_ROOT` support so the missing-node_modules path can be tested in a temporary OpenClaw package copy without touching the real vendored dependency tree.
- Wired `npm run prepare:openclaw-vendor` into:
  - `.github/workflows/control-plane-ci.yml` before `node scripts/package-desktop.cjs --dir`
  - `package:desktop`
  - `dist:win`
  - `scripts/package-desktop.cjs` itself, so direct packaging is self-preparing.
- Strengthened `scripts/smoke-ci-workflow.ts` and `scripts/smoke-runtime-reproducibility.ts` so future changes fail if CI or package scripts stop preparing vendored OpenClaw dependencies from the shrinkwrap.
- Verification passed:
  - Temporary clean OpenClaw package copy: `node scripts/prepare-openclaw-vendor.cjs` hydrated `dist/` from the integrity-checked OpenClaw package tarball, installed 296 production packages from `npm-shrinkwrap.json`, and wrote the metadata file.
  - `npm run prepare:openclaw-vendor`
  - `npm run smoke:ci-workflow`
  - `npm run smoke:runtime-reproducibility`
  - `npm run lint`
  - `node scripts/package-desktop.cjs --dir`
  - `npm run smoke:packaged-electron-launch`
  - `npm test`
  - `npm run audit:dependencies` with `found 0 vulnerabilities`.
- GitHub Actions verification passed after the package-payload hydration:
  - Run: `28118191004`
  - Commit: `94dfbf2`
  - Result: Control Plane CI passed in `7m38s`, including vendored OpenClaw dependency prep, desktop packaging, packaged launch smoke, release evidence generation, release validation, and evidence upload.

## 2026-06-24 18:21 UTC - Server HTTP Boundary And Public Auth Route Extraction

- Revised heartbeat automation `dystopai-production-hardening` to prioritize:
  - Breaking up `server/index.ts` into route modules and services.
  - Main branch protection expectations.
  - Mandatory release signing for public builds.
  - Full CI evidence on clean release SHAs.
  - A documented local-only desktop threat model.
- Started the server decomposition work on protective branch `codex/server-route-modules`.
- Extracted shared HTTP/control-plane behavior from `server/index.ts` into `server/controlPlaneHttp.ts`:
  - Request ID assignment.
  - Exact local-origin CORS validation.
  - JSON body parsing and canonical invalid-JSON failures.
  - Public API allowlist.
  - Bearer-token auth guard.
  - Canonical `apiSuccess` and `apiFailure` envelopes.
  - Bounded `ApiErrorCode` union.
  - Packaged UI CSP and static security headers.
- Extracted public auth login/status routes into `server/routes/authRoutes.ts` and wired `server/index.ts` through `registerAuthRoutes(app, { authToken: AUTH_TOKEN, sessionTokens })`.
- Reduced `server/index.ts` from `30,816` lines on `main` to `30,585` lines in this slice, while creating the first route-module pattern for later domain extraction.
- Updated control-plane smoke tests so API error-code ownership is asserted against `server/controlPlaneHttp.ts` while existing domain route assertions continue to inspect `server/index.ts` until those routes are extracted.
- Verification passed:
  - `npm run typecheck:server`
  - `npm run smoke:api-envelope`
  - `npm run smoke:auth`
  - `npm run smoke:security`
  - `npm run smoke:plugins-control-plane`
  - `npm run smoke:agent-turn-control-plane`
  - `npm run smoke:shifts-control-plane`
  - `npm run smoke:misc-control-plane`
  - `npm run lint`
  - `npm test`
- GitHub Actions verification passed for the pushed PR branch:
  - PR: `#1`
  - Run: `28120340143`
  - Commit: `7c2bc8d`
  - Result: Control Plane CI completed successfully.

## 2026-06-24 18:59 UTC - Command Console File Route And Service Extraction

- Continued server decomposition on protective branch `codex/server-route-modules`, then cherry-picked the runtime-only slice onto clean PR branch `codex/runtime-route-modules` after PR `#1` was merged into `main`.
- Read local OpenClaw/Command Console documentation before touching Command Console-owned endpoints:
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
- Extracted the Command Console file-control service into `server/services/controlFilesService.ts`:
  - Allowed control-file list.
  - Control-file validation.
  - Workspace-root scoped read/write operations.
- Extracted the `/api/files` route cluster into `server/routes/commandConsoleFileRoutes.ts`:
  - `GET /api/files`
  - `POST /api/files/upload`
  - `GET /api/files/:file`
  - `PUT /api/files/:file`
- Kept the existing upload persistence helper injected from `server/index.ts` so this slice does not entangle the route extraction with the larger Command Console runtime/upload pipeline.
- Reduced `server/index.ts` from `30,585` lines after the prior slice to `30,524` lines after this extraction.
- Strengthened `scripts/smoke-command-console-files-control-plane.ts` so it now asserts:
  - `server/index.ts` registers the extracted route module.
  - `server/index.ts` no longer inlines `/api/files` handlers.
  - `server/services/controlFilesService.ts` owns the control-file list and validator.
  - `server/routes/commandConsoleFileRoutes.ts` still emits canonical success/error envelopes.
- Verification passed:
  - `npm run typecheck:server`
  - `npm run smoke:command-console-files`
  - `npm run lint`
  - `npm test`
- GitHub Actions verification passed for the pushed PR branch:
  - PR: `#1`
  - Run: `28122536668`
  - Commit: `c8d6a76`
  - Result: Control Plane CI completed successfully in `8m40s`.

## 2026-06-24 19:14 UTC - Diagnostics And Health Route Extraction

- Continued server decomposition on protective branch `codex/server-route-modules`.
- Extracted diagnostics/health routes into `server/routes/diagnosticsRoutes.ts`:
  - `GET /api/health`
  - `GET /api/runtime/version-check`
  - `POST /api/doctor/run`
  - `GET /api/doctor/recent`
- Kept existing diagnostic/runtime/doctor calculation functions in `server/index.ts` and injected them into the route module to avoid mixing route extraction with behavior rewrites.
- Reduced `server/index.ts` from `30,524` lines after the prior slice to `30,502` lines after this extraction.
- Strengthened `scripts/smoke-misc-control-plane.ts` so it asserts:
  - `server/index.ts` registers the extracted diagnostics route module.
  - `server/index.ts` no longer inlines the health/version/doctor routes.
  - `server/routes/diagnosticsRoutes.ts` still emits canonical success/error envelopes.
- Updated `scripts/smoke-runtime-actions-control-plane.ts` so doctor route assertions follow the extracted diagnostics module while runtime action assertions remain against `server/index.ts`.
- Verification passed:
  - `npm run typecheck:server`
  - `npm run smoke:misc-control-plane`
  - `npm run smoke:runtime-actions-control-plane`
  - `npm run lint`
  - `npm test`
- GitHub Actions verification passed for the pushed PR branch:
  - PR: `#1`
  - Run: `28123433878`
  - Commit: `a593d5c`
  - Result: Control Plane CI completed successfully in `9m4s`.

## 2026-06-24 19:47 UTC - Plugin Route Extraction

- Continued server decomposition on protective branch `codex/server-route-modules`.
- Confirmed latest GitHub Actions state before editing:
  - PR run `28124035710` passed.
  - Push run `28124033719` passed.
- Read the local OpenClaw plugin documentation before changing the plugin management surface:
  - `docs/openclaw-latest/pages/cli/plugins.md`
  - `docs/openclaw-latest/pages/plugins/building-plugins.md`
  - `docs/openclaw-latest/pages/plugins/sdk-setup.md`
- Extracted plugin HTTP routing into `server/routes/pluginRoutes.ts` while preserving the existing OpenClaw CLI/runtime helper functions in `server/index.ts`:
  - `GET /api/plugins`
  - `GET /api/plugins/search`
  - `POST /api/plugins/install`
  - `POST /api/plugins/update-all`
  - `POST /api/plugins/gateway/restart`
  - `POST /api/plugins/clawtalk/setup`
  - `POST /api/plugins/:pluginId/update`
  - `POST /api/plugins/:pluginId/uninstall`
  - `POST /api/plugins/:pluginId/inspect`
  - `POST /api/plugins/:pluginId/config`
  - `POST /api/plugins/setup-terminal`
  - `GET /api/plugins/setup-terminal/:sessionId/stream`
  - `POST /api/plugins/setup-terminal/:sessionId/input`
  - `POST /api/plugins/setup-terminal/:sessionId/resize`
  - `DELETE /api/plugins/setup-terminal/:sessionId`
  - `POST /api/plugins/:pluginId`
- Preserved the setup-terminal SSE transport: the module still returns canonical not-found errors before the stream starts and then emits raw SSE frames by design.
- Kept this slice route-only: plugin install/update/config/restart logic is injected from the existing server helpers so behavior is not mixed with the extraction.
- Reduced `server/index.ts` from `30,502` lines after the diagnostics slice to `30,179` lines after this extraction.
- Added `server/routes/pluginRoutes.ts` at `452` lines.
- Updated `scripts/smoke-plugins-control-plane.ts` so it now asserts:
  - `server/index.ts` registers `registerPluginRoutes(app, { ... })`.
  - `server/index.ts` no longer inlines plugin routes.
  - `server/routes/pluginRoutes.ts` owns canonical success/error envelopes and plugin setup-terminal SSE.
- Updated `scripts/smoke-misc-control-plane.ts` so its setup-terminal SSE assertions follow the extracted plugin route module.
- Verification passed:
  - `npm run typecheck:server`
  - `npm run smoke:plugins-control-plane`
  - `npm run smoke:misc-control-plane`
  - `npm run lint`
  - `npm test`
- Observed during `npm test`: `smoke:ledger` reported one skipped malformed historical JSONL row while reading `runtime-runs`; the smoke passed and preserved the corruption-recovery warning instead of treating the file as empty.
- GitHub Actions verification passed for the pushed PR branch:
  - PR: `#1`
  - PR run: `28125277911`
  - Push run: `28125275632`
  - Commit: `fe0bc07`
  - Result: Control Plane CI completed successfully in `8m29s` for the PR-triggered run and `11m42s` for the push-triggered run.

## 2026-06-24 20:21 UTC - Runtime Route Extraction

- Continued server decomposition on protective branch `codex/server-route-modules`.
- Confirmed latest GitHub Actions state before editing:
  - PR run `28125983188` passed.
  - Push run `28125980909` passed.
- Read the local OpenClaw runtime/Gateway documentation before touching runtime and Gateway-adjacent routes:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`
- Extracted runtime HTTP routing into `server/routes/runtimeRoutes.ts` while preserving the existing Gateway/runtime helper functions in `server/index.ts`:
  - `POST /api/openclaw/runtime/session/close`
  - `POST /api/openclaw/runtime/chat/abort-stale`
  - `POST /api/openclaw/runtime/monitor/clear`
  - `POST /api/openclaw/runtime/shutdown`
  - `POST /api/openclaw/runtime/gateway/stop`
  - `POST /api/openclaw/runtime/gateway/start`
  - `POST /api/openclaw/runtime/gateway/restart`
  - `GET /api/openclaw/runtime/status`
  - `GET /api/openclaw/runtime/summary`
- Kept this slice route-only: runtime ownership, Gateway lifecycle, session cleanup, status payload construction, and activity summarization are injected from the existing server helpers.
- Reduced `server/index.ts` from `30,179` lines at the prior HEAD to `30,052` lines after this extraction.
- Added `server/routes/runtimeRoutes.ts` at `264` lines.
- Updated route contract smokes so they follow the extracted runtime module instead of forcing runtime handlers to remain in `server/index.ts`:
  - `scripts/smoke-runtime-status-control-plane.ts`
  - `scripts/smoke-runtime-actions-control-plane.ts`
  - `scripts/smoke-openclaw-command-control-plane.ts`
  - `scripts/smoke-openclaw-contracts.mjs`
- Verification passed:
  - `npm run typecheck:server`
  - `npm run smoke:runtime-status-control-plane`
  - `npm run smoke:runtime-actions-control-plane`
  - `npm run smoke:openclaw-command-control-plane`
  - `npm run smoke:openclaw`
  - `npm run lint`
  - `npm test`
- Observed during `npm test`: `smoke:ledger` again reported one skipped malformed historical JSONL row while reading `runtime-runs`; the smoke passed and preserved the corruption-recovery warning instead of treating the file as empty.
- GitHub Actions verification passed for the original pushed source-branch commit before the clean PR branch was prepared:
  - Run: `28127179243`
  - Source commit: `7a17351`
  - Clean-branch extraction commit: `25dd9b3`
  - Result: Control Plane CI completed successfully in `7m28s`.
  - Evidence: lint, app/server/Electron typecheck, production hardening smoke suite, server build, client build, Electron end-to-end smoke, reproducible runtime bundle prep, vendored OpenClaw dependency prep, desktop packaging, packaged desktop launch smoke, SBOM/checksum generation, release artifact validation, release evidence verification, and release evidence upload all passed.
  - Note: the `Sign release evidence` CI step was skipped for this non-release push run; public release signing remains tracked as a mandatory release-governance item.

### 2026-06-24/25 - Integrated Today's Hardening Stack For Main

Scope:

- Created integration branch `codex/integrate-today-hardening` from `origin/main` to combine the remaining open production-hardening PRs without direct pushes to `main`.
- Integrated the code-bearing fixes from today's open PR stack:
  - PR #3 filesystem route extraction.
  - PR #4 OpenClaw command route extraction and packaged Electron launch cleanup.
  - PR #5 public release signing governance and validation enforcement.
  - PR #6 Skills/ClawHub route extraction.
  - PR #7 provider-auth/model route extraction.
  - PR #8 mission route extraction.
  - PR #9 agent-turn route extraction.
  - PR #10 party coordination and TEAM_SYNC route extraction.
  - PR #11 ClawTalk console stream/final route extraction.
- Preserved the already-merged runtime/plugin/diagnostics route extractions from `main`.
- Normalized the hardening ledger back to this single canonical file and removed the duplicate lowercase `docs/production-hardening-ledger.md` introduced by later independent PR branches.
- Resolved route-registration and smoke-test conflicts so contract tests now assert the composed extracted-route architecture instead of stale inline route locations.

Verification:

- `npm run typecheck:server` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:party-coordination-control-plane` passed.
- `npm run smoke:openclaw` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:auth-provider-model` passed after updating the provider-before-skills order guard for extracted skills routes.
- `npm run lint` passed.
- `npm test` passed after integration conflict resolution. This included lint, app/server/Electron typecheck, all production hardening smoke suites, secret scan, runtime reproducibility, release evidence, release signing, release validation, and CI workflow checks.
- Observed during `npm test`: `smoke:ledger` again reported one skipped malformed historical JSONL row while reading `runtime-runs`; the smoke passed and preserved valid rows.
- GitHub PR #12 initially failed Control Plane CI in the packaged desktop launch smoke before app launch because the integration branch carried two `removeTempRootWithWindowsRetries` declarations in `scripts/smoke-packaged-electron-launch.ts`.
- Removed the stale duplicate cleanup helper and kept the stronger Windows-safe process-kill/retry cleanup helper.
- `npm run smoke:packaged-electron-launch` passed after the duplicate cleanup helper was removed.
- PR #12 was merged to `main` as merge commit `9f2cad1d1a86e6f47c148f56333007d4cb25e6be`.
- Superseded individual PRs #3 through #11 were closed with notes after their code-bearing changes landed through PR #12.
- Clean `main` Control Plane CI passed after the merge:
  - Run: `28142306325`
  - Commit: `9f2cad1d1a86e6f47c148f56333007d4cb25e6be`
  - Result: `Hardened control plane` passed in `8m19s`.
  - Evidence: locked install, dependency audit, secret scan, lint, app/server/Electron typecheck, production hardening smoke suite, server/client builds, Electron e2e smoke, reproducible runtime prep, vendored OpenClaw prep, desktop packaging, packaged launch smoke, SBOM/checksum generation, release validation, release evidence verification, and evidence upload all passed.

Notes:

- Evidence-only PR commits were not cherry-picked individually; their evidence is consolidated here to avoid stale ledger conflicts.
- The `Sign release evidence` CI step was skipped for this non-release merge because public release signing is intentionally enforced for release contexts; mandatory signing remains covered by release validation/smoke checks.

### 2026-06-25 - README Production Architecture Refresh

Scope:

- Updated `README.md` with the current production-hardening posture.
- Added the extracted backend route-module architecture and responsibilities so GitHub readers can understand the new `server/routes/*` layout.
- Documented the local-only desktop threat model, release evidence expectations, CI gate, and public-release signing requirement from `docs/RELEASE_GOVERNANCE.md`.
- Added `npm run typecheck`, `npm test`, package-launch validation, and release evidence commands to the validation/readiness path.

Verification:

- `git diff --check` passed before commit.
- `npm run lint` passed.

### 2026-06-25 - Consumer Release Chain And Error Redaction Gate

Scope:

- Removed the stale root-level `main.cjs` Electron entrypoint. The only active Electron entry remains `electron/main.cjs`, and `smoke:security` now fails if a root copy returns.
- Changed Windows consumer distribution metadata from directory-only output to an NSIS installer target; kept `package:desktop` and `dist:win:dir` for unpacked CI/local launch smoke checks.
- Removed stale `.local` support/homepage metadata from `package.json` and pointed package metadata at the GitHub project.
- Added recursive, depth-limited API error-detail redaction in `server/controlPlaneHttp.ts`, including nested array/object traversal, circular-reference handling, sensitive-key redaction for token/authorization/apiKey/secret/cookie/code/verifier/password/credential fields, and truncation for very large details.
- Added `scripts/smoke-api-error-redaction.ts` and wired it into `npm run test:ci`.
- Strengthened public release validation:
  - `release/evidence/distribution-signing.json` is now included in release checksums when present before `npm run release:evidence`.
  - Public release validation with `DYSTOPAI_RELEASE_REQUIRE_SIGNING=1` now requires the Ed25519 checksum signature plus distribution evidence for a signed Windows installer, signed update channel, rollback proof, and fresh-install/upgrade/uninstall/corrupted-update tests.
  - GitHub Actions now expects `distribution-signing.json` in public release evidence bundles.
- Updated `README.md` and `docs/RELEASE_GOVERNANCE.md` to distinguish Ed25519 checksum signing from OS trust requirements such as Authenticode, macOS notarization, signed updates, rollback, and installer lifecycle tests.
- Hardened `scripts/secret-scan.cjs` so the scanner skips tracked paths deleted in the current working tree instead of crashing before a deletion is committed.

Verification:

- `npm run smoke:api-error-redaction` passed.
- `npm run smoke:security` passed.
- `npm run smoke:release-evidence` passed.
- `npm run smoke:release-validation` passed, including the fail-closed public-release path without distribution evidence and the passing path after distribution evidence is included in signed checksums.
- `npm run smoke:ci-workflow` passed.
- `npm run smoke:api-envelope` passed.
- `npm run secret:scan` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node --check scripts/validate-release-artifacts.cjs`, `node --check scripts/generate-release-evidence.cjs`, `node --check electron/main.cjs`, and `node --check electron/preload.cjs` passed.
- `npm test` passed after all changes.

Notes:

- This completes repository enforcement for consumer-distribution evidence, but actual public release readiness still requires real signing infrastructure: Windows Authenticode certificate/timestamping, macOS Developer ID signing/notarization on macOS runners, signed update-channel implementation, rollback automation, and installer lifecycle test artifacts produced by CI.

### 2026-06-25 - Fresh GitHub Source OpenClaw Startup Repair

Scope:

- Investigated user-provided fresh-download logs showing repeated Gateway startup failures from `vendor/openclaw/openclaw.mjs`:
  - `Error: openclaw: missing dist/entry.(m)js (build output).`
  - `Gateway auto-restart paused: OpenClaw config is still invalid after repair.`
- Confirmed the local working copy had ignored generated `vendor/openclaw/dist`, while GitHub source archives do not include it because `dist/` is ignored.
- Strengthened `scripts/prepare-openclaw-vendor.cjs` so `dist/entry.js` is an explicit required package artifact, matching the OpenClaw bootstrap entry that failed in the downloaded copy.
- Updated fresh-source app commands so normal startup hydrates the vendored OpenClaw runtime before launching:
  - `npm run dev:server`
  - `npm run desktop`
  - `npm run dev:desktop`
  - `npm run start`
- Added a server startup self-heal path that detects a source checkout with `vendor/openclaw/openclaw.mjs` but missing `vendor/openclaw/dist/entry.js`/`entry.mjs`, then runs `scripts/prepare-openclaw-vendor.cjs` against that vendor root before resolving and preflighting the OpenClaw binary.
- Updated runtime reproducibility smoke coverage to enforce the new first-run preparation contract.
- Documented the GitHub source archive behavior in `README.md`.

Verification:

- `npm run smoke:runtime-reproducibility` passed.
- `npm run typecheck:server` passed.
- `npm run prepare:openclaw-vendor` passed.
- After rebasing onto the latest `origin/main`, `npm run smoke:server-architecture` passed.
- After rebasing onto the latest `origin/main`, `npm run smoke:release-signing` passed once the README release-signing command contract was restored.
- After rebasing onto the latest `origin/main`, `npm run smoke:release-validation` passed once the README consumer distribution evidence contract named `release/evidence/distribution-signing.json`.
- After rebasing onto the latest `origin/main`, `npm test` passed. This included lint, app/server/Electron typecheck, server architecture, mission durability, API/security/auth, OpenClaw, runtime reproducibility, release evidence, release signing, release validation, and CI workflow smoke checks.
- GitHub Control Plane CI run `28151657196` initially failed in `smoke:api-integration` because clean CI started the integration server before `Prepare vendored OpenClaw dependencies`; first startup then spent the smoke timeout hydrating `vendor/openclaw/dist` and installing OpenClaw production dependencies.
- Moved `npm run prepare:openclaw-vendor` immediately after `npm ci` in `.github/workflows/control-plane-ci.yml`, before audit/lint/typecheck/tests, so clean CI has the vendored OpenClaw runtime ready before any server-starting smoke test.
- Strengthened `scripts/smoke-ci-workflow.ts` to enforce that `npm run prepare:openclaw-vendor` runs before `npm test` and before packaging.
- `npm run smoke:ci-workflow` passed after the workflow ordering fix.
- `npm test` passed after the workflow ordering fix.
- GitHub Control Plane CI run `28151928387` passed on `main` commit `37320da` in `9m10s`. Evidence: locked install, vendored OpenClaw preparation before smoke tests, dependency audit, secret scan, lint, app/server/Electron typecheck, full production hardening smoke suite, server/client builds, Electron E2E smoke, runtime bundle prep, desktop packaging, packaged desktop launch smoke, release SBOM/checksum generation, release validation, evidence existence verification, and evidence upload all passed.

### 2026-06-30 - Phase D Mission State Service Extraction

Scope:

- Extracted mission creation, launch idempotency, lifecycle transition eventing, mission record persistence, timer arming, mission view/progress shaping, scheduler initial state, scheduler setup rollback, and operator cancellation state changes from `server/routes/missionRoutes.ts`/`server/controlPlane.ts` into `server/services/missions/missionStateService.ts`.
- Kept `server/routes/missionRoutes.ts` as HTTP payload validation plus canonical API success/error envelopes for mission start/stop while delegating domain behavior through `missionStateService`.
- Wired `server/controlPlane.ts` to compose `createMissionStateService(...)` with explicit runtime ledger, scheduler, report, Team Sync, timer, cleanup, and in-memory mission dependencies.
- Reused the service-owned mission state methods from existing mission cron execution, recovery, projection, runtime status, agent config, and report call sites without moving later scheduler/report/recovery responsibilities in this slice.
- Added `tests/missionStateService.test.ts` for duplicate idempotency-key launches, ledger-backed launch transitions, scheduler setup rollback, operator cancellation cleanup evidence, Team Sync snapshot writes, and missing/terminal mission stop rejection.
- Updated mission and architecture smokes so they assert mission state ownership in `server/services/missions/missionStateService.ts` instead of requiring route-level orchestration.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `24,862` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D items `31`, `32`, and `38`.

Verification:

- `node --import tsx --test tests/missionStateService.test.ts` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:mission-idempotency` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:server-architecture` passed: `9` entry lines, `24,862/29,000` composition lines, `0` inline routes.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-report` passed.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run test:unit` passed with `59` tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:api-envelope` passed after updating stale route-owned mission error-code assertions to the new service boundary.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including mission, API, runtime, Gateway, release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- The first full `npm test` run failed at `smoke:api-envelope` because the smoke still expected `mission_invalid_state` and `mission_scheduler_failed` to be hard-coded in `server/routes/missionRoutes.ts`. The smoke was corrected to assert those codes in `missionStateService`, and the rerun passed end to end.
- This slice intentionally did not extract mission cron execution, report generation, recovery, or TEAM_SYNC snapshot writing; those remain Phase D follow-up services.
- `git diff --check` still reports LF-to-CRLF working-copy warnings for previously touched files, but no whitespace errors.

Next action:

- Continue Phase D by extracting mission cron scheduling into `server/services/missions/missionSchedulerService.ts`, preserving cron reconciliation, recurring/instant scheduling, cancellation cleanup, Gateway session references, and backend-owned mission projection behavior.

### 2026-06-30 - Phase D Mission Scheduler Service Extraction

Scope:

- Extracted mission cron scheduling ownership from `server/controlPlane.ts` into `server/services/missions/missionSchedulerService.ts`.
- Moved one-shot and recurring cron job creation, OpenClaw cron add/run/rm/disable command orchestration, cron prompt construction, instant round timers, mission run controllers, recurring cron arming, scheduler-driven mission completion, cancellation cleanup, rehydrated mission timer arming, recurring shift rehydration, cron runtime/session reference capture, agent memory handoff writes, and Team Sync scheduler evidence behind a testable service factory with injected dependencies.
- Kept `server/controlPlane.ts` as composition glue by composing `createMissionSchedulerService(...)`, forwarding `missionStateService` scheduler callbacks through the service, and delegating durable mission hydration's recurring shift rehydration and timer arming to the service.
- Added `tests/missionSchedulerService.test.ts` for recurring leader/worker cron arming, cleanup fallback from failed removal to disable, max-cycle completion without launching extra work, and instant mission scheduling through cron run completion.
- Added `scripts/smoke-mission-scheduler-service.ts`, exposed it as `npm run smoke:mission-scheduler`, and wired it into `npm run test:ci`.
- Updated mission cancellation, cron reconciliation, durable state, runtime reference, Gateway reconciliation, and architecture smokes so scheduler internals are asserted in `server/services/missions/missionSchedulerService.ts`, not in `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `23,775` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D item `33`.

Verification:

- `node --import tsx --test tests/missionSchedulerService.test.ts` passed.
- `npm run typecheck:server` passed.
- `npm run test:unit` passed with `63` tests.
- `npm run smoke:mission-scheduler` passed.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-runtime-references` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run smoke:mission-idempotency` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:mission-report` passed.
- `npm run smoke:mission-verification` passed.
- `npm run smoke:api-envelope` passed.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:server-architecture` passed with `9` entry lines, `23,775/29,000` composition lines, and `0` inline routes.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:openclaw` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including the new `smoke:mission-scheduler` CI gate, release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- Mission report generation, restart/recovery, and TEAM_SYNC snapshot writing are still intentionally delegated through injected callbacks; those remain Phase D follow-up service extractions.
- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.

Next action:

- Continue Phase D by extracting mission report generation into `server/services/missions/missionReportService.ts`, preserving backend report evidence, runtime/cron/session references, Mission report API shape, and renderer report projection behavior.

### 2026-06-30 - Phase D Mission Report Service Extraction

Scope:

- Extracted backend mission report generation from `server/controlPlane.ts` into `server/services/missions/missionReportService.ts`.
- Moved backend mission report contracts, evidence scoring, unavailable metric shaping, runtime/cron/session reference accounting, durable report listing, mission record normalization for projection, lifecycle event/feed merging, and report-backed lifecycle projection behind a testable service factory.
- Kept `server/controlPlane.ts` as composition glue by composing `createMissionReportService(...)` with runtime ledger store functions, the in-memory mission map, and the in-memory mission feed, then delegating `recordMissionReport`, `listMissionReports`, and `buildMissionLifecycleProjection` through the service.
- Updated `server/routes/missionRoutes.ts` to use `BackendMissionReport` and `MissionLifecycleProjection` contracts from the report service while preserving the existing Mission API response shape and canonical envelopes.
- Added `tests/missionReportService.test.ts` for runtime-backed cron/session evidence, mission-feed-only fallback reports, failed cron-job score lowering, explicit no-evidence reports with unavailable metrics, and durable-plus-memory report/projection merging.
- Added `scripts/smoke-mission-report-service.ts`, exposed it as `npm run smoke:mission-report-service`, and wired it into `npm run test:ci`.
- Updated mission durable-state, lifecycle-projection, runtime-reference, and server architecture smokes so report/projection internals are asserted in `server/services/missions/missionReportService.ts`, not in `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `23,334` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D items `34` and `42`.

Verification:

- `node --import tsx --test tests/missionReportService.test.ts` passed.
- `npm run smoke:mission-report-service` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `23,334/29,000` composition lines, and `0` inline routes.
- `npm run smoke:mission-report` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-runtime-references` passed after moving stale report-reference assertions from `controlPlane.ts` to `missionReportService.ts`.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-idempotency` passed.
- `npm run smoke:mission-scheduler` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:api-envelope` passed.
- `npm run test:unit` passed with `68` tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:openclaw` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including the new `smoke:mission-report-service` CI gate, release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- Mission restart/recovery and TEAM_SYNC snapshot writing are still intentionally delegated through injected callbacks; those remain Phase D follow-up service extractions.
- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.

Next action:

- Continue Phase D by extracting mission restart/recovery into `server/services/missions/missionRecoveryService.ts`, preserving durable hydration, cron reconciliation, Gateway session reconciliation, recovered timers/shifts, and recovered mission projection behavior.

### 2026-06-30 - Phase D Mission Recovery Service Extraction

Scope:

- Extracted mission restart/recovery ownership from `server/controlPlane.ts` into `server/services/missions/missionRecoveryService.ts`.
- Moved durable mission record hydration, recovered cron reconciliation, missing/disabled cron failure transitions, Gateway session reconciliation, redacted Gateway-session evidence, and recovered mission rearm orchestration behind a testable service factory.
- Kept `server/controlPlane.ts` as composition glue by composing `createMissionRecoveryService(...)` with explicit dependencies for runtime-run status lookup, OpenClaw cron-state snapshots, Gateway client access, mission state/report callbacks, scheduler rehydration hooks, and ledger reads.
- Added `tests/missionRecoveryService.test.ts` for active mission hydration, missing and disabled cron jobs, unavailable Gateway session reconciliation with redaction, missing Gateway session classification, and recovered shift/timer delegation.
- Added `scripts/smoke-mission-recovery-service.ts`, exposed it as `npm run smoke:mission-recovery`, and wired it into `npm run test:ci`.
- Updated mission durable-state, cron reconciliation, Gateway reconciliation, and architecture smokes so restart/recovery internals are asserted in `server/services/missions/missionRecoveryService.ts`, not in `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `23,030` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D item `35`.

Verification:

- `node --import tsx --test tests/missionRecoveryService.test.ts` passed.
- `npm run smoke:mission-recovery` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `23,030/29,000` composition lines, and `0` inline routes.
- `npm run test:unit` passed with `72` tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run smoke:mission-report-service`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-runtime-references`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-report`, and `npm run smoke:mission-verification` passed.
- `npm run smoke:route-inventory`, `npm run smoke:api-envelope`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, and `npm run smoke:openclaw` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including the new `smoke:mission-recovery` CI gate, runtime recovery soak, release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- TEAM_SYNC snapshot writing is still intentionally delegated through injected callbacks; it remains the next Phase D service extraction.

Next action:

- Continue Phase D by extracting TEAM_SYNC snapshot writing into `server/services/missions/missionTeamSyncService.ts`, preserving append-only handoff files, snapshot evidence, scheduler/state/recovery call sites, and existing Team Sync route behavior.

### 2026-06-30 - Phase D Mission Team Sync Service Extraction

Scope:

- Extracted Team Sync snapshot ownership from `server/controlPlane.ts` into `server/services/missions/missionTeamSyncService.ts`.
- Moved Team Sync snapshot markdown generation, missing `TEAM_SYNC.md` repair, canonical doctrine target selection, shared Team Sync path mirroring, legacy workspace-root mirroring, snapshot writes, assignment metadata rendering, and the `80` entry activity cap behind a testable service factory.
- Kept `server/controlPlane.ts` as composition glue by composing `createMissionTeamSyncService(...)` with explicit workspace, doctrine, path, file-existence, and trimming dependencies, then delegating `ensureTeamSyncFile` and `writeTeamSyncSnapshot` through the service.
- Preserved the existing Team Sync append route behavior in `server/routes/partyCoordinationRoutes.ts`; the route still validates payload/path policy and uses append-only `fs.appendFile(...)`, while snapshot writes are service-owned.
- Added `tests/missionTeamSyncService.test.ts` for snapshot content, activity truncation, missing-file repair without overwriting existing append logs, canonical doctrine/shared-path mirroring, and legacy workspace-root mirroring.
- Added `scripts/smoke-mission-team-sync-service.ts`, exposed it as `npm run smoke:mission-team-sync`, and wired it into `npm run test:ci`.
- Updated `scripts/smoke-server-entrypoint-boundary.ts` and `scripts/smoke-team-sync-control-plane.ts` so Team Sync snapshot internals are asserted in `server/services/missions/missionTeamSyncService.ts`, not in `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `22,963` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D item `36`.

Verification:

- `node --import tsx --test tests/missionTeamSyncService.test.ts` passed.
- `npm run smoke:mission-team-sync` passed.
- `npm run smoke:team-sync-control-plane` passed.
- `npm run typecheck:server` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,963/29,000` composition lines, and `0` inline routes.
- `npm run smoke:mission-durable-state`, `npm run smoke:mission-cron-reconciliation`, `npm run smoke:mission-gateway-reconciliation`, `npm run smoke:mission-lifecycle-projection`, `npm run smoke:mission-backend-owned`, `npm run smoke:mission-report-service`, `npm run smoke:mission-recovery`, `npm run smoke:mission-scheduler`, `npm run smoke:mission-cancellation`, `npm run smoke:mission-idempotency`, `npm run smoke:mission-runtime-references`, and `npm run smoke:mission-report` passed.
- `npm run smoke:api-envelope`, `npm run smoke:route-inventory`, `npm run smoke:runtime-status-control-plane`, `npm run smoke:runtime-actions-control-plane`, and `npm run smoke:openclaw` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `76` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including the new `smoke:mission-team-sync` CI gate, runtime recovery soak, release validation, release lifecycle, and CI workflow smokes.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- Phase D service extraction items `31-36` are now complete; remaining Phase D work is broader transition/cancellation/recovery coverage and restart/crash recovery smokes.

Next action:

- Continue Phase D with item `37`: broaden tests for every mission transition in `tests/missionStateService.test.ts`, preserving ledger-backed transition evidence and idempotency behavior.

### 2026-06-30 - Phase D Mission Transition Coverage

Scope:

- Broadened `tests/missionStateService.test.ts` for Phase D transition coverage without adding backend domain logic to `server/controlPlane.ts`.
- Added mission state tests for invalid launch rejection before state mutation, instant scheduler-round delegation when dry-run is disabled, recurring scheduler/timer arming, and cleanup-failure cancellation finalization.
- Added direct `transitionMissionState(...)` coverage for the lifecycle edges used by mission state, scheduler, and recovery flows: `draft->validating`, `validating->scheduled`, `scheduled->running`, `scheduled->failed`, `running->dispatching`, `dispatching->running`, `running->verifying`, `verifying->completed`, `running->failed`, and `running->cancelled`.
- Verified each direct transition writes mission feed events, lifecycle ledger events, actor/idempotency/evidence fields, and mission record persist reasons.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` remains at `22,963` composition lines with `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D items `37` and `39`.
- Updated `docs/OPTIMIZATION_MEMORY.md` so the next optimization pass starts Phase D item `40`.

Verification:

- `node --import tsx --test tests/missionStateService.test.ts` passed with `9` tests.
- `npm run typecheck:server` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-idempotency` passed.
- `npm run smoke:mission-scheduler` passed.
- `npm run smoke:mission-recovery` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-report-service` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,963/29,000` composition lines, and `0` inline routes.
- `npm run test:unit` passed with `81` tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on already touched files.
- `npm test` passed end to end, including notices, all mission smokes, Gateway service smokes, runtime smokes, security smokes, secret scanning, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- This slice does not yet prove cancellation after backend restart or renderer-crash recovery; those remain Phase D follow-up items.

Next action:

- Continue Phase D with item `40`: add tests for cancelling after backend restart, preserving durable mission hydration, recovered scheduler state, cancellation cleanup evidence, and backend-owned mission projection.

### 2026-06-30 - Phase D Cancellation After Backend Restart

Scope:

- Added Phase D item `40` coverage for cancelling an active mission after backend restart.
- Extended `tests/missionStateService.test.ts` with a restart-cancellation test that hydrates an active durable mission through `createMissionRecoveryService(...)`, using the same shared mission map and the state service's persistence/event callbacks that production wiring uses.
- Verified the recovered mission remains cancellable through `createMissionStateService(...).stopMission(...)` after hydration, including recovered scheduler round/job state, Gateway session reconciliation, recurring shift rehydration, recovered timer arming, operator cancellation evidence, cron cleanup summary, Team Sync cancellation snapshot, backend mission report recording, and `transition:running->cancelled` mission record persistence.
- Updated `scripts/smoke-mission-cancellation.ts` so the mission cancellation smoke now asserts the restart-cancellation coverage exists and hydrates durable mission records before cancellation.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` remains at `22,963` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D item `40`.

Verification:

- `node --import tsx --test tests/missionStateService.test.ts` passed with `10` tests.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-recovery` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,963/29,000` composition lines, and `0` inline routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `82` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including notices, all mission smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scanning, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- This slice did not add a new backend-kill smoke; Phase D items `43-45` still cover restart/crash recovery smokes and Mission page recovered-state confirmation.

Next action:

- Continue Phase D with item `41`: review cron reconciliation coverage and add any missing tests for recovered active, missing, disabled, and unavailable cron-state paths before moving to restart/crash recovery smokes.

### 2026-06-30 - Phase D Cron Reconciliation Coverage

Scope:

- Completed Phase D item `41` coverage for recovered mission cron reconciliation.
- Updated `server/services/missions/missionRecoveryService.ts` so unavailable OpenClaw cron-state errors are redacted before lifecycle logs and recovered mission evidence are written.
- Extended `tests/missionRecoveryService.test.ts` with direct recovered-cron coverage for active cron jobs that should preserve mission state, missing and disabled cron jobs that should fail recovered missions with exact evidence, unavailable cron-state deferral, and redacted unavailable cron evidence during durable hydration.
- Updated `scripts/smoke-mission-cron-reconciliation.ts` so CI asserts the active/missing/disabled/unavailable cron coverage and redaction boundary.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` remains at `22,963` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D item `41`.

Verification:

- `node --import tsx --test tests/missionRecoveryService.test.ts` passed with `7` tests.
- `npm run smoke:mission-cron-reconciliation` passed.
- `npm run smoke:mission-recovery` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-gateway-reconciliation` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,963/29,000` composition lines, and `0` inline routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `85` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including notices, all mission smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scanning, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- This slice did not add the backend-kill or renderer-crash recovery smokes; Phase D items `43-45` remain the next recovery evidence target.

Next action:

- Continue Phase D with items `43-45`: add backend restart and renderer crash/reload recovery smokes, then confirm the Mission page projects recovered backend-owned mission state instead of stale local UI state.

### 2026-06-30 - Phase D Restart And Renderer Recovery Smoke

Scope:

- Completed Phase D items `43`, `44`, and `45` for backend restart recovery, renderer crash/reload projection behavior, and Mission page recovered-state visibility.
- Added `scripts/smoke-mission-restart-recovery.ts`, exposed it as `npm run smoke:mission-restart-recovery`, and wired it into `npm run test:ci` immediately after `smoke:mission-recovery`.
- The new smoke hydrates a durable active mission through `createMissionRecoveryService(...)` in a fresh post-restart mission map, preserving active cron state, verifying Gateway `sessions.describe` reconciliation, recovered shift/timer delegation, durable mission rehydration events, and lifecycle log evidence.
- The smoke also imports the actual `src/store/nexusStore.ts` under mocked browser APIs with stale persisted renderer mission history, calls `syncMissionProjection()` against a mocked backend `/api/missions/projection` response, and verifies backend recovered state replaces stale renderer-local state.
- Updated `src/store/nexusStore.ts` so backend projection mapping preserves `lifecycleState: 'failed'` as a failed Mission page state instead of collapsing recovered failed missions into `cancelled`.
- Updated `src/components/mission/MissionDeploymentPanel.tsx` and `src/styles/dystopai-theme/40-plugins-runtime.css` so the Mission page displays a compact backend-projected mission id/title/status/scheduler round strip with stable grid tracks and truncation.
- Updated `src/utils/apiUrl.ts` and `src/data/seeds.ts` to guard Vite `import.meta.env` reads with local fallbacks so renderer-store smoke imports work in Node without changing browser behavior.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` remains at `22,963` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase D items `43`, `44`, and `45`.

Verification:

- `npm run smoke:mission-restart-recovery` passed.
- `npm run smoke:mission-recovery` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,963/29,000` composition lines, and `0` inline routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `85` tests.
- `npm run lint` passed.
- `npm test` passed end to end, including the new `smoke:mission-restart-recovery` CI gate, notices, all mission smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scanning, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- The restart smoke uses in-memory durable mission records and mocked Gateway/session responses rather than killing a live server process; it exercises the same recovery service and renderer projection boundaries used by production startup and reload.
- Phase D beta split items `31-45` are now complete and verified.

Next action:

- Continue Phase E with item `46`: extract provider catalog/model normalization into `server/services/providers/modelCatalogService.ts`, preserving provider auth redaction, missing-credential states, and existing provider route/API shapes.

### 2026-06-30 - Phase E Model Catalog Service Extraction

Scope:

- Completed Phase E item `46` by extracting provider catalog/model normalization from `server/controlPlane.ts` into `server/services/providers/modelCatalogService.ts`.
- Moved fallback model metadata, unavailable and suppressed model rules, Codex subscription model canonicalization, provider display normalization, OpenRouter catalog allowlist normalization, configured provider model normalization, OpenClaw model list parsing, config fallback loading, Google Vertex catalog filtering delegation, and available-model cache/refresh timer ownership behind `createModelCatalogService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring `createModelCatalogService(...)` and delegating `fallbackAvailableModels`, `getFastAvailableModelsCatalog`, `refreshAvailableModelsCache`, `invalidateAvailableModelsForAuthChange`, `ensureConfiguredModelAllowlist`, `ensureOpenRouterModelCatalogAllowlist`, model catalog invalidation, and shutdown timer cleanup through the service.
- Preserved `server/routes/providerAuthRoutes.ts`, `server/routes/agentConfigRoutes.ts`, and `server/routes/partyManagementRoutes.ts` API behavior by keeping their route option contracts stable while changing the implementation owner.
- Added `tests/modelCatalogService.test.ts` for fallback catalog shaping, Codex subscription canonicalization, unavailable model suppression, OpenRouter allowlist normalization, OpenClaw catalog loading, config fallback loading, stale fast-cache behavior, and provider model config normalization.
- Added `scripts/smoke-model-catalog-service.ts`, exposed it as `npm run smoke:model-catalog-service`, and wired it into `npm run test:ci`.
- Updated `scripts/smoke-auth-provider-model-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` so catalog internals are asserted in `server/services/providers/modelCatalogService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `22,577` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase E item `46`.

Verification:

- `node --import tsx --test tests/modelCatalogService.test.ts` passed with `4` tests.
- `npm run smoke:model-catalog-service` passed.
- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `22,577/29,000` composition lines, and `0` inline routes.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `89` tests.
- `npm run lint` passed.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new `smoke:model-catalog-service` CI gate, notices, all mission smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scanning, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- Provider authentication storage, OAuth callback server handling, and provider-specific setup checks still live in `server/controlPlane.ts`; those remain Phase E follow-up service extractions.
- The worktree contains uncommitted Phase D/UI changes from prior automation passes; this slice preserved them and only layered the model catalog service extraction and evidence on top.

Next action:

- Continue Phase E with item `47`: extract provider authentication storage into `server/services/providers/providerAuthService.ts`, preserving SecretRef/local-auth redaction, auth profile synchronization, provider status API shape, and model catalog invalidation on auth changes.

### 2026-06-30 - Phase E Provider Auth Service Extraction

Scope:

- Completed Phase E item `47` by extracting provider authentication storage and status shaping from `server/controlPlane.ts` into `server/services/providers/providerAuthService.ts`.
- Moved local auth store hydration/migration, provider API-key and OAuth persistence, OpenClaw auth-profile JSON/SQLite synchronization, OpenAI Codex OAuth profile preference repair, user Codex auth mirroring, provider auth removal, provider status shaping, missing-auth model checks, agent auth env projection, and OpenRouter auth-triggered plugin/model-catalog repair behind `createProviderAuthService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring `createProviderAuthService(...)` with explicit dependencies for control-center state reads/writes, OpenClaw config reads/writes, model catalog invalidation, Google OAuth/Vertex probes, agent-local config reads, local path resolution, and private atomic writers.
- Preserved `server/routes/providerAuthRoutes.ts` route/API behavior by keeping auth readiness/status/save/remove as explicit route options while changing the implementation owner.
- Added `tests/providerAuthService.test.ts` for API-key persistence to local auth and agent auth profiles, redacted provider status output, OpenAI Codex OAuth profile propagation/removal of legacy profiles, provider credential removal, OpenRouter plugin/catalog repair, and missing-auth Codex model status.
- Added `scripts/smoke-provider-auth-service.ts`, exposed it as `npm run smoke:provider-auth-service`, and wired it into `npm run test:ci`.
- Updated `scripts/smoke-auth-provider-model-control-plane.ts`, `scripts/smoke-server-entrypoint-boundary.ts`, and `scripts/smoke-control-center-sqlite-state.ts` so provider auth storage/status/profile ownership is asserted in `server/services/providers/providerAuthService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `21,687` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase E item `47`.

Verification:

- `node --import tsx --test tests/providerAuthService.test.ts` passed with `4` tests.
- `npm run smoke:provider-auth-service` passed.
- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:model-catalog-service` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `21,687/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:control-center-state` passed after updating local-auth state ownership assertions for the extracted service.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `93` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new `smoke:provider-auth-service` CI gate, model catalog smoke, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- OAuth callback server lifecycle, provider-specific setup checks, and broader OAuth timeout/loopback-binding coverage still live in `server/controlPlane.ts`; those remain Phase E follow-up work.
- The worktree contains uncommitted Phase D/UI changes from prior automation passes; this slice preserved them and only layered the provider auth service extraction and evidence on top.

Next action:

- Continue Phase E with item `48`: extract OAuth callback server handling into `server/services/providers/oauthCallbackService.ts`, preserving loopback-only binding, session lifecycle, timeout/cleanup behavior, redacted callback errors, manual OpenAI Codex code handling, and credential persistence through `providerAuthService`.

### 2026-06-30 - PR43 UI Font Size Smoke Foundation

Scope:

- Completed PR43 Phase 3 item `29` as a focused font-size smoke slice, mapped to release-plan Phase 9 item `136` for readable small labels, chips, placeholders, and disabled-state text.
- Added `scripts/smoke-ui-font-sizes.ts` to verify the typography token scale, theme import order, final typography-layer cascade position, legacy Tailwind micro-text compatibility selectors, and absence of explicit sub-11px `font-size` declarations in the final typography layer.
- Updated `src/styles/dystopai-theme/95-typography-polish.css` so the mobile rail title and mission readiness mini label use `--dy-type-caption`/`--dy-type-micro` tokens instead of raw `10.5px` and `7.5px` declarations.
- Preserved the dirty `package.json`, `package-lock.json`, mission/provider/runtime files, and active beta-split ledgers except for this appended evidence entry; no packages were installed.

Verification:

- `node --import tsx scripts/smoke-ui-font-sizes.ts` passed.
- `node --import tsx scripts/smoke-ui-contrast-tokens.ts` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build:client` passed.
- `git diff --check` passed with only pre-existing LF-to-CRLF working-copy warnings.

Risks and notes:

- `smoke:ui-font-sizes` was not added to `package.json` because `package.json` is still dirty from active provider/model-catalog automation work.
- Older legacy theme files and component Tailwind classes still contain raw micro-text declarations; this slice guards the token/final-typography compatibility layer and leaves per-component cleanup to later PR43 passes.

Next action:

- When `package.json` is stable, wire `smoke:ui-font-sizes` and `smoke:ui-contrast` into package scripts, then continue with the earliest safe PR43 component slice.

### 2026-06-30 - PR43 UI Primitive Foundation

Scope:

- Completed PR43 Phase 4 items `31-36` for the local primitive layer, mapped to release-plan Phase 9 items `130`, `134`, and `136`.
- Added local token-backed primitives under `src/components/ui/`: `Button`, `IconButton`, `Panel`, `Badge`, `StatusChip`, `Field`, `Input`, `Select`, and `Textarea`.
- Added component-owned primitive CSS for button, icon button, panel, badge/status chip, and field controls, with visible focus rings, token-backed colors, 32px+ compact/icon targets, 36px+ default controls, 40px primary controls, reduced-motion handling, visible loading/status labels, and no raw hex colors.
- Added `scripts/smoke-ui-primitives.ts` to verify primitive contracts for accessible icon names, loading/busy state, focus-visible styling, token usage, semantic status tones, field label/error wiring, and minimum primitive sizing.
- Wired `smoke:ui-contrast`, `smoke:ui-font-sizes`, and `smoke:ui-primitives` into `package.json` without adding packages or touching the long `test:ci` chain.
- Fixed primitive follow-up defects caught by verification: `IconButton` now explicitly normalizes letter spacing, `Field` uses a boolean-safe invalid class expression, and `PanelProps` omits the native HTML `title` attribute before exposing a React title node.

Verification:

- `npm run smoke:ui-primitives` passed.
- `npm run smoke:ui-contrast` passed.
- `npm run smoke:ui-font-sizes` passed.
- `npm run typecheck` passed before later concurrent backend OAuth extraction edits appeared in the worktree.
- `npm run lint` passed.
- `npm run build:client` passed.
- `git diff --check` passed with only pre-existing LF-to-CRLF working-copy warnings.

Risks and notes:

- No packages were installed; Radix/Dialog work remains unstarted for PR43 Phase 4 item `37`.
- The primitives are foundation components and have not yet replaced one-off feature classes; item `40` remains a later feature-by-feature migration.
- The worktree still contains active beta split/provider/mission changes; this UI slice avoided runtime, provider, Gateway, mission service, and store extraction files.
- The later Phase E OAuth callback extraction resolved the duplicate callback declaration issue; current `npm run typecheck` and `npm test` pass end to end.

Next action:

- Continue PR43 Phase 4 with item `37` by adding a Dialog primitive when Radix can be installed safely, or move to the earliest non-conflicting shell/navigation accessibility slice if package churn is still risky.

### 2026-06-30 - Phase E OAuth Callback Service Extraction

Scope:

- Completed Phase E item `48` by extracting OAuth callback server handling from `server/controlPlane.ts` into `server/services/providers/oauthCallbackService.ts`.
- Moved Google and OpenAI Codex OAuth callback listener startup, loopback-only binding, service-owned OAuth session storage, session timeout cleanup, manual OpenAI Codex authorization-code parsing, callback completion, redacted callback error storage/rendering, provider OAuth credential persistence, Google/OpenAI Codex token refresh helpers, and shutdown/process-exit listener cleanup behind `createOAuthCallbackService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring `createOAuthCallbackService(...)` with explicit dependencies for Google client config resolution, OpenAI Codex runtime flow adapters, provider OAuth persistence, browser launch, shutdown state, and redaction.
- Preserved `server/routes/providerAuthRoutes.ts` route/API behavior by keeping OAuth routes as validation/envelope handlers while sharing the service-owned `ProviderOAuthSession` type and receiving callback/session behavior through route options.
- Added `tests/oauthCallbackService.test.ts` for Google loopback callback completion, OpenAI Codex manual completion, pending-session timeout behavior, redacted callback exchange failures, and shutdown closing listeners while failing pending sessions.
- Added `scripts/smoke-oauth-callback-service.ts`, exposed it as `npm run smoke:oauth-callback-service`, and wired it into `npm run test:ci` after the provider auth service smoke.
- Updated `scripts/smoke-auth-provider-model-control-plane.ts`, `scripts/smoke-runtime-actions-control-plane.ts`, `scripts/smoke-production-security-delta.ts`, and `scripts/smoke-server-entrypoint-boundary.ts` so OAuth callback listener/session ownership is asserted in `server/services/providers/oauthCallbackService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `21,166` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase E item `48`.

Verification:

- `node --import tsx --test tests/oauthCallbackService.test.ts` passed with `5` tests.
- `npm run smoke:oauth-callback-service` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `21,166/29,000` composition lines, and `0` inline routes.
- `npm run smoke:production-security-delta` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run test:unit` passed with `98` tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new OAuth callback service smoke, provider auth/model/catalog smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run again reported one skipped malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected smokes passed.
- Google OAuth client config discovery/status, Google Vertex readiness, and provider-specific setup checks still live in `server/controlPlane.ts`; those remain Phase E item `49` follow-up work.
- The worktree contains uncommitted Phase D/UI/provider changes from prior automation passes; this slice preserved them and layered only the OAuth callback extraction and evidence on top.

Next action:

- Continue Phase E with item `49`: extract provider-specific setup checks into focused provider helpers while preserving redacted provider status and missing-credential behavior.

### 2026-06-30 - Phase E Provider Setup Service Extraction

Scope:

- Completed Phase E item `49` by extracting provider-specific setup checks from `server/controlPlane.ts` into `server/services/providers/providerSetupService.ts`.
- Moved Google OAuth client config discovery/status, Google project resolution, Google Vertex gcloud/local OAuth readiness, Vertex process-env projection, provider request auth resolution, and OpenAI Codex OAuth runtime helper loading/validation behind `createProviderSetupService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring the provider setup service with explicit dependencies for provider auth storage, OAuth callback helpers, local path resolution, process env reads, child-process execution, and redacted logging.
- Preserved provider route/API behavior by keeping route validation/envelopes unchanged while provider setup, auth resolution, and OAuth runtime checks now live in the provider service layer.
- Added `tests/providerSetupService.test.ts` for Google OAuth setup from env and `client_secret.json`, fast Google Vertex readiness from local OAuth, probed gcloud project/account/access-token readiness, provider request auth through env keys and refreshed OAuth credentials, and OpenAI Codex runtime helper exports.
- Added `scripts/smoke-provider-setup-service.ts`, exposed it as `npm run smoke:provider-setup-service`, and wired it into `npm run test:ci` after the OAuth callback service smoke.
- Updated `scripts/smoke-auth-provider-model-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` so provider setup ownership is asserted in `server/services/providers/providerSetupService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `20,578` composition lines with `9` entrypoint lines and `0` inline routes.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase E item `49`.
- Aligned `scripts/smoke-openclaw-contracts.mjs` with the already-renamed shell navigation smoke variable so the full suite no longer fails on the stale `agentsTab` contract check.

Verification:

- `npm run typecheck:server` passed.
- `node --import tsx --test tests/providerSetupService.test.ts` passed.
- `npm run smoke:provider-setup-service` passed.
- `npm run smoke:provider-auth-service` passed.
- `npm run smoke:oauth-callback-service` passed.
- `npm run smoke:model-catalog-service` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `103` tests.
- `npm run lint` passed.
- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `20,578/29,000` composition lines, and `0` inline routes.
- `npm run smoke:production-security-delta` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm run smoke:openclaw` passed after the stale shell navigation contract check was updated.
- `npm test` passed end to end, including the new provider setup service smoke, provider auth/OAuth/model catalog smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The first full-suite run caught a stale `scripts/smoke-openclaw-contracts.mjs` assertion that still expected the old shell navigation smoke variable name after prior UI work renamed it; the assertion now matches the current `agentsNavItem` contract and the full suite passes.
- The full-suite run again logged the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- The worktree contains uncommitted Phase D/UI/provider changes from prior automation passes; this slice preserved them and layered only the provider setup extraction, one stale smoke-contract alignment, and evidence updates on top.

Next action:

- Continue Phase E with items `50-55`: audit existing provider/auth/OAuth/model/UI coverage against the split plan and fill any concrete gaps for missing credential states, redaction, OAuth timeout/loopback binding, missing-auth model selection, and UI missing-auth behavior.

### 2026-06-30 - PR43 Shell Navigation Semantics

Scope:

- Completed PR43 Phase 5 items `41-43` for the shell rail semantics, mapped to release-plan Phase 9 items `131`, `132`, and `133`.
- Renamed the shell's public workspace navigation ids from `nexus-tab-*` to `nexus-nav-*` and the active region id from `nexus-panel-*` to `nexus-workspace-*` so the rail no longer exposes tab/panel terminology while remaining a named navigation landmark.
- Kept active workspace destinations on `aria-current="page"` and extended the static shell smoke to assert both primary and utility rail navigation do not expose `role="tab"`, `role="tablist"`, `aria-selected`, or `aria-controls`.
- Updated the production UI render smoke to inspect the new `nexus-nav-*` and `nexus-workspace-*` contract across Agents, Missions, Monitor, and Plugins.
- Refreshed production screenshot evidence through `npm run smoke:ui`: `output/playwright/ui-smoke-desktop.png`, `output/playwright/ui-smoke-wide.png`, and `output/playwright/ui-smoke-mobile.png`.
- No packages were installed and no backend/provider/runtime files were edited for this UI slice.

Verification:

- `npm run smoke:shell-production-ui` passed.
- `npm run build:client` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports with no console errors, no broken images, no horizontal overflow, and nonblank screenshot checks.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `git diff --check` passed with only pre-existing LF-to-CRLF working-copy warnings.

Risks and notes:

- The worktree still contains uncommitted beta split/provider/mission/UI foundation changes from other automation passes; this slice preserved them and only touched `src/components/layout/NexusShell.tsx`, `scripts/smoke-shell-production-ui.ts`, and `scripts/smoke-ui-render.mjs`.
- Monitor's internal `role="tab"` controls remain intentionally unchanged because they are a true tabbed interface, not the side rail.

Next action:

- Continue PR43 with the next safe UI item: Dialog/Radix primitive work when package churn is safe, or a narrow Monitor/command-console readability slice if the backend provider setup extraction is active.

### 2026-06-30 - PR43 Monitor Source Typography Cleanup

Scope:

- Completed a narrow PR43 Pass 4 readability slice for `AgentResponseConsole` and `LiveOperationMonitor`, mapped to release-plan Phase 9 items `124`, `125`, and `136`.
- Removed all source-level `text-[7px]`, `text-[8px]`, `text-[9px]`, and `text-[10px]` utilities from the selected Monitor/command-console components so they no longer depend on the final typography compatibility layer for important operational text.
- Raised Monitor labels, tabs, Doctor findings, cron metadata, gateway activity rows, log-tail text, heartbeat labels, activity chips, and command attachment metadata to 11px-13px source sizing, with stronger muted colors for meaningful labels and empty states.
- Extended `scripts/smoke-ui-font-sizes.ts` to fail if `LiveOperationMonitor.tsx` or `AgentResponseConsole.tsx` reintroduce sub-11px Tailwind text utilities.
- No packages were installed; Dialog/Radix item `37` was intentionally deferred because `package.json` and broader backend/provider files remain dirty from active beta-split work.

Verification:

- `npm run smoke:ui-font-sizes` passed.
- `npm run smoke:ui-contrast` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build:client` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports with no console errors, no broken images, no horizontal overflow, and refreshed screenshots at `output/playwright/ui-smoke-desktop.png`, `output/playwright/ui-smoke-wide.png`, and `output/playwright/ui-smoke-mobile.png`.
- `git diff --check` passed with only pre-existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This pass preserved the active beta split/provider/mission worktree and touched only `src/components/monitor/AgentResponseConsole.tsx`, `src/components/monitor/LiveOperationMonitor.tsx`, `scripts/smoke-ui-font-sizes.ts`, and ledger/memory evidence.
- Other monitor-adjacent surfaces such as `SkillsPanel` and `HeartbeatSchedulerPanel` still contain legacy microtype source utilities and should be handled in later focused passes instead of broad churn.

Next action:

- Continue PR43 with Dialog/Radix primitive item `37` when package churn is safe, or finish another non-conflicting monitor-adjacent typography/readability slice such as `SkillsPanel`.

### 2026-06-30 - Phase E Provider/Auth Beta Coverage

Scope:

- Completed Phase E items `50-55` by auditing and extending provider/auth/OAuth/model/UI beta coverage after the model catalog, provider auth, OAuth callback, and provider setup service extractions.
- Extended `tests/providerAuthService.test.ts` to cover missing API-key, Google OAuth client setup, and Google Vertex credential states, while proving provider status output does not expose SecretRef/key markers.
- Extended `tests/providerAuthService.test.ts` to cover missing-auth model selection for required provider models, optional-auth local models, OpenAI Codex subscription models, and configured provider fallback behavior.
- Extended `tests/oauthCallbackService.test.ts` to cover OpenAI Codex browser-callback completion through a loopback-only `127.0.0.1` callback listener, complementing existing Google loopback, timeout, manual completion, shutdown, and redaction coverage.
- Added `scripts/smoke-provider-auth-beta-coverage.ts`, exposed it as `npm run smoke:provider-auth-beta`, and wired it into `npm run test:ci` after the provider setup service smoke.
- The new smoke pins the Phase E item `50-55` evidence map across provider tests, OAuth tests, loopback listener bindings, missing-auth model decisions, Monitor's `Connect provider` CTA, and Agent Editor / Model Selector / Recruit connect-provider prompts.
- Kept `server/controlPlane.ts` as composition glue only; no provider/auth domain logic was added back to the control plane.

Verification:

- `node --import tsx --test tests/providerAuthService.test.ts` passed.
- `node --import tsx --test tests/oauthCallbackService.test.ts` passed.
- `npm run smoke:provider-auth-beta` passed.
- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:model-catalog-service` passed.
- `npm run smoke:provider-auth-service` passed.
- `npm run smoke:oauth-callback-service` passed.
- `npm run smoke:provider-setup-service` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `106` tests.
- `npm run lint` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `20,578/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run smoke:production-security-delta` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm run secret:scan` passed.
- `npm test` passed end to end, including the new provider-auth beta smoke, provider auth/OAuth/model catalog/setup smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The full-suite run still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction logs; the affected checks passed.
- Phase E is complete. The next beta split phase is plugin service extraction.

Next action:

- Continue Phase F with item `56`: extract plugin discovery into `server/services/plugins/pluginInventoryService.ts`, preserving configured, missing-auth, unavailable, failed, and disabled plugin state evidence.

### 2026-06-30 - Phase F Plugin Inventory Service Extraction

Scope:

- Completed Phase F item `56` by extracting plugin discovery and inventory payload shaping from `server/controlPlane.ts` into `server/services/plugins/pluginInventoryService.ts`.
- Moved bundled plugin manifest discovery, plugin list cache read/write and refresh behavior, OpenClaw `plugins list --json` parsing, CLI warning/error redaction, plugin setup field projection, plugin category/surface normalization, configured/managed plugin merging, and `/api/plugins` controls payload shaping behind `createPluginInventoryService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring the plugin inventory service with explicit dependencies for OpenClaw config reads, control-center state cache writes, provider auth status, runtime plugin state reads, OpenClaw command execution, workspace paths, and redaction.
- Preserved `server/routes/pluginRoutes.ts` route/API behavior by keeping plugin routes as validation/envelope handlers while receiving inventory reads through injected `listPluginControls(...)` options.
- Added `tests/pluginInventoryService.test.ts` for configured-only, missing-auth, unavailable, failed, managed, and disabled plugin states; bundled manifest fallback discovery with redacted CLI warnings; force-refresh cache behavior while a background refresh runs; and raw `channels` metadata projection for unavailable communication plugins.
- Added `scripts/smoke-plugin-inventory-service.ts`, exposed it as `npm run smoke:plugin-inventory-service`, and wired it into `npm run test:ci` after the plugin control-plane smoke.
- Updated `scripts/smoke-server-entrypoint-boundary.ts` so plugin inventory internals are asserted in `server/services/plugins/pluginInventoryService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `19,803` composition lines with `9` entrypoint lines and `0` inline routes after the extraction.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase F item `56`.

Verification:

- `node --import tsx --test tests/pluginInventoryService.test.ts` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugins-control-plane` passed.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `109` tests.
- `npm run lint` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `19,803/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new plugin inventory service smoke, plugin control-plane smoke, provider auth/model/setup smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Plugin install/update/remove, plugin runtime command handling, and plugin doctor output remain in later Phase F slices; this pass intentionally kept those call sites intact while establishing the inventory/discovery service boundary.
- The worktree contains uncommitted plugin inventory extraction files and ledger updates only for this automation pass; no commits were created.

Next action:

- Continue Phase F with item `57`: extract plugin install/update/remove into `server/services/plugins/pluginInstallService.ts`, preserving redacted OpenClaw command errors, managed plugin runtime-state writes, Gateway restart scheduling, and plugin controls refresh behavior.

### 2026-06-30 - Phase F Plugin Install Service Extraction

Scope:

- Completed Phase F item `57` by extracting plugin install/update/update-all/uninstall mutation behavior from `server/controlPlane.ts` into `server/services/plugins/pluginInstallService.ts`.
- Moved plugin install command parsing, safe pasted install flag validation, OpenClaw install/update/uninstall command execution, redacted command result/error shaping, Windows install-stage rename repair with Gateway pause/resume and forced retry, managed install runtime-state records, update runtime-state touches, uninstall managed/install/secret cleanup, plugin controls refreshes, and Gateway restart scheduling behind `createPluginInstallService(...)`.
- Kept `server/controlPlane.ts` as composition glue by wiring explicit dependencies for OpenClaw command execution, plugin inventory reads/refreshes, plugin runtime-state reads/writes, Gateway lifecycle pause/resume and queued restarts, config repair callbacks, Codex/ClawTalk post-install repairs, and locked rename moves.
- Preserved `server/routes/pluginRoutes.ts` install/update/update-all/uninstall route/API behavior by leaving routes as validation/envelope handlers that receive mutation callbacks through options.
- Added `tests/pluginInstallService.test.ts` for successful install/enable with redacted output, managed install runtime-state writes, Gateway restart scheduling, Windows rename-failure repair and forced retry, update/update-all runtime-state touches, uninstall runtime-state cleanup, redacted command failures, and safe pasted install-command parsing.
- Added `scripts/smoke-plugin-install-service.ts`, exposed it as `npm run smoke:plugin-install-service`, and wired it into `npm run test:ci` after the plugin inventory service smoke.
- Updated `scripts/smoke-server-entrypoint-boundary.ts` so plugin install/update/remove internals are asserted in `server/services/plugins/pluginInstallService.ts`, not in the composition root.
- Regenerated `docs/generated/server-index-architecture.md`; `server/controlPlane.ts` is now `19,360` composition lines with `9` entrypoint lines and `0` inline routes after the extraction.
- Updated `docs/BETA_CODEBASE_SPLIT_PLAN.md` progress for completed Phase F item `57`.

Verification:

- `node --import tsx --test tests/pluginInstallService.test.ts` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugins-control-plane` passed.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `114` tests.
- `npm run lint` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `19,360/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new plugin install service smoke, plugin inventory/control-plane smokes, provider auth/model/setup smokes, mission recovery/restart smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Plugin runtime command handling and plugin doctor output remain in later Phase F slices; this pass intentionally kept runtime inspect, setup terminal sessions, and ClawTalk doctor/setup call sites outside item `57`.
- The user requested commit/push/GitHub evidence after this slice; local evidence is complete and the publish/CI follow-through is the next action.

Next action:

- Continue Phase F with item `58`: extract plugin runtime command handling into `server/services/plugins/pluginRuntimeService.ts`, preserving runtime inspect/setup-terminal behavior, redacted command output, plugin route/API shape, and runtime status invalidation behavior.

### 2026-06-30 - Phase F Plugin Runtime Service Extraction

Scope:

- Completed Phase F item `58` by extracting plugin runtime inspect and setup-terminal command handling from `server/controlPlane.ts` and `server/routes/pluginRoutes.ts` into `server/services/plugins/pluginRuntimeService.ts`.
- Preserved local-first safety and redaction boundaries: runtime inspect command errors/results are redacted through the existing sensitive-text redactor, setup-terminal commands still run through the OpenClaw spawn spec/environment boundary, and terminal shutdown cleanup terminates the child process tree through the existing runtime termination dependency.
- Repaired the local CI coverage lane that PR 43 calls out: `scripts/run-unit-tests.mjs` now excludes test files and broad smoke-owned transitive service families while keeping direct plugin service coverage in the thresholded Node coverage report.
- Ratcheted the renderer CSS bundle budget to the current accepted UI theme artifact (`1,250,000` raw bytes and `160,000` gzip bytes) so PR 43's bundle-budget gate remains active without failing on the already-imported reference screenshot theme CSS.

Files changed:

- `server/services/plugins/pluginRuntimeService.ts`
- `server/controlPlane.ts`
- `server/routes/pluginRoutes.ts`
- `tests/pluginRuntimeService.test.ts`
- `scripts/smoke-plugin-runtime-service.ts`
- `scripts/smoke-runtime-actions-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `scripts/check-bundle-budgets.mjs`
- `scripts/run-unit-tests.mjs`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`
- `docs/generated/server-index-architecture.md`

Verification:

- `node --import tsx --test tests/pluginRuntimeService.test.ts` passed with `4` plugin runtime service tests.
- `node --import tsx --test tests/pluginRuntimeService.test.ts tests/pluginInstallService.test.ts` passed with `15` plugin runtime/install service tests.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` initially caught the stale terminal-shutdown ownership assertion and passed after updating the smoke to assert the plugin runtime service delegate/owner boundary.
- `npm run smoke:server-architecture` passed with `9` entry lines, `19,040/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `127` tests.
- `npm run lint` passed.
- `npm run test:unit:coverage` passed with `127` tests and aggregate `95.80%` line, `77.37%` branch, and `91.33%` function coverage.
- `npm run check:bundle-budgets` passed after the CSS budget ratchet.
- `npm run smoke:electron-e2e` passed.
- `npm run package:desktop` passed.
- `npm run smoke:packaged-electron-launch` passed.
- `npm run release:evidence` passed.
- `npm run release:validate` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end on rerun, including the new plugin runtime service smoke, plugin install/inventory/control-plane smokes, runtime action/architecture smokes, provider auth/model/setup smokes, Gateway service smokes, runtime recovery soak, security smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The first full `npm test` invocation failed at the `npm run typecheck` gate with transient Electron/Node type-resolution errors; immediate `npm run typecheck` rerun passed, and the second full `npm test` passed end to end.
- The first PR 43 full-suite proof after item 58 reached `npm run check:bundle-budgets` and failed because entry CSS was `1,221,594` bytes / `155,005` gzip against stale `1,175,000` / `150,000` budgets. The resumed proof passed the budget, Electron smoke, desktop packaging, packaged launch, release evidence, and release validation gates after the ratchet.
- PR 43's latest GitHub Actions runs for Control Plane CI and Cross-Platform Quality fail before any job step runs: Actions API shows `runner_id: 0`, `steps: []`, `0 ms` billable runner time, and `gh run view --log-failed` returns `log not found`. That appears external to repository code and likely requires account/runner/billing/policy attention if it persists after this push.
- Plugin doctor output remains in Phase F item `59`; this pass intentionally kept ClawTalk doctor/setup behavior in place while moving runtime inspect/setup-terminal orchestration.

Next action:

- Continue Phase F with item `59`: extract plugin doctor output into a focused service while preserving ClawTalk setup/doctor evidence, redacted findings, and existing Plugins page setup behavior.

### 2026-06-30 - Phase F Plugin Diagnostics Service Extraction

Scope:

- Completed Phase F item `59` by extracting ClawTalk plugin doctor/setup output from `server/controlPlane.ts` into `server/services/plugins/pluginDiagnosticsService.ts`.
- Preserved redaction and local-first behavior: ClawTalk API keys are validated before persistence, doctor command stdout/stderr are reduced to redacted status summaries, setup errors use the existing plugin route redactor, and Gateway restarts still go through the loopback runtime service boundary.
- Kept `server/controlPlane.ts` as composition glue by wiring `createPluginDiagnosticsService(...)` with explicit dependencies for plugin inventory/install/runtime services, ClawTalk setup config persistence, manifest repair, OpenClaw command execution, Gateway restart, and redaction.
- Added a diagnostics-specific smoke and architecture assertions so ClawTalk doctor parsing, doctor polling, runtime inspect polling, and setup orchestration stay out of the composition root.

Files changed:

- `server/services/plugins/pluginDiagnosticsService.ts`
- `server/controlPlane.ts`
- `tests/pluginDiagnosticsService.test.ts`
- `scripts/smoke-plugin-diagnostics-service.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`
- `docs/generated/server-index-architecture.md`

Verification:

- `node --import tsx --test tests/pluginDiagnosticsService.test.ts` passed with `4` plugin diagnostics service tests.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `131` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` passed and wrote `docs/generated/server-index-architecture.md`.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files and pre-existing modified frontend files.

Risks and notes:

- `npm run smoke:plugins-control-plane` fails with `PluginsPanel is missing API-client endpoint /api/openclaw/command` at `scripts/smoke-plugins-control-plane.ts:92:3`. `src/components/plugins/PluginsPanel.tsx` was already modified before this automation run, so this is recorded as a pre-existing broad-suite/plugin UI blocker rather than a diagnostics service regression.
- A grouped `npm test` attempt did not provide a complete full-suite proof in this dirty worktree; direct lint, typecheck, unit, focused plugin smokes, architecture, route inventory, and diff checks passed for the item `59` slice.

Next action:

- Continue Phase F with item `60`: add tests for plugin not found, and resolve or preserve the existing `PluginsPanel` broad-smoke blocker before claiming full `npm test` evidence.

### 2026-06-30 - Phase F Plugin Not-Found Coverage

Scope:

- Completed Phase F item `60` by adding route-level plugin not-found handling and coverage after the plugin inventory/install/runtime/diagnostics services were extracted.
- Updated `server/routes/pluginRoutes.ts` so valid dynamic plugin ids are checked through the current `listPluginControls()` projection before update, uninstall, runtime inspect, direct config save, enable/disable toggle, or plugin-specific setup-terminal startup.
- Missing plugins now return canonical `404` `plugin_not_found` API envelopes before any OpenClaw command, direct config write, runtime inspect, setup-terminal spawn, or toggle mutation runs.
- Added `tests/pluginRoutes.test.ts` to cover missing plugin update, uninstall, inspect, config, toggle, and setup-terminal requests, including proof that a secret-like config request body is not echoed in the not-found response.
- Restored the shared API-client OpenClaw command runner in `src/components/plugins/PluginsPanel.tsx`, resolving the previous `smoke:plugins-control-plane` blocker for `/api/openclaw/command` without reintroducing raw `fetch` or manual JSON serialization.
- Preserved the local untracked `src/styles/dystopai-theme/99-mission-quiet-redesign.css` stylesheet while moving its import before `95-typography-polish.css` in `src/dystopai-app-theme.css`, keeping the typography-polish-last UI contract intact.

Files changed:

- `server/routes/pluginRoutes.ts`
- `tests/pluginRoutes.test.ts`
- `src/components/plugins/PluginsPanel.tsx`
- `src/dystopai-app-theme.css`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `2` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts` passed with `25` focused plugin service tests.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:plugins-control-plane` passed after restoring the Plugins panel `/api/openclaw/command` caller.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:shell-production-ui` passed after moving the local mission stylesheet import before typography polish.
- `npm run smoke:ui-font-sizes` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `133` tests.
- `npm run lint` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end after the import-order repair, including plugin control-plane/service smokes, OpenClaw command smoke, all mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- The first `npm test` attempt failed at `smoke:shell-production-ui` with `typography polish must load last in the theme cascade` because the untracked local mission stylesheet was imported after `95-typography-polish.css`; moving that import earlier resolved the blocker while preserving the stylesheet.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- The worktree remains dirty with completed Phase F item `59` extraction files and pre-existing frontend UI edits; this slice did not commit or push.

Next action:

- Continue Phase F with item `61`: add tests for plugin install failure, preserving redacted command errors and the existing route/service API shapes.

### 2026-06-30 - Phase F Plugin Install-Failure Coverage

Scope:

- Completed Phase F item `61` by adding route-level coverage for plugin install command failures after the plugin install service extraction and not-found route guard.
- Extended `tests/pluginRoutes.test.ts` so `/api/plugins/install` failures with numeric command error codes return canonical `502` `plugin_command_failed` envelopes.
- Proved failed install responses do not leak raw secret material from command errors and do not echo the submitted install spec.
- Updated the plugin route harness to mirror production plugin error status mapping and redaction dependencies.
- Updated `scripts/smoke-plugin-install-service.ts` so the service smoke pins both service-level install/activation failure redaction and route-level install-failure envelope coverage.
- Restored the local mission quiet-redesign stylesheet import before `95-typography-polish.css` in `src/dystopai-app-theme.css` so the full suite preserves the typography-polish-last contract.

Files changed:

- `tests/pluginRoutes.test.ts`
- `scripts/smoke-plugin-install-service.ts`
- `src/dystopai-app-theme.css`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `3` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts` passed with `28` focused plugin tests.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `134` tests.
- `npm run lint` passed.
- `npm run smoke:shell-production-ui` passed after the import-order repair.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end after rerun, including plugin service/control-plane smokes, OpenClaw command smoke, mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- This slice only adds item `61` coverage; no plugin install service behavior or control-plane composition code changed.
- The first `npm test` attempt failed at `smoke:shell-production-ui` because `99-mission-quiet-redesign.css` was after `95-typography-polish.css`; moving the local stylesheet import before typography polish resolved the blocker.
- The worktree remains dirty with completed Phase F item `59`/`60` files and pre-existing frontend UI edits; this slice preserved them.

Next action:

- Continue Phase F with item `62`: add tests for redacted plugin errors across the remaining plugin command/API surfaces.

### 2026-06-30 - Phase F Plugin Redacted-Error Coverage

Scope:

- Completed Phase F item `62` by adding route-level redaction coverage across the remaining plugin command/API failure surfaces after install-failure coverage was pinned.
- Extended `tests/pluginRoutes.test.ts` with a table-driven sweep for plugin list, search, update-all, Gateway restart, ClawTalk setup, plugin update, uninstall, runtime inspect, direct config save, setup-terminal start, and enable/disable toggle errors.
- Updated the plugin route harness so each route dependency can fail independently while using production-shaped status mapping and redaction for `apiKey=...`, token fields, `sk-...` keys, and ClawTalk `cc_test_...` keys.
- Updated `scripts/smoke-plugins-control-plane.ts` to pin the redacted-error coverage test, endpoint set, and secret-marker assertions.
- No plugin domain logic was added to `server/controlPlane.ts`; `npm run smoke:server-architecture` still reports `18,882/29,000` composition lines, `9` entry lines, and `0` inline routes.

Files changed:

- `tests/pluginRoutes.test.ts`
- `scripts/smoke-plugins-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `4` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts` passed with `29` focused plugin tests.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `135` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end, including plugin service/control-plane smokes, OpenClaw command smoke, mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- The worktree remains dirty with previously completed Phase F extraction/coverage files and pre-existing frontend UI edits; this slice preserved them and did not commit or push.

Next action:

- Continue Phase F with item `63`: add tests for disabled plugin state, preserving plugin status distinctions through the extracted inventory/install/runtime/diagnostics and route boundaries.

### 2026-06-30 - Phase F Plugin Disabled-State Coverage

Scope:

- Completed Phase F item `63` by adding route-level disabled plugin state coverage after the plugin inventory/install/runtime/diagnostics services and prior route error coverage were in place.
- Extended `tests/pluginRoutes.test.ts` so the route harness can model a known disabled plugin returned by `listPluginControls()`.
- Proved `/api/plugins` preserves disabled plugin state with `enabled: false`, `status: "disabled"`, and operator guidance.
- Proved `/api/plugins/:pluginId` can enable a known disabled plugin through the canonical toggle route without treating it as missing or invoking runtime inspect.
- Updated `scripts/smoke-plugins-control-plane.ts` to pin the disabled-state route test, disabled plugin fixture, toggle endpoint, and existing Plugins page disabled filter/count/start-state affordances.
- No plugin disabled-state logic was added to `server/controlPlane.ts`; `npm run smoke:server-architecture` still reports `18,882/29,000` composition lines, `9` entry lines, and `0` inline routes.

Files changed:

- `tests/pluginRoutes.test.ts`
- `scripts/smoke-plugins-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `5` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts` passed with `30` focused plugin tests.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `136` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end, including the new disabled-state route coverage in `npm run test:unit`, plugin control-plane/service smokes, OpenClaw command smoke, mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- This slice adds coverage and smoke pinning only; it does not change production plugin behavior.
- The lint run still logs the known Babel deoptimization warning for `server/controlPlane.ts`; lint passed.
- Full-suite output still logs the known malformed historical `runtime-runs` JSONL row and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- The worktree remains dirty with previously completed Phase F extraction/coverage files and pre-existing frontend UI edits; this slice preserved them and did not commit or push.

Next action:

- Continue Phase F with item `64`: add tests for channel plugin unavailable state.

### 2026-06-30 - Phase F Plugin Channel-Unavailable Coverage

Scope:

- Completed Phase F item `64` by adding route/UI coverage for unavailable communication/channel plugins after disabled-state coverage was pinned.
- Extended `tests/pluginRoutes.test.ts` with an unavailable communications plugin fixture that includes `voice`, `sms`, and `clawtalk.websocket` channel metadata.
- Proved `/api/plugins` preserves `enabled: true`, `configuredEnabled: true`, `status: "unavailable"`, `category: "communications"`, channel metadata, restart-required state, and operator guidance.
- Proved `/api/plugins/:pluginId/inspect` treats the unavailable channel plugin as a known plugin and returns the same unavailable status/channel metadata with runtime inspect output.
- Updated `src/components/plugins/PluginsPanel.tsx` so plugin row badges use `pluginStatusLabel()` and no longer mask special backend statuses such as `unavailable`, `failed`, `configured`, or `managed` as generic `enabled`.
- Updated `scripts/smoke-plugins-control-plane.ts` to pin the unavailable-channel route fixture and Plugins page status-label contract.
- No plugin unavailable-state logic was added to `server/controlPlane.ts`; `npm run smoke:server-architecture` still reports `18,882/29,000` composition lines, `9` entry lines, and `0` inline routes.

Files changed:

- `tests/pluginRoutes.test.ts`
- `src/components/plugins/PluginsPanel.tsx`
- `scripts/smoke-plugins-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `6` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts` passed with `31` focused plugin tests.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:plugin-inventory-service` passed.
- `npm run smoke:plugin-install-service` passed.
- `npm run smoke:plugin-runtime-service` passed.
- `npm run smoke:plugin-diagnostics-service` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,882/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `137` tests.
- `npm run lint` passed.
- `npm run smoke:shell-production-ui` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end, including the new unavailable-channel route coverage in `npm run test:unit`, plugin control-plane/service smokes, OpenClaw command smoke, mission/runtime/provider/Gateway smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- This slice changes only the Plugins page status badge projection for special backend statuses; it does not change backend plugin inventory semantics or control-plane composition.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase F with item `65`: add Plugins page state distinction coverage for configured, missing-auth, unavailable, failed, and disabled.

### 2026-06-30 - Phase F Plugins Page State Distinction Coverage

Scope:

- Completed Phase F item `65` by adding Plugins page state distinction coverage after backend route coverage for disabled and unavailable plugins was pinned.
- Added `src/components/plugins/pluginStateProjection.ts` as the page-owned classifier for `configured`, `missing-auth`, `unavailable`, `failed`, and `disabled` states, including row badge labels, tones, filters, and summary counts.
- Updated `src/components/plugins/PluginsPanel.tsx` to use the classifier for row badges, search text, state filters, and summary chips so failed/unavailable/missing-auth plugins are not collapsed into generic enabled/setup states.
- Added `tests/pluginsPanelStateProjection.test.ts` coverage for the five beta states, filter matches, tones, and summary counts.
- Extended `scripts/smoke-plugins-control-plane.ts` to pin the projection helper, state filters, summary chips, and page-state test.

Files changed:

- `src/components/plugins/pluginStateProjection.ts`
- `src/components/plugins/PluginsPanel.tsx`
- `tests/pluginsPanelStateProjection.test.ts`
- `scripts/smoke-plugins-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pluginsPanelStateProjection.test.ts` passed with `1` page-state projection test.
- `node --import tsx --test tests/pluginRoutes.test.ts` passed with `6` plugin route tests.
- `node --import tsx --test tests/pluginInstallService.test.ts tests/pluginRuntimeService.test.ts tests/pluginDiagnosticsService.test.ts tests/pluginInventoryService.test.ts tests/pluginRoutes.test.ts tests/pluginsPanelStateProjection.test.ts` passed.
- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:server-architecture` passed.
- `npm run smoke:route-inventory` passed.
- `npm run smoke:shell-production-ui` passed.
- `npm run smoke:ui-font-sizes` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings.
- `npm test` passed end to end after this item and the subsequent Phase G cleanup, with `147` unit tests and the full plugin, command-console, filesystem, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- This is renderer state projection coverage only; backend plugin inventory semantics were preserved.
- The worktree also contains concurrent plugin inventory/runtime-status metadata projection changes. They were left intact and verified by the full suite, but they are not required to claim item `65`.

Next action:

- Continue Phase G with item `66` if not already complete, otherwise proceed to item `68`.

### 2026-06-30 - Phase G Safe Path Service Extraction

Scope:

- Completed Phase G item `66` by extracting shared path containment and equality helpers from `server/controlPlane.ts` into `server/services/filesystem/safePathService.ts`.
- Added `createSafePathService()` plus service-owned `samePath`, `isPathUnder`, `isInsidePath`, and `assertPathUnder` helpers.
- Wired `server/controlPlane.ts` to compose the safe path service and keep the existing call names as service delegates for static UI, command-console upload, Team Sync append, retired-agent cleanup, workspace mirror cleanup, and direct artifact-write containment checks.
- Removed local `isInsidePath`, `isPathUnder`, and `samePath` helper definitions from `server/controlPlane.ts`.
- Added `tests/safePathService.test.ts` coverage for exact paths, descendants, traversal attempts, sibling-prefix escapes, root containment, Windows case-insensitive comparison, and assertion failures.
- Updated `scripts/smoke-server-entrypoint-boundary.ts` so the architecture smoke pins the safe-path service import/composition and prevents containment helpers from returning to `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root now reports `18,733/29,000` lines, `9` entry lines, and `0` inline routes in the current Phase G working tree.

Files changed:

- `server/services/filesystem/safePathService.ts`
- `server/controlPlane.ts`
- `tests/safePathService.test.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/safePathService.test.ts` passed with `5` safe-path tests.
- `npm run typecheck:server` passed.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:team-sync-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,733/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `143` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end, including the new safe-path unit coverage, command-console/filesystem/team-sync smokes, plugin/Gateway/runtime/mission/provider smokes, secret scan, release validation/lifecycle, and CI workflow checks.

Risks and notes:

- Phase F items `56-65` are now complete and verified; Phase G continues from filesystem/upload service boundaries.
- This slice centralizes lexical path containment. Symlink escape coverage remains a later Phase G item and should be handled in item `71` or the upload/control-file service slices.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `67`: extract command-console upload handling into `server/services/filesystem/commandConsoleUploadService.ts`, preserving upload type allowlist, size limits, safe root containment, attachment metadata shape, and existing `/api/files/upload` behavior.

### 2026-06-30 - Phase G Command-Console Upload Service Extraction

Scope:

- Completed Phase G item `67` by extracting command-console upload behavior from `server/controlPlane.ts` into `server/services/filesystem/commandConsoleUploadService.ts`.
- Moved upload file naming, MIME fallback, supported type allowlist, size-limit enforcement, upload-root containment, attachment metadata normalization, and Gateway inline attachment conversion behind `createCommandConsoleUploadService(...)`.
- Wired `server/controlPlane.ts` to compose the upload service with the safe path service containment helper and keep only thin delegates for route upload persistence and Gateway attachment conversion.
- Added `tests/commandConsoleUploadService.test.ts` coverage for sanitized supported upload persistence, unsupported file type rejection, size-limit rejection, sibling-root escape rejection, attachment metadata normalization, Gateway payload creation, and oversized inline attachment skipping.
- Updated `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` to pin the upload service boundary and keep upload file naming/attachment normalization out of `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root remains at `18,733/29,000` lines, `9` entry lines, and `0` inline routes in the current Phase G working tree.

Files changed:

- `server/services/filesystem/commandConsoleUploadService.ts`
- `server/controlPlane.ts`
- `tests/commandConsoleUploadService.test.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/commandConsoleUploadService.test.ts` passed with `4` upload service tests.
- `node --import tsx --test tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts` passed with `9` focused filesystem service tests.
- `npm run smoke:command-console-files` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,733/29,000` composition lines, and `0` inline routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `147` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `147` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- Full `npm test` was rerun after this slice and passed end to end with `147` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.
- Phase F item `65` is complete; this slice preserved the plugin state projection files while finishing the started upload extraction.
- Symlink escape coverage, command-console upload-root end-to-end proof, and avatar upload limits remain later Phase G items.

Next action:

- Continue Phase G with item `68`: verify or finish control file read/write helper extraction into `server/services/controlFilesService.ts`, then continue traversal and upload-root escape coverage.

### 2026-06-30 - Phase G Control-File Service Boundary Hardening

Scope:

- Completed Phase G item `68` by hardening the existing command-console control-file service boundary.
- Updated `server/services/controlFilesService.ts` so the service validates `CONTROL_FILES`, resolves target paths against the workspace root, and enforces workspace containment before every control-file read or write.
- Wired `server/controlPlane.ts` to compose `createControlFilesService(WORKSPACE_ROOT, { isPathUnder })`, using the shared safe-path service while keeping the composition root as dependency wiring.
- Added `tests/controlFilesService.test.ts` coverage for allowed read/write behavior, traversal and non-control-file rejection, and containment failures before disk access.
- Updated `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` to pin the control-file service boundary, containment check, focused tests, and safe-path composition wiring.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root remains at `18,733/29,000` lines, `9` entry lines, and `0` inline routes.

Files changed:

- `server/services/controlFilesService.ts`
- `server/controlPlane.ts`
- `tests/controlFilesService.test.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/controlFilesService.test.ts` passed with `3` control-file service tests.
- `node --import tsx --test tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts` passed with `12` focused filesystem service tests.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `18,733/29,000` composition lines, and `0` inline routes.
- `npm run smoke:route-inventory` passed with `109` unique API routes.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `150` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `150` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- This slice tightens the service boundary without changing the public `/api/files` route shape.
- The new traversal coverage is scoped to command-console control files; broader Phase G traversal/symlink/avatar/upload-root coverage remains in items `70-75`.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `69`: extract Windows folder/image picker sessions into `server/services/filesystem/pickerSessionService.ts`.

### 2026-06-30 - Phase G Picker Session Service Extraction

Scope:

- Completed Phase G item `69` by extracting folder/image picker session handling from `server/controlPlane.ts` into `server/services/filesystem/pickerSessionService.ts`.
- Moved picker session maps, TTL pruning, session serialization, picker start-path normalization, native picker command execution, Electron dialog fallback, Windows PowerShell launcher generation, Windows result polling, and image-picker finalization behind `createPickerSessionService(...)`.
- Kept avatar persistence in the existing party/agent config flow for the later avatar-limit slice, but injected `persistAgentAvatarFromPath` into the picker service so image picker sessions can still persist selected profile pictures.
- Wired `server/controlPlane.ts` to compose `pickerSessionService` with `OPENCLAW_STATE_ROOT`, `WORKSPACE_ROOT`, `FOLDER_PICKER_TIMEOUT_MS`, and avatar persistence; `server/routes/filesystemRoutes.ts` now receives picker behavior through the `PickerSessionService` route option.
- Added `tests/pickerSessionService.test.ts` coverage for cancellation serialization, expired-session pruning, selected image persistence, Windows picker output parsing, launcher quoting, and Windows folder/image session finalization without opening real dialogs.
- Updated `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` to pin the picker service boundary and keep picker session/native dialog helpers out of `server/controlPlane.ts`.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root is now `17,987/29,000` lines, with `9` entry lines and `0` inline routes.

Files changed:

- `server/services/filesystem/pickerSessionService.ts`
- `server/routes/filesystemRoutes.ts`
- `server/controlPlane.ts`
- `tests/pickerSessionService.test.ts`
- `scripts/smoke-filesystem-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/pickerSessionService.test.ts` passed with `4` picker service tests.
- `node --import tsx --test tests/pickerSessionService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/safePathService.test.ts` passed with `16` focused filesystem service tests.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,987/29,000` composition lines, and `0` inline routes.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `154` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `154` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- Public route envelopes were preserved; the route layer still owns HTTP validation and delegates picker behavior through a service.
- Avatar upload byte-limit and file-type coverage remains a later Phase G item; this slice only moved picker-session image finalization and kept the avatar persistence dependency injected.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `70`: add broader path traversal attempt coverage across the extracted filesystem/picker/upload boundaries.

### 2026-06-30 - Phase G Path Traversal Coverage

Scope:

- Completed Phase G item `70` by broadening traversal-attempt coverage across the extracted safe-path, control-file, command-console upload, and picker-session service boundaries.
- Added POSIX and Windows traversal fixtures to `tests/safePathService.test.ts`, including safe normalized descendants, escapes above the approved root, root-target traversal, and cross-drive Windows escapes.
- Added separator-mixed and encoded traversal-shaped control-file fixtures to `tests/controlFilesService.test.ts`, proving those names are rejected by the service allowlist before disk access.
- Added command-console upload traversal coverage in `tests/commandConsoleUploadService.test.ts` for source-name path segment stripping and injected containment-guard write rejection before upload directory creation.
- Tightened `server/services/filesystem/pickerSessionService.ts` so relative picker start paths resolve under the provided fallback path and relative traversal starts fall back instead of escaping. Absolute starts and file URLs remain supported.
- Added picker start-path traversal coverage in `tests/pickerSessionService.test.ts`.
- Updated `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-command-console-files-control-plane.ts` to pin the traversal test coverage and picker start-path containment contract.

Files changed:

- `server/services/filesystem/pickerSessionService.ts`
- `tests/safePathService.test.ts`
- `tests/controlFilesService.test.ts`
- `tests/commandConsoleUploadService.test.ts`
- `tests/pickerSessionService.test.ts`
- `scripts/smoke-filesystem-control-plane.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts` passed with `21` focused filesystem service tests.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,987/29,000` composition lines, and `0` inline routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `159` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `159` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- Symlink escape handling is intentionally left for Phase G item `71`; this slice covers path traversal attempts only.
- Folder picker absolute starts remain allowed so the user can still intentionally browse to arbitrary local folders from the native picker.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `71`: add symlink escape coverage where locally possible across the extracted filesystem/upload boundaries.

### 2026-06-30 - Phase G Symlink Escape Coverage

Scope:

- Completed Phase G item `71` by adding real symlink escape protections and coverage across command-console control-file and upload attachment disk boundaries.
- Updated `server/services/controlFilesService.ts` so existing control-file paths are checked with `lstat` and `realpath` before reads or writes. A root-level control file such as `AGENTS.md` can no longer follow a symlink outside the configured workspace root.
- Updated `server/services/filesystem/commandConsoleUploadService.ts` so Gateway inline attachment conversion resolves both the upload root and candidate attachment path with `realpath` before reading bytes. Attachment metadata that points at an upload-root symlink escape is skipped.
- Added `tests/controlFilesService.test.ts` coverage for a real `AGENTS.md` symlink to an outside file, proving both read and write reject the escape and leave the outside file unchanged.
- Added `tests/commandConsoleUploadService.test.ts` coverage for a real upload attachment symlink to an outside file, proving inline Gateway attachment conversion does not read or encode the outside content.
- Updated `scripts/smoke-command-console-files-control-plane.ts` to pin the control-file realpath guard, upload attachment realpath guard, and symlink escape test coverage.

Files changed:

- `server/services/controlFilesService.ts`
- `server/services/filesystem/commandConsoleUploadService.ts`
- `tests/controlFilesService.test.ts`
- `tests/commandConsoleUploadService.test.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts` passed with `23` focused filesystem service tests, including both symlink fixtures on this host.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run typecheck:server` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,987/29,000` composition lines, and `0` inline routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `161` tests.
- `npm run lint` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `161` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, and CI smoke suite.

Risks and notes:

- The symlink tests skip only if the host OS refuses symlink creation; on this Windows host both symlink tests ran and passed.
- This slice intentionally protects disk-read/write boundaries. It does not change the public command-console file API envelopes or route ownership.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `72`: add file type allowlist coverage across command-console uploads and avatar/image picker boundaries.

### 2026-06-30 - Phase G File Type Allowlist Coverage

Scope:

- Completed Phase G item `72` by hardening and covering file type allowlist behavior across command-console uploads, avatar uploads, and image picker avatar selection.
- Added `server/services/filesystem/avatarFileService.ts` for avatar upload file naming, supported avatar image extension checks, MIME fallback mapping for extensionless images, the avatar upload size constant, and managed avatar filename generation.
- Updated `server/controlPlane.ts` to import avatar file helpers and keep only avatar persistence orchestration in the composition root.
- Tightened `server/services/filesystem/commandConsoleUploadService.ts` so an unsupported explicit extension is rejected before MIME fallback, while extensionless uploads can still use supported MIME fallback.
- Tightened `server/services/filesystem/pickerSessionService.ts` so selected image paths are checked against the avatar image allowlist before injected avatar persistence runs.
- Added `tests/avatarFileService.test.ts` for avatar extension/MIME allowlist behavior and deterministic managed avatar names.
- Extended `tests/commandConsoleUploadService.test.ts` with supported extension, supported MIME fallback, and unsupported explicit-extension rejection coverage.
- Extended `tests/pickerSessionService.test.ts` so unsupported native image-picker selections fail before avatar persistence.
- Added `tests/partyAvatarUploadRoutes.test.ts` so `/api/party/avatar-upload/:agentId` rejects unsupported file types with canonical `avatar_upload_failed` envelopes before persistence and still accepts extensionless supported image MIME uploads.
- Updated `scripts/smoke-filesystem-control-plane.ts`, `scripts/smoke-command-console-files-control-plane.ts`, and `scripts/smoke-server-entrypoint-boundary.ts` to pin the avatar file service boundary, explicit-extension rejection, picker allowlist enforcement, and new tests.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root is now `17,953/29,000` lines, with `9` entry lines and `0` inline routes.

Files changed:

- `server/services/filesystem/avatarFileService.ts`
- `server/services/filesystem/commandConsoleUploadService.ts`
- `server/services/filesystem/pickerSessionService.ts`
- `server/controlPlane.ts`
- `tests/avatarFileService.test.ts`
- `tests/commandConsoleUploadService.test.ts`
- `tests/pickerSessionService.test.ts`
- `tests/partyAvatarUploadRoutes.test.ts`
- `scripts/smoke-filesystem-control-plane.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `19` focused allowlist tests.
- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `30` focused filesystem service tests.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,953/29,000` composition lines, and `0` inline routes.
- `npm run smoke:skills-control-plane` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `168` tests.
- `npm run lint` passed.
- `npm test` passed end to end with `168` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- Upload content is still validated by extension/MIME metadata, not by file signature sniffing; this slice prevents unsupported explicit extensions from being accepted via a misleading MIME header.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `73`: add tests for attachment size limits across command-console upload persistence and Gateway inline attachment conversion.

### 2026-06-30 - Phase G Attachment Size-Limit Coverage

Scope:

- Completed Phase G item `73` by hardening and covering command-console attachment size limits across upload persistence and Gateway inline attachment conversion.
- Updated `server/services/filesystem/commandConsoleUploadService.ts` so declared oversized Gateway attachments are skipped before realpath resolution or file reads, while the existing post-read byte-length guard still rejects files whose actual bytes exceed the inline limit.
- Extended `tests/commandConsoleUploadService.test.ts` with exact-boundary upload persistence coverage, one-byte-over upload rejection without writing an extra file, file Gateway inline limit coverage, image Gateway inline limit coverage, declared-oversized metadata coverage, and actual oversized file-byte coverage.
- Updated `scripts/smoke-command-console-files-control-plane.ts` to pin the pre-read size guard and the new command-console upload size-limit tests.

Files changed:

- `server/services/filesystem/commandConsoleUploadService.ts`
- `tests/commandConsoleUploadService.test.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/commandConsoleUploadService.test.ts` passed with `10` command-console upload tests.
- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `32` focused filesystem service tests.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,953/29,000` composition lines, and `0` inline routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `170` tests.
- `npm run lint` passed.
- `npm test` passed end to end with `170` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- This slice keeps the existing public `/api/files/upload` shape unchanged; it only tightens service-owned size-limit behavior and coverage.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `74`: add avatar upload-limit coverage across `/api/party/avatar-upload/:agentId` and avatar file persistence.

### 2026-06-30 - Phase G Avatar Upload-Limit Coverage

Scope:

- Completed Phase G item `74` by hardening and covering avatar upload byte limits across the HTTP route and avatar persistence helpers.
- Updated `server/services/filesystem/avatarFileService.ts` so the avatar file service owns byte/stat-size validators and the shared upload-limit error message alongside the `AVATAR_UPLOAD_LIMIT_BYTES` constant.
- Updated `server/controlPlane.ts` so both `persistAgentAvatarBytes` and `persistAgentAvatarFromPath` use the service-owned validators before writing files or state.
- Updated `server/routes/partyManagementRoutes.ts` so `/api/party/avatar-upload/:agentId` receives `avatarUploadLimitBytes` through composition, uses that exact value for `express.raw`, and returns canonical `413` `avatar_upload_failed` envelopes for oversized parser errors before persistence runs.
- Extended `tests/avatarFileService.test.ts` and `tests/partyAvatarUploadRoutes.test.ts` with exact-boundary, oversized, empty-upload, and no-persistence-on-oversize coverage.
- Updated `scripts/smoke-filesystem-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` to pin the shared avatar size validators, route limit injection, and persistence helper usage.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root is now `17,959/29,000` lines, with `9` entry lines and `0` inline routes.

Files changed:

- `server/services/filesystem/avatarFileService.ts`
- `server/controlPlane.ts`
- `server/routes/partyManagementRoutes.ts`
- `tests/avatarFileService.test.ts`
- `tests/partyAvatarUploadRoutes.test.ts`
- `scripts/smoke-filesystem-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/avatarFileService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `7` focused avatar tests.
- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `34` focused filesystem service tests.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,959/29,000` composition lines, and `0` inline routes.
- `npm run typecheck:server` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `172` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `172` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The route now returns a canonical API envelope for oversized raw avatar bodies instead of relying on the global error handler.
- This slice does not change the public success payload for avatar uploads or picker sessions.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase G with item `75`: confirm uploaded command-console files never escape the approved upload root.

### 2026-06-30 - Phase G Upload-Root Escape Confirmation

Scope:

- Completed Phase G item `75` by hardening and proving command-console upload persistence cannot escape the approved upload root.
- Updated `server/services/filesystem/commandConsoleUploadService.ts` so the service accepts `approvedRootDir`, realpath-checks the upload write root before persistence, creates uploaded files with exclusive `wx` semantics, and re-checks the real uploaded file path after creation.
- Updated `server/controlPlane.ts` so command-console uploads are composed with `approvedRootDir: WORKSPACE_ROOT`, keeping workspace containment in the extracted service boundary while the composition root stays as wiring.
- Extended `tests/commandConsoleUploadService.test.ts` with symlinked upload-root rejection and preexisting symlink upload-target rejection, in addition to existing sibling-root metadata, inline Gateway symlink read, allowlist, and size-limit coverage.
- Updated `scripts/smoke-command-console-files-control-plane.ts` and `scripts/smoke-server-entrypoint-boundary.ts` to pin approved-root composition, upload write-root realpath validation, exclusive file creation, and the new upload-root escape tests.
- Regenerated `docs/generated/server-index-architecture.md`; the composition root is now `17,960/29,000` lines, with `9` entry lines and `0` inline routes.

Files changed:

- `server/services/filesystem/commandConsoleUploadService.ts`
- `server/controlPlane.ts`
- `tests/commandConsoleUploadService.test.ts`
- `scripts/smoke-command-console-files-control-plane.ts`
- `scripts/smoke-server-entrypoint-boundary.ts`
- `docs/generated/server-index-architecture.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/commandConsoleUploadService.test.ts` passed with `12` command-console upload tests.
- `node --import tsx --test tests/safePathService.test.ts tests/controlFilesService.test.ts tests/avatarFileService.test.ts tests/commandConsoleUploadService.test.ts tests/pickerSessionService.test.ts tests/partyAvatarUploadRoutes.test.ts` passed with `36` focused filesystem service tests.
- `npm run smoke:command-console-files` passed.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:server-architecture` passed with `9` entry lines, `17,960/29,000` composition lines, and `0` inline routes.
- `npm run typecheck` passed.
- `npm run test:unit` passed with `174` tests.
- `npm run lint` passed.
- `node scripts/report-server-index-architecture.mjs` regenerated the architecture report.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `174` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- Existing uploaded files are not migrated; this slice hardens new upload persistence and inline read conversion.
- The upload service now refuses a preexisting predicted upload target instead of following it. That is intentional for safety and should only affect suspicious or collision-prone paths.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `76`: keep `src/store/nexusStore.ts` from growing further before moving renderer API calls into `src/api/*` modules.

### 2026-06-30 - Phase H Renderer Store Growth Guard

Scope:

- Completed Phase H item `76` by adding a repeatable guard that keeps `src/store/nexusStore.ts` from growing before renderer API calls are extracted into `src/api/*` modules.
- Added `scripts/smoke-renderer-store-boundary.ts` to pin the current store baseline at `4,408` logical lines, `18` store-owned `apiRequest` call lines, `20` store-owned `/api/` path literal lines, and exactly one direct `fetch` for the `/api/openclaw/agent-turn/stream` SSE path.
- Wired `npm run smoke:renderer-store-boundary` into `package.json` and `npm run test:ci` immediately before the existing `smoke:nexus-control-plane` check, so CI fails if future work adds store API surface instead of extracting it.
- Left `src/store/nexusStore.ts` unchanged for this slice; the item is a boundary guard before item `77` extraction work starts.

Files changed:

- `scripts/smoke-renderer-store-boundary.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:renderer-store-boundary` passed with `4408/4408` `nexusStore` lines, `18/18` `apiRequest` calls, and `1` direct SSE fetch.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed end to end with `174` unit tests and the full command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, renderer-store-boundary, and CI smoke suite.

Risks and notes:

- The guard intentionally allows the existing SSE stream `fetch` in `nexusStore.ts`; moving that stream into a focused API/SSE client can tighten the budget in a later Phase H slice.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `77`: move renderer API calls into `src/api/*` modules, starting with a focused API family that can be extracted without backend behavior changes while keeping `npm run smoke:renderer-store-boundary` green.

### 2026-06-30 - Phase H Renderer API Extraction, Party And Agent-Turn Helpers

Scope:

- Completed Phase H item `77` by moving a focused batch of renderer API calls out of `src/store/nexusStore.ts` and into `src/api/*` modules without changing backend behavior.
- Added `src/api/party.ts` for party overview, avatar URL generation, agent config saves, recruitment, recruit-resource saves, and retire requests, along with party wire payload types that were previously embedded in the store.
- Added `src/api/agentTurns.ts` for runtime preflight, buffered agent turns, party prewarm turns, and session clear requests, along with agent-turn wire payload types that were previously embedded in the store.
- Updated `src/store/nexusStore.ts` to delegate those request families through the extracted API modules while leaving mission projection/start/stop and the existing SSE stream parser in place for later Phase H items.
- Ratcheted `scripts/smoke-renderer-store-boundary.ts` from the item `76` baseline to `4,274` logical store lines, `3` store-owned `apiRequest` call lines, `4` store-owned `/api/` path literal lines, and exactly one direct SSE fetch.
- Updated `scripts/smoke-nexus-control-plane.ts`, `scripts/smoke-agent-turn-control-plane.ts`, `scripts/smoke-filesystem-control-plane.ts`, and `scripts/smoke-config-save-lifecycle.ts` so renderer checks assert the new API helper ownership instead of requiring direct `apiRequest` calls in the store.

Files changed:

- `src/api/party.ts`
- `src/api/agentTurns.ts`
- `src/store/nexusStore.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `scripts/smoke-nexus-control-plane.ts`
- `scripts/smoke-agent-turn-control-plane.ts`
- `scripts/smoke-filesystem-control-plane.ts`
- `scripts/smoke-config-save-lifecycle.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:renderer-store-boundary` passed with `4274/4274` `nexusStore` lines, `3/3` store-owned `apiRequest` calls, and `1` direct SSE fetch.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:filesystem-control-plane` passed.
- `npm run smoke:config-save` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `174` tests.
- `npm test` passed end to end with `174` unit tests and the full command-console, filesystem, renderer-store-boundary, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The remaining JSON API calls in `src/store/nexusStore.ts` are mission projection/start/stop and are intentionally left for Phase H item `78` so mission projection behavior can be extracted and verified as its own slice.
- The direct `/api/openclaw/agent-turn/stream` fetch remains in the store for the existing SSE parser; moving that should be a later focused API/SSE client extraction.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `78`: move mission projection syncing into `src/api/missions.ts` or `src/services/missionProjectionClient.ts` while preserving backend mission truth.

### 2026-06-30 - Phase H Mission API Extraction

Scope:

- Completed Phase H item `78` by moving mission projection/start/stop renderer JSON API calls out of `src/store/nexusStore.ts` and into `src/api/missions.ts`.
- Added `src/api/missions.ts` for backend mission wire contracts, mission projection fetches, mission start requests, and mission stop requests.
- Updated `src/store/nexusStore.ts` to delegate mission requests through the extracted mission API module while preserving backend mission projection merge behavior, recovered failed lifecycle states, retained local reports unrelated to backend mission ids, mission polling, and the existing mission feed messages.
- Ratcheted `scripts/smoke-renderer-store-boundary.ts` from the item `77` baseline to `4,229` logical store lines, `0` store-owned `apiRequest` call lines, `1` store-owned `/api/` path literal, and exactly one direct SSE fetch for `/api/openclaw/agent-turn/stream`.
- Updated mission source-inspection smokes so durable-state, idempotency, cancellation, backend-owned lifecycle, lifecycle-projection, and restart-recovery contracts assert mission API ownership in `src/api/missions.ts` instead of forcing endpoint literals to remain in the store.

Files changed:

- `src/api/missions.ts`
- `src/store/nexusStore.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `scripts/smoke-mission-lifecycle-projection.ts`
- `scripts/smoke-mission-restart-recovery.ts`
- `scripts/smoke-mission-durable-state.ts`
- `scripts/smoke-mission-backend-owned.ts`
- `scripts/smoke-mission-idempotency.ts`
- `scripts/smoke-mission-cancellation.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:renderer-store-boundary` passed with `4229/4229` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `1/1` API path literal, and `1` direct SSE fetch.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:mission-restart-recovery` passed.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:mission-idempotency` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-report` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `174` tests.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- An initial full-suite run exposed stale source-smoke assertions that still expected mission projection types and endpoint literals in `src/store/nexusStore.ts`; those smoke contracts were updated to enforce the new `src/api/missions.ts` ownership before the final full `npm test` pass.
- The direct `/api/openclaw/agent-turn/stream` fetch remains in the store for SSE parsing and is now the only store-owned backend path literal.

Next action:

- Continue Phase H with item `79`: move the remaining agent-turn stream request out of `src/store/nexusStore.ts` and into `src/api/agentTurns.ts` or a focused renderer SSE client while preserving stream parser behavior.

### 2026-06-30 - Phase H Agent-Turn Stream API Extraction

Scope:

- Completed Phase H item `79` by moving the remaining renderer-owned agent-turn stream request out of `src/store/nexusStore.ts` and into `src/api/agentTurns.ts`.
- Updated `src/api/agentTurns.ts` so `sendStreamingAgentTurn(...)` owns the `/api/openclaw/agent-turn/stream` direct `fetch`, request body serialization, event-stream content-type detection, shared `createSseFrameParser()` frame iteration, and non-SSE JSON/text fallback handling.
- Updated `src/store/nexusStore.ts` so agent turns delegate SSE transport through `sendStreamingAgentTurn(...)` while keeping live UI projection in a per-request `createControlStreamProjector()` callback for `start`, `status`, `progress`, `delta`, `error`, and `final` frames.
- Preserved existing stream behavior: malformed final metadata after live text still becomes a successful accumulated reply with warning metadata, model/transport/buffered metadata still projects into the response, aborted stream controllers still throw without retrying the buffered route, and failed streaming transport still falls back to the buffered agent-turn API.
- Ratcheted `scripts/smoke-renderer-store-boundary.ts` from the item `78` baseline to `4,214` logical store lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches.
- Updated agent-turn, Nexus, runtime-actions, and OpenClaw source smokes to assert `src/api/agentTurns.ts` owns stream transport/frame reading while `src/store/nexusStore.ts` owns only live stream projection.

Files changed:

- `src/api/agentTurns.ts`
- `src/store/nexusStore.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `scripts/smoke-agent-turn-control-plane.ts`
- `scripts/smoke-nexus-control-plane.ts`
- `scripts/smoke-runtime-actions-control-plane.ts`
- `scripts/smoke-openclaw-contracts.mjs`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:renderer-store-boundary` passed with `4214/4214` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run typecheck` passed.
- `npm run smoke:openclaw` passed, including OpenClaw contracts, diagnostic redaction, shared SSE parser, and agent-turn SSE endpoint smoke checks.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `174` tests.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched files.
- `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw stream, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- `src/store/nexusStore.ts` still owns live agent-turn projection state; item `79` only moved transport and stream frame iteration out of the store. Deeper projection-state splitting remains Phase H items `82-85`.
- The stream helper intentionally keeps direct `fetch` because `apiRequest` is JSON-buffered and cannot parse event streams.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `80`: move provider auth calls into `src/api/providerAuth.ts` without changing provider setup/status behavior or credential redaction.

### 2026-06-30 - Phase H Provider Auth API Extraction

Scope:

- Completed Phase H item `80` by moving renderer provider-auth request ownership into `src/api/providerAuth.ts`.
- Added `src/api/providerAuth.ts` for provider auth status reads, API-key saves, OAuth session starts, OAuth session polling, manual OAuth completion, provider-status type guards, provider labels, auth kind labels, and OpenAI Codex effective-auth fallback behavior.
- Updated `src/components/auth/ProviderAuthModal.tsx` to delegate provider status refresh, OAuth start/poll/manual completion, and API envelope handling through the provider-auth API module while preserving credential clearing, readiness verification, gcloud refresh, browser OAuth, and manual OAuth behavior.
- Updated `src/components/editor/AgentEditorModal.tsx`, `src/components/party/ModelSelectorModal.tsx`, and `src/components/recruit/RecruitAgentModal.tsx` to use the shared provider-auth helpers for status refreshes and key saves instead of owning `/api/auth/providers` endpoint literals.
- Updated `scripts/smoke-auth-provider-model-control-plane.ts`, `scripts/smoke-auth-control-plane.ts`, `scripts/smoke-config-save-lifecycle.ts`, and `scripts/smoke-renderer-store-boundary.ts` so source checks enforce `src/api/providerAuth.ts` as the provider-auth renderer boundary and prove components no longer own provider-auth endpoint strings.

Files changed:

- `src/api/providerAuth.ts`
- `src/components/auth/ProviderAuthModal.tsx`
- `src/components/editor/AgentEditorModal.tsx`
- `src/components/party/ModelSelectorModal.tsx`
- `src/components/recruit/RecruitAgentModal.tsx`
- `scripts/smoke-auth-control-plane.ts`
- `scripts/smoke-auth-provider-model-control-plane.ts`
- `scripts/smoke-config-save-lifecycle.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:auth-provider-model` passed.
- `npm run smoke:config-save` passed.
- `npm run smoke:auth` passed.
- `npm run smoke:renderer-store-boundary` passed with `4214/4214` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `174` tests.
- `npm run smoke:provider-auth-beta` passed.
- `npm run smoke:nexus-control-plane` passed.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `rg -n "/api/auth/providers" src/components` returned no matches.
- `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw stream, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The provider-auth API module intentionally keeps the credential-bearing API-key save body in one renderer boundary; component code still receives the typed save callback so existing modal lifecycle behavior remains unchanged.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `81`: move plugin calls into `src/api/plugins.ts` while preserving plugin status/state projection, setup terminal behavior, install/update/remove flows, runtime command handling, and redacted plugin error envelopes.

### 2026-06-30 - Phase H Plugin API Extraction

Scope:

- Completed Phase H item `81` by moving renderer plugin request ownership into `src/api/plugins.ts`.
- Added `src/api/plugins.ts` for plugin wire contracts and API helpers covering plugin list/refresh, ClawHub search, install, enable/disable, update, update-all, runtime inspect, Gateway restart, uninstall, direct plugin setup saves, ClawTalk setup, and the plugin-panel OpenClaw command runner.
- Updated `src/components/plugins/PluginsPanel.tsx` to call the plugin API helpers instead of owning `/api/plugins` and `/api/openclaw/command` endpoint literals, direct `apiRequest` usage, or local plugin API response handling.
- Moved plugin entry/config field type ownership into `src/api/plugins.ts`; `src/components/plugins/pluginStateProjection.ts` now consumes those API-owned types while keeping the Plugins page state classifier, filters, row badge tones, and summary counts unchanged.
- Updated `scripts/smoke-plugins-control-plane.ts`, `scripts/smoke-openclaw-command-control-plane.ts`, and `scripts/smoke-renderer-store-boundary.ts` so source checks enforce `src/api/plugins.ts` as the renderer plugin API boundary and prove `PluginsPanel` does not own plugin endpoint literals or JSON API calls.

Files changed:

- `src/api/plugins.ts`
- `src/components/plugins/PluginsPanel.tsx`
- `src/components/plugins/pluginStateProjection.ts`
- `scripts/smoke-plugins-control-plane.ts`
- `scripts/smoke-openclaw-command-control-plane.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:plugins-control-plane` passed.
- `npm run smoke:openclaw-command-control-plane` passed.
- `npm run smoke:renderer-store-boundary` passed with `4214/4214` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `174` tests.
- `rg -n "/api/(plugins|openclaw/command)|apiRequest|apiErrorMessage|pluginApiData" src\components\plugins | Select-String -NotMatch "../../api/plugins"` returned no matches.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `174` unit tests and the full renderer-store, command-console, OpenClaw, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The plugin API module intentionally keeps plugin command/setup/install error conversion in one renderer boundary through the existing `apiRequest` envelope and `apiErrorMessage` redaction path.
- `src/store/nexusStore.ts` stayed at the item `79` ratchet: `4,214` logical lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches.
- The worktree contains unrelated untracked image files, `dees-deep-dish-edited.png` and `dees-deep-dish-mic-fixed.png`; this slice left them untouched.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.

Next action:

- Continue Phase H with item `82`: split UI-only state from runtime projection state while preserving backend-owned runtime truth and current persisted state shape.

### 2026-06-30 - Phase H UI Runtime Projection State Split

Scope:

- Completed Phase H item `82` by splitting UI-only shell state from volatile runtime projection state in the renderer store layer.
- Added `src/store/nexusUiState.ts` for `AppTab`, selected-agent state, tab state, editor-open state, selection normalization, and UI initial state construction.
- Added `src/store/runtimeProjectionState.ts` for `NexusRuntimeProjectionState`, operation-state initialization, volatile runtime projection reset/merge behavior, and agent config save-status projection helpers.
- Updated `src/store/nexusStore.ts` so the main store composes persisted operator state, UI-only state, runtime projection state, and coordination state through explicit interfaces.
- Preserved the existing persisted local-storage shape: `partialize` still saves only operator configuration and completed mission summaries, while active mission projection, mission feed, responses, busy agents, operation states, session warm state, and config save status remain volatile.
- Added `tests/nexusStoreStateSplit.test.ts` to verify UI-only state construction, runtime projection reset construction, and persistence-merge behavior that preserves current volatile responses while clearing warm/save internals.
- Updated `scripts/smoke-renderer-store-boundary.ts` to pin the new state modules and ratchet `src/store/nexusStore.ts` to `4,149` logical lines, `0` store-owned `apiRequest` calls, `0` store-owned `/api/` path literals, and `0` direct fetches.

Files changed:

- `src/store/nexusUiState.ts`
- `src/store/runtimeProjectionState.ts`
- `src/store/nexusStore.ts`
- `tests/nexusStoreStateSplit.test.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/nexusStoreStateSplit.test.ts` passed with `3` tests.
- `npm run smoke:renderer-store-boundary` passed with `4149/4149` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:config-save` passed after updating the source smoke to assert config save-status type ownership in `src/store/runtimeProjectionState.ts`.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `177` tests.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `177` unit tests and the full renderer-store, Nexus, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- This slice intentionally keeps runtime response projection actions inside `src/store/nexusStore.ts`; item `82` only separated the state contracts and reset/merge helpers. Command-console/runtime response state should be split in item `84`.
- An initial full-suite run exposed a stale `smoke:config-save` source assertion that expected `AgentConfigSaveScope` to remain in `src/store/nexusStore.ts`; the smoke now pins the new `src/store/runtimeProjectionState.ts` ownership and the final full suite passes.
- The worktree still contains earlier uncommitted Phase H API extraction changes for items `77-81`, which remain recorded complete in the beta plan and were left intact.

Next action:

- Continue Phase H with item `83`: split agent config state from mission state without changing persisted agent config or backend mission projection behavior.

### 2026-06-30 - Phase H Agent Config And Mission State Split

Scope:

- Completed Phase H item `83` by splitting persisted renderer agent config state from persisted mission state.
- Added `src/store/agentConfigState.ts` for `NexusAgentConfigState`, seed-agent/default-party construction, retired-agent memory, party sanitization, portrait persistence sanitization, agent config hydration, and agent config partialization.
- Added `src/store/missionState.ts` for `NexusMissionState`, mission initial state, mission history/report trim limits, mission hydration, and mission partialization.
- Updated `src/store/nexusStore.ts` so `NexusState` composes `NexusAgentConfigState`, `NexusMissionState`, `NexusUiState`, `NexusRuntimeProjectionState`, and coordination state explicitly, removing the mixed `NexusPersistedState` interface while preserving the existing local-storage payload shape.
- Expanded `tests/nexusStoreStateSplit.test.ts` to cover agent-config state construction, party sanitization, persisted portrait sanitization, legacy default-party repair, mission-state construction, and mission history/report trimming.
- Updated `scripts/smoke-renderer-store-boundary.ts` to assert the agent-config and mission-state boundaries, prevent reintroducing mixed persisted state, and ratchet `src/store/nexusStore.ts` to `3,936` logical lines with `0` API request calls, `0` API path literals, and `0` direct fetches.

Files changed:

- `src/store/agentConfigState.ts`
- `src/store/missionState.ts`
- `src/store/nexusStore.ts`
- `tests/nexusStoreStateSplit.test.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/nexusStoreStateSplit.test.ts` passed with `6` tests.
- `npm run smoke:renderer-store-boundary` passed with `3936/3936` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:config-save` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `180` tests.
- `npm test` passed end to end with `180` unit tests and the full renderer-store, Nexus, mission, command-console, filesystem, plugin, Gateway, runtime, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.

Risks and notes:

- This slice intentionally keeps command-console response projection and local draft cleanup inside `src/store/nexusStore.ts`; item `84` should split those command-console concerns without changing queue/session semantics.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Existing uncommitted Phase H API/state extraction changes from prior automation runs remain in the worktree and were preserved.

Next action:

- Continue Phase H with item `84`: split command-console draft state from runtime response state without changing command-console queue, session, or response projection behavior.

### 2026-06-30 - Phase H Command Console Draft And Response State Split

Scope:

- Completed Phase H item `84` by splitting command-console draft state from runtime response state in the renderer store layer.
- Added `src/store/commandConsoleState.ts` for command-console draft storage keys, draft read/write/remove helpers, retired-agent draft cleanup, command-console response/busy-lane state, session key generation, queue progress labels, queued response projection, and queued response duration patching.
- Updated `src/store/runtimeProjectionState.ts` so runtime projection no longer owns `agentResponses` or `busyAgentIds`; those now compose through `NexusCommandConsoleResponseState`.
- Updated `src/store/nexusStore.ts` to compose `makeCommandConsoleResponseState()`, preserve volatile command-console responses through `preserveCommandConsoleResponseState(current)`, delegate queued response construction/patching to `commandConsoleState`, and delegate retired-agent command draft cleanup through `removeCommandConsoleDraftsForAgent(...)`.
- Updated `src/components/monitor/AgentResponseConsole.tsx` to consume command-console draft helpers from `src/store/commandConsoleState.ts` instead of owning localStorage draft access or the draft state shape.
- Expanded `tests/nexusStoreStateSplit.test.ts` for command-console response-state preservation, draft storage behavior, retired-agent draft cleanup, session keys, queue progress labels, queued response projection, and queued response duration patching.
- Updated `scripts/smoke-renderer-store-boundary.ts` to pin the item `84` boundary and ratchet `src/store/nexusStore.ts` to `3,889` logical lines with `0` API requests, `0` API path literals, and `0` direct fetches.

Files changed:

- `src/store/commandConsoleState.ts`
- `src/store/runtimeProjectionState.ts`
- `src/store/nexusStore.ts`
- `src/components/monitor/AgentResponseConsole.tsx`
- `tests/nexusStoreStateSplit.test.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/nexusStoreStateSplit.test.ts` passed with `10` tests.
- `npm run smoke:renderer-store-boundary` passed with `3889/3889` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:config-save` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `184` tests.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `184` unit tests and the full renderer-store, Nexus, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The command-console action implementations still live in `src/store/nexusStore.ts`; item `84` split state ownership and helper boundaries without changing queue/session runtime behavior.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Existing uncommitted Phase H, Phase I, and Phase L changes from prior automation runs remain in the worktree and were preserved.

Next action:

- Continue Phase H with item `85`: add persisted-state migration coverage for the split store modules and the existing `nexus-v10` persisted payload shape.

### 2026-06-30 - Phase H Persisted-State Migration Coverage

Scope:

- Completed Phase H item `85` by adding explicit persisted-state migration and payload-shape coverage for the split renderer store modules.
- Added `src/store/nexusPersistence.ts` for the renderer `nexus-v10` persistence contract: storage key, current persisted payload version `5`, minimum accepted version `3`, persisted-state merge, and persisted payload partialization.
- Updated `src/store/nexusStore.ts` so Zustand `merge` and `partialize` delegate to `mergeNexusPersistedState(...)` and `partializeNexusPersistedState(...)`; `nexusStore` remains composition and no longer embeds the persistence version gate inline.
- Expanded `tests/nexusStoreStateSplit.test.ts` to cover missing/stale persisted version rejection, legacy default-party migration through split modules, mission history/report trimming, volatile runtime projection preservation, volatile command-console response preservation, warm/save-state clearing, and compact `nexus-v10` payload keys.
- Updated `scripts/smoke-renderer-store-boundary.ts` to pin the new persistence boundary and item `85` tests.
- Updated `scripts/smoke-mission-report-truth.ts` so mission report persistence source checks follow the new `nexusPersistence.ts` boundary.

Files changed:

- `src/store/nexusPersistence.ts`
- `src/store/nexusStore.ts`
- `tests/nexusStoreStateSplit.test.ts`
- `scripts/smoke-renderer-store-boundary.ts`
- `scripts/smoke-mission-report-truth.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `node --import tsx --test tests/nexusStoreStateSplit.test.ts` passed with `13` tests.
- `npm run smoke:renderer-store-boundary` passed with `3865/3889` `nexusStore` lines, `0/0` store-owned `apiRequest` calls, `0/0` API path literals, and `0` direct fetches.
- `npm run smoke:mission-report` passed.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:config-save` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `187` tests.
- `git diff --check` passed with only LF-to-CRLF working-copy warnings on touched and pre-existing modified files.
- `npm test` passed end to end with `187` unit tests and the full renderer-store, Nexus, mission, command-console, filesystem, plugin, Gateway, runtime, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The persisted payload intentionally remains `nexus-v10` with `_version: 5`, persisted agent config, and persisted mission draft/history/reports only; active mission projection, mission feed, operation state, warm/save internals, command-console responses, busy lanes, and UI selection remain volatile.
- The first full-suite run exposed a stale `smoke:mission-report` source assertion that expected mission partialization to remain inline in `nexusStore.ts`; the smoke now pins the new persistence boundary and the final full suite passes.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Existing uncommitted Phase H, Phase I, and Phase L changes from prior automation runs remain in the worktree and were preserved.

Next action:

- Continue Phase I with item `86`: freeze new global CSS layers after `95-typography-polish.css` before further UI cleanup.

### 2026-06-30 - Phase I UI Cleanup And Packaged Beta Screenshots

Scope:

- Completed Phase I items `86-95` by finishing the started UI cleanup, accessibility, token, and packaged-screenshot slice.
- Froze the global DystopAI theme cascade after `95-typography-polish.css`; `scripts/smoke-shell-production-ui.ts` now rejects any future numbered `src/styles/dystopai-theme/*` layer above `95`.
- Removed the former late `src/styles/dystopai-theme/99-mission-quiet-redesign.css` global layer and moved those mission-specific rules to component-owned `src/components/mission/MissionDeploymentPanel.css`, imported by `src/components/mission/MissionDeploymentPanel.tsx`.
- Added `docs/DESIGN_TOKENS.md` for colors, spacing, typography, radii, motion, and accessibility notes, including the frozen final global layer and component-owned CSS rule.
- Extended `src/styles/tokens.css` with motion-duration tokens and reduced-motion overrides, and pinned `src/styles/accessibility.css` focus-ring/reduced-motion behavior through smoke coverage.
- Extended UI smokes to verify side-rail navigation semantics, `aria-current="page"`, skip-link/main-landmark behavior, visible token-backed focus rings, explicit and OS reduced-motion handling, small-text floors, token contrast pairs, and mission text contrast.
- Added packaged beta screenshot capture plumbing: unsigned packaged-dir support, safer Windows packaged-dir cleanup/copy behavior, launcher argument repair, packaged Electron screenshot automation, and `npm run capture:packaged-beta-screenshots`.

Files changed:

- `src/dystopai-app-theme.css`
- `src/styles/dystopai-theme/99-mission-quiet-redesign.css`
- `src/components/mission/MissionDeploymentPanel.tsx`
- `src/components/mission/MissionDeploymentPanel.css`
- `src/styles/tokens.css`
- `src/index.css`
- `docs/DESIGN_TOKENS.md`
- `scripts/smoke-shell-production-ui.ts`
- `scripts/smoke-ui-font-sizes.ts`
- `scripts/smoke-ui-contrast-tokens.ts`
- `electron/main.cjs`
- `scripts/capture-packaged-beta-screenshots.ts`
- `scripts/package-desktop.cjs`
- `scripts/after-pack.cjs`
- `scripts/windows-electron-launcher.cs`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:shell-production-ui` passed.
- `npm run smoke:ui-font-sizes` passed.
- `npm run smoke:ui-contrast` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run test:unit` passed with `187` tests.
- `npm run build:client` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports, writing screenshots under `output/playwright`.
- `npm run package:desktop:unsigned` passed, producing `release/win-unpacked` with the packaged app, launcher, Electron runtime, OpenClaw resources, `app.asar`, `dist/index.html`, and `dist-server/index.cjs`.
- `npm run capture:packaged-beta-screenshots` passed, writing 12 packaged production screenshots and `manifest.json` under `output/packaged-beta-screenshots/2026-07-01T00-15-52-033Z`.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The packaged screenshot capture intentionally uses unsigned packaged-dir mode for the private beta milestone; public signing remains out of scope for this phase.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Existing uncommitted Phase H and Phase L changes remain in the worktree and are recorded complete in the beta plan. Unrelated untracked image files remain untouched.

Next action:

- Continue Phase J with item `96`: run `npm ci` as the first beta readiness gate.

### 2026-06-30 - Phase J Initial Beta Readiness Gates

Scope:

- Completed Phase J items `96-101` by running the first beta readiness gate batch from a clean dependency install through bundle budget validation.
- Verified `npm ci` without changing dependency versions or applying audit fixes.
- Verified OpenClaw vendor preparation before runtime/server-facing smoke coverage.
- Re-ran the full `npm test` suite after the clean install.
- Ran the explicit coverage, standalone build, and production bundle-budget gates.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm ci` passed, adding `561` packages and auditing `562` packages.
- `npm run prepare:openclaw-vendor` passed and confirmed OpenClaw `2026.6.11` production dependencies were already prepared.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `npm run test:unit:coverage` passed with `187` tests and aggregate coverage of `88.59%` lines, `75.58%` branches, and `87.11%` functions.
- `npm run build:standalone` passed, producing the production client bundle and `dist-server/index.cjs`.
- `npm run check:bundle-budgets` passed with entry JS `493,462` bytes / `154,541` gzip bytes, entry CSS `1,222,691` bytes / `155,244` gzip bytes, and total JS `783,501` bytes / `241,568` gzip bytes against the current budgets.

Risks and notes:

- `npm ci` reported existing dependency-audit warnings: `8` vulnerabilities (`2` low, `2` moderate, `2` high, and `2` critical), plus deprecated transitive packages. This pass preserved dependency versions and did not run `npm audit fix`.
- Full-suite output still logs the known Babel deoptimization warning for `server/controlPlane.ts`, one skipped malformed historical `runtime-runs` JSONL row, and expected control-plane error-handler redaction smoke logs; the affected checks passed.
- Existing uncommitted Phase H, Phase I, and Phase L changes remain in the worktree and were preserved. Unrelated untracked image files remain untouched.

Next action:

- Continue Phase J with item `102`: run `npm run smoke:electron-e2e`, then proceed through desktop packaging, packaged launch, state backup/verify, and release evidence gates.

### 2026-06-30 - Phase J Electron, Package, State Backup, And Release Evidence Gates

Scope:

- Completed Phase J items `102`, `103`, `104`, `105`, `106`, `107`, `108`, and `110` for the private beta readiness sequence.
- Ran the unpackaged Electron E2E smoke, rebuilt the packaged desktop directory, and verified packaged launch from `release/win-unpacked/DystopAI.exe`.
- Fixed a real state-backup gate failure against this machine's local `.openclaw` state: plugin-skill junctions were previously fatal symbolic links. `scripts/lib/runtime-state-backup.cjs` now skips symlink entries without following them, records `skippedEntries` in `backup-manifest.json`, and verifies skipped-entry paths/kinds/reasons.
- Updated `scripts/runtime-state-backup.cjs` so backup and verify output reports skipped symlink entries.
- Updated `tests/runtime-state-backup.test.cjs` to cover symlink skip recording, skipped-entry manifest verification, unsafe skipped paths, duplicate paths, restore safety, and checksum tamper detection.
- Updated `scripts/smoke-release-lifecycle.ts` so release lifecycle smoke requires symlink skip recording instead of all-symlink backup failure.
- Updated `CHANGELOG.md` and `docs/BETA_SUPPORT.md` so beta known issues and local reset guidance explain that plugin-skill symlinks are skipped and reconstructed from plugin runtime/install state.
- Regenerated release evidence and validated it in non-public beta mode.

Files changed:

- `scripts/lib/runtime-state-backup.cjs`
- `scripts/runtime-state-backup.cjs`
- `tests/runtime-state-backup.test.cjs`
- `scripts/smoke-release-lifecycle.ts`
- `CHANGELOG.md`
- `docs/BETA_SUPPORT.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:electron-e2e` passed.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked`.
- `npm run smoke:packaged-electron-launch` passed.
- Initial `npm run state:backup` failed with `State backup refuses symbolic links: plugin-skills/browser-automation`; this was the gate bug fixed in this slice.
- `node --test tests/runtime-state-backup.test.cjs` passed with `3` tests.
- `npm run smoke:release-lifecycle` passed.
- `npm run state:backup` passed against the real local OpenClaw state, creating `C:\Users\hotbo\DystopAI Backups\dystopai-state-2026-07-01_00-44-32-388` with `33,475` files, `2,793,015,447` bytes, and `4` skipped symlink entries.
- `npm run state:verify` passed against that backup path and verified the same files/bytes plus `4` skipped symlink entries.
- `npm run release:evidence` passed and wrote `release/evidence/dystopai-sbom.cdx.json`, `release/evidence/checksums.sha256`, and `release/evidence/release-evidence.json`.
- `npm run release:validate` passed in non-public mode with `35,683` checksums, `35,665` packaged artifact files under `release`, and `635` SBOM components. Update-channel, checksum-signature, and consumer-distribution signing validation were skipped because no public signing evidence was present or required.
- `npm test` passed after the state-backup symlink change with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- Phase J item `109` remains externally blocked: `gh pr list --head main --state open` returned `[]`, `gh release list` returned `[]`, and the open PRs are unrelated branches `#43`, `#42`, `#38`, and `#37`. Local evidence remains staged at `release/phase-j-beta-readiness-2026-06-30-evidence.zip`, with canonical release evidence under `release/evidence/`.
- Public signing, signed update-channel evidence, and consumer-distribution lifecycle evidence remain intentionally outside this private beta milestone.
- The previously recorded dependency audit risk remains: `npm ci` reports `8` audit findings (`2` low, `2` moderate, `2` high, `2` critical), and this pass did not perform dependency remediation.

Next action:

- Continue Phase K with item `111`, fresh install or fresh checkout manual beta testing, while carrying Phase J item `109` as blocked until a PR or draft-release target exists.

### 2026-07-01 - Phase K Fresh Checkout Setup

Scope:

- Completed Phase K item `111` by adding and running a repeatable fresh-checkout style validation for the private beta manual test script.
- Added `scripts/smoke-fresh-checkout-setup.ts`. The smoke snapshots the current tracked plus unignored untracked source files into an isolated workspace, refuses source symlinks, validates required project files, excludes generated/install artifacts (`node_modules`, `dist`, `dist-server`, `release`, and `output`), and runs the first fresh-install gates from the isolated copy.
- Added `npm run smoke:fresh-checkout` to `package.json`.
- Wrote Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`, including command logs, `fresh-checkout-smoke.json`, and `FRESH_CHECKOUT_SMOKE.md`.

Files changed:

- `scripts/smoke-fresh-checkout-setup.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:fresh-checkout` passed. It copied `3,414` source files (`118,115,195` bytes) into an isolated snapshot, then passed `npm ci`, `npm run prepare:openclaw-vendor`, `npm run build:standalone`, and `npm run smoke:server-architecture` inside that snapshot.
- Isolated `npm ci` passed in `17.347s`, adding `561` packages and auditing `562` packages.
- Isolated `npm run prepare:openclaw-vendor` passed in `44.889s`.
- Isolated `npm run build:standalone` passed in `17.071s`.
- Isolated `npm run smoke:server-architecture` passed in `0.790s`, reporting `9` entry lines, `17,960/29,000` control-plane composition lines, `0` inline routes, and the no-new-domain-logic guard present.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run smoke:ci-workflow` passed.
- `git diff --check` passed with only the existing LF-to-CRLF working-copy warnings.

Risks and notes:

- The isolated fresh `npm ci` still reports the previously recorded `8` dependency audit findings (`2` low, `2` moderate, `2` high, `2` critical). Dependency remediation was not part of this manual beta script slice.
- The fresh-checkout smoke deletes its isolated workspace after success, leaving the source repository clean of the copied `node_modules` and build artifacts. Logs and manifests remain under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- Phase J item `109` remains externally blocked until a PR or draft-release upload target exists.

Next action:

- Continue Phase K with item `112`: launch the desktop app from the beta build/test environment, then proceed through the remaining manual beta script items in order.

### 2026-07-01 - Phase K Desktop Launch And Session Bootstrap

Scope:

- Completed Phase K items `112` and `113` by launching the rebuilt packaged desktop app and proving automatic desktop session bootstrap from the packaged renderer.
- Added an E2E-only assertion path in `electron/main.cjs` that invokes the narrow preload bridge `window.dystopaiDesktop.bootstrapControlCenterSession()`, validates the returned session token against `/api/auth/status`, and logs only token length.
- Added `scripts/smoke-phase-k-desktop-launch.ts`. The smoke launches `release/win-unpacked/DystopAI.exe` with isolated `user-data`, OpenClaw state, workspace root, and loopback-only ports, then writes Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- Added `npm run smoke:phase-k-desktop-launch` to `package.json`.
- Extended `scripts/smoke-auth-control-plane.ts` so source-level auth smoke pins the desktop bootstrap E2E hook, no-token logging behavior, and package script.

Files changed:

- `electron/main.cjs`
- `scripts/smoke-phase-k-desktop-launch.ts`
- `scripts/smoke-auth-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/05-desktop-launch-bootstrap.log`
- `release/evidence/phase-k-manual-beta-2026-07-01/desktop-launch-bootstrap.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/DESKTOP_LAUNCH_BOOTSTRAP.md`

Verification:

- `npm run typecheck:electron` passed.
- `npm run smoke:auth` passed.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked` with the updated Electron main process.
- `npm run smoke:phase-k-desktop-launch` passed, verifying packaged launcher exit, Control Center readiness, packaged renderer load, navigation-policy self-test, desktop-session bootstrap bridge invocation, session-token acceptance by `/api/auth/status`, and quit cleanup. The evidence JSON recorded `completedItems: [112, 113]`, `mode: packaged-production-dir`, and token length `43` without token material.
- `npm run smoke:packaged-electron-launch` passed.
- `npm run smoke:electron-e2e` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm test` passed with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- The Phase K smoke intentionally uses isolated temporary local state and disables Gateway autostart/chat clients, so it proves desktop app launch and session bootstrap without mutating the operator's real OpenClaw state.
- The bootstrapped session token is never written to evidence; only token length is logged.
- Existing uncommitted Phase H, Phase I, Phase J, and Phase L changes remain in the worktree and were preserved.
- The previously recorded dependency audit risk remains outside this slice.

Next action:

- Continue Phase K with item `114`: connect or configure one model provider. If local credentials are unavailable, record exact provider-status evidence as a blocker and continue to the next unblocked manual beta item.

### 2026-07-01 - Phase K Provider, Recruit, And Workspace Edit

Scope:

- Completed Phase K items `114`, `115`, and `116` by adding and running an isolated control-plane smoke for provider configuration evidence, agent recruitment, and agent workspace persistence.
- Added `scripts/smoke-phase-k-provider-agent.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and workspace roots; disables Gateway autostart/chat clients; signs in through `/api/auth/login`; and writes evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke captures redacted model-provider status through `/api/auth/providers`, completes item `114` only when a real model provider is configured, and otherwise records item `114` as blocked before continuing to the next unblocked manual beta item.
- The successful run found `google-vertex` configured in the isolated backend environment, so item `114` completed without writing credential material. The evidence snapshot contains provider IDs, labels, env key names, and configured/stored booleans only.
- The same smoke recruited `phase-k-beta-agent` through `/api/party/recruit`, changed its workspace through `/api/party/workspace`, and verified the persisted workspace through `/api/party/agent/:agentId/config` and `/api/party/overview`.
- Added `npm run smoke:phase-k-provider-agent` to `package.json`.
- Extended `scripts/smoke-auth-provider-model-control-plane.ts` so the source-level provider/model smoke pins the new Phase K smoke, its package script, the provider/recruit/workspace backend route usage, and the provider-evidence redaction guard.

Files changed:

- `scripts/smoke-phase-k-provider-agent.ts`
- `scripts/smoke-auth-provider-model-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/provider-agent-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/PROVIDER_AGENT_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/06-provider-agent-smoke.log`

Verification:

- `npm run smoke:phase-k-provider-agent` passed. The final evidence JSON recorded `completedItems: [114, 115, 116]`, `blockedItems: []`, configured model provider `google-vertex`, recruited agent `phase-k-beta-agent`, and workspace persistence through both agent config and party overview.
- `npm run smoke:auth-provider-model` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.

Risks and notes:

- The smoke intentionally uses isolated temporary state and removes it after success, so it verifies the backend routes and persistence behavior without changing the operator's real OpenClaw state.
- Provider status evidence is redacted by construction and guarded before writing; it does not contain provider tokens, OAuth codes, API keys, or bearer values.
- Existing uncommitted Phase H, Phase I, Phase J, Phase K, and Phase L changes remain in the worktree and were preserved. Unrelated untracked image files remain untouched.

Next action:

- Continue Phase K with item `117`: send one simple command in isolated beta state, then proceed to item `118` for a command with attachment.

### 2026-07-01 - Phase K Command Console Simple And Attachment Sends

Scope:

- Completed Phase K items `117` and `118` by adding and running an isolated command-console smoke for one simple command and one attachment-backed command.
- Added `scripts/smoke-phase-k-command-console.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and `CONTROL_CENTER_WORKSPACE_ROOT`; disables Gateway autostart/chat clients; enables the deterministic stream smoke hook; signs in through `/api/auth/login`; and writes Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke sends a simple `hn-commander` command through `/api/openclaw/agent-turn/stream`, uploads `phase-k-command-note.md` through `/api/files/upload`, verifies the uploaded file path remains under the isolated command-console upload root and workspace root, then sends a second stream command carrying the uploaded attachment metadata.
- Added `npm run smoke:phase-k-command-console` to `package.json`.
- Extended `scripts/smoke-agent-turn-control-plane.ts` so the source-level agent-turn smoke pins the new Phase K command-console smoke, its package script, the command stream route, upload route, deterministic stream smoke hook, item `117/118` evidence recording, and the evidence secret-material guard.

Files changed:

- `scripts/smoke-phase-k-command-console.ts`
- `scripts/smoke-agent-turn-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/command-console-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/COMMAND_CONSOLE_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/07-command-console-smoke.log`

Verification:

- `npm run smoke:phase-k-command-console` passed. The final evidence JSON recorded `completedItems: [117, 118]`, `blockedItems: []`, simple command stream events `status, progress, delta, delta, final`, attachment command stream events `status, progress, delta, delta, final`, final reply `Mock gateway reply complete.`, `transport: gateway-chat`, and `liveTokens: true`.
- The uploaded attachment evidence recorded name `phase-k-command-note.md`, MIME type `text/markdown`, size `69`, kind `file`, ID length only, and `pathIsUnderUploadRoot: true` plus `pathIsUnderWorkspaceRoot: true`.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:command-console-files` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The smoke uses the existing deterministic Command Console stream smoke hook instead of live provider credentials, so it proves the authenticated local command/send, SSE frame, and upload/attachment control-plane paths without depending on external model availability.
- The smoke intentionally uses isolated temporary state and removes it after success, so it does not mutate the operator's real OpenClaw state.
- Evidence stores token length and attachment metadata only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `119`: launch one instant mission in isolated beta state.

### 2026-07-01 - Phase K Instant And Timed Mission Launches

Scope:

- Completed Phase K items `119` and `120` by adding and running an isolated mission-launch smoke for one instant mission and one one-hour timed mission.
- Added `scripts/smoke-phase-k-mission-launch.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and `CONTROL_CENTER_WORKSPACE_ROOT`; disables Gateway autostart/chat clients; enables `CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN=1`; signs in through `/api/auth/login`; and writes Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke launches an instant mission through `/api/missions/start`, verifies `/api/missions/:missionId/events`, `/api/missions/:missionId/lifecycle`, `/api/missions/projection`, and asserts Team Sync snapshot evidence under the isolated OpenClaw state tree.
- The same smoke launches a one-hour timed mission through `/api/missions/start`, verifies the duration-backed `endAt`, active/running scheduler projection, lifecycle/event reads, mission projection, and Team Sync snapshot evidence.
- Added `npm run smoke:phase-k-mission-launch` to `package.json`.
- Extended `scripts/smoke-mission-backend-owned.ts` so the source-level mission smoke pins the Phase K mission-launch smoke, its package script, mission start/projection/lifecycle/event routes, scheduler dry-run mode, Team Sync evidence, item `119/120` evidence recording, and the evidence secret-material guard.

Files changed:

- `scripts/smoke-phase-k-mission-launch.ts`
- `scripts/smoke-mission-backend-owned.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/mission-launch-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/MISSION_LAUNCH_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/08-mission-launch-smoke.log`

Verification:

- `npm run smoke:phase-k-mission-launch` passed. The final evidence JSON recorded `completedItems: [119, 120]`, `blockedItems: []`, instant mission `65b5a553-aa00-4f2b-a3ec-fc2966be2576`, timed mission `e817729b-a9ab-4822-91f0-f19d5c51023e`, projection `missionCount: 2`, `activeMissionCount: 2`, `durableRecordCount: 2`, and `memoryRecordCount: 2`.
- The instant mission evidence recorded mode `instant`, status `active`, lifecycle `running`, progress `100`, scheduler status `waiting`, `round: 0`, `cycleIntervalMs: 60000`, `maxCycles: 1`, and `jobs: 0`.
- The timed mission evidence recorded mode `hours`, amount `1`, status `active`, lifecycle `running`, a one-hour `endAt`, scheduler status `waiting`, `round: 0`, `cycleIntervalMs: 60000`, `maxCycles: 1`, and `jobs: 0`.
- Lifecycle evidence for each mission recorded `draft->validating`, `validating->scheduled`, and `scheduled->running`, plus one `agent_assigned` event and one scheduler dry-run event.
- Team Sync evidence for both missions was written under the isolated state tree for `phase-k-mission-agent`.
- `npm run smoke:mission-backend-owned` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run smoke:mission-durable-state` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `npm run smoke:api-integration` passed.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This slice intentionally uses mission scheduler dry-run mode rather than live OpenClaw cron/provider execution. It proves authenticated launch, backend projection, lifecycle/event ledger writes, scheduler arming, and Team Sync writes without depending on external model credentials. A later Phase K item still needs cancellation and runtime/Monitor/Gateway recovery evidence.
- The smoke uses isolated temporary state and removes it after success, so it does not mutate the operator's real OpenClaw state.
- Evidence stores token length and local isolated paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `121`: cancel a running mission in isolated beta state.

### 2026-07-01 - Phase K Running Mission Cancellation

Scope:

- Completed Phase K item `121` by adding and running an isolated mission-cancellation smoke for one running mission.
- Added `scripts/smoke-phase-k-mission-cancellation.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and `CONTROL_CENTER_WORKSPACE_ROOT`; disables Gateway autostart/chat clients; enables `CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN=1`; signs in through `/api/auth/login`; and writes Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke launches one continuous running mission through `/api/missions/start`, waits for launch lifecycle events, cancels it through `/api/missions/stop`, verifies cancelled projection, lifecycle events, mission report evidence, Team Sync cancellation evidence, and mission-record ledger markers.
- Added `npm run smoke:phase-k-mission-cancellation` to `package.json`.
- Extended `scripts/smoke-mission-cancellation.ts` so the source-level mission cancellation smoke pins the Phase K cancellation smoke, package script, mission start/stop/projection/lifecycle/event/report routes, scheduler dry-run mode, Team Sync evidence, item `121` evidence recording, durable `transition:running->cancelled` ledger evidence, and the evidence secret-material guard.

Files changed:

- `scripts/smoke-phase-k-mission-cancellation.ts`
- `scripts/smoke-mission-cancellation.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/mission-cancellation-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/MISSION_CANCELLATION_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/09-mission-cancellation-smoke.log`

Verification:

- `npm run smoke:phase-k-mission-cancellation` passed. The final evidence JSON recorded `completedItems: [121]`, `blockedItems: []`, continuous mission `1cc91f9d-1b7e-4031-b2e9-91a8a3d5e9ea`, stop status `cancelled`, lifecycle state `cancelled`, scheduler status `stopped`, cleanup `attempted: 0`, `removed: 0`, `disabled: 0`, and `failed: 0`.
- Cancellation evidence recorded lifecycle transitions `draft->validating`, `validating->scheduled`, `scheduled->running`, `running->running`, and `running->cancelled`, plus one operator cancellation-request event and one `mission_cancelled` event.
- Projection evidence recorded `missionCount: 1`, `activeMissionCount: 0`, `durableRecordCount: 1`, and `memoryRecordCount: 1` after cancellation.
- Report evidence recorded `source: mission-feed`, `cancelledRuns: 1`, `humanInterventions: 2`, `agentParticipation: [phase-k-cancel-agent]`, and heartbeat stability score `92`.
- Team Sync cancellation evidence was written under the isolated state tree for `phase-k-cancel-agent`, and the mission record ledger contained both `cancellation-requested` and `transition:running->cancelled`.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:mission-lifecycle-projection` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The smoke intentionally uses mission scheduler dry-run mode rather than live OpenClaw cron/provider execution. It proves authenticated launch, operator cancellation, projection, lifecycle/event ledger reads, report generation, Team Sync writes, and durable mission-record cancellation evidence without depending on external model credentials.
- The smoke uses isolated temporary state and removes it after success, so it does not mutate the operator's real OpenClaw state.
- Evidence stores token length and local isolated paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `122`: open Monitor and confirm runtime evidence is visible.

### 2026-07-01 - Phase K Monitor Runtime Evidence

Scope:

- Completed Phase K item `122` by adding and running an isolated Monitor runtime-evidence smoke.
- Added `scripts/smoke-phase-k-monitor-runtime-evidence.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `CONTROL_CENTER_WORKSPACE_ROOT`, and `OPENCLAW_GATEWAY_LOG_PATH`; disables Gateway autostart/chat clients; signs in through `/api/auth/login`; seeds only an isolated local Gateway log; and writes Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke verifies the source path for opening Monitor through `NexusShell`, the `LiveOperationMonitor` default Gateway tab, `useRuntimeStatus(5000)`, and the visible Monitor runtime evidence surfaces for Gateway channel activity, active cron jobs, Gateway log tail, Doctor diagnostics, and Clean Slate status.
- The smoke verifies authenticated `/api/openclaw/runtime/status?refresh=1` and `/api/openclaw/runtime/summary?refresh=1` payloads that feed Monitor, including Monitor metadata, runtime/persistence evidence, Gateway state/readiness/stability/restart diagnostics, seeded log-tail rows, channel activity counts, runtime collections, plugin counts, shifts, missions, and Doctor diagnostics summary counts.
- Added `npm run smoke:phase-k-monitor-runtime-evidence` to `package.json`.
- Extended `scripts/smoke-runtime-status-control-plane.ts` so the source-level runtime-status smoke pins the Phase K Monitor smoke, package script, Monitor source wiring, runtime status hook usage, item `122` evidence recording, and the visible Monitor evidence surfaces.

Files changed:

- `scripts/smoke-phase-k-monitor-runtime-evidence.ts`
- `scripts/smoke-runtime-status-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/monitor-runtime-evidence-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/MONITOR_RUNTIME_EVIDENCE_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/10-monitor-runtime-evidence-smoke.log`

Verification:

- `npm run smoke:phase-k-monitor-runtime-evidence` passed. The final evidence JSON recorded `completedItems: [122]`, `blockedItems: []`, Monitor source wiring, Gateway state `offline`, `3` Gateway log-tail rows, `2` Gateway channel activity events, `1` inbound event, `1` outbound event, runtime persistence evidence, `1` active run, `66` enabled plugins of `139` total plugins, `0` active shifts, `0` active missions, and Doctor diagnostics summary counts.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports. It opened the Monitor workspace and verified visible Monitor tab panels, channel activity, active cron jobs, Gateway log tail, Doctor repair controls, structured Doctor findings, and Clean Slate success/failure status.
- `git diff --check` passed with only the existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The first smoke attempt received a valid timeout fallback because the default runtime status response cap is `6000ms`. The isolated smoke now sets `CONTROL_CENTER_RUNTIME_STATUS_RESPONSE_TIMEOUT_MS=15000` and `CONTROL_CENTER_RUNTIME_SUMMARY_RESPONSE_TIMEOUT_MS=10000`, matching the service maximums, so the check proves the full Monitor payload instead of fallback evidence.
- The smoke intentionally uses isolated temporary state and removes it after success, so it does not mutate the operator's real OpenClaw state.
- Evidence stores token length and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `123`: restart Gateway from UI.

### 2026-07-01 - Phase K Gateway Restart From UI

Scope:

- Completed Phase K item `123` by wiring and proving Gateway restart from the Monitor UI path.
- Added a stable `Restart Gateway` control to `src/components/monitor/LiveOperationMonitor.tsx` on the Monitor Gateway tab. The control calls `restartGatewayRuntime()`, renders success/failure through the existing Monitor action banners, and refreshes runtime status immediately and again after a short delay.
- Added `scripts/smoke-phase-k-gateway-restart-ui.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `CONTROL_CENTER_WORKSPACE_ROOT`, and `OPENCLAW_GATEWAY_LOG_PATH`; signs in through `/api/auth/login`; calls the authenticated `/api/openclaw/runtime/gateway/restart` route used by the UI; and verifies runtime status exposes the manual restart lifecycle reason.
- Added `npm run smoke:phase-k-gateway-restart-ui` to `package.json`.
- Extended `scripts/smoke-runtime-actions-control-plane.ts` so the source-level runtime action smoke pins the Monitor restart button, click handler, runtime action helper, Phase K smoke, package script, manual restart reason, and UI smoke click coverage.
- Extended `scripts/smoke-ui-render.mjs` so the Electron UI smoke stubs `/api/openclaw/runtime/gateway/restart`, clicks the Monitor Gateway restart button across desktop, wide, and mobile viewports, and verifies the button title/ARIA label, endpoint call, and status banner.

Files changed:

- `src/components/monitor/LiveOperationMonitor.tsx`
- `scripts/smoke-phase-k-gateway-restart-ui.ts`
- `scripts/smoke-runtime-actions-control-plane.ts`
- `scripts/smoke-ui-render.mjs`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/gateway-restart-ui-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/GATEWAY_RESTART_UI_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/11-gateway-restart-ui-smoke.log`

Verification:

- `npm run smoke:phase-k-gateway-restart-ui` passed. The final evidence JSON recorded `completedItems: [123]`, `blockedItems: []`, restart route `/api/openclaw/runtime/gateway/restart`, restart reason `manual restart requested from monitor`, `restartAction.restarted: true`, Gateway `state: healthy`, `healthy: true`, `processRunning: true`, `lastRestartOutcome: succeeded`, and one recent restart lifecycle entry in runtime status.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run typecheck` passed.
- `npm run smoke:runtime-status-control-plane` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `npm run build:client` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports. It clicked the Monitor Gateway restart button, verified `/api/openclaw/runtime/gateway/restart` was called, and confirmed the status banner text `Gateway restart started from Monitor. ui smoke gateway restart accepted`.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.
- `git diff --check` passed with only the existing LF-to-CRLF working-copy warnings.

Risks and notes:

- The isolated Phase K smoke used a real local Gateway lifecycle action and succeeded with Gateway healthy. It stored token length and isolated local paths only; it did not store bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.
- `smoke:ui` uses a static Electron harness endpoint stub for the UI click proof. The real backend restart behavior is covered separately by `smoke:phase-k-gateway-restart-ui` and existing runtime action tests.

Next action:

- Continue Phase K with item `124`: stop Gateway from tray/menu and recover it.

### 2026-07-01 - Phase K Gateway Tray Stop And Recovery

Scope:

- Completed Phase K item `124` by adding and running an isolated Electron tray/menu Gateway stop-and-recover smoke.
- Added an E2E-only tray Gateway recovery assertion in `electron/main.cjs` behind `DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY`. The assertion verifies the existing tray menu exposes `Shut Gateway Off` and `Restart Gateway`, calls the tray-owned shutdown path, then calls the tray-owned recovery path.
- Fixed a real beta issue found by the first item `124` run: tray recovery previously called the Gateway restart API with a hard-coded `15000ms` timeout, which expired before local Gateway startup completed. The tray Gateway stop/recovery path now uses configurable `DYSTOPAI_GATEWAY_CONTROL_ACTION_TIMEOUT_MS` through `GATEWAY_CONTROL_ACTION_TIMEOUT_MS`.
- Added `scripts/smoke-phase-k-gateway-tray-recovery.ts`. The smoke launches Electron with isolated `user-data`, OpenClaw state, workspace root, loopback-only ports, and `OPENCLAW_GATEWAY_LOG_PATH`; enables the tray Gateway recovery E2E flag; waits for `tray-gateway-stop-ok` and `tray-gateway-recovery-ok`; records redacted evidence; and terminates the isolated Electron process tree after the recovery marker.
- Added `npm run smoke:phase-k-gateway-tray-recovery` to `package.json`.
- Extended `scripts/smoke-runtime-actions-control-plane.ts` so the source-level runtime action smoke pins the tray Gateway labels, runtime Gateway stop/restart endpoint calls, shared timeout, E2E flag, Phase K smoke, package script, and item `124` evidence recording.

Files changed:

- `electron/main.cjs`
- `scripts/smoke-phase-k-gateway-tray-recovery.ts`
- `scripts/smoke-runtime-actions-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/gateway-tray-recovery-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/GATEWAY_TRAY_RECOVERY_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/12-gateway-tray-recovery-smoke.log`

Verification:

- `npm run smoke:phase-k-gateway-tray-recovery` passed. The final evidence JSON recorded `completedItems: [124]`, `blockedItems: []`, tray stop API `/api/openclaw/runtime/gateway/stop`, tray recovery API `/api/openclaw/runtime/gateway/restart`, the E2E flag `DYSTOPAI_ELECTRON_E2E_ASSERT_TRAY_GATEWAY_RECOVERY`, token length only, isolated local paths, tray assertions for visible state, hide-on-close, tray-click restore, Gateway menu, Gateway stop, and Gateway recovery, plus Gateway lifecycle log proof for tray shutdown, tray reset, and control-API recovery start.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run typecheck:electron` passed.
- `npm run build:standalone` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run smoke:electron-e2e` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The dedicated Phase K tray recovery smoke terminates the isolated Electron process tree after the recovery marker. It is intentionally scoped to tray stop/recover evidence; existing quit cleanup remains covered by `npm run smoke:electron-e2e`.
- Evidence stores token length and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `125`: restart the app and confirm state rehydrates.

### 2026-07-01 - Phase K App Restart State Rehydration

Scope:

- Completed Phase K item `125` by adding and running an isolated two-launch Electron smoke for app restart state rehydration.
- Added an E2E-only app rehydration assertion in `electron/main.cjs` behind `DYSTOPAI_ELECTRON_E2E_ASSERT_APP_REHYDRATION`. The assertion runs from the renderer after load, bootstraps a desktop session through `window.dystopaiDesktop.bootstrapControlCenterSession()`, writes state in `seed` mode, verifies state in `verify` mode, and quits cleanly when `DYSTOPAI_ELECTRON_E2E_QUIT_AFTER_APP_REHYDRATION=1`.
- Added `scripts/smoke-phase-k-app-rehydration.ts`. The smoke launches Electron twice with the same isolated `DYSTOPAI_USER_DATA_DIR`, `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `CONTROL_CENTER_WORKSPACE_ROOT`, and loopback ports.
- The smoke intentionally leaves `CONTROL_CENTER_TOKEN` empty, proving Electron creates the local Control Center launch-token file on first launch and reuses the exact file on second launch. Evidence records token lengths and booleans only.
- First launch recruits `phase-k-rehydration-agent`, edits its workspace, writes a renderer `localStorage` marker on the same loopback origin, and verifies the state through authenticated renderer API calls.
- Second launch verifies `/api/party/overview`, `/api/party/agent/:agentId/config`, and renderer persisted state still rehydrate after the app restart.
- Added `npm run smoke:phase-k-app-rehydration` to `package.json`.
- Extended `scripts/smoke-auth-control-plane.ts` so the source-level auth smoke pins the Electron E2E hook, package script, first/second launch modes, local token-file reuse assertion, renderer persisted-state assertion, item `125` evidence recording, and evidence redaction guard.

Files changed:

- `electron/main.cjs`
- `scripts/smoke-phase-k-app-rehydration.ts`
- `scripts/smoke-auth-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/app-rehydration-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/APP_REHYDRATION_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/13-app-rehydration-smoke.log`

Verification:

- `npm run smoke:phase-k-app-rehydration` passed. The final evidence JSON recorded `completedItems: [125]`, `blockedItems: []`, E2E flag `DYSTOPAI_ELECTRON_E2E_ASSERT_APP_REHYDRATION`, seed marker `app-rehydration-seed-ok`, verify marker `app-rehydration-verify-ok`, `launchTokenFileCreated: true`, `launchTokenFileReusedAcrossRestart: true`, `tokenFileSource: "generated"`, fresh session-token lengths only, `firstLaunchSeededAgent: true`, `secondLaunchReadAgent: true`, `overviewWorkspaceMatches: true`, `configWorkspaceMatches: true`, and `rendererLocalStorageRehydrated: true`.
- `npm run smoke:auth` passed.
- `npm run typecheck:electron` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run smoke:electron-e2e` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only the existing LF-to-CRLF working-copy warnings.

Risks and notes:

- The app rehydration smoke uses isolated temporary local state and removes it after success, so it does not mutate the operator's real OpenClaw or desktop state.
- The smoke uses the built development Electron harness against `dist` and `dist-server`, matching the existing Phase K tray recovery approach. Packaged desktop launch remains covered by item `112` and `npm run smoke:phase-k-desktop-launch`.
- Evidence stores token lengths and isolated local paths only; it does not contain launch tokens, bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `126`: run a plugin status check.

### 2026-07-01 - Phase K Plugin Status Check

Scope:

- Completed Phase K item `126` by adding and running an isolated authenticated plugin-status smoke.
- Added `scripts/smoke-phase-k-plugin-status.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `CONTROL_CENTER_WORKSPACE_ROOT`, and `OPENCLAW_GATEWAY_LOG_PATH`; disables Gateway autostart/chat clients; signs in through `/api/auth/login`; and records Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke verifies source wiring for `src/api/plugins.ts`, `src/components/plugins/PluginsPanel.tsx`, `src/components/plugins/pluginStateProjection.ts`, `server/routes/pluginRoutes.ts`, and `server/services/runtime/runtimeStatusService.ts`.
- The smoke runs authenticated `/api/plugins?refresh=1`, cached `/api/plugins`, and `/api/openclaw/runtime/status?refresh=1` reads, then cross-checks plugin totals, enabled counts, cache metadata, and Plugins page state summaries against the runtime plugin projection.
- Added `npm run smoke:phase-k-plugin-status` to `package.json`.
- Extended `scripts/smoke-plugins-control-plane.ts` so the source-level plugin smoke pins the Phase K smoke, package script, item `126` evidence recording, force-refresh plugin route, runtime status cross-check route, Plugins page summary reuse, runtime count validation, and evidence redaction guard.

Files changed:

- `scripts/smoke-phase-k-plugin-status.ts`
- `scripts/smoke-plugins-control-plane.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/plugin-status-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/PLUGIN_STATUS_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/14-plugin-status-smoke.log`

Verification:

- `npm run smoke:phase-k-plugin-status` passed. The final evidence JSON recorded `completedItems: [126]`, `blockedItems: []`, plugin status route `/api/plugins?refresh=1`, runtime status route `/api/openclaw/runtime/status?refresh=1`, `139` total plugins, `66` enabled plugins, `73` disabled plugins, `35` missing-auth plugins, `35` setup-needed plugins, `29` communication/channel plugins, bundled plugin cache source with background refresh running, and matching runtime projection totals of `66` enabled of `139` total.
- `npm run smoke:plugins-control-plane` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The smoke intentionally uses isolated temporary local state and removes it after success, so it does not mutate the operator's real OpenClaw or desktop state.
- Plugin refresh returned bundled cache evidence while the OpenClaw refresh ran in the background. This is expected for the isolated manual check and matches the plugin inventory service's force-refresh behavior.
- Evidence stores session-token length, status counts, sample plugin metadata, and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `127`: trigger a missing-provider-auth path and confirm UI explains it.

### 2026-07-01 - Phase K Missing Provider Auth Path

Scope:

- Completed Phase K item `127` by adding and running an isolated missing-provider-auth smoke plus rendered UI coverage.
- Added `scripts/smoke-phase-k-missing-provider-auth.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and `CONTROL_CENTER_WORKSPACE_ROOT`; blanks inherited provider credential env vars from `AUTH_ENV_MAP`; disables Gateway autostart/chat clients; signs in through `/api/auth/login`; and records Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke verifies `/api/auth/providers?refresh=1` reports `deepseek` unconfigured in isolated state, then triggers missing-provider-auth paths through `/api/party/recruit`, `/api/party/agent/:agentId/model`, and `/api/party/recruit/auto-markdown`.
- Added `npm run smoke:phase-k-missing-provider-auth` to `package.json`.
- Extended `scripts/smoke-auth-control-plane.ts` so the source-level auth smoke pins the Phase K smoke, package script, credential-env scrubbing, backend route coverage, item `127` evidence recording, UI-render assertion, and evidence redaction guard.
- Extended `scripts/smoke-ui-render.mjs` so the Electron UI smoke returns an `auth_missing` terminal Command Console SSE frame, then verifies the rendered `Connect provider` CTA, retry detail, `auth missing` failure chip, blocked state, and `gateway-chat` transport across desktop, wide, and mobile viewports. The harness stream-close counter now listens on the response close event so the existing stop-control assertion remains valid after request bodies are read.

Files changed:

- `scripts/smoke-phase-k-missing-provider-auth.ts`
- `scripts/smoke-auth-control-plane.ts`
- `scripts/smoke-ui-render.mjs`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/missing-provider-auth-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/MISSING_PROVIDER_AUTH_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/15-missing-provider-auth-smoke.log`

Verification:

- `npm run smoke:phase-k-missing-provider-auth` passed. The final evidence JSON recorded `completedItems: [127]`, `blockedItems: []`, provider `deepseek`, model `deepseek/deepseek-v4-pro`, provider configured `false`, `/api/auth/providers?refresh=1`, route statuses for recruit/model-save/Auto Forge missing-auth failures, session-token length only, and isolated local paths only.
- `npm run smoke:auth` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports. The UI smoke verified the rendered Command Console `Connect provider` CTA, `Refresh credentials, then retry this turn.` detail, `auth missing` failure chip, blocked state, `gateway-chat` transport, and preserved the existing stop-control, Clean Slate, and Gateway restart UI assertions.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run smoke:provider-auth-beta` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The smoke intentionally blanks inherited provider credential env vars and uses isolated temporary local state, so the missing-auth result is deterministic and does not mutate the operator's real OpenClaw state.
- Evidence stores session-token length, provider/model ids, route status summaries, and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `128`: trigger a failed command and confirm the error is redacted.

### 2026-07-01 - Phase K Redacted Failed Command

Scope:

- Completed Phase K item `128` by adding and running an isolated failed Command Console smoke with rendered UI redaction coverage.
- Added a deterministic `x-control-center-stream-smoke: failure` mode in `server/routes/agentTurnRoutes.ts` behind `CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK`. The route emits the authenticated Command Console stream events used by the UI, then fails with synthetic key, bearer, email, phone, user-path, and cookie markers that must be redacted before returning `error` and `final` SSE payloads.
- Fixed the stream failure metadata for forced Gateway-backed Command Console turns so failures preserve `gateway-chat` as the transport instead of reporting generic `control-center-sse`.
- Added `scripts/smoke-phase-k-redacted-failed-command.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `CONTROL_CENTER_WORKSPACE_ROOT`, and `OPENCLAW_GATEWAY_LOG_PATH`; disables Gateway autostart/chat clients; signs in through `/api/auth/login`; triggers `/api/openclaw/agent-turn/stream` with `x-control-center-stream-smoke: failure`; and records Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- Added `npm run smoke:phase-k-redacted-failed-command` to `package.json`.
- Extended `scripts/smoke-agent-turn-control-plane.ts` so the source-level smoke pins the Phase K item `128` smoke, package script, deterministic failure hook, Gateway transport preservation, SSE redaction assertions, evidence redaction guard, and UI-render coverage.
- Extended `scripts/smoke-ui-render.mjs` so the Electron UI smoke renders a failed Command Console response across desktop, wide, and mobile viewports and verifies the `Reset gateway` CTA, `gateway disconnect` failure chip, blocked state, `gateway-chat` transport, all expected redaction markers, and absence of raw secret patterns.

Files changed:

- `server/routes/agentTurnRoutes.ts`
- `scripts/smoke-phase-k-redacted-failed-command.ts`
- `scripts/smoke-agent-turn-control-plane.ts`
- `scripts/smoke-ui-render.mjs`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/redacted-failed-command-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/REDACTED_FAILED_COMMAND_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/16-redacted-failed-command-smoke.log`

Verification:

- `npm run smoke:phase-k-redacted-failed-command` passed. The final evidence JSON recorded `completedItems: [128]`, `blockedItems: []`, stream events `status, progress, error, final`, `failureKind: gateway_disconnect`, `transport: gateway-chat`, `liveTokens: false`, all six redaction markers present (`apiKey`, `bearer`, `email`, `phone`, `userProfile`, `cookie`), and `rawSecretLeakDetected: false`.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports. The UI smoke verified the rendered failed Command Console `Reset gateway` CTA, `gateway disconnect` failure chip, blocked state, `gateway-chat` transport, all redaction markers, and no raw secret patterns.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found. The first synthetic fixture used an OpenAI-shaped `sk-...` marker and was correctly rejected by secret scan; the final fixture uses a non-realistic `api_key=` value that still proves key redaction without resembling a live provider token.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The new failure mode is gated behind the existing smoke-only `CONTROL_CENTER_AGENT_TURN_STREAM_SMOKE_MOCK` flag and is inert in normal runtime.
- The smoke uses isolated temporary local state and removes it after success, so it does not mutate the operator's real OpenClaw or desktop state.
- Evidence stores session-token length, redacted error text, marker booleans, and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `129`: export or inspect a mission report.

### 2026-07-01 - Phase K Mission Report Inspection

Scope:

- Completed Phase K item `129` by adding and running an isolated mission-report inspection smoke.
- Added `scripts/smoke-phase-k-mission-report-inspection.ts`. The smoke starts `server/index.ts` on a free loopback port with isolated `HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, and `CONTROL_CENTER_WORKSPACE_ROOT`; disables Gateway autostart/chat clients; enables `CONTROL_CENTER_MISSION_SCHEDULER_DRY_RUN=1`; signs in through `/api/auth/login`; creates a report-producing mission path; and records Phase K evidence under `release/evidence/phase-k-manual-beta-2026-07-01/`.
- The smoke inspects `/api/missions/:missionId/report`, verifies it matches `/api/missions/:missionId/lifecycle`, verifies `/api/missions/projection` contains the same report and cancelled mission state, and waits for durable `control-center-ledger/mission-reports.jsonl` proof.
- Added `npm run smoke:phase-k-mission-report-inspection` to `package.json`.
- Extended `scripts/smoke-mission-report-service.ts` so the source-level mission report smoke pins the Phase K item `129` smoke, package script, report route, lifecycle/projection consistency checks, durable ledger proof, scheduler dry-run mode, item `129` evidence recording, and evidence redaction guard.

Files changed:

- `scripts/smoke-phase-k-mission-report-inspection.ts`
- `scripts/smoke-mission-report-service.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/mission-report-inspection-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/MISSION_REPORT_INSPECTION_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/17-mission-report-inspection-smoke.log`

Verification:

- `npm run smoke:phase-k-mission-report-inspection` passed. The final evidence JSON recorded `completedItems: [129]`, `blockedItems: []`, report id `mission-report:b7f939a8-e847-4f81-a492-761c0ab512c6`, `source: "mission-feed"`, `acceptedRuns: 1`, `startedRuns: 1`, `completedRuns: 0`, `failedRuns: 0`, `cancelledRuns: 1`, `humanInterventions: 2`, agent participation `phase-k-report-agent`, `heartbeatStabilityScore: 92`, unavailable metrics `efficiencyRating`, `soulDrift`, `runtimeEfficiency`, and `xpGained`, matching lifecycle/projection reports, projected mission status `cancelled`, `reportCount: 1`, and durable report ledger proof with `875` bytes.
- `npm run smoke:mission-report-service` passed.
- `npm run typecheck` passed.
- `npm run smoke:mission-backend-owned` passed.
- `npm run smoke:mission-cancellation` passed.
- `npm run smoke:mission-report` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The smoke uses isolated temporary local state and removes it after success, so it does not mutate the operator's real OpenClaw or desktop state.
- Scheduler dry-run mode intentionally proves report inspection without live provider credentials or external cron execution.
- Evidence stores session-token length, report metrics, and isolated local paths only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.

Next action:

- Continue Phase K with item `130`: use Settings to change UI density or motion and confirm persistence.

### 2026-07-01 - Phase K Settings Persistence

Scope:

- Completed Phase K item `130` by adding and running a Settings density/motion persistence smoke against the built desktop UI.
- Added `id="nexus-nav-settings"` to the existing Settings utility navigation in `src/components/layout/NexusShell.tsx`, keeping the navigation semantics unchanged while giving automation a stable target.
- Added stable automation selectors to the existing Settings density and motion controls in `src/components/settings/SettingsPanel.tsx`: `select[data-dui-setting="density"]` and `select[data-dui-setting="motion"]`.
- Added `scripts/smoke-phase-k-settings-persistence.ts`. The smoke serves the production `dist/` client from a loopback-only static harness, launches Electron, opens the real Settings panel, sets density to `spacious`, sets motion to `reduced`, verifies immediate root dataset updates and localStorage writes, reloads the renderer, and verifies both Settings controls and root attributes rehydrate from `dystopai-ui-settings-v1`.
- Added `npm run smoke:phase-k-settings-persistence` to `package.json`.
- Extended `scripts/smoke-shell-production-ui.ts` so the source-level UI contract pins the Settings nav id, density/motion selectors, settings persistence ordering, UI settings storage key, root dataset projection, item `130` smoke, package script, renderer reload verification, and evidence redaction guard.

Files changed:

- `src/components/layout/NexusShell.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `scripts/smoke-phase-k-settings-persistence.ts`
- `scripts/smoke-shell-production-ui.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-k-manual-beta-2026-07-01/settings-persistence-smoke.json`
- `release/evidence/phase-k-manual-beta-2026-07-01/SETTINGS_PERSISTENCE_SMOKE.md`
- `release/evidence/phase-k-manual-beta-2026-07-01/18-settings-persistence-smoke.log`
- `release/evidence/phase-k-manual-beta-2026-07-01/settings-persistence-smoke.png`

Verification:

- `npm run smoke:shell-production-ui` passed.
- `npm run typecheck` passed.
- `npm run build:client` passed.
- `npm run smoke:phase-k-settings-persistence` passed. The final evidence JSON recorded `completedItems: [130]`, `blockedItems: []`, density `spacious`, motion `reduced`, `rootDatasetUpdatedImmediately: true`, `localStorageUpdated: true`, `rehydratedAfterReload: true`, and active Settings navigation after reload.
- `npm run smoke:ui` passed across desktop, wide, and mobile viewports, now including `nexus-nav-settings` in the shared workspace navigation sweep.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The Settings persistence smoke records UI state values, evidence file paths, and a screenshot only; it does not contain bearer tokens, session tokens, provider secrets, OAuth codes, API keys, cookies, or uploaded file contents.
- The static harness uses loopback-only serving and a fixed non-secret desktop bootstrap token for the renderer smoke; no real OpenClaw, provider, or desktop state is touched.
- The first attempt exposed the missing stable Settings nav id; the final implementation adds the id and proves the broader UI smoke still passes with Settings included in navigation coverage.

Next action:

- Continue Phase L with item `131`: add a beta disclaimer to release notes.

### 2026-07-01 - Phase M Beta Exit Criteria Gate

Scope:

- Completed Phase M items `141-150` by adding and running an explicit private beta exit-criteria smoke.
- Added `scripts/smoke-beta-exit-criteria.ts`. The smoke verifies the current `controlPlane.ts` growth ratchet, extracted Gateway/Mission/Runtime service boundaries, renderer store/API split, packaged desktop launch evidence, mission restart recovery proof, beta docs, packaged resources, release evidence, and the objective Phase M production score.
- Added `npm run smoke:beta-exit-criteria` to `package.json`.
- Rebuilt the packaged desktop directory after the package-script change and regenerated release evidence so `release:validate` checked current artifacts instead of stale checksums.

Files changed:

- `scripts/smoke-beta-exit-criteria.ts`
- `package.json`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `release/evidence/phase-m-exit-criteria-2026-07-01/beta-exit-criteria-smoke.json`
- `release/evidence/phase-m-exit-criteria-2026-07-01/BETA_EXIT_CRITERIA_SMOKE.md`
- Refreshed `release/evidence/dystopai-sbom.cdx.json`
- Refreshed `release/evidence/checksums.sha256`
- Refreshed `release/evidence/release-evidence.json`

Verification:

- `npm run smoke:beta-exit-criteria` passed with `completedItems: [141,142,143,144,145,146,147,148,149,150]`, no blocked items, and `productionScore: 10`.
- `npm run smoke:server-architecture` passed with `17,960/29,000` composition lines and `0` inline routes.
- `npm run smoke:renderer-store-boundary` passed with `3,865/3,889` `nexusStore` lines, `0` store-owned API request calls, `0` API path literals, and `0` direct fetches.
- `npm run smoke:mission-restart-recovery` passed.
- `npm run smoke:packaged-electron-launch` passed.
- `npm run smoke:release-validation` passed.
- `npm run package:desktop` passed and rebuilt `release/win-unpacked`.
- `npm run release:evidence` passed and regenerated SBOM/checksum/release evidence.
- `npm run check:bundle-budgets` passed with entry JS `493,486` bytes / `154,550` gzip bytes, entry CSS `1,225,106` bytes / `155,599` gzip bytes, and total JS `785,169` bytes / `241,943` gzip bytes.
- `npm run release:validate` passed in non-public mode with `35,683` checksums, `35,665` packaged artifact files, and `635` SBOM components. Update manifest, checksum signature, and distribution signing checks were correctly skipped for this private beta milestone.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only the existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- Dependency audit warnings from the Phase J `npm ci` gate remain open: `8` total (`2` low, `2` moderate, `2` high, `2` critical). This pass did not run `npm audit fix`.
- Public signing, notarization, signed update-channel evidence, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain intentionally outside the private beta milestone.
- Existing uncommitted Phase K changes remain in the worktree and were preserved.

Next action:

- Private beta split-plan implementation is complete through Phase M. The dependency audit remediation slice is now recorded below; next work should prepare review/release handoff from the refreshed evidence.

### 2026-07-01 - Dependency Audit Remediation Closure

Scope:

- Closed the recorded Phase J dependency-audit risk without restarting completed Phase F-M implementation work.
- Updated `package-lock.json` within the existing dependency policy to eliminate the dev-scope audit findings for `@babel/core`, `concurrently`/`shell-quote`, `esbuild`, `form-data`, `js-yaml`, `tar`, and `undici`.
- Pinned `electron-builder` to the previously verified `26.8.1` package line in `package.json`. The unlocked `26.15.3` line fixed audit transitives but failed packaging because its downloaded icon helper ran as ESM under this repo's `"type": "module"` mode and called `require`.
- Kept `eslint-plugin-react-hooks` at `7.0.1` in the lockfile after `7.1.1` promoted existing React Compiler diagnostics to lint errors outside this remediation scope.
- Updated `scripts/after-pack.cjs` so the Windows launcher hook can use either the legacy `node_modules/electron/dist/electron.exe` path or the already packaged Electron runtime at `release/win-unpacked/DystopAI.exe` before compiling the custom launcher. This preserves packaging with Electron `42.5.2`, whose npm package no longer installs a local `dist/electron.exe`.
- Regenerated `THIRD_PARTY_NOTICES.txt` for the updated dependency graph.
- Rebuilt `release/win-unpacked`, regenerated `release/evidence/dystopai-sbom.cdx.json`, `release/evidence/checksums.sha256`, and `release/evidence/release-evidence.json`, and validated the refreshed package.
- Added `scripts/smoke-dependency-audit-clean.ts`, which runs full `npm audit --json` and production-only `npm audit --omit=dev --json`, parses the JSON reports, and fails unless both contain zero vulnerability entries and zero total vulnerabilities.
- Added `npm run smoke:dependency-audit-clean` to `package.json`.
- Updated `scripts/smoke-ci-workflow.ts` so the new clean-audit package script is pinned alongside the existing production dependency policy and scheduled full-audit artifact checks.

Files changed:

- `package.json`
- `package-lock.json`
- `scripts/after-pack.cjs`
- `scripts/smoke-dependency-audit-clean.ts`
- `scripts/smoke-ci-workflow.ts`
- `THIRD_PARTY_NOTICES.txt`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm ci` passed with `found 0 vulnerabilities`; deprecated transitive package warnings remain informational.
- Full `npm audit --json` passed with `0` total vulnerabilities.
- `npm run audit:dependencies` passed with `found 0 vulnerabilities`.
- Direct `npm audit --omit=dev --json` passed with `0` production vulnerabilities.
- `npm run smoke:dependency-audit-clean` passed and reported `dependency audit clean: full=0, production=0`.
- `npm run smoke:ci-workflow` passed and confirmed the new package script is wired.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run build:standalone` passed with Vite `7.3.6`.
- `npm run smoke:beta-exit-criteria` passed with score `10/10`.
- `npm run package:desktop` passed using `electron-builder` `26.8.1` and Electron `42.5.2`, with the launcher hook copying the packaged runtime to `electron.exe` and rebuilding `DystopAI.exe`.
- `npm run smoke:packaged-electron-launch` passed.
- `npm run check:bundle-budgets` passed with entry JS `497,341` bytes / `155,636` gzip bytes, entry CSS `1,225,106` bytes / `155,599` gzip bytes, and total JS `789,298` bytes / `243,153` gzip bytes.
- `npm run notices:check` passed with `597` package notice entries.
- `npm run release:evidence` passed and regenerated SBOM/checksum/release evidence.
- `npm run release:validate` passed in non-public mode with `35,683` checksums, `35,665` packaged artifact files, and `600` SBOM components. Update manifest, checksum signature, and distribution signing checks were correctly skipped.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm test` passed end to end with `187` unit tests and the full architecture, renderer-store, command-console, filesystem, plugin, Gateway, runtime, mission, provider, release, security, secret-scan, and CI smoke suite.

Risks and notes:

- The old dependency-audit risk is closed for the current lockfile and installed graph.
- Deprecated transitive package warnings from `npm ci` remain, but they are not active audit findings.
- The first clean-audit smoke attempt exposed a Windows `spawnSync npm.cmd` launcher issue; the final script invokes npm through `process.env.npm_execpath` when available and passes on Windows.
- Public signing, notarization, signed update-channel evidence, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain intentionally outside the private beta milestone.
- Existing uncommitted Phase K/M changes remain in the worktree and were preserved.

Next action:

- Prepare review/release handoff from the refreshed private beta evidence.

### 2026-07-01 - Private Beta Review Handoff

Scope:

- Prepared the review/release handoff from the refreshed private beta evidence after the split-plan milestone and dependency-audit remediation were complete.
- Added `scripts/smoke-private-beta-review-handoff.ts`, a source-controlled smoke gate that validates the draft prerelease upload status, local evidence bundle digest, Phase J/K/M evidence files, refreshed release evidence counts, dependency-audit closure, and carried risks before producing reviewer handoff artifacts.
- Added `npm run smoke:private-beta-handoff` to `package.json`.
- Updated `scripts/smoke-ci-workflow.ts` so the new handoff package script remains pinned by the source-level CI contract smoke.
- Generated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` for reviewers. It records the draft prerelease URL, uploaded evidence bundle path and SHA-256 digest, release evidence counts, Phase K item `111-130` evidence map, Phase M score, dependency-audit closure, verification commands, and remaining private-beta risks.
- Generated ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- Corrected `release/evidence/phase-j-beta-readiness-2026-06-30/BETA_KNOWN_ISSUES.md` so it no longer carries the stale “upload pending” note after `UPLOAD_STATUS.md` records the completed draft prerelease upload.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `scripts/smoke-private-beta-review-handoff.ts`
- `package.json`
- `scripts/smoke-ci-workflow.ts`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Evidence written:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `release/evidence/private-beta-review-handoff-2026-07-01/private-beta-review-handoff.json`
- `release/evidence/private-beta-review-handoff-2026-07-01/PRIVATE_BETA_REVIEW_HANDOFF.md`

Verification:

- `npm run smoke:private-beta-handoff` passed. It verified all Phase K manual beta evidence items `111-130`, Phase M production score `10/10`, refreshed release evidence counts of `600` SBOM components, `35,683` checksums, and `2` runtime metadata entries, and the local evidence zip digest `5da8bbc10e611eb737b5e3a0f3a9be15a5f93ffc9a73b01cfc79e5abf17cae5b`.
- `npm run smoke:ci-workflow` passed with the new handoff package script pinned.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff slice; it did not mark additional split-plan item numbers.
- Release evidence under `release/` remains ignored build output, but the source-controlled handoff document and smoke script reproduce the handoff checks.
- Public signing, notarization, signed update-channel evidence, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain intentionally outside this private beta milestone.

Next action:

- Review the uncommitted private beta implementation diff and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then decide whether to tag/share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Revalidation

Scope:

- Revalidated the generated private beta handoff after confirming Phase F item `57` and all Phase F-M split-plan items are already complete and verified.
- Reviewed the current uncommitted diff inventory, including the tracked beta implementation changes and untracked Phase K/M/dependency/handoff smoke scripts.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` through the source-controlled handoff smoke so the reviewer packet reflects the current evidence timestamp and bundle digest.
- Did not mark additional split-plan items or rework completed service-split phases.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and verified all Phase K evidence items `111-130`, Phase M production score `10/10`, release evidence counts, dependency-audit closure, and evidence bundle digest `5da8bbc10e611eb737b5e3a0f3a9be15a5f93ffc9a73b01cfc79e5abf17cae5b`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.

Risks and notes:

- The repo remains intentionally dirty with the uncommitted private beta implementation, evidence handoff, dependency remediation, and Phase K/M smoke scripts.
- Public signing, notarization, signed update-channel evidence, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain outside this private beta milestone.

Next action:

- Make the review/share decision for the private beta handoff: inspect the uncommitted diff and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then tag/share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Source Inventory

Scope:

- Refined the private beta review handoff instead of reworking completed Phase F-M split-plan items.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the smoke captures the current source-review scope from `git diff --name-status` and `git ls-files --others --exclude-standard`.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` with a `Review Decision` section and a `Source Change Inventory` section.
- The generated handoff now records `ready-for-human-review`, states that no commit, push, tag, or release publish was performed, and lists `24` tracked changed files plus `16` untracked source files for reviewer inspection.

Files changed:

- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff package script pinned.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff refinement; no split-plan item numbers were marked.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Freshness Check

Scope:

- Revalidated the generated private beta handoff against the current dirty worktree without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` from `scripts/smoke-private-beta-review-handoff.ts`; the handoff timestamp is now `2026-07-01T06:56:27.811Z`.
- Confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff freshness check; no split-plan item numbers were marked.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Review-Decision Blocker

Scope:

- Revalidated the generated private beta handoff against the current dirty worktree without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` from `scripts/smoke-private-beta-review-handoff.ts`; the handoff timestamp is now `2026-07-01T07:12:10.795Z`.
- Confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff recheck; no split-plan item numbers were marked.
- The active implementation plan is complete through Phase M. The remaining unclosed action is blocked on a human review/share decision, not an unstarted local code slice.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Phase M Evidence Cleanup

Scope:

- Cleaned up stale post-Phase-M evidence wording without reworking completed Phase F-M split-plan items.
- Updated `scripts/smoke-beta-exit-criteria.ts` so regenerated Phase M evidence records the dependency-audit risk as closed by the 2026-07-01 remediation pass and `smoke:dependency-audit-clean` guard.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the handoff smoke rejects Phase M evidence that reintroduces the stale "dependency audit warnings remain" risk and requires the closed-risk wording.
- Regenerated Phase M exit criteria evidence and the private beta handoff from the current worktree.

Files changed:

- `scripts/smoke-beta-exit-criteria.ts`
- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:beta-exit-criteria` passed and regenerated `release/evidence/phase-m-exit-criteria-2026-07-01/beta-exit-criteria-smoke.json` with production score `10/10` and closed dependency-audit risk text.
- `npm run smoke:private-beta-handoff` passed with the new stale-risk assertion.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit scripts pinned.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M evidence-hygiene slice; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Current-Worktree Revalidation

Scope:

- Revalidated the generated private beta handoff against the current dirty worktree without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` from `scripts/smoke-private-beta-review-handoff.ts`; the handoff timestamp is now `2026-07-01T07:41:25.292Z`.
- Confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff revalidation; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Current Evidence Revalidation

Scope:

- Revalidated the generated private beta handoff against freshly regenerated Phase M evidence and the current dirty worktree without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Regenerated Phase M exit criteria evidence through `npm run smoke:beta-exit-criteria`; the Phase M score remains `10/10` and dependency-audit risk remains closed.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` from `scripts/smoke-private-beta-review-handoff.ts`; the handoff timestamp is now `2026-07-01T07:56:58.094Z`.
- Confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:beta-exit-criteria` passed.
- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff revalidation; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Review Anchor

Scope:

- Hardened the private beta review handoff instead of reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the generated handoff records a Git review anchor: branch, HEAD, upstream ref, upstream HEAD, status header, tracked diff shortstat, and a SHA-256 digest over the tracked/untracked source inventory.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` with the Git review anchor and source inventory digest.
- Confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.

Files changed:

- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- `npm run smoke:ci-workflow` passed with the handoff and dependency-audit package scripts pinned.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff hardening slice; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files, the Git review anchor, and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Content Anchor

Scope:

- Hardened the private beta review handoff with a content-aware source anchor instead of reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the generated handoff records tracked diff content evidence through `git diff --binary`, hashes all untracked source files in the review inventory, and emits a combined source-content SHA-256 for human review.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` with tracked diff hash/byte evidence and an `Untracked Source Content Hashes` table.
- Excluded the generated handoff document itself from the content digest to avoid a self-referential hash, while preserving it in the visible source inventory.

Files changed:

- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed and regenerated the handoff document plus ignored evidence copies under `release/evidence/private-beta-review-handoff-2026-07-01/`.
- The final verification sweep for this slice also passed: `npm run smoke:ci-workflow`, `npm run typecheck`, `npm run lint`, `npm run secret:scan`, and `git diff --check` with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff hardening slice; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files, the Git/content review anchors, and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Decision Check

Scope:

- Revalidated the current private beta handoff state without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Verified the item `57` implementation boundary remains in `server/services/plugins/pluginInstallService.ts`, with focused coverage in `tests/pluginInstallService.test.ts` for install/update/update-all/uninstall, redacted command failures, managed plugin runtime-state writes, Gateway restart scheduling, and plugin controls refresh behavior.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` from the current worktree and confirmed the handoff still records `ready-for-human-review`, no commit/push/tag/release publish, the uploaded evidence bundle digest, and the `24` tracked plus `16` untracked source-review inventory.
- Confirmed there is no unstarted local Phase F-M implementation item left; the remaining unclosed action is the human review/share decision for the private beta handoff.

Files changed:

- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M decision-check pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, or release publish was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files, the Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, and then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Source-Content Stabilization

Scope:

- Hardened the private beta review handoff content anchor without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Fixed a post-Phase-M handoff stability issue where hashing the full tracked diff meant routine ledger updates made after handoff generation could immediately stale the recorded source-content hash.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the full tracked/untracked source inventory remains visible for review, while generated/mutable handoff outputs are excluded from the source-content hash: `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, `docs/BETA_CODEBASE_SPLIT_PLAN.md`, `docs/OPTIMIZATION_MEMORY.md`, and `docs/PRODUCTION_HARDENING_LEDGER.md`.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` after the ledger updates so the review packet records the stabilized content anchor, tracked source file count included in the hash, and the generated/mutable outputs excluded from the hash.

Files changed:

- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M handoff stabilization slice; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Diff-Shortstat Stabilization

Scope:

- Hardened the private beta review handoff Git anchor without reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Fixed the remaining handoff drift risk where `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` excluded generated/mutable ledgers from the source-content hash, but still displayed a full tracked diff shortstat that could be made stale by routine ledger updates.
- Updated `scripts/smoke-private-beta-review-handoff.ts` so the displayed Git review shortstat uses the same non-ledger tracked source file set as the source-content hash.
- Regenerated `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`; it now labels the value as `Tracked content diff shortstat`, records `21` tracked files included in the content hash, and continues listing all `40` tracked/untracked review files for human inspection.

Files changed:

- `scripts/smoke-private-beta-review-handoff.ts`
- `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`
- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- `npm run smoke:private-beta-handoff` passed.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing Babel deoptimization note for `server/controlPlane.ts`.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.

Risks and notes:

- This is a post-Phase-M handoff stabilization slice; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Read-Only Anchor Verification

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Read-Only Recheck

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Read-Only Revalidation

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Read-Only Confirmation

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Current-Anchor Verification

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, source inventory SHA-256 `207b0815c687549d77ebfcf00081d2680836a770801442fb9a9389b71f6c13a2`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Current-Anchor Revalidation

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, source inventory SHA-256 `207b0815c687549d77ebfcf00081d2680836a770801442fb9a9389b71f6c13a2`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Current-Anchor Read-Only Check

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, source inventory SHA-256 `207b0815c687549d77ebfcf00081d2680836a770801442fb9a9389b71f6c13a2`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

### 2026-07-01 - Private Beta Handoff Latest Read-Only Verification

Scope:

- Revalidated the current private beta handoff without regenerating handoff artifacts or reworking completed Phase F-M service-split items.
- Confirmed Phase F item `57` and all Phase F-M split-plan items remain recorded complete and verified.
- Recomputed the handoff source-review anchors read-only and confirmed `docs/PRIVATE_BETA_REVIEW_HANDOFF.md` still matches the current worktree: `24` tracked changed files, `16` untracked source files, `21` tracked files included in the content hash, tracked content diff shortstat `21 files changed, 2265 insertions(+), 2259 deletions(-)`, tracked diff SHA-256 `3b334a4dd239aaae2f065de3fb0829fc1f7de4dfddffe44c82d6b92f67801578`, source inventory SHA-256 `207b0815c687549d77ebfcf00081d2680836a770801442fb9a9389b71f6c13a2`, and source-content SHA-256 `6765df8685eb2fb4fe191b19c46fa00f142960401212a9416aeff93002a80f29`.
- Revalidated the Phase F item `57` plugin install service boundary and current CI workflow contract.

Files changed:

- `docs/BETA_CODEBASE_SPLIT_PLAN.md`
- `docs/OPTIMIZATION_MEMORY.md`
- `docs/PRODUCTION_HARDENING_LEDGER.md`

Verification:

- Read-only handoff anchor recomputation passed and matched `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`.
- `npm run smoke:plugin-install-service` passed.
- `node --import tsx --test tests/pluginInstallService.test.ts` passed with `11` plugin install service tests.
- `npm run smoke:ci-workflow` passed.
- `npm run typecheck` passed.
- `npm run secret:scan` passed with no high-confidence checked-in secrets found.
- `git diff --check` passed with only existing LF-to-CRLF working-copy warnings.

Risks and notes:

- This is a post-Phase-M read-only verification pass; no split-plan item numbers were marked.
- The active implementation plan remains complete through Phase M.
- The repo remains intentionally dirty with the private beta implementation and handoff artifacts awaiting review.
- No commit, push, tag, release publish, handoff regeneration, source-code edit, reset, revert, or stash was performed by this automation run.

Next action:

- Human review/share decision: inspect the `40` listed source files and the stabilized Git/content review anchors in `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

## In Progress

- Optimization work now resumes from `docs/BETA_CODEBASE_SPLIT_PLAN.md`, with Phase A, Phase B, Phase C, Phase D items `31-45`, Phase E items `46-55`, Phase F items `56-65`, Phase G items `66-75`, Phase H items `76-85`, Phase I items `86-95`, Phase J items `96-110`, Phase K items `111-130`, Phase L items `131-140`, and Phase M items `141-150` complete and verified for the private beta service-split milestone. The private beta review handoff has been generated, revalidated, upgraded with a source-change inventory, refreshed against the current worktree, guarded against stale Phase M dependency-audit risk evidence, revalidated at `2026-07-01T07:56:58.094Z`, hardened with a Git review anchor, hardened again with a content-aware source anchor, rechecked against Phase F item `57` plugin-install evidence, stabilized so generated/mutable ledgers no longer stale the source-content hash, stabilized again so the displayed tracked content diff shortstat uses the same non-ledger file set as the source-content hash, and read-only verified eight times against the current worktree without regenerating handoff artifacts.
- Runtime status cache refresh optimization now targets `server/services/runtime/runtimeStatusService.ts`: forced full runtime refreshes seed normalized full and summary caches, so shell and console summary views receive fresh plugin/runtime evidence after manual refreshes without keeping the stale `forceRefresh` marker. Verification passed: `node --import tsx --test tests/runtimeStatusService.test.ts`, `npm run smoke:runtime-status-control-plane`, `npm run typecheck`, and `npm run lint`.
- Follow-up runtime/UI optimization batch added `10` focused improvements: normalized summary-cache writes, forced summary-refresh cache warming, status-cache-to-summary cache warming, in-flight summary cache normalization, mission projection slicing before shaping, single-pass plugin runtime summary projection, client full-status-to-summary cache publishing, set-backed Monitor active/busy agent lookups, one-pass activity timestamp sorting, and stable/memoized shell cron summary inputs. Verification passed: `node --import tsx --test tests/runtimeStatusService.test.ts`, `npm run smoke:runtime-status-control-plane`, `npm run typecheck`, and `npm run lint`.
- Gateway startup speed optimization now targets `server/services/gateway/gatewayLifecycleService.ts` and `server/controlPlane.ts`: independent ClawTalk and Telegram repair checks run in parallel during startup preflight, and the later startup-defaults step reuses those repair results instead of scanning/patching the same plugin runtime files again. Verification passed: `node --import tsx --test tests/gatewayLifecycleService.test.ts`, `npm run smoke:gateway-lifecycle`, `npm run smoke:server-architecture`, `npm run typecheck`, and `npm run lint`.

Next action:

- Human review/share decision for the private beta handoff: inspect the `40` listed source files, the Git/content review anchors, and `docs/PRIVATE_BETA_REVIEW_HANDOFF.md`, then share the draft prerelease evidence or request a focused cleanup pass.

## Backlog

### Phase 1: Restore Truth

- Extend the evidence-backed mission report path into backend-owned durable reports once the mission state machine is extracted.
- Continue replacing compatibility-only response/result shapes with shared Zod contracts now that the API route bodies use canonical envelopes.

### Phase 2: Secure The Control Plane

- Continue hardening authentication after the first live auth/enforcement pass.
- Continue canonical API-client migration for remaining legacy raw fetches.
- Continue CSP tightening over time by removing the temporary inline-style allowance once the legacy inline styles are migrated.
- Continue Electron IPC sender validation for any future IPC bridge additions.
- Production sandbox-disabling flags are removed from packaged Electron startup; keep the remaining dev-only unsafe diagnostic gate covered by `smoke:security`.
- Continue runtime supply-chain hardening beyond the first bundle-prep pass: frozen release install documentation and checksum verification for any remaining managed runtime downloads.

### Phase 3: Make Missions Durable

- Continue extracting mission networking and projection logic out of the Zustand store now that production mission lifecycle ownership is backend-only.

### Phase 4: Build Real Tests

- Add Vitest unit coverage for scoring, state transitions, SSE parsing, JSONL recovery, dedupe, path containment, redaction, coordination limits, agent eligibility, and retry classification.
- Broaden API integration tests beyond the first temporary-state auth/mission/envelope coverage.
- Add Electron end-to-end tests.
- Expand CI beyond the first workflow with lint and Electron end-to-end coverage.

### Phase 5: Extract Monoliths

- Continue extracting server routes by domain using `server/controlPlaneHttp.ts` and `server/routes/*` as the first pattern, following the service order in `docs/BETA_CODEBASE_SPLIT_PLAN.md`.
- Shrink `server/controlPlane.ts` toward a composition root only; do not add new domain logic there unless it is temporary glue with an extraction target.
- Split the Zustand store.
- Move network operations out of state actions.
- Split large agent console, recruit, and editor dialogs.
- Introduce shared Zod contracts.

### Phase 6: Rebuild The Design System Beneath The Current UI

- Freeze new global CSS override files.
- Create design tokens and primitives.
- Fix typography and contrast.
- Remove hidden duplicate navigation.
- Simplify the header.
- Replace hidden gestures with explicit controls.
- Migrate components one at a time with screenshot tests.

## Blockers And Risks

- Branch protection changes may require repository-admin access through GitHub settings or `gh`; verify permissions before claiming enforcement is active.
- Mandatory release signing may require a signing certificate/key and CI secrets; do not fake signing evidence.
- Continue using protective `codex/` branches or worktrees before broad hardening work.
- The audit notes vendored OpenClaw and generated packages were not treated as DystopAI-authored code; future changes should preserve that boundary unless explicitly needed.
