# Automnia Telegram capability matrix

Automnia uses the bundled OpenClaw Telegram runtime. The runtime already implements the capabilities below; this matrix is the durable operator and research reference. Live controls are in **Settings → Telegram**; configuration-sensitive features remain opt-in because enabling public access, message actions, webhooks, or private-network exceptions can change the bot's security boundary.

Primary references:

- [OpenClaw Telegram channel guide](openclaw-latest/pages/channels/telegram.md)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [OpenClaw slash commands](https://docs.openclaw.ai/tools/slash-commands)

| # | Area | Capability | Automnia treatment |
|---:|---|---|---|
| 1 | Security | BotFather token auth | Runtime setup |
| 2 | Security | Token-file rotation | Runtime setup |
| 3 | Security | Multi-account bots | Runtime support |
| 4 | Security | Default-account selection | Runtime support |
| 5 | Security | DM pairing | Runtime support |
| 6 | Security | DM allowlists | Runtime support |
| 7 | Security | Group policy | Runtime support |
| 8 | Security | Group sender allowlists | Runtime support |
| 9 | Security | Group roster allowlists | Runtime support |
| 10 | Security | Telegram exec approvals | Runtime support |
| 11 | Routing | Long polling | Default transport |
| 12 | Routing | Webhook ingress | Runtime support |
| 13 | Routing | Webhook secret verification | Runtime support |
| 14 | Routing | Durable webhook acknowledgement | Runtime support |
| 15 | Routing | Forum topics | Runtime support |
| 16 | Routing | Per-topic agent routing | Runtime support |
| 17 | Routing | ACP topic binding | Runtime support |
| 18 | Routing | Sticky `/agents` picker | Automnia runtime patch |
| 19 | Routing | Bot-handle mention routing | Runtime support |
| 20 | Routing | Threaded DM sessions | Runtime support |
| 21 | Delivery | Native command menu | Runtime support |
| 22 | Delivery | Custom command menu | Runtime support |
| 23 | Delivery | Inline buttons | Runtime support |
| 24 | Delivery | Telegram Mini App dashboard | Runtime support |
| 25 | Delivery | Editable streaming preview | Runtime support |
| 26 | Delivery | Tool-progress visibility | Runtime support |
| 27 | Delivery | Bot API rich messages | Runtime support |
| 28 | Delivery | HTML formatting and links | Runtime support |
| 29 | Delivery | Explicit reply tags | Runtime support |
| 30 | Delivery | Native quote replies | Runtime support |
| 31 | Media | Media albums | Runtime support |
| 32 | Media | Media size limits | Runtime support |
| 33 | Media | Voice-note handling | Runtime support |
| 34 | Media | Audio-file delivery | Runtime support |
| 35 | Media | Video-note delivery | Runtime support |
| 36 | Media | Locations and venues | Runtime support |
| 37 | Media | Sticker context | Runtime support |
| 38 | Media | Sticker search | Runtime support |
| 39 | Media | Reaction notifications | Runtime support |
| 40 | Media | Acknowledgement reactions | Runtime support |
| 41 | Operations | Poll creation | Runtime support |
| 42 | Operations | Targeted message send | Runtime support |
| 43 | Operations | Message editing | Runtime support |
| 44 | Operations | Message deletion | Runtime support |
| 45 | Operations | Pinned delivery | Runtime support |
| 46 | Operations | Forum topic actions | Runtime support |
| 47 | Operations | Telegram config writes | Runtime support |
| 48 | Operations | Error reply policy | Runtime support |
| 49 | Operations | Bounded chat history | Runtime plus app safeguards |
| 50 | Operations | Overflow and compaction recovery | Automnia runtime policy |

## Operator path

1. Start or sync the Telegram plugin and confirm **Runtime: loaded**.
2. Use **Inspect** to verify the live channel surfaces after a restart.
3. Open **Settings → Telegram** to change the supported live controls, then use **Plugins → Telegram → Inspect** only to verify runtime loading.
4. Use a private chat first, then add groups/topics through explicit allowlists.
5. In Telegram, use `/agents`, `/agents <agent id or name>`, and `/agents reset` to control the Automnia agent route for that chat.

The matrix is an inventory and readiness guide; it does not silently turn on public access, outbound destructive actions, webhooks, rich-message compatibility, or private-network bypasses.
