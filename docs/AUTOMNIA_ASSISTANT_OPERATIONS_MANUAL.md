# Automnia AI Nexus Assistant Operations Manual

This is the source-verified operating manual for the in-product Automnia
Assistant, support agents, and human operators. It explains where the product
code lives, which documentation folders are authoritative, how to run the
desktop app, what every major UI surface does, every Agent Editor tab, the
exact agent retirement workflow, Settings, Google Cloud operations, and the
response standard for detailed agent-assisted help.

Use the visible labels in this document exactly. If a label differs in a
future build, treat the running UI and its source component as the immediate
truth and update this manual.

## 1. Documentation source map

Automnia has several documentation trees. They do not all have the same role.
The Help Assistant should know the difference so it can point users to the
right document instead of treating vendor or generated files as product UI
instructions.

| Folder or file | Authority and purpose | Assistant use |
| --- | --- | --- |
| `README.md` | Product overview, capabilities, development entry points, and primary links. | First orientation and “what is Automnia?” answers. |
| `docs/` | Human-authored Automnia product, UI, setup, support, release, security, and operations documentation. | Primary user-help corpus. Every Markdown file directly under this tree is included in the complete Automnia corpus except the synced OpenClaw snapshot described below. |
| `docs/USER_GUIDE.md` | End-user workflow guide. | Account, agents, missions, models, schedules, plugins, channels, and troubleshooting. |
| `docs/AUTOMNIA_UI_REFERENCE.md` | Exact visible labels and click paths for the current React UI. | “Where do I click?” and “what does this control do?” questions. |
| `docs/AGENT_SETUP_GUIDES.md` | Detailed setup recipes and agent-assisted alternatives. | New agent, provider, plugin, channel, Gog, YouTube, and workflow setup. |
| `docs/AGENT_CAPABILITY_PLAYBOOK.md` | Outcome-based templates, ready-to-paste agent prompts, manual paths, safety boundaries, and a 100-idea capability catalog. | Help suggestions for customizing agents, email, phone, Telegram, skills, recurring work, browser/Instagram/YouTube workflows, Google Cloud, and advanced teams. |
| `docs/BUNDLED_SKILLS_CATALOG.md` | Bundled and discoverable skill capability catalog. | Skills, ClawHub, prerequisites, and safe installation guidance. |
| `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md` | Automnia/OpenClaw Command Console and Gateway integration details. | Streaming, sessions, fallback, recovery, and console behavior. |
| `docs/GCLOUD_ADMIN_GUIDE.md` | Automnia Cloud Run, Firestore, service configuration, deployment, verification, and rollback. | Operator-only cloud administration; do not present as a normal customer click path. |
| `docs/BETA_SUPPORT.md`, `docs/BETA_RELEASE_NOTES.md` | Support boundaries, known issues, recovery, and release context. | Troubleshooting and escalation. |
| `docs/CI_EVIDENCE.md`, `docs/RELEASE_GOVERNANCE.md`, `docs/DESIGN_TOKENS.md` | Engineering/release and design references. | Use only when the question is about development, release, or UI styling. |
| `docs/openclaw-latest/` | Synced snapshot of bundled OpenClaw documentation. It is refreshed from the vendor source and is not the Automnia UI source. | Use the curated pages for Gateway, CLI, agent, model, OAuth, memory, and streaming behavior. Do not invent Automnia controls from an OpenClaw page. |
| `infra/gcloud/knowledge/` | Private Help Assistant instruction and product-knowledge Markdown. | High-priority support behavior and response rules. All Markdown in this folder is included in the complete corpus. |
| `infra/gcloud/README.md` | Cloud deployment folder orientation. | Explain what the Google Cloud scripts do and which are operator-only. |
| `infra/gcloud/*.ps1`, `infra/gcloud/tools/`, `infra/gcloud/service/` | Deployment scripts, migration tools, and service implementation. | Engineering evidence only. Never upload credentials, snapshots, or raw customer data into the Help corpus. |
| `vendor/openclaw/docs/` | Vendor source documentation used to create or refresh the synced OpenClaw snapshot. | Do not edit as Automnia product documentation. Use the synced copy and its sync workflow. |
| `release/**/Resources/openclaw/docs/` | Packaged runtime copy created during desktop packaging. | Never edit directly; changes are lost on the next package. |
| `vendor/agency-agents/` | Recruit-template source/vendor material. | Use the Recruit/template API and catalog as the runtime truth. Do not promise a template based only on a vendor README. |

