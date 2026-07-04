# Automnia AI User Guide

Last updated: 2026-07-04

Automnia AI is a local-first desktop command center for hyper customizable agents. Use it to build specialized OpenClaw-powered workers, assign models and tools, connect workspaces, launch missions, schedule recurring jobs, manage plugins, route compatible channels, and monitor everything from one cockpit.

This guide is the full operating manual. The README is the front door. This document covers setup, configuration, agent design, supported workflows, plugins, skills, missions, schedules, approvals, monitoring, recovery, troubleshooting, and advanced use cases.

## Table of Contents

- [1. Mental Model](#1-mental-model)
- [2. Quick Start](#2-quick-start)
- [3. Core Surfaces](#3-core-surfaces)
- [4. Agent Design](#4-agent-design)
- [5. Model And Provider Setup](#5-model-and-provider-setup)
- [6. Workspaces And File Boundaries](#6-workspaces-and-file-boundaries)
- [7. Command Console](#7-command-console)
- [8. Missions](#8-missions)
- [9. Scheduling And Cadence](#9-scheduling-and-cadence)
- [10. Monitor And Recovery](#10-monitor-and-recovery)
- [11. Plugins](#11-plugins)
- [12. Channels](#12-channels)
- [13. Skills, Doctrine, And Memory](#13-skills-doctrine-and-memory)
- [14. Approval Gates And Safety](#14-approval-gates-and-safety)
- [15. Advanced Workflow Library](#15-advanced-workflow-library)
- [16. Settings And Policy](#16-settings-and-policy)
- [17. Troubleshooting](#17-troubleshooting)
- [18. Glossary](#18-glossary)

---

## 1. Mental Model

Automnia AI turns agents into a local operations team.

```text
Operator
  -> Automnia AI desktop cockpit
  -> Agents, Missions, Monitor, Plugins, Settings
  -> OpenClaw Gateway and runtime services
  -> Models, files, browser tools, skills, channels, and external systems
  -> Approval loop back to the operator when decisions matter
```

Think in plain questions:

| Question | Automnia AI surface |
| --- | --- |
| Who should do this? | Agents and Active Party |
| What should they use? | Model lane, tools, plugins, skills, workspace |
| When should it happen? | Missions and schedules |
| What is happening right now? | Monitor |
| What needs my approval? | Approval gates and Command Console |
| What happened? | Mission reports, logs, ledgers, and final evidence |

Automnia AI is not just a prettier chat window. It is a local command layer for agent work.

---

## 2. Quick Start

### Run from source

Recommended runtime: Node.js 24.

```bash
git clone <this repository>
cd <this repository>
npm ci
npm run desktop
```

### First safe path

1. Open Automnia AI.
2. Connect one provider or model route.
3. Choose one existing agent or recruit one focused agent.
4. Give the agent a narrow workspace only if the task needs files.
5. Send a small Command Console test.
6. Open Monitor and confirm Gateway, session, logs, and result.
7. Launch a mission only after the direct path works.

Good first prompt:

```text
Review this folder at a high level. Tell me what you inspected, what looks risky, and one next step.
```

Avoid:

```text
Fix everything.
```

---

## 3. Core Surfaces

| Surface | Purpose |
| --- | --- |
| Recruit | Create a new agent profile and bootstrap doctrine. |
| Agents | Browse the roster, deploy the active party, edit agents, and run the Command Console. |
| Missions | Turn goals into structured work with agents, dispatch modes, cadence, risk, and proof. |
| Monitor | Inspect Gateway health, running calls, cron jobs, channel activity, logs, failures, and recovery controls. |
| Plugins | Configure providers, tools, channels, skills, browser flows, memory, and external services. |
| Settings | Tune runtime policy, UI density, motion, contrast, defaults, timeouts, and local preferences. |

Suggested screenshots in docs:

```text
docs/assets/readme/automnia-ui-agents.png
docs/assets/readme/automnia-ui-missions.png
docs/assets/readme/automnia-ui-monitor.png
docs/assets/readme/automnia-ui-plugins.png
```

---

## 4. Agent Design

Agents are configurable workers. They should have clear lanes.

### Agent fields to think about

| Area | What to configure |
| --- | --- |
| Identity | Name, portrait, class, role, tags, tone, description |
| Model lane | Primary model, fallback models, provider setup, thinking level, timeout |
| Workspace | Folder scope, repo, docs folder, content folder, support export, or no file access |
| Doctrine | Operating style, rules, tool policy, memory, mission instructions |
| Skills | Repeatable procedures, project playbooks, plugin-provided capabilities |
| Policy | Sandbox behavior, allowed tools, denied tools, approval rules |
| Schedule | Cadence defaults, watch mode, loop mode, recovery behavior |

### Agent ideas that make the product click

| Agent | What it can do |
| --- | --- |
| Customer Service Agent | Review emails, prepare replies, organize customer context, answer common inquiries, route unresolved questions, and draft text/channel replies for approval. |
| Shopify Store Operator | Use Shopify CLI or compatible store tools to inspect inventory, orders, product data, website content, SEO tasks, and promotional codes. |
| Store Command Center | Combine inventory checks, order review, customer inquiry drafts, promotion planning, and store intelligence on a cadence. |
| Promotional Agent | Prepare campaign copy, mailers, launch posts, discount campaigns, follow-up drafts, and scheduled promotional plans. |
| Content Producer | Plan scripts, hooks, titles, descriptions, thumbnails, launch posts, and supported media generation workflows using configured Gemini, image/video, or other supported models and tools. |
| Code Crew | Split work across architect, builder, reviewer, tester, and release-check agents. |
| Research Desk | Compare sources, separate facts from assumptions, and return a decision-ready brief. |
| Watcher | Monitor prices, products, release notes, inventory, jobs, alerts, competitor changes, or system signals. |
| Personal Chief of Staff | Prepare weekly plans, reminders, errands, notes, email drafts, and summaries for review. |
| Commander | Delegate work to specialist agents and return one final report. |

---

## 5. Model And Provider Setup

Automnia AI can use the model/provider routes configured through OpenClaw and the app provider surfaces.

Common model lanes include:

- OpenAI-compatible API providers.
- Anthropic-style message providers.
- Google Gemini or Vertex-style providers.
- Local or self-hosted model routes when configured through compatible tooling.
- API-key-backed provider flows where supported.
- OAuth or subscription-backed provider flows where supported.
- Media-capable model/tool routes when configured, including supported Gemini, image, video, audio, or multimodal generation tools.

### Recommended provider setup pattern

1. Start with one dependable primary model.
2. Add one fallback.
3. Set timeout and thinking level.
4. Send one small direct Command Console test.
5. Check Monitor for the route used.
6. Only then use the agent in missions, channels, or schedules.

### When a model fails

Check:

- Provider setup is complete.
- Quota or subscription access is still valid.
- The selected agent is using the intended model lane.
- The channel/plugin is not pointing at a different agent or stale route.
- Gateway is healthy.
- The prompt is not requesting a denied tool.

---

## 6. Workspaces And File Boundaries

Workspaces keep work scoped.

Good workspace examples:

- Code repo.
- Docs folder.
- Content library.
- Support export folder.
- Storefront theme or product export folder.
- Safe scratch folder.

Use narrow workspaces. Do not give every agent broad file access by default.

---

## 7. Command Console

Use Command Console for:

- Small direct tests.
- One-agent commands.
- Party commands.
- File inspection.
- Code review.
- Provider setup validation.
- Attachment-backed context.
- Stopping or steering work when supported.

Good prompt shape:

```text
Inspect these files. Report bugs first, list files inspected, then tell me the safest next step.
```

---

## 8. Missions

Missions are for structured work.

Use missions when you need:

- Multiple agents.
- Repeatability.
- Timing or cadence.
- Acceptance criteria.
- Verification commands.
- A final report.
- Recovery evidence.

### Mission flow

1. Confirm an active party.
2. Choose preset.
3. Pick dispatch mode.
4. Pick mission type.
5. Write objective.
6. Set cadence, complexity, risk, readiness.
7. Add proof criteria.
8. Deploy.
9. Watch in Missions and Monitor.
10. Read final report.

### Useful mission presets

| Preset | Use it for |
| --- | --- |
| Code Sweep | Code review, cleanup, regression checks, targeted repair |
| Mission Plan | Scoping, ownership, milestones, risks |
| Research Map | Evidence gathering, comparisons, unknowns |
| Launch Push | Implementation, polish, verification, publication support |
| Command Ops | Delegation, synthesis, blocker resolution |

---

## 9. Scheduling And Cadence

Use cadence when work should repeat or stay active.

| Cadence | Workflow |
| --- | --- |
| Every morning | Summarize overnight alerts, messages, orders, or repo changes |
| Every Friday | Prepare plans, shopping lists, store promotions, or weekly reports |
| Hourly | Watch inventory, product pages, support queues, or system status |
| Watch style | Run when configured signals change |
| Loop until stopped | Keep a monitor active while the operator is away |

Example store workflow:

```text
Every 2 hours, check inventory and new orders.
Flag low stock, delayed orders, and promotion opportunities.
Draft customer replies where needed.
Send summary through the configured channel.
Wait for approval before changing discounts, orders, or outbound messages.
```

---

## 10. Monitor And Recovery

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
5. Stop Gateway only when plugin/channel state needs a hard reset.
6. Reopen the app if runtime cannot recover.
7. Retry a tiny direct prompt before relaunching big work.

---

## 11. Plugins

Plugins extend what agents can do.

| Plugin type | Enables |
| --- | --- |
| Provider plugins | Model access and routing |
| Browser plugins | Page inspection and web workflows |
| Memory plugins | Durable context and continuity |
| Skill plugins | Procedures and specialized playbooks |
| Channel plugins | Chat, SMS-style flows, team tools, webhooks, future channels |
| Media tools | Supported image, video, audio, or multimodal generation flows |
| Service plugins | Store systems, support tooling, internal APIs, publishing tools, automation CLIs |

### Plugin setup pattern

1. Open Plugins.
2. Search for the plugin.
3. Read status chips.
4. Complete required setup fields.
5. Save configuration.
6. Refresh plugins.
7. Restart Gateway if required.
8. Confirm runtime state in Monitor.
9. Test with a small command.

---

## 12. Channels

Channels let agents operate outside the desktop when compatible plugins are configured.

Command examples:

```text
status
@support summarize urgent customer messages
@store check orders and low inventory
@promo draft tomorrow's campaign plan
@stop stop active runs and return current evidence
```

Best practices:

- Use unique agent aliases.
- Test with `status`.
- Watch Monitor for inbound/outbound events.
- Keep approval gates on for important actions.
- Use short channel commands.

---

## 13. Skills, Doctrine, And Memory

Doctrine tells an agent how to behave.

Use doctrine for:

- Identity.
- Tone.
- Rules.
- Tool policy.
- Mission playbooks.
- Memory notes.
- Verification standards.

Skills are reusable workflows.

Examples:

- Release review checklist.
- Shopify inventory check.
- Customer reply format.
- Promotional campaign routine.
- Research comparison method.
- Content launch checklist.
- Media prompt style guide.
- Support escalation policy.

---

## 14. Approval Gates And Safety

Approval gates keep the operator in the loop.

Use approvals before:

- Sending customer messages.
- Sending campaigns.
- Changing discounts.
- Changing orders.
- Publishing content.
- Modifying important files.
- Pushing code.
- Running risky external actions.

The goal is not to block automation. The goal is to let agents prepare work and let humans approve high-impact steps.

---

## 15. Advanced Workflow Library

### Customer service agent

- Reviews inbox or channel exports.
- Groups inquiries by urgency.
- Drafts replies.
- Flags refund, order, escalation, or support-risk cases.
- Waits for approval before outbound replies.

### Shopify store operator

- Uses Shopify CLI or compatible store tooling.
- Checks inventory, products, orders, discounts, and SEO data.
- Drafts changes for approval.
- Reports store health on a cadence.

### Store command center

- Combines customer support, inventory, orders, promotion planning, and store intelligence.
- Runs on schedule.
- Summarizes what changed.
- Drafts next actions.
- Waits for approval before acting externally.

### Promotional agent

- Drafts campaign plans.
- Builds mailer copy.
- Prepares launch posts.
- Schedules recurring promotion drafts.
- Reports performance signals when connected tools provide them.

### Content studio

- Plans scripts, hooks, titles, descriptions, thumbnails, and launch posts.
- Prepares creative media workflows when supported Gemini, image/video, or other compatible model/tool routes are configured.
- Adapts content into platform-specific formats.
- Keeps approvals on before publishing.

### Code release crew

- Architect plans.
- Builder edits.
- Reviewer checks.
- Tester verifies.
- Commander summarizes.

---

## 16. Settings And Policy

Use Settings to tune:

- Runtime defaults.
- Mission defaults.
- Thinking mode.
- Timeout behavior.
- UI density.
- Reduced motion.
- High contrast or reduced glow.
- Local preference reset.
- Agent/runtime policy defaults.

For agent-level policy, check:

- Allowed tools.
- Denied tools.
- Sandbox behavior.
- Workspace scope.
- Approval requirements.
- Schedule defaults.

---

## 17. Troubleshooting

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

## 18. Glossary

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
