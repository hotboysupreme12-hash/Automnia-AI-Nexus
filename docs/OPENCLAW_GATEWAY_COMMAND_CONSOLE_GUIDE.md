# OpenClaw Gateway Command Console Guide

This project keeps a local Markdown snapshot of the current OpenClaw docs in
`docs/openclaw-latest`. Refresh it with:

```bash
npm run docs:openclaw:sync
```

## Console Architecture

The Command Console should behave like a Gateway client, not like a separate
runtime mode. The target behavior is the same shape as OpenClaw WebChat and
ClawTalk: a warm session accepts a message immediately, streams the assistant
reply as events, and lets the OpenClaw agent loop decide whether tools are
needed inside that same turn.

The preferred long-term execution path is:

1. Keep one Gateway running for the Control Center and channel/plugin surfaces.
2. Connect the backend as a trusted loopback `gateway-client` in `backend` mode.
3. Send console turns through `chat.send`.
4. Stream matching `chat` `delta` events by `runId` directly to the Command
   Console SSE response.
5. Use the matching `chat` `final`, `error`, or `aborted` event as the terminal
   run state.
6. Use `chat.history` for the durable final assistant text.
7. Use `chat.message.get` when a `chat.history` row is truncated or replaced by
   an oversized-message placeholder.
8. Treat `tools.effective` as a diagnostic/session inventory call, not a warm-up
   call or a required part of the reply path.
9. Use `chat.abort` when the HTTP request is canceled or the run times out.
10. Fall back to the older Gateway CLI bridge, then embedded local execution, only
   when the persistent Gateway client or Gateway transport fails.

The current Gateway docs are explicit that `tools.effective` is read-only for
MCP: it can project an already-warm MCP catalog through final tool policy, but
it does not create MCP runtimes, connect transports, or issue `tools/list`.
Keeping it off the critical path preserves the fast-chat feel while still
leaving tools available when the agent actually needs them.

## Relevant Docs

- `docs/openclaw-latest/pages/gateway/protocol.md`: Gateway WebSocket protocol,
  backend client mode, roles, scopes, and event framing.
- `docs/openclaw-latest/pages/web/webchat.md`: WebChat usage of
  `chat.history`, `chat.send`, `chat.inject`, and `tools.effective`.
- `docs/openclaw-latest/pages/web/control-ui.md`: Control UI chat/Talk behavior,
  final/error events, `chat.abort`, and history refresh semantics.
- `docs/openclaw-latest/pages/cli/agent.md`: CLI bridge behavior and embedded
  `--local` fallback.

## Gateway Client Implementation

The Control Center backend should speak the documented Gateway WebSocket
protocol directly for Command Console chat. It uses a small loopback backend
client that sends the `connect` handshake and normal `{type:"req", id, method,
params}` frames, then forwards `{type:"event"}` frames into the existing SSE
bridge. Do not import the full bundled `gateway-runtime.js` module in the
Command Console request path; that bundle can load unrelated runtime code and
block the Node event loop before the SSE response reaches the browser.

## Current Implementation

User-originated Command Console turns now prefer the OpenClaw runtime path by
default so they behave more like Telegram, ClawTalk, and WebChat. The frontend
passes a stable console session key shaped as
`agent:<agentId>:control-center:console` plus `forceOpenClawRuntime=true`, which
lets the backend enter the persistent Gateway `chat.send` path immediately
instead of first trying a direct provider lane with no tool loop.

Command Console user text is sent to Gateway as the operator message, not as a
hand-built Control Center doctrine packet. OpenClaw owns the system prompt,
Project Context, transcript replay, tool loop, and history normalization for
Gateway chat sessions. The server may add a small filename-resolution hint when
it confidently fixes a typo, but it must not copy startup/doctrine files,
teammate memory, or the Control Center agent identity wrapper into normal
console `chat.send` messages. ClawTalk keeps its phone-specific runtime
instruction path because that is a channel/tool routing requirement, not a
generic Command Console chat behavior.

Command Console `chat.send` parameters should match the documented WebChat
shape. Do not force `deliver: false`, and do not set
`suppressCommandInterpretation: true`; Gateway owns delivery-route inheritance,
slash-command handling, and transcript updates for this surface. The final SSE
reply must come from `chat.history` / `chat.message.get` or from a real final
assistant message. A bare Gateway terminal status such as `ok` is protocol
state, not assistant text.

`server/index.ts` still keeps direct provider streaming available for non-forced
or internal callers, but the normal console experience is the Gateway-backed
agent session. Tool-shaped turns, explicit runtime shortcuts, attachments that
need workspace handling, and direct-provider tool denials also route through the
OpenClaw runtime path, where the persistent Gateway chat client is tried first.
The result transport is reported as `gateway-chat` when that path succeeds. If
the live Gateway client path fails before a terminal model result, the existing
Gateway CLI bridge is used. If the Gateway transport is not available, embedded
local execution remains the final fallback.

