import type { PluginControlEntry } from './pluginInventoryService'

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
