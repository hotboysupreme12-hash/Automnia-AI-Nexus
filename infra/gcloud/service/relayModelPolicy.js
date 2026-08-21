const DEFAULT_AUTOMNIA_RELAY_MODEL = 'gemini-3.7-flash';
const DEFAULT_AUTOMNIA_RELAY_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];

function normalizeRelayModel(value) {
  return String(value || '').trim().toLowerCase().replace(/^automnia-cloud\//, '');
}

function configuredRelayModels(primary, fallbackValue) {
  const normalizedPrimary = normalizeRelayModel(primary) || DEFAULT_AUTOMNIA_RELAY_MODEL;
  const rawFallbacks = String(fallbackValue || '').trim();
  const fallbacks = (rawFallbacks ? rawFallbacks.split(',') : DEFAULT_AUTOMNIA_RELAY_FALLBACK_MODELS)
    .map(normalizeRelayModel)
    .filter(Boolean)
    .filter((model) => model !== normalizedPrimary);
  return [normalizedPrimary, ...new Set(fallbacks)];
}

export const automniaRelayModels = Object.freeze(configuredRelayModels(
  process.env.AUTOMNIA_RELAY_MODEL,
  process.env.AUTOMNIA_RELAY_FALLBACK_MODELS,
));
export const automniaRelayModel = automniaRelayModels[0] || DEFAULT_AUTOMNIA_RELAY_MODEL;
export const automniaRelayFallbackModels = Object.freeze(automniaRelayModels.slice(1));

/**
 * Resolve a client model only against the hosted relay allowlist. OpenClaw
 * normally sends the bare provider model; accepting the qualified Automnia
 * form keeps older Gateway configs compatible without allowing arbitrary
 * provider or Vertex model IDs through the billing proxy.
 */
export function resolveAutomniaRelayModel(requestedModel, availableModels = automniaRelayModels) {
  const requested = normalizeRelayModel(requestedModel);
  if (!requested) return availableModels[0] || null;
  return availableModels.find((model) => normalizeRelayModel(model) === requested) || null;
}

export function isAutomniaRelayModelAllowed(model, availableModels = automniaRelayModels) {
  return Boolean(resolveAutomniaRelayModel(model, availableModels));
}

