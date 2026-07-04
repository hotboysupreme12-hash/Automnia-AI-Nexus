# DystopAI Next 30-Point Ledger

Source plan: `docs/NEXT_30_POINT_PRODUCTION_PLAN.md` from PR #47.

This ledger tracks implementation status for the 30-point production plan. Each work cycle should pick the highest-risk open items, update this file, and record the verification command that proves the change.

## Current Cycle

Date: 2026-07-04

Completed in this cycle:

- Item 18: Added command-console upload signature sniffing for PNG, JPEG, WebP, GIF, PDF, and common audio containers.
- Item 19: Required image, PDF, and common audio upload bytes to match the declared high-risk extension and MIME type in the command-console upload path.
- Item 20: Added unit tests proving misleading MIME headers and mismatched file contents are rejected for command-console uploads.
- Item 18: Extended signature sniffing to avatar uploads and picker-selected avatar files for PNG, JPEG, WebP, GIF, BMP, ICO, and SVG.
- Item 19: Required avatar upload extension, declared MIME type, and sniffed image bytes to agree before route persistence or picker copy.
- Item 20: Added avatar service and avatar route tests proving invalid image bytes and misleading MIME headers are rejected before persistence.
- Item 16: Extracted browser preflight orchestration into `server/services/browser/browserPreflightService.ts` with Control Plane dependency wiring only.
- Item 17: Added focused browser preflight service tests for disabled plugin, offline Gateway, missing relay attachment, invalid relay payloads, and redacted probe/relay errors.
- Item 12: Extracted buffered agent-turn stream handoff into `server/services/agents/agentTurnService.ts` with Control Plane dependency wiring only.
- Item 13: Extracted Gateway chat agent-turn preparation into `server/services/agents/gatewayAgentTurnService.ts` with service-level coverage for Gateway chat dispatch/session metadata and buffered fallback behavior.
- Item 11: Extracted direct provider streaming orchestration into `server/services/agents/agentStreamingService.ts` with Control Plane dependency wiring only.
- Item 14: Extracted Control Center runtime fallback orchestration into `server/services/agents/agentRuntimeService.ts` with service-level coverage for Gateway fallback redaction.
- Item 15: Added focused agent-turn service coverage for direct provider streaming, buffered fallback, Gateway chat, local fallback, redacted direct-provider failure, and cancellation before Gateway/local dispatch.
- Item 22: Added a `12,000` line next-milestone warning budget to the server architecture smoke while keeping the current hard extraction ceiling unchanged until item 21 is reachable.
- Item 23: Re-verified route ownership with `0` inline Express API routes in `server/controlPlane.ts` and `111` unique API routes owned by extracted route modules.
- Item 24: Re-verified `src/store/nexusStore.ts` remains free of raw `/api` path literals, direct `fetch`, and direct `apiRequest` calls.
- Item 25: Added an architecture-smoke guard proving plugin, provider, mission, runtime, Gateway, filesystem, and renderer-store boundary smoke checks remain wired into `npm test`.
- Item 26: Migrated shell rail actions, workspace header status chips, and the agent-console header toggle to local `Button`/`StatusChip` primitives while preserving existing shell CSS hooks.
- Item 27: Migrated Monitor action controls, cron controls, Command Console runtime/status chips, response actions, and composer icon controls to local UI primitives while preserving existing CSS/automation hooks.
- Item 28: Migrated Mission action rows/status chips and Plugins summary chips, discovery controls, setup/runtime modals, and plugin row action groups to local UI primitives.
- Item 3: Documented the beta-ready release gate in `docs/RELEASE_GOVERNANCE.md`, requiring the hosted `Control Plane CI / Hardened control plane` check on the exact evaluated commit before beta-ready labeling or handoff.
- Item 4: Extended Control Plane CI to preserve test logs, coverage logs, bundle-budget output, packaged launch smoke logs, release validation logs, and packaged beta screenshots as GitHub Actions artifacts; `scripts/smoke-ci-workflow.ts` now pins those artifact contracts.
- Item 10: Added `docs/BETA_RELEASE_NOTES.md` with beta limitations, installer caveats, recovery steps, safe-log guidance, and a release qualification checklist that still requires real hosted/package evidence before publication.
- Item 29: Expanded packaged beta screenshot coverage to Agents, Missions, Monitor, Plugins, Settings, and Agent Editor across desktop, compact, and mobile viewports, and added a local smoke contract that pins the 18-screenshot packaged capture path in `npm test`.

Verification:

