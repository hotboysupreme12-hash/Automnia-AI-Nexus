# DystopAI Imagen prompt pack

Use these prompts to replace or expand the SVG artwork with high-end generated visuals. Keep the product accurate: local-first command center, agent teams, missions, monitor, plugins, approvals, and a premium graphite/neon interface.

## 1. Landing page hero image

```text
World-class SaaS landing page hero artwork for DystopAI, a local-first AI command center called Multi Model Nexus. Show a premium dark graphite desktop command center interface floating in depth, with specialized AI agent cards, a mission timeline, a live runtime monitor, plugin tiles, approval gates, and a subtle network of connected nodes. Visual mood: modern, clean, high-trust, product-led, developer/operator aesthetic, not fantasy, not cluttered. Color palette: deep graphite black, electric cyan, violet, soft magenta, tiny mint status lights. Composition: cinematic 16:10 website hero, lots of negative space for headline on the left, product UI on the right, crisp glass panels, elegant glow, professional SaaS launch page quality, full HD, ultra sharp, no logos from other companies, no fake text except short UI labels like Agents, Missions, Monitor, Plugins, Approval.
```

## 2. Open Graph social preview

```text
Premium Open Graph image for DystopAI Multi Model Nexus. Centered futuristic command center dashboard with five glowing lanes labeled Recruit, Agents, Missions, Monitor, Plugins. Dark graphite background with subtle grid, cyan/violet/magenta gradient glow, high contrast, clean SaaS product marketing style, polished enough for Product Hunt, GitHub, X, and LinkedIn sharing. Include small tasteful text: "DystopAI" and "Your AI team, controlled from one command center." No people, no robots, no messy sci-fi, no unreadable tiny text.
```

## 3. Product screenshot mockup

```text
Ultra-clean product screenshot mockup for a desktop app named DystopAI. Show a serious operator console with an active agent party, command console, mission queue, plugin status cards, and runtime monitor. UI style: professional graphite dashboard, strong spacing, readable typography, subtle neon accents, WCAG-friendly contrast, high-end React SaaS interface, no cartoon characters, no random crypto charts, no clutter. Must feel like a production-ready AI operations tool for builders and small teams.
```

## 4. Feature section illustration

```text
Minimal vector-style illustration for DystopAI feature section: one human operator controlling a local-first AI command network from a desktop app. Abstract agent nodes flow into missions, schedules, monitor logs, plugins, and approval gates. Dark background, clean geometry, cyan/violet/magenta accents, premium SaaS design, no dystopian horror, no surveillance vibe, no weapons, no scary faces.
```

## Negative prompt

```text
low quality, blurry, cartoonish, childish, horror, dystopian ruins, surveillance police state, humanoid robots dominating people, unreadable UI, random gibberish text, fake brand logos, crypto trading screens, overly busy neon cyberpunk alley, cluttered composition, broken typography, distorted monitors, messy icons, stock photo humans, generic chatbot bubbles only
```

## Recommended export sizes

- Hero: 2400 x 1500 PNG or WebP
- Open Graph: 1200 x 630 PNG
- Product mockup: 1800 x 1200 PNG or WebP
- Feature illustration: 1400 x 900 PNG or SVG-like style

## Where to place generated files

Put final images in:

```text
marketing/dystopai-website/assets/
```

Then update `index.html` to reference the new image instead of:

```html
./assets/dystopai-hero-art.svg
```
