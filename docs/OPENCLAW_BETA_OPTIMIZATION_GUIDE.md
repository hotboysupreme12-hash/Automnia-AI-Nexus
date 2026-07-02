# OpenClaw 2026.6.11 Stable Upgrade Notes

Date prepared: 2026-06-04
Last updated for stable: 2026-07-01

Baseline: this guide now tracks the app's stable upgrade from the previous vendored OpenClaw `2026.6.10` runtime to OpenClaw `2026.6.11`. Older optimization notes remain below where they still describe durable runtime, Gateway, cron, plugin, and recovery work that is relevant to the stable release.

Source release notes:

- Stable release reviewed: https://github.com/openclaw/openclaw/releases/tag/v2026.6.11
- GitHub releases page: https://github.com/openclaw/openclaw/releases/
- npm package verified: https://www.npmjs.com/package/openclaw/v/2026.6.11
- Registry tarball: https://registry.npmjs.org/openclaw/-/openclaw-2026.6.11.tgz
- npm integrity: `sha512-T+P/g19IheeT1ckXMoPN61dYuE8vBF4MderI+kWkvpuFYxPkJxn8AXLpu9IXCnN9g36Acpm9+mMD/V+lsvOkyA==`
- Bundled Codex plugin verified: https://www.npmjs.com/package/@openclaw/codex/v/2026.6.11
- Bundled Codex integrity: `sha512-L9rO95x0DW7rpVJisPv2kkgwr04nKYAA1xbgDXVAm2oh801BCJFIJFo021bvhPmwo7MTAXNcuchO3laGa30QRQ==`
- Docs mirror: `docs/openclaw-latest` synced from https://docs.openclaw.ai on 2026-07-01, 697 pages, with the `v2026.6.11` release notes captured at `docs/openclaw-latest/pages/releases/2026.6.11.md`.

## Current Beta Split Plan Alignment

Current optimization source ledger: `docs/BETA_CODEBASE_SPLIT_PLAN.md`.
That file is an exact copy of the GitHub plan from
`origin/docs/150-point-release-plan` with blob SHA
`78bada3e29085e2726769b86b6c3720b69feab9f`.

All optimization work below remains useful, but future implementation should now
be sequenced through the split plan:

1. Freeze new `server/controlPlane.ts` domain growth and keep architecture smoke
   checks active.
2. Extract Gateway lifecycle, diagnostics, log, and chat orchestration services.
3. Extract runtime status, action, ledger, and recovery services.
4. Extract mission state, scheduler, report, recovery, and Team Sync services.
5. Extract provider/auth, plugin, filesystem/upload, release, state, and shared
   contract modules before adding broader workflow features.
6. Split renderer API calls and projection state out of the growing store.
7. Treat public signing and paid release work as later-stage work until the
   private beta readiness gates are proven.

Implementation rule: every optimization slice should name its target service or
state/contract module and record evidence in `docs/PRODUCTION_HARDENING_LEDGER.md`.

## 2026.6.11 Stable Runtime Delta

OpenClaw `2026.6.11` is a channel, plugin-distribution, provider-routing, and agent-turn reliability release on top of the 2026.6 runtime line. The changes that matter most to DystopAI are:

- Channel operations: Slack relay mode, native Mattermost `/oc_queue`, per-DM model overrides, Telegram delivery/rendering fixes, WhatsApp durable reply targets, and stronger draining-state reporting all make long-lived operator channels less brittle.
- Operator workflows: `openclaw agent --message-file` and the RAFT CLI wake bridge improve large prompt handoff and wake-up automation for scripted runs.
- Plugin distribution: several official plugins/providers/channels now live in official external catalogs instead of only under `dist/extensions`; bundled plugin manifests also carry icon metadata.
- Provider/model routing: provider model resolution, catalog parsing, reasoning controls, encrypted reasoning support, OpenRouter/Ollama/Gemini edge cases, and provider usage-cost reporting were tightened.
- Agent turns: Codex partial deltas, harness activation, abort cleanup, bounded provider responses, Claude CLI credit fallback, usage-limit classification, and long-context prompt-cache stability improve streaming and failure classification.
- Safety and config: non-interactive configure now fails closed, empty TLS paths are rejected, memory artifacts are sanitized, DOMPurify is patched, and cron/delivery validation is stricter.

## DystopAI 2026.6.11 Wiring

