# Automnia AI Support Guide

Last updated: 2026-07-05

Automnia AI is stable for Windows, macOS, and Linux. This guide covers recovery, feedback, local state, and safe operation for the desktop app, agent runtime, missions, schedules, plugins, compatible channels, and local-first data boundaries.

## Supported paths

| Build target | Status |
| --- | --- |
| Windows desktop build | Stable supported path. |
| macOS desktop build | Stable supported path. |
| Linux desktop build | Stable supported path. |
| Windows source run | Supported for development and validation. |
| macOS source run | Supported for development and validation. |
| Linux source run | Supported for development and validation. |
| Server/headless source run | Advanced validation path for runtime or API testing. |

Recommended local tooling for source runs:

- Node.js `24`, or Node.js `22.19+` for compatibility.
- npm.
- Git.
- Model provider access for the providers you choose to use.

## Before you connect tools

- Back up important Automnia AI and OpenClaw state before major upgrades.
- Use test accounts when exploring new providers, plugins, or channels.
- Keep local control surfaces on loopback addresses.
- Review provider, plugin, and channel permissions before connecting them.
- Keep review gates on for customer messages, publishing, code pushes, file edits, and other important actions.

## Recover Gateway

1. Open Monitor and wait for health polling.
2. Check active calls, cron jobs, channel activity, sessions, and recent logs.
3. If work is active, stop it or let it finish before resetting Gateway.
4. Use `Clean Slate` for stale monitor or runtime projection state.
5. Use `Reset Gateway` when Gateway is unhealthy or disconnected.
6. Use `Stop Gateway`, close Automnia AI, and reopen it if plugin or channel state remains stale.
7. Reconnect expired provider or plugin access.
8. Send a small direct Command Console prompt before retrying a mission or channel workflow.

### Gateway startup migrations

On a new Automnia setup or after an OpenClaw upgrade, startup migrations can take several minutes. During this work, the top-right Gateway chip changes to `MIGRATING` and stays visible while the Gateway retries. The Gateway may reset several times; leave Automnia open and wait for the chip to return to `ON` before retrying work.

## Reset local state

Start with the least destructive option:

1. Open Monitor.
2. Use `Clean Slate` for stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks.
3. Use `Reset Gateway` if Gateway itself is unhealthy.
4. Restart Automnia AI.

For a full reset, close Automnia AI, create a backup if running from source with `npm run state:backup`, rename local app and OpenClaw state folders, then reopen the app and reconnect providers or plugins.

## Send safe logs

Share the smallest useful excerpt. Prefer Monitor log excerpts over whole state directories.

Include app version or commit, build target, operating system and architecture, install type, Gateway state, provider/plugin/channel involved, reproduction steps, and whether recovery actions helped.

## Local-first notes

By default, Automnia AI keeps app state on the operator machine and OpenClaw runtime state under `~/.openclaw`. Agent workspaces stay in folders chosen by the operator. External providers, plugins, channels, browser tools, and feedback reports can cross the local boundary when configured by the operator.

## Keep the local API local

Keep the Automnia AI local API and OpenClaw Gateway on loopback. Use supported channel plugins for remote operation.

## Feedback

Use the GitHub feedback template:

```text
https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/issues/new?template=beta_feedback.yml
```

For security reports, follow `SECURITY.md`.
