# DystopAI UI, Typography, Contrast, And CSS Implementation Guide

This guide turns the UI feedback into an implementation plan. The goal is not just a better-looking cockpit. The goal is a professional operator console that is readable under pressure, accessible by default, stable in screenshots, and easier to maintain without adding another final override layer.

## Target outcome

```text
Professional operator UI
+ readable typography
+ WCAG-conscious contrast
+ predictable component sizing
+ accessible focus and keyboard behavior
+ reusable UI primitives
+ clean CSS architecture
+ fewer late override files
+ screenshot-stable production surfaces
```

## Immediate product standard

DystopAI should feel like a serious local-first command center. It can keep the dark graphite/cyan identity, but the UI must not depend on tiny dim text, hidden gestures, unclear focus, or CSS overrides stacked like neon pancakes.

## Recommended open-source UI stack

Use open-source tools as behavior and component foundations, not as a total brand replacement.

| Tool | Role | Why it fits DystopAI |
| --- | --- | --- |
| Tailwind CSS | Layout, spacing, utility classes, responsive rules | Already in the project; good for token-driven application styling. |
| Radix UI Primitives | Dialogs, dropdowns, tooltips, popovers, menus, scroll areas | Unstyled accessible primitives; ideal for keeping DystopAI's custom look while improving behavior. |
| shadcn/ui style components | Local editable components for buttons, cards, inputs, dialogs, forms | Provides professional component patterns without locking the app into a vendor look. |
| React Aria | Advanced controls such as comboboxes, complex listboxes, drag/drop, tables, and date-like inputs | Use when interaction complexity is beyond Radix primitives. |
| Storybook | Component review and visual inventory | Lets you inspect UI states without launching the whole app. |
| Storybook addon-a11y / axe-core | Accessibility checks | Catch ARIA, focus, contrast, and structural regressions early. |
| Playwright | Production UI screenshots and interaction smoke | Use for app-level visual and keyboard regression tests. |

Recommended stack for this repo:

```text
Tailwind tokens
+ Radix primitives
+ shadcn-style local components
+ React Aria only for advanced controls
+ Storybook addon-a11y
+ Playwright screenshot checks
+ axe checks in CI
```

## UI laws for DystopAI

These rules are intentionally strict because DystopAI is an operations app, not a decorative landing page.

1. No important UI text below `12px`.
2. No UI text below `11px` anywhere except decorative marks.
3. Body text minimum is `14px`.
4. Console/log text minimum is `13px`, preferred `14px`.
5. Primary controls should be at least `40px` high.
6. Normal controls should be at least `36px` high.
7. Compact controls should be at least `32px` high.
8. Icon-only controls should be at least `32px x 32px`.
9. Normal text should meet at least `4.5:1` contrast against its real background.
10. Large text should meet at least `3:1` contrast.
11. Focus states must be visible on every interactive element.
12. Color must not be the only way to communicate state.
13. Destructive actions need review or confirmation.
14. Hidden right-click-only destructive actions should be replaced with visible controls.
15. Reduced motion must be respected.
16. The side rail should use navigation semantics, not mixed tab semantics.
17. The app should use `aria-current="page"` for active workspace navigation.
18. Modals, dropdowns, popovers, and menus should use accessible primitives.
19. Raw hex colors should live in tokens, not feature components.
20. No new `final-final` global override CSS files.

## Contrast target tokens

Create a stronger contrast palette and make components consume semantic tokens instead of one-off colors.

```css
:root {
  --surface-0: #030913;
  --surface-1: #07111e;
  --surface-2: #0b1828;
  --surface-3: #102238;
  --surface-overlay: rgba(4, 10, 18, 0.94);

  --text-primary: #f4f8ff;
  --text-secondary: #cbd7e8;
  --text-muted: #a7b5c8;
  --text-subtle: #8494aa;
  --text-disabled: #5f6d7f;

  --accent-cyan: #48e8ff;
  --accent-blue: #58aaff;
  --accent-purple: #c084fc;
  --accent-green: #4ade80;
  --accent-yellow: #facc15;
  --accent-red: #fb7185;

  --border-soft: rgba(180, 210, 235, 0.12);
  --border-default: rgba(180, 210, 235, 0.20);
  --border-strong: rgba(72, 232, 255, 0.38);

  --focus-ring: #7dd3fc;
}
```