- Vendored runtime is now `openclaw@2026.6.11`, with the registry tarball and npm integrity pinned in `scripts/prepare-openclaw-vendor.cjs`.
- Bundled Codex now defaults to exact `@openclaw/codex@2026.6.11`, matching the package's `openclaw.compat.pluginApi >=2026.6.11` peer expectation.
- Runtime version checks and the optimization scorecard now recommend `2026.6.11`.
- Plugin inventory fallback now reads OpenClaw's `official-external-plugin-catalog.json`, `official-external-provider-catalog.json`, and `official-external-channel-catalog.json` when the CLI list is unavailable, then merges those entries with bundled manifests.
- Plugin records now carry `icon`, `systemImage`, `packageName`, and `installSpec`, and the Plugins panel displays available icon metadata while search can match package and install specs.
- Catalog-derived provider setup now uses OpenClaw-provided env vars and auth labels, so newly externalized providers can still surface setup fields before DystopAI has a local provider catalog entry.
- Media-understanding and video-generation provider contract ids are folded into the runtime provider summary so richer 2026.6.11 provider capabilities are visible in Monitor and plugin controls.

## 2026.6.10 Stable Runtime Delta

OpenClaw `2026.6.10` is a stability and policy release on top of the 2026.6 runtime line. The changes that matter most to DystopAI are:

- Automatic fast mode: `/fast auto`, `chat.send.fastMode: "auto"`, per-agent `fastModeDefault`, and per-model `params.fastMode` can start short calls in fast mode, then return retry/fallback/tool-continuation work to normal mode after the cutoff.
- Provider routing and reasoning: Zhipu/GLM overloads now fail over for the right reason; Z.ai GLM-5 models stay on Z.AI instead of falling through to OpenAI; GLM-5.2 exposes richer thinking levels; Kimi K2.7 Code and GLM-5.2 are refreshed in catalogs.
- Provider onboarding: selected provider plugins should continue credential setup instead of falling back to OpenAI after install.
- Sessions and transcripts: plugins get a durable transcript SDK contract, and cross-channel direct-message sessions reset identity correctly after channel switches.
- Gateway trust and package safety: trusted tool policy is re-applied when extension sets change, and trusted package redirects avoid forwarding bearer tokens across origins.
- Ops hardening: Docker/Podman setup timeouts, Codex service-tier clearing, StepFun discovery, and doctor check ordering were tightened.

## DystopAI 2026.6.10 Wiring

- Vendored runtime is now `openclaw@2026.6.10`, with the registry tarball and npm integrity pinned in `scripts/prepare-openclaw-vendor.cjs`.
- The vendor preparer handles the published package's production-scoped shrinkwrap mismatch by trying `npm ci --omit=dev` first, then falling back to an install that preserves `npm-shrinkwrap.json` and validates required runtime package versions.
- Runtime version checks now recommend `2026.6.10`.
- OpenClaw docs are fully re-synced from `docs.openclaw.ai`; stale mirrored pages are removed before sync so deleted upstream docs do not linger locally.
- Control Center agents now persist `runtime.fastModeDefault`, project it into OpenClaw `agents.list[].fastModeDefault`, and send one-turn Gateway `chat.send.fastMode` for auto/on modes.
- Fast-capable model allowlist entries for OpenAI, OpenAI Codex, Anthropic, xAI, and MiniMax receive `params.fastMode: "auto"` and `params.fastAutoOnSeconds: 60` unless already customized.
- Runtime Monitor optimization status now reports fast-mode defaults alongside context pruning, session, and memory status.

## 2026.6.6 Stable Chat Compatibility Notes

OpenClaw `2026.6.6` keeps the 2026.6 default `openclaw agent` path Gateway-backed and tightens the security boundary around transcripts, sandbox binds, MCP stdio, Codex HTTP access, native search, elevated sender checks, loopback tools, browser output, and Gateway/auth handling. DystopAI should keep Command Console feeling like channel/plugin sessions such as ClawTalk by keeping a warm Gateway session available while preserving fast plain-chat streaming. The Command Console runtime path has a WebChat-style Gateway bridge that forwards `chat.send` deltas live for successful persistent Gateway turns instead of waiting for one buffered final response.

For DystopAI Control Center chat turns:

- Keep direct provider streaming available for plain chat.
- Route tool-shaped turns, explicit runtime shortcuts, and direct-provider tool denials through the persistent Gateway WebSocket client (`chat.send`, live `chat` events, `chat.history`, `chat.abort`) before falling back to `openclaw agent ... --json`.
- Keep `tools.effective` diagnostic-only. The latest Gateway docs define it as a read-only projection of an already-warm session inventory, not a required MCP/tool warm-up call.
- Keep Gateway health visible in Runtime Monitor, auto-start it for console execution, and fall back to embedded `--local` only when the gateway transport fails.
- Before the first agent run, seed the active OpenClaw config with every model the app can assign to an agent, including fallback catalog models such as `google/gemini-3.5-flash` and `deepseek/deepseek-v4-flash`.
- Do not seed synthetic/non-public model aliases into OpenClaw config. For example, suppress `google/gemini-3.1-pro-preview-customtools` and use `google/gemini-3.1-pro-preview` for the provider catalog.
- Return structured JSON failures from `/api/openclaw/agent-turn` for preflight, auth, provider, stale-lock, timeout, Gateway, and runtime errors. The frontend should never see a dropped HTTP connection as the only signal.

Post-upgrade triage:

- If Runtime Monitor shows Gateway offline or a stale global OpenClaw install, simple direct chat should still work; tool-capable console execution will try gateway recovery and then fall back to embedded `--local` when the failure is transport-specific.
- If a specific agent still fails, check its model provider auth and provider model catalog entry first. Missing Google OAuth/API credentials or missing DeepSeek keys are configuration problems, not evidence that the chat transport is broken.
- Browser/channel delivery may still need Gateway recovery because those surfaces depend on long-lived plugin and channel services.

## Executive Summary

The `2026.6.6` OpenClaw stable release carries forward the 2026.6 runtime direction: durable runtime state, tighter security boundaries, bounded failures, governed skill/plugin changes, multi-agent orchestration, better streaming UX, clearer post-upgrade diagnostics, and provider/channel resilience.

DystopAI already has a lot of the right foundation:

- Gateway lifecycle management and restart controls.
- Agent turn sessions and stale lock cleanup.
- Fast Command Console streaming with runtime routing for tool-capable turns and a persistent Gateway chat client foundation.
- A plugin manager and runtime monitor.
- Skill library, ClawHub search/install/update, and learned skills.
- Mission board, cron missions, agent lanes, and inter-agent coordination.
- Electron packaging with embedded OpenClaw runtime support.

The biggest opportunity is to make those pieces more durable, reviewable, and observable. The app should remain an operator-grade control center around OpenClaw stable behavior, not only a launcher UI.

## What Changed In 2026.6 That Matters To DystopAI

### 1. Runtime Recovery Became A First-Class Theme

Release notes emphasize cleaner recovery from interrupted tool calls, stale session bindings, compaction handoffs, media delivery retries, lingering app-server turn handles, and stale locks.

Current DystopAI fit:

- Backend tracks active and recent OpenClaw runs in memory.
- Stale OpenClaw session lock cleanup exists in `server/index.ts`.
- Runtime sessions can be closed from the monitor.
- Gateway recovery and stale port release already exist.

What is missing:

- Recovery state is mostly in memory, so restarts lose context.
- The UI shows that a run failed, but does not classify failure causes deeply.
- There is no unified "repair runbook" for auth, plugin, gateway, session, disk, and stale process problems.

Recommended upgrade:

- Add a Runtime Doctor screen that classifies issues and offers one-click repairs.
- Persist run/session/gateway event state in SQLite so crash recovery is not blind.
- Add failure taxonomy tags: `timeout`, `rate_limit`, `gateway_disconnect`, `auth_expired`, `plugin_loader_error`, `stale_lock`, `disk_low`, `provider_unsupported`, `sandbox_unavailable`.

### 2. Timers, Retries, And Hangs Were Hardened

Release notes repeatedly mention bounded timers for provider requests, plugin requests, OAuth/device-code lifetimes, media downloads, local service probes, generated-content polling, diagnostics, readiness probes, CI status polling, and response bodies.

Current DystopAI fit:

- `runOpenClaw()` accepts timeouts and abort signals.
- Runtime status polling uses `AbortController`.
- Plugin panel fetches have frontend timeouts.
- Gateway health fetch uses `AbortSignal.timeout`.

What is missing:

- Express server has `requestTimeout`, `headersTimeout`, and `timeout` set to `0`, which allows route hangs unless every route handles its own timeout.
- `child.kill()` does not reliably kill descendant processes on Windows.
- Several route families call OpenClaw with long timeouts but do not share a single bounded-operation policy.
- Frequent runtime polling can still trigger expensive backend work.

Recommended upgrade:

