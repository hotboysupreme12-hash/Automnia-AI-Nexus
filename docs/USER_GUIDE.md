# Automnia AI User Guide

Last updated: 2026-07-04

Automnia AI is a local-first command center for operating hyper customizable OpenClaw agent teams. Use it to create agents, assign model lanes, connect workspaces, launch missions, schedule recurring jobs, manage plugins, route compatible channels, and monitor runtime health from one desktop cockpit.

This guide is the operating manual. The README is the front door; this document is where setup, advanced workflows, troubleshooting, and feature details live.

## Table of Contents

- [Operating Model](#operating-model)
- [Quick Start](#quick-start)
- [Main Surfaces](#main-surfaces)
- [Agents](#agents)
- [Model Setup](#model-setup)
- [Workspaces](#workspaces)
- [Command Console](#command-console)
- [Missions](#missions)
- [Schedules And Cadence](#schedules-and-cadence)
- [Monitor And Recovery](#monitor-and-recovery)
- [Plugins](#plugins)
- [Channels](#channels)
- [Skills And Doctrine](#skills-and-doctrine)
- [Advanced Workflows](#advanced-workflows)
- [Compatibility](#compatibility)
- [Troubleshooting](#troubleshooting)
- [Glossary](#glossary)

## Operating Model

Automnia AI works best when you treat it like an AI operations desk:

1. **Agents** hold identity, model, workspace, policy, memory, skills, and doctrine.
2. **Active Party** slots decide which agents are armed for group work.
3. **Command Console** sends direct live turns to one agent, selected agents, or the confirmed party.
4. **Missions** turn a goal into structured work with timing, risk, readiness, and proof.
5. **Plugins** add providers, tools, browser flows, memory, skills, services, and channels.
6. **Monitor** shows Gateway health, running calls, cron jobs, channel activity, logs, failures, and recovery actions.
7. **Approval gates** keep high-impact work under operator control.

```text
Operator
  -> Automnia AI desktop cockpit
  -> Agents + Missions + Monitor + Plugins + Settings
  -> OpenClaw Gateway and runtime services
  -> Models, files, browser tools, skills, channels, and external systems
```

## Quick Start

1. Start the app.
   - Packaged desktop: open Automnia AI.
   - Development web surface: run `npm ci`, then `npm run dev`.
   - Desktop development shell: run `npm run desktop`.

2. Connect model access.
   - Open an agent with `Edit`.
   - Pick a primary model and fallback models.
   - Complete the provider setup needed by that model.

3. Build a party.
   - Open `Agents`.
   - Deploy one or more agents into party slots.
   - Keep Slot 1 as the lead when work needs command, delegation, or review.
   - Confirm the party before party-wide turns or missions.

4. Run a tiny proof.

```text
Review this folder at a high level. Tell me what you inspected, what looks risky, and one next step.
```

5. Open Monitor.
   - Confirm Gateway state.
   - Check active run/session evidence.
   - Read logs and final output.

6. Launch missions only after the basic direct path works.

## Main Surfaces

| Surface | Use it for |
| --- | --- |
| **Recruit** | Create a new agent profile and bootstrap doctrine. |
| **Agents** | Browse the roster, deploy the party, edit agents, and run the Command Console. |
| **Missions** | Define structured objectives, dispatch modes, cadence, readiness, and proof. |
| **Monitor** | Inspect Gateway health, active calls, cron jobs, channel activity, logs, and recovery controls. |
| **Plugins** | Manage providers, tools, communication channels, skills, browser automation, and runtime surfaces. |
| **Settings** | Tune runtime policy, UI density, motion, contrast, defaults, and local preferences. |

### Screenshots

| Agents | Missions |
| --- | --- |
| ![Automnia AI Agents workspace](assets/readme/automnia-ui-agents.png) | ![Automnia AI Missions workspace](assets/readme/automnia-ui-missions.png) |

| Monitor | Plugins |
| --- | --- |
| ![Automnia AI Monitor workspace](assets/readme/automnia-ui-monitor.png) | ![Automnia AI Plugins workspace](assets/readme/automnia-ui-plugins.png) |

## Agents

Agents are configurable workers. They are not just names in one chat box.

### What an agent can own

| Area | Examples |
| --- | --- |
| Identity | Name, portrait, class, role, tags, description, tone. |
| Model lane | Primary model, fallback models, thinking level, timeout, fast-mode policy. |
| Workspace | A project folder, docs folder, content folder, or no file access. |
| Doctrine | `SOUL.md`, `TOOLS.md`, `MEMORY.md`, mission prompts, rules, preferences. |
| Skills | Built-in skills, learned skills, plugin-provided skills, workflow playbooks. |
| Policy | Sandbox behavior, allowed tools, denied tools, approval rules. |
| Schedule | Cadence defaults, recovery mode, loop/watch behavior. |

### Good agent ideas

| Agent | Purpose |
| --- | --- |
| **Release Architect** | Plans safe changes, identifies risk, and decides verification steps. |
| **Code Builder** | Makes focused edits in approved folders. |
| **QA Reviewer** | Finds regressions, missing tests, and release blockers. |
| **Research Analyst** | Compares options and separates facts from assumptions. |
| **Content Producer** | Turns ideas into scripts, outlines, thumbnails, titles, and launch copy. |
| **Support Operator** | Drafts replies and organizes customer context. |
| **Smart Home Operator** | Uses a configured smart-home CLI/plugin to inspect device state, lights, routines, and power usage, then reports through your preferred channel. |
| **Personal Chief of Staff** | Prepares schedules, errands, reminders, email drafts, and weekly summaries for approval. |
| **Commander** | Delegates work to specialists and returns one final report. |

## Model Setup

Automnia AI supports whatever model/provider routes are configured through OpenClaw and the app provider surfaces.

Common lanes include:

- OpenAI-compatible API providers.
- Anthropic-style message providers.
- Google Gemini or Vertex-style providers.
- Local or self-hosted model routes when configured through OpenClaw-compatible tooling.
- Subscription-backed or OAuth-backed provider flows where supported.
- API-key-backed providers where supported.

Recommended setup pattern:

1. Pick one reliable primary model for the agent.
2. Add one fallback model.
3. Set timeout and thinking level.
4. Send a small direct test prompt.
5. Only then use that agent in missions or channels.

If a model works in direct console chat but fails from a channel, inspect plugin setup, Gateway logs, channel routing, and the target agent's provider lane.

## Workspaces

Workspaces keep work scoped.

Use them to decide what an agent can inspect or change:

- A code repo.
- A docs folder.
- A content library.
- A support-export folder.
- A smart-home automation repo or CLI config folder.
- A safe scratch directory.

Good practice:

- Use narrow workspaces.
- Give different agents different folders.
- Use read-only or approval-first behavior for sensitive tasks.
- Test with a small prompt before giving mission-scale work.

## Command Console

The Command Console is the live operator lane.

Use it for:

- One-off questions.
- Direct code review.
- Small file inspections.
- Agent-specific commands.
- Party prompts.
- Attachment-backed context.
- Testing provider setup before missions.

Good prompt shape:

```text
Inspect these files. Report bugs first, list files inspected, then tell me the safest next step.
```

Weak prompt shape:

```text
Fix everything.
```

## Missions

Missions turn an objective into coordinated work.

Use Missions when you need:

- Multiple agents.
- Scheduling.
- Repeatability.
- Acceptance criteria.
- Verification commands.
- A final proof report.
- Recovery visibility.

### Mission flow

1. Confirm at least one agent in the Active Party.
2. Choose a mission preset.
3. Pick the dispatch mode.
4. Pick the mission type.
5. Write a clear objective.
6. Set cadence, complexity, risk, and readiness.
7. Add acceptance criteria or verification commands.
8. Deploy the mission.
9. Watch progress in Missions and Monitor.

### Presets

| Preset | Use it for |
| --- | --- |
| Code Sweep | Code review, cleanup, regression checks, targeted repair. |
| Mission Plan | Scoping, ownership, milestones, risks, next actions. |
| Research Map | Evidence gathering, comparisons, unknowns, decision support. |
| Launch Push | Implementation, release polish, verification, publication support. |
| Command Ops | Lead-agent delegation, synthesis, blocker resolution. |

### Dispatch modes

| Mode | Use when |
| --- | --- |
| Command | Slot 1 should delegate and synthesize. |
| Parallel | Agents should work in separate lanes immediately. |
| Specialist | Only matching agents should run. |
| Relay | Agents should pass context in sequence. |
| Swarm | You want broad exploration or many angles. |

## Schedules And Cadence

Use cadence when work should recur or stay active.

Examples:

| Cadence | Workflow |
| --- | --- |
| Every morning | Summarize overnight alerts, messages, or repo changes. |
| Every Friday | Prepare groceries, household tasks, or weekly planning. |
| Hourly | Watch a service, product page, market signal, or inventory status. |
| Watch style | Run when files, feeds, or external signals change. |
| Loop until stopped | Keep a monitor active while you are away. |

Smart-home example:

```text
Every 30 minutes, inspect smart-home status through the configured CLI.
Report unusual power usage, offline devices, unlocked doors, or lights left on.
Send summary to my preferred channel.
Wait for approval before changing device state.
```

## Monitor And Recovery

Monitor is the source of truth for runtime state.

Use it to see:

- Gateway health.
- Running calls.
- Active sessions.
- Cron jobs.
- Plugin and channel events.
- Logs.
- Failures and recovery actions.

Recovery order:

1. Wait for health polling.
2. Check active work.
3. Use Clean Slate for stale UI/runtime projection.
4. Use Reset gateway when Gateway is unhealthy.
5. Stop Gateway only when plugin/channel state needs a hard reset.
6. Reopen the app if the runtime cannot recover.
7. Send a small direct prompt before retrying big work.

## Plugins

Plugins extend what agents can do.

Common plugin categories:

| Plugin type | Enables |
| --- | --- |
| Provider plugins | Model access and model routing. |
| Browser plugins | Page inspection, browser context, and web workflows. |
| Memory plugins | Reusable knowledge and continuity. |
| Skill plugins | Playbooks, procedures, and specialized tools. |
| Channel plugins | SMS, chat, team tools, voice-style flows, webhooks, or future channels. |
| Service plugins | External systems such as home automation, support tools, publishing systems, or internal APIs. |

Plugin setup pattern:

1. Open Plugins.
2. Search for the plugin.
3. Check status chips.
4. Complete required setup fields.
5. Save configuration.
6. Refresh plugins.
7. Restart Gateway if the plugin needs runtime reload.
8. Confirm runtime state in Monitor.
9. Test with a tiny command.

## Channels

Channels turn Automnia AI into an operator layer outside the desktop.

Depending on configured plugins, channels can include chat apps, team tools, SMS-like flows, voice-style flows, webhooks, browser chat, or future channel surfaces.

Channel command pattern:

```text
status
@researcher summarize overnight alerts
@home check lights and power usage
@stop stop active runs and return current evidence
```

Best practices:

- Use unique agent aliases.
- Test with `status` first.
- Watch Monitor for inbound/outbound events.
- Keep approval gates on for external actions.
- Use short commands for channel workflows.

### Telegram-style setup pattern

Exact setup depends on the installed plugin, but the operating pattern is:

1. Install or enable the channel plugin.
2. Add required setup values in Plugins.
3. Save configuration.
4. Restart or refresh Gateway when the plugin asks for a runtime reload.
5. Send a small `status` message.
6. Confirm Channel Activity in Monitor.
7. Route to one agent with a unique alias.
8. Keep approvals enabled for messages or actions that affect others.

## Skills And Doctrine

Skills and doctrine are how agents keep working style and procedures.

Use doctrine for:

- Agent identity.
- Operating rules.
- Tone and boundaries.
- Tool policy.
- Mission playbooks.
- Memory notes.
- Verification rules.

Use skills for:

- Repeatable workflows.
- Project-specific checklists.
- Writing formats.
- Code review procedures.
- Research methods.
- Publishing routines.
- Smart-home routines.
- Support response formats.

Good skill idea:

```text
Release Review Skill
1. Inspect changed files.
2. Find user-facing risk first.
3. Run or recommend verification.
4. Report blockers, warnings, and safe-to-ship status.
```

## Advanced Workflows

### Code release crew

- Architect defines the safest plan.
- Builder edits approved files.
- Reviewer checks regressions.
- Tester runs verification.
- Commander writes the final report.

### Smart home operator

- Agent uses a smart-home CLI or plugin.
- Runs on cadence while you are away.
- Reports power usage, lights, routines, and device anomalies.
- Sends summary through your preferred channel.
- Waits for approval before changing devices.

### Content studio

- Researcher gathers context.
- Writer drafts scripts and posts.
- Editor tightens hooks.
- Producer creates launch checklist.
- Scheduler prepares recurring publishing tasks.

### Support desk

- Watches support exports or channel messages.
- Drafts replies.
- Flags urgent issues.
- Organizes context.
- Waits for approval before sending.

### Product watcher

- Watches product pages, pricing, release notes, inventory, or competitor updates.
- Ignores noise.
- Reports meaningful changes.
- Creates follow-up tasks or drafts replies.

## Compatibility

Automnia AI is a public beta candidate compatible with Windows, macOS, and Linux source workflows. The primary packaged beta target is Windows 11 x64. Other packaged builds should follow the release evidence attached to that build.

## Troubleshooting

### I cannot log in

- Desktop sessions should authenticate through the packaged app.
- Browser sessions need the configured local access flow.
- If access changed, clear the saved browser session and try again.

### Gateway is off or unhealthy

- Open Monitor.
- Wait for polling.
- Check logs.
- Use Reset gateway.
- Restart the app only if Gateway cannot recover.

### An agent does not respond

Check:

- Is the agent selected or deployed?
- Is the model configured?
- Is the provider available?
- Is the agent already running?
- Is the prompt asking for a denied tool?
- Is Gateway healthy?

### A mission will not deploy

Check:

- At least one agent is deployed.
- The party is confirmed.
- The mission has a title and objective.
- Model setup is complete.
- No selected agent is busy with a long task.

### A channel message does not arrive

Check:

- Is the channel plugin enabled?
- Does the plugin need setup?
- Is Gateway running?
- Does Monitor show Channel Activity?
- Is the target agent alias unique?

### A plugin needs setup

Open Plugins, search for the plugin, complete setup, save, refresh, and confirm runtime state in Monitor.

### Attachments do not work

Check file size, file type, workspace access, and agent policy. Attachment-heavy prompts may need runtime-backed execution.

## Glossary

| Term | Meaning |
| --- | --- |
| Agent | A configured OpenClaw worker with identity, model, workspace, policy, memory, and tools. |
| Active Party | The agents currently deployed for party chat or mission work. |
| Slot 1 | The lead party position for command, delegation, and review workflows. |
| Command Console | The live operator chat surface for direct agent or party work. |
| Mission | A structured objective with dispatch mode, timing, proof, and agent assignment. |
| Gateway | The OpenClaw background process that runs chat, sessions, plugins, channels, and runtime work. |
| Plugin | A runtime extension for providers, tools, channels, memory, browser automation, skills, or external services. |
| Channel | A communication path that can send or receive messages through a compatible plugin or Gateway surface. |
| Session | A reusable conversation/runtime context for an agent, channel, or Gateway chat lane. |
| Approval gate | A point where the agent prepares an action but waits for operator confirmation before execution. |
| Cron mission | Scheduled work that runs on a cadence. |
| Clean Slate | A recovery action for stale UI/runtime state that preserves healthy active work where possible. |
