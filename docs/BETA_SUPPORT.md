# Automnia AI Beta Support

Last updated: 2026-07-05

Automnia AI beta builds are for testing the desktop cockpit, agent runtime, missions, schedules, plugins, compatible channels, recovery controls, and local-first data boundaries before wider release.

Use beta builds on machines where you are comfortable testing a local agent runtime. Keep backups of important local state and avoid unattended business-critical automation during beta testing.

## Supported beta paths

Build support can vary by release. Always include the exact build target when reporting feedback.

| Build target | Status |
| --- | --- |
| Windows desktop build | Primary packaged beta path. |
| Windows source run | Supported for development and validation. |
| Linux desktop build | Beta validation path when a packaged build is provided. |
| Linux source run | Supported for development and validation. |
| macOS desktop build | Beta validation path when a packaged build is provided. |
| macOS source run | Supported for development and validation. |
| Server/headless source run | Advanced validation path for runtime or API testing. |

Recommended local tooling for source runs:

- Node.js `24`, or Node.js `22.19+` for compatibility.
- npm.
- Git.
- Model provider access for the providers you choose to use.

## Before you test

- Back up important Automnia AI and OpenClaw state.
- Use test accounts where possible.
- Keep local control surfaces on loopback addresses.
- Review provider, plugin, and channel permissions before connecting them.
- Keep approval gates on for customer messages, publishing, code pushes, file edits, and other high-impact actions.

## Known beta behavior

- Beta builds may be unsigned or distributed outside the final release channel.
- Gateway, plugin, and channel state can occasionally need `Reset Gateway` or an app restart after provider setup changes, plugin setup changes, interrupted runs, or local port conflicts.
- Provider sessions, quotas, and channel setup values can expire independently of Automnia AI.
- `Clean Slate` clears stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks. It does not delete saved agents, durable configuration, or OpenClaw state.
- Full local state reset is manual during beta.

## Recover Gateway

1. Open Monitor and wait for health polling.
2. Check active calls, cron jobs, channel activity, sessions, and recent logs.
3. If work is active, stop it or let it finish before resetting Gateway.
4. Use `Clean Slate` for stale monitor or runtime projection state.
5. Use `Reset Gateway` when Gateway is unhealthy or disconnected.
6. Use `Stop Gateway`, close Automnia AI, and reopen it if plugin or channel state remains stale.
7. Reconnect expired provider or plugin access.
8. Send a small direct Command Console prompt before retrying a mission or channel workflow.

## Reset local state

Start with the least destructive option:

1. Open Monitor.
2. Use `Clean Slate` for stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks.
3. Use `Reset Gateway` if Gateway itself is unhealthy.
4. Restart Automnia AI.

For a full beta reset, close Automnia AI, create a backup if running from source with `npm run state:backup`, rename local app and OpenClaw state folders, then reopen the app and reconnect providers or plugins.

## Send safe logs

Share the smallest useful excerpt. Prefer Monitor log excerpts over whole state directories.

Include:

- App version or commit.
- Build target tested: Windows desktop, Linux desktop, macOS desktop, server/headless, or source run.
- Operating system and architecture.
- Packaged app or source checkout.
- Gateway state from Monitor.
- Provider, plugin, or channel involved.
- Exact reproduction steps.
- Whether `Clean Slate`, `Reset Gateway`, or restart helped.

Useful beta report shape:

```text
Version or commit:
Build target:
Operating system and architecture:
Packaged app or source run:
What I did:
What I expected:
What happened:
Gateway state from Monitor:
Provider/plugin/channel involved:
Recovery tried:
Safe log excerpt:
```

## Local-first notes

By default, Automnia AI keeps app state on the operator machine and OpenClaw runtime state under `~/.openclaw`. Agent workspaces stay in folders chosen by the operator. External providers, plugins, channels, browser tools, and feedback reports can cross the local boundary when configured by the operator.

## Do not expose the local API to a network

Do not expose the Automnia AI local API or OpenClaw Gateway to a LAN or the public internet. Keep local control surfaces on loopback and use supported channel plugins for remote operation.

## Feedback

Use the GitHub beta feedback template:

```text
https://github.com/hotboysupreme12-hash/DystopAI-Core/issues/new?template=beta_feedback.yml
```

For private security reports, follow `SECURITY.md`.
