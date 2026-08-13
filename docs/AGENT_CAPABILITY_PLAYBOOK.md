# Automnia Agent Capability Playbook

This playbook is the source for the outcome templates shown in Automnia Help.
It is written for a user who knows what they want an agent to accomplish but
does not want to memorize every plugin, skill, model, policy, or scheduler
control.

The Help cards are suggestions, not automatic actions. Clicking one asks
Automnia Assistant for a guide. It does not configure an account, send a
message, publish content, or start a mission by itself.

## The universal setup pattern

For any new capability, use the same sequence:

1. **Choose the outcome.** Say what the agent should produce, who owns the
   decision, and what it must not do.
2. **Let the configured primary agent inspect first.** Select it in **Agents**,
   open the **Command Console**, and ask it to inventory the current model,
   plugins, skills, policy, workspace, and runtime readiness.
3. **Complete the secure handoff yourself.** Use **Provider connection** or
   **Plugins → Setup** for credentials, OAuth, tokens, phone ownership, and
   account consent. Never put a secret in Help, Command Console, Agent files,
   or a document.
4. **Equip the smallest capability set.** A plugin provides runtime surfaces;
   a skill teaches a workflow; a policy determines what the agent may access.
5. **Run a read-only or draft-only test.** Check the agent result and
   **Monitor** evidence before enabling outbound, destructive, or recurring
   work.
6. **Automate only after the direct test is correct.** Use **Missions** for
   structured repeatable work and **Heartbeat scheduler** for an agent pulse.

Use this prompt as the starting point for a configured primary agent:

```text
Act as the setup lead for [OUTCOME]. Inspect Automnia readiness first: the
selected agent, model route, enabled skills, installed/configured plugins,
workspace, policy sandbox, and Gateway status. Recommend the smallest safe
capability set. Complete only safe inspection, configuration, and verification
available to you. Do not send, call, publish, purchase, delete, change cloud
IAM, or make destructive changes. If I must provide a credential, OAuth
consent, account approval, browser login, phone number, or other secret, tell
me the exact secure Automnia or provider control; never ask me to paste it in
this chat. Return: (1) readiness evidence, (2) the recommended skills and
plugins, (3) a ready-to-paste task prompt for the next step, (4) the manual
Automnia path, and (5) the smallest remaining human approval.
```

If no configured agent exists, use **Recruit** first: choose a template or
**Blank recruit defaults**, set **Name**, **Agent ID**, **Behavior**, **Model**,
**Workspace**, and narrow capabilities, review the Markdown files, and click
**Create Agent**. Select the new agent in **Agents** and run a small console
test before asking it to lead another setup.

## Template 1: Customize an agent

### Agent-first prompt

```text
Audit this agent’s current configuration and propose a focused customization
for [ROLE OR OUTCOME]. Inspect Profile, Model, Heartbeat scheduler, Policy
sandbox, Workspace, Skills, and Agent files. Recommend only the changes needed
for the job, keep workspace and tools narrow, and do not apply changes until I
approve the plan. Return the exact controls, expected effect, a safe test, and
the final prompt I should use for the agent.
```

### Manual path

1. Open **Agents**, select the card, and click **Edit**.
2. Use **Profile** for Name, Role, Class, Level, Behavior, portrait, and
   inbound/default routing. A portrait does not grant power.
3. Use **Model** for the primary model, fallbacks, **Connect** or **Update
   Auth**, **Reasoning Effort**, and **Work Timeout**.
4. Use **Policy sandbox** for Mode, Scope, Workspace access, **Allow tools**,
   and **Deny tools**. Start with read-only or no workspace access.
5. Use **Workspace** to choose a narrow project folder. Validation must succeed
   before the path is accepted.
6. Use **Skills** to search, inspect, enable, or carefully install a procedure.
7. Use **Agent files** for durable Markdown behavior and operating rules. These
   files guide behavior; they do not grant credentials or bypass policy.
8. Changes autosave. Wait for the saved status before closing with **Done**.
9. Run a bounded Command Console test and verify the result in **Monitor**.

### Good customization recipes

