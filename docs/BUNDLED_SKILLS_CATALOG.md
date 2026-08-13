# Automnia Bundled OpenClaw Skills Catalog

This catalog summarizes the skills bundled with the OpenClaw runtime included
in this repository. A listed skill is not automatically usable by every agent:
OpenClaw filters skills by agent configuration, operating system, installed
binaries, credentials, connected plugins, and policy. In Automnia, inspect and
enable applicable skills from **Agents > card > Edit > Skills**, then use a
small read-only Command Console test.

## Work, research, and automation

| Skill | What it helps an agent do |
| --- | --- |
| `browser-automation` | Run careful multi-step web research and browser workflows. |
| `coding-agent` | Delegate substantial coding work to a configured coding worker. |
| `diagram-maker` | Produce SVG, HTML, or Excalidraw diagrams. |
| `github`, `gh-issues` | Work with GitHub repositories, issues, PRs, reviews, checks, and release flows. |
| `mcporter` | Inspect, configure, authenticate, and call MCP servers/tools. |
| `oracle`, `spike` | Run a second-model review or a throwaway feasibility experiment. |
| `taskflow`, `taskflow-inbox-triage` | Coordinate durable multi-step work and inbox triage with waits/hand-offs. |
| `tmux` | Safely manage interactive terminal sessions and long-running CLIs. |
| `healthcheck`, `node-connect` | Diagnose and harden an OpenClaw host or device pairing path. |
| `session-logs` | Search the agent’s own prior session logs when authorized. |
| `skill-creator` | Create, audit, validate, and improve reusable `SKILL.md` bundles. |

## Google, mail, planning, and knowledge work

| Skill | What it helps an agent do |
| --- | --- |
| `gog` | Work with Gmail, Calendar, Drive, Contacts, Sheets, and Docs after Gog OAuth setup. |
| `himalaya` | Use an IMAP/SMTP mailbox for search, drafts, replies, folders, and mail management. |
| `goplaces` | Query Google Places for businesses, details, reviews, and location research. |
| `notion`, `trello` | Work with Notion content/data sources or Trello boards, lists, cards, and comments. |
| `obsidian`, `obsidian-vault-maintainer`, `wiki-maintainer` | Maintain notes and structured memory/wiki vaults. |
| `apple-notes`, `bear-notes` | Work with Apple Notes or Bear notes on supported macOS setups. |
| `apple-reminders`, `things-mac` | Manage reminders, tasks, projects, lists, and tags on macOS. |
| `blogwatcher` | Monitor RSS/Atom feeds and blogs for updates. |
| `summarize` | Summarize articles, URLs, PDFs, podcasts, transcripts, local files, and YouTube/video sources. |

## Content, audio, image, and video

| Skill | What it helps an agent do |
| --- | --- |
| `video-frames` | Extract frames or short clips from video with ffmpeg. |
| `songsee` | Generate audio spectrograms and feature panels. |
| `gifgrep`, `meme-maker` | Find GIFs or create memes from templates. |
| `nano-pdf` | Edit PDFs from natural-language instructions through its CLI. |
| `openai-whisper`, `openai-whisper-api` | Transcribe audio locally or through OpenAI’s audio API. |
| `sag`, `sherpa-onnx-tts` | Generate speech through ElevenLabs or local/offline TTS. |
| `gemini` | Use Gemini CLI for supported one-shot, tool, MCP, or generation tasks. |
| `canvas` | Present and debug HTML on connected OpenClaw canvas nodes. |

## Messaging, devices, and personal integrations

| Skill | What it helps an agent do |
| --- | --- |
| `imsg` | Work with iMessage/SMS on a supported macOS host. |
| `1password` | Use 1Password CLI/desktop integration for secrets without exposing them in prompts. |
| `camsnap` | Capture frames/clips from RTSP or ONVIF cameras. |
| `openhue`, `sonoscli`, `blucli`, `eightctl` | Control supported lights, speakers, BluOS systems, or Eight Sleep devices. |
| `spotify-player` | Search and control terminal Spotify playback. |
| `weather` | Get weather and forecast data. |
| `ordercli` | Check supported food-order history/status. |
| `peekaboo` | Capture and automate supported macOS UI workflows. |
| `xurl` | Use authenticated X API workflows for posts, replies, messages, media, and search. |

## Developer and system utilities

| Skill | What it helps an agent do |
| --- | --- |
| `node-inspect-debugger`, `python-debugpy` | Debug Node.js or Python processes. |
| `model-usage` | Summarize local Codex/Claude model-usage logs. |
| `dotenv`, `dotenvx` | Follow safe environment-variable and encrypted-env workflows. |
| `clawhub` | Search, verify, install, update, publish, and sync skills through the ClawHub model. |
| `open-prose` | Run OpenProse-oriented multi-agent programs where configured. |

## Important capability boundaries

- `gog` can prepare Gmail drafts and inspect Workspace data after OAuth; sending
  email, calendar changes, and data edits still need the user’s authorization.
- `summarize` and browser skills can support YouTube research and content
  planning. They do not mean that an agent can automatically publish to a
  YouTube channel.
- `imsg` and `ClawTalk` are different phone/message routes. ClawTalk is an
  Automnia plugin for phone/SMS work; `imsg` is a supported macOS iMessage/SMS
  CLI path. Configure and test either route before an agent contacts anyone.
- A skill may be visible but ineligible until its required binary, API, plugin,
  OS feature, or OAuth scope is configured. Treat `ready`/runtime evidence as
  the source of truth.
- New ClawHub skills are third-party instruction bundles. Review their source,
  permissions, required credentials, version, and scan state before installation.
