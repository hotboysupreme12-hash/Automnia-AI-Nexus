# Automnia AI User Guide

Last updated: 2026-07-05

Automnia AI is a local-first desktop cockpit for configurable agents. It helps you create agents, give them roles and workspaces, connect model/provider routes, launch missions, schedule recurring work, manage plugins, route compatible channels, and monitor runtime evidence from one place.

Use this guide as the public operating manual. It focuses on what a tester or operator needs to understand, not internal build plans.

## Table of contents

- [1. Mental model](#1-mental-model)
- [2. Quick start](#2-quick-start)
- [3. Main surfaces](#3-main-surfaces)
- [4. Agent design](#4-agent-design)
- [5. Model and provider setup](#5-model-and-provider-setup)
- [6. Workspaces and file boundaries](#6-workspaces-and-file-boundaries)
- [7. Missions](#7-missions)
- [8. Scheduling](#8-scheduling)
- [9. Monitor and recovery](#9-monitor-and-recovery)
- [10. Plugins and channels](#10-plugins-and-channels)
- [11. Doctrine, skills, and memory](#11-doctrine-skills-and-memory)
- [12. Approval gates](#12-approval-gates)
- [13. Useful workflows](#13-useful-workflows)
- [14. Feedback and beta reports](#14-feedback-and-beta-reports)
- [15. Troubleshooting](#15-troubleshooting)
- [16. Glossary](#16-glossary)

---

## 1. Mental model

Automnia AI turns agent work into a visible local operating system.

```text
Operator
  -> Automnia AI desktop cockpit
  -> Agents, Missions, Monitor, Plugins, Settings
  -> OpenClaw Gateway and runtime services
  -> Models, files, browser tools, skills, channels, and configured external systems
  -> Approval loop when important actions need review
```

Think in five questions:

| Question | Where to look |
| --- | --- |
| Who should do this? | Agents |
| What should the agent use? | Model lane, tools, plugins, skills, workspace |
| When should it happen? | Missions and schedules |
| What is happening right now? | Monitor |
| What needs my approval? | Approval gates and Command Console |

You can run one broad operator agent, a specialist for every task, or a mix of both.

---

## 2. Quick start

Recommended runtime for source runs: Node.js 24, or Node.js 22.19+ for compatibility.

```bash
git clone <this repository>
cd <this repository>
npm ci
npm run desktop
```

First safe path:

1. Open Automnia AI.
2. Connect one provider or model route.
3. Choose or create one focused agent.
4. Give the agent a narrow workspace only if the task needs files.
5. Send a small Command Console test.
6. Open Monitor and confirm Gateway, session, logs, and result.
7. Launch a mission only after the direct path works.

Good first prompt:

```text
Review this folder at a high level. Tell me what you inspected, what looks risky, and one safe next step.
```

Avoid broad first prompts like:

```text
Fix everything.
```

---

## 3. Main surfaces

| Surface | Purpose |
| --- | --- |
| **Agents** | Create, browse, edit, deploy, and direct agents. |
| **Missions** | Turn goals into structured work with timing, roles, risk, and proof. |
| **Monitor** | Inspect Gateway health, sessions, runs, cron jobs, channel activity, logs, failures, and recovery controls. |
| **Plugins** | Configure provider routes, tools, channels, skills, memory, browser flows, and external services. |
| **Settings** | Tune runtime policy, UI density, motion, contrast, defaults, timeouts, and local preferences. |

---

## 4. Agent design

Agents work best when they have clear lanes.

| Area | What to configure |
| --- | --- |
| **Identity** | Name, portrait, class, role, tags, tone, description. |
| **Model lane** | Primary model, fallback models, provider setup, thinking level, timeout. |
| **Workspace** | Repo, docs folder, content folder, support export, store data, or no file access. |
| **Doctrine** | Operating style, rules, tool policy, memory, and mission instructions. |
| **Skills** | Reusable procedures, project playbooks, plugin-provided capabilities. |
| **Policy** | Sandbox behavior, allowed tools, denied tools, approval rules. |
| **Schedule** | Cadence defaults, watch mode, loop mode, recovery behavior. |

Useful agent patterns:

| Agent | Good for |
| --- | --- |
| Customer Service Agent | Review messages, prepare replies, group issues, and flag escalations. |
| Store Operator | Inspect inventory, orders, products, content, SEO tasks, and promotion ideas. |
| Content Producer | Plan scripts, hooks, titles, descriptions, launch posts, and media workflows. |
| Code Crew | Split work across architect, builder, reviewer, tester, and release-check agents. |
| Research Desk | Compare sources and return a decision-ready brief. |
| Watcher | Monitor products, prices, releases, jobs, alerts, competitor changes, or system signals. |
| Personal Operator | Prepare reminders, summaries, plans, drafts, errands, and routine check-ins. |
| Commander | Delegate work to specialists and return one final report. |

---

## 5. Model and provider setup

Automnia AI can use the model/provider routes configured through OpenClaw and the app provider surfaces.

Common model lanes include:

- OpenAI-compatible API providers.
- Anthropic-style message providers.
- Google Gemini or Vertex-style providers.
- Local or self-hosted model routes when configured through compatible tooling.
- API-key-backed provider flows where supported.
- OAuth or subscription-backed provider flows where supported.
- Media-capable model/tool routes when configured.

Recommended setup pattern:

1. Start with one dependable primary model.
2. Add one fallback.
3. Set timeout and thinking level.
4. Send one small direct Command Console test.
5. Check Monitor for the route used.
6. Use the agent in missions, channels, or schedules after the direct path works.

### Google Vertex AI: one-time local sign-in

Vertex models use Google Application Default Credentials (ADC). You do **not** need a Google OAuth client secret or a Vertex API key in Automnia AI.

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID
```

Then choose any `google-vertex/...` model. The app reads the ADC project and refreshes its access token automatically. Your Google Cloud project still needs billing enabled and the signed-in identity needs the Vertex AI User role.

---

## 6. Workspaces and file boundaries

Workspaces keep agent work scoped.

Good workspace examples:

- Code repo.
- Docs folder.
- Content library.
- Support export folder.
- Storefront theme or product export folder.
- Safe scratch folder.

Use narrow workspaces. Do not give every agent broad file access by default.

---

## 7. Missions

Missions are for structured work.

Use missions when you need:

- Multiple agents.
- Repeatability.
- Timing or cadence.
- Acceptance criteria.
- Verification commands.
- A final report.
- Recovery evidence.

Basic mission flow:

1. Confirm the active agents.
2. Choose the mission preset or type.
3. Write a clear objective.
4. Set cadence, complexity, risk, and readiness.
5. Add proof criteria.
6. Deploy.
7. Watch Missions and Monitor.
8. Read the final report.

Useful mission presets:

| Preset | Use it for |
| --- | --- |
| Code Sweep | Code review, cleanup, regression checks, targeted repair. |
| Mission Plan | Scoping, ownership, milestones, risks. |
| Research Map | Evidence gathering, comparisons, unknowns. |
| Launch Push | Implementation, polish, verification, publication support. |
| Command Ops | Delegation, synthesis, blocker resolution. |

---

## 8. Scheduling

Use schedules when work should repeat or stay active.

| Cadence | Workflow |
| --- | --- |
| Every morning | Summarize overnight alerts, messages, orders, or repo changes. |
| Every Friday | Prepare plans, shopping lists, store promotions, or weekly reports. |
| Hourly | Watch inventory, product pages, support queues, or system status. |
| Watch style | Run when configured signals change. |
| Loop until stopped | Keep a monitor active while the operator is away. |

Example workflow:

```text
Every 2 hours, check inventory and new orders.
Flag low stock, delayed orders, and promotion opportunities.
Draft customer replies where needed.
Send a summary through the configured channel.
Wait for approval before changing discounts, orders, or outbound messages.
```

---

## 9. Monitor and recovery

Monitor is the truth window.

Use it to inspect:

- Gateway health.
- Running calls.
- Active sessions.
- Cron jobs.
- Plugin events.
- Channel traffic.
- Logs.
- Failures.
- Recovery actions.

Recovery order:

1. Wait for health polling.
2. Check active work.
3. Use Clean Slate for stale UI/runtime projection.
4. Use Reset Gateway when Gateway is unhealthy.
5. Stop Gateway only when plugin or channel state needs a hard reset.
6. Reopen the app if runtime cannot recover.
7. Retry a tiny direct prompt before relaunching big work.

---

## 10. Plugins and channels

Plugins extend what agents can do.

| Plugin type | Enables |
| --- | --- |
| Provider plugins | Model access and routing. |
| Browser plugins | Page inspection and web workflows. |
| Memory plugins | Durable context and continuity. |
| Skill plugins | Procedures and specialized playbooks. |
| Channel plugins | Chat, SMS-style flows, team tools, webhooks, and compatible future channels. |
| Media tools | Supported image, video, audio, or multimodal generation flows. |
| Service plugins | Store systems, support tooling, internal APIs, publishing tools, automation CLIs. |

Channel commands should stay short and easy to audit:

```text
status
@support summarize urgent customer messages
@store check orders and low inventory
@promo draft tomorrow's campaign plan
@stop stop active runs and return current evidence
```

Best practices:

- Use unique agent aliases.
- Test with `status` first.
- Watch Monitor for inbound and outbound events.
- Keep approval gates on for important actions.

---

## 11. Doctrine, skills, and memory

Doctrine tells an agent how to behave.

Use doctrine for:

- Identity.
- Tone.
- Rules.
- Tool policy.
- Mission playbooks.
- Memory notes.
- Verification standards.

Skills are reusable workflows, such as:

- Release review checklist.
- Store inventory check.
- Customer reply format.
- Promotional campaign routine.
- Research comparison method.
- Content launch checklist.
- Media prompt style guide.
- Support escalation policy.

---

## 12. Approval gates

Approval gates keep the operator in the loop before high-impact actions.

Use approvals before:

- Sending customer messages.
- Sending campaigns.
- Changing discounts.
- Changing orders.
- Publishing content.
- Modifying important files.
- Pushing code.
- Running risky external actions.

The goal is not to slow the app down. The goal is to let agents prepare useful work and let people approve consequential steps.

---

## 13. Useful workflows

### Customer service desk

- Reviews inbox or channel exports.
- Groups inquiries by urgency.
- Drafts replies.
- Flags refund, order, escalation, or support-risk cases.
- Waits for approval before outbound replies.

### Store command center

- Checks inventory, products, orders, discounts, and SEO data.
- Combines customer support, promotion planning, and store intelligence.
- Reports what changed on a cadence.
- Drafts next actions for approval.

### Content studio

- Plans scripts, hooks, titles, descriptions, thumbnails, and launch posts.
- Prepares creative media workflows when compatible tools are configured.
- Adapts content into platform-specific formats.
- Keeps approvals on before publishing.

### Code release crew

- Architect plans.
- Builder edits.
- Reviewer checks.
- Tester verifies.
- Commander summarizes.

---

## 14. Feedback and beta reports

Use the GitHub beta feedback template when something is confusing, broken, slow, or hard to recover from:

```text
https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/issues/new?template=beta_feedback.yml
```

Include the build target you tested:

- Windows desktop build.
- Windows source run.
- Linux desktop build.
- Linux source run.
- macOS desktop build.
- macOS source run.
- Server/headless source run.
- Other.

Useful report shape:

```text
Version or commit:
Build target:
Operating system:
Install type:
What I did:
What I expected:
What happened:
Gateway state from Monitor:
Provider/plugin/channel involved:
Safe log excerpt:
```

Before sharing logs, remove API keys, OAuth tokens, bearer tokens, cookies, passwords, private prompts, personal messages, and sensitive file paths.

---

## 15. Troubleshooting

### Agent does not respond

Check model setup, provider availability, agent selection, active runs, denied tools, and Gateway health.

### Mission will not deploy

Check deployed agents, confirmed party, title, objective, model setup, and whether selected agents are already busy.

### Channel message does not arrive

Check channel plugin setup, Gateway health, Channel Activity, and target agent alias.

### Plugin needs setup

Open Plugins, complete setup, save, refresh, and confirm runtime state in Monitor.

### Attachments do not work

Check file size, file type, workspace access, and agent policy. Attachment-heavy prompts may need runtime-backed execution.

### Runtime looks stale

Use Monitor, inspect logs, use Clean Slate, then Reset Gateway only if needed.

---

## 16. Glossary

| Term | Meaning |
| --- | --- |
| Agent | A configured OpenClaw worker with identity, model, workspace, policy, memory, and tools. |
| Active Party | Agents currently deployed for party chat or mission work. |
| Command Console | Live operator chat surface for direct agent or party work. |
| Mission | A structured objective with dispatch mode, timing, proof, and agent assignment. |
| Gateway | The OpenClaw background process that runs chat, sessions, plugins, channels, and runtime work. |
| Plugin | Runtime extension for providers, tools, channels, memory, browser automation, skills, or services. |
| Channel | Communication path through a compatible plugin or Gateway surface. |
| Approval gate | Human review point before an important action executes. |
| Cron mission | Scheduled work that runs on a cadence. |
| Clean Slate | Recovery action for stale UI/runtime state that preserves healthy active work where possible. |
