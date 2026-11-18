const DEFAULT_AUTOMNIA_RELAY_MODEL = 'gemini-4-hydrogen';
const DEFAULT_AUTOMNIA_RELAY_FALLBACK_MODELS = ['gemini-3.8-flash'];
const DEFAULT_AUTOMNIA_RELAY_SELECTABLE_MODELS = ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.8-flash'];
const LEGACY_AUTOMNIA_RELAY_MODELS = new Set(['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash']);

function normalizeRelayModel(value) {
  return String(value || '').trim().toLowerCase().replace(/^automnia-cloud\//, '');
}

function configuredRelayModels(primary, fallbackValue) {
  const requestedPrimary = normalizeRelayModel(primary);
  const normalizedPrimary = !requestedPrimary || LEGACY_AUTOMNIA_RELAY_MODELS.has(requestedPrimary)
    ? DEFAULT_AUTOMNIA_RELAY_MODEL
    : requestedPrimary;
  const rawFallbacks = String(fallbackValue || '').trim();
  const fallbacks = (rawFallbacks ? rawFallbacks.split(',') : DEFAULT_AUTOMNIA_RELAY_FALLBACK_MODELS)
    .map(normalizeRelayModel)
    .filter(Boolean)
    .filter((model) => !LEGACY_AUTOMNIA_RELAY_MODELS.has(model))
    .filter((model) => model !== normalizedPrimary);
  return [normalizedPrimary, ...new Set(fallbacks)];
}

function configuredRelaySelectableModels(selectableValue, operationalModels) {
  const configured = String(selectableValue || '').trim();
  const requested = configured
    ? configured.split(',').map(normalizeRelayModel).filter(Boolean).filter((model) => !LEGACY_AUTOMNIA_RELAY_MODELS.has(model))
    : [];
  return [...new Set([
    ...requested,
    ...DEFAULT_AUTOMNIA_RELAY_SELECTABLE_MODELS,
    ...operationalModels,
  ])];
}

export const automniaRelayModels = Object.freeze(configuredRelayModels(
  process.env.AUTOMNIA_RELAY_MODEL,
  process.env.AUTOMNIA_RELAY_FALLBACK_MODELS,
));
export const automniaRelayModel = automniaRelayModels[0] || DEFAULT_AUTOMNIA_RELAY_MODEL;
export const automniaRelayFallbackModels = Object.freeze(automniaRelayModels.slice(1));
export const automniaRelaySelectableModels = Object.freeze(configuredRelaySelectableModels(
  process.env.AUTOMNIA_RELAY_SELECTABLE_MODELS,
  automniaRelayModels,
));

/**
 * Resolve a client model only against the hosted relay allowlist. OpenClaw
 * normally sends the bare provider model; accepting the qualified Automnia
 * form keeps older Gateway configs compatible without allowing arbitrary
 * provider or Vertex model IDs through the billing proxy.
 */
export function resolveAutomniaRelayModel(requestedModel, availableModels = automniaRelaySelectableModels) {
  const requested = normalizeRelayModel(requestedModel);
  if (!requested) {
    return availableModels.find((model) => normalizeRelayModel(model) === normalizeRelayModel(automniaRelayModel))
      || availableModels[0]
      || null;
  }
  return availableModels.find((model) => normalizeRelayModel(model) === requested) || null;
}

export function isAutomniaRelayModelAllowed(model, availableModels = automniaRelaySelectableModels) {
  return Boolean(resolveAutomniaRelayModel(model, availableModels));
}

export function automniaRelayModelsForRequest(requestedModel) {
  const resolved = resolveAutomniaRelayModel(requestedModel);
  if (!resolved) return [];
  return [resolved, ...automniaRelayModels.filter((model) => model !== resolved)];
}