| Agent shape | Suggested capabilities | First safe test |
| --- | --- | --- |
| Research desk | `summarize`, `browser-automation`, read-only workspace | Compare three public sources and return links. |
| Inbox triage | `gog`, `taskflow-inbox-triage`, no outbound mail | Summarize five unread threads; create no drafts yet. |
| Content studio | `summarize`, `video-frames`, `browser-automation`, Docs/Drive | Turn one public video into an outline and shot list. |
| Operator/commander | `taskflow`, narrow shared workspace, party access | Plan ownership across two specialist agents; change nothing. |
| Watcher | `blogwatcher` or a configured browser/plugin route | Report changed items without sending alerts. |

## Template 2: Manage email with an agent

`gog` supports Gmail, Calendar, Drive, Contacts, Sheets, and Docs after its
binary and Google OAuth are configured. Gog authentication is separate from
Automnia sign-in and separate from Vertex model authentication.

### Agent-first prompt

```text
Set up a read-only email triage workflow for this agent. Inspect whether the
gog skill, gog binary, Google OAuth account, Gmail scope, workspace, and policy
are ready. Recommend the smallest safe setup. Do not send, archive, label,
delete, forward, or create calendar events. After readiness is confirmed,
review a small sample of unread mail, group it by urgency, and return a draft
approval workflow plus the exact secure OAuth or local setup step still needed.
```

### Manual path

1. Create or edit a focused agent such as `gmail-ops`.
2. In **Agents → card → Edit → Skills**, enable `gog`; optionally enable
   `taskflow-inbox-triage` for a durable workflow.
3. In **Policy sandbox**, begin with read-only tools and a narrow workspace.
4. In Google Cloud, create/select a project and enable only Gmail API first.
   Add Calendar, Drive, Sheets, Docs, or People APIs only when needed.
5. Configure the OAuth consent screen and add yourself as a test user while
   testing. Create a **Desktop app** OAuth client in **APIs & Services →
   Credentials** and keep the downloaded JSON in a protected local folder.
6. On the local machine, use the Gog CLI when it is available:

```bash
gog auth setup you@example.com --gcloud-project YOUR_PROJECT_ID \
  --credentials /protected/path/client_secret.json --login
gog auth add you@example.com --services gmail
gog auth list --check
```

7. Ask the agent to inspect readiness, then test a small search and summary.
8. Only after reviewing the output, authorize **Create drafts only**. Sending,
   archiving, labeling, deleting, forwarding, and calendar edits require a
   named approval boundary.

### What the agent can complete

It can classify mail, summarize threads, find follow-ups, prepare drafts,
extract action items, propose labels, build a briefing in Docs, and schedule a
review mission after the connection is working. It must not imply that a draft
was sent or a message changed without tool evidence and approval.

## Template 3: Give an agent a phone number with ClawTalk

The phone identity belongs to the authorized ClawTalk account/channel. There
is no generic phone-number field on an Agent Profile.

### Agent-first prompt

```text
Inspect and prepare the ClawTalk phone channel for this agent. Check the
ClawTalk plugin, runtime load state, account/channel readiness, and permitted
capabilities. Repair only safe local configuration. Do not call or text anyone.
Tell me the exact secure ClawTalk control where the account owner must attach or
verify the phone number, then return a no-contact test plan and Monitor evidence
to verify before any outbound action.
```

### Manual path

1. Get an authorized ClawTalk account and phone channel. Keep account details
   out of Help and Command Console.
2. Open **Plugins**, search **ClawTalk**, and use **Install** if needed.
3. Choose **Setup**, put the ClawTalk API key only in the masked **API key**
   field, and click **Save Setup**.
4. Click **Refresh** and, if necessary, **Manage → Inspect**. Look for
   **Plugin: enabled**, **Runtime: loaded**, **API key: stored**, and no
   restart requirement.
5. Select the intended agent in **Agents** and send a no-contact status check.
6. Attach/verify the phone number in the trusted ClawTalk account flow the
   integration identifies. Do not paste a phone number, SMS code, or API key
   into Help.
7. Test with a number you control and an explicit no-sensitive-content message.
   Check the tool result and **Monitor** before contacting anyone else.

## Template 4: Connect Telegram safely

### Agent-first prompt

