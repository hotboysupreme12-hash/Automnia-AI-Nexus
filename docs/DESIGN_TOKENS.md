# DystopAI Design Tokens

This document is the human-readable contract for the UI tokens in `src/styles/tokens.css` and `src/styles/typography.css`. The global theme cascade is frozen at `95-typography-polish.css`; new visual work should prefer component-owned CSS imported beside the component.

## Colors

Surface tokens define the dark app stack:

- `--surface-0`: app canvas
- `--surface-1`: primary panels
- `--surface-2`: nested panels and controls
- `--surface-3`: raised controls and strong surfaces
- `--surface-overlay`: modal or overlay surface

Text tokens are ordered by emphasis:

- `--text-primary`: headings and critical values
- `--text-secondary`: standard body text
- `--text-muted`: helper text and secondary labels
- `--text-subtle`: compact labels that still need readable contrast
- `--text-disabled`: disabled copy only

Accent tokens carry semantic state:

- `--accent-cyan` and `--accent-blue`: information and focus accents
- `--accent-purple`: specialty or model/provider context
- `--accent-green`: success and healthy runtime state
- `--accent-yellow`: warning or attention state
- `--accent-red`: error, danger, and destructive actions

## Spacing

The spacing scale is intentionally small and regular:

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px

Density tokens adapt layout without rewriting components:

- `--density-panel-padding`
- `--density-section-gap`
- `--density-control-gap`

Use the density tokens for panels, sections, and form/control groups. Use the base spacing scale for one-off internal gaps.

## Typography

Typography lives in `src/styles/typography.css`, with compatibility reinforcement in `95-typography-polish.css`.

- `--font-size-2xs`: 11px, minimum micro text
- `--font-size-xs`: 12px, captions and chips
- `--font-size-sm`: 13px, compact controls
- `--font-size-md`: 14px, standard UI copy
- `--font-size-lg`: 16px, compact headings
- `--font-size-xl`: 20px, section titles
- `--font-size-2xl`: 24px, large section titles
- `--font-size-3xl`: 32px, workspace/page titles

Line-height tokens:

- `--line-tight`: compact headings
- `--line-title`: display titles
- `--line-body`: readable body copy
- `--line-relaxed`: long-form or dense explanatory copy

Do not introduce text below 11px. If old utility classes are present, the final typography layer raises them to the supported floor.

## Radii

Radii stay restrained so the app reads as an operational tool:

- `--radius-xs`: 4px
- `--radius-sm`: 6px
- `--radius-md`: 8px
- `--radius-lg`: 10px
- `--radius-xl`: 12px

Use `--radius-md` for normal cards and framed controls. Reserve `--radius-lg` and `--radius-xl` for prominent controls, dialogs, and established shell elements.

## Motion

Motion tokens live in `src/styles/tokens.css`:

- `--motion-duration-instant`: 0.001ms
- `--motion-duration-fast`: 120ms
- `--motion-duration-base`: 160ms
- `--motion-duration-slow`: 220ms
- `--motion-ease-standard`: standard UI easing
- `--motion-ease-out`: exit or settle easing

When `data-dui-motion="reduced"` is set, duration tokens collapse to `--motion-duration-instant`. `src/styles/accessibility.css` also enforces reduced motion for legacy transitions, animations, and user OS reduced-motion preferences.

## Accessibility Notes

- Focus rings use `--focus-ring`, `--focus-ring-shadow`, and `--focus-ring-fill`.
- High-contrast mode is driven by `data-dui-high-contrast="true"`.
- Reduced glow is driven by `data-dui-reduced-glow="true"`.
- Active workspace navigation uses `aria-current="page"`, not tab semantics.