- Create a central `boundedOperation()` helper for all CLI, provider, plugin, OAuth, download, and local probe work.
- Track timeout category and elapsed duration in every response.
- Replace bare child termination with process-tree termination for OpenClaw helper processes.
- Keep long-lived SSE routes explicit, but restore sane global HTTP server timeouts for ordinary routes.

### 3. State Is Moving From Filesystem Scans Toward SQLite

Release notes mention SQLite-backed plugin install index, inbound queues, iMessage monitor state, cron migrations, call logs, and memory write serialization.

Current DystopAI fit:

- Some state is localStorage.
- Runtime state is in backend memory.
- OpenClaw state/config is read from JSON and filesystem.
- Skill library and plugin panels scan filesystem/CLI outputs.

What is missing:

- No DystopAI-owned SQLite state layer.
- Mission history, feed, run history, gateway events, plugin controls, auth health snapshots, and skill proposals are not all durable.
- Restart recovery depends on a mixture of memory, localStorage, JSON, and OpenClaw files.

Recommended upgrade:

- Add a local SQLite database under the Electron userData/OpenClaw state dir.
- Use it as an indexed cache and event ledger, not as a replacement for OpenClaw's config files.
- Persist: runtime runs, gateway events, plugin install/status ledger, mission tasks, mission events, skill proposals, provider catalog cache, auth health snapshots, diagnostics runs, upload metadata.

Suggested tables:

```sql
runtime_runs(id, agent_id, session_id, command, cwd, status, started_at, ended_at, timeout_ms, exit_code, stdout_preview, stderr_preview, failure_kind)
gateway_events(id, timestamp, stream, level, channel, direction, agent_id, message)
plugin_ledger(id, name, source, version, enabled, configured_enabled, runtime_loaded, installed_at, updated_at, status, last_error)
skill_proposals(id, agent_id, title, status, version, created_at, updated_at, hash, source_run_id, rollback_path)
skill_proposal_files(id, proposal_id, relative_path, kind, sha256, preview_text)
missions(id, title, mode, status, created_at, started_at, ended_at, party_json, acceptance_json)
mission_tasks(id, mission_id, agent_id, title, status, lane, depends_on_json, comments_json, updated_at)
provider_catalog_cache(provider, model_id, capability_json, fetched_at, expires_at)
diagnostic_runs(id, started_at, ended_at, status, checks_json, summary, support_bundle_path)
```

### 4. Skill Workshop Is Now A Governed Workflow

Release notes added Skill Workshop proposal lists, today actions, revision handoff, searchable previews, review states, apply/reject/quarantine, support files, hashes, rollback safeguards, and localized Control UI flows.

Current DystopAI fit:

- Skills panel can detect successful agent runs as skill candidates.
- It can draft, save, share, install, and update skills.
- It can read ClawHub skill content and write learned skills.

What is missing:

- No proposal review lifecycle.
- No approve/reject/quarantine flow.
- No support file scanner/hash/rollback metadata.
- A learned skill can go straight to active library without an operator review gate.

Recommended upgrade:

- Convert "Teach New Skill" into a two-stage flow: Draft Proposal -> Review -> Apply.
- Add proposal statuses: `draft`, `pending_review`, `needs_revision`, `approved`, `applied`, `rejected`, `quarantined`, `rolled_back`.
- Add file preview and search across proposal files.
- Hash every proposed file and write rollback metadata before applying.
- Let agents propose skills, but require operator approval before the skill becomes enabled.

Implementation targets:

- Backend: add `/api/skill-workshop/proposals`, `/api/skill-workshop/proposals/:id/apply`, `/reject`, `/quarantine`, `/revise`.
- Frontend: add a Skill Workshop tab next to the existing Skills panel.
- Storage: use SQLite for proposal metadata and filesystem folders for proposal files.

### 5. Workboard Orchestration Is Bigger Than Cron Missions

Release notes added Workboard orchestration primitives, agent coordination tools, task-backed board runs, task comments, and run tracking.

Current DystopAI fit:

- Mission Deployment Panel already has templates, party lanes, commander mode, cadence, acceptance criteria, verification commands, and steering.
- Store has coordination messages, delegations, workspace claims, and mission feed.
- Backend has cron mission endpoints and assignment state.

What is missing:

- No persistent task board with columns, comments, dependencies, owners, and run history.
- No task-level replay from "what changed since last cycle".
- No durable mapping between mission, tasks, agent runs, comments, files, and verification evidence.

Recommended upgrade:

