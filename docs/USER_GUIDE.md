# Automnia AI User Guide

Last updated: 2026-07-04

Automnia AI is a local-first command center for operating OpenClaw agent teams. Use it to recruit agents, assemble an active party, send live commands, launch missions, monitor runtime health, manage plugins, and route work through compatible communication channels.

This guide is written for operators. The README is the front door; this guide is the manual.

## Operating Model

Automnia AI works best when you treat it like an AI operations desk:

1. **Agents** hold identity, model, tools, workspace, policy, memory, and doctrine.
2. **Active Party** slots define who receives direct team work and mission work.
3. **Command Console** sends live Gateway-backed turns to one agent, selected agents, or the confirmed party.
4. **Missions** turn an objective into structured work with mode, cadence, risk, readiness, and proof.
5. **Plugins and channels** add providers, tools, communication surfaces, memory, browser automation, and external integrations.
6. **Monitor** shows Gateway health, running calls, cron jobs, channel traffic, logs, and recovery actions.
7. **Approval gates** keep important work under operator control.

The desktop app is the deep control surface. Compatible channels are the remote command layer.

## Quick Start

1. Start the app.
   - Packaged desktop: open Automnia AI.
   - Development web surfaces: run `npm ci`, then `npm run dev`.
   - Desktop development shell: run `npm run desktop`.

2. Open the Control Center.
   - Desktop sessions authenticate through the Electron shell.
   - Development frontend: `http://127.0.0.1:5173/`.
   - Control Plane API: `http://127.0.0.1:4050/`.

3. Connect model access.
   - Open an agent with `Edit`.
   - Go to the model/auth area.
   - Pick the primary model and fallback models.
   - Connect OAuth for subscription-backed providers, or save an API key for API-key providers.

4. Build a party.
   - Open `Agents`.
   - Deploy the agents you want into party slots.
   - Keep Slot 1 as the lead when the work needs command or review.
   - Confirm the party before party-wide chat or mission work.

5. Run work.
   - Use the Command Console for live direct work.
   - Use Missions for structured work, verification, scheduling, and multi-agent coordination.
   - Use Monitor to watch runtime state and recover stale sessions.

## Main Navigation

| Area | Use it for |
| --- | --- |
| `Recruit` | Create a new agent profile and bootstrap doctrine. |
| `Agents` | Browse the roster, deploy the party, edit agents, and use the Command Console. |
| `Missions` | Define structured objectives, dispatch modes, cadence, risk, and proof. |
| `Monitor` | Inspect Gateway health, active calls, cron jobs, channel activity, logs, and recovery controls. |
| `Plugins` | Manage providers, tools, communication channels, skills, and runtime plugin surfaces. |
| `Settings` | Tune runtime policy, UI density, motion, contrast, defaults, and local preferences. |

The top status badges summarize total agents, party size, running turns, Gateway state, cron jobs, and result count.

## Agents Workspace

The Agents workspace is the main operating surface. It combines the active party, roster, search/filter tools, and Command Console.

### Active Party

Use the Active Party strip to choose who is armed for work.

1. Click `Deploy` on an agent card to place that agent into a slot.
2. Place the coordinator or lead agent in Slot 1 for command-style missions.
3. Remove agents that should not receive the next party prompt.
4. Click `Confirm` before party-wide Command Console turns or missions.

Party size is powerful, but more lanes also create more cost, runtime, and review load. Use one or two agents for quick direct work. Use a full team when the task needs architecture, implementation, QA, security, UX, or release review.

### Agent Registry

The registry is the searchable roster of available agents.

Use it to:

- Search by name, role, capability, or keyword.
- Sort by party priority, rarity, name, or level.
- Filter by rarity or roster view.
- Switch grid density when you need to scan more agents.
- Open `Edit` to change model, workspace, tools, policy, schedule, skills, or doctrine.

### Command Console

The Command Console is the live chat lane.

Current console behavior:

- Normal operator turns route through the OpenClaw Gateway chat path when available.
- Gateway accepts the run quickly, streams live deltas, and returns durable final text from Gateway history.
- The console can target one agent, selected agents, or the confirmed party.
- Attachments and tool-heavy requests may route through the OpenClaw runtime so tools and workspace policy apply.
- The `Stop` control aborts an active turn when supported by the current transport.

Good direct prompts name the outcome and proof:

```text
Review the release changes. Report bugs first, list files inspected, then say whether this is safe to push.
```

Avoid vague prompts when you need a reliable result:

```text
Fix everything.
```

## Recruiting And Editing Agents

Use `Recruit` when you want a new worker in the roster. Use `Edit` when you want to improve an existing worker.

