# Production Hardening Ledger

Automation: `dystopai-production-hardening`

Purpose: track release-hardening work against the production audit roadmap. Each
entry records the shipped slice, verification evidence, remaining risk, and the
next planned extraction.

## Current Branch

- Branch: `codex/agent-turn-route-modules`
- Base: `origin/main`
- Status: agent-turn route extraction implemented locally with full local CI and
  packaged launch smoke green; awaiting commit, push, PR, and remote CI
  evidence.
- Policy: keep work on `codex/` branches and avoid direct pushes to `main`.

## Open Production-Hardening PR Stack

- PR #2: runtime route extraction.
- PR #3: filesystem route extraction.
- PR #4: OpenClaw command route extraction.
- PR #5: release governance and signing enforcement.
- PR #6: skills route extraction.
- PR #7: provider-auth/model route extraction.
- PR #8: mission lifecycle/projection route extraction.
- Current branch: agent-turn/Gateway session route extraction.

## Completed Work

### 2026-06-24 - Agent-Turn Route Extraction

Scope:

- Extracted the Command Console/OpenClaw agent-turn route surface from
  `server/index.ts` into `server/routes/agentTurnRoutes.ts`.
- Preserved the public route paths:
  - `POST /api/openclaw/agent-preflight`
  - `POST /api/openclaw/agent-turn/sessions/clear`
  - `POST /api/openclaw/agent-turn/stream`
  - `POST /api/openclaw/agent-turn`
- Preserved the existing SSE behavior for `/api/openclaw/agent-turn/stream`:
  early accepted/status frames, live `delta` events, `replace` handling, chunked
  large deltas, final SSE frames, client-close abort, and the stream smoke abort
  marker.
- Kept the long-lived Gateway client, Gateway event waiter/observer layer,
  runtime execution helpers, ClawTalk console stream/final routes, runtime
  ledger helpers, and session-close/stale-abort routes in `server/index.ts` for
  later service extraction.
- Updated static smoke tests so the agent-turn route module owns route-level
  assertions while `server/index.ts` remains responsible for the lower-level
  Gateway/runtime helper contracts.

Evidence so far:

- `npm run typecheck:server`: passed.
- `npm run lint`: passed.
- `npm run build:server`: passed.
- `npm run smoke:agent-turn-control-plane`: passed.
- `npm run smoke:nexus-control-plane`: passed.
- `npm run smoke:runtime-actions-control-plane`: passed.
- `npm run smoke:openclaw-command-control-plane`: passed.
- `npm run smoke:api-envelope`: passed.
- `npm run smoke:openclaw`: passed, including diagnostic redaction, SSE parser,
  and agent-turn SSE endpoint smoke.
- `npm test`: passed, including the full production hardening smoke suite,
  release signing, release validation, security, and CI workflow checks.
- `npm run smoke:packaged-electron-launch`: passed.

Notes:

- `server/index.ts` is still large at 31,741 lines on this branch, but the hot
  agent-turn route handlers are no longer inline. The extracted route module is
  1,279 lines.
- Local OpenClaw documentation was reviewed before touching Gateway/SSE behavior:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/openclaw-latest/pages/web/webchat.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`

Subagent coordination:

- Jason mapped exact route ordering, helper dependencies, and smoke updates for
  the agent-turn route cluster.
- Dirac audited SSE framing, Gateway event routing, request abort, `chat.abort`,
  transcript-derived final text, and runtime evidence guardrails.

## In Progress

- Commit, push, open a PR, run GitHub CI, and attach release-evidence artifact
  metadata to the PR.

## Remaining High-Impact Work

- Continue reducing `server/index.ts` with focused route/service extractions:
  1. Party coordination and team sync routes.
  2. ClawTalk console routes and supporting mirror service.
  3. Nexus/misc routes.
  4. Gateway chat client/runtime services after route extractions settle.
- Keep branch protection expectations documented and enabled outside code:
  require green CI, block direct pushes to `main`, require PR review, and require
  signed commits where available or signed release tags at minimum.
- Keep release signing mandatory for public builds and preserve release evidence
  artifacts/checksums with clean release SHAs.
- Maintain the local-only threat model: localhost API only, no LAN binding, and
  no cloud exposure unless authentication is redesigned.

## Next Planned Task

After PR/CI evidence for agent-turn route extraction, extract party coordination
and team sync routes into route modules without moving mission or Gateway runtime
state ownership.
