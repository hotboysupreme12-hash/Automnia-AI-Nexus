import type { PluginControlEntry } from './pluginInventoryService'

export const OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC = 'npm:@openclaw/codex@2026.11.6'

function compareCodexVersions(leftVersion: string, rightVersion: string): number | null {
  const parse = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    return match ? match.slice(1).map(Number) : null
  }
  const left = parse(leftVersion)
  const right = parse(rightVersion)
  if (!left || !right) return null
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function codexPluginVersionNeedsUpdate(version: string | undefined, targetVersion: string) {
  if (!version) return false
  return compareCodexVersions(version, targetVersion) === -1
}

/** If all known managed Codex projects predate the target, the loaded entry is stale. */
export function codexProjectsNeedUpdate(versions: string[], targetVersion: string) {
  return versions.length > 0 && versions.every((version) => compareCodexVersions(version, targetVersion) === -1)
}

export function newerInstalledCodexVersion(versions: string[], targetVersion: string): string | undefined {
  return versions.find((version) => {
    const comparison = compareCodexVersions(version, targetVersion)
    // Unknown versions cannot safely justify replacing an installed package.
    return comparison === null ? Boolean(version) : comparison > 0
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
  const targetVersion = OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC.slice(OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC.lastIndexOf('@') + 1)
  return codexPluginVersionNeedsUpdate(plugin.version, targetVersion) ||
    plugin.missingDependencies.length > 0 ||
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