### Recruit Workflow

1. Open `Recruit`.
2. Enter the agent name and confirm the generated agent ID.
3. Add a portrait path or URL.
4. Choose the role profile: executor, architect, auditor, researcher, coordinator, analyst, support, or hybrid.
5. Pick the workspace the agent should operate in.
6. Choose model access and runtime settings.
7. Review the generated doctrine before saving.

New agents should be specific. `Release QA` or `Shopify Theme Builder` is more useful than `Assistant`.

### Edit Workflow

Use `Edit` from any agent card.

| Area | What to check |
| --- | --- |
| Profile | Name, portrait, class, role, level, tags, and description. |
| Model | Primary model, fallbacks, auth state, thinking level, and timeout. |
| Workspace | The folder the agent can inspect and modify. |
| Policy | Sandbox mode, allowed tools, denied tools, and risk boundaries. |
| Scheduler | Default cadence, recovery mode, and loop/watch behavior. |
| Skills | Bundled, learned, shared, and plugin-provided skills. |
| Files | Doctrine files such as `SOUL.md`, `TOOLS.md`, `MEMORY.md`, and mission prompts. |

After changing model, workspace, or policy, send a small test prompt before launching a large mission.

## Missions Workspace

Missions turn an objective into coordinated work. They are the right surface when you need multiple agents, scheduling, repeatability, verification, or operator-readable proof.

### Mission Flow

1. Confirm at least one agent in the Active Party.
2. Choose a mission preset.
3. Pick the dispatch mode.
4. Pick the mission type.
5. Write a clear objective.
6. Set cadence, complexity, risk, and readiness.
7. Add acceptance criteria or verification commands when the work matters.
8. Deploy the mission.
9. Watch progress in Missions and Monitor.

### Mission Presets

| Preset | Use it for |
| --- | --- |
| `Code Sweep` | Code review, cleanup, regression checks, or targeted repairs. |
| `Mission Plan` | Scoping, ownership, milestones, risks, and next actions. |
| `Research Map` | Evidence gathering, comparisons, unknowns, and decision support. |
| `Launch Push` | Implementation, release polish, verification, and publication support. |
| `Command Ops` | Lead-agent delegation, synthesis, and blocker resolution. |

### Dispatch Modes

| Mode | Use when |
| --- | --- |
| `Command` | Slot 1 should delegate, inspect results, and synthesize. |
| `Parallel` | Agents should start immediately on separate lanes. |
| `Specialist` | Only matching agents should run. |
| `Relay` | Agents should work in sequence and pass context forward. |
| `Swarm` | You want broad exploration, many angles, or idea generation. |

### Mission Types

| Type | Best for |
| --- | --- |
| `Build` | Code, documents, UI, scripts, and concrete artifacts. |
| `Plan` | Strategy, architecture, rollout, and risk mapping. |
| `Research` | Findings, sources, comparisons, and evidence. |
| `Command` | Delegation, coordination, handoffs, and final synthesis. |
| `Memory` | Durable notes, learned skills, and continuity. |

### Acceptance Criteria

Write proof as concrete checklist lines.

```text
Changed files are listed.
At least one relevant verification command is run.
User-facing behavior is described before and after.
Risks or blockers are reported clearly.
```

### Scheduling

Use scheduling when work should recur or stay active:

- One-time mission for immediate work.
- Timed mission for a bounded repeated run.
- Loop mission for repeat-until-stopped work.
- Watch mission for persistent background monitoring.
- Cron cadence for recurring routines such as weekly reports, Friday grocery planning, daily app health checks, market alerts, or release readiness scans.

## Monitor Workspace

Monitor is the source of truth for runtime state. Open it whenever you need to know what is running, what is stuck, what channel sent traffic, or what needs recovery.

### Top Metrics

The top cards summarize runtime health:

- Runtime score and Gateway state.
- Stability.
- Efficiency.
- Failed calls.

### Monitor Tabs

| Tab | Use it for |
| --- | --- |
| `gateway` | Gateway health, reset/stop controls, channel activity, and active cron jobs. |
| `scheduler` | Agent cadence, loop/watch status, retry state, and cron behavior. |
| `performance` | Agent runtime quality, success, stability, and recent work. |
| `logs` | Recent mission, Gateway, runtime, and plugin messages. |

### Gateway Runtime

Use Gateway controls carefully:

- `Reset gateway` restarts Gateway-backed runtime services.
- `Stop gateway` turns off Gateway listeners and plugin/channel services until restarted.
- `Clean Slate` clears stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks without treating healthy active work as disposable.
- `Doctor` is for diagnostics and repair recommendations.

### Channel Activity

