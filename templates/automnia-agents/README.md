# Automnia Agent Templates

This is the maintained Automnia template library for recruited agents.

## Structure

- Each top-level folder is an agent division.
- Each division contains one Markdown file per reusable agent template.
- `divisions.json` defines division labels and colors.
- `tools.json` defines optional install targets used by the Recruit catalog.

## Runtime contract

Automnia Recruit scans this directory and converts each template into an agent workspace containing:

- `AGENTS.md` for operating rules and deliverables
- `IDENTITY.md` for stable identity facts
- `SOUL.md` for voice and behavior
- `TOOLS.md` for capabilities and runtime services
- `BOOTSTRAP.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`, and `MISSION_PROMPT.md`

New agents should reference these Automnia templates through the generated workspace files. Keep source attribution and product language Automnia-owned.
