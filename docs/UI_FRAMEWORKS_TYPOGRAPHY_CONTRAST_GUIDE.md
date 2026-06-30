# DystopAI UI Frameworks, Typography, Contrast, And CSS Cleanup Guide

This document is intentionally focused only on the UI layer. It is separate from the release checklist and codebase split plans.

The goal is to make DystopAI look and behave like a professional operator console: readable, accessible, polished, keyboard-friendly, screenshot-stable, and easier to maintain.

## Target outcome

```text
Professional DystopAI UI
+ strong typography hierarchy
+ measured contrast
+ readable dense operator screens
+ accessible focus and keyboard behavior
+ consistent sizing and hit targets
+ reusable local UI primitives
+ fewer global CSS override layers
+ compatible free/open-source UI tooling
```

## Product UI standard

DystopAI can keep the dark graphite, cyan, and command-center identity, but the interface must not depend on tiny dim text, hidden gestures, unclear focus states, or another final override file.

A beautiful UI that cannot be read under pressure is not production polish. It is fog with gradients.

## Current UI problem to solve

The app has a strong visual direction, but the styling architecture is still too layered. The current theme stack uses ordered files such as foundation, layout panels, missions, monitor, plugins, final overrides, cohesive UI, responsive polish, production polish, reference screenshot styling, and typography polish.

That can work for fast iteration, but it eventually makes the cascade difficult to reason about. A button, chip, card, or rail item may be styled by several files at once.

The next UI milestone is not another screenshot pass. The milestone is:

```text
Freeze global overrides.
Create tokens.
Create primitives.
Migrate one component group at a time.
Delete old selectors after each migration.
```

## Accessibility and contrast standards

DystopAI should use these as internal standards:

| Area | Standard |
| --- | --- |
| Normal text contrast | At least `4.5:1` against real background. |
| Large text contrast | At least `3:1`. |
| Important muted text | Prefer stronger than bare minimum because glow and dark UI reduce perceived readability. |
| Focus visibility | Visible outline or ring on every interactive element. |
| Focus ring contrast | Must stand out against active and inactive states. |
| Smallest UI text | `11px` only for decorative metadata or compact chips. |
| Important UI text | `12px` minimum. |
| Body text | `14px` minimum. |
| Console/log text | `13px` minimum, `14px` preferred. |
| Primary controls | `40px` minimum height. |
| Normal controls | `36px` minimum height. |
| Compact controls | `32px` minimum height. |
| Icon-only controls | `32px x 32px` minimum. |
| Reduced motion | Must be honored. |
| State communication | Never color alone; include label, icon, text, or shape. |

## Recommended free/open-source UI stack

Use tools that are compatible with the current DystopAI direction: React, Vite, Electron, Tailwind-style utility classes, custom dark theme, and local-first desktop UI.

### Primary recommended stack

