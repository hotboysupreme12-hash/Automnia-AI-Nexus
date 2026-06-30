# DystopAI Production Score Audit — June 30, 2026

This audit snapshot is included in PR #43 as context for the UI/frameworks work. The UI guide is not just a visual wishlist; it supports the current production-readiness path by improving readability, accessibility, maintainability, and operator trust.

## Current score

```text
Production score: 7.7 / 10
Status: Early Access Candidate
```

DystopAI Core is now in early-access beta candidate territory. The biggest improvements are service extraction, provider/auth separation, mission restart recovery coverage, UI tokens, local UI primitives, contrast checks, and font-size checks.

The primary score cap is still proof, not ambition: a visible green GitHub Actions run and packaged-launch smoke evidence are still needed before this can be treated as a stronger release candidate.

## Current score breakdown

| Area | Score | Notes |
| --- | ---: | --- |
| Product vision | 8.8 | Strong local-first AI operations console. |
| Feature depth | 8.9 | Agents, missions, runtime, plugins, providers, monitor, settings, recovery. |
| Auth/API security | 7.8 | Stronger provider/auth and local API separation. |
| Electron hardening | 7.6 | Previously strong and still good. |
| Runtime persistence | 7.4 | SQLite, ledgers, recovery smoke coverage improved. |
| Mission reliability | 7.6 | Mission restart recovery smoke now exists. |
| Backend architecture | 7.3 | Better service split, but `controlPlane.ts` remains large. |
| Provider/auth architecture | 7.7 | New provider services are a major step. |
| UI polish | 8.0 | Tokens, typography, contrast, and primitives improved. |
| UI maintainability | 6.3 | Better now, but legacy theme stack still exists. |
| Test/gate design | 8.1 potential / 6.3 proven | Many gates, but no visible CI proof yet. |
| Packaging/release readiness | 7.0 | Better, but packaged proof still needed. |

## Why the score improved

1. `controlPlane.ts` shrank again.
2. Provider/auth services were extracted.
3. Mission restart recovery smoke coverage was added.
4. UI token foundation landed.
5. High-contrast and reduced-glow modes landed.
6. Local UI primitives were added.
7. Contrast smoke testing was added.
8. Font-size smoke testing was added.
9. Provider/model/OAuth tests were added.
10. The app is moving from screenshot polish toward enforceable UI quality gates.

## Backend architecture state

The current architecture report shows:

```text
Control-plane composition lines: 20,578
Control-plane bytes: 823,807
Top-level declarations: 1,345
Top-level functions: 930
Inline Express route calls: 0
Extracted route registrations: 17
Tracked API route contracts: 109
```

This is a strong improvement, but the control plane is still large. The next major extraction targets are:

```text
server/services/agents/agentTurnService.ts
server/services/agents/agentStreamingService.ts
server/services/agents/agentRuntimeService.ts
server/services/plugins/pluginInventoryService.ts
server/services/plugins/pluginInstallService.ts
server/services/plugins/pluginRuntimeService.ts
server/services/filesystem/pickerSessionService.ts
server/services/browser/browserPreflightService.ts
```

## UI state

The UI made a real jump because the repo now has:

```text
src/styles/tokens.css
src/styles/typography.css
src/styles/accessibility.css
src/components/ui/Button.tsx
src/components/ui/IconButton.tsx
src/components/ui/Panel.tsx
src/components/ui/Badge.tsx
src/components/ui/StatusChip.tsx
src/components/ui/Field.tsx
scripts/smoke-ui-contrast-tokens.ts
scripts/smoke-ui-font-sizes.ts
scripts/smoke-ui-primitives.ts
```

This means the app is no longer relying only on final visual overrides. It now has the start of a design system: tokens, primitives, sizing rules, contrast tests, and font-size gates.

## UI work still needed

1. Migrate existing shell buttons and status chips to primitives.
2. Migrate Monitor and Command Console text surfaces to the new typography tokens.
3. Migrate Missions and Plugins panels to reusable `Panel`, `Field`, `Badge`, and `StatusChip` primitives.
4. Clean side-rail semantics so navigation does not mix tab behavior with nav behavior.
5. Add visual regression screenshots for Agents, Missions, Monitor, Plugins, and Settings.
6. Keep deleting old CSS selectors as each component migrates.
7. Do not add any new global final override files.

## Current blockers before raising score above 8.0

1. One green full CI run.
2. Packaged desktop launch smoke proof.
3. Agent-turn service extraction.
4. Plugin install/runtime service extraction.
5. Picker/browser-preflight service extraction.
6. Continued UI primitive migration.
7. Visual regression and accessibility proof.

## Immediate commands to prove the current score

```bash
npm ci
npm run prepare:openclaw-vendor
npm test
npm run test:unit:coverage
npm run build:standalone
npm run check:bundle-budgets
npm run smoke:electron-e2e
npm run package:desktop
npm run smoke:packaged-electron-launch
```

## Recommended label

```text
DystopAI Early Access Candidate
```

Not stable. Not paid-public-release-ready yet. But now strong enough to begin trusted beta validation if local tests and packaged-launch smoke pass.

## Score movement

```text
Previous serious score: 7.4 / 10
Current score: 7.7 / 10
Likely after green CI and packaged-launch proof: ~8.0 / 10
Likely after agent/plugin/picker extraction and UI primitive migration: ~8.2-8.4 / 10
```

## Why this belongs with the UI PR

The UI work is now part of production readiness. Contrast, typography, focus behavior, primitive components, and CSS cleanup directly affect trust. DystopAI is an operator console; users must be able to read state, understand warnings, identify destructive actions, and operate the app under pressure.

The UI guide in this PR should be treated as a production-readiness plan, not a cosmetic design note.
