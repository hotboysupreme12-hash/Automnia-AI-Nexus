# DystopAI Data Handling Notice

DystopAI Core is designed as a local-first desktop operator console. Application configuration, agent doctrine, workspaces, ledgers, local authentication material, and runtime state are stored on the operator's machine unless a configured model provider, plugin, channel, or agent tool sends data elsewhere.

## Data locations

- DystopAI desktop state defaults to `~/.dystopai-control-center`.
- OpenClaw state defaults to `~/.openclaw`.
- Agent workspaces use the locations selected by the operator.
- Provider keys and OAuth credentials remain in local OpenClaw state.
- Release diagnostics and logs may contain operational metadata and must be reviewed before sharing.

## What data stays local

By default, DystopAI stores operator configuration, agent doctrine, runtime ledgers, mission history, provider authentication material, plugin configuration, local sessions, and selected workspaces on the operator's machine. DystopAI Core does not require a DystopAI cloud telemetry service for local operation.

Local-first does not mean every enabled workflow is offline. Agent tools, model providers, plugins, channels, browser actions, and diagnostics can cross the local boundary when the operator configures them to do so.

## What can leave your machine

Prompts, attachments, tool inputs, messages, or other content may be transmitted to model providers and connected services selected by the operator. Those services have their own terms, retention rules, and privacy practices. DystopAI does not make a local workflow private after the operator grants an agent a networked provider, browser, messaging, email, voice, or other external tool.

Examples of data that can leave the machine include model prompts and responses, attachment excerpts, tool results, channel messages, webhook payloads, browser requests, provider usage metadata, feedback reports, and any reviewed logs or diagnostics the operator submits.

## Telemetry

DystopAI Core does not require a DystopAI cloud telemetry service. Upstream model providers, OpenClaw plugins, communication channels, operating-system services, and websites visited by agents may independently collect usage or diagnostic data.

## Operator controls

Use the agent tool and workspace policies to minimize access. Remove provider credentials before sharing a machine or state archive. Stop DystopAI before creating a state backup, keep backups encrypted at rest, and securely delete local state when retiring a device.

This notice describes the current local-first architecture. It is not a substitute for provider-specific privacy terms or legal advice.
