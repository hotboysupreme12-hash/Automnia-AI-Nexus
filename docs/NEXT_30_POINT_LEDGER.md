# Automnia AI Next 30-Point Ledger

Source plan: `docs/NEXT_30_POINT_PRODUCTION_PLAN.md`.

This ledger tracks implementation status for the 30-point production plan. Each work cycle should pick the highest-risk open items, update this file, and record the verification command that proves the change.

## Current Status

Automnia AI is a public beta candidate. The main remaining gates are hosted CI evidence, clean packaged launch evidence, release validation, screenshot artifacts, and continued control-plane reduction.

## Completed Milestones

- Browser preflight moved into a focused service.
- Agent-turn orchestration moved into focused services.
- Upload signature checks were added for core file classes.
- Renderer store/API boundaries were tightened.
- UI primitive migration started across core surfaces.
- Beta release notes, support docs, and release governance were updated.

## Open Milestones

- Make hosted GitHub Actions runs visible for the evaluated commit.
- Add `docs/CI_EVIDENCE.md` after a real green hosted run exists.
- Run clean-checkout package and packaged launch smoke.
- Capture packaged beta screenshots.
- Run beta release evidence and validation.
- Lower `server/controlPlane.ts` toward the next line-count budget.