### What gets indexed for Help

`npm run publish:knowledge -- --dry-run` prepares the sanitized corpus. The
publisher includes:

1. Root product safety and data documents.
2. `infra/gcloud/README.md`.
3. Every Markdown file in `docs/` except the full `docs/openclaw-latest/`
   snapshot, which is intentionally curated to prevent vendor reference from
   drowning out Automnia guidance.
4. Every Markdown file in `infra/gcloud/knowledge/`.
5. Curated OpenClaw Gateway, CLI, and concepts pages needed to operate the
   bundled runtime.

The source repository is not uploaded wholesale. Source code, credentials,
customer records, Firestore exports, runtime state, and raw logs do not belong
in the support index.

## 2. Running Automnia

### Fresh checkout

Automnia is a Vite/React renderer, a TypeScript control-plane server, and an
Electron desktop shell. From the repository root:

1. Install the repository dependencies with `npm install`.
2. Start the browser development stack with `npm run dev`. This starts the
   Vite client at `127.0.0.1:5173` and the TypeScript server together.
3. For the desktop development path, use `npm run dev:desktop`. This builds
   the client and server, prepares the bundled OpenClaw runtime, and launches
   Electron.
4. For the standalone desktop command, use `npm run desktop`. It builds the
   standalone renderer/server bundle, prepares runtime bundles, prepares the
   OpenClaw vendor copy, and opens Electron.
5. The production-style development server is `npm start`; it prepares the
   OpenClaw vendor copy and starts `server/index.ts`.

The app expects the bundled OpenClaw runtime to be present. `npm run
prepare:openclaw-vendor` synchronizes the runtime into `vendor/openclaw` before
development or packaging. Packaging commands also prepare runtime bundles and
place packaged copies under `release/`; those packaged copies are outputs, not
source files to edit.

### First launch sequence

1. Automnia opens the account sign-in gate.
2. An authenticated but unlicensed account sees **License Activation**.
3. A licensed account enters the main shell with the left rail, workspace
   header, status chips, and the current workspace.
4. On first OpenClaw startup, a migration can cause several short Gateway
   restarts. The status **Gateway migration in progress** is expected during
   this phase. Wait for it to settle; do not start a second Gateway or delete
   the state directory.
5. Use **Monitor → Gateway → Doctor** if the runtime does not become healthy.
6. Create or select an agent before using Command Console. A green Gateway
   chip means the runtime is online; it does not prove that a provider,
   plugin, OAuth account, or channel is configured.

### Main process and renderer boundaries

| Area | Source | Responsibility |
| --- | --- | --- |
| Renderer entry | `src/main.tsx`, `src/App.tsx` | React providers, authentication/license gates, and shell mounting. |
| Shell | `src/components/layout/NexusShell.tsx` | Left rail, workspace switching, status chips, Help navigation, recruit modal, and Agents/Command Console split view. |
| State | `src/store/` | Agent roster, active party, mission, runtime projection, console state, persistence, and configuration saves. |
| Agent UI | `src/components/party/`, `src/components/editor/`, `src/components/recruit/` | Registry, party selection, Agent Editor, and Recruit. |
| Server | `server/index.ts`, `server/controlPlane.ts`, `server/routes/` | Local API, OpenClaw lifecycle, filesystem safety, agent state, missions, plugins, and diagnostics. |
| Cloud service | `infra/gcloud/service/server.js` | Account provisioning, hosted credits, Shopify/Firestore integration, and private Help Assistant serving. |

## 3. UI map and interaction model

The shell has a fixed left navigation rail, a workspace header, and a main
workspace. **Recruit** is above the primary workspaces. **Settings** and
**Help** are at the bottom of the rail.

| Rail item | Exact label | What it does |
| --- | --- | --- |
| Recruit | **Recruit** | Opens the new-agent/template flow. |
| Agents | **Agents** | Select agents, manage the active party, edit agents, and use Command Console. |
| Missions | **Missions** | Configure and launch repeatable multi-agent work. |
| Monitor | **Monitor** | Inspect Gateway health, scheduler, performance, logs, sessions, and recovery evidence. |
| Plugins | **Plugins** | Install, configure, start, stop, inspect, restart, update, and remove runtime extensions. |
| Settings | **Settings** | Account, appearance, workspace, voice, mission defaults, bulk agent runtime, and data/reset controls. |
| Help | **Help** | Opens the in-product Automnia Assistant. Assistant answers can link to recognized surfaces. |