- Promote Mission Board into Workboard.
- Each mission should create task cards for each lane.
- Each card should include owner agent, status, dependencies, comments, claimed files, last run, failure kind, acceptance evidence, and next action.
- Commander reviews task cards, not just raw feed lines.

Suggested statuses:

- `backlog`
- `ready`
- `running`
- `blocked`
- `review`
- `verified`
- `done`
- `cancelled`

Suggested task card fields:

- Agent owner.
- Current prompt.
- Last response summary.
- Files claimed or changed.
- Required evidence.
- Verification result.
- Blocker and requested human action.
- Comments from commander/operator.

### 6. Streaming UX And Composer Resilience Were Improved Upstream

Release notes mention sends surviving history loading, stream deltas, skipping markdown while streaming, local drafts while typing, clear composer after sends, first-output latency traces, prioritized first connect, and calmer composer controls.

Current DystopAI fit:

- Agent response console has local prompt state, clear-on-send behavior, attachments, direct lane/party routing, and streaming markers.
- Backend has an SSE streaming route and buffered fallback.
- Direct provider streaming exists for several provider families.

What is missing:

- No first-output latency metric shown in UI.
- Streaming transport and live-token/buffered fallback are not obvious to the operator.
- Drafts are not persisted per target/party if the app refreshes.
- The console still renders large plain text messages directly and can become expensive on long outputs.

Recommended upgrade:

- Add per-turn metrics: `queued_at`, `started_at`, `first_token_at`, `completed_at`, `transport`, `buffered`, `token_count_estimate`.
- Show "first token" and "total" timings on response cards.
- Persist local draft by route: `direct:${agentId}`, `selected:${ids}`, `party:${ids}`.
- Virtualize response list for long histories.
- Use progressive rendering: plain text while streaming, markdown/code rendering after final.

### 7. Plugins Are Moving Toward External Packages And SecretRef Manifests

Release notes mention external Tokenjuice and Copilot packages, ClawHub publish metadata, SecretRef provider manifests, better loader failure guidance, SQLite plugin install index, and external plugin delivery surfaces.

Current DystopAI fit:

- Plugins panel lists, filters, toggles, and restarts gateway after plugin changes.
- Runtime monitor shows loaded/configured plugin status and missing dependencies.

What is missing:

- No install/update/uninstall flow for external plugin packages.
- No SecretRef manifest viewer or validation flow.
- No plugin repair workflow when package dependencies are missing or incompatible.
- No ledger of plugin state across restarts.

Recommended upgrade:

- Add Plugin Marketplace/Installer view.
- Show installed, available, update available, broken, disabled, and runtime-loaded states separately.
- Add "repair plugin" and "view loader error" actions.
- Detect SecretRef fields and show whether they are satisfied without revealing values.
- Persist plugin install ledger in SQLite.

### 8. Provider And Model Metadata Expanded

Release notes include MiniMax M3, account OAuth endpoints, Google/Vertex catalog fixes, OpenRouter SQLite model caching, Copilot Claude 1M capabilities, Foundry reasoning alignment, and OpenAI response replay guards.

Current DystopAI fit:

- Auth modal and backend provider auth handling exist.
- Model auth checks exist before saving/recruiting.
- Direct streaming code recognizes multiple provider families.

What is missing:

- No rich model capability center.
- No cached model catalog view by provider.
- No UI for context limits, streaming support, reasoning support, media support, cost hints, auth mode, OAuth expiry, or fallback health.
- No MiniMax/OpenRouter/Copilot-specific affordances in the Control Center UI.

Recommended upgrade:

- Add Provider and Model Center.
- Cache model catalog responses in SQLite with TTL.
- Show model capability matrix:
  - streaming available
  - direct streaming configured
  - OpenClaw runtime fallback available
  - context window
  - reasoning levels
  - image/media support
  - OAuth/API key status
  - last successful run
  - last failure kind
- Add "test model" and "repair auth" actions per provider.

### 9. Channels And Mobile Delivery Were Stabilized

Release notes mention Telegram, WhatsApp, iMessage, Slack, Discord, Teams, Google Chat, Meet, iOS realtime Talk, hosted push relay defaults, native iPad layouts, progress draft recovery, inbound queues, and SQLite-backed monitor state.

Current DystopAI fit:

- Runtime monitor parses gateway channel activity from logs.
- Plugin panel can identify communications plugins.

What is missing:

- No channel command center for individual channels.
- No inbound queue viewer.
- No progress-draft state view.
- No QR/OAuth pairing health view.
- No mobile push or Talk-specific settings.

Recommended upgrade:

- Add Channel Center:
  - channel plugin health
  - inbound/outbound event queue
  - last delivery and retry state
  - progress draft status
  - account/session health
  - QR login expiration and retry
  - mute/notification settings
- Store channel event summaries in SQLite.
- Add per-channel "send test", "restart connector", "repair auth", and "clear stuck queue" actions.

### 10. Diagnostics, CI, And Post-Upgrade Checks Were Bounded

Release notes mention disk space health checks, post-upgrade JSON probes, capped logs, response bodies, readiness probes, status polling, child workflow waits, rollback snapshots, and proof-bounded failures.

Current DystopAI fit:

- `/api/health` reports workspace and OpenClaw runtime info.
- Runtime monitor shows gateway, sessions, runs, plugins, shifts, missions.

What is missing:

- No post-upgrade checklist.
- No disk space check.
- No bounded support bundle export.
- No single "evidence report" after upgrade.
- No release compatibility check between embedded OpenClaw and expected app schema.

Recommended upgrade:

- Add Upgrade Readiness page:
  - embedded OpenClaw version
  - expected minimum version
  - disk free space
  - config parse check
  - gateway health
  - plugin loader health
  - auth profile health
  - skills check
  - cron list/migration check
  - provider catalog probe
  - quick agent turn smoke test
- Save the result as a dated diagnostic run.

## Prioritized Roadmap

Split-plan priority override: the roadmap below should no longer be treated as
a free-standing feature list. Apply it through the phase order in
`docs/BETA_CODEBASE_SPLIT_PLAN.md`, with Gateway, runtime, mission, and store
boundaries ahead of new centers or marketplace-style surfaces.

### Priority 0: Stability And Recovery

Build these first. They reduce stuck runs, mystery failures, and bad upgrade experiences.

1. Add a centralized bounded operation helper.
2. Make OpenClaw child process cleanup process-tree aware.
3. Add route-level timeout policy and stop relying on unlimited Express server timeouts.
4. Cache expensive runtime status components, especially plugin scans.
5. Add SQLite event ledger for runtime runs, gateway events, and diagnostics.
6. Add Upgrade Readiness / Runtime Doctor screen.
7. Add failure-kind classification and show it in response cards and monitor logs.

Acceptance criteria:

- A forced hung provider/plugin/CLI call ends with a classified timeout.
- Closing the app leaves no DystopAI-owned OpenClaw/Vite/server helper processes.
- Runtime status polling stays responsive when plugin list is slow.
- A restart preserves recent run/session/gateway event history.
- Doctor gives a concrete next action for gateway, auth, plugin, disk, and stale session failures.

### Priority 1: Operator Workflow Features

These align your app with the beta's major new surfaces.

1. Skill Workshop proposal review flow.
2. Workboard with task cards, comments, dependencies, ownership, and evidence.
3. Provider and Model Center with cached capabilities.
4. Plugin Marketplace/Installer with repair and SecretRef validation.
5. First-output latency and streaming transport UI.

Acceptance criteria:

- A successful agent run can become a pending skill proposal, not an immediately active skill.
- Operator can approve, reject, revise, quarantine, or roll back a skill proposal.
- A mission creates task cards and each agent run attaches to a card.
- Model picker can explain why a model is or is not safe/configured for a given agent.
- Plugin loader errors are actionable without reading raw logs.

### Priority 2: Channel, Mobile, And Media Expansion

These matter most if DystopAI is meant to operate across chat/mobile surfaces.

1. Channel Center with inbound queue, progress draft, and pairing health.
2. Mobile/Talk status and push relay settings if used.
3. Async media job tracking for image/music/video provider jobs.
4. Delivery retry ledger for generated media and channel sends.
5. Notification settings for channels and operator alerts.

Acceptance criteria:

- Operator can see why a channel message did not deliver.
- Stuck inbound events are visible and recoverable.
- Long media jobs continue in the background and report completion/failure.
- Channel plugins can be tested and repaired from one screen.

## Concrete App-Specific Optimization Targets

The targets below should be implemented by extracting focused services, not by
adding more domain logic to `server/controlPlane.ts`. If a target needs backend
work, start by mapping it to the service folder named in
`docs/BETA_CODEBASE_SPLIT_PLAN.md`.

### Backend: `server/index.ts`

1. `runOpenClaw()` should become a thin wrapper around a shared bounded process runner.
   - It already tracks active/recent runs.
   - Add process-tree termination.
   - Add structured `failureKind`.
   - Add stdout/stderr byte caps.
   - Persist run records to SQLite.

