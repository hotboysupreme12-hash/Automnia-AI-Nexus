# Automnia AI Public Beta Candidate Notes

Last updated: 2026-07-05

Automnia AI is a local-first desktop cockpit for OpenClaw agents, missions, schedules, plugins, provider setup, compatible channels, and live runtime monitoring.

## Beta boundary

- Automnia AI is on the public beta track. Treat each build as a public beta candidate until the exact release commit has green hosted CI evidence and packaged artifacts attached.
- Packaged build availability can vary by platform and release.
- Windows desktop builds are the primary packaged beta path unless a release says otherwise.
- Linux, macOS, and server/headless paths may be packaged or source-based depending on the build being tested.
- Do not use beta builds for unattended business-critical automation.

## Before you install

- Back up important local Automnia AI and OpenClaw state before testing an upgrade.
- Use test accounts where possible.
- Keep local control surfaces on loopback addresses.
- Review provider, plugin, channel, and workspace permissions before connecting them.
- Keep approval gates on for high-impact actions.

## Known limitations

- Gateway, plugin, and channel status can require a manual Gateway reset or app restart after provider setup changes, plugin setup changes, interrupted runs, or local port conflicts.
- Provider sessions, quotas, and channel setup values expire under the provider's own rules.
- Clean Slate clears stale monitor cache, completed runtime calls, log tail snapshots, and stale session locks. It does not delete saved agents, durable configuration, or OpenClaw state.
- Full local state reset is manual during beta.
- Platform behavior can differ between packaged desktop builds, source runs, and server/headless validation.

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

When reporting beta feedback, include the app version or commit, build target, operating system, install type, steps, expected behavior, actual behavior, Gateway state, and a redacted log excerpt when useful.

Use the beta feedback template:

```text
https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/issues/new?template=beta_feedback.yml
```