Header chips are projections, not proof of a specific operation:

- **Agents** is roster count.
- **In Party** is the active-party count.
- **Running** is currently busy agent work.
- **Gateway** is runtime connectivity, migration, or offline state.
- **Cron** is active/scheduled work and can open Monitor for review.
- **Results** is the number of stored Command Console responses.
- **Mission** appears when a mission is active.

The Agents workspace can show a registry-only view or a split view with
Command Console. The split handle is draggable; the stored width is clamped
between 360px and 760px and is further limited by the available window width.

### Selected agent versus active party

These are different concepts:

- A **selected agent** is the current inspection/console target.
- The **active party** is the group available to a mission or coordinated work.
- A card can be selected without being deployed to the party.
- A mission uses the active party, not merely whatever card is selected.
- Settings bulk runtime changes can target either **Party** or **Selected**.

Before sending a consequential task, confirm both the console recipient chips
and the active party/mission loadout.

## 4. Recruit and the Agent Registry

### Recruit flow

Open **Recruit** from the left rail.

1. Search or browse the template catalog. A template can prefill identity,
   role, capabilities, tools, and Markdown doctrine.
2. Set **Name** and a unique **Agent ID**. IDs are lowercase letters, numbers,
   and hyphens, normally 3–60 characters.
3. Choose an avatar, behavior/style, class, role, level, and personality
   details when the flow exposes them.
4. Select the model and provider route, or keep the system default.
5. Assign a dedicated **Workspace** when the agent should operate inside a
   specific project boundary.
6. Enable only the capabilities the agent needs.
7. Leave **Add to active party** on only when the agent should be immediately
   available for the current mission or console work.
8. Review the Markdown bootstrap files. They are instructions and reference
   material, not account authorization.
9. Use **Auto Forge** only when the operator wants generated setup; review all
   generated values before creating the agent.
10. Click **Create Agent** and resolve duplicate ID, missing model, workspace,
    or provider warnings.

The card registry supports search, sort, rarity filtering, showcase/grid/list
display, pagination, party deploy/remove, and Edit. Single-click selects a
card; Enter selects a focused card; double-click toggles party membership;
right-click opens the editor; **Deploy**, **Remove**, and **Edit** are explicit
card actions.

## 5. Agent Editor: every tab and control

Open an agent card’s **Edit** action or context menu. The editor saves most
changes automatically. **Done** closes the editor after pending autosaves are
flushed. The header shows the agent ID, level, rarity, and global save status.

### Profile

Use **Profile** for identity and presentation:

- Change the portrait by choosing an image with **Browse**, entering a portrait
  URL/path, or using **Clear**.
- Edit the agent **Name**, **Role**, **Class**, and **Level**. Level is bounded
  by the editor’s numeric validation.
- Change **Behavior** among executor, architect, auditor, researcher, and
  hybrid profiles.
- **Inbound message leader** shows whether the agent receives unbound messages
  by default. The selected agent is labeled **Primary assistant**; choose
  **Make default** on another agent to change the fallback inbound route,
  including unbound Telegram DMs when supported. More-specific custom routes
  can still send messages to other agents.
- Review the identity/routing area before changing the default-agent status.
- Portrait uploads and identity edits are separate from model authorization and
  tool permissions.

Do not describe a portrait as a permission change. Do not say an agent is the
default unless the UI’s saved state says so.

### Model

Use **Model** for the provider/model lane and turn execution defaults:

- Review the billing/route banner first. Managed Automnia routes show a
  Subscription Relay/credits path; BYOK routes show the connected provider
  path.
- Select the **primary model** when the route is not managed.
- Select additional model fallbacks. The primary model is removed from the
  fallback list automatically when it becomes primary.
- If authentication is missing, use **Connect**. If it exists, use **Update
  Auth**. Secrets belong in that secure provider modal, never in Help or
  Command Console.
- Set **Reasoning Effort** to Off, Minimal, Low, Medium, High, Extra high, or
  Maximum. The selected effort is provider-native for that agent.
- Set **Work Timeout** with the 30-second to 2-hour slider or its visible
  presets. This is the allowance for a real agent turn, not an idle heartbeat.
