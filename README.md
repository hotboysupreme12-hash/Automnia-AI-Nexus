<div align="center">

<img src="public/brand/automnia-ai-nexus-logo-transparent-cropped.png" alt="Automnia AI Nexus transparent logo" width="680" />

# Automnia AI

### A local AI operations nexus for configurable agents, missions, schedules, plugins, channels, and live runtime visibility

Automnia AI lets you run powerful agents like a local operations team. Use one flexible agent for broad help, build a specialist for every task, or combine both into focused workflows with clear roles, tools, workspaces, schedules, memory, plugins, channels, and approval rules.

**AI Nexus** · **Custom agents** · **Missions** · **Schedules** · **Plugins** · **Runtime monitor** · **Approval-first automation** · **Local-first control**

[User Guide](docs/USER_GUIDE.md) · [Beta Support](docs/BETA_SUPPORT.md) · [Beta Notes](docs/BETA_RELEASE_NOTES.md) · [Data Handling](DATA_HANDLING.md) · [Security](SECURITY.md) · [Release Governance](docs/RELEASE_GOVERNANCE.md)

</div>

## What is Automnia AI?

Automnia AI is a desktop cockpit for agent work. It connects the simple idea of asking an assistant for help with the deeper structure needed for repeatable, visible, recoverable automation.

You can keep it simple:

```text
Create an agent.
Give it a role.
Send a task.
Watch what happens.
Approve important actions.
Read the result.
```

Or you can build a small operating team:

```text
Recruit specialists.
Assign workspaces and tools.
Connect model routes and plugins.
Schedule recurring missions.
Send updates through compatible channels.
Use Monitor as the truth window.
```

The freedom is the point. One agent can handle many everyday tasks, while specialized agents can own precise lanes like code review, research, customer replies, store operations, content planning, or scheduled monitoring.

## How it feels in plain English

| Typical assistant app | Automnia AI |
| --- | --- |
| One long chat thread | A cockpit with agents, missions, schedules, plugins, and runtime evidence |
| One personality | One general operator, many specialists, or both |
| Hidden background work | Monitor views for Gateway health, sessions, logs, cron jobs, failures, and recovery |
| Manual repetition | Repeatable missions and scheduled workflows |
| Loose prompts | Agents with roles, workspaces, tools, doctrine, model lanes, and rules |
| Blind automation | Approval gates for high-impact actions |

## Interface showcase

<div align="center">
  <img src="docs/assets/readme/automnia-ui-agents.png" alt="Automnia AI Agents workspace" width="100%" />
</div>

<br />

<table>
  <tr>
    <td width="33%"><img src="docs/assets/readme/automnia-ui-missions.png" alt="Automnia AI Mission Control workspace" /></td>
    <td width="33%"><img src="docs/assets/readme/automnia-ui-monitor.png" alt="Automnia AI Monitor workspace" /></td>
    <td width="33%"><img src="docs/assets/readme/automnia-ui-plugins.png" alt="Automnia AI Plugins workspace" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Mission Control</strong></td>
    <td align="center"><strong>Monitor</strong></td>
    <td align="center"><strong>Plugins</strong></td>
  </tr>
</table>

## Example workflows

| Workflow | What the agents handle |
| --- | --- |
| **Code crew** | Architect, builder, reviewer, tester, and release-check agents working inside an approved repo. |
| **Customer support desk** | Review incoming messages, prepare replies, organize context, and route follow-ups through configured tools. |
| **Store operator** | Inspect inventory, orders, website data, SEO tasks, product details, and promotion ideas through compatible store tooling. |
| **Content studio** | Plan scripts, hooks, titles, descriptions, thumbnails, launch posts, and media workflows through configured tools. |
| **Research desk** | Compare sources, separate facts from assumptions, and return a decision-ready brief. |
| **Watcher** | Check products, prices, releases, jobs, markets, alerts, or system signals on a cadence. |
| **Personal operator** | Prepare plans, reminders, drafts, notes, summaries, and routine check-ins for review. |
| **Mission control** | Turn a goal into assigned agents, timing, risk, acceptance criteria, recovery steps, and proof. |

## Agent customization

