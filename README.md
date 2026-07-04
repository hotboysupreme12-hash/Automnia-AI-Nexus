<div align="center">

<img src="public/brand/automnia-ai-nexus-logo-transparent-cropped.png" alt="Automnia AI Nexus transparent logo" width="680" />

# DystopAI Core

### A local-first desktop command center for OpenClaw agents

Build custom agents. Give them models, tools, workspaces, schedules, plugins, channels, and rules. Watch what they do in real time. Approve what matters.

**Multi Model Nexus** · **Custom agents** · **Missions** · **Schedules** · **Plugins** · **Runtime monitor** · **Approval-first automation**

[User Guide](docs/USER_GUIDE.md) · [Beta Notes](docs/BETA_RELEASE_NOTES.md) · [Data Handling](DATA_HANDLING.md) · [Security](SECURITY.md) · [Release Governance](docs/RELEASE_GOVERNANCE.md)

</div>

<p align="center">
  <img src="docs/assets/readme/dystopai-agents.png" alt="DystopAI Agents workspace with active party, roster, and command console" width="1200" />
</p>

> [!IMPORTANT]
> DystopAI controls real local workflows. Keep the Control Plane and OpenClaw Gateway on loopback, use test credentials while experimenting, and keep approval gates on for messages, purchases, deletes, deployments, account changes, GitHub pushes, and anything that affects other people.

## What is DystopAI?

OpenClaw gives you the agent engine. **DystopAI gives you the cockpit.**

DystopAI is a standalone desktop app for creating, operating, scheduling, and monitoring OpenClaw agents from one visual control center. Instead of living inside one endless chat thread, your agents can have their own roles, personalities, models, tools, workspaces, memories, schedules, and permissions.

The simple version:

```text
Create agents.
Give each one a lane.
Send work.
Schedule missions.
Watch the runtime.
Approve high-impact actions.
Read the evidence.
```

DystopAI is for people who want AI agents to feel less like a chatbot tab and more like a local operations desk.

## Why it is different

| One chat box | DystopAI |
| --- | --- |
| One personality | Many specialized agents |
| One model choice | Per-agent model lanes and fallbacks |
| One messy history | Separate workspaces, sessions, and doctrine |
| Blind waiting | Live runtime, Gateway, mission, plugin, and log visibility |
| Prompt and hope | Missions, schedules, approvals, and final reports |
| Manual babysitting | Recovery controls, status checks, and repeatable workflows |

## What you can build

| Build this | What it does |
| --- | --- |
| **Code crew** | Architect, builder, reviewer, tester, and release-check agents working inside one approved repo. |
| **Research desk** | A researcher compares sources, an analyst summarizes tradeoffs, and a reviewer calls out assumptions. |
| **Content studio** | Script writer, title generator, thumbnail planner, editor, and publishing assistant. |
| **Support desk** | Drafts replies, organizes context, flags urgent messages, and waits for approval before sending. |
| **Market or product watcher** | Checks configured sources on a schedule and reports only meaningful changes. |
| **Personal operator** | Plans weekly tasks, drafts emails, organizes reminders, and prepares errands for approval. |
| **Plugin command layer** | Uses compatible provider, browser, memory, tool, and channel plugins when configured. |
| **Mission control** | Turns a goal into assigned agents, timing, risk, acceptance criteria, recovery, and proof. |

You can keep it tiny with one careful assistant or go full command-room with a team of agents. The point is control: pick the agent, pick the model, pick the workspace, pick the tools, pick the risk level.

## Agent customization

Every agent can be shaped for a different kind of work:

| Customize | Examples |
| --- | --- |
| **Identity** | Builder, analyst, reviewer, marketer, support rep, commander, personal operator. |
| **Model lane** | Different primary models, fallbacks, thinking levels, timeouts, and provider auth. |
| **Workspace** | Give one agent a project folder, another a docs folder, another no file access at all. |
| **Doctrine** | Store agent rules, tone, memory, operating style, and mission instructions. |
| **Tools** | Browser, files, runtime, plugins, skills, channels, and service integrations where configured. |
| **Permissions** | Keep destructive, outbound, or account-changing actions behind approval. |
| **Schedule** | Run now, run for a timed mission, repeat on cadence, or watch for changes. |

This is the core idea: agents are not just different names in the same chat. They are configurable workers with lanes.

## Workflows that make DystopAI click

### Ship a code change with a tiny agent team

```text
Architect: define the safest change path.
Builder: make the focused edit.
Reviewer: check regressions and risk.
Tester: run the verification command.
Commander: summarize the evidence.
```

### Turn a vague goal into a mission

```text
Goal: improve this repo for beta.
Agents: architect + builder + reviewer.
Rules: do not touch vendor files, keep evidence, stop if tests fail.
Report: changed files, commands run, failures, risks, next action.
```