2. Runtime status endpoint should avoid expensive work on every 5-second poll.
   - `/api/openclaw/runtime/status` calls gateway health, gateway logs, and plugin controls.
   - Cache plugin controls for a short TTL, such as 10-30 seconds.
   - Let the UI request `?refresh=1` when it needs a fresh plugin scan.

3. Gateway health is strong, but should write durable events.
   - Persist start, stop, restart, stale listener release, health transitions, and crash exits.
   - Use those events to render a "last 24h stability" chart.

4. Add `/api/doctor/run`.
   - Checks disk, config parse, gateway, plugins, skills, auth, cron, provider model catalog, and one agent smoke turn.
   - Returns bounded JSON with `ok`, `severity`, `evidence`, `repairAction`.

5. Add `/api/runtime/version-check`.
   - Compare embedded OpenClaw version to required/recommended version.
   - Show when app bundle contains an older runtime than user expects.

### Frontend: Runtime Monitor

1. Add failure classification chips.
2. Show first-token and total duration separately.
3. Add stability timeline based on persisted gateway events.
4. Add repair buttons from Doctor results.
5. Add "why this is stuck" explanations for active runs:
   - no tokens yet
   - gateway active but no session update
   - plugin load pending
   - provider auth missing
   - hit timeout/retry loop

### Frontend: Agent Response Console

1. Persist drafts by target route.
2. Display streaming transport:
   - `direct provider`
   - `buffered OpenClaw`
   - `control-center SSE`
   - `runtime fallback`
3. Add first-token latency.
4. Defer markdown/code rendering until final response.
5. Virtualize old messages or page them by agent/session.

### Frontend: Skills Panel

1. Rename "Teach New Skill" to "Draft Skill Proposal".
2. Add proposal list with review states.
3. Add file preview/search.
4. Add support file handling.
5. Add rollback/quarantine actions.
6. Add hash/provenance display:
   - created from agent run
   - source prompt
   - source response
   - file hash
   - applied by operator

### Frontend: Mission Board

1. Split mission into Workboard and Dispatch.
2. Add task cards for agent lanes.
3. Attach agent runs and evidence to task cards.
4. Add comments and revision notes.
5. Add board filters:
   - active
   - blocked
   - needs review
   - verified
   - by agent
6. Add "today" view for currently actionable work.

### Frontend: Plugins Panel

1. Separate configured, installed, runtime-loaded, and broken states.
2. Add plugin package install/update/remove.
3. Add SecretRef manifest validation.
4. Add loader error guidance.
5. Add restart-required grouping and batch restart.

### Frontend: Provider/Auth UI

1. Add model capability matrix.
2. Add OAuth expiry/refresh status.
3. Add provider smoke tests.
4. Add per-agent auth override clarity.
5. Add "force re-login" for OAuth failures.
6. Add OpenRouter model catalog cache and MiniMax M3 support if the runtime reports it.

## Quick Wins

These are small changes with high value.

1. Add first-output latency fields to `AgentResponse`.
2. Add a `failureKind` field to `AgentResponse` and `MissionEvent`.
3. Cache plugin controls in `/api/openclaw/runtime/status`.
4. Add disk free-space check to `/api/health`.
5. Add a visible "OpenClaw runtime version" badge in the monitor.
6. Add "last successful gateway health" and "last restart reason" to the monitor header.
7. Add a "Doctor" button next to Clean Slate.
8. Persist command composer drafts by target.
9. Cap stdout/stderr previews for all backend errors.
10. Add a post-upgrade checklist in the UI after runtime version changes.

## Features DystopAI Is Lacking That Would Be Very Helpful

### Skill Governance

The app can create and install skills, but it needs a real governance workflow. Without review states, rollback metadata, and quarantine, a bad learned skill can poison future agent behavior.

Build:

- Skill proposal inbox.
- Diff/preview modal.
- Hashes and provenance.
- Approve/reject/quarantine.
- Rollback.
- "Needs revision" handoff back to agent.

### Durable Workboard

The mission system is powerful, but it still reads like a launch panel plus logs. A Workboard would make multi-agent work understandable after an hour, a restart, or a handoff.

Build:

- Task cards.
- Agent ownership.
- Comments.
- Dependencies.
- Evidence.
- Review status.
- "Today" actions.

### Runtime Doctor

Operators should not have to inspect logs to understand common failures.

Build:

- Gateway repair.
- Plugin repair.
- Auth repair.
- Disk check.
- Stale session cleanup.
- Sandbox/Docker compatibility check.
- Provider smoke tests.
- Export support bundle.

### Provider/Model Center

Model selection is now complicated enough to deserve its own screen.

Build:

- Provider catalog cache.
- Capability matrix.
- Auth health.
- Context/reasoning/media/streaming flags.
- Last-good model per agent.
- Fallback chain test.

### Channel Center

If this app is going to operate through Discord, Telegram, iMessage, WhatsApp, Slack, Teams, or Google Chat, channels need a dedicated command center.

Build:

- Inbound queue.
- Outbound retry state.
- Progress draft status.
- Pairing/login status.
- Per-channel test send.
- Restart/repair connector.

### Async Media Jobs

OpenClaw upstream is improving media job behavior. DystopAI should expose media jobs as durable background work instead of treating them like normal chat replies.

Build:

- Media job queue.
- Provider status.
- Poll/retry state.
- Generated asset library.
- Delivery retries to channel/mobile targets.

## Suggested Implementation Phases

### Phase 1: Recovery Foundation

Estimated scope: 2-4 focused days.

- Add SQLite dependency and create DB migrations.
- Add runtime run and gateway event persistence.
- Add bounded process runner.
- Add Doctor endpoint and basic UI panel.
- Add runtime version badge and disk check.
- Cache plugin controls in runtime status.

### Phase 2: Skill Workshop And Workboard

Estimated scope: 4-7 focused days.

- Add proposal tables and filesystem layout.
- Convert skill writing into proposal/apply flow.
- Add Skill Workshop UI.
- Add Workboard task model.
- Attach mission runs, comments, and evidence to cards.

### Phase 3: Provider, Plugin, Channel Centers

Estimated scope: 5-10 focused days, depending on plugin install support.

- Provider/model capability cache.
- Plugin installer and SecretRef validation.
- Channel queue/health dashboard.
- External plugin repair actions.
- Notification settings.

### Phase 4: Streaming And Performance Polish

Estimated scope: 2-4 focused days.

- First-token latency.
- Draft persistence by target.
- Response virtualization.
- Deferred markdown rendering.
- Status poll tuning and UI performance measurements.

## Build Order I Would Use After The Split Plan

1. Freeze control-plane growth and enforce the architecture threshold.
2. Extract Gateway lifecycle, diagnostics, log tailing, and chat orchestration.
3. Extract runtime status, action, ledger, and recovery services.
4. Extract mission state, scheduler, report, recovery, and Team Sync services.
5. Move bounded operations and process-tree cleanup behind the extracted runtime
   and Gateway services.
6. Move SQLite runtime/gateway/doctor ledger access behind the runtime ledger
   store/service boundary.
7. Add Doctor and runtime summary surfaces on top of the extracted services.
8. Split renderer API calls and projection state out of the growing store.
9. Add response latency, failure-kind, and transport fields once service events
   are structured.
10. Build Skill Workshop and Workboard after mission/runtime evidence is durable.
11. Build provider/model, plugin, and channel centers after their service
   boundaries exist.
12. Run the private beta gates and manual beta script before returning to public
   signing or paid-release tasks.

This keeps reliability and maintainability work ahead of new moving parts.

## Implementation Notes And Risks

- Keep beta-dependent features behind capability detection. Do not assume every OpenClaw beta exposes the same JSON shape.
- Prefer `--json` CLI output wherever OpenClaw supports it. Avoid parsing box-drawing tables for core logic.
- Treat OpenClaw config files as source of truth for runtime config, but keep DystopAI's SQLite DB as an event/cache/proposal ledger.
- Never display raw SecretRef values or provider tokens.
- Make Doctor repairs explicit actions. Do not auto-repair auth, delete plugins, or wipe queues without operator confirmation.
- Add migrations carefully. This app runs on a local machine and must survive partial upgrades.

## Definition Of Done For A Strong Beta-Aligned Control Center

- The app can explain and repair common runtime failures without manual log spelunking.
- A restart does not erase recent run, gateway, mission, plugin, and diagnostic context.
- Skills are proposed and reviewed before becoming active runtime behavior.
- Multi-agent missions are visible as task cards with owners, comments, evidence, and blockers.
- Provider/model choice is based on visible capabilities and auth health.
- Plugin state distinguishes configured, installed, loaded, disabled, broken, and repairable.
- Channel delivery has queues and retry visibility.
- Streaming turns show first-output latency, total duration, model, transport, and fallback reason.
