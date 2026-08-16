# Automnia UI Reference: Exact Navigation and Control Guide

This reference is the source of truth for Automnia Assistant when it explains the product interface. Use visible labels exactly as written here. When a user asks where to click, lead with the screen name, then the control label, then what it changes. Do not invent settings or promise that an action completed until the interface reports a result.

For the complete operating sequence—including every Agent Editor tab, the
irreversible **Agent files → Retire** lifecycle, all Settings categories, the
documentation-source map, and Google Cloud Help publishing—see
[`AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md`](AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md).

## How Automnia is laid out

Automnia AI Nexus has a fixed left navigation rail, a workspace header, and a main workspace. The left rail remains visible while moving between workspaces.

| Location | What it is for | Exact action |
| --- | --- | --- |
| Left rail, first item | **Recruit** | Opens the new-agent flow. Its sublabel is **Discover**. |
| Left rail | **Agents** | Select agents, form the active party, edit agents, and use the Command Console. |
| Left rail | **Missions** | Configure and launch a structured multi-agent mission. |
| Left rail | **Monitor** | Inspect Gateway state, scheduled work, runtime performance, and activity logs. |
| Left rail | **Plugins** | Search, install, configure, refresh, start, stop, inspect, restart, update, and remove plugins. |
| Bottom of left rail | **Settings** | Opens the system control center. Its sublabel is **System**. |
| Bottom of left rail | **Help** | Opens Automnia Assistant. Its sublabel is **Assistant**. |

Every workspace header has status chips on the upper right:

| Chip | Meaning | Useful next action |
| --- | --- | --- |
| **Agents** | Total rostered agents. | Open **Agents** to browse or edit them. |
| **In Party** | Number in the active party. | Open **Agents** and double-click an agent card to add or remove it from the party. |
| **Running** | Agents with active work. | Open **Monitor** to inspect activity, or use the Command Console **Stop** control for active console turns. |
| **Gateway** | Whether the OpenClaw Gateway is loading, online, offline, or migrating. | Open **Monitor → Gateway**; use **Doctor**, **Restart Gateway**, or the reported recovery action if necessary. |
| **Cron** | Number of active scheduled jobs. | Click it to open **Monitor**. Use Delete or the context menu on the chip only when intentionally reviewing scheduled jobs for clearing. |
| **Results** | Number of Command Console responses. | Open **Agents** and review the console. |
| **Mission** | Appears only for an active mission and shows its status. | Open **Missions** to steer or stop it. |

These chips report state; they do not replace a verification step. For example, a green Gateway chip means the Gateway is online, not that a specific plugin account or OAuth connection is authorized.

## Recruit: create an agent

**Click path:** left rail → **Recruit**. This opens the Recruit modal over the current workspace.

Use Recruit when the user needs an agent based on a built-in template or a blank/default starting point.

1. In the template area, search or browse the available templates. Choosing a template pre-fills its recommended identity, capabilities, tools, and markdown doctrine files. Use the blank/default option when the user wants complete control.
2. Set the agent's display **Name** and **Agent ID**. The ID must be unique, 3–60 characters, lowercase, and use only letters, numbers, and hyphens. Automnia can derive the ID from the name, but the user should confirm it before creating the agent.
3. Optionally upload an **Avatar**. This changes the roster portrait, not the agent's model or permissions.
4. Choose the agent's behavior/style profile, then review **Class**, **Role**, **Level**, and personality depth. These define the agent's working identity and default behavior.
5. Under runtime configuration, select the primary **Model** or leave it at the system default. Set a **Workspace** when the agent needs a dedicated project folder.
6. Turn the capability switches on only for work the agent should be eligible to perform. Capability choices affect which specialists can join a matching mission.
7. Keep **Add to active party** on when the new agent should immediately be available for the current task. Turn it off when the agent should be created but not deployed into the working party.
8. Review the markdown file area. Standard files include identity, behavioral doctrine, bootstrap instructions, agent rules, user instructions, heartbeat, memory, tools, and a mission prompt. Select a file to edit it, or add a custom `.md` file. These files are instructions and reference material; they are not an authorization to access accounts or send external messages.
9. Use **Auto Forge** only when the interface presents it and the user wants Automnia to draft the setup. Review the generated fields and files before saving.
10. Click **Create Agent**. Resolve any on-screen duplicate-ID, required-field, or account/model warning before retrying.

After creation, continue in **Agents** to select the new agent, enable skills, edit deeper configuration, or give it a task in the Command Console.

