import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readSpeechSettings, saveSpeechSettings, type SpeechTranscriptionMode } from '../../speech/speechSettings'
import { useNexusStore } from '../../store/nexusStore'
import type { DurationMode, DurationUnit, FastModeDefault, OpenClawAgent, ThinkingLevel } from '../../types/nexus'
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
type RuntimeTargetScope = 'party' | 'selection'
type RuntimeDefaultsDraft = {
  heartbeatSeconds: number
  timeoutMinutes: number
  thinkingDefault: ThinkingLevel
  fastModeDefault: FastModeDefault
  parallelPreferred: boolean
}

function settingLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function SettingsIcon({ name }: { name: 'appearance' | 'mission' | 'runtime' | 'maintenance' }) {
  if (name === 'appearance') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a1.5 1.5 0 0 1-1.3-2.2l.4-.7A1.7 1.7 0 0 0 15.1 4H12Z" /><path d="M7.5 12h.01M9.5 7.5h.01M14.5 7h.01M17 12h.01" /></svg>
  }
  if (name === 'mission') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 4.5 5 5-10 10-5-5 10-10Z" /><path d="m12.5 6.5 5 5" /><path d="m5 19 2 2" /></svg>
  }
  if (name === 'runtime') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="M19 3v5h-5" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="3.5" /></svg>
}

function agentInitials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A'
}

function defaultRuntimeDraft(agent?: Pick<OpenClawAgent, 'heartbeat' | 'runtimePolicy'>): RuntimeDefaultsDraft {
  return {
    heartbeatSeconds: Math.max(5, Math.round((agent?.heartbeat.tickIntervalMs || 30_000) / 1000)),
    timeoutMinutes: Math.max(1, Math.round((agent?.runtimePolicy?.timeoutSeconds || 720) / 60)),
    thinkingDefault: agent?.runtimePolicy?.thinkingDefault || 'minimal',
    fastModeDefault: agent?.runtimePolicy?.fastModeDefault || 'auto',
    parallelPreferred: Boolean(agent?.runtimePolicy?.parallelPreferred),
  }
}

