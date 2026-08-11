// Stable public origin for licensing, Shopify webhooks, and hosted-credit AI.
// Project-specific run.app URLs are deployment details and must never be
// compiled into a desktop release. Environment overrides remain available for
// local development and emergency recovery.
export const AUTOMNIA_PUBLIC_CLOUD_URL = 'https://api.automnia.ai'

export function automniaCloudBaseUrl(override?: string) {
  const value = (override || AUTOMNIA_PUBLIC_CLOUD_URL).trim().replace(/\/+$/, '')
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Automnia Cloud URL must be an HTTPS origin without embedded credentials.')
  }
  return parsed.toString().replace(/\/+$/, '')
}