```text
Prepare Telegram for this agent using the safest private-chat-first setup.
Inspect the Telegram plugin, runtime, pairing state, and current policy. Do not
send a message, approve a pairing, join a group, or expose a token. Give me the
exact BotFather and Automnia secure handoff steps, then verify only what the
runtime can verify after I save the token. Recommend an owner allowlist and a
group policy with requireMention enabled.
```

### Manual path

1. In Telegram, use the official **@BotFather** and `/newbot`. Keep the returned
   bot token private.
2. In Automnia, open **Plugins**, find **Telegram**, install/start if needed,
   then choose **Setup**.
3. Enter the token only in the secure setup field and click **Save Setup**.
4. Use **Refresh**, **Manage → Inspect**, and **Monitor** channel/lifecycle
   evidence. A saved form is not proof of delivery.
5. Start with a direct chat and time-limited pairing. Approve pairing only in
   the configured OpenClaw pairing path; never put a pairing code in Help.
6. For a group, use an explicit numeric sender allowlist, the negative group
   chat ID for the group, and **requireMention**. Review BotFather Privacy Mode
   and group permissions. Do not use public/open access for a powerful agent.
7. Test with `@your_bot_username ping`, then stop and review the evidence.

## Template 5: Give an agent new skills and powers

### Agent-first prompt

```text
Inventory the skills and plugins available to this agent for [OUTCOME]. Rank
the smallest trustworthy capability set, list each prerequisite and requested
permission, and identify whether the capability comes from a skill, plugin,
provider, binary, OAuth account, or policy setting. Do not install community
content, change policy, or contact an external service. Give me a recommended
installation/enablement plan, a read-only test prompt, and the manual controls.
```

### Manual path

1. Check **Plugins** for runtime code, channel, provider, browser, or service
   integrations. Review publisher, version, dependencies, permissions, and
   setup requirements before **Install**.
2. Check **Agents → card → Edit → Skills** for the reusable procedure. Search,
   inspect, and enable only the relevant installed skill.
3. For ClawHub results, review the publisher, source, version, changelog,
   security scan, binaries, environment variables, and requested services.
   Install only after review, then enable for the intended agent.
4. Adjust **Policy sandbox** only as far as the task requires. A skill cannot
   override a denied tool or create an account credential.
5. Test with a non-sensitive read-only prompt, then check **Monitor**.

Remember: a plugin adds runtime capability; a skill adds procedure; a provider
or OAuth flow adds account access; policy decides the allowed boundary. Those
are four separate checks.

## Template 6: Automate a recurring task

### Agent-first prompt

```text
Design a recurring workflow for [TASK] using the smallest safe cadence. First
run a one-time dry/read-only version and report the expected output, external
side effects, required approval, and recovery behavior. Then tell me whether
this belongs in a Mission Cron, agent Heartbeat scheduler, or Monitor cron
shift. Do not start the schedule until I approve the objective, agents,
cadence, duration, and outbound boundary.
```

### Manual path

1. Run the workflow once in **Agents → Command Console** and verify the output.
2. For structured repeatable multi-agent work, open **Missions** and add the
   right agents to the active party.
3. Choose a preset if useful, set **Mission title**, **Dispatch mode**, and
   **Mission type**, then write the objective.
4. In **Mission Cron**, set a number and **Seconds**, **Minutes**, or **Hours**,
   then click **Apply Cadence**. **Deploy & Run Now** starts the first cycle;
   cadence controls later cycles.
5. Choose **Timing**: Instant, Timed, Continuous, or Indefinite. Set duration
   for Timed. Review readiness, Complexity, Risk, and Active Loadout.
6. Click **Deploy & Run Now** only after setting the approval boundary. Use
   **Stop Mission** or **Steer Mission** when needed.
7. Use **Monitor** to inspect **Gateway**, **scheduler**, active cron jobs, and
   **Mission History**. Use an active cron job’s **Edit**, **Pause**, or **Pause
   all** deliberately.
8. Use **Heartbeat scheduler** for an agent’s recurring pulse, not as a
   substitute for a multi-agent mission. **Quick Set** changes cadence,
   idle timeout, Continuous, and Auto-Recovery together.

Start with a draft/report-only schedule. Keep approval before email, calls,
messages, publishing, order changes, discounts, or deletion.

## Template 7: Build an advanced multi-skill agent team

