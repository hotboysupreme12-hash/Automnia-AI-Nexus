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

## Voice input

- Voice input defaults to **Local**. The recording is held in memory, transcribed on the operator device, and is not sent to a speech provider. Automnia prepares the compact Whisper model when Local mode becomes available, downloads it from Hugging Face once, and caches it for later offline use.
- Local voice input never falls back to an online provider automatically. If local transcription cannot run, the app reports the failure and leaves the operator in control.
- Choosing **Cloud** under Settings → Voice transcription explicitly sends that voice recording to OpenAI's transcription API using the OpenAI API key configured in Provider Auth. The key remains in the local control plane and is not exposed to the renderer.
- The temporary recording is released after transcription. The resulting text becomes a normal Command Console draft and follows the same storage and provider behavior as typed text.

## Operator controls

Use agent tool and workspace policies to minimize access. Stop Automnia AI before creating a state backup, keep backups protected, and remove local state when retiring a device.

This notice describes the current local-first architecture. It is not a substitute for provider-specific privacy terms or legal advice.
