# Automnia AI Support Guide

Last updated: 2026-09-26

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
3. If a run's status is unclear, check its session, mission history, and report before retrying. This helps avoid repeating work that may already have completed.
4. Let active work finish where possible. Resetting Gateway interrupts runtime work.
5. Use `Clean Slate` only for stale Monitor or runtime projection state; it does not restore a lost response or credential.
6. Use `Reset Gateway` when Gateway is unhealthy or disconnected. Wait for health to return before retrying.
7. If the desktop view reports a connection problem, keep Automnia open while it retries. If the app itself closed, reopen one instance and check Monitor before resubmitting work.
8. Reconnect expired provider or plugin access, then send a small direct Command Console prompt before retrying a mission or channel workflow.

### Gateway startup migrations

On a new Automnia setup or after an OpenClaw upgrade, startup migrations can take several minutes. During this work, the top-right Gateway chip changes to `MIGRATING` and stays visible while the Gateway retries. The Gateway may reset several times; leave Automnia open and wait for the chip to return to `ON` before retrying work.

## Reset local state

Start with the least destructive option:

1. Open Monitor.
2. Use `Clean Slate` for stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks.
3. Use `Reset Gateway` if Gateway itself is unhealthy.
4. Restart Automnia AI.

Do not rename or delete Automnia or OpenClaw state folders as a routine recovery step. **Settings → Backup & Reset → Download backup** contains preferences and the current mission draft only. It does not back up agents, saved responses, workspace files, or OpenClaw runtime history.

For an OpenClaw state backup from a source checkout, close Automnia AI first. The backup copies the configured OpenClaw state directory (by default `~/.openclaw`) to `~/Automnia Backups` and verifies copied files with checksums. Set `OPENCLAW_STATE_DIR` or `OPENCLAW_HOME` if the app uses a different state directory. Workspace files stored elsewhere and Automnia UI preferences are not included.

```bash
npm run state:backup
npm run state:verify -- "<backup-folder>"
```

Restore only to a deliberate target while the app is closed. The restore command requires an explicit destination; verify the backup first.

```bash
npm run state:restore -- "<backup-folder>" "<target-state-folder>"
```

If you need a full reset or cannot confirm which state directory contains the work, keep the folders in place and contact support before changing local state.

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