| Tool | Use for | Compatibility with DystopAI | Notes |
| --- | --- | --- | --- |
| [Tailwind CSS](https://tailwindcss.com/) | Utility classes, spacing, responsive layout, token mapping | Strong | Already aligned with the app. Keep it as the utility/layout layer. |
| [Radix UI Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | Dialog, dropdown menu, popover, tooltip, menu, scroll area, select, tabs where needed | Strong | Unstyled accessible primitives. Good for custom DystopAI visuals. |
| [shadcn/ui](https://ui.shadcn.com/docs) style local components | Button, card, form, field, dialog, badge, command, table patterns | Strong | Use as open-code component inspiration. Copy/adapt locally instead of becoming dependent on defaults. |
| [React Aria](https://react-aria.adobe.com/) | Advanced accessible controls such as combobox, listbox, date/time fields, table-like interactions | Strong but selective | Use when Radix is not enough or interactions are complex. |
| [Storybook](https://storybook.js.org/) | Component workshop, visual state inventory | Strong | Add stories for primitives and core app panels. |
| [Storybook addon-a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing) / axe-core | Accessibility checks | Strong | Use for repeatable a11y checks against component states. |
| [Playwright](https://playwright.dev/) | Production screenshots, keyboard checks, visual smoke | Strong | Best for full app-level UI verification. |

### Secondary compatible frameworks and libraries

These are free/open-source options you can use carefully, but they should not replace DystopAI's identity.

| Tool | Best use | Fit | Recommendation |
| --- | --- | --- | --- |
| [Mantine](https://mantine.dev/) | Rich React component library, forms, notifications, hooks | Medium | Good for internal tools, but may push the app toward a generic dashboard look. Use selectively. |
| [Chakra UI](https://chakra-ui.com/) | Accessible components and style props | Medium | Useful patterns, but replacing the current UI would be a large migration. |
| [MUI](https://mui.com/) | Complex tables, forms, admin surfaces | Medium | Powerful but visually opinionated. Use only for isolated admin-like surfaces if needed. |
| [Ant Design](https://ant.design/) | Enterprise tables, forms, data-heavy admin UI | Medium-low | Strong but heavy and recognizable. Avoid as the main DystopAI look. |
| [IBM Carbon](https://carbondesignsystem.com/) | Enterprise-grade data and settings patterns | Medium | Great reference for spacing, status, forms, and enterprise UX. Do not directly skin the whole app with it unless you accept the IBM-like look. |
| [Fluent UI](https://react.fluentui.dev/) | Windows-style controls and enterprise UI | Medium | Compatible with desktop UX thinking, but it can dilute the DystopAI visual identity. |
| [Headless UI](https://headlessui.com/) | Headless menu/dialog/listbox patterns | Medium | Useful, but Radix usually fits DystopAI better for primitives. |
| [Lucide React](https://lucide.dev/) | Icons | Strong | Good open icon set. Keep icon weight consistent. |

## Recommended decision

Do not rebuild DystopAI with a huge pre-themed kit.

Use this combination:

```text
Tailwind for layout and utilities
Radix for accessible primitive behavior
shadcn-style local components for polished starting points
React Aria only for advanced interactions
Storybook + axe for component quality
Playwright for production UI proof
```

This lets DystopAI keep its custom control-center identity while gaining professional behavior.

## What not to do

1. Do not add another `100-final-final.css` file.
2. Do not replace the whole UI with Bootstrap, MUI, Ant, or Carbon just to look professional.
3. Do not keep important text at `7px`, `8px`, `9px`, or `10px`.
4. Do not rely on glow as a substitute for contrast.
5. Do not hide destructive actions behind right-click only.
6. Do not mix navigation and tab semantics.
7. Do not use five different button styles for the same action priority.
8. Do not add raw hex colors inside feature components after tokens exist.
9. Do not migrate every component at once.
10. Do not treat screenshots as proof of accessibility.

## Professional typography system

### Font direction

Recommended pairing:

```text
Headings: Geist Sans or Sora
Body: Geist Sans or Inter
Code/console: Geist Mono
```

Keep the font stack boring enough to read and sharp enough to feel technical.

### Type tokens

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

### Type scale by surface

| Surface | Target |
| --- | --- |
| App/page title | `24px-32px` |
| Workspace subtitle | `14px` |
| Section title | `16px-20px` |
| Card title | `16px-18px` |
| Card body | `13px-14px` |
| Form label | `13px` |
| Form hint | `12px-13px` |
| Button text | `12px-14px` |
| Badge/chip label | `11px-12px` |
| Console message | `13px-14px` |
| Console metadata | `12px` |
| Decorative micro text | `11px`, only when not required for task completion |

## Contrast token proposal

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

## Component sizing standards

```css
:root {
  --control-height-compact: 32px;
  --control-height-default: 36px;
  --control-height-primary: 40px;
  --control-radius: 10px;
  --control-padding-x: 14px;
  --icon-button-size: 36px;
}
```

Use these sizes consistently:

| Component | Target |
| --- | --- |
| Primary button | `40px` height |
| Secondary button | `36px` height |
| Compact button | `32px` height |
| Icon button | `32px-36px` square |
| Input/select | `36px-40px` height |
| Status chip | `28px-32px` height |
| Navigation item | `40px+` interactive height |
| Dialog close button | `32px+` square |

## CSS cleanup target structure

Replace the long-term dependency on global cascade layers with this structure:

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

Use this procedure every time:

1. Capture current screenshot.
2. Identify every selector touching the component.
3. Move repeated values to tokens.
4. Create or reuse a primitive.
5. Move component-specific CSS beside the component.
6. Add a Storybook story or smoke fixture.
7. Cover normal, hover, focus, disabled, loading, success, warning, and error states.
8. Delete old selectors for that component from legacy theme files.
9. Run UI smoke.
10. Capture the new production screenshot.

## 50-point implementation plan

### Phase 1: Token foundation

1. Create `src/styles/tokens.css`.
2. Create `src/styles/typography.css`.
3. Create `src/styles/accessibility.css`.
4. Move core color values into semantic tokens.
5. Move font sizes and line heights into type tokens.
6. Move radii, shadows, borders, and spacing into tokens.
7. Add high-contrast mode tokens.
8. Add reduced-glow mode tokens.
9. Add compact/comfortable/spacious density tokens.
10. Import the new foundation files before legacy theme compatibility files.

### Phase 2: Contrast and readability

11. Audit `text-primary`, `text-secondary`, `text-muted`, and `text-subtle` on each surface.
12. Raise muted labels, chips, metadata, and table text to pass contrast.
13. Replace faint gray for real labels with a readable muted token.
14. Keep faint text only for decorative or disabled states.
15. Make placeholder text readable when it communicates meaning.
16. Make warning, success, and error text readable without glow.
17. Add color plus label/icon for status communication.
18. Add a high-contrast setting in Settings.
19. Add a reduced-glow setting in Settings.
20. Add a contrast smoke script for core token pairs.

### Phase 3: Typography and sizing

21. Raise body text minimum to `14px`.
22. Raise console/log text minimum to `13px`.
23. Raise badge/chip labels to at least `11px-12px`.
24. Raise form labels to at least `13px`.
25. Normalize button text to `12px-14px`.
26. Normalize page titles to `24px-32px`.
27. Normalize card titles to `16px-18px`.
28. Normalize line-height for descriptions and console messages.
29. Add a font-size smoke script to block sub-11px important UI text.
30. Add allowlisted exceptions only for decorative marks.

### Phase 4: Local UI primitives

31. Create `Button` primitive.
32. Create `IconButton` primitive.
33. Create `Card` or `Panel` primitive.
34. Create `Badge` primitive.
35. Create `StatusChip` primitive.
36. Create `Field`, `Input`, `Select`, and `Textarea` primitives.
37. Create `Dialog` primitive using Radix Dialog or React Aria Modal.
38. Create `Menu` primitive using Radix Dropdown Menu or React Aria Menu.
39. Create `Tooltip` primitive using Radix Tooltip.
40. Replace one-off button, field, badge, and card classes in one feature at a time.

### Phase 5: Layout and accessibility

41. Clean side rail semantics by removing tab roles unless using a true tablist.
42. Use `aria-current="page"` for active workspace navigation.
43. Verify the skip link is visible on focus.
44. Verify every icon-only button has an accessible name.
45. Make destructive actions visible and reviewable.
46. Move cron clearing and similar actions away from hidden right-click-only flows.
47. Verify keyboard access for Agents, Missions, Monitor, Plugins, Settings, and Console.
48. Verify reduced motion disables non-essential animations.
49. Capture production screenshots for Agents, Missions, Monitor, Plugins, Settings.
50. Freeze visual changes after beta screenshots and only patch regressions.

## Pass-by-pass implementation guide

### Pass 1: Fast readability repair

Files:

```text
src/styles/tokens.css
src/styles/typography.css
src/styles/accessibility.css
src/dystopai-app-theme.css
src/components/settings/uiSettings.ts
src/components/settings/SettingsPanel.tsx
```

Work:

```text
Add tokens.
Raise small text sizes.
Improve focus rings.
Increase muted text contrast.
Add high-contrast and reduced-glow modes.
Wire modes through Settings.
```

### Pass 2: Primitive layer

Files:

```text
src/components/ui/Button.tsx
src/components/ui/button.css
src/components/ui/IconButton.tsx
src/components/ui/icon-button.css
src/components/ui/Card.tsx
src/components/ui/card.css
src/components/ui/Field.tsx
src/components/ui/field.css
src/components/ui/Badge.tsx
src/components/ui/badge.css
src/components/ui/Dialog.tsx
src/components/ui/dialog.css
```

Work:

```text
Build local primitives.
Use Radix for Dialog, Menu, Tooltip, Popover.
Keep DystopAI visual styling through tokens.
Replace one-off primitives gradually.
```

### Pass 3: Shell and navigation

Files:

```text
src/components/layout/NexusShell.tsx
src/components/layout/shell.css
src/components/layout/rail.css
src/components/layout/workspace-header.css
```

Work:

```text
Remove mixed tab semantics from rail navigation.
Use nav + aria-current="page".
Standardize status chips.
Use Button/IconButton primitives.
Improve workspace title and description hierarchy.
```

### Pass 4: Monitor and command console

Files:

```text
src/components/monitor/AgentResponseConsole.tsx
src/components/monitor/LiveOperationMonitor.tsx
src/components/monitor/monitor.css
src/components/monitor/runtime-timeline.css
```

Work:

```text
Raise console and log text sizes.
Use icons and labels for status.
Normalize timeline spacing.
Improve quiet, offline, busy, warning, and failure states.
```

### Pass 5: Missions and plugins

Files:

```text
src/components/mission/MissionDeploymentPanel.tsx
src/components/mission/mission-panel.css
src/components/plugins/PluginsPanel.tsx
src/components/plugins/plugins-panel.css
```

Work:

```text
Group Missions by Goal, Agents, Timing, Evidence, Risk, Launch.
Separate destructive actions.
Show plugin states as Installed, Needs Auth, Disabled, Failed, Available.
Use consistent panels, badges, forms, and status chips.
```

### Pass 6: Settings as UI control center

Files:

```text
src/components/settings/SettingsPanel.tsx
src/components/settings/uiSettings.ts
src/components/settings/settings-panel.css
```

Work:

```text
Add High Contrast mode.
Add Reduced Glow mode.
Add Reduced Motion mode.
Add density controls.
Persist settings.
Apply settings before shell render when possible.
```

## Suggested packages

Install only what is used.

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-popover
npm install -D storybook @storybook/addon-a11y
```

Optional later:

```bash
npm install react-aria react-stately
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

## Contrast smoke script behavior

Create `scripts/smoke-ui-contrast-tokens.ts`.

Check these foreground/background pairs:

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

Fail if required text pairs are below `4.5:1`.

## Font-size smoke script behavior

Create `scripts/smoke-ui-font-sizes.ts`.

Rules:

```text
font-size < 11px: fail unless selector is allowlisted
font-size 11px: allow only for chips, metadata, or decorative microcopy
font-size 12px+: acceptable for compact UI
font-size 14px+: preferred for body and console text
```

Approved exception categories:

```text
screen-reader-only utilities
decorative background labels
third-party reset code
non-user-facing measurement helpers
```

## Acceptance criteria

```text
No important UI text under 12px.
No UI text under 11px except explicit decorative allowlist.
Core text tokens pass contrast checks.
Focus is visible on every interactive primitive.
Primary controls are at least 40px high.
Compact controls are at least 32px high.
Side rail uses clean nav semantics.
Dialogs and menus use accessible primitives.
Monitor and command console are readable at production density.
Settings can toggle density, reduced motion, high contrast, and reduced glow.
Production screenshots exist for Agents, Missions, Monitor, Plugins, and Settings.
No new global final override CSS files are added.
```

## Definition of done

This UI phase is complete when a new user can open DystopAI, read every major label without squinting, navigate by keyboard, understand runtime state at a glance, and trust that the interface is not hiding destructive actions or critical failures behind tiny dim text.

The product should still feel like DystopAI: dark, sharp, futuristic, and agent-command focused. The difference is that it should behave like a professional tool, not a screenshot-only concept.
