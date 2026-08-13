# Automnia Agent Setup and Navigation Guides

This guide is the user-facing source of truth for the Automnia Assistant. It
describes the controls that exist in the current desktop app and separates them
from setup that belongs to a provider, Google Cloud, Telegram, or OpenClaw.

## 1. Find the right Automnia control

The fixed left navigation rail is the starting point for every workflow:

| Left-rail control | Use it for |
| --- | --- |
| **Recruit** | Create a new agent from a template or blank defaults. |
| **Agents** | Select, deploy, edit, and talk to agents. The Command Console is on the right when enabled. |
| **Missions** | Dispatch structured, repeatable, multi-agent work. |
| **Monitor** | See Gateway health, logs, sessions, channel activity, active work, and recovery controls. |
| **Plugins** | Install, start, stop, configure, inspect, refresh, and update plugins. |
| **Settings** (bottom utility navigation) | Account, provider route, UI, Command Console layout, agent defaults, voice, and recovery preferences. |
| **Help** (bottom utility navigation) | Ask Automnia Assistant for product guidance. |

The top-right workspace chips summarize **Agents**, **In Party**, **Running**,
**Gateway**, **Cron**, and **Results**. `Gateway: ON` is the ready state. If it
says `MIGRATING`, keep Automnia open and wait; do not start a second gateway or
delete state files. If it says `OFF`, use **Monitor** before retrying a large
task.

## 2. The Command Console: ask an agent to do the work

Open **Agents**. The Agent Registry is the large center/left area, and the
**Command Console / Agent Chat** is the right-hand panel. If the Console is
hidden, use **Show console** in the Active Party strip toolbar. Its visibility,
width, and draft behavior can also be changed in **Settings > Workspace >
Command console**.

1. In **Agent Registry**, click a card once to select an agent. The selected
   card becomes a Command Console recipient. A card’s **Deploy** button adds it
   to the active party; double-clicking a card also toggles party membership.
2. In the right Command Console, check the recipient chips above the transcript.
   Click an unwanted chip’s `×` to remove it from this chat.
3. Type a clear task in the `Command console message` field and use the send
   arrow or `Enter`. Use `Shift+Enter` for a line break. The `+` control attaches
   an allowed file and the microphone control dictates a prompt.
4. Read streamed progress and the final response. Use **Stop** only to cancel
   currently running turns. A `Gateway` or stream warning should be checked in
   **Monitor** before repeatedly retrying.

Use the Command Console when the task is more than a short question: diagnose a
setup, inspect files, research a subject, prepare content, build or review
code, compare options, organize a workflow, or carry out an already-authorized
tool action. Give the agent scope, result, constraints, and a verification
request. Example:

```text
Set up a safe email-triage workflow for this agent. First inspect which Google
Workspace/Gog capabilities are ready. Do not send, archive, delete, or label
mail. Report the exact remaining setup step, then give me a test plan.
```

For an action with external impact, say the approval boundary explicitly:

```text
Research and draft three YouTube video concepts from the last 10 videos on this
channel. Do not log in, upload, publish, comment, or change channel settings.
Return sources and a draft for my approval.
```

## 3. Create and configure an agent

### Create it

1. Click **Recruit** in the left rail.
2. In **New Agent**, use **Template** to search or browse an agency template,
   or choose **Blank recruit defaults**. A template prepares a role, tool
   access, and starter markdown; review it before creating.
3. Under **Basics**, enter **Name** and **Agent ID**. Agent IDs are lowercase
   hyphenated identifiers, for example `gmail-ops`.
4. Under **Style**, choose a behavior profile: **Executor**, **Architect**,
   **Auditor**, **Researcher**, or **Hybrid**. Then review **Class**, **Role**,
   **Level**, and the persona-detail slider.
5. In **Runtime lane**, choose a **Model**. If its provider shows `auth
   required`, click **Connect** and complete that provider’s secure flow. Set a
   narrow **Workspace** when the agent needs files.
6. In **Capabilities and party**, enable only the needed capabilities and
   choose **Add to active party** only when the agent should join the current
   team.
