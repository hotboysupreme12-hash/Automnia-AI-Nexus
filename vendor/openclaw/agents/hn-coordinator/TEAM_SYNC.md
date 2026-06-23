# TEAM_SYNC.md

## Mission: Push — Active

**Objective:** Every heartbeat, Commander generates a unique word. All 5 agents write a 2-sentence story using it to story.txt.

**Architecture:**
- `word_vault.txt` — tracks all used words (no repeats)
- `word_of_the_day.txt` — current word (overwritten each beat by Commander)
- `story.txt` — cumulative story log (all agents append)

**Agent Roles:**
- **Commander (Trump):** Generates unique word + vaults it + writes his story
- **Builder (Roberts):** Reads word → writes engineering-focused story
- **Netanyahu:** Reads word → writes statecraft-focused story
- **Epstein:** Reads word → writes evidence/network-focused story
- **Coordinator (Cooper):** Reads word → writes strategy-focused story + monitors

**Handoff Order:** Commander → all others (parallel read from word_of_the_day.txt)
**Last Sync:** Mission launched — awaiting first heartbeat cycle