### Agent-first prompt

```text
Act as a systems designer. Turn [COMPLEX OUTCOME] into a small Automnia agent
team. Inspect the available templates, agents, skills, plugins, models,
workspaces, policies, and active party. Recommend a commander plus the fewest
specialists needed, with explicit ownership, handoff artifacts, evidence,
approval gates, and a stop condition. Do not create agents, install skills,
send external messages, or deploy a mission until I approve the design. Return
the exact Recruit, Agent Editor, Missions, and Monitor controls and the first
read-only test prompt.
```

### Manual path

1. Use **Recruit** to create focused agents such as Researcher, Builder,
   Reviewer, Publisher, or Commander. Give each a narrow identity and
   workspace.
2. In each editor, choose the model, enable only needed skills, and set
   **Policy sandbox** allow/deny tools.
3. Add agents to the active party only when they should participate. A
   selected agent and an active-party member are not the same thing.
4. Open **Missions**, choose Specialist, Sequential, Parallel, Swarm, or
   Hierarchical/Commander-style dispatch as appropriate.
5. Define acceptance criteria and proof. Keep the final publishing or outbound
   lane behind a human approval gate.
6. Review **Monitor** performance, logs, sessions, and the final report.

An advanced agent is not one with every permission. It is one with a clear
orchestration role, small specialist lanes, reliable handoffs, and evidence.

## Template 8: Research and manage YouTube content

### Agent-first prompt

```text
Build a public-source YouTube research and content workflow. Inspect whether
summarize, video-frames, browser-automation, Docs/Drive/Sheets via gog, and any
authorized browser/plugin route are ready. Research [CHANNEL OR TOPIC], return
links and evidence, identify audience/content gaps, and draft a content plan.
Do not log in, upload, publish, comment, change channel settings, or claim that
YouTube Studio actions succeeded. Recommend the next prompt and the manual
setup for any missing skill, Gog OAuth, Google Cloud project, or browser access.
```

### Manual path and Google Cloud/Gog boundary

1. In **Agents → Edit → Skills**, enable `summarize` for transcripts and
   public URLs; add `browser-automation` for careful research and
   `video-frames` when frame extraction is needed.
2. Use a narrow content workspace. Use **gog** only when saving research into
   Docs, Drive, or Sheets; its OAuth setup is described in the email template.
3. If using a Google Cloud project for Gog, enable only the APIs required by
   the chosen workspace, create a Desktop OAuth client, and keep client JSON
   local. `gcloud auth application-default login` is for Google Cloud/Vertex
   access; it is not a YouTube Studio login.
4. Test with public sources: compare the last 12 videos, extract topics/hooks,
   draft three concepts, and save a report locally or to a review document.
5. YouTube uploads, comments, publishing, and Studio changes need a separate
   authorized OAuth/API or browser workflow and final operator approval. There
   is no generic Automnia “publish to YouTube” control.

## Template 9: Use browser automation for web work

### Agent-first prompt

```text
Plan a browser workflow for [SITE AND OUTCOME]. Inspect browser-automation
readiness, available browser/plugin/session access, workspace, and policy. Start
with a public, read-only page and return the navigation plan, data to collect,
and verification evidence. Do not log in, bypass a challenge, submit forms,
purchase, publish, message, or change account settings. If an authorized
browser session or human confirmation is needed, tell me exactly where to do
that and pause before the side effect.
```

### Manual path

1. Enable `browser-automation` in **Agents → Edit → Skills** after reading its
   instructions and prerequisites.
2. If the workflow needs a browser plugin, configure it in **Plugins** and
   verify **Runtime: loaded** through **Inspect** and **Monitor**.
3. Set **Policy sandbox** to the narrowest workspace/tool boundary. Start with
   public pages and no outbound actions.
4. Use a dry run that records URLs, page titles, extracted fields, and
   timestamps. Validate the result before any form submission.
5. Treat login, CAPTCHA, 2FA, payment, publishing, account changes, and direct
   messages as human approval points. Never ask for passwords or cookies in
   Command Console.

## Template 10: Manage Instagram with an agent

Automnia does not document a generic Instagram plugin or an Instagram publish
button. A browser skill may be able to work with an already authorized browser
session when the current runtime and policy support it, but that is not a
promise of availability or of successful publishing.

