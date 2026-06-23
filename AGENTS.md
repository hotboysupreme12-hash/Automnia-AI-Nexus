# DystopAI Core Agent Notes

## OpenClaw Reference Docs

When changing OpenClaw, Gateway, Command Console, ClawTalk, runtime, tool routing,
agent sessions, plugins, or related Control Center behavior, check the local
OpenClaw documentation snapshot first:

- `C:\Users\hotbo\Downloads\DystopAI-Core Latest extracted\DystopAI-Core\docs\openclaw-latest`
- `C:\Users\hotbo\Downloads\DystopAI-Core Latest extracted\DystopAI-Core\docs\openclaw-latest\pages`

Useful starting points:

- `docs/openclaw-latest/pages/gateway/protocol.md`
- `docs/openclaw-latest/pages/web/webchat.md`
- `docs/openclaw-latest/pages/web/control-ui.md`
- `docs/openclaw-latest/pages/cli/agent.md`
- `docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md`

Refresh the snapshot when current upstream behavior matters:

```bash
node scripts/sync-openclaw-docs.mjs
```
