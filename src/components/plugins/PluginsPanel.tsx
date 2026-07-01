import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchPlugins,
  inspectOpenClawPluginRuntime,
  installOpenClawPlugin,
  pluginRequestError,
  restartPluginGateway,
  runOpenClawPluginCommand,
  savePluginSetup,
  searchOpenClawPlugins,
  setPluginEnabled,
  setupClawTalkPlugin,
  uninstallOpenClawPlugin,
  updateAllOpenClawPlugins,
  updateOpenClawPlugin,
  type PluginApiPayload,
  type PluginCommandResult,
  type PluginEntry,
  type PluginRestartResponse,
  type PluginRuntimeInspect,
  type PluginSearchResult,
  type PluginsResponse,
} from '../../api/plugins'
import { ActionStatusBanner } from '../common/ActionStatusBanner'
import {
  PLUGIN_FILTERS,
  pluginMatchesFilter,
  pluginPageState,
  pluginStatusClass,
  summarizePluginPageStates,
  type PluginFilter,
} from './pluginStateProjection'

type PluginBusyAction = 'toggle' | 'refresh' | 'update' | 'inspect' | 'uninstall' | 'restart'

type PluginInspectState = {
  plugin: PluginEntry
  inspect: PluginRuntimeInspect
}

type OpenClawCommandState = {
  command: string
  result: PluginCommandResult
  ok: boolean
}

let pluginsPanelCache: PluginsResponse | null = null

const PLUGIN_NOTICE_MAX_CHARS = 360

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueNoticeMessages(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return false
    seen.add(trimmed)
    return true
  })
}

function diagnosticMessagesFromJson(value: unknown): string[] {
  const messages: string[] = []
  const addDiagnostic = (entry: unknown) => {
    if (!isPlainRecord(entry)) return
    const level = stringValue(entry, ['level', 'severity', 'type']).toLowerCase()
    if (level && !/\b(?:warn|warning|error|fail|failed)\b/i.test(level)) return
    const message = stringValue(entry, ['message', 'detail', 'reason', 'summary', 'error'])
    if (!message) return
    const code = stringValue(entry, ['code'])
    messages.push(code ? `${message} (${code})` : message)
  }

  if (Array.isArray(value)) {
    value.forEach(addDiagnostic)
  } else if (isPlainRecord(value)) {
    for (const key of ['diagnostics', 'warnings', 'errors']) {
      const nested = value[key]
      if (Array.isArray(nested)) nested.forEach(addDiagnostic)
    }
    for (const key of ['registry', 'pluginRegistry', 'meta']) {
      const nested = value[key]
      if (!isPlainRecord(nested)) continue
      for (const nestedKey of ['diagnostics', 'warnings', 'errors']) {
        const entries = nested[nestedKey]
        if (Array.isArray(entries)) entries.forEach(addDiagnostic)
      }
    }
    addDiagnostic(value)
  }

  return uniqueNoticeMessages(messages)
}