## Typography target tokens

```css
:root {
  --font-size-2xs: 11px;
  --font-size-xs: 12px;
  --font-size-sm: 13px;
  --font-size-md: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  --font-size-3xl: 32px;

  --line-tight: 1.15;
  --line-title: 1.25;
  --line-body: 1.5;
  --line-relaxed: 1.65;
}
```

Usage standard:

| Surface | Size | Notes |
| --- | ---: | --- |
| Page title | `24px-32px` | Strong, readable, not oversized. |
| Workspace description | `14px` | Secondary but readable. |
| Card title | `16px-18px` | Use weight, not tiny uppercase. |
| Card body | `13px-14px` | Avoid dim microcopy. |
| Console/log message | `13px-14px` | This is operational text. |
| Metadata | `12px` | Can be muted, but still readable. |
| Chip label | `11px-12px` | Never below 11px. |
| Button | `12px-14px` | Depends on density. |

## New CSS structure

Current theme files should be treated as legacy compatibility until migrated. Target this structure:

```text
src/styles/
  tokens.css
  reset.css
  accessibility.css
  typography.css
  layout.css
  primitives.css
  utilities.css

src/components/ui/
  Button.tsx
  button.css
  IconButton.tsx
  icon-button.css
  Card.tsx
  card.css
  Dialog.tsx
  dialog.css
  Field.tsx
  field.css
  Badge.tsx
  badge.css
  StatusChip.tsx
  status-chip.css

src/components/layout/
  shell.css
  rail.css
  workspace-header.css

src/components/monitor/
  monitor.css
  runtime-timeline.css

src/components/mission/
  mission-panel.css

src/components/plugins/
  plugins-panel.css

src/components/settings/
  settings-panel.css
```

## Migration rule for every component

Do not rewrite the whole UI in one giant storm. Migrate one component at a time.

```text
1. Capture current screenshot.
2. Find all selectors touching the component.
3. Move repeated values to tokens.
4. Create or reuse a component primitive.
5. Move component-specific CSS beside the component.
6. Add Storybook or smoke coverage for normal, hover, focus, disabled, loading, success, warning, and error states.
7. Delete old selectors for that component.
8. Run UI smoke.
9. Run accessibility checks.
10. Capture new screenshot.
```

## 50-point UI implementation plan

### Phase 1: Token foundation

1. Create `src/styles/tokens.css`.
2. Move core color variables from late theme files into semantic tokens.
3. Move typography scale into semantic tokens.
4. Move radius, spacing, shadow, border, z-index, and motion into tokens.
5. Add `--surface-*`, `--text-*`, `--accent-*`, `--border-*`, and `--focus-*` variables.
6. Replace raw color usage in new components with semantic tokens.
7. Add a `high-contrast` token mode.
8. Add a `reduced-glow` token mode.
9. Add a `compact`, `comfortable`, and `spacious` density token set.
10. Document token usage inside `docs/UI_TYPOGRAPHY_CONTRAST_IMPLEMENTATION_GUIDE.md`.

### Phase 2: Contrast and readability

11. Audit every text token against the actual background surfaces.
12. Raise muted text contrast for labels, chips, table cells, field hints, and console metadata.
13. Keep faint text only for decorative or disabled content.
14. Replace dim gray placeholders when they carry meaning.
15. Ensure error text is readable on dark red surfaces.
16. Ensure warning text is readable on amber/dark surfaces.
17. Ensure success text is readable on green/dark surfaces.
18. Ensure active nav text and inactive nav text are both readable.
19. Ensure focus rings have enough contrast against each surface.
20. Add a contrast/a11y check to CI after Storybook or Playwright is available.