7. Review the **Markdown files** panel. It contains the durable agent context
   files such as `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, and `MISSION_PROMPT.md`.
   Edit them only when their instructions should persist for future work.
8. Click **Create Agent**. Then select the new card in **Agents** and send a
   small direct Command Console test before assigning a mission.

### Tune it after creation

1. Open **Agents**, find the card, and click **Edit**. Right-clicking the card
   also opens the same editor.
2. The Agent Editor tabs are **Profile**, **Model**, **Heartbeat scheduler**,
   **Policy sandbox**, **Workspace**, **Skills**, and **Agent files**. Changes
   save automatically; use **Done** to close after pending saves finish.
3. Use **Model** for primary/fallback models, reasoning, and work timeout.
4. Use **Policy sandbox** for sandbox mode, scope, workspace access, and
   allow/deny tool lists. Start narrow. Do not give every agent unrestricted
   file or browser access.
5. Use **Skills** to search the shared skill library or ClawHub, install a
   reviewed skill, and check the box that enables it for this agent.
6. Use **Agent files** for the markdown resource files that shape recurring
   behavior. Put stable role and safety rules here, not in one-off prompts.

## 4. Plug-ins: install, configure, verify

Open **Plugins** from the left rail. The top search field filters installed
plugins; typing `/clawhub ` followed by a query switches it to ClawHub plugin
search. Plugin rows provide the actual state and actions:

| Control | Meaning |
| --- | --- |
| **Setup** | Opens the secure fields required by the plugin. |
| **Start** / **Stop** | Enables or disables the plugin. |
| **Refresh** | Re-reads plugin/runtime state. |
| **Manage** | Reveals **Update**, **Inspect**, **Restart**, and **Uninstall**. |
| **Inspect** | Confirms whether the live runtime registered the plugin’s surfaces. |

Safe sequence:

1. Search for the capability or plugin name.
2. Read its description, source, required setup, and permissions. For a third
   party ClawHub result, review the publisher, version, changelog, and security
   scan before installation.
3. Click **Install** only after review. Keep **Pin installs** on when you want
   the version held for repeatable behavior.
4. Click **Setup** if the row calls for it. Put keys, OAuth values, or tokens
   only in the password-style secure field—never in Help or a Command Console
   message.
5. Save, wait for any Gateway restart, then use **Refresh** and **Manage >
   Inspect**. `runtime loaded` is the evidence that a plugin is usable now;
   merely appearing in the list is not proof that its live tools are loaded.
6. Test a small, read-only action and watch **Monitor** for runtime/channel
   evidence before enabling automation or outbound work.

An Automnia agent can help with a complicated plugin task. In Command Console,
give it the plugin name and desired outcome, and ask it to diagnose and repair
what it safely can. The user still supplies a missing account, token, or consent
in the appropriate secure flow. Example:

```text
Check the ClawTalk plugin for this agent. If it is missing, disabled, or not
loaded, use safe runtime diagnostics and repair what you can. Do not ask me to
paste secrets here. Tell me only the secure field or account approval that is
still required, then verify the final runtime state.
```

## 5. ClawTalk: phone calls and SMS

ClawTalk is the Automnia phone/SMS integration. It is configured as a plugin,
not as a phone-number field on the Agent Profile.

### Connect ClawTalk in Automnia

1. Get a valid ClawTalk account/API key from the ClawTalk service. Keep it
   private.
2. In Automnia’s left rail, open **Plugins** and search `ClawTalk`.
3. On the ClawTalk row, review **ClawTalk runtime**. Click **Setup** when the
   row says setup is required. If it is not installed yet, use **Install** first.
4. In the setup dialog, paste the key into **API key** and click **Save Setup**.
   The app installs/enables the plugin when required, saves the key securely,
   restarts/checks the Gateway, then verifies the bot and WebSocket connection.
5. When the dialog closes, use **Refresh**. The ClawTalk overview should show
   **Plugin: enabled**, **Runtime: loaded**, **API key: stored**, and no restart
   requirement. Use **Manage > Inspect** if a value remains pending.
6. Select the intended agent in **Agents** and send a small non-outbound
   Command Console request: `Check ClawTalk status for this agent and report
   the configured phone-channel capabilities. Do not contact anyone.`

### Give an agent a phone number

The phone identity belongs to the ClawTalk account/channel configuration, not
to the card’s **Name** or **Agent ID**. Automnia currently does not expose a
separate `phone number` box on an agent card. After the plugin is connected:

1. Select the agent in **Agents** and use the Command Console.
2. Ask the agent to inspect the ClawTalk status and complete available safe
   setup. It can use the ClawTalk runtime tools to check configuration and
   report the exact remaining account/phone requirement.
3. Provide a number only through the trusted ClawTalk account/configuration
   process that the tool identifies; do not paste private phone details into
   Help. The agent needs a valid recipient and an approved message/call task
   before it can contact anyone.
4. First test with a number and message you control. Review the tool result and
   Monitor evidence. Keep approval enabled for customer, sales, or sensitive
   outbound calls and texts.

Use this safe prompt:

```text
Set up and verify the ClawTalk phone channel for this agent. Inspect the
configuration first and repair only what is safe. Do not call or text anyone.
Tell me the exact remaining secure account, number, or authorization step, and
return the diagnostic evidence.
```

## 6. Telegram: bot setup, pairing, and testing

Telegram requires a bot token from Telegram and a configured Telegram channel.
It does not use a normal username/password login in Automnia.

1. In Telegram, open the official **@BotFather**, run `/newbot`, and follow the
   prompts. Save the returned bot token in a secure place. Do not paste it into
   Help or normal chat.
2. In Automnia, open **Plugins** and search `Telegram`. If a Telegram plugin is
   available, install/start it as needed, then choose **Setup** and enter the
   token only in the secure setup field. Save and wait for the Gateway restart
   if requested.
3. Click **Refresh**, then **Manage > Inspect** to verify the runtime. In
   **Monitor**, check the newest channel/lifecycle event rather than assuming
   that a successful save means Telegram is delivering messages.
4. Start with direct-message pairing, the safest default. Message the bot from
   your Telegram account. The OpenClaw pairing code is time-limited; approve it
   through the configured OpenClaw pairing path. If the current app does not
   show a dedicated pairing control, ask a selected agent in Command Console to
   check Telegram pairing status, or use the documented OpenClaw pairing
   command in an advanced local setup.
5. For a group, add the bot, use the numeric Telegram user ID in the sender
   allowlist, and use the negative group chat ID under the group configuration.
   These are different values. Keep `requireMention` on for the first test and
   test with `@your_bot_username ping`.

For a one-owner bot, use an explicit numeric allowlist rather than public
access. Do not choose a public/open policy with powerful agent tools. In
BotFather, review Privacy Mode and group permissions; a bot may need Privacy
Mode disabled or admin status to see every group message. Remove and re-add it
to the group after changing that setting.

## 7. Google Workspace email, Calendar, Drive, Sheets, and Docs with Gog

`gog` is the bundled Google Workspace CLI skill. It can support Gmail,
Calendar, Drive, Contacts, Sheets, and Docs after the **gog** binary and Google
OAuth are configured. It is not Automnia’s account sign-in and it is not the
same thing as Google Vertex model authentication.

### Prepare the agent in Automnia

1. Create or edit a focused agent such as `gmail-ops` using **Recruit** or
   **Agents > card > Edit**.
2. In the editor’s **Skills** tab, search for `gog` and enable it for the agent
   if it is shown as available. Also consider **taskflow-inbox-triage** for a
   durable inbox workflow.
3. In **Policy sandbox**, allow only the workspace/tools the workflow needs.
   Start with read-only email research; do not grant bulk deletion, outbound
   mail, calendar edits, or broad Drive access by default.
4. Select the agent and use Command Console to ask it to check Gog readiness.
   If `gog` is missing, the agent can identify the missing binary or OAuth step;
   it cannot bypass Google consent.

### Configure Gog and Google Cloud OAuth

This is a one-time local/Google Cloud setup. It is intentionally outside a
normal Automnia form because it creates a Google OAuth client and opens Google
consent in a browser.

1. In Google Cloud Console, create or select a project dedicated to this
   personal/workspace automation.
2. In **APIs & Services > Library**, enable only the APIs required for the
   first workflow: Gmail API for email, then Calendar API, Drive API, Google
   Sheets API, Google Docs API, and People API only when needed.
3. In **Google Auth Platform**, configure Branding and Audience. For a personal
   setup, choose the appropriate external audience, add yourself as a test user
   while testing, and publish the OAuth app when Google’s workflow permits it
   so refresh tokens do not expire under a short testing window.
4. In **APIs & Services > Credentials**, choose **Create credentials > OAuth
   client ID > Desktop app**. Download the client JSON to a protected local
   folder. Treat the file as sensitive and never upload it to Help, Agent Files,
   or a project repository.
5. Install the `gog` binary if Automnia/Gog reports it missing. On a supported
   macOS setup the documented route is `brew install openclaw/tap/gogcli`.
6. Either have a trusted Command Console agent walk you through the local setup
   or run the guided command locally:

```bash
gog auth setup you@example.com --gcloud-project YOUR_PROJECT_ID \
  --credentials /protected/path/client_secret.json --login