## Agents: roster, active party, editor, and Command Console

**Click path:** left rail → **Agents**.

This workspace is the normal control room for agent work. It combines the active-party strip, the agent registry, agent editing, and the optional Command Console on the right.

### Active Party

The **Active Party** strip shows the agents currently available to a mission or console conversation. Use it to verify who will receive a task before sending it. The workspace has a toolbar control to show or hide the console; the same preference is available from **Settings → Workspace → Command console → Show console in Agents**.

### Agent registry

Use the registry toolbar to narrow the roster before choosing agents:

| Control | What it does |
| --- | --- |
| Search field | Finds agents by relevant identity and capability text. Use the clear control when finished. |
| Sort | Changes order, including party-first, level, name, and rarity views. |
| Rarity filter | Limits the roster to All, Legendary, Epic, Rare, or Common. |
| View buttons | Change between showcase, grid, or list density. The chosen view is remembered. |
| Pagination controls | Move through a roster when the current display mode does not show all cards. |

Agent card interaction is deliberate:

| User action | Result |
| --- | --- |
| Single-click a card | Selects the agent for inspection and the Command Console. |
| Press Enter on a focused card | Selects that agent. |
| Double-click a card | Adds the agent to, or removes it from, the active party. |
| Right-click / context menu | Opens the agent editor. |
| **Deploy** or **Remove** on a card | Adds or removes the agent from the active party. |
| **Edit** on a card | Opens the agent editor. |

Before launching a mission or asking agents to act, confirm the target agents are selected and the active party is correct. A selected agent is not automatically an authorized external account.

### Agent editor

Open it with a card's **Edit** button or its context menu. The editor saves changes as the user works; use **Done** to close it. Its tabs are:

| Editor tab | Use it for |
| --- | --- |
| **Profile** | Name, role, identity details, portrait, and agent-facing description. |
| **Model** | Primary model and provider route choices. A model must be available and authorized for the account. |
| **Heartbeat scheduler** | Agent-specific tick/cadence and scheduled runtime behavior. |
| **Policy sandbox** | Runtime policy and safeguards. Use this to limit work appropriately before autonomous tasks. |
| **Workspace** | The project/workspace path and work context. |
| **Skills** | Search installed skills, see skill details, enable a skill for the agent, or search/install/update a ClawHub skill. |
| **Agent files** | View and edit the agent's markdown instruction files. |

The editor also exposes a **Retire** control. Treat it as an intentional lifecycle action: verify the correct agent and preserve any needed workspace or instructions before retiring it.

### Command Console

The Command Console appears on the right side of **Agents** when enabled. This is the main place to give an agent a real task. For complicated work, help should explain both paths:

1. The guided path: make the configuration change yourself using the relevant UI instructions.
2. The agent-assisted path: select a configured agent in **Agents**, confirm its skills, plugin access, workspace, and policy, then give it a bounded command in the Command Console.

The second path is appropriate for multi-step investigation, drafting, coding, research, recurring operational work, or using already-authorized plugins. The assistant must not claim that an agent can bypass a login, grant itself a permission, invent a phone number, or approve a payment.

| Console control | How to use it |
| --- | --- |
| Target chips / selected agents | Confirm recipients before sending. Remove an incorrect target with the `×` on its chip. |
| Stream and Gateway status | Confirm the conversation runtime is available. Follow a displayed error rather than repeatedly resending. |
| Clear messages / reset sessions | Clears this console context; use only when the history is no longer needed. |
| Attachment control | Adds a file or context to the next task when the interface accepts it. Do not attach secrets unnecessarily. |
| Voice / microphone control | Dictates a task using the current voice settings. |
| Message field | State the goal, boundaries, expected output, and verification. |
| Send | Queues the task for the selected recipients. |
| **Stop** | Stops currently running Command Console turns; it does not necessarily delete their prior outputs. |

A useful command pattern is: “Inspect the current setup for [goal]. Use only configured tools. Do not make external changes without telling me first. Return the exact blocker or completed result with evidence.” For a task already authorized to execute, state the permitted outcome and required verification explicitly.

## Missions: repeatable multi-agent work

**Click path:** left rail → **Missions**.

Missions dispatch the current active party into a structured workflow. Add the right agents to the party first in **Agents**; the Missions screen shows “Add agents from the registry first” if nobody is available.