- Model changes autosave with a short debounce. A visible failure means the
  local projection may be ahead of the Gateway; retry after reading the status.

An available model is not the same as an authorized model. Verify provider
authentication, model catalog availability, route/usage priority, and Gateway
health before blaming the model.

### Heartbeat scheduler

Use **Heartbeat scheduler** for the agent’s recurring runtime pulse:

- **Wake Interval** controls the time between heartbeat pulses (1 second to 30
  minutes in the slider).
- **Idle Timeout** controls how long an inactive loop can remain before yielding
  (5 seconds to 30 minutes in the slider).
- **Continuous** keeps the loop active between ticks.
- **Auto-Recovery** retries on a recoverable failure.
- **Quick Set** presets are Fast, Norm, Deep, Loop, and Build. Each preset
  changes wake interval, idle timeout, continuous mode, and recovery together.
- When the agent is party slot 1, the panel shows **Party Leader — Spot 1** and
  explains that its heartbeat runs first to orchestrate the team. An agent not
  in the party shows **Not in party** and **Add to party to activate
  heartbeat**.
- The panel shows formatted durations such as seconds, minutes, or hours and a
  save status below the controls.

Heartbeat changes are debounced and persisted per agent. A heartbeat is not a
mission, and turning it on does not grant a plugin credential or authorize
outbound communication.

### Policy sandbox

Use **Policy sandbox** to bound runtime access:

- **Mode**: `off`, `all`, or `non-main`.
- **Scope**: `session`, `agent`, or `shared`.
- **Workspace access**: read/write (`rw`), read-only (`ro`), or no workspace
  access (`none`).
- **Allow tools**: comma-separated tool names explicitly permitted.
- **Deny tools**: comma-separated tool names blocked even if otherwise
  available.
- Changes autosave automatically. Wait for the status banner to report the
  sandbox/tool policy as saved before starting a consequential turn.

Prefer the narrowest workspace and tool set that can complete the task. A
Markdown instruction cannot override a sandbox or denied tool. A successful
policy save does not prove that a provider or external account is connected.

### Workspace

Use **Workspace** to assign the agent’s working directory:

1. Enter a path or choose **Browse**/the native directory picker.
2. Review suggested folders when the picker reports them.
3. Select a listed folder or save the entered path.
4. Wait for the workspace validation/autosave status.

The backend validates access before accepting the path. Moving an agent’s
workspace preserves the canonical agent doctrine/resources; it does not
silently delete the old user project directory. Workspace access and sandbox
access still apply when the agent runs.

### Skills

Use **Skills** to equip reusable procedures:

- **Search** filters installed/shared skills by name, description, ID, and
  source.
- Filters distinguish all, enabled, and disabled entries.
- The status badge shows enabled count and ClawHub count.
- **Refresh** re-reads the shared skill inventory.
- The ClawHub search field and **Search** load discoverable results.
- **Install** adds a skill to the shared OpenClaw skills folder.
- **Update** updates a ClawHub skill already installed.
- Toggle an installed skill to enable or disable it for this agent.

Installing a skill does not automatically authorize it for every agent. Review
the skill’s instructions and tools before enabling it. Never install a
community skill silently on a user’s behalf. Use a bounded Command Console
task after enabling it.

### Agent files

Use **Agent files** for the agent’s Markdown instruction and resource files.
The file list is loaded from the canonical agent doctrine workspace and only
Markdown files are listed. Common files include identity, soul/behavior,
bootstrap, rules, user instructions, heartbeat, memory, tools, and mission
guidance; the actual list is dynamic.

1. Open **Agent files** and wait for the list to load.
2. Select a file button, such as `SOUL.md` or `IDENTITY.md`.
3. Wait for the content load to finish before editing.
4. Edit the Markdown in the text area.
5. Pause after editing; the file autosaves after a short delay and reports
   **Waiting to save**, **Saving**, **saved automatically**, or an error.
6. If switching files while changes are pending, Automnia flushes the current
   file before loading the next one.
7. Use **Reload** when the list or content request times out.

The file editor writes a canonical path and verifies the persisted content. An
`IDENTITY.md` name change can also propagate the display name through related
agent Markdown and local configuration. Markdown changes shape behavior but do
not grant credentials, bypass the sandbox, or approve external actions.

### Retire an agent from Agent files