| Area | What you can tune |
| --- | --- |
| **Identity** | Name, role, description, personality, tone, and operating style. |
| **Model lane** | Primary model, fallback model, provider route, thinking level, timeout, and runtime behavior. |
| **Workspace** | A repo, docs folder, content folder, support export, store data folder, or no file access. |
| **Doctrine** | Rules, memory notes, approval policy, response style, and mission instructions. |
| **Tools** | Files, browser tools, runtime actions, skills, plugins, provider routes, and compatible channel tools. |
| **Schedule** | Run now, run once later, repeat on cadence, watch for changes, or loop until stopped. |

## Architecture map

```mermaid
flowchart TD
    Operator[Operator] --> Cockpit[Automnia AI Desktop Cockpit]
    Cockpit --> UI[Interface: Agents, Missions, Monitor, Plugins]
    UI --> API[Local Control Plane API]
    API --> Services[Service Layer]

    Services --> State[Local State<br/>agents, workspaces, ledgers, reports]
    Services --> Runtime[OpenClaw Gateway]
    Services --> Monitor[Monitor Evidence<br/>runs, sessions, logs, cron, failures]
    Services --> Approval{Approval needed?}

    Runtime --> Models[Model Providers<br/>and Local Routes]
    Runtime --> Tools[Tools, Skills<br/>and Plugins]
    Runtime --> Channels[Compatible Channels<br/>chat, SMS-style flows, webhooks, team tools]

    Approval -->|review| Operator
    Approval -->|approved| Runtime
```

<details>
<summary><strong>How the pieces fit together</strong></summary>

| Piece | Plain meaning |
| --- | --- |
| **Desktop cockpit** | The local app where the operator creates agents, runs missions, checks Monitor, and manages plugins. |
| **Interface** | React, Vite, and Electron surfaces for the agent roster, mission control, monitor, settings, and plugin views. |
| **Control Plane API** | The local backend boundary for app actions, runtime status, files, auth, provider setup, missions, and diagnostics. |
| **Service layer** | Focused backend services for Gateway lifecycle, runtime recovery, missions, providers, plugins, filesystem, browser, and agent turns. |
| **OpenClaw Gateway** | The runtime path for agent sessions, tools, plugins, compatible channels, and model/provider routes. |
| **Monitor evidence** | The operator view of what ran, what is running, what failed, what recovered, and what proof came back. |
| **Approval loop** | A human review point before important actions execute. |

</details>

## Start simple

Recommended runtime: Node.js 24, or Node.js 22.19+ for compatibility.

```bash
git clone <this repository>
cd <this repository>
npm ci
npm run desktop
```

For complete setup, read the [User Guide](docs/USER_GUIDE.md). For beta testing, recovery, and feedback details, read [Beta Support](docs/BETA_SUPPORT.md).

## Current status

Automnia AI is a **public beta** for Windows, macOS, Linux, and source-based validation paths. Packaged support can vary by build, so beta reports should always include the exact build target being tested.

## Documentation map

| Need | Go here |
| --- | --- |
| Learn the app | [User Guide](docs/USER_GUIDE.md) |
| Test a beta build or send feedback | [Beta Support](docs/BETA_SUPPORT.md) |
| Understand beta limits | [Beta Release Notes](docs/BETA_RELEASE_NOTES.md) |
| Understand data boundaries | [Data Handling](DATA_HANDLING.md) |
| Report security issues | [Security](SECURITY.md) |
| Review release rules | [Release Governance](docs/RELEASE_GOVERNANCE.md) |

## Release evidence

Public release candidates must run through the hosted release workflows. Validate packaged artifacts with `npm run release:validate`, then generate detached release evidence with `npm run release:sign` using an Ed25519 key from `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE` or `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM`; public-release runs keep `DYSTOPAI_RELEASE_REQUIRE_SIGNING` enabled so missing signing material fails closed. Public release validation also requires consumer distribution signing evidence in `distribution-signing.json` before publishing.

## Product synopsis

**Automnia AI is a local AI operations nexus for building, running, scheduling, and monitoring powerful agents. It gives you the choice to run one general agent, a team of specialists, or highly focused workflows with tools, plugins, channels, memory, evidence, and human approval where it matters.**