### Phase 3: Typography and sizing

21. Raise body text to `14px` minimum.
22. Raise console text to `13px` minimum, preferred `14px`.
23. Raise metadata and badges to at least `11px-12px`.
24. Set form labels to at least `13px`.
25. Set button text to `12px-14px`.
26. Set workspace titles to `24px-32px`.
27. Set card titles to `16px-18px`.
28. Normalize line-height for body, console, metadata, and headings.
29. Remove all important UI text below `12px`.
30. Add a CSS lint/smoke check that flags sub-11px font sizes outside approved decorative selectors.

### Phase 4: Component primitives

31. Create a local `Button` primitive.
32. Create a local `IconButton` primitive.
33. Create a local `Card` or `Panel` primitive.
34. Create a local `Badge` and `StatusChip` primitive.
35. Create a local `Field`, `Input`, `Select`, and `Textarea` primitive.
36. Create a local `Dialog` primitive using Radix Dialog or React Aria.
37. Create a local `Menu` primitive using Radix Dropdown Menu or React Aria Menu.
38. Create a local `Tooltip` primitive using Radix Tooltip.
39. Replace one-off button/card/input classes inside feature components.
40. Add primitive stories or smoke fixtures for all interaction states.

### Phase 5: Layout and accessibility cleanup

41. Clean side rail semantics: remove `role="tab"` unless a true tablist/tabpanel model is used.
42. Use `aria-current="page"` for the active workspace nav item.
43. Keep the skip link visible on focus and verified in UI smoke.
44. Make all icon-only buttons expose accessible names.
45. Make all destructive actions visible and reviewable.
46. Move cron-clearing and other destructive actions away from hidden right-click-only flows.
47. Ensure keyboard users can reach and operate Monitor, Missions, Plugins, Settings, and console controls.
48. Ensure reduced motion disables non-essential animations and transitions.
49. Capture production screenshots for Agents, Missions, Monitor, Plugins, and Settings.
50. Freeze visual changes after screenshots and only patch regressions until the beta cut.

## Implementation sequence

### Pass 1: Fast readability repair

```text
Goal: make the current UI easier to read without a rewrite.

Files:
- src/styles/tokens.css
- src/styles/typography.css
- src/styles/accessibility.css
- src/dystopai-app-theme.css

Work:
- Add semantic tokens.
- Raise small text sizes.
- Improve focus rings.
- Increase muted text contrast.
- Add high-contrast and reduced-glow modes.
```

### Pass 2: Primitive layer

```text
Goal: stop one-off UI styling from spreading.

Files:
- src/components/ui/Button.tsx
- src/components/ui/button.css
- src/components/ui/Card.tsx
- src/components/ui/card.css
- src/components/ui/Field.tsx
- src/components/ui/field.css
- src/components/ui/Badge.tsx
- src/components/ui/badge.css
- src/components/ui/Dialog.tsx
- src/components/ui/dialog.css

Work:
- Build local primitives.
- Use Radix for Dialog/Menu/Tooltip where possible.
- Keep the DystopAI look through tokens.
```

### Pass 3: Shell and navigation

```text
Goal: make the primary app chrome professional and accessible.

Files:
- src/components/layout/NexusShell.tsx
- src/components/layout/shell.css
- src/components/layout/rail.css
- src/components/layout/workspace-header.css

Work:
- Remove mixed tab semantics from rail nav.
- Use nav + aria-current="page".
- Standardize status chips.
- Use Button/IconButton primitives.
- Improve workspace title/description hierarchy.
```

### Pass 4: Monitor and command console

```text
Goal: make operational text readable under pressure.

Files:
- src/components/monitor/AgentResponseConsole.tsx
- src/components/monitor/LiveOperationMonitor.tsx
- src/components/monitor/monitor.css
- src/components/monitor/runtime-timeline.css

Work:
- Raise console/log font sizes.
- Use icons and labels for status, not only color.
- Normalize event timeline spacing.
- Add clear empty/offline/failure states.
```

