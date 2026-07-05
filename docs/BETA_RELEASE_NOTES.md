# Automnia AI Release Notes

Last updated: 2026-07-05

Automnia AI is a local-first desktop command center for OpenClaw agents, missions, schedules, plugins, provider setup, compatible channels, and live runtime monitoring.

## Platform status

Automnia AI is stable for Windows, macOS, and Linux.

## What this release emphasizes

- Configurable agents with roles, model lanes, workspaces, doctrine, skills, and schedules.
- Missions for structured goals, recurring work, proof, and recovery.
- Monitor views for Gateway health, sessions, logs, cron jobs, plugin activity, and recovery actions.
- Plugin and channel support for model routes, browser workflows, skills, compatible communication channels, and service integrations.
- Review gates for important actions.
- Hosted CI evidence, packaged launch validation, screenshot capture, and release evidence for reviewed builds.

## Before you install

- Back up important local Automnia AI and OpenClaw state before testing an upgrade.
- Use test accounts when exploring new providers, plugins, or channels.
- Keep local control surfaces on loopback addresses.
- Review provider, plugin, channel, and workspace permissions before connecting them.

## Recovery path

1. Open Monitor and wait for health polling.
2. Check active calls, cron jobs, channel activity, sessions, and recent logs.
3. If work is active, stop it or let it finish before resetting Gateway.
4. Use Clean Slate for stale monitor or runtime projection state.
5. Use Reset Gateway when Gateway is unhealthy or disconnected.
6. Use Stop Gateway, close Automnia AI, and reopen it if plugin or channel state remains stale.
7. Reconnect expired provider or plugin access.
8. Send a small direct Command Console prompt before retrying a mission or channel workflow.

## Feedback

When reporting feedback, include the app version or commit, build target, operating system, install type, steps, expected behavior, actual behavior, Gateway state, and a redacted log excerpt when useful.

Use the feedback template:

```text
https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/issues/new?template=beta_feedback.yml
```
