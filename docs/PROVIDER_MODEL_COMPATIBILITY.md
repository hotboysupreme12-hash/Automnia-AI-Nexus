# Provider model compatibility

**Model and provider snapshot verified November 17, 2026.** This document
describes Automnia's model catalog and the request paths implemented by this
checkout. Provider login, account entitlements, billing, regional availability,
and credentials are checked separately at runtime.

## Automnia hosted tiers

| Automnia tier | Model ID | Default thinking | Telegram choices |
| --- | --- | --- | --- |
| Swift | `automnia-cloud/gemini-3.8-flash` | Medium | Low, medium, high |
| Balanced (default) | `automnia-cloud/gemini-4-hydrogen` | High | Low, medium, high, xhigh |
| Pro | `automnia-cloud/gemini-4-argon` | Medium | Low, medium, high |
| Frontier | `automnia-cloud/gemini-4-carbon` | Medium | Low, medium, high |

Google documents Hydrogen as the faster, broadly available Gemini 4 model,
Argon as its more efficient frontier reasoning model, and Carbon as its
highest-capability reasoning model. These Automnia tier names and access rules
are product policy: Swift and Balanced are on the credits-only route; Pro and
Frontier require an eligible paid entitlement. The relay only accepts the four
current IDs. Old hosted IDs are normalized to Balanced for persisted settings
and are removed from selectors and relay allowlists.

Hydrogen, Argon, and Carbon accept text, images, video, audio, and PDF input and
return text. Each has a unified 1,048,576-token input/thinking/output context
window. One foreground segment is capped at 65,536 output tokens for Hydrogen
(streaming or non-streaming) and for Argon/Carbon streaming; non-streaming
foreground requests to Argon/Carbon cap at 32,768 tokens. Google documents
long-decode continuation up to the remaining unified window through Interactions
or `GenerateContent` on `v1beta1`; the app does not implement that continuation
loop. The model cards list
function calling, code execution, computer use, file search, Google Search and
Maps grounding, structured outputs, URL context, and agentic video understanding
as supported. Image generation, audio generation, and Live API are not supported;
explicit context caching is not supported (implicit caching is). Hydrogen adds
`xhigh`; Argon and Carbon support `low`, `medium`, and `high`. Swift (Gemini 3.8
Flash) supports `low`, `medium`, and `high`, with `medium` as Google's default.

The product exposes model-specific thinking controls through OpenClaw's built-in
Telegram `/think <level>` command. `/think default` clears the session override
and restores the configured model default. Gemini models always reason at least
at `low`; an Automnia `/think off` request is mapped to `low`, because these model
APIs do not offer a no-thinking mode. XHigh is exposed only for Hydrogen; requests
for unsupported `xhigh` or `max` on the other Automnia models clamp to `high`.