Retirement is intentionally located at the bottom of the **Agent files** tab.
It is not the same as removing an agent from the active party.

1. Open **Agents**.
2. Select the exact agent card and choose **Edit**.
3. Confirm the editor header shows the intended agent name and ID.
4. Open **Agent files**.
5. Save or copy any Markdown doctrine that must be retained. Export or back up
   any user project files separately; retirement is irreversible.
6. Click the red **Retire** button.
7. Read the confirmation dialog. It states that the agent’s OpenClaw
   customizations, profile, sessions, and agent state will be permanently
   deleted, while the workspace folder will not be deleted.
8. Choose **Cancel** if the ID, workspace, or preservation plan is wrong.
9. Choose **Yes, retire** only after review.
10. Wait for **Retiring...** to finish. Do not close the app during the save if
    the status is still active.
11. Verify the agent disappears from the registry and active party. A mission
    using that agent is stopped/removed from the local projection, and command
    console drafts for the retired agent are cleared.
12. Refresh the party list or reopen Agents if the request timed out. A timeout
    is ambiguous: the server may have completed the purge in the background.

The main agent (`main`) cannot be retired. The server records the retired ID,
removes it from OpenClaw agent configuration and profile records, clears active
sessions and runs, removes per-agent heartbeat defaults, removes canonical
doctrine and Codex profile state, removes shared per-agent state and memory
SQLite files, and schedules a Gateway restart when configuration changed.
The arbitrary user-selected project workspace is preserved. Retirement does
not provide an undo or a recycle bin. A previously retired ID is treated as
already retired and is not recreated by roster synchronization.

## 6. Settings: every category and nuance

Open **Settings** from the bottom of the left rail. The category search filters
the seven sections. Preferences normally save and apply immediately; actions
that affect multiple agents or delete temporary state ask for confirmation.

### Account & License

**Account & License** displays:

- Read-only account email and whether Google sign-in or an Automnia password is
  linked.
- **License Authorization** status. The license key remains server-local and
  is never revealed in the UI.
- **Plan or Access Tier**, **Access & Billing Mode**, **Usage Priority**, and
  **Effective Agent Route**.
- Confirmed pooled Automnia credit balance and balance timestamp.
- Secure checkout/plan controls, account refresh, legacy purchase linking, and
  **Log out of Automnia**.

The usage choices are **Automnia credits** or **My provider + Automnia credits**
when the entitlement allows it. The combined choice exposes a secondary order
selector for **My provider first** or **Automnia first**. Starter and
credit-refill access remain locked to Automnia credits; a confirmed zero balance
must produce an explicit refill message. BYOK and higher tiers can use the
connected provider when Automnia credits are selected first but the confirmed
balance is zero. The exact entitlement shown by the account screen wins over
remembered pricing. A provider password/key is not the Automnia account
password.

For password management:

- A Google-linked account without a password sees **Create an account
  password** and does not need a current password.
- An account with a password sees **Change account password** and must provide
  the current password.
- Use **Connect Google securely** when the account needs the supported Google
  ownership link.
- Never paste the license key, password, OAuth code, or provider key into Help.

### Appearance

**Appearance** changes the shell live:

- **Accent mode**: Reference cyan, No-blue graphite, Ember operations, or
  Green terminal.
- **Form chrome**: Graphite, Obsidian, or Warm black input/search/select
  surfaces.
- **Interface density**: Compact, Comfortable, or Spacious.
- **Motion**: Standard or Reduced.
- **High contrast** raises muted text, borders, placeholders, and focus rings.
- **Reduced glow** removes nonessential bloom/halos.
- **Control glow** highlights active controls; it is disabled when Reduced glow
  is enabled.
- **Neutral scrollbars** uses graphite scrollbar thumbs.
- **Restore appearance defaults** changes only appearance preferences.

### Workspace

**Workspace** contains two groups:

Agent registry:

- **Default view** controls showcase/grid/list density and page size.
- **Use rarity colors** maps Legendary to Original, Epic to Purple, Rare to
  Blueprint, and Common to Graphite.
- **Card background** chooses rarity or a shared overlay theme.
- **Default sort**: Party first, Highest level, Name A–Z, or Rarity.
- **Rarity filter**: All, Legendary, Epic, Rare, or Common.

Command console:

