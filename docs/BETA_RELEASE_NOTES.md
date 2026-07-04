# DystopAI Public Beta Release Notes

Status: draft release note for the next public beta candidate.

These notes are the operator-facing release note for the next qualified beta build. They describe the current beta boundary, known limitations, installer caveats, and recovery path. Do not publish this note as a completed release announcement until `docs/CI_EVIDENCE.md` points at a green hosted Control Plane CI run for the exact release commit and the packaged release evidence has been validated.

## What This Beta Is For

DystopAI is a local-first desktop command center for OpenClaw agents, missions, schedules, plugins, provider authentication, and live runtime monitoring. This beta is intended for technical operators who are comfortable validating local agent workflows, reading runtime evidence, and recovering a local Gateway when provider or plugin state changes.

The primary packaged beta target is Windows 11 x64. Windows 10 22H2 x64 is best effort. macOS and Linux source validation may be useful for developers, but packaged public beta qualification should follow the release evidence for a specific build.

## Before You Install

- Back up important local OpenClaw and DystopAI state before testing an upgrade.
- Keep model provider keys, OAuth sessions, plugin credentials, signing keys, release evidence, and workspace files out of version control.
- Use test credentials when possible.
- Keep the Control Plane API and OpenClaw Gateway on loopback addresses.
- Do not use this beta for unattended business-critical automation.

Default local state locations:

```text
%USERPROFILE%\.dystopai-control-center
%USERPROFILE%\.openclaw
```

## Installer Caveats

- Beta builds may be unsigned or may not yet carry the final public distribution-signing evidence.
- Windows may show SmartScreen, publisher, or installer trust warnings for beta candidates that are not public-release signed.
- A beta installer should be trusted only when its commit SHA, hosted workflow run, release evidence artifact, and packaged screenshot artifact match the release handoff.
- Public release signing, automatic update, paid distribution, cloud accounts, and LAN-hosted Control Plane operation are outside this beta milestone.

## Known Limitations

- Gateway, plugin, and channel status can require a manual Gateway reset or app restart after provider auth changes, plugin setup changes, interrupted runs, or local port conflicts.
- Provider OAuth sessions, API keys, quotas, and channel credentials expire under the provider's own rules.
- Clean Slate clears stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks; it does not delete saved agents, provider credentials, durable configuration, or OpenClaw state.
- Full local state reset is manual during beta.
- State backups record skipped symlink entries; plugin-skill links may need to be refreshed or reinstalled after restore.
- The local API and Gateway are not designed for hostile multi-user or public-network exposure.

## Recovery Path

Use the least destructive recovery step that matches the failure:

1. Open Monitor and wait for health polling.
2. Check active calls, cron jobs, channel activity, sessions, and recent logs.
3. If work is active, stop it or let it finish before resetting Gateway.
4. Use Clean Slate for stale monitor/runtime projection state.
5. Use Reset gateway when Gateway is unhealthy or disconnected.
6. Use Stop gateway, close DystopAI, and reopen it if plugin or channel state remains stale.
7. Reconnect expired provider or plugin credentials.
8. Send a small direct Command Console prompt before retrying a mission or channel workflow.

For a full beta reset, close DystopAI, back up state if running from source with `npm run state:backup`, then rename the local state folders instead of deleting them. Reopen DystopAI and reconnect providers or plugins only after a fresh launch works.

## Safe Logs And Feedback

Logs can contain sensitive prompts, workspace paths, credentials, tokens, provider metadata, channel messages, or personal data. Share the smallest useful excerpt and redact secrets before sending a report.

Useful report shape:

```text
Version or commit:
Operating system:
Packaged app or source run:
What I did:
What I expected:
What happened:
Gateway state from Monitor:
Provider/plugin/channel involved:
Safe log excerpt:
```

For vulnerabilities, do not open a public issue with exploit details or private logs. Use the repository's private vulnerability reporting path.

## Release Qualification Checklist

Before publishing a build with these notes:

- Hosted `Control Plane CI / Hardened control plane` passed on the exact release commit.
- `docs/CI_EVIDENCE.md` links the green run, commit SHA, and artifact names.
- Packaged desktop launch smoke passed against the packaged app.
- Packaged beta screenshots were captured for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor.
- Release evidence and validation completed in the intended beta mode.
- Installer caveats in these notes match the actual artifact signing status.
