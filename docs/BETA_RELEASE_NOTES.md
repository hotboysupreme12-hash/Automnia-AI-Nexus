# Automnia AI Public Beta Release Notes

Status: draft release note for the next public beta candidate.

Automnia AI is a local-first desktop command center for OpenClaw agents, missions, schedules, plugins, provider setup, and live runtime monitoring.

## Beta Boundary

- Primary packaged beta target: Windows 11 x64.
- Windows 10 22H2 x64 is best effort.
- macOS and Linux source validation are developer paths.
- Public beta publication waits for hosted CI, packaged launch smoke, screenshot evidence, and release validation.

## Before You Install

- Back up important local Automnia AI and OpenClaw state before testing an upgrade.
- Use test accounts where possible.
- Keep local control surfaces on loopback addresses.
- Do not use this beta for unattended business-critical automation.

## Known Limitations

- Gateway, plugin, and channel status can require a manual Gateway reset or app restart after provider setup changes, plugin setup changes, interrupted runs, or local port conflicts.
- Provider sessions, quotas, and channel setup values expire under the provider's own rules.
- Clean Slate clears stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks. It does not delete saved agents, durable configuration, or OpenClaw state.
- Full local state reset is manual during beta.

## Recovery Path

1. Open Monitor and wait for health polling.
2. Check active calls, cron jobs, channel activity, sessions, and recent logs.
3. If work is active, stop it or let it finish before resetting Gateway.
4. Use Clean Slate for stale monitor or runtime projection state.
5. Use Reset gateway when Gateway is unhealthy or disconnected.
6. Use Stop gateway, close Automnia AI, and reopen it if plugin or channel state remains stale.
7. Reconnect expired provider or plugin access.
8. Send a small direct Command Console prompt before retrying a mission or channel workflow.

## Release Qualification Checklist

Before publishing a build with these notes:

- Hosted Control Plane CI passed on the exact release commit.
- A CI evidence document links the green run, commit SHA, and artifact names.
- Packaged desktop launch smoke passed against the packaged app.
- Packaged beta screenshots were captured for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor.
- Release evidence and validation completed in the intended beta mode.
