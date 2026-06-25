# Production Hardening Ledger

Automation: `dystopai-production-hardening`

This ledger records production-hardening slices completed from the mainline checkout. Keep entries evidence-focused so each PR can be reviewed without reconstructing context from chat history.

## Current Branch

- Branch: `codex/clawtalk-console-route-modules`
- Base: `origin/main`
- Status: implemented locally; ready for PR after commit/push
- Started: 2026-06-25T01:15:04Z heartbeat
- Local timestamp: 2026-06-24T21:23:04-04:00

## Completed This Run

- Extracted the ClawTalk console HTTP surface from `server/index.ts` into `server/routes/clawTalkConsoleRoutes.ts`.
- Preserved the exact public API paths:
  - `GET /api/openclaw/clawtalk-console/stream`
  - `POST /api/openclaw/clawtalk-console/final`
- Kept ClawTalk mirror state, event normalization, sanitization, truncation, and agent-turn stream integration in `server/index.ts` for this incremental strangler step.
- Wired the extracted route through dependency injection so it still uses the authenticated control-plane middleware, existing SSE response helper, buffered ClawTalk events, live console clients, agent ID validation, retired-agent rejection, and canonical API envelopes.
- Expanded `scripts/smoke-agent-turn-control-plane.ts` so it validates the new module boundary, route registration, stream replay/heartbeat behavior, final-route validation, typed failures, and dedupe evidence.
- Used two read-only subagents to independently map route dependencies and smoke/CI coverage before final validation.

## Evidence

- `npm run typecheck:server` passed.
- `npm run smoke:agent-turn-control-plane` passed.
- `npm run lint` passed.
- `npm run build:server` passed.
- `npm run smoke:openclaw` passed.
- `npm run smoke:nexus-control-plane` passed.
- `npm run smoke:runtime-actions-control-plane` passed.
- `npm run smoke:party-coordination-control-plane` passed.
- `npm test` passed, including lint, app/server/electron typecheck, all control-plane smoke checks, secret scan, runtime reproducibility, release evidence/signing/validation checks, and CI workflow contract smoke.

## Open PR Stack Observed

- Route-extraction PRs #2 through #10 were already open and green before this branch was created.
- This branch intentionally starts from `origin/main` to keep the ClawTalk console extraction reviewable and independent of that stacked work.

## In Progress

- Break up `server/index.ts` by continuing to extract small route clusters with source-contract smoke coverage beside each move.

## Remaining Release-Hardening Focus

- Continue server route extraction: next likely target is shift/cron scheduler or remaining OpenClaw control-plane clusters, depending on the current mainline after merges.
- Establish and document main branch protection expectations: green CI, no direct pushes, PR review, signed commits where available or signed release tags at minimum.
- Keep public release signing mandatory and ensure release validation fails without signing evidence.
- Run/verify full CI on clean release SHAs and keep evidence artifacts/checksums with releases.
- Maintain the local-only threat model: localhost API only, no LAN binding, no cloud exposure unless authentication is redesigned.

## Blockers

- Main branch currently does not include the broader open route-extraction stack, so each new extraction from `origin/main` must avoid depending on unmerged route modules.
- Signed release enforcement is partially documented in prior open work but must be verified again once release branches are cut.

## Next Action

- Commit and push `codex/clawtalk-console-route-modules`, open a PR, then verify GitHub Actions and attach current-head CI artifact evidence to the PR.
