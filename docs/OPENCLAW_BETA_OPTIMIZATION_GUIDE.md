# OpenClaw 2026.6.11 Stable Upgrade Notes

Date prepared: 2026-06-04
Last updated for stable: 2026-07-04

Baseline: this guide tracks Automnia AI's stable upgrade from the previous vendored OpenClaw `2026.6.10` runtime to OpenClaw `2026.6.11`. Older optimization notes remain useful where they describe durable runtime, Gateway, cron, plugin, and recovery work relevant to beta readiness.

## Source release notes

- Stable release reviewed: https://github.com/openclaw/openclaw/releases/tag/v2026.6.11
- GitHub releases page: https://github.com/openclaw/openclaw/releases/
- npm package verified: https://www.npmjs.com/package/openclaw/v/2026.6.11
- Registry tarball: https://registry.npmjs.org/openclaw/-/openclaw-2026.6.11.tgz
- Docs mirror: `docs/openclaw-latest` synced from https://docs.openclaw.ai.

## Current Beta Split Plan Alignment

Current optimization source ledger: `docs/BETA_CODEBASE_SPLIT_PLAN.md`.

Future implementation should be sequenced through the split plan:

1. Freeze new `server/controlPlane.ts` domain growth and keep architecture smoke checks active.
2. Keep Gateway lifecycle, diagnostics, log, and chat orchestration in services.
3. Keep runtime status, action, ledger, and recovery behavior in services.
4. Keep mission state, scheduler, report, recovery, and Team Sync behavior in services.
5. Keep provider/auth, plugin, filesystem/upload, release, state, and shared contract modules split by domain.
6. Keep renderer API calls and projection state out of the growing store.
7. Treat public signing and paid release work as later-stage work until beta readiness gates are proven.

Implementation rule: every optimization slice should name its target service or state/contract module and record evidence in `docs/PRODUCTION_HARDENING_LEDGER.md`.

## 2026.6.11 Runtime Delta

OpenClaw `2026.6.11` is a channel, plugin-distribution, provider-routing, and agent-turn reliability release on top of the 2026.6 runtime line.

The changes that matter most to Automnia AI are:

- Channel operations: stronger relay, delivery, rendering, and draining-state behavior for long-lived operator channels.
- Operator workflows: better large prompt handoff and wake-up automation for scripted runs.
- Plugin distribution: official plugins, providers, and channels can be represented through external catalogs as well as bundled manifests.
- Provider/model routing: provider model resolution, catalog parsing, reasoning controls, and provider edge cases were tightened.
- Agent turns: streaming, abort cleanup, usage-limit classification, and long-context behavior improved.
- Safety and config: non-interactive configure behavior, TLS-path validation, memory artifact handling, and cron/delivery validation were tightened.

## Automnia AI 2026.6.11 Wiring

- Vendored runtime is now `openclaw@2026.6.11`.
- Bundled Codex now defaults to exact `@openclaw/codex@2026.6.11`.
- Runtime version checks and the optimization scorecard now recommend `2026.6.11`.
- Plugin inventory fallback reads OpenClaw external plugin, provider, and channel catalogs when the CLI list is unavailable.
- Plugin records carry icon, system image, package name, and install spec metadata for the Plugins panel.
