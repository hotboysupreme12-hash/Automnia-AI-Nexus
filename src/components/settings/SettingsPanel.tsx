import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { DurationMode, DurationUnit, FastModeDefault, ThinkingLevel } from '../../types/nexus'
import {
  DEFAULT_UI_SETTINGS,
  UI_SETTINGS_STORAGE_KEY,
  applyUiSettings,
  readUiSettings,
  saveUiSettings,
  type DystopAIUiSettings,
  type UiAccentMode,
  type UiDensity,
  type UiFormChrome,
  type UiMotion,
} from './uiSettings'

const REGISTRY_PREFS_KEY = 'dystopai-agent-registry-prefs'
const CONSOLE_VISIBILITY_KEY = 'dystopai-agent-console-visibility'
const CONSOLE_WIDTH_KEY = 'dystopai-agent-console-width'

type NoticeTone = 'neutral' | 'success' | 'warning'

function settingLabel(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function SettingsCard({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section className="dui-settings-card">
      <div className="dui-settings-card__head">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="dui-settings-field">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  )
}

function ToggleField({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="dui-settings-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export function SettingsPanel() {
  const agents = useNexusStore((state) => state.agents)
  const activePartyIds = useNexusStore((state) => state.activePartyIds)
  const selectedAgentIds = useNexusStore((state) => state.selectedAgentIds)
  const missionDraft = useNexusStore((state) => state.missionDraft)
  const responseCount = useNexusStore((state) => state.agentResponses.length)
  const updateMissionDraft = useNexusStore((state) => state.updateMissionDraft)
  const updateHeartbeat = useNexusStore((state) => state.updateHeartbeat)
  const updateAgentRuntimePolicy = useNexusStore((state) => state.updateAgentRuntimePolicy)
  const clearAgentResponses = useNexusStore((state) => state.clearAgentResponses)
  const clearAll = useNexusStore((state) => state.clearAll)
  const resetMission = useNexusStore((state) => state.resetMission)
  const resetSimulation = useNexusStore((state) => state.resetSimulation)
  const setTab = useNexusStore((state) => state.setTab)

  const [uiSettings, setUiSettings] = useState<DystopAIUiSettings>(() => readUiSettings())
  const targetIds = useMemo(() => {
    const active = activePartyIds.length ? activePartyIds : selectedAgentIds
    return active.filter((id) => agents.some((agent) => agent.id === id))
  }, [activePartyIds, agents, selectedAgentIds])
  const targetAgents = useMemo(() => targetIds.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean), [agents, targetIds])
  const firstTarget = targetAgents[0]
  const [heartbeatSeconds, setHeartbeatSeconds] = useState(() => Math.max(5, Math.round(((firstTarget?.heartbeat.tickIntervalMs || 30_000) / 1000))))
  const [timeoutMinutes, setTimeoutMinutes] = useState(() => Math.max(1, Math.round(((firstTarget?.runtimePolicy?.timeoutSeconds || 720) / 60))))
  const [thinkingDefault, setThinkingDefault] = useState<ThinkingLevel>(() => firstTarget?.runtimePolicy?.thinkingDefault || 'minimal')
  const [fastModeDefault, setFastModeDefault] = useState<FastModeDefault>(() => firstTarget?.runtimePolicy?.fastModeDefault || 'auto')
  const [parallelPreferred, setParallelPreferred] = useState(() => Boolean(firstTarget?.runtimePolicy?.parallelPreferred))
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>({ tone: 'neutral', text: 'Changes save locally and apply immediately where possible.' })

  const updateUiSetting = <Key extends keyof DystopAIUiSettings>(key: Key, value: DystopAIUiSettings[Key]) => {
    setUiSettings((current) => {
      const next = { ...current, [key]: value }
      saveUiSettings(next)
      applyUiSettings(next)
      setNotice({ tone: 'success', text: `${settingLabel(String(key))} updated.` })
      return next
    })
  }

  const resetUiSettings = () => {
    saveUiSettings(DEFAULT_UI_SETTINGS)
    applyUiSettings(DEFAULT_UI_SETTINGS)
    setUiSettings(DEFAULT_UI_SETTINGS)
    setNotice({ tone: 'success', text: 'UI settings reset to defaults.' })
  }

  const clearLocalUiPrefs = () => {
    window.localStorage.removeItem(REGISTRY_PREFS_KEY)
    window.localStorage.removeItem(CONSOLE_VISIBILITY_KEY)
    window.localStorage.removeItem(CONSOLE_WIDTH_KEY)
    setNotice({ tone: 'warning', text: 'Local registry and console preferences were cleared. Reload to rehydrate those panels from defaults.' })
  }

  const exportUiSettings = async () => {
    await navigator.clipboard.writeText(JSON.stringify({ [UI_SETTINGS_STORAGE_KEY]: uiSettings }, null, 2))
    setNotice({ tone: 'success', text: 'UI settings copied to clipboard.' })
  }

  const applyRuntimeToTargets = () => {
    if (!targetIds.length) {
      setNotice({ tone: 'warning', text: 'No active or selected agents to update. Add agents to the party or select agents first.' })
      return
    }
    const tickIntervalMs = Math.max(5, Math.round(heartbeatSeconds)) * 1000
    const timeoutSeconds = Math.max(1, Math.round(timeoutMinutes)) * 60
    for (const id of targetIds) {
      updateHeartbeat(id, { tickIntervalMs })
      updateAgentRuntimePolicy(id, { timeoutSeconds, thinkingDefault, fastModeDefault, parallelPreferred })
    }
    setNotice({ tone: 'success', text: `Runtime defaults applied to ${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}.` })
  }

  return (
    <section data-dui-panel="settings" className="dui-settings-panel">
      <div className="dui-settings-hero">
        <div>
          <span>System Settings</span>
          <h2>Control Center Preferences</h2>
          <p>Manage appearance, mission defaults, runtime behavior, and cleanup tools from one place.</p>
        </div>
        <div className="dui-settings-status" data-tone={notice.tone}>
          <strong>{notice.tone}</strong>
          <span>{notice.text}</span>
        </div>
      </div>

      <div className="dui-settings-grid">
        <SettingsCard eyebrow="Appearance" title="Theme chrome">
          <Field label="Accent mode" hint="Reference cyan keeps the shell and party surfaces in the blue theme.">
            <select value={uiSettings.accentMode} onChange={(event) => updateUiSetting('accentMode', event.target.value as UiAccentMode)}>
              <option value="reference">Reference cyan</option>
              <option value="no-blue">No blue graphite</option>
              <option value="ember">Amber operations</option>
              <option value="green">Green terminal</option>
            </select>
          </Field>
          <Field label="Form chrome" hint="Controls inputs, selects, search bars, and composers.">
            <select value={uiSettings.formChrome} onChange={(event) => updateUiSetting('formChrome', event.target.value as UiFormChrome)}>
              <option value="graphite">Graphite</option>
              <option value="obsidian">Obsidian</option>
              <option value="warm">Warm black</option>
            </select>
          </Field>
          <Field label="Density" hint="Changes spacing without breaking layout.">
            <select value={uiSettings.density} onChange={(event) => updateUiSetting('density', event.target.value as UiDensity)}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </Field>
          <Field label="Motion" hint="Reduced motion disables most UI transitions.">
            <select value={uiSettings.motion} onChange={(event) => updateUiSetting('motion', event.target.value as UiMotion)}>
              <option value="standard">Standard</option>
              <option value="reduced">Reduced</option>
            </select>
          </Field>
          <ToggleField label="Neutral scrollbars" hint="Removes blue scrollbar thumbs." checked={uiSettings.neutralScrollbars} onChange={(value) => updateUiSetting('neutralScrollbars', value)} />
          <ToggleField label="Control glow" hint="Keep off for a flatter graphite interface." checked={uiSettings.controlGlow} onChange={(value) => updateUiSetting('controlGlow', value)} />
          <div className="dui-settings-actions">
            <button type="button" onClick={resetUiSettings}>Reset UI</button>
            <button type="button" onClick={() => void exportUiSettings()}>Copy UI JSON</button>
          </div>
        </SettingsCard>

        <SettingsCard eyebrow="Mission" title="Default dispatch settings">
          <Field label="Mission title">
            <input value={missionDraft.title} onChange={(event) => updateMissionDraft({ title: event.target.value })} />
          </Field>
          <Field label="Duration mode">
            <select value={missionDraft.durationMode} onChange={(event) => updateMissionDraft({ durationMode: event.target.value as DurationMode })}>
              <option value="instant">Instant</option>
              <option value="timed">Timed</option>
              <option value="continuous">Continuous</option>
              <option value="indefinite">Indefinite</option>
            </select>
          </Field>
          <Field label="Duration amount">
            <div className="dui-settings-inline">
              <input type="number" min={1} value={missionDraft.durationValue} onChange={(event) => updateMissionDraft({ durationValue: Number(event.target.value) })} />
              <select value={missionDraft.durationUnit} onChange={(event) => updateMissionDraft({ durationUnit: event.target.value as DurationUnit })}>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </div>
          </Field>
          <Field label={`Complexity ${missionDraft.complexity}%`}>
            <input type="range" min={1} max={100} value={missionDraft.complexity} onChange={(event) => updateMissionDraft({ complexity: Number(event.target.value) })} />
          </Field>
          <Field label={`Risk tolerance ${missionDraft.riskTolerance}%`}>
            <input type="range" min={1} max={100} value={missionDraft.riskTolerance} onChange={(event) => updateMissionDraft({ riskTolerance: Number(event.target.value) })} />
          </Field>
          <div className="dui-settings-actions">
            <button type="button" onClick={() => setTab('missions')}>Open Missions</button>
            <button type="button" onClick={resetMission}>Reset Mission</button>
          </div>
        </SettingsCard>

        <SettingsCard eyebrow="Runtime" title="Active party defaults">
          <p className="dui-settings-note">{targetIds.length ? `${targetIds.length} target agent${targetIds.length === 1 ? '' : 's'} selected from active party/selection.` : 'No active or selected agents yet.'}</p>
          <Field label="Heartbeat cadence" hint="Seconds between agent runtime pulses.">
            <input type="number" min={5} value={heartbeatSeconds} onChange={(event) => setHeartbeatSeconds(Number(event.target.value))} />
          </Field>
          <Field label="Work timeout" hint="Minutes per agent turn.">
            <input type="number" min={1} value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Number(event.target.value))} />
          </Field>
          <Field label="Thinking default">
            <select value={thinkingDefault} onChange={(event) => setThinkingDefault(event.target.value as ThinkingLevel)}>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Fast mode">
            <select value={fastModeDefault} onChange={(event) => setFastModeDefault(event.target.value as FastModeDefault)}>
              <option value="auto">Auto</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Field>
          <ToggleField label="Parallel preferred" hint="Hints agents toward parallel execution where supported." checked={parallelPreferred} onChange={setParallelPreferred} />
          <div className="dui-settings-actions">
            <button type="button" onClick={applyRuntimeToTargets}>Apply to Agents</button>
            <button type="button" onClick={() => setTab('agents')}>Open Agents</button>
          </div>
        </SettingsCard>

        <SettingsCard eyebrow="Maintenance" title="Reset and cleanup">
          <div className="dui-settings-metrics">
            <div><span>Agents</span><strong>{agents.length}</strong></div>
            <div><span>Party</span><strong>{activePartyIds.length}</strong></div>
            <div><span>Responses</span><strong>{responseCount}</strong></div>
          </div>
          <div className="dui-settings-actions dui-settings-actions--stack">
            <button type="button" onClick={clearAgentResponses}>Clear Console Responses</button>
            <button type="button" onClick={clearLocalUiPrefs}>Clear Local UI Prefs</button>
            <button type="button" onClick={resetSimulation}>Reset Runtime Simulation</button>
            <button type="button" className="is-danger" onClick={clearAll}>Clear Party and Responses</button>
          </div>
        </SettingsCard>
      </div>
    </section>
  )
}

export default SettingsPanel