### Agent-first prompt

```text
Create an Instagram content-operations plan for [ACCOUNT OR CAMPAIGN]. Inspect
available browser, media, design, and scheduling capabilities without asking
for my password or cookies. Draft a content calendar, captions, alt text,
hashtags, approval checklist, and a browser dry-run plan. Do not log in, post,
comment, follow, send DMs, change account settings, or bypass platform
controls. Clearly separate what Automnia can draft from what still requires an
authorized Instagram workflow and my final approval.
```

### Safe workflow

1. Enable only `browser-automation`, `summarize`, `video-frames`, or media
   skills that are actually installed and appropriate.
2. Give the agent a content workspace containing approved assets, not account
   passwords, cookies, or private exports.
3. Have it produce a calendar, captions, accessibility text, asset checklist,
   and compliance/approval list. Review before opening a browser session.
4. If a supported authorized browser session exists, start on a preview or
   navigation-only run. Pause before any post, comment, follow, DM, or profile
   change.
5. For recurring content, schedule the drafting mission, not automatic posting,
   until an explicit publishing integration and approval gate are verified.

## Template 11: Run Google Cloud and local CLI setup safely

### Agent-first prompt

```text
Audit the Google Cloud or local CLI prerequisite for [WORKFLOW]. Inspect only
safe metadata: gcloud availability, active project context, ADC/Vertex
readiness, Gog binary readiness, required APIs, and the agent’s policy. Do not
read, print, upload, or modify secret files; do not change IAM, billing,
firewalls, OAuth clients, or deployments. Return exact commands for me to run,
the smallest required roles/APIs, and the verification evidence to expect.
```

### Manual boundaries

- `gcloud auth application-default login` and `gcloud config set project` are
  local setup for Google Cloud/Vertex-style access.
- Gog OAuth is for Workspace data and uses its own client/scopes.
- Cloud Run deployment, IAM, billing, Secret Manager, and permanent-domain
  changes are operator-level actions. A local agent may plan and inspect them,
  but a human must review the project, secrets, traffic, and rollback plan.
- Never pass secret values on a command line or upload credentials to Help.
- Use **Monitor**, health checks, and a small read-only command to verify a
  completed setup. A green Gateway chip does not prove Google Cloud or Gog is
  authorized.

## Template 12: Turn a successful workflow into a reusable mission

### Agent-first prompt

```text
Convert the verified [WORKFLOW] into a reusable Automnia mission. Use the
existing agent test evidence to define inputs, outputs, acceptance criteria,
required skills/plugins, workspace, policy, cadence, timeout, approval gates,
and recovery behavior. Recommend whether to use one agent, a party, a Mission
Cron, or a heartbeat. Do not schedule it yet; return the exact Mission Setup
values and a rollback/stop plan for my approval.
```

### Manual path

Use **Missions** for repeatable objectives and **Agent Editor → Heartbeat
scheduler** for an agent pulse. Define a small objective, active-party loadout,
proof criteria, and cadence. Deploy one immediate cycle, inspect **Mission
History** and **Monitor**, and only then choose **Timed**, **Continuous**, or
**Indefinite** operation. Keep the action that sends, publishes, edits, or
deletes behind an approval step.

## A compact catalog of creative starting points

These are prompt seeds for Help or Command Console. Each is a draft/report-first
idea until the user explicitly authorizes an external side effect.

### Research and learning

1. Compare three competitors from public sites.
2. Build a source-backed market brief.
3. Turn a podcast into action items.
4. Summarize a long PDF and list unanswered questions.
5. Map a YouTube channel’s topic gaps.
6. Track a product release feed.
7. Make a travel research shortlist.
8. Compare software plans from official pages.
9. Build a glossary from a folder of documents.
10. Create a fact-check queue with source links.

### Writing and content

11. Turn notes into a newsletter outline.
12. Draft five hooks for one audience.
13. Convert a transcript into a blog brief.
14. Create a podcast episode rundown.
15. Draft a video description and chapters.
16. Create an Instagram calendar without posting.
17. Rewrite copy in three brand voices.
18. Generate an accessibility/alt-text pass.
19. Build a launch checklist.
20. Turn one idea into email, social, and blog variants.

