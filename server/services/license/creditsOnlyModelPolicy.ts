export const AUTOMNIA_CREDITS_PROVIDER_ID = 'automnia-cloud'
export const AUTOMNIA_CREDITS_MODEL_ID = `${AUTOMNIA_CREDITS_PROVIDER_ID}/gemini-3.7-flash`

export const CREDITS_ONLY_MODEL_ACCESS_MESSAGE =
  'Starter Subscription is locked to Automnia credits only. Connect your own provider or choose a provider model after upgrading to a BYOK-eligible tier.'

export type CreditsOnlyModelSelection = {
  primary: string
  fallbacks?: string[]
}

export function isAutomniaCreditsModelId(value: unknown) {
  return typeof value === 'string' && value.trim().toLowerCase() === AUTOMNIA_CREDITS_MODEL_ID
}

export function creditsOnlyModelSelection(): CreditsOnlyModelSelection {
  return { primary: AUTOMNIA_CREDITS_MODEL_ID }
}

export function filterCreditsOnlyModels<T extends { id?: unknown }>(models: T[]) {
  return models.filter((model) => isAutomniaCreditsModelId(model.id))
}