Channel Activity shows recent inbound, outbound, and system events from compatible channels and plugins. Depending on your active OpenClaw configuration, those channels can include SMS, voice, walkie-style chat, Telegram, Discord, Slack, WhatsApp, iMessage, Teams, Google Chat, webhooks, browser chat, or future plugin channels.

Use Channel Activity to answer:

- Did a remote message arrive?
- Which channel produced it?
- Which agent or session handled it?
- Did the reply send?
- Did the plugin report an auth, queue, or delivery error?

## Plugins Workspace

Plugins extend what Automnia AI can do. Some plugins provide model providers. Some provide tools. Some provide channels. Some provide memory, browser automation, skills, or external service access.

### Plugin Workflow

1. Search for the plugin.
2. Check status chips such as enabled, setup required, disabled, loaded, or running.
3. Add required setup values.
4. Save configuration.
5. Refresh plugins or restart Gateway when the plugin requires a runtime reload.
6. Confirm runtime state from Monitor.

### Channel Plugins

Channel plugins are how Automnia AI becomes reachable outside the desktop app.

Supported behavior depends on the installed plugin and OpenClaw configuration, but the operating model is:

- The plugin receives a message from a channel.
- The channel maps that message to a session, agent, party, or command.
- The agent responds through the same channel when delivery is supported.
- Monitor records channel activity and runtime logs.
- Important actions should ask for approval before they execute.

If a channel supports target prefixes, route to a specific agent with a unique alias or agent ID. For example:

```text
@Elena review the homepage copy and list the top three fixes.
@hn-testing run the smoke checklist and report only failures.
```

Ambiguous names should be avoided. Use the full name or agent ID when two agents share a name token.

### Remote Command Examples

Compatible channels can turn your phone or team chat into an operator console:

```text
status
stop all active runs
launch a release review mission
ask the analyst to alert me if the market moves sharply
prepare my grocery list every Friday morning
have the reviewer inspect the latest GitHub patch
```

For purchases, file deletion, account changes, deployment, GitHub pushes, or outbound messages to other people, use approval gates.

## Everyday Workflows

### Build Or Review A Code Change

1. Deploy architect, builder, reviewer, testing, and security agents.
2. Put the coordinator or architect in Slot 1.
3. Launch `Code Sweep` or `Launch Push`.
4. Add verification commands such as `npm run lint`, `npm run typecheck`, or a targeted smoke test.
5. Review the final report.
6. Approve push only after tests and changed files are clear.

### Run A Real-Time Analyst Watch

1. Deploy an analyst agent.
2. Choose a market, product, inventory, competitor, launch, or pricing signal.
3. Use a Watch or recurring cron mission.
4. Send alerts to the preferred compatible channel.
5. Require approval before purchases, trades, account changes, or outbound messages.

### Plan Groceries Every Friday

1. Create or choose an assistant/operator agent.
2. Launch a recurring Friday mission.
3. Include preferences, dietary rules, budget, and store options.
4. Have the agent produce a categorized list.
5. If ordering is connected through a plugin or browser flow, require approval before checkout.

### Operate From A Channel

1. Enable the channel plugin.
2. Send a small test message such as `status`.
3. Confirm the inbound event appears in Monitor.
4. Route to a specific agent with an alias or agent ID.
5. Keep important actions behind approval.

### Clean Up A Stale Session

1. Open Monitor.
2. Check running calls and channel activity.
3. Close stale sessions if old context is affecting answers.
4. Use `Clean Slate` when the monitor surface looks stale.
5. Restart Gateway only when runtime state or plugin state is actually unhealthy.

## Provider Auth And Models

Most agent failures come from provider auth, quota, stale sessions, or tool policy.

Use this checklist:

1. Open the agent editor.
2. Confirm the primary model and fallback models.
3. Reconnect OAuth for subscription-backed providers.
4. Save an API key for API-key providers.
5. Confirm the provider has quota.
6. Close stale sessions.
7. Send a small test prompt.

If a model works in direct console chat but fails from a channel, check the plugin config, Gateway logs, and the channel session. The plugin may be using a different agent, stale config, disabled provider, or missing setup value.

## Good Operating Habits

- Keep the active party small for quick work.
- Use missions for multi-agent work, recurrence, or verification.
- Put proof in acceptance criteria before important tasks.
- Require approval before purchases, deployments, deletes, GitHub pushes, or external messages.
- Stop channel plugins when you do not want outside messages waking agents.
- Keep secrets out of prompts and mission text unless the active tool specifically requires them.
- Use Monitor as the source of truth for runtime and channel state.
- Test a new plugin with a small command before depending on it.