- **Show console in Agents** hides or restores the split console.
- **Console width** is adjustable from 360px to 760px and is clamped on narrow
  windows.
- **Remember unfinished drafts** restores unsent text after reload. Turning it
  off clears stored drafts; it does not delete sent responses.
- **Restore workspace defaults** resets registry and console preferences.
- **Open Agents** navigates directly to the Agents workspace.

### Voice

**Voice** controls dictation next to the Command Console Send button:

- **Provider**: **Local** keeps speech on-device after the one-time model
  download; **Cloud** uses the configured OpenAI provider.
- **Stop after a pause** enables automatic end-of-speech transcription.
- **Pause sensitivity** ranges from 0.60s to 3.00s and is disabled when auto
  stop is off.
- **Maximum recording** is 30 seconds, 1 minute, 2 minutes, or 5 minutes.
- **Noise suppression**, **Echo cancellation**, and **Automatic gain** are
  browser-level microphone processing options.
- **Restore voice defaults** resets only voice preferences.

Cloud voice is an explicit data transfer choice. Local mode must not be
described as silently falling back to Cloud.

### Missions

**Missions** sets defaults for future deployments:

- Mission title and default objective.
- Mission type: Build, Plan, Research, Command, or Memory.
- Collaboration: Command/hierarchical, Parallel, Specialist, Relay, or Swarm.
- Duration mode: Instant, Timed, Continuous, or Indefinite.
- Timed duration amount and unit: hours, days, or weeks.
- Complexity and risk tolerance sliders.
- Required evidence toggles, including files changed, tests, build, human path,
  risk review, runtime preflight, and team sync when present in the draft.
- **Restore mission defaults** and **Open Missions**.

These are defaults, not a launch. A mission still needs an active-party
loadout, readiness, a usable route, and a concrete objective.

### Agent runtime

**Agent runtime** applies bulk policy only after an explicit target choice:

1. Choose **Party** or **Selected** in **Target agents**.
2. Inspect the target count and the per-agent target buttons.
3. Click agents to add/remove manual selection when using **Selected**.
4. Use **Clear manual selection** when the selection should be emptied.
5. Set **Heartbeat cadence** and **Idle timeout** in seconds (5–1800).
6. Set **Continuous heartbeat** and **Automatic recovery**.
7. Set **Work timeout** in minutes (1–120).
8. Set **Thinking default**: Off, Minimal, Low, Medium, High, Extra high, or
   Maximum.
9. Set **Fast mode**: Auto, On, or Off.
10. Set **Parallel preferred** when independent subtasks may run together.
11. Click **Apply to N agents**. If there are no targets, nothing is written.
12. **Restore runtime defaults** requires confirmation and writes the defaults
    to the current target set.

Changing a draft slider does not write the full party until Apply is clicked.
This is a safeguard against accidental bulk overwrites.

### Data & reset

**Data & reset** has deliberately separate scopes:

- **Copy settings backup** copies non-secret UI preferences and the current
  mission draft to the clipboard. It excludes credentials.
- **Clear command drafts** removes unsent console drafts.
- **Clear console responses** removes stored response projection data.
- **Reset runtime simulation** resets local simulation/projection state.
- **Reset all app preferences** restores appearance, workspace, voice, and
  mission defaults while keeping agents, credentials, plugins, workspaces, and
  files.
- **Clear party and responses** removes the current active party and console
  responses while keeping the rostered agents.

None of these controls retires an agent. Use the Agent Editor’s **Agent files →
Retire** path for that lifecycle action.

## 7. Missions, Monitor, Plugins, and Command Console

### Missions

Use **Agents** to recruit/configure agents and create the active party first.
Open **Missions**, select a preset if useful, enter a concrete objective, pick
the dispatch mode and mission type, confirm timing/cadence, review readiness,
and choose **Deploy & Run Now**. During execution, **Stop Mission** cancels and
**Steer Mission** changes direction. Read Mission History and the final report;
do not call a green launch state proof of a completed outcome.

### Monitor

Monitor tabs are **Gateway**, **scheduler**, **performance**, and **logs**.
The Gateway tab exposes **Doctor**, **Restart Gateway**, **Clean Slate**, and
refresh/lifecycle controls. Clean Slate clears local monitor/runtime projection
state and stale locks; it does not create credentials, delete durable
transcripts, or repair a provider account. Use the active cron controls only
after reviewing the jobs; pause-all requires confirmation.

