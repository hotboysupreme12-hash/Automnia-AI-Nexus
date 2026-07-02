# DystopAI marketing website

This folder contains a standalone, deployable marketing website for DystopAI.

It is intentionally separate from the Electron/Vite desktop app so the marketing site can launch on a normal web host while the app stays local-first.

## What this adds

- `index.html` - complete SaaS-style landing page
- `styles.css` - responsive graphite/neon visual system
- `main.js` - mobile navigation, sticky header, interactive product demo tabs, local preview form message
- `assets/dystopai-hero-art.svg` - generated product-style hero art
- `assets/dystopai-favicon.svg` - generated favicon
- `IMAGEN_PROMPTS.md` - Imagen-ready prompt pack for a production hero image, OG image, and product screenshot mockups

## Product story used

DystopAI is presented as a local-first AI operations system where users can:

1. Recruit specialized agents.
2. Give each agent a role, model, workspace, tools, schedule, and rules.
3. Launch structured missions.
4. Schedule recurring or watch-style work.
5. Monitor live runtime state, logs, sessions, failures, approvals, plugins, and channels.
6. Keep important actions behind approval gates.
7. Use plugins and compatible channels without making the core app cloud-dependent.

The page maps directly to the app lanes:

- Recruit
- Agents
- Missions
- Monitor
- Plugins

## Research-informed design choices

The page uses modern SaaS launch patterns:

- One primary CTA: founder access.
- Product-as-proof hero instead of vague AI art alone.
- Interactive demo panel above the fold area.
- Plain-language problem and solution sections.
- Transparent beta pricing concept.
- Waitlist/signup form for early demand capture.
- Dark developer/operator aesthetic inspired by tools like Bridge, without copying its layout.
- Trust-first local-first copy so users understand what is local, what uses providers, and what needs approval.

## Preview locally

From the repo root:

```bash
cd marketing/dystopai-website
python -m http.server 4174
```

Then open:

```text
http://127.0.0.1:4174
```

The form shows a preview message locally. It does not capture leads until connected to a live form service or API.

## Make the signup form live

### Option A: Netlify Forms

The form already includes:

```html
<form name="dystopai-founder-access" method="POST" data-netlify="true" netlify>
  <input type="hidden" name="form-name" value="dystopai-founder-access" />
</form>
```

Deploy this folder to Netlify, enable form detection, and submissions will appear in the Netlify dashboard.

### Option B: Formspree, Tally, Loops, or ConvertKit

Replace the form target with the provider endpoint or embed. Keep the same fields:

- name
- email
- role
- platform
- first_agent
- plan

### Option C: Supabase or custom API

Use the same form fields, then submit to your backend route. Recommended later flow:

1. Landing page captures early access interest.
2. Google sign-in proves identity.
3. Stripe proves subscription status.
4. Backend grants or denies app access.
5. Desktop app receives a scoped access token.

## Deploy options

### GitHub Pages

GitHub Pages can host the static site, but the signup form will need an external form provider or custom endpoint.

### Netlify

Best low-friction option for this exact static form because the HTML already includes Netlify form attributes.

### Vercel or Cloudflare Pages

Good for static hosting. Use a serverless function, Supabase table, or third-party form endpoint for lead capture.

## Copy direction

Primary headline:

> Your AI team, controlled from one command center.

Primary subheadline:

> DystopAI turns one-off chats into a local-first operations desk where specialized agents can work, schedule missions, watch signals, use plugins, and report what happened with proof.

Primary CTA:

> Join founder access

Secondary CTA:

> Explore the command center

## Next production steps

1. Add your real public domain.
2. Replace beta pricing if needed.
3. Connect the signup form.
4. Add release screenshots or a short demo video.
5. Add privacy policy, terms, and data handling links.
6. Add analytics only after you decide what privacy posture you want.
7. Connect account creation after the billing/access backend is ready.

## Notes

No binary blobs or base64 assets are included. The generated art is clean SVG, so it is reviewable in Git and easy to replace later.
