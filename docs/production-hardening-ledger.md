# Production Hardening Ledger

Automation: `dystopai-production-hardening`

Purpose: track release-hardening work against the production audit roadmap. Each
entry records the shipped slice, verification evidence, remaining risk, and the
next planned extraction.

## Current Branch

- Branch: `codex/party-coordination-route-modules`
- Base: `origin/main`
- Status: party coordination and TEAM_SYNC route extraction implemented locally
  with full local CI and packaged launch smoke green; awaiting commit, push, PR,
  and remote release-evidence CI.
- Policy: keep work on `codex/` branches and avoid direct pushes to `main`.

## Open Production-Hardening PR Stack

- PR #2: runtime route extraction.
- PR #3: filesystem route extraction.
- PR #4: OpenClaw command route extraction.
- PR #5: release governance and signing enforcement.
- PR #6: skills route extraction.
- PR #7: provider-auth/model route extraction.
- PR #8: mission lifecycle/projection route extraction.
- PR #9: agent-turn/Gateway session route extraction.
- Current branch: party coordination and TEAM_SYNC route extraction.

## Completed Work

### 2026-06-25 - Party Coordination and TEAM_SYNC Route Extraction

Scope:

- Extracted coordination route registration from `server/index.ts` into
  `server/routes/partyCoordinationRoutes.ts`.
- Preserved the public route paths:
  - `POST /api/party/dispatch`
  - `POST /api/party/agent-to-agent`
  - `POST /api/party/parallel-health`
  - `POST /api/team-sync/append`
- Kept mission lifecycle routes, shift/cron scheduler routes, party
  recruit/profile/config routes, and shared stateful helpers in `server/index.ts`
  for later service extraction.
- Preserved agent runtime invocation behavior by dependency-injecting existing
  OpenClaw runner, agent workspace, doctrine, TEAM_SYNC, browser preflight,
  policy, timing, and memory helpers rather than rewriting them.
- Updated static smoke tests so route-level assertions live against
  `server/routes/partyCoordinationRoutes.ts`, while the internal authenticated
  agent-turn handoff caller remains asserted in `server/index.ts`.

Evidence so far:

- `npm run typecheck:server`: passed.
- `npm run smoke:party-coordination-control-plane`: passed.
- `npm run smoke:team-sync-control-plane`: passed.
- `npm run smoke:openclaw-command-control-plane`: passed.
- `npm run smoke:auth`: passed.
- `npm run smoke:agent-turn-control-plane`: passed.
- `npm run smoke:openclaw`: passed.
- `npm run smoke:shifts-control-plane`: passed.
- `npm run lint`: passed.
- `npm run build:server`: passed.
- `npm test`: passed, including the full production hardening smoke suite,
  release signing, release validation, security, and CI workflow checks.
- `npm run smoke:packaged-electron-launch`: passed.

Notes:

- `server/index.ts` is still large at 29,433 lines on this branch, but another
  high-risk coordination route cluster is no longer inline. The extracted route
  module is 965 lines.
- Local OpenClaw documentation was reviewed before touching agent runtime route
  wiring:
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`

Subagent coordination:

- Darwin mapped the party, mission, shift, and TEAM_SYNC route boundaries and
  recommended a route-first extraction with later service splits for TEAM_SYNC,
  missions, and shifts.
- Planck mapped the route-layout smoke tests and identified the exact scripts
  that needed to read the extracted route module.

## In Progress

- Commit, push, open a PR, and capture remote Control Plane CI release-evidence
  artifact metadata.

## Remaining High-Impact Work

- Continue reducing `server/index.ts` with focused route/service extractions:
  1. ClawTalk console stream/final routes and supporting mirror service.
  2. Shift and cron scheduler routes.
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

After PR/CI evidence for party coordination extraction, extract ClawTalk console
routes and supporting mirror state into a route module without changing Gateway
chat semantics.