## Troubleshooting

### I Cannot Log In

Check the token and session type.

- Desktop sessions should authenticate through the packaged app.
- Browser sessions need `CONTROL_CENTER_TOKEN` or the generated local token printed in the server log.
- If the token changed, clear the saved browser token and log in again.

### Gateway Is Off, Checking, Or Unhealthy

Open Monitor.

1. Wait a few seconds for polling.
2. Check whether Gateway is reporting healthy.
3. Read the latest logs.
4. Use `Reset gateway` for restart-style recovery.
5. Restart the app if Gateway cannot recover.

For deeper beta recovery, local state reset, and safe-log sharing steps, use [Beta Support](BETA_SUPPORT.md).

### An Agent Does Not Respond

Check:

- Is the agent selected or in the confirmed party?
- Is the model configured and authenticated?
- Is the provider rate-limited or out of quota?
- Is the agent already running?
- Is the prompt asking for a denied tool?
- Is a stale session causing confusion?
- Is Gateway healthy for runtime-routed work?

### The Wrong Agent Responded

Check the target chips, active party, and any channel alias. In channels, use the full name or agent ID when aliases are ambiguous.

### Old Context Keeps Affecting Answers

Close the relevant session from Monitor. Use `Clean Slate` if the UI or runtime ledger looks stale. Use a fresh mission when you need a clean objective and proof trail.

### A Channel Message Does Not Arrive Or Reply

Check:

- Is the channel plugin enabled?
- Does the plugin need setup?
- Is Gateway running?
- Does Channel Activity show inbound, outbound, or system events?
- Do logs show auth, queue, delivery, or alias-routing errors?
- Is the selected agent configured and available?

If a stopped plugin still receives messages, disable it in Plugins, stop it in Monitor if loaded, then restart Gateway.

### A Mission Will Not Deploy

Check:

- At least one agent is deployed.
- The party is confirmed.
- The mission has a title and objective.
- Required readiness checks are satisfied.
- Model auth is connected for selected agents.
- No selected agent is already busy with a long task.

### A Mission Runs Too Long

Stop the mission, then open Monitor and inspect active calls, sessions, Gateway logs, and cron jobs. Close stale sessions only after checking that active work does not need to be preserved.

### A Plugin Needs Setup

Open Plugins, search for the plugin, complete required setup fields, save, refresh, then verify the runtime state in Monitor. Some plugins need a Gateway restart before loaded state matches saved config.

### Attachments Do Not Work

Check the file path, file size, workspace access, and agent tool policy. Attachment-heavy prompts may require the Gateway/OpenClaw runtime path so workspace and tool permissions can be applied.

### I Need To Reset Local State Or Share Logs

Use [Beta Support](BETA_SUPPORT.md) for the full reset sequence and safe-log checklist. Start with `Clean Slate` and `Reset gateway` before renaming local state folders.

## Documentation References

Local project docs:

- [README.md](../README.md)
- [Beta Support](BETA_SUPPORT.md)
- [OpenClaw Gateway Command Console Guide](OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md)
- [Production Release Runbook](PRODUCTION_RELEASE_RUNBOOK.md)
- [Release Governance](RELEASE_GOVERNANCE.md)
- [Data Handling](../DATA_HANDLING.md)

Local OpenClaw snapshot:

- [Gateway protocol](openclaw-latest/pages/gateway/protocol.md)
- [Control UI](openclaw-latest/pages/web/control-ui.md)
- [WebChat](openclaw-latest/pages/web/webchat.md)
- [Agent CLI](openclaw-latest/pages/cli/agent.md)

Bundled OpenClaw docs:

- [OpenClaw docs index](../vendor/openclaw/docs/index.md)
- [Plugin management](../vendor/openclaw/docs/plugins/manage-plugins.md)
- [Building plugins](../vendor/openclaw/docs/plugins/building-plugins.md)
- [Skills](../vendor/openclaw/docs/tools/skills.md)
- [Channels](../vendor/openclaw/docs/channels/index.md)
- [SMS channel](../vendor/openclaw/docs/channels/sms.md)
- [Channel troubleshooting](../vendor/openclaw/docs/channels/troubleshooting.md)
- [Automation troubleshooting](../vendor/openclaw/docs/automation/troubleshooting.md)

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

## Fast Recovery Checklist

When something feels wrong:

1. Open Monitor.
2. Check Gateway health.
3. Check active calls and cron jobs.
4. Check Channel Activity.
5. Read the latest logs.
6. Close stale sessions only when needed.
7. Confirm model auth.
8. Retry a small direct prompt.
9. Relaunch the mission or plugin workflow after the small test succeeds.
