import type { PluginControlEntry } from './pluginInventoryService'

export const OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC = 'npm:@openclaw/codex@2026.11.6'

export function newerInstalledCodexVersion(versions: string[], targetVersion: string): string | undefined {
  const parse = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    return match ? match.slice(1).map(Number) : null
  }
  const target = parse(targetVersion)
  // An unknown target cannot safely justify replacing an installed package.
  if (!target) return versions.find(Boolean)
  return versions.find((version) => {
    const current = parse(version)
    if (!current) return Boolean(version)
    for (let index = 0; index < 3; index += 1) {
      if (current[index] !== target[index]) return current[index] > target[index]
    }
    return false
  })
}

/** Wait for the managed Gateway before interpreting runtime load status. */
export async function requireGatewayForCodexPreflight(options: {
  isHealthy: () => Promise<boolean>
  waitForStartup: () => Promise<{ waited: boolean; healthy: boolean }>
}) {
  if (await options.isHealthy()) return
  const startup = await options.waitForStartup()
  if (startup.healthy || await options.isHealthy()) return
  throw new Error('OpenClaw Gateway is not ready yet. Codex plugin repair was deferred; try again when the Gateway is ready.')
}

const CODEX_PLUGIN_FAILURE_STATUS = /\b(?:degraded|failed|failure|error|invalid|missing|not\s+loaded|unavailable)\b/i

/**
 * Treat a Codex entry as unhealthy when OpenClaw has reported a load failure,
 * a missing dependency, or an explicit runtime-load failure. An installed
 * package with one of these states must not satisfy the startup preflight: the
 * control plane should repair it from the pinned managed/bundled source.
 */
export function codexPluginNeedsRepair(plugin: PluginControlEntry | undefined) {
  if (!plugin) return false
  return plugin.missingDependencies.length > 0 ||
    plugin.runtimeLoaded === false ||
    CODEX_PLUGIN_FAILURE_STATUS.test(plugin.status.trim())
}

export function codexPluginAvailableForRuntime(
  plugin: PluginControlEntry | undefined,
  bundledCodexSource = '',
) {
  if (!plugin) return Boolean(bundledCodexSource)
  if (codexPluginNeedsRepair(plugin)) return false
  if (plugin.enabled !== true || plugin.configuredEnabled === false) return false
  if (plugin.runtimeLoaded === true || /^(?:loaded|ready|active|enabled)$/i.test(plugin.status.trim())) return true

  // A real installed entry can be runtime-ready before OpenClaw exposes its
  // optional runtimeLoaded field. Bundled/config-only catalog entries still
  // need a known bundled source to be considered installable.
  const origin = plugin.origin.trim().toLowerCase()
  if (!['config', 'managed', 'official-catalog'].includes(origin)) return true
  return Boolean(bundledCodexSource)
}
