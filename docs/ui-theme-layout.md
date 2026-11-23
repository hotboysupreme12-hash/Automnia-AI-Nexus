# UI theme and layout

The renderer loads `src/automnia-app-theme.css` as an ordered set of style
imports. `src/styles/tokens.css` defines shared control and spacing values;
`src/styles/typography.css` defines the type scale. The numbered theme files
then add component and responsive rules. Later rules, selector specificity and
`!important` can change the final result, so inspect computed styles before
changing a token or adding an override. Agent card appearance also depends on
the selected card theme; avoid replacing its colors with global layout rules.

Electron applies operating-system display scaling and a separate renderer zoom.
New profiles start at 100%; a saved user zoom remains authoritative. Ctrl+0
(Command+0 on macOS) resets renderer zoom, and Ctrl/Command plus or minus
changes it. A smaller zoom should not be required to make the layout fit.

Agent Chat is the startup workspace and remains mounted when navigating, so
switching tabs does not discard an in-progress draft. Its profile strip uses
the actual available width and scrolls horizontally when needed. The separate
registry uses its available grid width to choose its column count. The mission
editor and Workboard use natural document height so their contents can scroll
without competing for a fixed viewport. When checking a change, exercise narrow, short, wide and portrait
windows, resized panes, long text and increased zoom. Verify actual computed
sizes, wrapping, scroll access and controls, including the mission editor and
settings; a screenshot or a stylesheet check alone does not prove that every
screen fits. Run `npm run build:client` and `npm run smoke:ui` for the existing
renderer smoke checks. After building, `node_modules/.bin/electron
scripts/smoke-responsive-grid.cjs` also checks grid reflow at three pane widths.

For comparison, a static inspection of selected integrity-checked styles from
the installed ChatGPT/Codex package found shared font-size and spacing tokens,
including a quarter-rem spacing unit and small and medium text values of
0.875rem and 1rem. Its styles use shrinkable `minmax(0, 1fr)` tracks and
responsive content-width limits. These are patterns, not proof of the computed
styles of every screen. REA analyzed a JavaScript asset from that subset; the
CSS observations came from a separate static inspection. REA's full-package
analysis stopped on an integrity mismatch in an unpacked native dependency.

## ChatGPT Desktop REA Parity Architecture

The UI architecture integrates findings from the ChatGPT desktop reverse-engineering analysis (`OpenAI.Codex`):

1. **Window Drag Regions**: Top chrome (`.dy-brand-strip`, `.automnia-titlebar`, `.dy-shell-header`) defines `-webkit-app-region: drag` while isolating controls (`button`, `input`, `select`, `[role="button"]`, tabs) with `-webkit-app-region: no-drag`.
2. **Visibility Handoff**: `data-window-state="ready"` prevents dark-to-light flicker and unstyled layout jumps during Electron/browser hydration.
3. **Focus Accessibility**: High-contrast `:focus-visible` outlines ensure keyboard navigation compliance while eliminating pointer focus-ring noise (`:focus:not(:focus-visible)`).
4. **Streaming Message Stabilization**: Agent conversation bubbles and execution console entries use `contain: paint` and `content-visibility: auto` to prevent cumulative layout reflows during token streaming.
5. **Sidecar / Companion Viewport**: Narrow desktop viewport rules adapt the chat and human rail seamlessly for sidecar split-screen coding (480px-720px).

