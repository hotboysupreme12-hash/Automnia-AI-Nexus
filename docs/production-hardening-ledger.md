# Production Hardening Ledger

Automation: `dystopai-production-hardening`

Purpose: track release-hardening work against the production audit roadmap. Each
entry records the shipped slice, verification evidence, remaining risk, and the
next planned extraction.

## Current Branch

- Branch: `codex/mission-route-modules`
- Base: `origin/main`
- Status: mission route extraction implemented locally; awaiting commit, push,
  PR, and remote CI evidence.
- Policy: keep work on `codex/` branches and avoid direct pushes to `main`.

## Open Production-Hardening PR Stack

- PR #2: runtime route extraction.
- PR #3: filesystem route extraction.
- PR #4: OpenClaw command route extraction.
- PR #5: release governance and signing enforcement.
- PR #6: skills route extraction.
- PR #7: provider-auth/model route extraction.
- Current branch: mission lifecycle/projection route extraction.

## Completed Work

### 2026-06-24 - Mission Route Extraction

Scope:

- Extracted mission lifecycle API endpoints from `server/index.ts` into
  `server/routes/missionRoutes.ts`.
- Preserved the existing public route surface:
  - `GET /api/missions`
  - `GET /api/missions/projection`
  - `GET /api/missions/:missionId/lifecycle`
  - `GET /api/missions/:missionId/events`
  - `GET /api/missions/:missionId/report`
  - `POST /api/missions/start`
  - `POST /api/missions/stop`
- Kept backend mission ownership, cancellation, idempotency, cron cleanup,
  lifecycle events, report generation, team sync, and persistence behavior behind
  injected dependencies.
- Left mission state-machine helpers in `server/index.ts` for a later focused
  service extraction rather than mixing route movement with runtime semantics.
- Updated smoke tests so mission route ownership is asserted against the new
  module while durable-state helpers remain asserted in the backend.
- Hardened packaged Electron launch smoke cleanup with Windows retry handling
  for transient file locks during temp directory removal.

Evidence:

- `npm run typecheck:server`: passed.
- `npm run lint`: passed.
- `npm run build:server`: passed.
- `npm run smoke:api-envelope`: passed.
- `npm run smoke:mission-lifecycle-projection`: passed.
- `npm run smoke:mission-durable-state`: passed.
- `npm run smoke:mission-idempotency`: passed.
- `npm run smoke:mission-cancellation`: passed.
- `npm run smoke:openclaw-command-control-plane`: passed.
- `npm run smoke:api-integration`: passed.
- `npm run smoke:mission-backend-owned`: passed.
- `npm test`: passed, including release signing, release validation, security,
  control-plane, OpenClaw, and CI workflow smokes.
- `npm run smoke:packaged-electron-launch`: passed.

Notes:

- `server/index.ts` is still very large at 29,922 lines, but this extraction
  removed the mission route handlers from the monolith and introduced a
  496-line route module.
- `npm test` emitted one JSONL malformed-row recovery warning from local ledger
  data: valid rows were preserved and the recovery smoke passed.
- Local OpenClaw documentation was reviewed before touching mission routes with
  Gateway/cron coupling:
  - `docs/openclaw-latest/pages/gateway/protocol.md`
  - `docs/openclaw-latest/pages/web/control-ui.md`
  - `docs/openclaw-latest/pages/web/webchat.md`
  - `docs/openclaw-latest/pages/cli/agent.md`
  - `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`

Subagent coordination:

- Kierkegaard mapped mission endpoints, registration order, and smoke-test
  ownership changes.
- Meitner reviewed Gateway/OpenClaw cron and cancellation coupling risks.

## In Progress

- Push `codex/mission-route-modules`, open a PR, run GitHub CI, and attach CI
  evidence/artifact digest to the PR.

## Remaining High-Impact Work

- Continue reducing `server/index.ts` with focused route extractions:
  1. Agent-turn/Gateway session routes.
  2. Party coordination and team sync routes.
  3. Nexus/misc routes.
  4. Mission services after route extraction settles.
- Keep branch protection expectations documented and enabled outside code:
  require green CI, block direct pushes to `main`, require PR review, and require
  signed commits where available or signed release tags at minimum.
- Keep release signing mandatory for public builds and preserve release evidence
  artifacts/checksums with clean release SHAs.
- Maintain the local-only threat model: localhost API only, no LAN binding, and
  no cloud exposure unless authentication is redesigned.

## Next Planned Task

After remote CI passes for mission route extraction, extract agent-turn/Gateway
session routes into a route module with tests preserving SSE framing, abort
handling, session evidence, and OpenClaw Gateway semantics.
