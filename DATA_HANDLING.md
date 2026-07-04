# Automnia AI Data Handling Notice

Automnia AI is designed as a local-first desktop operator console. App configuration, agent doctrine, workspaces, ledgers, and runtime state live on the operator machine unless a configured model provider, plugin, channel, or agent tool sends data elsewhere.

## Data locations

- Local app state is stored on the operator machine.
- OpenClaw state defaults to `~/.openclaw`.
- Agent workspaces use folders selected by the operator.
- Release diagnostics and logs may contain operational metadata and should be reviewed before sharing.

## Local-first model

By default, Automnia AI keeps operator configuration, agent doctrine, runtime ledgers, mission history, plugin configuration, local sessions, and selected workspaces on the operator machine. Automnia AI does not require a cloud telemetry service for local operation.

Local-first does not mean every enabled workflow is offline. External providers, plugins, channels, browser actions, and diagnostics can cross the local boundary when the operator configures them to do so.

## Operator controls

Use agent tool and workspace policies to minimize access. Stop Automnia AI before creating a state backup, keep backups protected, and remove local state when retiring a device.

This notice describes the current local-first architecture. It is not a substitute for provider-specific privacy terms or legal advice.