### Google Workspace and personal operations

21. Summarize unread Gmail.
22. Prepare reply drafts only.
23. Find follow-ups by sender and date.
24. Make a weekly Calendar brief.
25. Turn email action items into a Docs checklist.
26. Create a Drive folder inventory.
27. Normalize a Sheet’s column names.
28. Compare two Docs and list changes.
29. Build a meeting-prep packet.
30. Draft a Friday status report.

### Browser and web operations

31. Collect public pricing into a review table.
32. Watch a set of public product pages.
33. Capture a competitor landing-page change log.
34. Test a public signup flow without submitting.
35. Gather FAQ questions from public support pages.
36. Build a public directory shortlist.
37. Extract event dates into a local report.
38. Check a documentation site for broken links.
39. Create a browser test plan for a new feature.
40. Re-run a read-only web research checklist.

### Messaging and channels

41. Prepare a Telegram owner-bot test.
42. Draft a ClawTalk call script without dialing.
43. Summarize channel messages for approval.
44. Create a support escalation brief.
45. Turn a chat transcript into a ticket draft.
46. Build an allowlist review checklist.
47. Prepare a daily channel digest.
48. Draft an outage notification without sending.
49. Test inbound routing with a `status` message.
50. Audit channel policy and mentions.

### Coding and files

51. Review a repository for risky changes.
52. Generate a test plan from a feature request.
53. Create a small migration checklist.
54. Summarize a codebase for a new teammate.
55. Find duplicate documentation.
56. Create a release-notes draft.
57. Compare two configuration files without secrets.
58. Build a local CSV cleanup plan.
59. Generate a diagram of a workflow.
60. Prepare a backup/restore verification checklist.

### Missions and team orchestration

61. Split research into source, synthesis, and review lanes.
62. Run a commander/reviewer content pipeline.
63. Create a weekly operations brief mission.
64. Run a nightly report-only workspace scan.
65. Create a release-readiness mission.
66. Build a customer-support triage party.
67. Schedule a low-stock report without order edits.
68. Create a monthly content-gap review.
69. Run a timed competitor watch.
70. Stop a mission and produce a partial-evidence report.

### Creative and media

71. Extract useful frames from a video.
72. Turn a talk into quote-card ideas.
73. Make a storyboard from a brief.
74. Create a thumbnail concept brief.
75. Transcribe a local recording.
76. Generate a voiceover draft for approval.
77. Turn a product page into demo-scene ideas.
78. Make a meme concept from a supplied template.
79. Create a shot list from a script.
80. Build a repurposing map for one asset.

### Monitoring and maintenance

81. Check Gateway health and summarize evidence.
82. Audit enabled skills for an agent.
83. Review plugin runtime load state.
84. Find a paused cron job.
85. Compare current and expected mission cadence.
86. Create a redacted diagnostic bundle.
87. Check a workspace for stale drafts.
88. Prepare a provider/model readiness report.
89. Audit active-party membership.
90. Create a recovery runbook for a workflow.

### Business and planning

91. Create a weekly sales research brief.
92. Draft a customer FAQ from approved sources.
93. Turn reviews into themes and opportunities.
94. Build a product launch timeline.
95. Prepare an investor-update outline.
96. Compare vendor proposals.
97. Create a service onboarding checklist.
98. Turn support tags into product insights.
99. Draft an internal training guide.
100. Build an approval matrix for an automation.

For every idea, ask the agent to state the required skill/plugin, model route,
workspace, policy, account/consent, safe test, evidence, and stop condition.
That turns an exciting idea into a controlled, verifiable Automnia workflow.

## Capability boundaries to keep visible

- Help can explain and prepare a prompt; it cannot see private machine state or
  claim that setup completed.
- A configured agent can inspect and complete authorized work, but cannot grant
  itself tools, invent credentials, approve consent, or bypass a policy.
- Public research is different from logging in, publishing, contacting people,
  or changing an account.
- Google Cloud `gcloud`, Gog OAuth, Automnia account sign-in, provider auth,
  and channel tokens are separate credential systems.
- Read-only, draft-only, and preview tests are the default. Add outbound or
  destructive permissions only after reviewing evidence and naming the human
  approval point.
