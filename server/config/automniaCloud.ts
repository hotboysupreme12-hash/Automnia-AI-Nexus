import { spawnSync } from 'node:child_process'

// Stable public origin for licensing, Shopify webhooks, and hosted-credit AI.
// Project-specific run.app URLs are deployment details and must never be
// compiled into a desktop release. Environment overrides remain available for
// local development and emergency recovery.
export const AUTOMNIA_PUBLIC_CLOUD_URL = 'https://automnia-shopify-provisioner-336625531977.us-east1.run.app'

export function automniaCloudBaseUrl(override?: string) {
  const value = (override || AUTOMNIA_PUBLIC_CLOUD_URL).trim().replace(/\/+$/, '')
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Automnia Cloud URL must be an HTTPS origin without embedded credentials.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function persistedWindowsRelayOverride() {
  if (process.platform !== 'win32') return null
  const query = spawnSync('reg.exe', ['QUERY', 'HKCU\\Environment', '/v', 'AUTOMNIA_CLOUD_RELAY_URL'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1_500,
  })
  if (query.status !== 0 || typeof query.stdout !== 'string') return null
  const line = query.stdout.split(/\r?\n/).find((candidate) => /\bAUTOMNIA_CLOUD_RELAY_URL\b/i.test(candidate))
  const match = line?.match(/\bREG_\w+\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

/**
 * Resolves the desktop's hosted-credit route without compiling a Cloud Run
 * project URL into the app. On Windows, a newly persisted user variable is
 * not inherited by already-running Explorer/Codex parents, so read it from
 * the user environment registry as the reliable fallback.
 */
export function automniaCloudRuntimeBaseUrl(fallback?: string) {
  const processOverride = process.env.AUTOMNIA_CLOUD_RELAY_URL?.trim()
  return automniaCloudBaseUrl(processOverride || persistedWindowsRelayOverride() || fallback || AUTOMNIA_PUBLIC_CLOUD_URL)
}