function compactPluginNoticeText(value: string, maxLength = PLUGIN_NOTICE_MAX_CHARS) {
  const compact = value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3).trim()}...` : compact
}

function formatPluginCliWarning(value?: string) {
  const text = value?.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as unknown
    const messages = diagnosticMessagesFromJson(parsed)
    if (messages.length) return compactPluginNoticeText(messages.slice(0, 2).join(' '))
    if (isPlainRecord(parsed) && Array.isArray(parsed.plugins)) return ''
  } catch {
    // Plain warning text is handled below.
  }
  if (/^\s*(?:\[|\{)/.test(text)) return ''
  return compactPluginNoticeText(text)
}

function responseNotice(payload: PluginsResponse) {
  const warning = formatPluginCliWarning(payload.cliError)
  return warning ? `Plugin list loaded with CLI warning: ${warning}` : ''
}

function compactList(values: string[], fallback: string) {
  if (!values.length) return fallback
  const visible = values.slice(0, 3).join(', ')
  return values.length > 3 ? `${visible} +${values.length - 3}` : visible
}

function pluginInitials(plugin: PluginEntry) {
  const source = plugin.name || plugin.id
  const letters = source
    .replace(/^@openclaw\//, '')
    .split(/[\s._/-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return letters || plugin.id.slice(0, 2).toUpperCase()
}

function pluginsWithToggle(plugins: PluginEntry[], pluginId: string, enabled: boolean) {
  return plugins.map((entry) =>
    entry.id === pluginId
      ? {
          ...entry,
          enabled,
          configuredEnabled: enabled,
          status: enabled ? 'enabled' : 'disabled',
        }
      : entry,
  )
}

function updatePluginsPanelCache(plugins: PluginEntry[], payload?: PluginsResponse) {
  pluginsPanelCache = {
    ...(pluginsPanelCache || {}),
    plugins,
    configPath: payload?.configPath ?? pluginsPanelCache?.configPath,
    cliError: payload?.cliError,
    cache: payload?.cache ?? pluginsPanelCache?.cache,
  }
}

function restartNotice(restart?: PluginRestartResponse) {
  const detail = restart?.detail?.toLowerCase() || ''
  if (detail.includes('hot reload') || detail.includes('not required')) return 'gateway hot reload requested'
  if (restart?.scheduled) return 'gateway restart queued'
  if (restart?.restarted) return 'gateway checked'
  return 'gateway restart skipped'
}

function commandNotice(payload: PluginApiPayload, fallback: string) {
  const command = payload.command?.command
  return command ? `${fallback} (${command}).` : fallback
}

function commandOutputText(result: PluginCommandResult | null | undefined) {
  if (!result) return ''
  return result.output || [result.stdout, result.stderr].filter(Boolean).join('\n') || `Exited ${result.code}.`
}

function setupFieldsForPlugin(plugin: PluginEntry) {
  return plugin.configFields
    .filter((field) => field.acceptsDirectSave)
    .sort((a, b) => Number(b.required && !b.present) - Number(a.required && !a.present))
    .slice(0, 6)
}

function ClawTalkOperationsCard({ plugin }: { plugin: PluginEntry }) {
  const apiKeyConfigured = plugin.configFields.some((field) => field.key === 'apiKey' && field.present)
  const channelSummary = compactList(plugin.channels, 'none')
  const runtimeState = plugin.runtimeLoaded ? 'loaded' : plugin.enabled ? 'pending' : 'off'
  const statusItems = [
    { label: 'Plugin', value: plugin.enabled ? 'enabled' : 'disabled', tone: plugin.enabled ? 'success' : 'neutral' },
    { label: 'Runtime', value: runtimeState, tone: plugin.runtimeLoaded ? 'success' : plugin.enabled ? 'warn' : 'neutral' },
    { label: 'API key', value: apiKeyConfigured ? 'stored' : 'missing', tone: apiKeyConfigured ? 'success' : 'warn' },
    { label: 'Channel', value: channelSummary, tone: plugin.channels.length ? 'success' : 'neutral' },
    { label: 'Restart', value: plugin.restartRequired ? 'needed' : 'clear', tone: plugin.restartRequired ? 'warn' : 'success' },
  ]

  return (
    <div className="md:col-span-4 rounded-md border border-cyan-300/10 bg-cyan-300/[0.025] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.10em] text-cyan-200/80">ClawTalk Ops</span>
        {statusItems.map((item) => (
          <span
            key={item.label}
            data-tone={item.tone}
            className="rounded-md border border-white/[0.07] bg-black/20 px-2 py-1 text-[9px] font-semibold uppercase text-slate-300 data-[tone=success]:border-emerald-300/20 data-[tone=success]:text-emerald-200 data-[tone=warn]:border-amber-300/20 data-[tone=warn]:text-amber-200"
            title={`${item.label}: ${item.value}`}
          >
            {item.label} {item.value}
          </span>
        ))}
      </div>
    </div>
  )
}

function PluginRow({
  plugin,
  busyAction,
  expanded,
  onToggle,
  onRefresh,
  onSetup,
  onManage,
  onUpdate,
  onInspect,
  onRestart,
  onUninstall,
}: {
  plugin: PluginEntry
  busyAction: PluginBusyAction | null
  expanded: boolean
  onToggle: (plugin: PluginEntry) => void
  onRefresh: (plugin: PluginEntry) => void
  onSetup: (plugin: PluginEntry) => void
  onManage: (plugin: PluginEntry) => void
  onUpdate: (plugin: PluginEntry) => void
  onInspect: (plugin: PluginEntry) => void
  onRestart: (plugin: PluginEntry) => void
  onUninstall: (plugin: PluginEntry) => void
}) {
  const primaryGuidance = plugin.guidance[0] || (plugin.enabled ? 'Ready after gateway refresh.' : 'Disabled.')
  const busy = Boolean(busyAction)
  const toggleLabel = plugin.enabled ? 'Stop' : 'Start'
  const toggleBusyLabel = plugin.enabled ? 'Stopping' : 'Starting'
  const statusState = pluginPageState(plugin)
  return (
    <article
      className="dy-plugin-row grid gap-3 rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-3 transition hover:border-white/[0.10] hover:bg-white/[0.026] md:grid-cols-[minmax(0,1.4fr)_minmax(100px,0.55fr)_minmax(120px,0.6fr)_auto]"
    >
      <div className="flex min-w-0 gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.035] text-[10px] font-bold text-cyan-100">
          {plugin.icon ? (
            <img src={plugin.icon} alt="" className="h-5 w-5 object-contain" loading="lazy" />
          ) : (
            <span>{pluginInitials(plugin)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-[13px] font-bold text-slate-100">{plugin.name}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase ${pluginStatusClass(plugin)}`}>
              {statusState.label}
            </span>
            <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[8px] font-semibold uppercase text-slate-500">
              {plugin.category}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-500">{plugin.id} / {plugin.origin}</p>
          <p className="mt-1 line-clamp-1 text-[12px] text-slate-400">{plugin.description}</p>
        </div>
      </div>

      <div className="min-w-0 text-[11px]">
        <p className="text-slate-600">Surfaces</p>
        <p className="truncate font-semibold text-slate-300">
          {compactList([...plugin.commands, ...plugin.providers, ...plugin.channels], 'none')}
        </p>
      </div>

      <div className="min-w-0 text-[11px]">
        <p className={plugin.needsSetup ? 'text-amber-300/80' : 'text-slate-600'}>{plugin.needsSetup ? 'Action' : 'State'}</p>
        <p className={`truncate font-semibold ${plugin.needsSetup ? 'text-amber-100' : 'text-slate-300'}`}>{primaryGuidance}</p>
      </div>

      <div className="dy-plugin-row-actions flex shrink-0 items-center justify-end gap-2">
        {plugin.needsSetup && (
          <button
            type="button"
            onClick={() => onSetup(plugin)}
            disabled={busy}
            className="dy-plugin-row-action dy-plugin-row-setup h-8 rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-300/[0.11] disabled:cursor-not-allowed disabled:opacity-50"
            title={`Set up ${plugin.name}`}
          >
            Setup
          </button>
        )}
        <button
          type="button"
          onClick={() => onRefresh(plugin)}
          disabled={busy}
          className="dy-plugin-row-action dy-plugin-row-refresh h-8 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          title={`Refresh ${plugin.name}`}
        >
          <svg aria-hidden="true" className="dy-plugin-row-action-svg" viewBox="0 0 16 16">
            <path d="M13.2 5.7A5.4 5.4 0 0 0 3.3 4L2.2 5.8H5" />
            <path d="M2.8 10.3A5.4 5.4 0 0 0 12.7 12l1.1-1.8H11" />
          </svg>
          {busyAction === 'refresh' ? 'Refreshing' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => onToggle(plugin)}
          disabled={busy}
          className={`dy-plugin-row-action dy-plugin-row-power h-8 rounded-md border px-3 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${plugin.enabled ? 'is-stop' : 'is-start'}`}
          title={plugin.enabled ? `Stop and disable ${plugin.name}` : `Start ${plugin.name}`}
        >
          <span className="dy-plugin-power-icon" data-state={plugin.enabled ? 'stop' : 'start'} aria-hidden="true" />
          {busyAction === 'toggle' ? toggleBusyLabel : toggleLabel}
        </button>
        <button
          type="button"
          onClick={() => onManage(plugin)}
          disabled={busy}
          aria-expanded={expanded}
          className={`dy-plugin-row-action dy-plugin-row-manage h-8 rounded-md border px-3 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            expanded
              ? 'border-cyan-300/25 bg-cyan-300/[0.07] text-cyan-100'
              : 'border-white/[0.08] bg-white/[0.025] text-slate-300 hover:border-white/[0.13] hover:text-slate-100'
          }`}
          title={`Manage ${plugin.name}`}
        >
          Manage
        </button>
      </div>

      {plugin.id === 'clawtalk' && <ClawTalkOperationsCard plugin={plugin} />}

      {expanded && (
        <div className="md:col-span-4">
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.05] pt-3">
            <button
              type="button"
              onClick={() => onUpdate(plugin)}
              disabled={busy}
              className="h-8 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-emerald-300/25 hover:text-emerald-100 disabled:cursor-wait disabled:opacity-50"
              title={`Run openclaw plugins update ${plugin.id}`}
            >
              {busyAction === 'update' ? 'Updating' : 'Update'}
            </button>
            <button
              type="button"
              onClick={() => onInspect(plugin)}
              disabled={busy}
              className="h-8 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-100 disabled:cursor-wait disabled:opacity-50"
              title={`Run openclaw plugins inspect ${plugin.id} --runtime --json`}
            >
              {busyAction === 'inspect' ? 'Checking' : 'Inspect'}
            </button>
            <button
              type="button"
              onClick={() => onRestart(plugin)}
              disabled={busy}
              className="h-8 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-amber-300/25 hover:text-amber-100 disabled:cursor-wait disabled:opacity-50"
              title="Restart embedded OpenClaw gateway"
            >
              {busyAction === 'restart' ? 'Restarting' : 'Restart'}
            </button>
            <button
              type="button"
              onClick={() => onUninstall(plugin)}
              disabled={busy}
              className="h-8 rounded-md border border-rose-300/20 bg-rose-400/[0.05] px-3 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-400/[0.10] disabled:cursor-wait disabled:opacity-50"
              title={`Run openclaw plugins uninstall ${plugin.id}`}
            >
              {busyAction === 'uninstall' ? 'Removing' : 'Uninstall'}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

function OpenClawCommandPanel({
  onPayload,
  setNotice,
  setError,
}: {
  onPayload: (payload: PluginApiPayload) => void
  setNotice: (notice: string) => void
  setError: (error: string) => void
}) {
  const [command, setCommand] = useState('openclaw doctor --help')
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<OpenClawCommandState | null>(null)

  const runCommand = useCallback(async () => {
    const trimmed = command.trim()
    if (!trimmed || running) return
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const payload = await runOpenClawPluginCommand(trimmed)
      if (!payload.command) throw new Error('OpenClaw command failed.')
      onPayload(payload)
      setLastRun({ command: trimmed, result: payload.command, ok: payload.ok !== false })
      setNotice(`${payload.command.command} exited ${payload.command.code}; output added to gateway tail.`)
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setRunning(false)
    }
  }, [command, onPayload, running, setError, setNotice])

  const output = commandOutputText(lastRun?.result)

  return (
    <section className="rounded-lg border border-white/[0.06] bg-black/15 p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void runCommand()
        }}
      >
        <div className="flex h-9 shrink-0 items-center rounded-md border border-white/[0.07] bg-black/25 px-2 font-mono text-[11px] text-slate-500">
          $
        </div>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          className="h-9 min-w-[220px] flex-1 rounded-md border border-white/[0.07] bg-black/25 px-3 font-mono text-[11px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/30"
          placeholder="openclaw status"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={running || !command.trim()}
          className="h-9 rounded-md border border-cyan-300/20 bg-cyan-300/[0.07] px-3 text-[11px] font-semibold uppercase text-cyan-100 transition hover:bg-cyan-300/[0.12] disabled:cursor-wait disabled:opacity-50"
        >
          {running ? 'Running' : 'Run'}
        </button>
      </form>

      {lastRun && (
        <div className={`mt-3 rounded-md border px-3 py-2 ${lastRun.ok ? 'border-white/[0.06] bg-white/[0.018]' : 'border-rose-400/20 bg-rose-400/[0.04]'}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="truncate font-mono text-[11px] text-slate-500">{lastRun.result.command}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${lastRun.ok ? 'border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200' : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'}`}>
              exit {lastRun.result.code}
            </span>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
            {output}
          </pre>
        </div>
      )}
    </section>
  )
}