For direct Gemini API billing, Google currently lists Hydrogen at $1.50 / 1M
input and $7.50 / 1M output tokens. Argon and Carbon are $2 / 1M input and
$10 / 1M output through November 30, 2026, then $4 / $20 starting December 1.
Argon and Carbon have no free tier. Gemini 3.8 Flash (Swift) is $0.75 / $3.75
through December 31, then $1.50 / $7.50 from January 1, 2027. Thinking tokens
count as output, and Google Search/Maps grounding has separate charges. These
are Google's direct API rates; Automnia hosted credit billing is separate. See
the [current Google pricing table](https://aistudio.google.com/docs/pricing) for
updates.

The current hosted OpenClaw route advertises a one-million-token context but
the relay deliberately caps a single generated response at 4,096 tokens by
default. The relay does not use Google's long-decode continuation lifecycle.
Direct Google and Vertex continue to use the existing `GenerateContent` and
`streamGenerateContent` request routes; calls that exceed the foreground segment
limits need the separate `v1beta1` continuation implementation. This checkout
does not silently switch endpoints during the concurrent Google Cloud migration.

## Model catalog

The offline catalog pins current fallback IDs for startup. When an account has
an authenticated provider configured, OpenClaw's live model listing remains the
authority for account-specific availability.

| Provider route | Offline model IDs | Runtime path |
| --- | --- | --- |
| OpenAI | `openai/gpt-6.2-astra`, `openai/gpt-6.2-sol` | OpenClaw's configured OpenAI API or Codex authentication route; tools stay in the Gateway runtime. |
| Automnia hosted relay | Swift, Balanced, Pro, Frontier IDs above | Existing configured relay origin with its OpenAI-compatible `/v1` route; relay credentials and entitlement checks remain the billing boundary. |
| Anthropic | `anthropic/claude-fable-5-2`, `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5`, `anthropic/claude-haiku-5-5` | Native OpenClaw Anthropic runtime and its model-specific thinking/tool contract. |
| Google Gemini API | `google/gemini-4-carbon`, `google/gemini-4-argon`, `google/gemini-4-hydrogen`, `google/gemini-3.8-flash` | Direct Google Generative Language endpoint and the existing Google API key/OAuth setup. |
| Google Vertex AI | `google-vertex/gemini-4-carbon`, `google-vertex/gemini-4-argon`, `google-vertex/gemini-4-hydrogen`, `google-vertex/gemini-3.8-flash` | Existing Vertex project, location, and ADC/IAM credentials. Regional model access remains Google Cloud controlled. |
| xAI | `xai/grok-4.7` | Bundled OpenClaw xAI provider uses its Responses API and existing xAI OAuth/API-key profiles. |
| DeepSeek | `deepseek/deepseek-flash`, `deepseek/deepseek-v4-pro` | OpenAI-compatible Chat Completions at `https://api.deepseek.com`; retired `deepseek-chat`, `deepseek-reasoner`, and V4 Flash aliases are excluded. |
| Mistral | `mistral/mistral-large-4-0` | OpenAI-compatible Chat Completions at `https://api.mistral.ai/v1`; the configured endpoint can be overridden. |
| Meta | `meta/muse-wonder-1.0`, `meta/muse-spark-1.3` | OpenAI-compatible Responses API at `https://api.meta.ai/v1`. |
| Qwen | `qwen/qwen4-max`, `qwen/qwen3.7-plus`, `qwen/qwen3.8-flash` | OpenAI-compatible Chat Completions at the international Standard endpoint; regional endpoint overrides are preserved. Qwen4 Max and Qwen3.8 Flash require Standard or Token Plan access. |
| Moonshot | `moonshot/kimi-k3.1-pro`, `moonshot/kimi-k3.1-pro-highspeed` | OpenAI-compatible Chat Completions at the international endpoint; regional endpoint overrides are preserved. |
| OpenRouter and other configured providers | Discovered at runtime | The catalog does not guess static IDs for account-dynamic catalogs; it uses the authenticated OpenClaw provider listing. |

Catalog presence does not claim that a credential is connected or that the
account can access every listed model. Unknown or missing credentials are not
fixed by substituting a different provider. The configured OpenAI-compatible
routes cover ordinary chat, streaming, and tool-call requests through
OpenClaw's generic adapters. Official OpenClaw provider plugins add native
discovery and provider-specific features; the external packages below match
the host version, but they are not installed by this catalog change.

| Optional provider plugin | Verified compatible release | Compatibility metadata |
| --- | --- | --- |
| `@openclaw/deepseek-provider` | `2026.11.5` | Host and plugin API `>=2026.11.5`; built against `2026.11.5`. |
| `@openclaw/mistral-provider` | `2026.11.5` | Host and plugin API `>=2026.11.5`; built against `2026.11.5`. |
| `@openclaw/meta-provider` | `2026.11.5` | Host and plugin API `>=2026.11.5`; built against `2026.11.5`. |
| `@openclaw/qwen-provider` | `2026.11.5` | Host and plugin API `>=2026.11.5`; built against `2026.11.5`. |
| `@openclaw/moonshot-provider` | `2026.11.5` | Host and plugin API `>=2026.11.5`; built against `2026.11.5`. |

These packages are external OpenClaw plugins. Automnia's generic provider
adapters do not depend on them for the documented text/chat routes; plugin
discovery, provider-specific reasoning handling, and richer media support remain
unavailable until an app-managed install is wired.

Google Gemini pickers expose only Gemini 3.8 Flash and the current Hydrogen,
Argon, and Carbon models. Superseded Gemini generations discovered in an
existing account catalog are hidden from new selections; the existing direct
API/Vertex request paths remain intact for the separate Cloud migration.

## Endpoint and authentication boundary

The code intentionally retains the endpoints already used during the separate
Cloud migration:

- Direct Gemini stays on `generativelanguage.googleapis.com/v1beta` and its
  existing `:streamGenerateContent` route.
- Vertex stays on the existing `aiplatform.googleapis.com/v1` or regional
  `-aiplatform.googleapis.com/v1` `:streamGenerateContent`/
  `:generateContent` route.
- The Automnia hosted provider keeps the configured relay origin and `/v1`
  path. Neither the origin nor API version is hard-coded over a deployment
  override.

Gemini API-key/OAuth access and Vertex ADC/IAM access are separate from
Automnia relay credentials. A successful Google CLI or browser login does not
prove that the app has an authorized provider profile, Google Cloud project
permission, or Automnia login. The code keeps these checks separate.

On November 17, 2026, bounded Vertex ADC `GenerateContent` probes for the four
current Google model IDs returned HTTP 403 `PERMISSION_DENIED` on
`aiplatform.endpoints.predict`; no model response was generated. The ADC
identity and project configuration were present, but request permission or
entitlement was insufficient. Account, project, and token values are omitted.

Google's current quickstarts prefer the Interactions API for background and
long-decode work. The existing GenerateContent routes remain in place for
ordinary requests; an Interactions migration must be a separate, tested change
because it has different request, continuation, and response lifecycle needs.

## Request rules and test boundary

- Gemini 3.8 and Gemini 4 omit unsupported/deprecated temperature, top-p,
  top-k, and candidate-count controls on the native generation paths.
- Hydrogen preserves `xhigh`; Argon and Carbon clamp extended levels to `high`.
- Thinking defaults are written into the hosted model configuration. Explicit
  per-agent or per-session settings remain higher priority; Telegram's
  `/think` override is session-scoped.
- Swift, Balanced, Pro, and Frontier resilience candidates stay inside the
  Automnia hosted billing boundary. Provider-native fallbacks stay within the
  selected provider family.
- Local verification can prove catalog filtering, entitlement gates, request
  shaping, thinking translation, and preservation of endpoint configuration.
  It cannot prove live provider access without successful authenticated calls
  against each account's model, project, region, and billing setup.

## Official model and API references

- [Gemini 4 Hydrogen model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-hydrogen) and [developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-hydrogen)
- [Gemini 4 Argon model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-argon) and [developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon)
- [Gemini 4 Carbon model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-carbon) and [developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-carbon)
- [Gemini 3.8 Flash API model list](https://ai.google.dev/gemini-api/docs/models)
- [Gemini 4 getting started and migration guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4) and [long decodes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-hydrogen#long_decodes)
- [GenerateContent REST reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/projects.locations.publishers.models/generateContent), [API versions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest), and [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [OpenClaw releases and full changelogs](https://docs.openclaw.ai/releases)
- [OpenClaw provider docs for DeepSeek](https://docs.openclaw.ai/providers/deepseek), [Mistral](https://docs.openclaw.ai/providers/mistral), [Meta](https://docs.openclaw.ai/providers/meta), [Qwen](https://docs.openclaw.ai/providers/qwen), and [Moonshot](https://docs.openclaw.ai/providers/moonshot)
- [OpenClaw external plugin release metadata: DeepSeek](https://registry.npmjs.org/@openclaw%2Fdeepseek-provider/2026.11.5), [Mistral](https://registry.npmjs.org/@openclaw%2Fmistral-provider/2026.11.5), [Meta](https://registry.npmjs.org/@openclaw%2Fmeta-provider/2026.11.5), [Qwen](https://registry.npmjs.org/@openclaw%2Fqwen-provider/2026.11.5), and [Moonshot](https://registry.npmjs.org/@openclaw%2Fmoonshot-provider/2026.11.5)
- [Mistral Large 4 model card](https://docs.mistral.ai/models/mistral-large-4-0) and [reasoning/API details](https://docs.mistral.ai/inference/conversations/reasoning)
- [Qwen current model list](https://www.alibabacloud.com/help/en/model-studio/models) and [text generation API capabilities](https://www.alibabacloud.com/help/en/model-studio/text-generation-model)
