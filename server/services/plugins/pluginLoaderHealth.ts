export type PluginLoaderHealthInput = {
  id: string
  enabled?: boolean
  runtimeLoaded?: boolean
  status?: string
  missingDependencies?: unknown
  loaderErrorSummary?: string
}

export type PluginLoaderFailureProjection = {
  pluginId: string
  failureClass: 'loader_error'
  summary: string
  recoveryHint: string
  missingDependencyCount: number
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,79}$/i
const MAX_PROJECTED_PLUGIN_FAILURES = 12

/**
 * Build a credential-free app health projection from plugin inventory. Raw
 * loader text and dependency values are intentionally used only as signals;
 * they never cross into Doctor or Runtime Monitor output.
 */
export function projectPluginLoaderFailures(plugins: readonly PluginLoaderHealthInput[]): PluginLoaderFailureProjection[] {
  const failures: PluginLoaderFailureProjection[] = []
  for (const plugin of plugins) {
    const pluginId = typeof plugin.id === 'string' ? plugin.id.trim().toLowerCase() : ''
    if (!PLUGIN_ID_PATTERN.test(pluginId) || (!plugin.enabled && !plugin.runtimeLoaded)) continue
    const missingDependencyCount = Array.isArray(plugin.missingDependencies)
      ? Math.min(20, plugin.missingDependencies.length)
      : 0
    const statusFailed = typeof plugin.status === 'string' && /\b(?:broken|error|failed|unavailable)\b/i.test(plugin.status)
    const loaderFailed = Boolean(plugin.loaderErrorSummary?.trim()) || statusFailed || missingDependencyCount > 0
    if (!loaderFailed) continue
    const missing = missingDependencyCount > 0
    failures.push({
      pluginId,
      failureClass: 'loader_error',
      summary: missing
        ? `Plugin ${pluginId} failed to load; ${missingDependencyCount} declared ${missingDependencyCount === 1 ? 'dependency is' : 'dependencies are'} unavailable.`
        : `Plugin ${pluginId} reported a loader failure before activation.`,
      recoveryHint: missing
        ? 'Open Plugins, inspect the declared dependencies, then update or reinstall the plugin from its verified source.'
        : 'Open Plugins, inspect this plugin runtime, and use its targeted loader repair action; rerun Doctor to verify recovery.',
      missingDependencyCount,
    })
    if (failures.length >= MAX_PROJECTED_PLUGIN_FAILURES) break
  }
  return failures
}

export function pluginLoaderDoctorProjection(failures: readonly PluginLoaderFailureProjection[]) {
  return {
    ok: failures.length === 0,
    evidence: failures.length
      ? `${failures.length} enabled plugin loader failure(s): ${failures.slice(0, 3).map((failure) => failure.summary).join(' | ')}`
      : 'No enabled plugin loader failures reported.',
    repairAction: failures[0]?.recoveryHint,
  }
}