### Pass 5: Missions and plugins

```text
Goal: make complex workflows easier to scan.

Files:
- src/components/mission/MissionDeploymentPanel.tsx
- src/components/mission/mission-panel.css
- src/components/plugins/PluginsPanel.tsx
- src/components/plugins/plugins-panel.css

Work:
- Group Missions by Goal, Agents, Timing, Evidence, Risk, Launch.
- Separate destructive actions.
- Show plugin states as Installed, Needs Auth, Disabled, Failed, Available.
- Use consistent panels, badges, forms, and status chips.
```

### Pass 6: Settings as UI control center

```text
Goal: make UI behavior configurable and durable.

Files:
- src/components/settings/SettingsPanel.tsx
- src/components/settings/uiSettings.ts
- src/components/settings/settings-panel.css

Work:
- Add High Contrast mode.
- Add Reduced Glow mode.
- Add Reduced Motion mode.
- Add density control.
- Persist settings.
- Apply settings before shell render where possible.
```

## Suggested package additions

Only add what you actually use.

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-popover
npm install -D storybook @storybook/addon-a11y
```

Optional advanced controls later:

```bash
npm install react-aria react-stately
```

Optional visual/a11y testing:

```bash
npm install -D @playwright/test axe-core
```

## Suggested scripts

```json
{
  "ui:storybook": "storybook dev -p 6006",
  "ui:storybook:build": "storybook build",
  "test:a11y": "storybook test --a11y",
  "test:visual": "playwright test tests/visual",
  "smoke:ui-contrast": "tsx scripts/smoke-ui-contrast-tokens.ts",
  "smoke:ui-font-sizes": "tsx scripts/smoke-ui-font-sizes.ts"
}
```

## Suggested contrast smoke script behavior

Create `scripts/smoke-ui-contrast-tokens.ts` that checks known foreground/background pairs.

Pairs to check:

```text
text-primary on surface-0
text-secondary on surface-0
text-muted on surface-0
text-subtle on surface-0
text-primary on surface-1
text-secondary on surface-1
text-muted on surface-1
accent-red on surface-0
accent-yellow on surface-0
accent-green on surface-0
focus-ring on surface-0
focus-ring on surface-1
```

Fail if any required normal text pair is below `4.5:1`.

## Suggested font-size smoke script behavior

Create `scripts/smoke-ui-font-sizes.ts` that scans CSS files and fails when important selectors use font sizes below `11px`.

Allowed exceptions:

```text
pure decorative marks
background labels
screen-reader-only helpers
third-party reset code
```

Preferred rule:

```text
font-size < 11px: fail unless selector is allowlisted
font-size 11px: allow only for chips/metadata
font-size 12px+: okay for compact text
font-size 14px+: preferred for body/console
```

## Acceptance criteria for beta UI readiness

```text
No important UI text under 12px.
No UI text under 11px except decorative allowlist.
Core text tokens pass contrast checks.
Focus is visible on every interactive primitive.
Primary controls are at least 40px high.
Compact controls are at least 32px high.
Side rail uses clean nav semantics.
Dialogs and menus use accessible primitives.
Monitor and command console are readable at production density.
Settings can toggle density, motion, and contrast/glow behavior.
Production screenshots are captured for Agents, Missions, Monitor, Plugins, Settings.
No new global final override CSS files are added.
```

## Definition of done

This UI work is complete for beta when a new user can open DystopAI, read every major label without squinting, navigate by keyboard, understand runtime state at a glance, and trust that the interface is not hiding destructive actions or critical failures behind tiny dim text.

The look should still be DystopAI: dark, sharp, futuristic, and agent-command focused. The difference is that it should now behave like a professional tool instead of a screenshot-only concept.