### Plugins

Use **Plugins → Search → Setup → Save Setup → Start/Restart → Refresh/Inspect**.
The panel can also install, update, and uninstall. Secret fields belong only in
the secure plugin form. After plugin setup, enable the related skill in
**Agents → Edit → Skills** and send a small bounded console task.

ClawTalk is configured through its plugin, not a generic agent phone field.
Telegram uses BotFather plus the Telegram plugin’s **Setup** flow. A selected
agent can inspect the resulting status, but cannot obtain or approve the secret
token for the operator.

### Command Console

The console sends a task through the local OpenClaw Gateway. Before sending,
review the target chips, Gateway/stream status, attachments, voice mode, and
message boundaries. A good bounded request includes:

```text
Inspect the current setup for [goal]. Use only configured tools. Complete safe
configuration and verification that your policy allows. Do not contact anyone,
publish, purchase, delete, or send an external message without my approval.
Never ask me to paste a secret into chat. Return evidence, the exact remaining
human step, and any files or settings changed.
```

**Stop** stops active console turns; it does not erase prior responses. A
stream reconnect or Gateway restart is not proof of completion. Read the final
response and Monitor evidence.

## 8. Assistant response contract

The Help Assistant is a product guide, not a live desktop inspector. It cannot
see the operator’s screen, local files, raw Gateway logs, passwords, provider
secrets, Firestore records, or current account state unless the product
explicitly supplies a redacted result.

For setup questions, use this order:

1. State the outcome and the exact Automnia surface.
2. If a configured primary agent can help, give the agent-first path first:
   select the agent in **Agents**, open **Command Console**, and provide a
   ready-to-paste bounded prompt.
3. Say what the agent can inspect, configure, and verify with its enabled tools.
4. Name the smallest remaining human step when account ownership, OAuth,
   billing, approval, or a secure credential is required.
5. Give the detailed manual path second with exact labels.
6. State the expected success evidence and the safest next check.
7. Include a recovery branch for Gateway offline, migration, provider auth,
   plugin stopped, policy denied, timeout, or stale UI.

For the Agent Editor, mention the exact tab. For retirement, explicitly warn
that it is irreversible, main cannot be retired, the arbitrary project
workspace is preserved, and the agent’s canonical state/sessions/configuration
are removed. For Settings, name the category and distinguish preference reset,
workspace cleanup, and agent retirement.

Never ask a user to paste a password, API key, OAuth token, Telegram token,
ClawTalk key, license key, customer list, cookie, or private file into Help or
Command Console. Never claim to have changed a setting, checked live state,
reconnected a Gateway, repaired a machine, or completed a deployment without
explicit evidence.

### Help navigation links and sessions

The Help panel recognizes product terms in assistant answers and turns them
into navigation buttons. Current destinations include Recruit, Agents, Agent
Editor/Registry, Agent files/Files, Command Console, Missions, Monitor,
Plugins, ClawTalk, Telegram, Settings, Account & License, and Data & reset.
Clicking a link navigates or focuses the relevant surface; it does not perform
the described action.

Follow-up questions stay in the same knowledge session until **New chat** is
chosen. **New chat** clears the local transcript and starts a fresh session.
If the knowledge service cannot return a grounded answer, the UI shows the
failure in the conversation and does not claim that a task was completed.

## 9. Google Cloud and private Help operations

The Google Cloud deployment is operator-owned and separate from the local
desktop runtime. Read `docs/GCLOUD_ADMIN_GUIDE.md` and `infra/gcloud/README.md`
before changing cloud state.

Important operator surfaces include:

- `infra/gcloud/config.psd1`: deployment configuration and service values.
- `infra/gcloud/deploy.ps1`: deploys the Cloud Run service using the selected
  configuration.
- `infra/gcloud/verify.ps1`: verifies deployed service state and endpoints.
- `infra/gcloud/health.ps1`: checks service health.
- `infra/gcloud/switch-traffic.ps1`: moves traffic between revisions.
- `infra/gcloud/rollback.ps1`: rolls traffic back to a known revision.
- `infra/gcloud/initialize-firestore.ps1`: initializes required Firestore
  indexes/collections.
- `infra/gcloud/migrate-firestore.ps1`: performs the documented migration.
- `infra/gcloud/export-firestore.ps1` and `import-firestore.ps1`: controlled
  data operations; exports are sensitive and must never enter Help indexing.