The stream route uses the WebChat-style Gateway event bridge for normal
runtime-routed turns:

1. `/api/openclaw/agent-turn/stream` registers an internal Gateway stream
   observer.
2. Forced Command Console runtime turns dispatch the plain operator message
   directly through the persistent Gateway chat client. They do not build a
   doctrine prompt in-process, post back into `/api/openclaw/agent-turn`, or
   show the older buffered-process waiting state.
3. Normal forced Command Console Gateway turns skip the heavy Control Center
   defaults/plugin/sandbox preflight in the HTTP hot path. Gateway owns the
   agent loop and will return any real runtime/config error through `chat`
   events. ClawTalk keeps the channel-specific preflight because SMS/phone
   routing may require tool repair before dispatch.
4. Non-console buffered/tool fallback paths can still use the compatibility
   handoff when direct provider streaming is unsuitable.
5. When `runControlCenterGatewayChatTurn()` starts a persistent Gateway
   `chat.send` turn, its waiter is linked to the observer.
6. Gateway `chat` `delta` events are forwarded to the Command Console SSE stream
   as `delta` events with `transport: "gateway-chat"` and `liveTokens: true`.
7. Gateway `chat` `replace=true` events are preserved so the frontend can replace
   the accumulated live assistant text instead of appending stale text.
8. Gateway `agent` and `session.tool` events are projected as SSE `progress`
   events so the existing activity rail shows live work.
9. If a non-console fallback path uses the CLI bridge or local embedded runtime,
   the compatibility bridge still emits the final assistant text as one buffered
   delta.

Startup and hot-path prewarming keep first-use latency down:

- When Gateway auto-start is enabled, the backend schedules a best-effort
  prewarm that prepares agent-run defaults, starts/checks Gateway, and connects
  the persistent Gateway chat client before the first tool-capable console turn.
- Gateway startup checks must test `/health` before running plugin/runtime repair
  work. A healthy Gateway is already available for `chat.send`; repair scans are
  recovery work, not part of the Command Console hot path.
- Runtime-routed stream turns also trigger the same shared prewarm promise before
  dispatching to Gateway chat, so a cold client can connect while runtime
  health checks are still happening.
- Forced Command Console runtime turns skip duplicate Control Center preflight
  in the HTTP hot path. Gateway performs the authoritative session/runtime work
  and streams any real validation/config error back through the same SSE
  response.
- The stream route emits an early accepted/status frame before heavier runtime
  setup, mirroring the quick acknowledgement users expect from Telegram.
- Runtime health and summary endpoints are part of the Command Console hot path.
  They should read JSONL/cache/in-memory state and must not synchronously open
  SQLite ledgers or cron state databases while the UI is polling for live chat
  status.
- `/api/health` exposes `gatewayChat.ready`, `gatewayChat.prewarming`,
  `gatewayChat.prewarmedAt`, and `gatewayChat.defaultsReady` for quick checks.

Do not make the older buffered runtime handoff the default user experience. It
is still useful as a fallback, but successful `gateway-chat` turns should stream
live deltas and return final metadata with `streaming.liveTokens: true`.

The persistent client must stay aligned with the documented internal helper
path:

- `client.id` / `clientName`: `gateway-client`
- `client.mode`: `backend`
- `role`: `operator`
- scopes: include `operator.read`, `operator.write`, `operator.admin`, and
  `operator.talk.secrets`
- `caps`: include `tool-events`
- `deviceIdentity`: `null` for trusted local token/password loopback use
- startup is long-lived and must not be tied to an individual HTTP/SSE request
  abort signal

For user-visible responsiveness, Gateway chat runs are also mirrored into the
Control Center runtime run ledger while active. They have no child PID because
the Gateway owns execution, but the existing SSE keepalive can still show that
the agent is actively working.

Use these escape hatches for diagnostics:

- `CONTROL_CENTER_GATEWAY_CHAT_CLIENT=0`: skip persistent Gateway chat client.
- `CONTROL_CENTER_GATEWAY_AGENT_SESSIONS=0`: skip Gateway-backed console runs.
- `CONTROL_CENTER_FORCE_LOCAL_AGENT_RUNTIME=1`: force embedded local execution.
- `CONTROL_CENTER_GATEWAY_TOOLS_EFFECTIVE_DIAGNOSTIC=1`: issue the
  `tools.effective` diagnostic inventory call after `chat.send`. Keep this off
  during normal chat because the docs define it as read-only inventory, not a
  required warm-up step.
