import type { PluginEntry } from '../../api/plugins'

export type { PluginConfigField } from '../../api/plugins'
export type PluginPageEntry = PluginEntry

export type PluginPageStateKey =
  | 'configured'
  | 'disabled'
  | 'enabled'
  | 'failed'
  | 'loaded'
  | 'managed'
  | 'missing-auth'
  | 'needs-setup'
  | 'unavailable'

export type PluginPageState = {
  key: PluginPageStateKey
  label: string
  tone: 'configured' | 'disabled' | 'enabled' | 'failed' | 'setup' | 'unavailable'
}

export const PLUGIN_FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'disabled', label: 'Disabled' },
] as const

export type PluginFilter = (typeof PLUGIN_FILTERS)[number]['id']

const STATUS_CLASSES: Record<PluginPageState['tone'], string> = {
  configured: 'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100',
  disabled: 'border-white/[0.08] bg-white/[0.03] text-slate-400',
  enabled: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200',
  failed: 'border-rose-400/25 bg-rose-400/[0.07] text-rose-100',
  setup: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-100',
  unavailable: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-100',
}

function normalizedStatus(plugin: PluginPageEntry) {
  return plugin.status.trim().toLowerCase()
}

function hasMissingAuth(plugin: PluginPageEntry) {
  return plugin.configFields.some((field) => {
    if (!field.required || field.present) return false
    if (field.providerId || field.secret || field.envVar) return true
    return /(?:api\s*key|auth|credential|secret|token)/i.test(`${field.key} ${field.label}`)
  })
}

export function pluginPageState(plugin: PluginPageEntry): PluginPageState {
  const status = normalizedStatus(plugin)

  if (status === 'failed') return { key: 'failed', label: 'failed', tone: 'failed' }
  if (status === 'unavailable') return { key: 'unavailable', label: 'unavailable', tone: 'unavailable' }
  if (!plugin.enabled && plugin.installable) return { key: 'disabled', label: 'available', tone: 'disabled' }
  if (!plugin.enabled || status === 'disabled') return { key: 'disabled', label: 'disabled', tone: 'disabled' }
  if (plugin.needsSetup && hasMissingAuth(plugin)) return { key: 'missing-auth', label: 'missing auth', tone: 'setup' }
  if (status === 'configured') return { key: 'configured', label: 'configured', tone: 'configured' }
  if (status === 'managed') return { key: 'managed', label: 'managed', tone: 'configured' }
  if (plugin.needsSetup) return { key: 'needs-setup', label: 'setup', tone: 'setup' }
  if (status === 'loaded') return { key: 'loaded', label: 'loaded', tone: 'enabled' }
  return { key: 'enabled', label: plugin.enabled ? 'enabled' : plugin.status || 'disabled', tone: 'enabled' }
}

export function pluginStatusClass(plugin: PluginPageEntry) {
  return STATUS_CLASSES[pluginPageState(plugin).tone]
}

export function pluginMatchesFilter(plugin: PluginPageEntry, filter: PluginFilter) {
  if (filter === 'all') return true
  const state = pluginPageState(plugin)
  const needsAttention = plugin.needsSetup || state.key === 'failed' || state.key === 'unavailable' || state.key === 'missing-auth'
  if (filter === 'active') return plugin.enabled || needsAttention
  if (filter === 'attention') return needsAttention
  if (filter === 'enabled') return plugin.enabled
  return state.key === filter
}

export function summarizePluginPageStates(plugins: PluginPageEntry[]) {
  const summary = {
    configured: 0,
    disabled: 0,
    enabled: 0,
    failed: 0,
    missingAuth: 0,
    setup: 0,
    unavailable: 0,
  }

  for (const plugin of plugins) {
    const state = pluginPageState(plugin)
    if (plugin.enabled) summary.enabled += 1
    if (plugin.needsSetup) summary.setup += 1
    if (state.key === 'configured' || state.key === 'managed') summary.configured += 1
    if (state.key === 'disabled') summary.disabled += 1
    if (state.key === 'failed') summary.failed += 1
    if (state.key === 'missing-auth') summary.missingAuth += 1
    if (state.key === 'unavailable') summary.unavailable += 1
  }

  return summary
}