```text
node --import tsx --test tests/avatarFileService.test.ts
Result: pass 5, fail 0

node --import tsx --test tests/partyAvatarUploadRoutes.test.ts
Result: pass 4, fail 0

node --import tsx --test tests/commandConsoleUploadService.test.ts
Result: pass 13, fail 0

npm run typecheck:server
Result: exit 0

npm run lint -- server/services/filesystem/avatarFileService.ts server/routes/partyManagementRoutes.ts tests/avatarFileService.test.ts tests/partyAvatarUploadRoutes.test.ts tests/commandConsoleUploadService.test.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:command-console-files
Result: exit 0; command-console files control-plane contract ok

npm run smoke:filesystem-control-plane
Result: exit 0; filesystem control-plane contract ok

npm run smoke:route-inventory
Result: exit 0; control-plane route inventory ok (111 unique API routes)

node --import tsx --test tests/browserPreflightService.test.ts
Result: pass 5, fail 0

npm run typecheck:server
Result: exit 0

npm run lint -- server/controlPlane.ts server/services/browser/browserPreflightService.ts tests/browserPreflightService.test.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:route-inventory
Result: exit 0; control-plane route inventory ok (111 unique API routes)

node --import tsx --test tests/agentTurnServices.test.ts
Result: pass 3, fail 0

npm run typecheck:server
Result: exit 0

npm run lint -- server/controlPlane.ts server/services/agents/agentTurnService.ts server/services/agents/gatewayAgentTurnService.ts tests/agentTurnServices.test.ts scripts/smoke-agent-turn-control-plane.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:agent-turn-control-plane
Result: exit 0; agent-turn control-plane contract ok

npm run smoke:gateway-chat
Result: exit 0; gateway chat service contract ok

npm run smoke:server-architecture
Result: exit 0; server architecture contract ok (9 entry lines, 17815/29000 composition lines, 0 inline routes)

npm run smoke:route-inventory
Result: exit 0; control-plane route inventory ok (111 unique API routes)

node --import tsx --test tests/agentTurnServices.test.ts
Result: pass 5, fail 0

npm run typecheck:server
Result: exit 0

npm run lint -- server/controlPlane.ts server/services/agents/agentRuntimeService.ts server/services/agents/agentStreamingService.ts server/services/agents/agentTurnService.ts server/services/agents/gatewayAgentTurnService.ts tests/agentTurnServices.test.ts scripts/smoke-agent-turn-control-plane.ts scripts/smoke-openclaw-contracts.mjs scripts/smoke-agent-turn-stream.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:agent-turn-control-plane
Result: exit 0; agent-turn control-plane contract ok

npm run smoke:openclaw
Result: exit 0; OpenClaw contract smoke, diagnostic redaction, SSE parser, and agent-turn SSE endpoint smoke checks passed.

npm run smoke:server-architecture
Result: exit 0; server architecture contract ok (9 entry lines, 17476/29000 composition lines, 0 inline routes)

npm run smoke:route-inventory
Result: exit 0; control-plane route inventory ok (111 unique API routes)

node --import tsx --test tests/agentTurnServices.test.ts
Result: pass 8, fail 0

npm run smoke:agent-turn-control-plane
Result: exit 0; agent-turn control-plane contract ok

npm run smoke:openclaw
Result: exit 0; OpenClaw contract smoke, diagnostic redaction, SSE parser, and agent-turn SSE endpoint smoke checks passed.

npm run smoke:server-architecture
Result: exit 0; server architecture contract ok (9 entry lines, 17476/29000 composition lines, 0 inline routes); warning emitted for next milestone budget (17476/12000 lines).

npm run typecheck:server
Result: exit 0

npm run lint -- scripts/smoke-server-entrypoint-boundary.ts tests/agentTurnServices.test.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:route-inventory
Result: exit 0; control-plane route inventory ok (111 unique API routes)

npm run smoke:renderer-store-boundary
Result: exit 0; renderer store boundary ok (3888/3889 nexusStore lines, 0/0 apiRequest calls, 0/0 API path literals, 0 direct fetches)

npm run smoke:server-architecture
Result: exit 0; server architecture contract ok (9 entry lines, 17476/29000 composition lines, 0 inline routes); warning emitted for next milestone budget (17476/12000 lines).

npm run typecheck
Result: exit 0

npm run lint -- scripts/smoke-route-inventory.ts scripts/smoke-renderer-store-boundary.ts scripts/smoke-server-entrypoint-boundary.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:server-architecture
Result: exit 0; server architecture contract ok (9 entry lines, 17476/29000 composition lines, 0 inline routes); warning emitted for next milestone budget (17476/12000 lines).

npm run smoke:shell-production-ui
Result: exit 0; production shell UI contract ok

npm run smoke:ui-primitives
Result: exit 0; ui primitive contracts ok

npm run typecheck
Result: exit 0

npm run lint -- src/components/layout/NexusShell.tsx src/components/ui/StatusChip.tsx scripts/smoke-shell-production-ui.ts scripts/smoke-ui-primitives.ts scripts/smoke-server-entrypoint-boundary.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

node ./node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
Result: exit 0

npm run smoke:shell-production-ui
Result: exit 0; production shell UI contract ok

npm run smoke:ui-primitives
Result: exit 0; ui primitive contracts ok

npm run lint -- src/components/monitor/LiveOperationMonitor.tsx src/components/monitor/AgentResponseConsole.tsx src/components/mission/MissionDeploymentPanel.tsx src/components/plugins/PluginsPanel.tsx scripts/smoke-shell-production-ui.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run typecheck
Result: exit 0

npm run smoke:interactive-controls
Result: exit 0; interactive control contract ok

npm run smoke:ci-workflow
Result: exit 0; ci workflow contract ok

npm run typecheck
Result: exit 0

npm run lint -- scripts/smoke-ci-workflow.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.

npm run smoke:packaged-beta-screenshots-contract
Result: exit 0; packaged beta screenshot contract ok (6 surfaces, 3 viewports, 18 screenshots)

npm run smoke:ci-workflow
Result: exit 0; ci workflow contract ok

npm run smoke:shell-production-ui
Result: exit 0; production shell UI contract ok

npm run typecheck
Result: exit 0

npm run lint -- scripts/smoke-packaged-beta-screenshots-contract.ts scripts/capture-packaged-beta-screenshots.ts scripts/smoke-ci-workflow.ts
Result: exit 0; eslint completed with the existing Babel deopt note for large server/controlPlane.ts.
```

