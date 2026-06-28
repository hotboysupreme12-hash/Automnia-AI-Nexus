# Changelog

Docs: https://docs.openclaw.ai

## 2026.6.10

### Highlights

- **Automatic fast mode for talks:** OpenClaw can enable fast mode for short conversational turns, then return to normal mode for longer runs with bounded fallback and delivery behavior. (#85104) Thanks @alexph-dev and @vincentkoc.
- **More reliable model routing:** Zai model synthesis, GLM overload failover, and native reasoning-level selection now follow the active model catalog more consistently. (#94461, #93241, #94067, #94136) Thanks @Pandah97, @chrysb, @0xghost42, @zhengli0922, @openperf, @civiltox, and @BorClaw.
- **Safer session and channel state:** channel switches reset stale origin fields, and cron delivery awareness stays attached to the target session. (#95328, #93580) Thanks @ZengWen-DT, @jalehman, @gorkem2020, and @scotthuang.
- **Trusted policies survive hook composition:** composed hook registries keep the trusted tool policies required by approval-sensitive flows. (#94545) Thanks @jesse-merhi.

### Changes

- **Agent and channel runtime:** fast-mode state now survives retries, fallback transitions, progress events, and embedded/CLI/ACP normalization; session and channel routing retain the current target and delivery context. (#85104, #93580, #95328) Thanks @alexph-dev, @vincentkoc, @scotthuang, @ZengWen-DT, @jalehman, and @gorkem2020.
- **Provider behavior:** model catalogs now supply the correct Zai base URL, overload classification, and native reasoning controls for live-discovered models. (#94461, #93241, #94067, #94136) Thanks @Pandah97, @chrysb, @0xghost42, @zhengli0922, @openperf, @civiltox, and @BorClaw.

### Fixes

- **Fast-mode and policy correctness:** fallback cutoffs and reset notices are bounded, repeated progress events remain visible, Codex service-tier state is normalized, and trusted policies are not lost when hook registries are composed. (#85104, #94545) Thanks @alexph-dev, @vincentkoc, and @jesse-merhi.
- **Model and delivery edge cases:** Zai and GLM failover paths use the right runtime metadata, while stale channel-origin state no longer leaks across session changes. (#94461, #93241, #95328) Thanks @Pandah97, @chrysb, @0xghost42, @zhengli0922, @ZengWen-DT, @jalehman, and @gorkem2020.
- **Provider plugin onboarding:** setup refreshes provider plugin registry metadata after installing setup-selected provider plugins, so auth continuation uses the newly installed provider instead of stale registry state. (#95792) Thanks @snowzlmbot.

### Complete contribution record

This audited record covers the complete v2026.6.9..HEAD history: 12 merged PRs. The generation manifest also supplies direct commits as editorial input; the grouped notes above prioritize user impact.

#### Pull requests

- **PR #86627** Keep core doctor health in contribution order. Thanks @giodl73-repo.
- **PR #93580** fix: preserve cron delivery awareness for target sessions. Thanks @scotthuang and @jalehman.
- **PR #95030** refactor: add SDK transcript identity target API. Thanks @jalehman.
- **PR #94838** refactor(copilot): complete harness lifecycle parity. Thanks @vincentkoc.
- **PR #95328** fix(sessions): reset stale per-channel origin fields on channel switch. Related #95325. Thanks @ZengWen-DT and @jalehman and @gorkem2020.
- **PR #94461** fix(zai): fall back to manifest baseUrl for synthesized GLM-5 models. Related #94269. Thanks @Pandah97 and @chrysb.
- **PR #93241** fix(agents): classify Zhipu GLM overload as overloaded for failover. Related #93211. Thanks @0xghost42 and @zhengli0922.
- **PR #94067** fix(channels): resolve native /think menu levels via runtime catalog for live-discovered models. Related #93835. Thanks @openperf and @civiltox.
- **PR #94136** fix(zai): expose GLM-5.2 reasoning levels [AI-assisted]. Thanks @BorClaw.
- **PR #85104** feat: fast talks auto mode. Related #85087. Thanks @alexph-dev.
- **PR #94545** fix: keep trusted policies with hook registry. Thanks @jesse-merhi.
- **PR #95792** fix(onboard): refresh provider plugin registry after setup installs. Related #95765. Thanks @snowzlmbot.
