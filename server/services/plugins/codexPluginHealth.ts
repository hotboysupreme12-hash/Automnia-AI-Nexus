import type { PluginControlEntry } from './pluginInventoryService'

export const OFFICIAL_CODEX_PLUGIN_INSTALL_SPEC = 'npm:@openclaw/codex@2026.11.6'

export type CodexDoctorCommandResult = {
  code: number
  stdout: string
  stderr: string
}

export type CodexDoctorRouteCheckResult = {
  ok: boolean
  verified: boolean
  findingCount: number
  warning?: string
}

function jsonValuesFromText(input: string): unknown[] {
  // ANSI control bytes are the purpose of this escape; allow this one regex.
  // eslint-disable-next-line no-control-regex
  const text = input.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim()
  if (!text) return []
  try {
    return [JSON.parse(text) as unknown]
  } catch {
    // OpenClaw may include an error envelope after a valid doctor report. Keep
    // scanning complete JSON values so the route result remains authoritative.
  }

  const values: unknown[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue
    const closers: string[] = []
    let inString = false
    let escaped = false
    for (let end = start; end < text.length; end += 1) {
      const char = text[end]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') closers.push('}')
      else if (char === '[') closers.push(']')
      else if (char === '}' || char === ']') {
        if (!closers.length || closers.pop() !== char) break
        if (!closers.length) {
          try {
            values.push(JSON.parse(text.slice(start, end + 1)) as unknown)
          } catch {
            // Ignore non-JSON braces in CLI diagnostics and keep looking.
          }
          start = end
          break
        }
      }
    }
  }
  return values
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function codexDoctorReportFromResult(result: CodexDoctorCommandResult) {
  const values = [...jsonValuesFromText(result.stdout), ...jsonValuesFromText(result.stderr)]
  return values.find((value) => (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    typeof value.checksRun === 'number' &&
    Array.isArray(value.findings)
  )) as Record<string, unknown> | undefined
}

/**
 * The targeted route check is the authority for Codex route readiness. Doctor
 * can return a healthy JSON report while a wrapper reports a nonzero process
 * status for unrelated state-inventory work; that must not block user turns.
 */
export function evaluateCodexDoctorRouteCheck(result: CodexDoctorCommandResult): CodexDoctorRouteCheckResult {
  const report = codexDoctorReportFromResult(result)
  if (report) {
    const findings = report.findings as unknown[]
    const findingCount = findings.length
    const checksRun = report.checksRun as number
    const ok = report.ok === true && checksRun > 0 && findingCount === 0
    return {
      ok,
      verified: true,
      findingCount: findingCount || (report.ok === false || checksRun <= 0 ? 1 : 0),
      ...(ok && result.code !== 0
        ? { warning: `OpenClaw doctor returned a healthy Codex route report but exited ${result.code}; continuing from the verified report.` }
        : {}),
    }
  }

  const hasCliError = [...jsonValuesFromText(result.stdout), ...jsonValuesFromText(result.stderr)].some((value) => (
    isRecord(value) && value.ok === false && isRecord(value.error)
  ))
  return {
    ok: result.code === 0 && !hasCliError,
    verified: false,
    findingCount: hasCliError ? 1 : 0,
  }
}

function runtimeIdIsCodex(value: unknown) {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'codex'
  return isRecord(value) && typeof value.id === 'string' && value.id.trim().toLowerCase() === 'codex'
}

function selectedModelMatchesConfigModel(selectedModelIds: string[], candidate: unknown) {
  if (typeof candidate !== 'string' || !candidate.trim()) return false
  const normalizedCandidate = candidate.trim().toLowerCase()
  return selectedModelIds.some((selectedModelId) => {
    const normalizedSelected = selectedModelId.trim().toLowerCase()
    return normalizedSelected === normalizedCandidate || (
      normalizedSelected.startsWith('openai/') && normalizedSelected.slice('openai/'.length) === normalizedCandidate
    )
  })
}

/** Resolve whether this agent's selected primary or fallback model needs Codex. */
export function selectedModelsNeedCodexRuntime(
  selectedModelIds: string[],
  options: {
    openAiProviderRuntime?: unknown
    agentModelRuntimeMaps?: unknown[]
    openAiModels?: unknown[]
  } = {},
) {
  const openAiSelectedModels = selectedModelIds.filter((modelId) => modelId.trim().toLowerCase().startsWith('openai/'))
  if (!openAiSelectedModels.length) return false
  if (runtimeIdIsCodex(options.openAiProviderRuntime)) return true

  const maps = options.agentModelRuntimeMaps || []
  for (const models of maps) {
    if (!isRecord(models)) continue
    for (const [modelId, model] of Object.entries(models)) {
      if (runtimeIdIsCodex(isRecord(model) ? model.agentRuntime : undefined) && selectedModelMatchesConfigModel(openAiSelectedModels, modelId)) {
        return true
      }
    }
  }

  return (options.openAiModels || []).some((model) => {
    if (!isRecord(model) || !runtimeIdIsCodex(model.agentRuntime)) return false
    return ['id', 'modelId', 'model', 'name', 'alias'].some((key) => (
      selectedModelMatchesConfigModel(openAiSelectedModels, model[key])
    ))
  })
}

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
