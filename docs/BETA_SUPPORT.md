# DystopAI Beta Support Runbook

Last updated: 2026-06-30

DystopAI Core is in private beta. Expect rough edges, keep backups of important local state, and use beta builds only on machines where you are comfortable troubleshooting a local agent runtime. Do not use beta builds as an unattended production system.

## Supported OS For Beta

The primary supported beta path is:

- Windows 11 x64.
- Windows 10 22H2 x64, best effort.

Developer validation from source is available for macOS and Linux, but packaged macOS and Linux beta builds are not part of the default supported beta path unless the release notes for a specific build say otherwise.

Recommended local tooling for source runs:

- Node.js `24`, or Node.js `22.19+` for compatibility.
- npm.
- Git.
- Model provider credentials or OAuth access for the providers you choose to use.

## Known Issues

- Private beta builds may be unsigned or distributed outside the final public release channel, so operating systems may show trust or installer warnings.
- Gateway, plugin, and channel state can occasionally need a manual `Reset gateway` or app restart after provider auth changes, plugin setup changes, or interrupted runs.
- Provider OAuth sessions, API keys, quotas, and channel credentials can expire independently of DystopAI. Reconnect the provider or plugin before treating a failure as an app bug.
- `Clean Slate` clears stale runtime projection and session locks, but it does not delete durable configuration, saved agents, provider credentials, or OpenClaw state.
- Full local state reset is manual during beta. Back up or rename state folders before deleting anything.
- State backups do not follow symlinked plugin-skill entries. They record skipped symlinks in `backup-manifest.json`; refresh or reinstall the related plugin after restore if a skill link is missing.
- Public release signing, public auto-update, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure are outside this beta milestone.

## How To Recover Gateway

Use this order when Monitor shows Gateway as off, checking, unhealthy, stale, or disconnected:

1. Open Monitor and wait a few seconds for health polling.
2. Check active calls, cron jobs, channel activity, and recent logs.
3. If work is active, stop or let it finish before resetting Gateway.
4. Click `Reset gateway`.
5. If plugin or channel state still looks stale, click `Stop gateway`, close DystopAI, then reopen it.
6. Reconnect any expired model provider or plugin credentials.
7. Send a small direct Command Console prompt before retrying a mission or channel workflow.
8. If Gateway still cannot recover, back up local state, then use the local state reset steps below.

Common things to check:

- The local Gateway port defaults to `127.0.0.1:18789`.
- The local Control Plane API defaults to `127.0.0.1:4050`.
- Another local process on the same port can block Gateway startup.
- A plugin with missing setup can keep channel or plugin status degraded until setup is fixed and Gateway is restarted.

## How To Reset Local State

Start with the least destructive option:

1. Open Monitor.
2. Use `Clean Slate` for stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks.
3. Use `Reset gateway` if Gateway itself is unhealthy.
4. Restart DystopAI.

For a full beta reset:

1. Close DystopAI.
2. If running from a source checkout, create a backup:

   ```bash
   npm run state:backup
   ```

   The backup manifest records regular files plus any skipped symlink entries. Skipped plugin-skill links are expected in some beta states and are safer to reconstruct from the plugin install/runtime state than to copy through a symlink.

3. Rename these folders instead of deleting them:

   ```text
   %USERPROFILE%\.dystopai-control-center
   %USERPROFILE%\.openclaw
   ```

   On macOS or Linux, the same folders are usually:

   ```text
   ~/.dystopai-control-center
   ~/.openclaw
   ```

4. Reopen DystopAI and reconnect model providers or plugins.
5. Restore individual agent, workspace, or config files only after confirming a fresh app launch works.

If you use overrides, reset the folders pointed to by `DYSTOPAI_USER_DATA_DIR`, `OPENCLAW_STATE_DIR`, or `OPENCLAW_HOME` instead of the defaults.

## How To Send Safe Logs

Logs and diagnostics can contain sensitive operational data. Share the smallest useful excerpt.

Before sending logs:

- Remove provider API keys, OAuth tokens, bearer tokens, cookies, passwords, and secret references.
- Remove private prompts, private file contents, personal messages, phone numbers, email addresses, and workspace paths you do not want to share.
- Prefer Monitor `logs` excerpts over whole state directories.
- Include the app version or commit, operating system, whether this is packaged or source, Gateway state, the provider or plugin involved, and exact reproduction steps.
- Do not upload `~/.openclaw`, `~/.dystopai-control-center`, full backups, browser profiles, or workspace archives unless a maintainer explicitly asks for a reviewed, minimized bundle.

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

## What Data Stays Local

By default, DystopAI is local-first:

- DystopAI desktop state stays under `~/.dystopai-control-center`.
- OpenClaw runtime state stays under `~/.openclaw`.
- Agent workspaces stay in folders chosen by the operator.
- Agent configuration, doctrine files, mission history, local runtime ledgers, provider auth material, and plugin configuration stay on the operator machine unless a configured tool sends them elsewhere.
- DystopAI does not require a DystopAI cloud telemetry service.

## What Can Leave Your Machine

Data can leave your machine when you enable or use anything that reaches an external service:

- Model provider requests can send prompts, instructions, attachments, tool results, and conversation context to the selected provider.
- Plugins and channels can send messages, files, metadata, and replies through services such as chat, email, voice, browser, webhook, or provider systems.
- Browser tools can send requests to visited websites.
- Diagnostic or feedback reports leave your machine when you choose to submit them.
- Operating-system services, model providers, websites, and communication platforms may keep their own logs under their own terms.

Use separate test credentials for beta when possible, and keep approval gates in front of purchases, deployments, deletes, external messages, and account changes.

## Do Not Expose The Local API To A Network

Do not expose the DystopAI local API or OpenClaw Gateway to a LAN or the public internet.

Keep these surfaces on loopback:

- Control Plane API: `127.0.0.1:4050`
- Development frontend: `127.0.0.1:5173`
- OpenClaw Gateway: `127.0.0.1:18789`

Do not bind these services to `0.0.0.0`, publish them through port forwarding, or tunnel them with remote-access tools. Browser sessions and local tokens are designed for one trusted local operator boundary, not hostile network traffic.

If you need remote operation, use a supported channel plugin with explicit credentials, scoped provider access, and approval gates.

## Feedback

Use the GitHub beta feedback template:

https://github.com/hotboysupreme12-hash/DystopAI-Core/issues/new?template=beta_feedback.yml

For suspected vulnerabilities, do not open a public issue with exploit details or private logs. Follow `SECURITY.md` and use the repository's private vulnerability reporting path.
