<div align="center">

<img src="public/brand/automnia-ai-nexus-logo-transparent-cropped.png" alt="Automnia AI Nexus transparent logo" width="680" />

# Automnia AI

### A local-first desktop command center for hyper customizable agents

Build specialized agents. Give each one models, tools, workspaces, schedules, plugins, channels, memory, doctrine, and rules. Watch what they do in real time. Approve what matters.

**AI Nexus** · **Custom agents** · **Missions** · **Schedules** · **Plugins** · **Runtime monitor** · **Approval-first automation**

[User Guide](docs/USER_GUIDE.md) · [Beta Notes](docs/BETA_RELEASE_NOTES.md) · [Data Handling](DATA_HANDLING.md) · [Security](SECURITY.md) · [Release Governance](docs/RELEASE_GOVERNANCE.md)

</div>

## What is Automnia AI?

Automnia AI gives you the cockpit for running AI agents like a local operations team.

Instead of one endless chat thread, agents can have their own roles, personalities, model lanes, workspaces, tools, schedules, memories, skills, plugins, channels, and approval rules.

```text
Create agents.
Give each one a lane.
Send work.
Schedule missions.
Watch the runtime.
Approve important actions.
Read the evidence.
```

## Why it feels different

| One chat box | Automnia AI |
| --- | --- |
| One personality | Many specialized agents |
| One model choice | Per-agent model lanes and fallbacks |
| One messy history | Separate workspaces, sessions, doctrine, and memory |
| Blind waiting | Live runtime, Gateway, mission, plugin, and log visibility |
| Prompt and hope | Missions, schedules, approvals, and final reports |
| Manual babysitting | Recovery controls, status checks, and repeatable workflows |

## What you can build

| Build this | What it does |
| --- | --- |
| **Code crew** | Architect, builder, reviewer, tester, and release-check agents working inside one approved repo. |
| **Smart home operator** | Uses a smart-home CLI or plugin to watch power usage, lights, routines, and device state, then reports back through your preferred channel. |
| **Research desk** | Compares sources, separates facts from assumptions, and returns a decision-ready brief. |
| **Content studio** | Plans scripts, hooks, titles, descriptions, thumbnails, launch posts, and repurposed clips. |
| **Support desk** | Drafts replies, organizes customer context, flags urgent messages, and waits for approval before sending. |
| **Watcher** | Checks configured products, prices, releases, jobs, markets, alerts, or system signals on a cadence. |
| **Personal operator** | Plans weekly tasks, drafts notes, organizes reminders, and prepares errands for approval. |
| **Mission control** | Turns a goal into assigned agents, timing, risk, acceptance criteria, recovery, and proof. |

## Agent customization

| Customize | Examples |
| --- | --- |
| **Identity** | Builder, analyst, reviewer, marketer, support rep, commander, personal operator. |
| **Model lane** | Different primary models, fallbacks, thinking levels, timeouts, and provider setup. |
| **Workspace** | Give one agent a project folder, another a docs folder, another no file access at all. |
| **Doctrine** | Store agent rules, tone, memory, operating style, and mission instructions. |
| **Tools** | Browser, files, runtime, plugins, skills, channels, and service integrations where configured. |
| **Schedule** | Run now, run for a timed mission, repeat on cadence, or watch for changes. |

## Architecture at a glance

```text
Operator
  ↓
Automnia AI desktop cockpit
  ↓
Agents + Missions + Monitor + Plugins + Settings
  ↓
OpenClaw Gateway and runtime services
  ↓
Models · Files · Browser · Skills · Channels · External tools
```

The goal is simple: make powerful agent workflows visible, configurable, repeatable, and recoverable.

## Start simple

The README is the front door. The [User Guide](docs/USER_GUIDE.md) is the complete operating manual, including advanced workflows, provider setup, missions, plugins, recovery, screenshots, skills, channels, and configuration details.

```bash
git clone <this repository>
cd <this repository>
npm ci
npm run desktop
```

For deeper setup and advanced workflows, read:

- [User Guide](docs/USER_GUIDE.md)
- [Beta Release Notes](docs/BETA_RELEASE_NOTES.md)
- [Data Handling](DATA_HANDLING.md)
- [Security Policy](SECURITY.md)

## Current status

Automnia AI is a **public beta candidate** for Windows, macOS, and Linux. Packaged public beta readiness depends on hosted CI evidence, packaged launch proof, release validation, and beta screenshot artifacts.

| Area | Status |
| --- | --- |
| Local desktop app | Active |
| OpenClaw integration | Active |
| Agents and missions | Active |
| Runtime monitor | Active |
| Plugins and provider setup | Active |
| Public beta | Candidate, evidence-gated |
| Paid/stable release | Not yet |

### Interface preview

| Agents | Missions |
| --- | --- |
| ![Automnia AI Agents workspace](docs/assets/readme/automnia-ui-agents.png) | ![Automnia AI Missions workspace](docs/assets/readme/automnia-ui-missions.png) |

| Monitor | Plugins |
| --- | --- |
| ![Automnia AI Monitor workspace](docs/assets/readme/automnia-ui-monitor.png) | ![Automnia AI Plugins workspace](docs/assets/readme/automnia-ui-plugins.png) |

## Documentation map

| Need | Go here |
| --- | --- |
| Learn the app | [User Guide](docs/USER_GUIDE.md) |
| Understand beta limits | [Beta Release Notes](docs/BETA_RELEASE_NOTES.md) |
| Data and privacy model | [Data Handling](DATA_HANDLING.md) |
| Security reporting and local boundary | [Security](SECURITY.md) |
| Release rules | [Release Governance](docs/RELEASE_GOVERNANCE.md) |

## Pitch

**Automnia AI turns customizable agents into a visual local operations system: real missions, scheduled automation, plugin-powered workflows, live runtime visibility, and approval-first control, powered by OpenClaw.**