### Run a watcher while you sleep

```text
Every morning, check configured signals.
Ignore noise.
Report only changes that need attention.
Draft the next action.
Wait for approval.
```

### Use channels as a command layer

Desktop is the deep control surface. Compatible channels can become the remote command layer: chat, SMS, team tools, webhooks, voice-style flows, or future plugin channels. Availability depends on the plugins, credentials, and OpenClaw runtime you configure.

## Core surfaces

| Surface | Why you open it |
| --- | --- |
| **Agents** | Recruit, edit, deploy, and command specialized agents. |
| **Missions** | Turn goals into structured work with timing, risk, and proof. |
| **Monitor** | See Gateway health, running work, logs, cron jobs, plugin activity, failures, and recovery controls. |
| **Plugins** | Connect models, tools, channels, memory, browser flows, and service integrations. |
| **Settings** | Tune runtime policy, UI density, motion, contrast, defaults, and local preferences. |

<p align="center">
  <img src="docs/assets/readme/dystopai-missions.png" alt="DystopAI Missions workspace" width="49%" />
  <img src="docs/assets/readme/dystopai-monitor.png" alt="DystopAI Monitor workspace" width="49%" />
</p>

<p align="center">
  <img src="docs/assets/readme/dystopai-plugins.png" alt="DystopAI Plugins workspace" width="49%" />
  <img src="docs/assets/readme/dystopai-agent-settings.png" alt="DystopAI Agent Settings workspace" width="49%" />
</p>

## Start simple

For the full walkthrough, use the [User Guide](docs/USER_GUIDE.md). The README is the front door; the User Guide is the manual.

### Use a packaged beta build

When a qualified beta build is published, download it from [Releases](https://github.com/hotboysupreme12-hash/DystopAI-Core/releases), read the [Beta Notes](docs/BETA_RELEASE_NOTES.md), then start with one provider and one agent.

### Run from source

Recommended runtime: **Node.js 24**.

```bash
git clone https://github.com/hotboysupreme12-hash/DystopAI-Core.git
cd DystopAI-Core
npm ci
npm run desktop
```

For deeper setup, provider auth, missions, plugins, recovery, screenshots, and beta caveats, read:

- [User Guide](docs/USER_GUIDE.md)
- [Beta Release Notes](docs/BETA_RELEASE_NOTES.md)
- [Data Handling](DATA_HANDLING.md)
- [Security Policy](SECURITY.md)

## Local-first boundary

DystopAI is built around a trusted local-operator model.

By default, local DystopAI and OpenClaw state live on your machine:

```text
~/.dystopai-control-center
~/.openclaw
```

Data can leave your machine when you connect outside systems: model providers, OAuth accounts, plugin services, browser tools, webhooks, communication channels, or feedback reports you choose to send.

Keep these surfaces local unless you are deliberately building a different security model:

```text
Control Plane API: 127.0.0.1:4050
Development frontend: 127.0.0.1:5173
OpenClaw Gateway: 127.0.0.1:18789
```

Do not expose the local API or Gateway to the public internet. Use supported channel plugins and explicit approvals for remote workflows.

## Current status

DystopAI Core is a **Public Beta Candidate**. The codebase is actively moving toward a broader beta, but stable public release depends on hosted CI evidence, packaged launch proof, release validation, and beta screenshot artifacts.

| Area | Status |
| --- | --- |
| Local desktop app | Active |
| OpenClaw integration | Active |
| Agents and missions | Active |
| Runtime monitor | Active |
| Plugins and provider auth | Active |
| Public beta | Candidate, evidence-gated |
| Paid/stable release | Not yet |

See [Release Governance](docs/RELEASE_GOVERNANCE.md), [Beta Release Notes](docs/BETA_RELEASE_NOTES.md), and [Next 30-Point Production Plan](docs/NEXT_30_POINT_PRODUCTION_PLAN.md) for the release path.

## Documentation map

| Need | Go here |
| --- | --- |
| Learn the app | [User Guide](docs/USER_GUIDE.md) |
| Understand beta limits | [Beta Release Notes](docs/BETA_RELEASE_NOTES.md) |
| Data and privacy model | [Data Handling](DATA_HANDLING.md) |
| Security reporting and local boundary | [Security](SECURITY.md) |
| Release rules | [Release Governance](docs/RELEASE_GOVERNANCE.md) |
| Production next steps | [Next 30-Point Plan](docs/NEXT_30_POINT_PRODUCTION_PLAN.md) |
| OpenClaw docs snapshot | [OpenClaw Docs Snapshot](docs/openclaw-latest/README.md) |

## The one-sentence pitch

**DystopAI turns OpenClaw agents into a visual local operations system: custom workers, real missions, scheduled automation, plugin-powered workflows, live runtime visibility, and approval-first control.**
