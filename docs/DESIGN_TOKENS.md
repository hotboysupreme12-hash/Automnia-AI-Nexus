# Automnia AI Design Tokens

This document is the human-readable contract for the UI tokens in `src/styles/tokens.css` and `src/styles/typography.css`.

Automnia AI uses a dark operational interface with semantic tokens for surfaces, text, accents, spacing, typography, radii, shadows, and motion.

## Token groups

- Surface tokens define the app canvas, panels, nested panels, raised controls, and overlays.
- Text tokens define primary, secondary, muted, subtle, and disabled copy.
- Accent tokens define information, focus, specialty, success, warning, and error states.
- Spacing tokens use a compact scale for panels, sections, and controls.
- Typography tokens define readable UI copy, captions, chips, headings, and page titles.
- Radius tokens keep the app feeling like an operational tool rather than a generic dashboard.

## Rules

- Prefer semantic tokens over one-off colors.
- Prefer component-owned CSS over new global override files.
- Do not introduce important text below the supported minimum size.
- Keep focus and state styles visible on dark backgrounds.
- Use density tokens for layout changes instead of rewriting components.