1. Optionally choose a card under **Mission Presets** to fill a known setup.
2. In **Mission Setup**, enter a **Mission title**.
3. Choose a **Dispatch mode**. The choices determine how agents work together: parallel lanes, a sequential relay, a swarm, a hierarchical commander-and-lanes structure, or specialists matched to the selected capability.
4. Choose the **Mission type**. Only agents with a matching capability are eligible in Specialist mode; agents that do not match are shown as standby rather than silently used.
5. In the right-side **Agents** card, review who is ready and each agent's heartbeat cadence and work timeout. Adjust an individual cadence before deployment if needed.
6. Write the concrete outcome in **Objective**.
7. In **Mission Cron**, set a number and Seconds, Minutes, or Hours, then click **Apply Cadence** to apply it to the selected party. **Deploy & Run Now** starts the first cycle immediately; the cadence controls later cycles.
8. Review **Active Loadout**, Complexity, Risk, and Launch readiness. The deploy action remains unavailable until the readiness checks are satisfied.
9. Use **Timing** to choose Instant, Timed, Continuous, or Indefinite. For Timed, enter a duration in hours, days, or weeks.
10. Click **Deploy & Run Now**. While it is running, the button becomes **Stop Mission** and **Steer Mission** becomes available for changing the mission direction.
11. Review **Mission History** after completion for the status and recent runs.

Use a mission for repeatable, multi-agent execution. Use the Command Console for a direct conversation, investigation, or a one-off bounded delegation. A mission does not replace required account consent or review for external actions.

## Monitor: Gateway health, cron, performance, and logs

**Click path:** left rail → **Monitor**.

The Monitor has four tabs and three recovery tools in its top bar.

| Monitor tab | What to inspect |
| --- | --- |
| **Gateway** | Gateway health, channel activity, live runtime information, active cron jobs, and the Gateway log tail. |
| **scheduler** | Agent heartbeat/scheduler status and cadence. |
| **performance** | Per-agent live runtime, efficiency, stability, success, failures, and relevant mission report signals. |
| **logs** | Recent activity and runtime event detail. |

Gateway tab controls:

| Control | Safe use |
| --- | --- |
| **Doctor** | Runs the runtime diagnostic. Read its findings and guided action. Dismissed or older-than-24-hour snapshots should be refreshed before relying on them. |
| **Restart Gateway** | Restarts the OpenClaw Gateway and refreshes runtime status. Use for an unhealthy Gateway only after checking Doctor or the actual error. |
| **Clean Slate** | Clears local Monitor cache, log-tail snapshots, recent runtime calls, and stale session locks without intentionally stopping active Gateway work. It preserves durable OpenClaw transcripts and active Gateway work. |
| **Refresh** (where shown) | Reloads the displayed runtime state. |
| Active Cron Job **Edit** | Opens the schedule editor. Update the name, schedule kind/value, and editable agent instruction, then save. Command cron jobs may not expose editable text. |
| Active Cron Job **Pause** | Stops one scheduled job. |
| **Pause all** | Requires confirmation when multiple cron jobs are active. Use only when intentionally suspending the listed jobs. |

When support sees a problem, first use the Monitor to distinguish Gateway offline, plugin not configured, OAuth/token authorization missing, a paused cron, a policy block, and an agent/task error. Never recommend **Clean Slate** as a way to “fix” an account authorization; it does not create credentials.

## Plugins: install and operate integrations

**Click path:** left rail → **Plugins**.

Plugins connect Automnia/OpenClaw to services and runtime capabilities. The panel supports both locally installed plugins and a `/clawhub` query path. Search results and plugin cards may display their current runtime status, dependencies, capabilities, and configuration state.

| Control | What it does |
| --- | --- |
| Search | Filters installed plugins. Use `/clawhub` in the search flow when looking for discoverable plugin entries offered by the interface. |
| **Install** | Installs the selected plugin when an installable result is available. |
| **Start** / **Stop** | Starts or stops the installed plugin runtime. |
| **Setup** | Opens the configuration modal. Complete required fields; secret fields are masked and should be entered only by the authorized account owner. Click **Save Setup**. |
| **Refresh** | Re-reads current plugin/runtime state. |
| **Manage** | Opens additional lifecycle actions. |
| **Inspect** | Shows the runtime inspection output and whether the plugin is loaded. |
| **Restart** | Restarts the individual plugin runtime. |
| **Update** | Updates the installed plugin. Review its release notes and configuration afterward. |
| **Uninstall** | Removes the plugin. Verify dependencies and backup needs first. |

