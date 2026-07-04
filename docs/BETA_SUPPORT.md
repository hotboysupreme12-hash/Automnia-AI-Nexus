# Automnia AI Beta Support Runbook

Last updated: 2026-07-04

Automnia AI is in public beta candidate status. Expect rough edges, keep backups of important local state, and use beta builds only on machines where you are comfortable troubleshooting a local agent runtime. Do not use beta builds as an unattended production system.

## Supported OS For Beta

The primary supported beta path is Windows 11 x64. Windows 10 22H2 x64 is best effort. Developer validation from source is available for macOS and Linux.

Recommended local tooling for source runs:

- Node.js `24`, or Node.js `22.19+` for compatibility.
- npm.
- Git.
- Model provider access for the providers you choose to use.

## Known Issues

- Beta builds may be unsigned or distributed outside the final public release channel.
- Gateway, plugin, and channel state can occasionally need a manual `Reset gateway` or app restart after provider setup changes, plugin setup changes, or interrupted runs.
- Provider sessions, quotas, and channel setup values can expire independently of Automnia AI.
- `Clean Slate` clears stale runtime projection and session locks, but it does not delete durable configuration, saved agents, or OpenClaw state.
- Full local state reset is manual during beta.

## How To Recover Gateway

1. Open Monitor and wait a few seconds for health polling.
2. Check active calls, cron jobs, channel activity, and recent logs.
3. If work is active, stop or let it finish before resetting Gateway.
4. Click `Reset gateway`.
5. If plugin or channel state still looks stale, click `Stop gateway`, close Automnia AI, then reopen it.
6. Reconnect any expired model provider or plugin access.
7. Send a small direct Command Console prompt before retrying a mission or channel workflow.

## How To Reset Local State

Start with the least destructive option:

1. Open Monitor.
2. Use `Clean Slate` for stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks.
3. Use `Reset gateway` if Gateway itself is unhealthy.
4. Restart Automnia AI.

For a full beta reset, close Automnia AI, create a backup if running from source with `npm run state:backup`, rename local app and OpenClaw state folders, then reopen the app and reconnect providers or plugins.

## How To Send Safe Logs

Share the smallest useful excerpt. Prefer Monitor `logs` excerpts over whole state directories. Include the app version or commit, operating system, whether this is packaged or source, Gateway state, the provider or plugin involved, and exact reproduction steps.

Useful beta report shape:

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

## Local-First Notes

By default, Automnia AI keeps app state on the operator machine and OpenClaw runtime state under `~/.openclaw`. Agent workspaces stay in folders chosen by the operator. External providers, plugins, channels, browser tools, and feedback reports can cross the local boundary when configured by the operator.

## Do Not Expose The Local API To A Network

Do not expose the Automnia AI local API or OpenClaw Gateway to a LAN or the public internet. Keep local control surfaces on loopback and use supported channel plugins for remote operation.

## Feedback

Use the GitHub beta feedback template:

https://github.com/hotboysupreme12-hash/DystopAI-Core/issues/new?template=beta_feedback.yml

For private security reports, follow `SECURITY.md`.