```

7. Grant only the services needed for the agent:

```bash
gog auth add you@example.com --services gmail,calendar,drive,docs,sheets,contacts
gog auth list --check
```

For email triage, begin with a Gmail read-only scope when supported by the Gog
version, then add write/send privileges only after a successful read-only test.
Gog stores refresh tokens in the operating-system credential store when it is
available; never place those tokens in an agent prompt or repository.

### Safe Gmail agent workflow

1. Ask the agent to list/search a small inbox sample and produce categories,
   summaries, draft responses, and items needing approval.
2. Keep sending, archiving, labeling, deleting, forwarding, and calendar
   creation off until you review the initial report.
3. When ready, give a named approval boundary: “Create drafts only” is safer
   than “handle my email.”
4. For recurring work, use a Mission or a scheduled heartbeat only after the
   direct Command Console workflow produced the correct result and Monitor
   shows clean evidence.

Example:

```text
Use the configured Gog Gmail access to review unread mail from the last seven
days. Group it by urgency, summarize each thread, and prepare reply drafts.
Do not send, archive, label, delete, forward, or create calendar events. Return
the draft text and a short approval checklist.
```

## 8. Google Cloud and always-on agents

Automnia’s hosted-credit relay is operated by Automnia; customers do not need
to deploy it to use hosted credits. Use **Settings > Account & License** to
check the active route, credit balance, and BYOK eligibility.

Use a personal Google Cloud project when you need one of these separate goals:

- a Gog OAuth client for Gmail/Calendar/Drive automation;
- Google Vertex AI credentials for an eligible BYOK model route;
- an always-on OpenClaw Gateway on a Compute Engine VM.

For a personal always-on Gateway, the documented architecture is a small
Compute Engine VM with Docker, persistent `~/.openclaw` state, a protected
Gateway token, and SSH port forwarding. Keep the Gateway loopback-only unless
you deliberately configure firewalling, HTTPS, and authentication. Use a
dedicated least-privilege service account for automation; do not give it the
Google Cloud Owner role. This is an advanced deployment: ask an Automnia agent
to plan and verify it, but review the cloud project, billing, IAM, network, and
secrets decisions yourself before authorizing changes.

## 9. YouTube and content operations

Automnia can help with YouTube research and content production through skills
such as **summarize**, **video-frames**, **browser-automation**, **diagram-maker**,
and Google Workspace tools. The useful workflows are different from publishing:

| Goal | Safe initial workflow |
| --- | --- |
| Research a channel/video | Use `summarize` for transcripts/summaries and browser research; ask for links and evidence. |
| Plan a video | Ask an agent for audience angle, hook, outline, title options, description, chapters, and thumbnail brief. |
| Turn a video into assets | Use transcripts, frame extraction, and a content agent to create clips, posts, emails, and a publishing checklist. |
| Upload/publish/manage YouTube Studio | Requires an explicit trusted YouTube/Google workflow, the needed OAuth/API or browser access, and a final operator approval. There is no generic Automnia “publish to YouTube” button. |

Create a content-focused agent, enable only the relevant skills, and start with
research/drafts. Example:

```text
Research this YouTube channel and its last 12 videos. Use public sources only.
Return a table of topic, hook, length, likely audience, and content gap, then
draft three video concepts. Do not log in, upload, publish, comment, or modify
the channel.
```

## 10. Skills and ClawHub

Skills are instruction bundles that tell an agent when and how to use a
capability. Plugins add runtime code/surfaces; skills teach the agent a
workflow. Both may require an installed binary, OAuth, API key, or approval.

The local skill search/install surface is **Agents > card > Edit > Skills**.
For a new community skill:

1. Search by the result you need, not by a vague product name.
2. Inspect publisher, source, version, required binaries, environment variables,
   permissions, changelog, and security scan.
3. Install only a skill you understand and trust, then enable it only for the
   appropriate agent. Do not make every skill global by default.
4. Run a minimal, read-only test from Command Console. Use **Monitor** for
   evidence.
5. Keep the version pinned when repeatability matters. Review updates before
   applying them.

Advanced OpenClaw commands follow the same safety sequence: search, verify,
then install. `openclaw skills install` targets the active agent workspace by
default; `--global` makes the skill available to all local agents. ClawHub
verification exposes a trust envelope/Skill Card and scans, but a passing scan
is not a substitute for reviewing what the skill can access. Never silently
install a community skill on a user’s behalf.

## 11. Troubleshooting guide

| Symptom | First exact place to check |
| --- | --- |
| No model response | **Settings > Account & License**, then the agent’s **Edit > Model**, then **Monitor**. |
| Plugin saved but does not work | **Plugins > Refresh > Manage > Inspect**, then **Monitor**. |
| Agent cannot see a skill | **Agents > card > Edit > Skills**; check it is enabled and that its binary/auth requirements are actually ready. |
| Telegram does not answer | **Plugins** runtime inspection, then **Monitor** channel activity and the pairing/allowlist state. |
| ClawTalk will not call/text | **Plugins** ClawTalk runtime overview, then a non-outbound Command Console status check. Confirm account, phone channel, recipient, and explicit approval. |
| Google/Gog fails | Check the Gog binary, OAuth client, enabled APIs, granted scopes, selected account, and OS credential store. Do not expose client JSON or tokens. |
| Gateway shows `MIGRATING` | Wait for `Gateway: ON`; do not launch another gateway. |

When the diagnosis is technical, use an agent for the evidence-gathering part:

```text
Diagnose why this agent cannot use [CAPABILITY]. Inspect only safe local
configuration, plugin/skill readiness, and Monitor-equivalent runtime state.
Do not change settings or contact external services. Return the shortest
evidence-backed fix list and identify any secret or approval I must provide.
```