For every plugin, help should use this sequence: locate it in **Plugins** → review dependencies and guidance → install if needed → **Setup** with the owner’s credentials → **Save Setup** → **Start** if it is stopped → **Refresh** or **Inspect** to verify. Afterwards, enable any related skill for the intended agent in **Agents → Edit → Skills**, then use the Command Console to give a bounded task.

### ClawTalk and phone-channel setup

ClawTalk is configured through its plugin card. Automnia's ClawTalk setup screen accepts the ClawTalk API key and reports plugin/runtime/channel status. The agent profile itself does not have a generic “phone number” field.

**Click path:** **Plugins** → find **ClawTalk** → **Setup** → enter the API key supplied by the authorized ClawTalk account → **Save Setup** → **Refresh** or **Inspect** → start/restart the plugin if the panel reports it is not running.

If the user needs a phone number, direct them to obtain or attach it inside their authorized ClawTalk service/account, then return to the ClawTalk plugin setup. Do not ask them to paste an API key, phone number, SMS verification code, or credentials into Help chat. Once ClawTalk is truly configured, select the intended agent, explain the permitted calling/SMS workflow in the Command Console, and require it to report actual tool results rather than simulate a call or message.

### Telegram setup

Automnia uses the available Telegram plugin's **Setup** flow rather than a separate generic Telegram pairing page.

