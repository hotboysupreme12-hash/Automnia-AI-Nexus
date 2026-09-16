# Provider model compatibility

**Verified against provider documentation on September 16, 2026.** This guide
defines the current-model contract implemented by Automnia's primary and
fallback model selectors. Provider account entitlements, regional availability,
and rate limits still decide whether a particular account can make a live call.

## What this covers

This compatibility layer covers text and vision-capable agent models selected in
Automnia, including:

- model catalog and picker visibility;
- provider credentials and generated OpenClaw model configuration;
- direct, streaming text turns when the provider supports the selected route;
- the buffered Gateway/OpenClaw path for workspace and tool requests; and
- provider-preserving resilience fallbacks when a selected model is unavailable.

It does not claim that every model in a provider's broader catalog works as a
drop-in text agent. Gemini Live, speech, image/video generation, and Gemini
Deep Research use different Live, media, or agent API contracts. They are not
shown as normal text-agent choices until Automnia has a dedicated adapter and
end-to-end contract for them.

## Supported current models

| Provider route | Current model IDs in Automnia | Transport and requirements |
| --- | --- | --- |
| OpenAI API | `openai/gpt-6-astra` | Direct text turns use the OpenAI Responses API and an `OPENAI_API_KEY`. Tool/workspace turns use the Gateway/OpenClaw runtime so tool approvals, session recovery, and streamed final answers remain consistent. GPT-6 Astra is deliberately **not** presented as a Codex OAuth-only model. |
| Google Gemini API | `google/gemini-3.8-flash`, `google/gemini-3.5-flash-lite`, `google/gemini-3.1-pro-preview` | Uses the Google Generative Language route and Google API-key/OAuth setup. Tool requests use the native Gateway path. |
| Google Vertex AI | `google-vertex/gemini-3.8-flash`, `google-vertex/gemini-3.5-flash-lite`, `google-vertex/gemini-3.1-pro-preview` | Uses configured Vertex project, location, and application credentials/OAuth. Availability remains account- and region-dependent. |
| Anthropic | `anthropic/claude-fable-5-1`, `anthropic/claude-fable-5`, `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5` | Uses the native Anthropic/OpenClaw runtime for agent turns. The fallback catalog only exposes Anthropic IDs verified in the bundled runtime and current Anthropic catalog. |

The catalog can also contain earlier provider models and account-specific models
reported by `openclaw models list`. “Available” means the ID is recognized and
configured; it does not override provider-side access control.

## Request compatibility rules

### OpenAI GPT-6 Astra

OpenAI documents GPT-6 Astra as an API model that supports Responses, streaming,
function calling, structured outputs, and tool use. Automnia normalizes the
product's broad thinking selector to its valid reasoning efforts:

- **Off** and **Minimal** become `low` on both direct and Gateway runtime
  paths.
- **Low**, **Medium**, **High**, **XHigh**, and **Max** are sent unchanged.
- Plain conversation streams directly. Requests that need workspace or runtime
  tools are handed to the bounded Gateway/OpenClaw flow instead of a text-only
  fallback.

This preserves tool approvals and recovery behavior while avoiding unsupported
`none` or `minimal` effort values for Astra. See the official [GPT-6 Astra model
page](https://developers.openai.com/api/docs/models/gpt-6-astra).

### Gemini and Vertex Gemini

Gemini 3.1 Pro Preview, Gemini 3.7 Flash, and Gemini 3.8 Flash accept `LOW`,
`MEDIUM`, and `HIGH` thinking levels. Automnia maps **Off/Minimal** to `low` and
**XHigh/Max** to `high` for those model families on both direct Gemini and
Vertex paths.

Gemini 3.5 Flash-Lite retains **Minimal**, because it is valid for that model.
For Flash-Lite and the current 3.6/3.7/3.8 Flash migration contracts, custom
temperature, top-p, and top-k values are omitted where Google marks them
unsupported or deprecated. This prevents a direct artifact request from
drifting away from the normal streaming contract.

Google's [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models),
[Gemini 3.5 Flash-Lite guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite),
and [Vertex Gemini 3.8 guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash)
are the source of truth for per-model availability and request restrictions.

### Anthropic Claude

Claude Fable 5.1 is included as the current frontier Anthropic option alongside
the supported Opus, Sonnet, Haiku, and prior Fable entries. Anthropic agent
turns stay on the native Gateway/OpenClaw execution path so adaptive thinking,
tool loops, approvals, and final-answer recovery remain provider-native rather
than being approximated by a generic OpenAI-compatible stream. Consult the
official [Anthropic model overview](https://platform.claude.com/docs/en/models/overview)
for current account availability, model retirement dates, and pricing.

## Configure and verify safely

1. In **Settings → Provider connections**, connect the provider intended for
   the selected route: an OpenAI API key for GPT-6 Astra; a Gemini API key or
   Google OAuth for direct Gemini; a Google Cloud project, location, and
   application credentials/OAuth for Vertex; or Anthropic credentials for
   Claude.
2. Refresh the model picker and choose the fully-qualified provider ID. Do not
   replace its provider prefix with a look-alike model name.
3. Send a small, non-sensitive plain-text prompt first. Confirm the selected
   provider and model in the agent activity/response console.
4. Test one safe tool request in a disposable workspace, such as asking the
   agent to inspect a project file. Confirm that the Gateway reports the tool
   runtime and that the request receives a final answer.
5. If a provider rejects the request, keep the user-facing model selection and
   repair the listed provider credential, project/region, or account access;
   do not silently relabel the request as another provider.

Local unit and smoke tests validate the catalog, normalization, provider
configuration, grouping, and generated runtime contracts. A live provider call
still requires the account, credentials, permissions, billing, and regional
availability above; that is intentionally not fabricated by local validation.

## Fallback behavior

Fallbacks remain inside the selected provider family. GPT-6 Astra can fall back
to configured GPT-5.6 models; Gemini and Vertex Flash routes can step down
through their corresponding Flash-Lite and earlier same-provider routes. A
fallback is activated only after a verified provider failure and is visible in
runtime diagnostics. It never substitutes a different provider merely to hide a
credential or entitlement problem.