- `infra/gcloud/tools/smoke-service.mjs`, `live-billing-test.mjs`, and related
  tools: operator validation utilities. Run only with an explicit validation
  request and approved credentials.

The Cloud service provides account verification, pooled Automnia credits,
provider relay behavior, and `/api/knowledge/answer`. The Help endpoint is
read-only product support and uses the private Discovery Engine serving config.
The publisher sends sanitized documents with citations enabled. A knowledge
deployment issue is not the same as a local Gateway issue.

### Publishing the Help corpus

From the repository root:

1. Review the Markdown sources under `docs/`, `infra/gcloud/knowledge/`, and
   the root safety documents.
2. Run `npm run publish:knowledge -- --dry-run` when a corpus preview is
   explicitly requested. This prepares document IDs, byte sizes, and source
   paths without authenticating to Google Cloud.
3. For an approved production update, set the documented
   `AUTOMNIA_KNOWLEDGE_PROJECT`, `AUTOMNIA_KNOWLEDGE_LOCATION`, and
   `AUTOMNIA_KNOWLEDGE_DATA_STORE` overrides only when needed, then run the
   publisher with authenticated `gcloud` access.
4. Confirm the published document count and IDs. The publisher redacts common
   credential examples but is not permission to add secrets to Markdown.
5. Redeploy the Cloud service if its serving configuration or preamble changed.

Do not edit `release/**` or `vendor/openclaw/docs/**` to fix Help answers. Edit
the canonical Automnia docs, refresh the synced OpenClaw snapshot only through
its documented sync workflow, then republish the sanitized corpus.

## 10. Troubleshooting matrix

| Symptom | First place | Correct explanation/action |
| --- | --- | --- |
| Login appears again | **Login** / account session | Re-authenticate; do not call this a Gateway failure. |
| License gate appears | **License Activation** / **Settings → Account & License** | Link/refresh the verified account; never paste the key into Help. |
| Gateway migrating | Header chip / **Monitor → Gateway** | Wait for migration and retry window; do not start another process or delete locks. |
| Gateway offline | **Monitor → Gateway → Doctor** | Read current lifecycle/stderr, then use Restart Gateway if the evidence supports it. |
| Help unavailable | Help error plus Cloud service configuration | Distinguish service outage, missing serving config, license issue, and local network. |
| Agent has no response | Agents target, Model tab, provider auth, Monitor | Verify target chip, model route, provider auth, policy, and Gateway. |
| Plugin stopped | **Plugins → Refresh/Inspect** | Setup/save credentials securely, then Start or Restart and verify. |
| Workspace save failed | **Agent Editor → Workspace** | Read the validation error; choose an accessible path. The app should not silently accept a bad path. |
| Markdown file not shown | **Agent files → Reload** | The list is canonical `.md` files only. Check agent ID, workspace context, and file extension. |
| Retirement timed out | **Agents → Agent files**, then refresh roster | The server may have finished. Check whether the agent disappeared before retrying. |
| Mission cannot deploy | **Missions** readiness panel | Add/configure an active party, route, objective, and required evidence. |
| Voice is inaccurate | **Settings → Voice** | Choose Local/Cloud intentionally, adjust pause and microphone processing, and check browser permission. |
| UI looks stale after an update | shell lazy-import recovery | Reload once; the shell has a bounded dynamic-import recovery path. Do not delete runtime state. |

When escalation is needed, request only redacted diagnostics from **Monitor**,
**Doctor**, or **Diagnostics**. Never request passwords, provider keys, raw
Firestore records, or a full private workspace.

## 11. Documentation maintenance rules

When a visible label, Agent Editor tab, retirement behavior, Settings control,
Cloud route, or Help navigation target changes:

1. Update the source-verified UI reference and this manual.
2. Update the relevant agent setup/playbook knowledge file if response behavior
   changes.
3. Confirm the docs-folder map still matches the repository.
4. Confirm the knowledge publisher includes the new Markdown source.
5. Add or update the relevant unit/smoke contract, but run it only when the
   operator explicitly authorizes validation.
6. Keep packaged/vendor/generated trees out of manual edits.

The goal is a Help response that is exact enough for a user to operate the
current app, honest about what is not observable, safe around secrets and
destructive actions, and useful whether the user wants an agent to help or
wants to perform the steps manually.