function SettingsCard({
  title,
  eyebrow,
  description,
  tone,
  icon,
  children,
}: {
  title: string
  eyebrow: string
  description: string
  tone: 'appearance' | 'mission' | 'runtime' | 'maintenance'
  icon: 'appearance' | 'mission' | 'runtime' | 'maintenance'
  children: ReactNode
}) {
  return (
    <section className="dui-settings-card" data-settings-card={tone}>
      <div className="dui-settings-card__head">
        <span className="dui-settings-card__icon"><SettingsIcon name={icon} /></span>
        <div>
          <span>{eyebrow}</span>
          <strong>{title}</strong>
          <small>{description}</small>
        </div>
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

function SettingGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dui-settings-field">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
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
  const selectAgent = useNexusStore((state) => state.selectAgent)
  const clearSelectedAgents = useNexusStore((state) => state.clearSelectedAgents)

  const [uiSettings, setUiSettings] = useState<DystopAIUiSettings>(() => readUiSettings())
  const [speechMode, setSpeechMode] = useState<SpeechTranscriptionMode>(() => readSpeechSettings().mode)
  const [targetScope, setTargetScope] = useState<RuntimeTargetScope>(() => activePartyIds.length ? 'party' : 'selection')
  const partyTargetIds = useMemo(
    () => activePartyIds.filter((id) => agents.some((agent) => agent.id === id)),
    [activePartyIds, agents],
  )
  const selectedTargetIds = useMemo(
    () => selectedAgentIds.filter((id) => agents.some((agent) => agent.id === id)),
    [agents, selectedAgentIds],
  )
  const targetIds = useMemo(() => {
    return targetScope === 'party' ? partyTargetIds : selectedTargetIds
  }, [partyTargetIds, selectedTargetIds, targetScope])
  const targetAgents = useMemo(() => targetIds.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean), [agents, targetIds])
  const firstTarget = targetAgents[0]
  const runtimeTargetKey = firstTarget?.id || ''
  const [runtimeDraft, setRuntimeDraft] = useState(() => ({
    targetKey: runtimeTargetKey,
    values: defaultRuntimeDraft(firstTarget),
  }))
  const activeRuntimeDraft = runtimeDraft.targetKey === runtimeTargetKey
    ? runtimeDraft.values
    : defaultRuntimeDraft(firstTarget)
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>({ tone: 'neutral', text: 'Changes save locally and apply immediately where possible.' })

  const updateRuntimeDraft = (patch: Partial<RuntimeDefaultsDraft>) => {
    setRuntimeDraft({
      targetKey: runtimeTargetKey,
      values: { ...activeRuntimeDraft, ...patch },
    })
  }

  const updateUiSettings = (patch: Partial<DystopAIUiSettings>, label: string) => {
    setUiSettings((current) => {
      const next = { ...current, ...patch }
      saveUiSettings(next)
      applyUiSettings(next)
      setNotice({ tone: 'success', text: `${label} updated.` })
      return next
    })
  }

  const updateUiSetting = <Key extends keyof DystopAIUiSettings>(key: Key, value: DystopAIUiSettings[Key]) => {
    updateUiSettings({ [key]: value } as Partial<DystopAIUiSettings>, settingLabel(String(key)))
  }

  const updateSpeechMode = (mode: SpeechTranscriptionMode) => {
    saveSpeechSettings({ mode })
    setSpeechMode(mode)
    setNotice({
      tone: 'success',
      text: mode === 'local'
        ? 'Voice transcription now stays on this device.'
        : 'Voice transcription now uses the configured OpenAI cloud provider.',
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
      setNotice({ tone: 'warning', text: `No ${targetScope === 'party' ? 'active party' : 'selected'} agents to update. Choose a target set first.` })
      return
    }
    const tickIntervalMs = Math.max(5, Math.round(activeRuntimeDraft.heartbeatSeconds)) * 1000
    const timeoutSeconds = Math.max(1, Math.round(activeRuntimeDraft.timeoutMinutes)) * 60
    for (const id of targetIds) {
      updateHeartbeat(id, { tickIntervalMs })
      updateAgentRuntimePolicy(id, {
        timeoutSeconds,
        thinkingDefault: activeRuntimeDraft.thinkingDefault,
        fastModeDefault: activeRuntimeDraft.fastModeDefault,
        parallelPreferred: activeRuntimeDraft.parallelPreferred,
      })
    }
    setNotice({ tone: 'success', text: `Runtime defaults applied to ${targetIds.length} ${targetScope === 'party' ? 'party' : 'selected'} agent${targetIds.length === 1 ? '' : 's'}.` })
  }

  const toggleRuntimeTarget = (agentId: string) => {
    const wasSelected = selectedTargetIds.includes(agentId)
    selectAgent(agentId, { toggle: true })
    setTargetScope('selection')
    const agent = agents.find((entry) => entry.id === agentId)
    setNotice({
      tone: 'neutral',
      text: `${agent?.name || agentId} ${wasSelected ? 'removed from' : 'added to'} the runtime target set.`,
    })
  }

  return (
    <section data-dui-panel="settings" data-ui-revision="agent-ops" className="dui-settings-panel">
      <div className="dui-settings-hero">
        <div className="dui-settings-hero__copy">
          <span>Control center</span>
          <h2>Settings with a clear operating model.</h2>
          <p>Set the interface once, then tune mission and agent defaults against an explicit target set.</p>
          <div className="dui-settings-hero__stats" aria-label="Current workspace overview">
            <span><strong>{agents.length}</strong> rostered</span>
            <span><strong>{partyTargetIds.length}</strong> in party</span>
            <span><strong>{selectedTargetIds.length}</strong> selected</span>
          </div>
        </div>
        <div className="dui-settings-status" data-tone={notice.tone} role="status" aria-live="polite">
          <span className="dui-settings-status__marker" aria-hidden="true" />
          <div>
            <strong>{notice.tone === 'neutral' ? 'Ready' : notice.tone}</strong>
            <span>{notice.text}</span>
          </div>
        </div>
      </div>

      <div className="dui-settings-grid">
        <SettingsCard eyebrow="Appearance" title="Interface system" description="Visual preferences saved on this device." tone="appearance" icon="appearance">
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
          <SettingGroup label="Voice transcription" hint="Choose where microphone recordings are transcribed. The composer keeps only the microphone control.">
            <div className="dui-settings-voice-mode" role="group" aria-label="Voice transcription provider" data-mode={speechMode}>
              <button
                type="button"
                aria-pressed={speechMode === 'local'}
                onClick={() => updateSpeechMode('local')}
                title="Private on-device transcription after the one-time model download"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="3" /><path d="M9 7h6M9 11h6M9 22h6M12 19v3" /></svg>
                <span><strong>Local</strong><small>On-device</small></span>
              </button>
              <button
                type="button"
                aria-pressed={speechMode === 'online'}
                onClick={() => updateSpeechMode('online')}
                title="Cloud transcription with the configured OpenAI API key"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.88A6 6 0 0 1 19.7 11.2 4 4 0 0 1 17.5 19Z" /></svg>
                <span><strong>Cloud</strong><small>OpenAI</small></span>
              </button>
            </div>
          </SettingGroup>
          <Field label="Density" hint="Changes spacing without breaking layout.">
            <select data-dui-setting="density" value={uiSettings.density} onChange={(event) => updateUiSetting('density', event.target.value as UiDensity)}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </Field>
          <Field label="Motion" hint="Reduced motion disables most UI transitions.">
            <select data-dui-setting="motion" value={uiSettings.motion} onChange={(event) => updateUiSetting('motion', event.target.value as UiMotion)}>
              <option value="standard">Standard</option>
              <option value="reduced">Reduced</option>
            </select>
          </Field>
          <ToggleField label="High contrast" hint="Raises muted text, placeholders, borders, and focus rings." checked={uiSettings.highContrast} onChange={(value) => updateUiSetting('highContrast', value)} />
          <ToggleField label="Reduced glow" hint="Keeps state and readability from depending on bloom or halos." checked={uiSettings.reducedGlow} onChange={(value) => updateUiSettings({ reducedGlow: value, controlGlow: !value }, 'Reduced Glow')} />
          <ToggleField label="Neutral scrollbars" hint="Removes blue scrollbar thumbs." checked={uiSettings.neutralScrollbars} onChange={(value) => updateUiSetting('neutralScrollbars', value)} />
          <div className="dui-settings-actions">
            <button type="button" onClick={resetUiSettings}>Reset UI</button>
            <button type="button" onClick={() => void exportUiSettings()}>Copy UI JSON</button>
          </div>
        </SettingsCard>

        <SettingsCard eyebrow="Mission defaults" title="Dispatch configuration" description="Starting values for the next mission brief." tone="mission" icon="mission">
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

        <SettingsCard eyebrow="Agent operations" title="Runtime defaults" description="Apply a cohesive policy to a deliberate agent set." tone="runtime" icon="runtime">
          <div className="dui-settings-targeting" data-target-scope={targetScope}>
            <div className="dui-settings-targeting__head">
              <div>
                <span>Apply to</span>
                <strong>{targetIds.length ? `${targetIds.length} target agent${targetIds.length === 1 ? '' : 's'}` : 'Choose a target set'}</strong>
              </div>
              <div className="dui-settings-scope-toggle" role="group" aria-label="Runtime target source">
                <button type="button" aria-pressed={targetScope === 'party'} onClick={() => setTargetScope('party')} disabled={!partyTargetIds.length} title="Use the current active party">
                  Party <span>{partyTargetIds.length}</span>
                </button>
                <button type="button" aria-pressed={targetScope === 'selection'} onClick={() => setTargetScope('selection')} title="Use manually selected agents">
                  Selected <span>{selectedTargetIds.length}</span>
                </button>
              </div>
            </div>
            <p className="dui-settings-note">
              {targetScope === 'party'
                ? 'Party is ideal when these defaults should follow the active mission team.'
                : 'Build a temporary target set below; it does not change party membership.'}
            </p>
            <div className="dui-settings-agent-targets" aria-label="Agent runtime target selector">
              {agents.length ? agents.map((agent) => {
                const selected = selectedTargetIds.includes(agent.id)
                const inParty = partyTargetIds.includes(agent.id)
                const inTargetSet = targetIds.includes(agent.id)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    data-selected={selected}
                    data-party={inParty}
                    data-target={inTargetSet}
                    aria-pressed={selected}
                    onClick={() => toggleRuntimeTarget(agent.id)}
                    title={`${selected ? 'Remove' : 'Add'} ${agent.name} ${selected ? 'from' : 'to'} the manual runtime target set`}
                  >
                    <span className="dui-settings-agent-targets__avatar" aria-hidden="true">{agentInitials(agent.name)}</span>
                    <span className="dui-settings-agent-targets__copy">
                      <strong>{agent.name}</strong>
                      <small>{agent.className || 'Agent'} · level {agent.level}</small>
                    </span>
                    <span className="dui-settings-agent-targets__state">{inTargetSet ? 'Target' : inParty ? 'Party' : selected ? 'Selected' : 'Add'}</span>
                  </button>
                )
              }) : (
                <div className="dui-settings-targets-empty">
                  <strong>No agents in the roster yet.</strong>
                  <span>Recruit an agent, then return here to create a runtime target set.</span>
                  <button type="button" onClick={() => setTab('agents')}>Open Agents</button>
                </div>
              )}
            </div>
            {selectedTargetIds.length > 0 && (
              <button
                type="button"
                className="dui-settings-clear-targets"
                onClick={() => {
                  clearSelectedAgents()
                  setNotice({ tone: 'neutral', text: 'Manual runtime target set cleared.' })
                }}
              >
                Clear manual selection
              </button>
            )}
          </div>
          <Field label="Heartbeat cadence" hint="Seconds between agent runtime pulses.">
            <input type="number" min={5} value={activeRuntimeDraft.heartbeatSeconds} onChange={(event) => updateRuntimeDraft({ heartbeatSeconds: Number(event.target.value) })} />
          </Field>
          <Field label="Work timeout" hint="Minutes per agent turn.">
            <input type="number" min={1} value={activeRuntimeDraft.timeoutMinutes} onChange={(event) => updateRuntimeDraft({ timeoutMinutes: Number(event.target.value) })} />
          </Field>
          <Field label="Thinking default">
            <select value={activeRuntimeDraft.thinkingDefault} onChange={(event) => updateRuntimeDraft({ thinkingDefault: event.target.value as ThinkingLevel })}>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
              <option value="max">Maximum</option>
            </select>
          </Field>
          <Field label="Fast mode">
            <select value={activeRuntimeDraft.fastModeDefault} onChange={(event) => updateRuntimeDraft({ fastModeDefault: event.target.value as FastModeDefault })}>
              <option value="auto">Auto</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Field>
          <ToggleField label="Parallel preferred" hint="Hints agents toward parallel execution where supported." checked={activeRuntimeDraft.parallelPreferred} onChange={(parallelPreferred) => updateRuntimeDraft({ parallelPreferred })} />
          <div className="dui-settings-actions">
            <button type="button" onClick={applyRuntimeToTargets}>Apply to Agents</button>
            <button type="button" onClick={() => setTab('agents')}>Open Agents</button>
          </div>
        </SettingsCard>

        <SettingsCard eyebrow="Maintenance" title="Cleanup tools" description="Keep temporary UI and test state under control." tone="maintenance" icon="maintenance">
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