function PluginSetupModal({
  plugin,
  onClose,
  onSaved,
  setNotice,
  setError,
}: {
  plugin: PluginEntry
  onClose: () => void
  onSaved: (payload: PluginApiPayload) => void
  setNotice: (notice: string) => void
  setError: (error: string) => void
}) {
  const fields = useMemo(() => setupFieldsForPlugin(plugin), [plugin])
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    setValues({})
    setLocalError('')
  }, [plugin.id])

  const saveSetup = useCallback(async () => {
    const isClawTalk = plugin.id === 'clawtalk'
    const configValues: Record<string, string> = {}
    const providerAuth: Record<string, string> = {}
    for (const field of fields) {
      const value = values[field.key]?.trim()
      if (!value) continue
      if (field.providerId) providerAuth[field.providerId] = value
      else configValues[field.key] = value
    }
    if (isClawTalk && !configValues.apiKey) {
      setLocalError('Paste the ClawTalk API key to connect.')
      return
    }
    if (!Object.keys(configValues).length && !Object.keys(providerAuth).length) {
      setLocalError('Add at least one setup value to save.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')
    try {
      const payload = isClawTalk
        ? await setupClawTalkPlugin(configValues.apiKey)
        : await savePluginSetup(plugin.id, configValues, providerAuth)
      onSaved(payload)
      setNotice(isClawTalk
        ? `${plugin.name} connected; bot and WebSocket verified.`
        : `${plugin.name} setup saved; ${restartNotice(payload.restart)}.`)
      onClose()
    } catch (err) {
      setLocalError(pluginRequestError(err))
    } finally {
      setSaving(false)
    }
  }, [fields, onClose, onSaved, plugin.id, plugin.name, setError, setNotice, values])

  const missingDependencyText = plugin.missingDependencies.slice(0, 4).join(', ')
  const primaryGuidance = plugin.guidance[0] || 'Save the required fields, then refresh.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#07101f] p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-slate-100">{plugin.name}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{primaryGuidance}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-md border border-white/[0.07] bg-white/[0.025] text-[14px] font-semibold text-slate-400 transition hover:border-white/[0.13] hover:text-slate-100"
            title="Close setup"
          >
            x
          </button>
        </div>

        {missingDependencyText && (
          <div className="mt-3 rounded-md border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-[11px] text-amber-100">
            Missing: {missingDependencyText}
          </div>
        )}

        {fields.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {fields.map((field) => (
              <label key={field.key} className="grid gap-1">
                <span className="flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
                  <span className="truncate">{field.label}</span>
                  {field.present && <span className="shrink-0 text-[9px] text-emerald-300/80">saved</span>}
                </span>
                <input
                  value={values[field.key] || ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.envVar || (field.present ? 'Leave blank to keep current value' : 'Required')}
                  className="h-9 min-w-0 rounded-md border border-white/[0.07] bg-black/25 px-3 text-[12px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-amber-300/30"
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-slate-400">
            No direct fields were advertised for this plugin. Refresh after resolving the listed action.
          </p>
        )}

        {localError && (
          <div className="mt-3 rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] text-rose-200">
            {localError}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-white/[0.07] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-400 transition hover:border-white/[0.13] hover:text-slate-200"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void saveSetup()}
            disabled={saving || !fields.length}
            className="h-9 rounded-md border border-amber-300/20 bg-amber-300/[0.07] px-3 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-300/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save Setup'}
          </button>
        </div>
      </section>
    </div>
  )
}

function PluginInspectModal({
  plugin,
  inspect,
  onClose,
}: {
  plugin: PluginEntry
  inspect: PluginRuntimeInspect
  onClose: () => void
}) {
  const runtimeLabel =
    inspect.runtimeLoaded === true
      ? 'loaded'
      : inspect.runtimeLoaded === false
        ? 'not loaded'
        : inspect.status || 'checked'
  const output = inspect.command.output.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section className="w-full max-w-lg rounded-xl border border-white/[0.08] bg-[#07101f] p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-slate-100">{plugin.name}</p>
            <p className="mt-1 truncate font-mono text-[10px] text-slate-600">{inspect.command.command}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-md border border-white/[0.07] bg-white/[0.025] text-[14px] font-semibold text-slate-400 transition hover:border-white/[0.13] hover:text-slate-100"
            title="Close runtime check"
          >
            x
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase text-cyan-100">
            runtime {runtimeLabel}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[9px] font-semibold uppercase text-slate-400">
            {inspect.status || 'checked'}
          </span>
        </div>

        {inspect.surfaces.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {inspect.surfaces.slice(0, 6).map((surface) => (
              <div key={surface.label} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-500">{surface.label}</p>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">{surface.values.slice(0, 8).join(', ')}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] text-slate-400">
            No runtime surfaces were reported.
          </p>
        )}

        {output && !inspect.surfaces.length && (
          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-white/[0.06] bg-black/25 p-3 text-[10px] text-slate-400">
            {output}
          </pre>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-white/[0.07] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-white/[0.13] hover:text-slate-100"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  )
}

function PluginDiscoveryPanel({
  onInstalled,
  query,
  setQuery,
  filter,
  setFilter,
  visibleCount,
  setNotice,
  setError,
}: {
  onInstalled: (payload: PluginApiPayload) => void
  query: string
  setQuery: (query: string) => void
  filter: PluginFilter
  setFilter: (filter: PluginFilter) => void
  visibleCount: number
  setNotice: (notice: string) => void
  setError: (error: string) => void
}) {
  const [pin, setPin] = useState(true)
  const [results, setResults] = useState<PluginSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState('')
  const [localError, setLocalError] = useState('')
  const trimmedQuery = query.trim()
  const clawHubMode = /^\/clawhub(?:\s|$)/i.test(trimmedQuery)
  const clawHubQuery = clawHubMode ? trimmedQuery.replace(/^\/clawhub(?:\s+)?/i, '').trim() : ''

  const searchPlugins = useCallback(async () => {
    const q = clawHubQuery
    if (!clawHubMode) {
      setResults([])
      setLocalError('')
      setNotice(`${visibleCount} installed plugin${visibleCount === 1 ? '' : 's'} shown.`)
      return
    }
    if (!q) {
      setLocalError('Add a ClawHub search term after /clawhub.')
      return
    }
    setSearching(true)
    setLocalError('')
    setError('')
    try {
      const payload = await searchOpenClawPlugins(q, 20)
      setResults(payload.results || [])
      const warning = formatPluginCliWarning(payload.cliError)
      setNotice(warning ? `Search warning: ${warning}` : `${payload.results?.length || 0} search results.`)
    } catch (err) {
      setLocalError(pluginRequestError(err))
    } finally {
      setSearching(false)
    }
  }, [clawHubMode, clawHubQuery, setError, setNotice, visibleCount])

  const installPlugin = useCallback(async (spec: string, pluginId?: string) => {
    const installSpec = spec.trim()
    if (!installSpec) return
    setInstalling(installSpec)
    setLocalError('')
    setError('')
    try {
      const payload = await installOpenClawPlugin({ spec: installSpec, pluginId, pin, enable: true, restart: true })
      onInstalled(payload)
      const repairSuffix = payload.repair?.applied ? ' Auto-repaired installer staging lock.' : ''
      setNotice(`${payload.plugin?.name || installSpec} installed and enabled; ${restartNotice(payload.restart)}.${repairSuffix}`)
    } catch (err) {
      setLocalError(pluginRequestError(err))
    } finally {
      setInstalling('')
    }
  }, [onInstalled, pin, setError, setNotice])

  return (
    <section className="rounded-lg border border-white/[0.06] bg-white/[0.018] p-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center rounded-md border border-white/[0.07] bg-black/20 transition focus-within:border-cyan-300/30">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchPlugins()
            }}
            placeholder="Search installed plugins or /clawhub browser"
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-slate-200 outline-none placeholder:text-slate-600"
          />
        </div>
        <button
          type="button"
          onClick={() => void searchPlugins()}
          disabled={searching || (clawHubMode && !clawHubQuery)}
          className="h-9 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-3 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.10] disabled:cursor-wait disabled:opacity-50"
        >
          {searching ? 'Searching' : clawHubMode ? 'Search ClawHub' : 'Filter'}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-white/[0.07] bg-black/20 px-3 text-[10px] font-semibold text-slate-400">
          <input
            type="checkbox"
            checked={pin}
            onChange={(event) => setPin(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-white/[0.12] bg-black/30"
          />
          Pin installs
        </label>
        {PLUGIN_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`h-8 rounded-md border px-3 text-[10px] font-semibold transition ${
              filter === option.id
                ? 'border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-100'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-400 hover:border-white/[0.13] hover:bg-white/[0.04]'
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="text-[10px] font-semibold text-slate-600">{visibleCount} shown</span>
      </div>

      {localError && (
        <div className="mt-3 rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] text-rose-200">
          {localError}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-3 max-h-52 overflow-y-auto rounded-md border border-white/[0.05]">
          {results.map((result) => (
            <div key={`${result.id}:${result.installSpec}`} className="grid gap-2 border-b border-white/[0.04] px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[12px] font-bold text-slate-100">{result.name}</p>
                  {result.version && <span className="text-[10px] text-slate-500">{result.version}</span>}
                  <span className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[8px] uppercase text-slate-500">{result.source}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{result.description}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-slate-600">{result.installSpec}</p>
              </div>
              <button
                type="button"
                onClick={() => void installPlugin(result.installSpec, result.id)}
                disabled={Boolean(installing) || result.installed}
                className="h-8 self-center rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-emerald-300/25 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {result.installed ? 'Installed' : installing === result.installSpec ? 'Installing' : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginEntry[]>(() => pluginsPanelCache?.plugins || [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [loading, setLoading] = useState(() => !pluginsPanelCache)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => (pluginsPanelCache ? responseNotice(pluginsPanelCache) : ''))
  const [updatingAll, setUpdatingAll] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [setupPlugin, setSetupPlugin] = useState<PluginEntry | null>(null)
  const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null)
  const [busyPluginAction, setBusyPluginAction] = useState<{ id: string; action: PluginBusyAction } | null>(null)
  const [inspectState, setInspectState] = useState<PluginInspectState | null>(null)
  const [uninstallConfirmPlugin, setUninstallConfirmPlugin] = useState<PluginEntry | null>(null)

  const applyPayload = useCallback((payload: PluginApiPayload) => {
    if (Array.isArray(payload.plugins)) {
      setPlugins(payload.plugins)
      updatePluginsPanelCache(payload.plugins, payload)
    }
  }, [])

  useEffect(() => {
    if (!uninstallConfirmPlugin) return
    if (!plugins.some((plugin) => plugin.id === uninstallConfirmPlugin.id)) {
      setUninstallConfirmPlugin(null)
    }
  }, [plugins, uninstallConfirmPlugin])

  const applyInstalledPayload = useCallback((payload: PluginApiPayload) => {
    applyPayload(payload)
    const plugin = payload.plugin?.needsSetup
      ? payload.plugin
      : payload.plugin
        ? payload.plugins?.find((entry) => entry.id === payload.plugin?.id && entry.needsSetup) || null
        : null
    if (plugin?.needsSetup) setSetupPlugin(plugin)
  }, [applyPayload])

  const loadPlugins = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    setError('')
    try {
      const payload = await fetchPlugins({ force: options.force })
      setPlugins(payload.plugins || [])
      pluginsPanelCache = {
        plugins: payload.plugins || [],
        configPath: payload.configPath,
        cliError: payload.cliError,
        cache: payload.cache,
      }
      const setupCount = (payload.plugins || []).filter((plugin) => plugin.needsSetup).length
      setNotice(responseNotice(payload) || (setupCount ? `${setupCount} plugin(s) need setup.` : ''))
      return true
    } catch (err) {
      setError(pluginRequestError(err))
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlugins({ silent: Boolean(pluginsPanelCache) })
  }, [loadPlugins])

  const togglePlugin = useCallback(async (plugin: PluginEntry) => {
    const nextEnabled = !plugin.enabled
    setUpdatingId(plugin.id)
    setError('')
    setNotice('')
    setPlugins((current) => {
      const next = pluginsWithToggle(current, plugin.id, nextEnabled)
      updatePluginsPanelCache(next)
      return next
    })
    try {
      const payload = await setPluginEnabled(plugin.id, nextEnabled)
      applyPayload(payload)
      const updated = payload.plugins?.find((entry) => entry.id === plugin.id)
      const setupSuffix = nextEnabled && updated?.needsSetup ? ' Setup required.' : ''
      setNotice(commandNotice(payload, `${plugin.name} ${nextEnabled ? 'enabled' : 'disabled'}; ${restartNotice(payload.restart)}.${setupSuffix}`))
      if (updated?.needsSetup) setSetupPlugin(updated)
    } catch (err) {
      setPlugins((current) => {
        const next = pluginsWithToggle(current, plugin.id, plugin.enabled)
        updatePluginsPanelCache(next)
        return next
      })
      setError(pluginRequestError(err))
    } finally {
      setUpdatingId(null)
    }
  }, [applyPayload])

  const refreshPlugin = useCallback(async (plugin: PluginEntry) => {
    setRefreshingId(plugin.id)
    setError('')
    setNotice('')
    try {
      const refreshed = await loadPlugins({ force: true, silent: true })
      if (refreshed) setNotice(`${plugin.name} refreshed.`)
    } finally {
      setRefreshingId(null)
    }
  }, [loadPlugins])

  const managePlugin = useCallback((plugin: PluginEntry) => {
    setExpandedPluginId((current) => current === plugin.id ? null : plugin.id)
  }, [])

  const updatePlugin = useCallback(async (plugin: PluginEntry) => {
    setBusyPluginAction({ id: plugin.id, action: 'update' })
    setError('')
    setNotice('')
    try {
      const payload = await updateOpenClawPlugin(plugin.id)
      applyPayload(payload)
      setNotice(commandNotice(payload, `${payload.plugin?.name || plugin.name} updated; ${restartNotice(payload.restart)}`))
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setBusyPluginAction(null)
    }
  }, [applyPayload])

  const updateAllPlugins = useCallback(async () => {
    if (updatingAll) return
    setUpdatingAll(true)
    setError('')
    setNotice('')
    try {
      const payload = await updateAllOpenClawPlugins()
      applyPayload(payload)
      setNotice(commandNotice(payload, `Plugin update-all finished; ${restartNotice(payload.restart)}`))
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setUpdatingAll(false)
    }
  }, [applyPayload, updatingAll])

  const inspectPlugin = useCallback(async (plugin: PluginEntry) => {
    setBusyPluginAction({ id: plugin.id, action: 'inspect' })
    setError('')
    setNotice('')
    try {
      const payload = await inspectOpenClawPluginRuntime(plugin.id)
      if (!payload.inspect) throw new Error('Plugin runtime inspect failed.')
      applyPayload(payload)
      setInspectState({ plugin: payload.plugin || plugin, inspect: payload.inspect })
      setNotice(`${plugin.name} runtime checked.`)
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setBusyPluginAction(null)
    }
  }, [applyPayload])

  const restartGatewayForPlugin = useCallback(async (plugin: PluginEntry) => {
    setBusyPluginAction({ id: plugin.id, action: 'restart' })
    setError('')
    setNotice('')
    try {
      const payload = await restartPluginGateway()
      applyPayload(payload)
      setNotice(`${plugin.name} gateway restart finished; ${restartNotice(payload.restart)}.`)
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setBusyPluginAction(null)
    }
  }, [applyPayload])

  const uninstallPlugin = useCallback(async (plugin: PluginEntry) => {
    setUninstallConfirmPlugin(null)
    setBusyPluginAction({ id: plugin.id, action: 'uninstall' })
    setError('')
    setNotice('')
    try {
      const payload = await uninstallOpenClawPlugin(plugin.id)
      applyPayload(payload)
      setExpandedPluginId(null)
      setNotice(commandNotice(payload, `${plugin.name} uninstalled; ${restartNotice(payload.restart)}`))
    } catch (err) {
      setError(pluginRequestError(err))
    } finally {
      setBusyPluginAction(null)
    }
  }, [applyPayload])

  const requestUninstallPlugin = useCallback((plugin: PluginEntry) => {
    setError('')
    setNotice(`Review before uninstalling ${plugin.name}.`)
    setUninstallConfirmPlugin(plugin)
    setExpandedPluginId(plugin.id)
  }, [])

  const keepPluginInstalled = useCallback(() => {
    if (uninstallConfirmPlugin) setNotice(`${uninstallConfirmPlugin.name} kept installed.`)
    setUninstallConfirmPlugin(null)
  }, [uninstallConfirmPlugin])

  const visiblePlugins = useMemo(() => {
    const trimmed = query.trim()
    const term = /^\/clawhub(?:\s|$)/i.test(trimmed) ? '' : trimmed.toLowerCase()
    return plugins.filter((plugin) => {
      if (!pluginMatchesFilter(plugin, filter)) return false
      if (!term) return true
      return [
        plugin.id,
        plugin.name,
        plugin.description,
        plugin.category,
        plugin.origin,
        plugin.status,
        plugin.packageName || '',
        plugin.installSpec || '',
        plugin.systemImage || '',
        pluginPageState(plugin).label,
        ...plugin.guidance,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [filter, plugins, query])

  const stateSummary = summarizePluginPageStates(plugins)
  const browser = plugins.find((plugin) => plugin.id === 'browser')
  const statusMessage = compactPluginNoticeText(error || notice)

  return (
    <section
      data-dui-panel="plugins"
      className="dy-plugins-panel flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[linear-gradient(180deg,#0b1425,#060b18)] shadow-2xl shadow-black/40"
    >
      <div className="border-b border-white/[0.05] bg-white/[0.018] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-bold text-slate-100">OpenClaw Plugins</h2>
            <p className="mt-1 text-[10px] text-slate-500/80">Search, install, enable, configure, and refresh plugin runtime surfaces.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {browser && (
              <span
                className={`dy-plugin-summary-chip rounded-full border px-2.5 py-1 text-[9px] font-semibold ${
                  browser.enabled
                    ? 'border-cyan-300/30 bg-cyan-300/[0.10] text-cyan-100'
                    : 'border-slate-400/25 bg-slate-500/[0.08] text-slate-300'
                }`}
                data-tone={browser.enabled ? 'browser-on' : 'browser-off'}
              >
                Browser {browser.enabled ? 'on' : 'off'}
              </span>
            )}
            <span className="dy-plugin-summary-chip rounded-full border border-emerald-300/30 bg-emerald-300/[0.10] px-2.5 py-1 text-[9px] font-semibold text-emerald-100" data-tone="success">
              {stateSummary.enabled} enabled
            </span>
            <span className="dy-plugin-summary-chip rounded-full border border-cyan-300/25 bg-cyan-300/[0.08] px-2.5 py-1 text-[9px] font-semibold text-cyan-100" data-tone="configured">
              {stateSummary.configured} configured
            </span>
            <span className="dy-plugin-summary-chip rounded-full border border-amber-300/30 bg-amber-300/[0.10] px-2.5 py-1 text-[9px] font-semibold text-amber-100" data-tone="warning">
              {stateSummary.missingAuth} missing auth
            </span>
            <span className="dy-plugin-summary-chip rounded-full border border-amber-300/25 bg-amber-300/[0.07] px-2.5 py-1 text-[9px] font-semibold text-amber-100" data-tone="unavailable">
              {stateSummary.unavailable} unavailable
            </span>
            <span className="dy-plugin-summary-chip rounded-full border border-rose-300/25 bg-rose-400/[0.07] px-2.5 py-1 text-[9px] font-semibold text-rose-100" data-tone="failed">
              {stateSummary.failed} failed
            </span>
            <span className="dy-plugin-summary-chip rounded-full border border-slate-500/25 bg-slate-500/[0.08] px-2.5 py-1 text-[9px] font-semibold text-slate-300" data-tone="disabled">
              {stateSummary.disabled} disabled
            </span>
            <button
              type="button"
              onClick={() => void updateAllPlugins()}
              disabled={updatingAll || loading}
              className="h-7 rounded-md border border-cyan-300/20 bg-cyan-300/[0.07] px-3 text-[9px] font-semibold uppercase text-cyan-100 transition hover:bg-cyan-300/[0.12] disabled:cursor-wait disabled:opacity-50"
              title="Run openclaw plugins update-all and restart the embedded gateway"
            >
              {updatingAll ? 'Updating All' : 'Update All'}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <PluginDiscoveryPanel
            onInstalled={applyInstalledPayload}
            query={query}
            setQuery={setQuery}
            filter={filter}
            setFilter={setFilter}
            visibleCount={visiblePlugins.length}
            setNotice={setNotice}
            setError={setError}
          />
        </div>

        <div className="mt-3">
          <OpenClawCommandPanel
            onPayload={applyPayload}
            setNotice={setNotice}
            setError={setError}
          />
        </div>

        {uninstallConfirmPlugin && (
          <ActionStatusBanner
            className="mt-3 text-[11px]"
            rounded="md"
            detailClassName="text-[10px] text-amber-100/65"
            message={`Uninstall ${uninstallConfirmPlugin.name}?`}
            detail="Removes plugin files, forces uninstall, and restarts the embedded gateway."
            detailTitle={`${uninstallConfirmPlugin.id} / ${uninstallConfirmPlugin.origin}`}
            confirmLabel="Uninstall"
            confirmBusyLabel="Removing"
            confirmAriaLabel={`Uninstall ${uninstallConfirmPlugin.name}`}
            cancelAriaLabel={`Keep ${uninstallConfirmPlugin.name} installed`}
            busy={busyPluginAction?.id === uninstallConfirmPlugin.id}
            onConfirm={() => void uninstallPlugin(uninstallConfirmPlugin)}
            onCancel={keepPluginInstalled}
          />
        )}

        {statusMessage && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-[11px] ${error ? 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200' : 'border-cyan-300/15 bg-cyan-300/[0.04] text-cyan-100/80'}`}
            role={error ? 'alert' : 'status'}
            aria-live={error ? 'assertive' : 'polite'}
          >
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{statusMessage}</span>
          </div>
        )}
      </div>

      <div className="dy-plugins-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="dy-plugins-list min-h-full p-4">
          <div className="min-w-0 space-y-3">
            {setupPlugin && (
              <PluginSetupModal
                plugin={setupPlugin}
                onClose={() => setSetupPlugin(null)}
                onSaved={applyPayload}
                setNotice={setNotice}
                setError={setError}
              />
            )}

            {inspectState && (
              <PluginInspectModal
                plugin={inspectState.plugin}
                inspect={inspectState.inspect}
                onClose={() => setInspectState(null)}
              />
            )}

            {loading ? (
              <div className="grid gap-3">
                <div className="h-16 animate-pulse rounded-lg bg-white/[0.035]" />
                <div className="h-16 animate-pulse rounded-lg bg-white/[0.025]" />
                <div className="h-16 animate-pulse rounded-lg bg-white/[0.020]" />
              </div>
            ) : visiblePlugins.length ? (
              visiblePlugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  busyAction={
                    refreshingId === plugin.id
                      ? 'refresh'
                      : updatingId === plugin.id
                        ? 'toggle'
                        : busyPluginAction?.id === plugin.id
                          ? busyPluginAction.action
                          : null
                  }
                  expanded={expandedPluginId === plugin.id}
                  onToggle={togglePlugin}
                  onRefresh={refreshPlugin}
                  onSetup={setSetupPlugin}
                  onManage={managePlugin}
                  onUpdate={updatePlugin}
                  onInspect={inspectPlugin}
                  onRestart={restartGatewayForPlugin}
                  onUninstall={requestUninstallPlugin}
                />
              ))
            ) : (
              <div className="dy-plugin-empty-state rounded-lg border border-white/[0.06] bg-white/[0.018] px-4 py-8 text-center text-[12px] text-slate-500">
                <strong className="block text-[13px] text-slate-200">
                  {plugins.length ? 'No plugins match these filters.' : 'No plugins loaded yet.'}
                </strong>
                <span className="mt-1 block">
                  {plugins.length ? 'Broaden the search or switch back to all plugins.' : 'Refresh the registry or run an OpenClaw command to discover installed surfaces.'}
                </span>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(query || filter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('')
                        setFilter('all')
                      }}
                      className="h-8 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-300 transition hover:border-white/[0.14] hover:text-slate-100"
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadPlugins({ force: true })}
                    disabled={loading}
                    className="h-8 rounded-md border border-cyan-300/20 bg-cyan-300/[0.07] px-3 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.12] disabled:cursor-wait disabled:opacity-50"
                  >
                    Refresh plugins
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
