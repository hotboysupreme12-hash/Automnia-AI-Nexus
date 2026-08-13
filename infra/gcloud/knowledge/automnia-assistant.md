# Automnia Assistant Knowledge Base

## Product overview

Automnia is a desktop-first AI operations workspace. It combines local runtime controls, OpenClaw gateway sessions, provider and model settings, missions, agents, plugins, a command console, and a live monitor. The application is designed to keep local and BYOK workflows available when hosted services are unavailable.

The expanded source-of-truth guide is `docs/AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md`.
Use it for the complete documentation-folder map, local startup commands, exact
UI labels, every Agent Editor tab, **Agent files → Retire**, all Settings
categories, Google Cloud operations, and the detailed Help response contract.
This file supplies compact identity and routing rules; the manual supplies the
full operator procedures.

For outcome-based setup templates, use `docs/AGENT_CAPABILITY_PLAYBOOK.md`.
It covers customizing agents, Google Workspace email with Gog, ClawTalk phone
setup, Telegram, skills and plugin power-ups, recurring Missions, advanced
multi-agent teams, YouTube research, browser automation, Instagram planning,
Google Cloud/Gog CLI boundaries, and a 100-idea capability catalog. Each
playbook pairs a ready-to-paste agent-first prompt with exact manual controls,
safe tests, and approval boundaries. The Help cards are suggestions only; a
click asks for guidance and does not execute a setup.

## Agent-first setup

For setup requests, Automnia starts with the configured primary agent whenever
one has a working model route. The user selects that agent in **Agents**, opens
**Command Console**, and describes the desired model, plugin, chat, channel, or
workflow in plain language. The agent inspects readiness, completes the safe
configuration and verification its enabled tools permit, and reports the final
evidence plus only the smallest remaining human step. Help should present this
as the default before a manual checklist, then provide exact self-service steps
when the user requests them or when bootstrap, account ownership, OAuth consent,
billing, or approval requires the user.

Credentials are always a secure handoff: enter a token or key only in the
relevant **Provider connection** or **Plugins > Setup** secure field, never in
Help, Command Console, agent files, or a document. After the secure field is
saved, the primary agent can continue and validate the setup without seeing the
secret in chat.

## Account activation and sign-in

On first activation, a user can create an Automnia account password. The password is stored as a one-way password verifier by the hosted account service; Automnia does not display or recover the original password. Users can sign in and out with their Automnia account credentials, and Google sign-in can be linked when it is available.

Higher plans can use BYOK provider credentials and can continue local work offline when the user has configured a supported provider. Hosted-credit plans use the Automnia Cloud relay and require an active subscription or credit balance. A Starter plan requires online entitlement verification and does not include BYOK access. Never put passwords, access tokens, API keys, or private customer data into support questions or documentation.

## Hosted Automnia Cloud relay

The hosted relay is a Cloud Run service owned by the Automnia deployment. The desktop app sends hosted-credit requests to the relay; the relay authenticates the active license, calls the configured Google Vertex AI service identity, records usage, and returns the remaining Automnia credit balance. A relay failure should be shown as a relay or provider problem and should not silently switch a hosted-credit request to an unpaid provider.

BYOK tiers can choose Automnia-credits-first, provider-first with Automnia
fallback, or provider-only routing in Account & License. A BYOK account with a
confirmed pooled balance—including credits carried over from Starter—defaults
to Automnia credits first but can change the priority at any time. A zero-
balance BYOK account defaults to provider-first until credits are added.
Provider-only requests do not spend Automnia credits and do not delete the
wallet; the other two routes can use the account's pooled Automnia balance.
The selector is locked only for Starter Subscription. Purchases linked to the
same verified email are pooled after Google or confirmed-password sign-in, so
users do not need to manage a separate key for each purchase.

## OpenClaw gateway and first-run migration

The OpenClaw gateway is a local background process used for sessions, plugins, channels, and runtime work. During a fresh setup, OpenClaw may run startup migrations against its state directory. While migration is running, the gateway can exit and restart several times. These restarts are expected recovery activity, not a user action request.

The Automnia interface should keep a visible migration-running status near the runtime-connected indicator until the migration is finished. Users should not repeatedly reinstall, delete the state directory, or start multiple gateways while this status is present. If the status does not clear after the retry window, use the Diagnostics or Doctor action and preserve the redacted lifecycle logs.

## Monitor and runtime status

The Monitor tab displays gateway health, runtime connectivity, active sessions, lifecycle events, logs, missions, and recovery activity. A migration, gateway restart, or provider retry can temporarily make the status change even when the app is recovering normally. Look for the final healthy or connected state before treating a transient restart as a failure.

## Troubleshooting workflow

1. Check the runtime-connected indicator and any migration-running notice.
2. Read the latest lifecycle and stderr entries; do not rely only on an earlier restart message.
3. If the gateway is migrating, wait for the retry window and avoid launching another gateway.
4. If hosted credits are involved, confirm the Account and License balance and subscription status.
5. For BYOK, verify the selected provider, model availability, and local authentication without exposing the credential.
6. Run the built-in Doctor or Diagnostics action and share only redacted output.

## Privacy and safety

Do not upload passwords, access tokens, API keys, license keys, OAuth authorization codes, customer emails, private workspace files, or raw Firestore exports to this knowledge base. Support answers should acknowledge uncertainty, link to the relevant Automnia documentation when available, and recommend a local diagnostic check when the answer depends on machine state.