**Click path:** create a Telegram bot with BotFather → copy the bot token only into **Plugins → [Telegram plugin] → Setup** → **Save Setup** → **Start** or **Restart** if needed → **Refresh**/**Inspect** → follow the plugin's displayed pairing or group-policy guidance.

Use a private chat first and verify that the bot can receive and reply to an allowed test message. For groups, restrict who can control the bot, avoid putting sensitive information in messages, and follow the plugin's explicit policy/allowlist requirements. Never put a Telegram token, pairing code, or chat identifier into Help chat. If setup is difficult, a selected agent can inspect plugin status and guide the next safe step, but it cannot obtain the user's BotFather token or approve the connection for them.

## Skills: finding, equipping, and teaching reusable workflows

Skills are managed from **Agents → Edit → Skills** and from the operational Skills panel where it is available. A skill makes a reusable procedure available to an agent; it does not grant account credentials by itself.

### Installed and local skills

1. Select the agent in **Agents**.
2. Open **Edit → Skills**.
3. Search the installed skills and read the description/details.
4. Enable only the skills appropriate for the agent and task.
5. Run a small, non-sensitive test in the Command Console.

### ClawHub skills

In the Skills panel, choose an active agent first. The **ClawHub** section has a search field and **Search** button. Results show whether they are already installed, when information is available.

| Action | Result |
| --- | --- |
| Search a term, then **Search** | Loads up to the returned ClawHub skills. |
| **Install** | Installs that skill into the shared OpenClaw skills folder, then refreshes the library. |
| **Update** | Updates a skill already installed from ClawHub. |
| **Sync** in Skill Library | Reads shared, agent, indexed, learned, and ClawHub skill records. |
| Filter buttons | Narrow to all, equipped, ClawHub, learned, shared, or agent skills. |
| **Open** | Reads the selected skill content. |
| **Draft** | Uses an existing skill as a draft for a new or updated skill. |
| **Template** | Starts a safe, verification-oriented procedure template. |
| **Use Info** | Seeds a new-skill draft from the current skill info. |
| **Unlock Skill** / **Update Skill** | Saves a new or updated local learned skill as `SKILL.md`; optionally add it to the shared party library. |

Before installing a third-party skill, review its publisher, description, requested services, instructions, and any dependencies. Do not treat a skill as trusted simply because it appears in search. Install, inspect, enable, test with a non-sensitive task, then authorize real work. This behavior follows the official [OpenClaw skills guidance](https://docs.openclaw.ai/skills) and [ClawHub quickstart](https://docs.openclaw.ai/clawhub/quickstart).

## Settings: account, workspace, voice, mission, agent, and recovery controls

**Click path:** left rail, bottom utility navigation → **Settings**. The Settings screen has a search field and category navigation. Changing a setting saves it persistently; read its hint before changing a bulk or recovery control.

### Account & License

Use **Account & License** for account status, read-only account email, optional Automnia password management, plan/access/billing information, account refresh, pooled Automnia credit balance, usage priority, and the **Effective Agent Route**. The effective route applies to normal messages, runtime/work/OpenClaw activity, streamed turns, and buffered recovery. Starter ($19.99) and credit-refill access use Automnia credits only; when the confirmed balance is zero, the app stops and tells the user to refill. BYOK ($29.99) and higher tiers expose **My provider + Automnia credits**, with a secondary order choice of provider first or Automnia first; if Automnia is selected first and its confirmed balance is zero, the connected provider is used. Purchases tied to the same verified email are pooled after Google or confirmed-password sign-in.

### Appearance

Use **Appearance** for visual and accessibility choices:

- **Color and surfaces:** accent mode, form chrome, and Compact/Comfortable/Spacious interface density.
- **Accessibility and effects:** Standard/Reduced motion, High contrast, Reduced glow, Control glow, and Neutral scrollbars.
- **Restore appearance defaults:** returns this category to its defaults.

### Workspace

Use **Workspace** to tune the Agents registry and Command Console:

- **Agent registry:** Default view, Use rarity colors, Card background, Default sort, and persistent Rarity filter.
- **Command console:** Show console in Agents, Console width slider (360–760px before responsive clamping), and Remember unfinished drafts.
- **Restore workspace defaults** resets these layout preferences. **Open Agents** returns directly to the workspace.

### Voice

Use **Voice** for microphone dictation:

- **Transcription engine:** Local (on-device after a one-time model download) or Cloud (configured OpenAI provider).
- **Recording behavior:** Stop after a pause, Pause sensitivity, and a maximum recording length of 30 seconds, 1 minute, 2 minutes, or 5 minutes.
- **Microphone processing:** Noise suppression, Echo cancellation, and Automatic gain.
- **Restore voice defaults** restores this category.

### Missions

Use **Missions** in Settings to establish the defaults shown in the Missions workspace: Mission title, objective, mission type, collaboration, duration mode and amount, Complexity, Risk tolerance, and the required-evidence checklist. Click **Open Missions** to work on the current defaults in the mission workspace, or **Restore mission defaults** to reset them.

### Agent runtime

Use **Agent runtime** for intentional bulk policy. First choose the target source (**Party** or **Selected**) and explicitly select agents if needed. Then configure:

- **Heartbeat cadence** and **Idle timeout**.
- **Continuous heartbeat** and **Automatic recovery**.
- **Work timeout**, **Thinking default**, **Fast mode**, and **Parallel preferred**.

Click **Apply to [number] agents** only after confirming the target count. This is intentionally not automatic. **Restore runtime defaults** returns runtime preferences to their defaults.

### Data & reset

Use **Data & reset** carefully:

| Control | What it preserves or clears |
| --- | --- |
| **Copy settings backup** | Copies non-secret preferences and the current mission draft. It does not include credentials. |
| **Clear command drafts** | Removes stored, unsent Command Console text. |
| **Clear console responses** | Removes the displayed Command Console response history. |
| **Reset runtime simulation** | Resets simulation state. |
| **Reset all preferences** | Restores appearance, workspace, voice, and mission defaults; it keeps agents, provider credentials, plugins, workspaces, and files. |
| **Clear party and responses** | Removes the current active party and command responses while keeping rostered agents available. |

## Help: Automnia Assistant

**Click path:** left rail, bottom utility navigation → **Help**.

Help is a product guidance surface. It should be help-first: give the exact click path, explain the expected result, identify prerequisites, and offer the agent-assisted route when a task has many steps.

Help presents outcome-based playbooks one at a time as clickable suggestions.
The source playbook in `docs/AGENT_CAPABILITY_PLAYBOOK.md` contains
ready-to-paste Command Console prompts, exact manual controls, secure handoff
rules, safe tests, and a 100-idea capability catalog. Suggestions cover agent
customization, Google Workspace email, ClawTalk phone setup, Telegram, skills
and plugins, recurring missions, advanced teams, YouTube research, browser
workflows, Instagram planning, Google Cloud/Gog CLI, and end-to-end setup.

When answering a hard setup question, Help should say: “I can walk you through the controls, or you can select a configured agent in **Agents** and ask it in the **Command Console** to inspect the setup and complete the authorized portions.” It must then state the boundary: the user still supplies their own login, token, account approval, and any required payment or consent.

## Help response checklist

For an exact interface answer, Automnia Assistant should:

1. Name the workspace and use a click path such as **Plugins → ClawTalk → Setup**.
2. Name the visible button, field, tab, or switch exactly.
3. Say what changes when the user clicks it and what successful verification looks like.
4. State prerequisites: account, plugin installed, OAuth/credential, selected agent, skill enabled, active party, or Gateway online.
5. Explain the agent-assisted alternative for multi-step work, while respecting account consent and policy limits.
6. Never request secrets in Help chat or claim that a hypothetical agent action already happened.
