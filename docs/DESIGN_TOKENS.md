# Automnia AI Nexus Design Tokens

The interface uses a dark, restrained command-center system. The shared tokens in `src/styles/tokens.css` are the source of truth for baseline color, spacing, typography, focus, density, and motion decisions. Component styles should consume those tokens instead of hard-coding a new visual language.

## Colors

The application starts with a neutral graphite canvas and high-legibility light text. Cyan is reserved for intentional action and live information; green, amber, and red communicate success, attention, and failure. The Horizon Command Center layer (`99-horizon-command-center.css`) adds a calm action treatment while leaving the token-level semantic colors intact.

Use `--text-primary` for critical content, `--text-secondary` for normal support copy, and `--text-muted` or `--text-subtle` only for information that is safely de-emphasized. Status should never be communicated by color alone. Each selected rail destination may use its own restrained identity hue across its icon, surface, border, and a compact right-side dot. The selected rail item never uses a colored left marker or a left-edge chip.

## Spacing

Use the `--space-*` tokens for gaps and padding. Panels should group related controls with a compact inner rhythm, then use a larger section gap before the next decision group. Prefer 8px control rounding and 12px to 16px card rounding; only dialogs and major cards use the largest radius.

## Typography

Geist is the primary interface face and Geist Mono is used for identifiers, runtime output, and diagnostics. The typography scale lives in `src/styles/typography.css`. Body text must remain readable at its declared token size; new production UI must not introduce explicit font sizes below the `--dy-type-micro` 11px floor.

`95-typography-polish.css` is the compatibility layer that raises legacy utility classes into the supported scale. It loads before the final `99-horizon-command-center.css` and `100-operator-experience.css` layers, which must preserve that floor.

## Radii

Use the tokenized control radius for inputs and buttons. Operational cards use a medium radius, and major workspace containers and dialogs use the large radius. Keep related elements aligned to the same radius family so the hierarchy reads as one product rather than a collection of widgets.

## Motion

Use the motion duration tokens rather than bespoke animation timing. Transitions should support orientation, hover, and small state changes; they should not obscure runtime state. `data-dui-motion="reduced"` and the operating-system reduced-motion preference both suppress nonessential movement.

## Accessibility Notes

Every interactive control retains a visible keyboard focus ring. Text and surface token pairs are checked in `smoke-ui-contrast-tokens.ts`, and semantic status labels remain visible beside indicators. High-contrast, reduced-glow, density, and neutral-scrollbar options are controlled through UI settings and must be honored by new component work.

## CSS Ownership

Shared tokens and application-shell behavior belong in the ordered theme cascade. New layout-specific visual work should be component-owned CSS whenever it does not need to affect another feature. The final global layers, `99-horizon-command-center.css` and `100-operator-experience.css`, are reserved for system-wide visual rules; do not add a later global override without updating the smoke contracts and this document.
