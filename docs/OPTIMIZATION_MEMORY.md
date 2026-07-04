# Automnia AI Optimization Memory

Last updated: 2026-07-04

## Source Of Truth

- Current optimization source ledger: `docs/BETA_CODEBASE_SPLIT_PLAN.md`.
- Detailed evidence and work history stay in `docs/PRODUCTION_HARDENING_LEDGER.md`.
- The next public-beta proof path is tracked in `docs/NEXT_30_POINT_LEDGER.md`.

## Future Optimization Rule

Do not treat optimization work as a loose backlog. Map each slice to the beta split plan before implementation:

1. Freeze new control-plane domain growth.
2. Keep Gateway behavior in focused services.
3. Keep runtime behavior in focused services.
4. Keep mission behavior in focused services.
5. Keep provider/auth behavior in focused services.
6. Keep plugin behavior in focused services.
7. Keep filesystem, upload, picker, and browser behavior in focused services.
8. Keep renderer API calls and projection state out of broad store code.
9. Run beta readiness gates and manual beta checks.

## Working Memory

- OpenClaw runtime baseline is `2026.6.11`.
- Keep `server/controlPlane.ts` as composition glue only.
- New backend work should name the service folder it belongs to before code is added.
- Route ownership should stay inside `server/routes/*`.
- Runtime, mission, plugin, provider, Gateway, filesystem, browser, and agent-turn behavior should stay in services.
- UI work should use local primitives and avoid new final override layers.
- Hosted CI and packaged artifact evidence remain the final public-beta proof gate.