## Ledger

| # | Plan item | Status | Notes |
|---:|---|---|---|
| 1 | Make main GitHub Actions workflows visibly run on current `main` or a release-candidate PR. | Open | Needs hosted GitHub evidence. |
| 2 | Fix repository, runner, permission, billing, or trigger issues blocking hosted runs. | Open | Depends on hosted CI run visibility. |
| 3 | Require full Control Plane CI before beta-ready labeling. | Completed | `docs/RELEASE_GOVERNANCE.md` now defines the Beta-Ready Release Gate and requires the hosted `Control Plane CI / Hardened control plane` check on the exact evaluated commit before beta-ready labeling or handoff. |
| 4 | Preserve CI artifacts for logs, evidence, packaged launch smoke, budgets, and screenshots. | Completed | Control Plane CI now captures test, coverage, bundle-budget, packaged-launch, packaged-screenshot, and release-validation logs under `release/evidence`, uploads `dystopai-release-evidence`, and uploads `dystopai-packaged-beta-screenshots`; `smoke:ci-workflow` enforces the artifact contract. |
| 5 | Add `docs/CI_EVIDENCE.md` linking latest green run, commit SHA, and artifacts. | Open | Should wait for a real green hosted run. |
| 6 | Run `npm run package:desktop` from a clean checkout. | Open | Requires packaging pass and recorded artifact. |
| 7 | Run packaged Electron launch smoke against the packaged app. | Open | Must use packaged app, not dev Electron. |
| 8 | Capture packaged app screenshots for core beta screens. | Open | Agents, Missions, Monitor, Plugins, Settings, Agent Editor. |
| 9 | Run `npm run release:evidence` and `npm run release:validate` in non-public beta mode. | Open | Needs fresh release evidence output. |
| 10 | Create beta release note with limitations, installer caveats, and recovery instructions. | Completed | `docs/BETA_RELEASE_NOTES.md` now provides the beta release note draft, including limitations, installer caveats, recovery steps, safe-log guidance, and a qualification checklist that blocks publication until real hosted/package evidence exists. |
| 11 | Extract `streamProviderAgentTurn` into `server/services/agents/agentStreamingService.ts`. | Completed | Direct provider streaming selection, auth fallback, session conversation state, provider stream dispatch, memory append, doctrine cleanup, and final streaming metadata now live in `server/services/agents/agentStreamingService.ts`. |
| 12 | Extract `runBufferedAgentTurnForStream` into `server/services/agents/agentTurnService.ts`. | Completed | Buffered stream handoff, forced Gateway direct dispatch, canonical payload unwrap, sanitized buffered deltas, and streaming metadata now live in `server/services/agents/agentTurnService.ts`. |
| 13 | Extract `runGatewayAgentTurnForStream` into `server/services/agents/gatewayAgentTurnService.ts`. | Completed | Gateway chat turn validation, ClawTalk preflight hook, session handling, identity enforcement, prompt dump metadata, and Gateway chat dispatch now live in `server/services/agents/gatewayAgentTurnService.ts`. |
| 14 | Extract `runControlCenterAgentRuntimeTurn` into `server/services/agents/agentRuntimeService.ts`. | Completed | Gateway chat/client fallback, Gateway CLI fallback, local runtime fallback, abort-before-fallback behavior, and redacted fallback details now live in `server/services/agents/agentRuntimeService.ts`. |
| 15 | Add focused tests for streamed, buffered, Gateway, fallback, redacted failure, and cancellation paths. | Completed | `tests/agentTurnServices.test.ts` now covers streamed direct provider turns, buffered fallback, Gateway chat preparation/dispatch, local fallback redaction, redacted direct-provider failures, and abort-before-dispatch/fallback behavior. |
| 16 | Extract `checkBrowserPreflight` into `server/services/browser/browserPreflightService.ts`. | Completed | Browser preflight orchestration now lives in `server/services/browser/browserPreflightService.ts`; `controlPlane.ts` wires dependencies and delegates. |
| 17 | Add browser preflight tests for relay missing, offline, invalid payload, and redacted errors. | Completed | `tests/browserPreflightService.test.ts` covers disabled plugin, offline Gateway, missing relay attachment, invalid relay payloads, and redacted probe/relay details. |
| 18 | Add file-signature sniffing for high-risk upload classes. | Completed | Command-console upload path covers PNG, JPEG, WebP, GIF, PDF, and common audio signatures; avatar route and picker path cover supported avatar image signatures. |
| 19 | Require extension/MIME allowlists plus matching signatures for image and PDF uploads. | Completed | Command-console and avatar upload paths enforce extension/MIME/signature agreement before persistence. |
| 20 | Add tests proving misleading MIME headers cannot bypass extension or signature checks. | Completed | Command-console unit tests plus avatar service and route tests cover unsupported extensions, misleading MIME headers, and mismatched bytes. |
| 21 | Lower `server/controlPlane.ts` budget to `15,000` lines after extractions. | Blocked | Current architecture smoke reports `server/controlPlane.ts` at `17,476` lines, so the hard `15,000` ceiling still needs more extraction work before it can be enforced. |
| 22 | Add a `12,000` line warning budget for the next milestone. | Completed | `scripts/smoke-server-entrypoint-boundary.ts` now warns when `server/controlPlane.ts` remains above `12,000` lines while preserving the current hard cap. |
| 23 | Keep `0` inline Express API routes in `controlPlane.ts`. | Completed | `npm run smoke:route-inventory` confirms extracted route ownership for `111` unique API routes; `npm run smoke:server-architecture` confirms `0` inline routes in `controlPlane.ts`. |
| 24 | Keep `src/store/nexusStore.ts` free of raw `/api`, raw `fetch`, and direct `apiRequest`. | Completed | `npm run smoke:renderer-store-boundary` confirms `0` raw API path literals, `0` direct `fetch` calls, and `0` direct `apiRequest` calls in `src/store/nexusStore.ts`. |
| 25 | Keep boundary smoke checks in `npm test`. | Completed | `scripts/smoke-server-entrypoint-boundary.ts` now fails if plugin, provider, mission, runtime, Gateway, filesystem, or renderer-store boundary smokes are removed from `test:ci` / `npm test`. |
| 26 | Migrate shell rail actions, status chips, and header controls to UI primitives. | Completed | `src/components/layout/NexusShell.tsx` now uses local `Button` primitives for rail actions and the agent-console toggle, and local `StatusChip` primitives for workspace header status chips; shell/UI primitive smokes pin the contracts. |
| 27 | Migrate Monitor and Command Console controls to primitives. | Completed | `src/components/monitor/LiveOperationMonitor.tsx` and `src/components/monitor/AgentResponseConsole.tsx` now use local `Button`, `IconButton`, `Badge`, and `StatusChip` primitives for Monitor tabs/tools/cron controls/activity status and Command Console runtime chips, message metadata, response actions, and composer controls; `smoke:shell-production-ui` pins the primitive coverage. |
| 28 | Migrate Missions and Plugins panel action rows to primitives. | Completed | `src/components/mission/MissionDeploymentPanel.tsx` and `src/components/plugins/PluginsPanel.tsx` now use local primitives for mission launch/cadence/steer/status rows plus plugin summary chips, discovery/filter controls, setup/runtime modals, and plugin row action groups. |
| 29 | Add Playwright or screenshot smoke coverage for packaged UI core screens. | Completed | Packaged screenshot capture now covers Agents, Missions, Monitor, Plugins, Settings, and Agent Editor across desktop, compact, and mobile viewports; `smoke:packaged-beta-screenshots-contract` pins the 18-screenshot contract and is wired into `npm test`. |
| 30 | Freeze visual changes after beta screenshots except accessibility/readability/regression fixes. | Open | Policy step after screenshot baseline. |

## Next Best Work Queue

1. Continue item 21 by extracting enough remaining Control Plane composition to safely enforce a `15,000` line hard ceiling.
2. Create a real `docs/CI_EVIDENCE.md` only after a hosted green run exists.
3. Run and record clean-checkout package, packaged launch, screenshot, and release-validation evidence for items 6-9.
4. Use `docs/BETA_RELEASE_NOTES.md` as the draft release note and fill final evidence links/status only after hosted CI, packaged smoke, screenshots, and release validation exist.
