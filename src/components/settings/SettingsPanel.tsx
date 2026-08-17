import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLicense } from '../../context/useLicense'
import { useAuth } from '../../context/useAuth'
import { DEFAULT_MISSION_DRAFT } from '../../data/seeds'
import {
  DEFAULT_SPEECH_SETTINGS,
  readSpeechSettings,
  saveSpeechSettings,
  type SpeechSettings,
  type SpeechTranscriptionMode,
} from '../../speech/speechSettings'
import { clearAllCommandConsoleDrafts } from '../../store/commandConsoleState'
import { useNexusStore } from '../../store/nexusStore'
import { resolveLicenseEntitlement } from '../../utils/licenseEntitlement'
import { restartPluginGateway, runOpenClawPluginCommand } from '../../api/plugins'
import type {
  CapabilityKey,
  CollaborationMode,
  DurationMode,
  DurationUnit,
  FastModeDefault,
  OpenClawAgent,
  ThinkingLevel,
} from '../../types/nexus'
import {
  DEFAULT_UI_SETTINGS,
  UI_SETTINGS_STORAGE_KEY,
  applyUiSettings,
  readUiSettings,
  saveUiSettings,
  type AutomniaUiSettings,
  type UiAccentMode,
  type UiDensity,
  type UiFormChrome,
  type UiMotion,
} from './uiSettings'
import {
  DEFAULT_CONSOLE_PREFERENCES,
  DEFAULT_REGISTRY_PREFERENCES,
  REGISTRY_DISPLAY_OPTIONS,
  REGISTRY_OVERLAY_OPTIONS,
  readConsolePreferences,
  readRegistryPreferences,
  saveConsolePreferences,
  saveRegistryPreferences,
  type AgentDisplayMode,
  type AgentOverlayPreset,
  type ConsolePreferences,
  type RegistryPreferences,
  type RegistrySortKey,
} from './workspaceSettings'
import { SettingsActivityLog } from './SettingsActivityLog'
import {
  CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY,
  DEFAULT_CHANNEL_ACTIVITY_SETTINGS,
  readChannelActivitySettings,
  saveChannelActivitySettings,
} from './channelActivitySettings'
import {
  DEFAULT_TELEGRAM_SETTINGS,
  normalizeTelegramSettings,
  parseTelegramConfigOutput,
  readTelegramSettings,
  saveTelegramSettings,
  telegramSettingBatchCommand,
  telegramSettingCommandEntries,
  type TelegramSettings,
} from './telegramSettings'

type NoticeTone = 'neutral' | 'success' | 'warning' | 'error'
export type SettingsSectionId = 'account' | 'appearance' | 'workspace' | 'voice' | 'missions' | 'agents' | 'telegram' | 'logs' | 'data'
type RuntimeTargetScope = 'party' | 'selection'
type PendingConfirmation = 'reset-all' | 'reset-runtime' | 'clear-workspace' | null

type RuntimeDefaultsDraft = {
  heartbeatSeconds: number
  idleTimeoutSeconds: number
  continuous: boolean
  recoveryMode: boolean
  timeoutMinutes: number
  thinkingDefault: ThinkingLevel
  fastModeDefault: FastModeDefault
  parallelPreferred: boolean
}

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  label: string
  description: string
  keywords: string
}> = [
  { id: 'account', label: 'Account & License', description: 'License key, credits and account details', keywords: 'account license credits key email tier balance provider oauth usage priority automnia fallback' },
  { id: 'appearance', label: 'Appearance', description: 'Theme, density and accessibility', keywords: 'theme color accent contrast glow motion forms scrollbar interface display' },
  { id: 'workspace', label: 'Workspace', description: 'Registry and command console', keywords: 'agents registry cards grid list sort filter console width drafts layout' },
  { id: 'voice', label: 'Voice', description: 'Transcription and microphone', keywords: 'speech microphone local cloud online silence pause noise echo gain recording' },
  { id: 'missions', label: 'Missions', description: 'Defaults for new deployments', keywords: 'mission objective duration risk complexity collaboration evidence build test' },
  { id: 'agents', label: 'Agent runtime', description: 'Bulk heartbeat and reasoning policy', keywords: 'agent runtime heartbeat timeout thinking fast parallel recovery continuous' },
  { id: 'telegram', label: 'Telegram', description: 'Bot commands, delivery and chat safety', keywords: 'telegram bot commands agents pairing dm group topics streaming reactions polls media history actions settings' },
  { id: 'logs', label: 'Logs', description: 'Agent runs, channels and activity memory', keywords: 'logs activity agent runs gateway events tail automnia runtime response history channel telegram sms incoming sent retain trim memory' },
  { id: 'data', label: 'Data & reset', description: 'Backup, cleanup and recovery', keywords: 'reset default backup export clear console responses simulation party data' },
]

const DEFAULT_RUNTIME_SETTINGS: RuntimeDefaultsDraft = {
  heartbeatSeconds: 30,
  idleTimeoutSeconds: 60,
  continuous: false,
  recoveryMode: true,
  timeoutMinutes: 12,
  thinkingDefault: 'minimal',
  fastModeDefault: 'auto',
  parallelPreferred: false,
}

const MISSION_TYPES: Array<{ id: CapabilityKey; label: string }> = [
  { id: 'codeGeneration', label: 'Build' },
  { id: 'planning', label: 'Plan' },
  { id: 'research', label: 'Research' },
  { id: 'orchestration', label: 'Command' },
  { id: 'memoryManagement', label: 'Memory' },
]

const COLLABORATION_MODES: Array<{ id: CollaborationMode; label: string }> = [
  { id: 'hierarchical', label: 'Command' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'specialist', label: 'Specialist' },
  { id: 'sequential', label: 'Relay' },
  { id: 'swarm', label: 'Swarm' },
]

function defaultRuntimeDraft(agent?: Pick<OpenClawAgent, 'heartbeat' | 'runtimePolicy'>): RuntimeDefaultsDraft {
  if (!agent) return DEFAULT_RUNTIME_SETTINGS
  return {
    heartbeatSeconds: Math.max(5, Math.round(agent.heartbeat.tickIntervalMs / 1_000)),
    idleTimeoutSeconds: Math.max(5, Math.round(agent.heartbeat.idleTimeoutMs / 1_000)),
    continuous: Boolean(agent.heartbeat.continuous),
    recoveryMode: Boolean(agent.heartbeat.recoveryMode),
    timeoutMinutes: Math.max(1, Math.round((agent.runtimePolicy?.timeoutSeconds || 720) / 60)),
    thinkingDefault: agent.runtimePolicy?.thinkingDefault || 'minimal',
    fastModeDefault: agent.runtimePolicy?.fastModeDefault || 'auto',
    parallelPreferred: Boolean(agent.runtimePolicy?.parallelPreferred),
  }
}

function SettingsGlyph({ name }: { name: SettingsSectionId }) {
  const paths: Record<SettingsSectionId, ReactNode> = {
    account: <><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V7zm3 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" /></>,
    appearance: <><path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a1.5 1.5 0 0 1-1.3-2.2l.4-.7A1.7 1.7 0 0 0 15.1 4H12Z" /><path d="M7.5 12h.01M9.5 7.5h.01M14.5 7h.01" /></>,
    workspace: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M8 9h13" /></>,
    voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" /></>,
    missions: <><path d="m14.5 4.5 5 5-10 10-5-5 10-10Z" /><path d="m12.5 6.5 5 5M5 19l2 2" /></>,
    agents: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0M19 4v4M17 6h4" /></>,
    telegram: <><path d="m4 11 16-7-5 16-3-6-8-3Z" /><path d="m12 14 3-7-7 3" /></>,
    logs: <><path d="M5 5.5h14M5 12h14M5 18.5h9" /><circle cx="3.5" cy="5.5" r=".7" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r=".7" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18.5" r=".7" fill="currentColor" stroke="none" /></>,
    data: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 18v3h16v-3" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function SectionHeader({ section, eyebrow }: { section: SettingsSectionId; eyebrow: string }) {
  const meta = SETTINGS_SECTIONS.find((entry) => entry.id === section) || SETTINGS_SECTIONS[0]
  return (
    <div className="dui-settings-section__head">
      <span className="dui-settings-section__icon"><SettingsGlyph name={section} /></span>
      <div>
        <span>{eyebrow}</span>
        <h3>{meta.label}</h3>
        <p>{meta.description}</p>
      </div>
    </div>
  )
}

function SettingsCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="dui-settings-card">
      <div className="dui-settings-card__head">
        <div>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </div>
      </div>
      <div className="dui-settings-card__body">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="dui-settings-field">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <div className="dui-settings-control">{children}</div>
    </label>
  )
}

function SettingGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dui-settings-field">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <div className="dui-settings-control">{children}</div>
    </div>
  )
}

function ToggleField({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="dui-settings-toggle" data-disabled={disabled ? 'true' : 'false'}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

function SegmentedControl<T extends string>({ value, options, label, onChange }: { value: T; options: Array<{ id: T; label: string }>; label: string; onChange: (value: T) => void }) {
  return (
    <div className="dui-settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  )
}

function formatCreditBalance(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('en-US')} credits` : 'Awaiting a confirmed balance'
}

function formatAccountTimestamp(value: string | null | undefined) {
  if (!value) return 'Not reported yet'
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime())
    ? 'Not reported yet'
    : timestamp.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
}

export function SettingsPanel({ focusSection = 'account', focusRequest = 0 }: { focusSection?: SettingsSectionId; focusRequest?: number }) {
  const { license, refresh: refreshLicense, setUsagePriority, openSubscriptionCheckout, requestLicenseActivation } = useLicense()
  const { account, changePassword, setPassword, loginWithGoogle, logout, checking } = useAuth()
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

  const [activeSection, setActiveSection] = useState<SettingsSectionId>(focusSection)
  const [searchQuery, setSearchQuery] = useState('')
  const [uiSettings, setUiSettings] = useState<AutomniaUiSettings>(() => readUiSettings())
  const [speechSettings, setSpeechSettings] = useState<SpeechSettings>(() => readSpeechSettings())
  const [registryPreferences, setRegistryPreferences] = useState<RegistryPreferences>(() => readRegistryPreferences())
  const [consolePreferences, setConsolePreferences] = useState<ConsolePreferences>(() => readConsolePreferences())
  const [targetScope, setTargetScope] = useState<RuntimeTargetScope>(() => activePartyIds.length ? 'party' : 'selection')
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null)
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string }>({ tone: 'neutral', text: '' })
  const [accountRefreshBusy, setAccountRefreshBusy] = useState(false)
  const [accountRefreshError, setAccountRefreshError] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [usagePriorityBusy, setUsagePriorityBusy] = useState(false)
  const [usagePriorityError, setUsagePriorityError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false)
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [googleReconnectBusy, setGoogleReconnectBusy] = useState(false)
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>(() => readTelegramSettings())
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramLoaded, setTelegramLoaded] = useState(false)
  const [telegramLoadError, setTelegramLoadError] = useState('')
  const [telegramGatewaySettings, setTelegramGatewaySettings] = useState<TelegramSettings>(() => readTelegramSettings())

  useEffect(() => {
    setActiveSection(focusSection)
    setSearchQuery('')
  }, [focusSection, focusRequest])

  const partyTargetIds = useMemo(() => activePartyIds.filter((id) => agents.some((agent) => agent.id === id)), [activePartyIds, agents])
  const selectedTargetIds = useMemo(() => selectedAgentIds.filter((id) => agents.some((agent) => agent.id === id)), [agents, selectedAgentIds])
  const targetIds = targetScope === 'party' ? partyTargetIds : selectedTargetIds
  const targetAgents = useMemo(
    () => targetIds.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is OpenClawAgent => Boolean(agent)),
    [agents, targetIds],
  )
  const runtimeTargetKey = targetAgents[0]?.id || ''
  const [runtimeDraft, setRuntimeDraft] = useState(() => ({ targetKey: runtimeTargetKey, values: defaultRuntimeDraft(targetAgents[0]) }))
  const activeRuntimeDraft = runtimeDraft.targetKey === runtimeTargetKey ? runtimeDraft.values : defaultRuntimeDraft(targetAgents[0])

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleSections = normalizedSearch
    ? SETTINGS_SECTIONS.filter((section) => `${section.label} ${section.description} ${section.keywords}`.toLowerCase().includes(normalizedSearch)).map((section) => section.id)
    : [activeSection]

  const announceSaved = (label: string) => setNotice({ tone: 'success', text: `${label} saved and applied.` })

  const updateUiSettings = (patch: Partial<AutomniaUiSettings>, label: string) => {
    setUiSettings((current) => {
      const next = { ...current, ...patch }
      saveUiSettings(next)
      applyUiSettings(next)
      return next
    })
    announceSaved(label)
  }

  const updateUiSetting = <Key extends keyof AutomniaUiSettings>(key: Key, value: AutomniaUiSettings[Key], label: string) => {
    updateUiSettings({ [key]: value } as Partial<AutomniaUiSettings>, label)
  }

  const updateSpeechSettings = (patch: Partial<SpeechSettings>, label: string) => {
    setSpeechSettings((current) => {
      const next = { ...current, ...patch }
      saveSpeechSettings(next)
      return next
    })
    announceSaved(label)
  }

  const updateRegistryPreferences = (patch: Partial<RegistryPreferences>, label: string) => {
    setRegistryPreferences((current) => {
      const next = { ...current, ...patch }
      saveRegistryPreferences(next)
      return next
    })
    announceSaved(label)
  }

  const updateConsolePreferences = (patch: Partial<ConsolePreferences>, label: string) => {
    setConsolePreferences((current) => {
      const next = { ...current, ...patch }
      saveConsolePreferences(next)
      if (patch.rememberDrafts === false) clearAllCommandConsoleDrafts()
      return next
    })
    announceSaved(label)
  }

  const updateRuntimeDraft = (patch: Partial<RuntimeDefaultsDraft>) => {
    setRuntimeDraft({ targetKey: runtimeTargetKey, values: { ...activeRuntimeDraft, ...patch } })
  }

  const updateTelegramDraft = <Key extends keyof TelegramSettings>(key: Key, value: TelegramSettings[Key]) => {
    setTelegramSettings((current) => {
      const next = normalizeTelegramSettings({ ...current, [key]: value })
      saveTelegramSettings(next)
      return next
    })
  }

  const openClawCommandFailure = (payload: { ok?: boolean; error?: string; command?: { output?: string; stderr?: string; code?: number } }, fallback: string) => {
    if (payload.ok === false || payload.error || (typeof payload.command?.code === 'number' && payload.command.code !== 0)) {
      return payload.error || payload.command?.output || payload.command?.stderr || fallback
    }
    return ''
  }

  const loadTelegramFromGateway = useCallback(async () => {
    if (telegramLoading) return
    setTelegramLoading(true)
    setTelegramLoadError('')
    try {
      const [telegramPayload, messagesPayload] = await Promise.all([
        runOpenClawPluginCommand('config get channels.telegram', { refreshPlugins: false }),
        runOpenClawPluginCommand('config get messages', { refreshPlugins: false }),
      ])
      const telegramFailure = openClawCommandFailure(telegramPayload, 'Telegram configuration could not be read.')
      const messagesFailure = openClawCommandFailure(messagesPayload, 'Telegram acknowledgement settings could not be read.')
      if (telegramFailure) throw new Error(telegramFailure)
      if (messagesFailure) throw new Error(messagesFailure)
      const parsedTelegram = parseTelegramConfigOutput(telegramPayload.command?.output || '')
      const parsedMessages = parseTelegramConfigOutput(messagesPayload.command?.output || '')
      if (!parsedTelegram) throw new Error('The gateway returned an unreadable Telegram configuration.')
      const next = normalizeTelegramSettings({ ...readTelegramSettings(), ...parsedTelegram, ...(parsedMessages || {}) })
      setTelegramSettings(next)
      setTelegramGatewaySettings(next)
      saveTelegramSettings(next)
      setNotice({ tone: 'success', text: 'Telegram settings reloaded from the gateway.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read Telegram settings from the gateway.'
      setTelegramLoadError(message)
      setNotice({ tone: 'warning', text: 'Using saved Telegram settings until the gateway is available.' })
    } finally {
      setTelegramLoaded(true)
      setTelegramLoading(false)
    }
  }, [telegramLoading])

  const applyTelegramSettings = async (settings = telegramSettings) => {
    if (telegramSaving) return
    const next = normalizeTelegramSettings(settings)
    setTelegramSaving(true)
    setTelegramLoadError('')
    try {
      const changedKeys = telegramSettingCommandEntries(next)
        .filter(({ key }) => next[key] !== telegramGatewaySettings[key])
        .map(({ key }) => key)
      if (!changedKeys.length) {
        setTelegramSettings(next)
        saveTelegramSettings(next)
        setNotice({ tone: 'success', text: 'Telegram settings are already synchronized with the gateway.' })
        return
      }
      const command = telegramSettingBatchCommand(next, changedKeys)
      setNotice({ tone: 'neutral', text: `Applying ${changedKeys.length} Telegram setting${changedKeys.length === 1 ? '' : 's'} in one gateway update…` })
      const payload = await runOpenClawPluginCommand(command, { refreshPlugins: false })
      const failure = openClawCommandFailure(payload, 'OpenClaw rejected the Telegram settings update.')
      if (failure) throw new Error(failure)
      const restart = await restartPluginGateway()
      if (restart.ok === false || restart.error) throw new Error(restart.error || 'Gateway restart failed.')
      setTelegramSettings(next)
      setTelegramGatewaySettings(next)
      saveTelegramSettings(next)
      setNotice({ tone: 'success', text: 'Telegram settings applied. Gateway restarted with the new policy.' })
    } catch (error) {
      setNotice({ tone: 'error', text: `Telegram settings were only partially applied: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setTelegramSaving(false)
    }
  }

  useEffect(() => {
    if (activeSection === 'telegram' && !telegramLoaded && !telegramLoading) void loadTelegramFromGateway()
  }, [activeSection, telegramLoaded, telegramLoading, loadTelegramFromGateway])

  const applyRuntimeToTargets = (values = activeRuntimeDraft, reset = false) => {
    if (!targetIds.length) {
      setNotice({ tone: 'warning', text: `No ${targetScope === 'party' ? 'party' : 'selected'} agents are available to update.` })
      return
    }
    for (const id of targetIds) {
      updateHeartbeat(id, {
        tickIntervalMs: Math.max(5, Math.round(values.heartbeatSeconds)) * 1_000,
        idleTimeoutMs: Math.max(5, Math.round(values.idleTimeoutSeconds)) * 1_000,
        continuous: values.continuous,
        recoveryMode: values.recoveryMode,
      })
      updateAgentRuntimePolicy(id, {
        timeoutSeconds: Math.max(1, Math.round(values.timeoutMinutes)) * 60,
        thinkingDefault: values.thinkingDefault,
        fastModeDefault: values.fastModeDefault,
        parallelPreferred: values.parallelPreferred,
      })
    }
    setPendingConfirmation(null)
    setNotice({ tone: 'success', text: `${reset ? 'Default runtime restored for' : 'Runtime policy applied to'} ${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}.` })
  }

  const toggleRuntimeTarget = (agentId: string) => {
    selectAgent(agentId, { toggle: true })
    setTargetScope('selection')
  }

  const resetAppearance = () => {
    saveUiSettings(DEFAULT_UI_SETTINGS)
    applyUiSettings(DEFAULT_UI_SETTINGS)
    setUiSettings(DEFAULT_UI_SETTINGS)
    announceSaved('Appearance defaults')
  }

  const resetWorkspace = () => {
    saveRegistryPreferences(DEFAULT_REGISTRY_PREFERENCES)
    saveConsolePreferences(DEFAULT_CONSOLE_PREFERENCES)
    setRegistryPreferences(DEFAULT_REGISTRY_PREFERENCES)
    setConsolePreferences(DEFAULT_CONSOLE_PREFERENCES)
    announceSaved('Workspace defaults')
  }

  const resetVoice = () => {
    saveSpeechSettings(DEFAULT_SPEECH_SETTINGS)
    setSpeechSettings(DEFAULT_SPEECH_SETTINGS)
    announceSaved('Voice defaults')
  }

  const resetAllSettings = () => {
    resetAppearance()
    saveRegistryPreferences(DEFAULT_REGISTRY_PREFERENCES)
    saveConsolePreferences(DEFAULT_CONSOLE_PREFERENCES)
    saveSpeechSettings(DEFAULT_SPEECH_SETTINGS)
    saveChannelActivitySettings(DEFAULT_CHANNEL_ACTIVITY_SETTINGS)
    setRegistryPreferences(DEFAULT_REGISTRY_PREFERENCES)
    setConsolePreferences(DEFAULT_CONSOLE_PREFERENCES)
    setSpeechSettings(DEFAULT_SPEECH_SETTINGS)
    clearAllCommandConsoleDrafts()
    window.localStorage.removeItem('automnia-monitor-doctor-dismissed-run')
    resetMission()
    setPendingConfirmation(null)
    setNotice({ tone: 'success', text: 'All app preferences and mission defaults were restored. Agents, credentials, plugins, and files were kept.' })
  }

  const copySettingsBackup = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        version: 1,
        [UI_SETTINGS_STORAGE_KEY]: uiSettings,
        [CHANNEL_ACTIVITY_SETTINGS_STORAGE_KEY]: readChannelActivitySettings(),
        speech: speechSettings,
        registry: registryPreferences,
        console: consolePreferences,
        mission: missionDraft,
      }, null, 2))
      setNotice({ tone: 'success', text: 'Settings backup copied to the clipboard.' })
    } catch {
      setNotice({ tone: 'error', text: 'Could not copy the backup. Check clipboard permission and try again.' })
    }
  }

  const renderAppearance = () => (
    <div className="dui-settings-section" id="settings-section-appearance" role="tabpanel">
      <SectionHeader section="appearance" eyebrow="Personalize Automnia" />
      <SettingsCard title="Color and surfaces" description="Applied live across every workspace.">
        <Field label="Accent mode" hint="Changes active controls, status color and highlights.">
          <select value={uiSettings.accentMode} onChange={(event) => updateUiSetting('accentMode', event.target.value as UiAccentMode, 'Accent mode')}>
            <option value="reference">Reference cyan</option><option value="no-blue">No-blue graphite</option><option value="ember">Amber operations</option><option value="green">Green terminal</option>
          </select>
        </Field>
        <Field label="Form chrome" hint="Input, search, select and composer surfaces.">
          <select value={uiSettings.formChrome} onChange={(event) => updateUiSetting('formChrome', event.target.value as UiFormChrome, 'Form chrome')}>
            <option value="graphite">Graphite</option><option value="obsidian">Obsidian</option><option value="warm">Warm black</option>
          </select>
        </Field>
        <SettingGroup label="Interface density" hint="Controls spacing without shrinking readable text.">
          <div data-dui-setting="density">
            <SegmentedControl value={uiSettings.density} label="Interface density" options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'spacious', label: 'Spacious' }]} onChange={(value: UiDensity) => updateUiSetting('density', value, 'Interface density')} />
          </div>
        </SettingGroup>
      </SettingsCard>
      <SettingsCard title="Accessibility and effects" description="Make the interface calmer or easier to read.">
        <SettingGroup label="Motion" hint="Reduced removes most animation and smooth transitions.">
          <div data-dui-setting="motion">
            <SegmentedControl value={uiSettings.motion} label="Motion preference" options={[{ id: 'standard', label: 'Standard' }, { id: 'reduced', label: 'Reduced' }]} onChange={(value: UiMotion) => updateUiSetting('motion', value, 'Motion preference')} />
          </div>
        </SettingGroup>
        <ToggleField label="High contrast" hint="Raises muted text, borders, placeholders and focus rings." checked={uiSettings.highContrast} onChange={(value) => updateUiSetting('highContrast', value, 'High contrast')} />
        <ToggleField label="Reduced glow" hint="Removes nonessential bloom and halo effects." checked={uiSettings.reducedGlow} onChange={(value) => updateUiSetting('reducedGlow', value, 'Reduced glow')} />
        <ToggleField label="Control glow" hint="Adds a restrained highlight to active controls." checked={uiSettings.controlGlow} disabled={uiSettings.reducedGlow} onChange={(value) => updateUiSetting('controlGlow', value, 'Control glow')} />
        <ToggleField label="Neutral scrollbars" hint="Uses graphite instead of accent-colored scrollbar thumbs." checked={uiSettings.neutralScrollbars} onChange={(value) => updateUiSetting('neutralScrollbars', value, 'Scrollbar style')} />
        <div className="dui-settings-actions"><button type="button" onClick={resetAppearance}>Restore appearance defaults</button></div>
      </SettingsCard>
    </div>
  )

  const renderWorkspace = () => (
    <div className="dui-settings-section" id="settings-section-workspace" role="tabpanel">
      <SectionHeader section="workspace" eyebrow="Choose how daily work is arranged" />
      <SettingsCard title="Agent registry" description="These controls update the live Agents workspace.">
        <Field label="Default view" hint="Simple is the 9-agent default; Detailed shows 12 cards with runtime info.">
          <select value={registryPreferences.displayMode} onChange={(event) => updateRegistryPreferences({ displayMode: event.target.value as AgentDisplayMode }, 'Registry view')}>
            {REGISTRY_DISPLAY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.hint}</option>)}
          </select>
        </Field>
        <ToggleField
          label="Use rarity colors"
          hint="Legendary uses Original, Epic uses Purple, Rare uses Blueprint and Common uses Graphite."
          checked={registryPreferences.rarityColorsEnabled}
          onChange={(value) => updateRegistryPreferences({
            rarityColorsEnabled: value,
            ...(value || registryPreferences.overlayPreset !== 'rarity' ? {} : { overlayPreset: 'graphite-glass' as AgentOverlayPreset }),
          }, value ? 'Agent card rarity colors' : 'Shared agent card theme')}
        />
        {!registryPreferences.rarityColorsEnabled && (
          <Field label="Card background" hint="One shared visual treatment behind every agent portrait.">
            <select
              value={registryPreferences.overlayPreset}
              onChange={(event) => updateRegistryPreferences({ overlayPreset: event.target.value as AgentOverlayPreset }, 'Agent card background')}
            >
              {REGISTRY_OVERLAY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.hint}</option>)}
            </select>
          </Field>
        )}
        <Field label="Default sort" hint="Determines which agents appear first.">
          <select value={registryPreferences.sortKey} onChange={(event) => updateRegistryPreferences({ sortKey: event.target.value as RegistrySortKey }, 'Registry sorting')}>
            <option value="party">Party first</option><option value="level">Highest level</option><option value="name">Name A–Z</option><option value="rarity">Rarity</option>
          </select>
        </Field>
        <Field label="Rarity filter" hint="Persist a focused registry or show the full roster.">
          <select value={registryPreferences.rarityFilter} onChange={(event) => updateRegistryPreferences({ rarityFilter: event.target.value as RegistryPreferences['rarityFilter'] }, 'Registry filter')}>
            <option value="all">All rarities</option><option value="legendary">Legendary</option><option value="epic">Epic</option><option value="rare">Rare</option><option value="common">Common</option>
          </select>
        </Field>
      </SettingsCard>
      <SettingsCard title="Command console" description="Layout and draft behavior for conversations with agents.">
        <ToggleField label="Show console in Agents" hint="Hide it for a full-width registry; restore it here at any time." checked={consolePreferences.visible} onChange={(value) => updateConsolePreferences({ visible: value }, 'Console visibility')} />
        <Field label={`Console width · ${consolePreferences.width}px`} hint="The live split view clamps this value when the window is narrow.">
          <input type="range" min={360} max={760} step={20} value={consolePreferences.width} onChange={(event) => updateConsolePreferences({ width: Number(event.target.value) }, 'Console width')} />
        </Field>
        <ToggleField label="Remember unfinished drafts" hint="Restores unsent command text after a reload. Turning this off clears stored drafts." checked={consolePreferences.rememberDrafts} onChange={(value) => updateConsolePreferences({ rememberDrafts: value }, 'Draft persistence')} />
        <div className="dui-settings-actions"><button type="button" onClick={resetWorkspace}>Restore workspace defaults</button><button type="button" onClick={() => setTab('agents')}>Open Agents</button></div>
      </SettingsCard>
    </div>
  )

  const renderVoice = () => (
    <div className="dui-settings-section" id="settings-section-voice" role="tabpanel">
      <SectionHeader section="voice" eyebrow="Fast dictation with explicit privacy controls" />
      <SettingsCard title="Transcription engine" description="Local stays on-device after its one-time model download. Cloud uses the configured OpenAI provider.">
        <SettingGroup label="Provider" hint="The microphone button uses this selection immediately.">
          <div className="dui-settings-voice-mode" role="group" aria-label="Voice transcription provider" data-mode={speechSettings.mode}>
            {([{ id: 'local', label: 'Local', detail: 'Private · on-device' }, { id: 'online', label: 'Cloud', detail: 'OpenAI · highest accuracy' }] as Array<{ id: SpeechTranscriptionMode; label: string; detail: string }>).map((option) => (
              <button key={option.id} type="button" aria-pressed={speechSettings.mode === option.id} onClick={() => updateSpeechSettings({ mode: option.id }, 'Voice provider')}>
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </button>
            ))}
          </div>
        </SettingGroup>
      </SettingsCard>
      <SettingsCard title="Recording behavior" description="Tune responsiveness without changing the transcription model.">
        <ToggleField label="Stop after a pause" hint="Automatically transcribes when speech ends; turn off for manual stop only." checked={speechSettings.autoStop} onChange={(value) => updateSpeechSettings({ autoStop: value }, 'Automatic pause detection')} />
        <Field label={`Pause sensitivity · ${(speechSettings.pauseDurationMs / 1_000).toFixed(2)}s`} hint="Longer values are better when you pause while thinking.">
          <input type="range" min={600} max={3000} step={50} value={speechSettings.pauseDurationMs} disabled={!speechSettings.autoStop} onChange={(event) => updateSpeechSettings({ pauseDurationMs: Number(event.target.value) }, 'Pause sensitivity')} />
        </Field>
        <Field label="Maximum recording" hint="A safety limit for an uninterrupted recording.">
          <select value={speechSettings.maxRecordingSeconds} onChange={(event) => updateSpeechSettings({ maxRecordingSeconds: Number(event.target.value) }, 'Maximum recording length')}>
            <option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option>
          </select>
        </Field>
      </SettingsCard>
      <SettingsCard title="Microphone processing" description="Browser-level audio cleanup applied before local or cloud transcription.">
        <ToggleField label="Noise suppression" hint="Reduces fans, room noise and steady background sound." checked={speechSettings.noiseSuppression} onChange={(value) => updateSpeechSettings({ noiseSuppression: value }, 'Noise suppression')} />
        <ToggleField label="Echo cancellation" hint="Reduces speaker audio feeding back into the microphone." checked={speechSettings.echoCancellation} onChange={(value) => updateSpeechSettings({ echoCancellation: value }, 'Echo cancellation')} />
        <ToggleField label="Automatic gain" hint="Raises quiet speech and evens out microphone volume." checked={speechSettings.autoGainControl} onChange={(value) => updateSpeechSettings({ autoGainControl: value }, 'Automatic microphone gain')} />
        <div className="dui-settings-actions"><button type="button" onClick={resetVoice}>Restore voice defaults</button></div>
      </SettingsCard>
    </div>
  )

  const renderMissions = () => {
    const requirements = missionDraft.requiredEvidence || DEFAULT_MISSION_DRAFT.requiredEvidence || []
    return (
      <div className="dui-settings-section" id="settings-section-missions" role="tabpanel">
        <SectionHeader section="missions" eyebrow="Define a reliable starting point" />
        <SettingsCard title="Next mission defaults" description="Changes appear immediately in the Missions workspace.">
          <Field label="Mission title"><input value={missionDraft.title} onChange={(event) => updateMissionDraft({ title: event.target.value })} /></Field>
          <Field label="Default objective" hint="Use a concrete instruction that can be verified."><textarea rows={4} value={missionDraft.description} onChange={(event) => updateMissionDraft({ description: event.target.value })} /></Field>
          <Field label="Mission type"><select value={missionDraft.missionType} onChange={(event) => updateMissionDraft({ missionType: event.target.value as CapabilityKey })}>{MISSION_TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Collaboration"><select value={missionDraft.collaborationMode} onChange={(event) => updateMissionDraft({ collaborationMode: event.target.value as CollaborationMode })}>{COLLABORATION_MODES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Duration mode"><select value={missionDraft.durationMode} onChange={(event) => updateMissionDraft({ durationMode: event.target.value as DurationMode })}><option value="instant">Instant</option><option value="timed">Timed</option><option value="continuous">Continuous</option><option value="indefinite">Indefinite</option></select></Field>
          <Field label="Duration amount" hint="Used for timed missions."><div className="dui-settings-inline"><input type="number" min={1} disabled={missionDraft.durationMode !== 'timed'} value={missionDraft.durationValue} onChange={(event) => updateMissionDraft({ durationValue: Number(event.target.value) })} /><select disabled={missionDraft.durationMode !== 'timed'} value={missionDraft.durationUnit} onChange={(event) => updateMissionDraft({ durationUnit: event.target.value as DurationUnit })}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div></Field>
          <Field label={`Complexity · ${missionDraft.complexity}%`}><input type="range" min={1} max={100} value={missionDraft.complexity} onChange={(event) => updateMissionDraft({ complexity: Number(event.target.value) })} /></Field>
          <Field label={`Risk tolerance · ${missionDraft.riskTolerance}%`}><input type="range" min={1} max={100} value={missionDraft.riskTolerance} onChange={(event) => updateMissionDraft({ riskTolerance: Number(event.target.value) })} /></Field>
        </SettingsCard>
        <SettingsCard title="Required evidence" description="Choose which proof the mission must collect before it can be considered complete.">
          <div className="dui-settings-checklist">
            {requirements.map((requirement) => (
              <ToggleField key={requirement.kind} label={requirement.label} hint={requirement.command ? `Verification: ${requirement.command}` : undefined} checked={requirement.required} onChange={(required) => updateMissionDraft({ requiredEvidence: requirements.map((entry) => entry.kind === requirement.kind ? { ...entry, required } : entry) })} />
            ))}
          </div>
          <div className="dui-settings-actions"><button type="button" onClick={resetMission}>Restore mission defaults</button><button type="button" onClick={() => setTab('missions')}>Open Missions</button></div>
        </SettingsCard>
      </div>
    )
  }

  const renderAgents = () => (
    <div className="dui-settings-section" id="settings-section-agents" role="tabpanel">
      <SectionHeader section="agents" eyebrow="Bulk policy with an explicit target" />
      <SettingsCard title="Target agents" description="Bulk settings use Apply intentionally so an accidental slider movement cannot overwrite an entire party.">
        <div className="dui-settings-targeting" data-target-scope={targetScope}>
          <div className="dui-settings-targeting__head">
            <div><span>Apply to</span><strong>{targetIds.length ? `${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}` : 'No target selected'}</strong></div>
            <SegmentedControl value={targetScope} label="Runtime target source" options={[{ id: 'party', label: `Party ${partyTargetIds.length}` }, { id: 'selection', label: `Selected ${selectedTargetIds.length}` }]} onChange={setTargetScope} />
          </div>
          <div className="dui-settings-agent-targets" aria-label="Agent runtime target selector">
            {agents.map((agent) => {
              const selected = selectedTargetIds.includes(agent.id)
              const targeted = targetIds.includes(agent.id)
              return <button key={agent.id} type="button" aria-pressed={selected} data-target={targeted} onClick={() => toggleRuntimeTarget(agent.id)}><span>{agent.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><strong>{agent.name}</strong><small>{targeted ? 'Target' : selected ? 'Selected' : 'Add'}</small></button>
            })}
          </div>
          {selectedTargetIds.length > 0 && <button type="button" className="dui-settings-clear-targets" onClick={clearSelectedAgents}>Clear manual selection</button>}
        </div>
      </SettingsCard>
      <SettingsCard title="Heartbeat and recovery" description="Controls when agents wake and how they recover from interruptions.">
        <Field label="Heartbeat cadence" hint="Seconds between runtime pulses."><input type="number" min={5} max={1800} value={activeRuntimeDraft.heartbeatSeconds} onChange={(event) => updateRuntimeDraft({ heartbeatSeconds: Number(event.target.value) })} /></Field>
        <Field label="Idle timeout" hint="Seconds before an inactive agent yields its loop."><input type="number" min={5} max={1800} value={activeRuntimeDraft.idleTimeoutSeconds} onChange={(event) => updateRuntimeDraft({ idleTimeoutSeconds: Number(event.target.value) })} /></Field>
        <ToggleField label="Continuous heartbeat" hint="Keeps the runtime loop active between ticks." checked={activeRuntimeDraft.continuous} onChange={(continuous) => updateRuntimeDraft({ continuous })} />
        <ToggleField label="Automatic recovery" hint="Retries after a recoverable runtime failure." checked={activeRuntimeDraft.recoveryMode} onChange={(recoveryMode) => updateRuntimeDraft({ recoveryMode })} />
      </SettingsCard>
      <SettingsCard title="Reasoning and execution" description="Defaults used for future turns by the targeted agents.">
        <Field label="Work timeout" hint="Maximum minutes for an agent turn."><input type="number" min={1} max={120} value={activeRuntimeDraft.timeoutMinutes} onChange={(event) => updateRuntimeDraft({ timeoutMinutes: Number(event.target.value) })} /></Field>
        <Field label="Thinking default"><select value={activeRuntimeDraft.thinkingDefault} onChange={(event) => updateRuntimeDraft({ thinkingDefault: event.target.value as ThinkingLevel })}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option></select></Field>
        <Field label="Fast mode"><select value={activeRuntimeDraft.fastModeDefault} onChange={(event) => updateRuntimeDraft({ fastModeDefault: event.target.value as FastModeDefault })}><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></select></Field>
        <ToggleField label="Parallel preferred" hint="Allows independent subtasks to run together where supported." checked={activeRuntimeDraft.parallelPreferred} onChange={(parallelPreferred) => updateRuntimeDraft({ parallelPreferred })} />
        <div className="dui-settings-actions"><button type="button" className="is-primary" onClick={() => applyRuntimeToTargets()}>Apply to {targetIds.length || 0} agent{targetIds.length === 1 ? '' : 's'}</button><button type="button" onClick={() => { setRuntimeDraft({ targetKey: runtimeTargetKey, values: DEFAULT_RUNTIME_SETTINGS }); setPendingConfirmation('reset-runtime') }}>Restore runtime defaults</button></div>
      </SettingsCard>
    </div>
  )

  const renderTelegram = () => (
    <div className="dui-settings-section" id="settings-section-telegram" role="tabpanel">
      <SectionHeader section="telegram" eyebrow="Control the live Telegram gateway" />
      <SettingsCard title="Access and commands" description="Keep private chats paired and groups allowlisted unless you intentionally run a public bot.">
        <Field label="Native command menu" hint="Registers OpenClaw commands such as /agents with Telegram.">
          <select value={telegramSettings.nativeCommands} onChange={(event) => updateTelegramDraft('nativeCommands', event.target.value as TelegramSettings['nativeCommands'])}>
            <option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Direct-message policy" hint="Pairing is the safe default for owner-operated bots.">
          <select value={telegramSettings.dmPolicy} onChange={(event) => updateTelegramDraft('dmPolicy', event.target.value as TelegramSettings['dmPolicy'])}>
            <option value="pairing">Pairing</option><option value="allowlist">Allowlist</option><option value="open">Open</option><option value="disabled">Disabled</option>
          </select>
        </Field>
        <Field label="Group policy" hint="Allowlist blocks unknown groups until they are explicitly configured.">
          <select value={telegramSettings.groupPolicy} onChange={(event) => updateTelegramDraft('groupPolicy', event.target.value as TelegramSettings['groupPolicy'])}>
            <option value="allowlist">Allowlist</option><option value="open">Open</option><option value="disabled">Disabled</option>
          </select>
        </Field>
        <ToggleField label="Allow Telegram config writes" hint="Required for Telegram-triggered /config changes and group migration writes." checked={telegramSettings.configWrites} onChange={(value) => updateTelegramDraft('configWrites', value)} />
      </SettingsCard>

      <SettingsCard title="Delivery and formatting" description="Tune how the bot streams work, renders messages and handles replies.">
        <Field label="Streaming mode" hint="Progress shows tool status while keeping the final answer clean.">
          <select value={telegramSettings.streamingMode} onChange={(event) => updateTelegramDraft('streamingMode', event.target.value as TelegramSettings['streamingMode'])}>
            <option value="progress">Progress</option><option value="partial">Partial answer preview</option><option value="block">Block streaming</option><option value="off">Off</option>
          </select>
        </Field>
        <ToggleField label="Show tool progress" hint="Reuses the editable preview for short status updates while an agent works." checked={telegramSettings.toolProgress} onChange={(value) => updateTelegramDraft('toolProgress', value)} />
        <ToggleField label="Link previews" hint="Let Telegram expand URLs in rich text." checked={telegramSettings.linkPreview} onChange={(value) => updateTelegramDraft('linkPreview', value)} />
        <Field label="Reply mode" hint="Native quote replies can be useful in busy group chats.">
          <select value={telegramSettings.replyToMode} onChange={(event) => updateTelegramDraft('replyToMode', event.target.value as TelegramSettings['replyToMode'])}>
            <option value="off">Off</option><option value="first">Reply to first message</option><option value="all">Reply to every message</option>
          </select>
        </Field>
        <Field label="Inline button scope" hint="Allowlist requires an explicit Telegram approval surface.">
          <select value={telegramSettings.inlineButtons} onChange={(event) => updateTelegramDraft('inlineButtons', event.target.value as TelegramSettings['inlineButtons'])}>
            <option value="allowlist">Allowlist</option><option value="dm">Direct messages</option><option value="group">Groups</option><option value="all">Every chat</option><option value="off">Off</option>
          </select>
        </Field>
        <ToggleField label="Rich messages" hint="Off is most compatible with older Telegram clients." checked={telegramSettings.richMessages} onChange={(value) => updateTelegramDraft('richMessages', value)} />
      </SettingsCard>

      <SettingsCard title="History, media and recovery" description="Bound context and payload size to reduce overflow and delivery failures.">
        <Field label="Group history messages" hint="Set 0 to disable the bounded group context window."><input type="number" min={0} max={200} value={telegramSettings.historyLimit} onChange={(event) => updateTelegramDraft('historyLimit', Number(event.target.value))} /></Field>
        <Field label="DM history messages" hint="Keeps private chats from growing without limit."><input type="number" min={0} max={200} value={telegramSettings.dmHistoryLimit} onChange={(event) => updateTelegramDraft('dmHistoryLimit', Number(event.target.value))} /></Field>
        <Field label="Text chunk limit" hint="Telegram-safe message size; lower it if clients reject long replies."><input type="number" min={100} max={4096} value={telegramSettings.textChunkLimit} onChange={(event) => updateTelegramDraft('textChunkLimit', Number(event.target.value))} /></Field>
        <Field label="Media limit (MB)" hint="Caps inbound and outbound Telegram media."><input type="number" min={1} max={2000} value={telegramSettings.mediaMaxMb} onChange={(event) => updateTelegramDraft('mediaMaxMb', Number(event.target.value))} /></Field>
        <Field label="Error replies" hint="Choose whether provider or delivery errors are sent back to the chat.">
          <select value={telegramSettings.errorPolicy} onChange={(event) => updateTelegramDraft('errorPolicy', event.target.value as TelegramSettings['errorPolicy'])}>
            <option value="always">Always</option><option value="once">Once per cooldown</option><option value="silent">Silent</option>
          </select>
        </Field>
      </SettingsCard>

      <SettingsCard title="Actions and reactions" description="Outbound actions are explicit controls. Enable only the operations your bot actually needs.">
        <ToggleField label="Send messages to targets" hint="Allows agent tools to send a separate Telegram message." checked={telegramSettings.sendMessage} onChange={(value) => updateTelegramDraft('sendMessage', value)} />
        <ToggleField label="Delete messages" hint="Allows agent tools to remove Telegram messages." checked={telegramSettings.deleteMessage} onChange={(value) => updateTelegramDraft('deleteMessage', value)} />
        <ToggleField label="Reactions action" hint="Allows agents to add or remove Telegram reactions." checked={telegramSettings.reactions} onChange={(value) => updateTelegramDraft('reactions', value)} />
        <ToggleField label="Sticker actions" hint="Enables sticker send and sticker-search actions." checked={telegramSettings.sticker} onChange={(value) => updateTelegramDraft('sticker', value)} />
        <ToggleField label="Poll actions" hint="Enables poll creation; regular sends must also be enabled." checked={telegramSettings.poll} onChange={(value) => updateTelegramDraft('poll', value)} />
        <Field label="Reaction notifications" hint="Receive reaction events from your own messages or every message.">
          <select value={telegramSettings.reactionNotifications} onChange={(event) => updateTelegramDraft('reactionNotifications', event.target.value as TelegramSettings['reactionNotifications'])}>
            <option value="own">Own messages</option><option value="all">All messages</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Reaction detail" hint="Controls how much context is included in reaction events.">
          <select value={telegramSettings.reactionLevel} onChange={(event) => updateTelegramDraft('reactionLevel', event.target.value as TelegramSettings['reactionLevel'])}>
            <option value="minimal">Minimal</option><option value="ack">Acknowledgement only</option><option value="extensive">Extensive</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Acknowledgement reaction scope" hint="Requires a gateway restart and defaults to group mentions only.">
          <select value={telegramSettings.ackReactionScope} onChange={(event) => updateTelegramDraft('ackReactionScope', event.target.value as TelegramSettings['ackReactionScope'])}>
            <option value="group-mentions">Group mentions</option><option value="direct">Direct messages</option><option value="group-all">All group messages</option><option value="all">All chats</option><option value="off">Off</option>
          </select>
        </Field>
        <div className="dui-settings-actions">
          <button type="button" onClick={() => void loadTelegramFromGateway()} disabled={telegramLoading || telegramSaving}>{telegramLoading ? 'Reloading…' : 'Reload from gateway'}</button>
          <button type="button" onClick={() => { const next = normalizeTelegramSettings(DEFAULT_TELEGRAM_SETTINGS); setTelegramSettings(next); saveTelegramSettings(next); void applyTelegramSettings(next) }} disabled={telegramLoading || telegramSaving}>{telegramSaving ? 'Applying…' : 'Restore safe defaults'}</button>
          <button type="button" className="is-primary" onClick={() => void applyTelegramSettings()} disabled={telegramLoading || telegramSaving}>{telegramSaving ? 'Applying and restarting…' : 'Apply Telegram settings'}</button>
        </div>
        {telegramLoadError && <p role="alert" style={{ color: '#fbbf24', margin: '0.7rem 0 0', fontSize: '0.82rem' }}>{telegramLoadError}</p>}
        <p style={{ color: '#748791', margin: '0.7rem 0 0', fontSize: '0.78rem' }}>Bot tokens, allowlist IDs, webhook secrets and proxy credentials are intentionally not shown or changed here.</p>
      </SettingsCard>
    </div>
  )

  const renderData = () => (
    <div className="dui-settings-section" id="settings-section-data" role="tabpanel">
      <SectionHeader section="data" eyebrow="Back up, clean up and recover safely" />
      <SettingsCard title="Settings backup" description="Copies non-secret preferences and the current mission draft. Credentials are never included.">
        <div className="dui-settings-metrics"><div><span>Agents</span><strong>{agents.length}</strong></div><div><span>Party</span><strong>{activePartyIds.length}</strong></div><div><span>Responses</span><strong>{responseCount}</strong></div></div>
        <div className="dui-settings-actions"><button type="button" onClick={() => void copySettingsBackup()}>Copy settings backup</button></div>
      </SettingsCard>
      <SettingsCard title="Cleanup" description="Clear temporary interface state without deleting agents or credentials.">
        <div className="dui-settings-actions dui-settings-actions--stack"><button type="button" onClick={() => { const count = clearAllCommandConsoleDrafts(); setNotice({ tone: 'success', text: `Cleared ${count} stored command draft${count === 1 ? '' : 's'}.` }) }}>Clear command drafts</button><button type="button" onClick={() => { clearAgentResponses(); setNotice({ tone: 'success', text: 'Command console responses cleared.' }) }}>Clear console responses</button><button type="button" onClick={() => { resetSimulation(); setNotice({ tone: 'success', text: 'Runtime simulation state reset.' }) }}>Reset runtime simulation</button></div>
      </SettingsCard>
      <SettingsCard title="Recovery" description="Restore known-good defaults while preserving valuable data.">
        <div className="dui-settings-recovery"><strong>Reset all app preferences</strong><p>Restores appearance, workspace, voice and mission defaults. Agents, provider credentials, plugins, workspaces and files are kept.</p><button type="button" onClick={() => setPendingConfirmation('reset-all')}>Reset all preferences</button></div>
        <div className="dui-settings-recovery is-danger"><strong>Clear active workspace state</strong><p>Removes the current party and command responses. Rostered agents remain available.</p><button type="button" onClick={() => setPendingConfirmation('clear-workspace')}>Clear party and responses</button></div>
      </SettingsCard>
    </div>
  )

  const renderAccount = () => {
    const entitlement = resolveLicenseEntitlement(license)
    const hostedCredits = entitlement.isHosted
    const isByok = entitlement.isByok
    const byokAllowed = entitlement.byokAllowed
    const usagePriorityLocked = entitlement.usagePriorityLocked
    const usagePriorityManaged = (hostedCredits || isByok) && !usagePriorityLocked
    const usagePriority = license?.usagePriority === 'provider_first'
      ? byokAllowed ? 'provider_first' : 'automnia_only'
      : license?.usagePriority === 'automnia_first_with_provider_fallback'
        ? byokAllowed ? 'automnia_first_with_provider_fallback' : 'automnia_only'
        : 'automnia_only'
    const balance = hostedCredits || isByok ? formatCreditBalance(license?.creditBalance) : 'Not applicable — provider-billed'
    const refreshAccount = async () => {
      if (accountRefreshBusy) return
      setAccountRefreshBusy(true)
      setAccountRefreshError('')
      try {
        await refreshLicense()
      } catch (error) {
        setAccountRefreshError(error instanceof Error ? error.message : 'Could not refresh the account balance.')
      } finally {
        setAccountRefreshBusy(false)
      }
    }
    const openCheckout = async () => {
      if (checkoutBusy) return
      setCheckoutBusy(true)
      setCheckoutError('')
      try {
        await openSubscriptionCheckout()
      } catch (error) {
        setCheckoutError(error instanceof Error ? error.message : 'Could not open Shopify checkout.')
      } finally {
        setCheckoutBusy(false)
      }
    }
    const saveUsagePriority = async (nextPriority: 'automnia_only' | 'provider_first' | 'automnia_first_with_provider_fallback') => {
      if (!usagePriorityManaged || usagePriorityBusy || nextPriority === usagePriority) return
      if (usagePriorityLocked) {
        setUsagePriorityError('Starter Subscription ($19.99) and credit-refill access stay on Automnia credits. Upgrade to BYOK ($29.99) or higher to choose another usage priority.')
        return
      }
      if (!byokAllowed && nextPriority !== 'automnia_only') {
        setUsagePriorityError('Starter uses Automnia credits only. Upgrade to BYOK ($29.99) or higher for provider-plus-Automnia options.')
        return
      }
      setUsagePriorityBusy(true)
      setUsagePriorityError('')
      try {
        await setUsagePriority(nextPriority)
        setNotice({
          tone: 'success',
          text: nextPriority === 'provider_first'
            ? 'Usage priority saved and Gateway synchronized: your provider first, with Automnia credits as fallback.'
            : nextPriority === 'automnia_first_with_provider_fallback'
              ? 'Usage priority saved and Gateway synchronized: Automnia credits first, with your provider as fallback.'
              : usagePriorityLocked
                ? 'Usage priority saved and Gateway synchronized: Automnia credits only.'
                : 'Usage priority saved and Gateway synchronized: Automnia credits first, with your provider used if credits are exhausted.',
        })
      } catch (error) {
        setUsagePriorityError(error instanceof Error ? error.message : 'Could not save the usage priority.')
      } finally {
        setUsagePriorityBusy(false)
      }
    }

    const savePassword = async () => {
      setPasswordChangeError('')
      if (!account) {
        setPasswordChangeError('Account security details are still loading. Try again in a moment.')
        return
      }
      if (newPassword.length < 12 || newPassword.length > 128) {
        setPasswordChangeError('Choose a password between 12 and 128 characters.')
        return
      }
      if (account.hasPassword && currentPassword.length < 1) {
        setPasswordChangeError('Enter your current password to change it.')
        return
      }
      if (!account.hasPassword && !account.googleLinked) {
        setPasswordChangeError('Sign in with Google again before creating an Automnia password for this account.')
        return
      }
      if (newPassword !== confirmNewPassword) {
        setPasswordChangeError('The new passwords do not match.')
        return
      }
      setPasswordChangeBusy(true)
      try {
        if (account.hasPassword) await changePassword(currentPassword, newPassword)
        else await setPassword(newPassword)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
        setNotice({
          tone: 'success',
          text: account.hasPassword
            ? 'Password changed. Your existing session remains active.'
            : 'Password created. You can now sign in with your Automnia email and password as well as Google.',
        })
      } catch (error) {
        setPasswordChangeError(error instanceof Error ? error.message : 'Could not change the password.')
      } finally {
        setPasswordChangeBusy(false)
      }
    }

    const reconnectGoogleForPassword = async () => {
      setPasswordChangeError('')
      setGoogleReconnectBusy(true)
      try {
        await loginWithGoogle()
        setNotice({ tone: 'success', text: 'Google is connected. You can now create an Automnia password without entering a current password.' })
      } catch (error) {
        setPasswordChangeError(error instanceof Error ? error.message : 'Google could not be connected. Try again.')
      } finally {
        setGoogleReconnectBusy(false)
      }
    }

    return (
      <div className="dui-settings-section" id="settings-section-account" role="tabpanel">
        <SectionHeader section="account" eyebrow="Automnia AI Nexus Plan, Access & Billing" />
        <div className="dui-settings-account-hero">
          <div>
            <span>Signed in as</span>
            <strong>{license?.email || 'Account email unavailable'}</strong>
            <small>{account?.googleLinked ? 'Google sign-in linked' : account?.hasPassword ? 'Automnia password enabled' : account ? 'Google connection required for password setup' : 'Account security details loading'}</small>
          </div>
          <div data-tone={license?.active ? 'active' : 'inactive'}>
            <span>Access status</span>
            <strong>{entitlement.statusLabel}</strong>
            <small>{entitlement.tierLabel} · {entitlement.billingLabel}</small>
          </div>
        </div>
        <SettingsCard title="Profile & security" description="Your email is read-only. Manage the optional Automnia password here without interrupting the current session.">
          <Field label="Account Email" hint="Registered subscriber address.">
            <input type="text" readOnly value={license?.email || 'Not reported'} style={{ fontWeight: 'bold', backgroundColor: 'rgba(255, 255, 255, 0.05)', cursor: 'not-allowed' }} />
          </Field>
          <div className="dui-settings-account-password" aria-labelledby="account-password-title">
            <div className="dui-settings-account-password__intro">
              <span>Account security</span>
              <h4 id="account-password-title">
                {!account ? 'Account password' : account.hasPassword ? 'Change account password' : account.googleLinked ? 'Create an account password' : 'Connect Google to create a password'}
              </h4>
              <p>
                {checking || !account
                  ? 'Loading whether this account already has a password…'
                  : account.hasPassword
                    ? account.googleLinked
                      ? 'This account already has an Automnia password. Google sign-in remains available; enter the current password only if you want to change it.'
                      : 'This account already has an Automnia password. Enter the current password below to choose a new one.'
                    : account.googleLinked
                      ? 'Google sign-in is connected. No current password is needed—create one below to enable email and password sign-in too.'
                      : 'This account has no password yet, and Google is not connected on this device. Connect Google first; no password will be changed or removed.'}
              </p>
            </div>
            {!checking && account && !account.googleLinked && !account.hasPassword && (
              <button className="dui-settings-account-password__connect" type="button" onClick={() => void reconnectGoogleForPassword()} disabled={googleReconnectBusy}>
                {googleReconnectBusy ? 'Connecting Google…' : 'Connect Google securely'}
              </button>
            )}
            {!checking && account && (account.hasPassword || account.googleLinked) && <>
              <div className="dui-settings-account-password__form">
                {account.hasPassword && <label className="dui-settings-account-password__field">
                  <span>Current password</span>
                  <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Enter your current password" autoComplete="current-password" maxLength={128} />
                </label>}
                <label className="dui-settings-account-password__field">
                  <span>{account.hasPassword ? 'New password — 12 to 128 characters' : 'Create password — 12 to 128 characters'}</span>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Enter a new password" autoComplete="new-password" minLength={12} maxLength={128} />
                </label>
                <label className="dui-settings-account-password__field">
                  <span>Confirm password</span>
                  <input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Re-enter your new password" autoComplete="new-password" minLength={12} maxLength={128} />
                </label>
                <button className="dui-settings-account-password__submit" type="button" onClick={() => void savePassword()} disabled={passwordChangeBusy || newPassword.length < 12 || newPassword.length > 128 || confirmNewPassword.length < 12 || confirmNewPassword.length > 128 || Boolean(account.hasPassword && currentPassword.length < 1)}>
                  {passwordChangeBusy ? 'Saving password…' : account.hasPassword ? 'Change password' : 'Create password'}
                </button>
              </div>
            </>}
            {passwordChangeError && <p className="dui-settings-account-password__error" role="alert">{passwordChangeError}</p>}
          </div>
        </SettingsCard>
        <SettingsCard title="Plan, access & billing" description="Google Cloud confirms subscription access and reconciles hosted-credit balances after each request without interrupting the workspace.">
          <Field label="License Authorization" hint="The license key remains server-local and is never revealed in the app.">
            <input type="text" readOnly value={license?.active ? 'Active — stored securely on this device' : 'No active license'} style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', cursor: 'not-allowed' }} />
          </Field>
          <Field label="Plan or Access Tier" hint="The exact entitlement activated for this account.">
            <input type="text" readOnly value={entitlement.tierLabel} style={{ fontWeight: 'bold', backgroundColor: 'rgba(255, 255, 255, 0.05)', cursor: 'not-allowed' }} />
          </Field>
          <Field label="Access & Billing Mode" hint="Starter Subscription uses Automnia hosted credits. Higher tiers include hosted credits and provider priority controls.">
            <input type="text" readOnly value={entitlement.billingLabel} style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', cursor: 'not-allowed' }} />
          </Field>
          <Field label="Usage Priority" hint={usagePriorityLocked ? 'Starter Subscription ($19.99) and credit-refill access stay on Automnia credits.' : hostedCredits || isByok ? 'Choose Automnia credits or My provider + Automnia credits. Higher tiers can choose which route runs first.' : 'Activate a permanent or hosted plan to choose a usage priority.'}>
            <select
              value={usagePriorityManaged ? (usagePriority === 'automnia_only' ? 'automnia_only' : 'provider_plus_automnia') : 'automnia_only'}
              disabled={!usagePriorityManaged || usagePriorityBusy || usagePriorityLocked}
              onChange={(event) => void saveUsagePriority(event.target.value === 'automnia_only' ? 'automnia_only' : 'provider_first')}
            >
              <option value="automnia_only">Automnia credits</option>
              <option value="provider_plus_automnia" disabled={!byokAllowed}>My provider + Automnia credits{byokAllowed ? '' : ' — provider access not included'}</option>
            </select>
            {usagePriority !== 'automnia_only' && <div style={{ marginTop: '0.6rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#cbd5e1' }}>
                Fallback order
                <select
                  value={usagePriority}
                  disabled={usagePriorityBusy}
                  onChange={(event) => void saveUsagePriority(event.target.value as 'provider_first' | 'automnia_first_with_provider_fallback')}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem' }}
                >
                  <option value="provider_first">My provider first, Automnia credits fallback</option>
                  <option value="automnia_first_with_provider_fallback">Automnia credits first, my provider fallback</option>
                </select>
              </label>
            </div>}
          </Field>
          <Field label="Effective Agent Route" hint={hostedCredits || isByok ? 'This saved preference applies to normal messages, /runtime, /work, /openclaw, streamed turns, and buffered recovery.' : 'Activate a Cloud Subscription or BYOK license to enable agent messages.'}>
            <input type="text" readOnly value={entitlement.defaultRouteLabel} style={{ fontWeight: 'bold', backgroundColor: hostedCredits ? 'rgba(16, 185, 129, 0.10)' : isByok ? 'rgba(56, 189, 248, 0.10)' : 'rgba(255, 255, 255, 0.05)', cursor: 'not-allowed' }} />
          </Field>
          <section className="dui-settings-billing-summary" data-billing-mode={hostedCredits ? 'hosted' : isByok ? 'byok' : 'inactive'} aria-label="Subscription and credit summary">
            <div className="dui-settings-billing-summary__head">
              <div>
                <span>Automnia billing</span>
                <strong>{hostedCredits ? entitlement.tierLabel : isByok ? 'BYOK access' : 'Plan status'}</strong>
                <small>{hostedCredits || isByok ? usagePriority === 'provider_first' ? 'Your connected provider is used first; Automnia credits are the fallback.' : usagePriority === 'automnia_first_with_provider_fallback' ? 'Automnia credits are used first; your connected provider is the fallback.' : usagePriorityLocked ? 'Automnia credits are the available route for this account.' : 'Automnia credits are used first; your provider is used if credits are exhausted.' : 'Activate a license to receive your current entitlement.'}</small>
              </div>
              <b>{entitlement.statusLabel}</b>
            </div>
            <dl className="dui-settings-billing-summary__metrics">
              <div>
                <dt>Plan or access</dt>
                <dd title={license?.tier || undefined}>{entitlement.tierLabel}</dd>
              </div>
              <div>
                <dt>Confirmed balance</dt>
                <dd data-balance="true">{balance}</dd>
              </div>
              <div>
                <dt>Balance updated</dt>
                <dd>{hostedCredits || isByok ? formatAccountTimestamp(license?.creditBalanceUpdatedAt) : 'Not applicable — provider-billed'}</dd>
              </div>
            </dl>
          </section>
          {(hostedCredits || isByok) && usagePriorityLocked && usagePriority === 'automnia_only' && license?.creditBalance === 0 && <p role="alert" style={{ margin: '0.8rem 0 0', color: '#fda4af' }}>
            Automnia credits are unavailable because the confirmed balance is 0. Refill your credits to continue.
          </p>}
          <section className="dui-settings-account-actions" aria-labelledby="settings-account-actions-title">
            <div className="dui-settings-account-actions__head">
              <div>
                <span>Account controls</span>
                <strong id="settings-account-actions-title">Manage billing and access</strong>
              </div>
              <small>Secure account actions</small>
            </div>
            <div className="dui-settings-account-actions__grid">
              <button
                type="button"
                className="dui-settings-account-action is-primary"
                onClick={() => void openCheckout()}
                disabled={checkoutBusy}
              >
                <span>
                  <small>Billing & plan</small>
                  <strong>{checkoutBusy ? 'Opening secure checkout…' : hostedCredits ? 'Manage credits or upgrade' : isByok ? 'Upgrade your Automnia access' : 'Choose an Automnia plan'}</strong>
                  <em>{hostedCredits ? 'Add usage credits or review available higher tiers.' : 'View available plans in the secure Shopify checkout.'}</em>
                </span>
                <b aria-hidden="true">›</b>
              </button>
              <button
                type="button"
                className="dui-settings-account-action"
                onClick={() => void refreshAccount()}
                disabled={accountRefreshBusy || !license?.active}
              >
                <span>
                  <small>Account status</small>
                  <strong>{accountRefreshBusy ? 'Refreshing account…' : hostedCredits ? 'Refresh balance and access' : 'Refresh account access'}</strong>
                  <em>Sync the latest highest-tier entitlement for this account.</em>
                </span>
                <b aria-hidden="true">›</b>
              </button>
              <button
                type="button"
                className="dui-settings-account-action is-compact"
                onClick={requestLicenseActivation}
                disabled={!license?.active}
              >
                <span>
                  <small>License</small>
                  <strong>{isByok ? 'Link another purchase' : 'Link legacy license'}</strong>
                </span>
                <b aria-hidden="true">›</b>
              </button>
              <button type="button" className="dui-settings-account-action is-compact is-danger" onClick={logout}>
                <span>
                  <small>Session</small>
                  <strong>Log out of Automnia</strong>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            </div>
          </section>
          {hostedCredits && <p style={{ color: '#99f6e4', margin: '0.75rem 0 0', fontSize: '0.84rem' }}>Refills add Automnia credits automatically when Shopify checkout uses this account email ({license?.email || 'your Automnia email'}). A different checkout email intentionally creates a separate Automnia account.</p>}
          {license?.active && <p style={{ color: '#93f6d2', margin: '0.75rem 0 0', fontSize: '0.84rem' }}>Your purchases are managed as one Automnia account. Higher-tier purchases upgrade this entitlement automatically, so you keep one account and one canonical license key.</p>}
          {isByok && <p style={{ color: '#93c5fd', margin: '0.75rem 0 0', fontSize: '0.84rem' }}>BYOK keeps your provider connection, and any pooled Automnia credits carried over from Starter remain available. Choose My provider + Automnia credits to select which route runs first.</p>}
          {accountRefreshError && <p role="alert" style={{ color: '#fb7185', margin: '0.75rem 0 0' }}>{accountRefreshError}</p>}
          {checkoutError && <p role="alert" style={{ color: '#fb7185', margin: '0.75rem 0 0' }}>{checkoutError}</p>}
          {usagePriorityError && <p role="alert" style={{ color: '#fb7185', margin: '0.75rem 0 0' }}>{usagePriorityError}</p>}
        </SettingsCard>
      </div>
    )
  }

  const renderSection = (section: SettingsSectionId) => {
    if (section === 'account') return renderAccount()
    if (section === 'appearance') return renderAppearance()
    if (section === 'workspace') return renderWorkspace()
    if (section === 'voice') return renderVoice()
    if (section === 'missions') return renderMissions()
    if (section === 'agents') return renderAgents()
    if (section === 'telegram') return renderTelegram()
    if (section === 'logs') return <SettingsActivityLog />
    return renderData()
  }

  const confirmationCopy: Record<Exclude<PendingConfirmation, null>, { title: string; text: string; action: string }> = {
    'reset-all': { title: 'Restore all app preferences?', text: 'Your agents, credentials, plugins and files will not be changed.', action: 'Restore defaults' },
    'reset-runtime': { title: 'Reset targeted agent runtime?', text: `This will write the default heartbeat and reasoning policy to ${targetIds.length} target agent${targetIds.length === 1 ? '' : 's'}.`, action: 'Reset agent runtime' },
    'clear-workspace': { title: 'Clear party and responses?', text: 'This removes the active party and console history. Rostered agents are kept.', action: 'Clear workspace state' },
  }

  const confirmPendingAction = () => {
    if (pendingConfirmation === 'reset-all') resetAllSettings()
    else if (pendingConfirmation === 'reset-runtime') applyRuntimeToTargets(DEFAULT_RUNTIME_SETTINGS, true)
    else if (pendingConfirmation === 'clear-workspace') {
      clearAll()
      setPendingConfirmation(null)
      setNotice({ tone: 'success', text: 'Active party and command responses cleared.' })
    }
  }

  return (
    <section data-dui-panel="settings" data-ui-revision="settings-v2" className="dui-settings-panel dui-settings-redesign">
      <header className="dui-settings-topbar">
        <div><span>Automnia</span><h2>Settings</h2><p>Everything here is functional, persistent and safe to change.</p></div>
        <label className="dui-settings-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" />{searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear settings search">×</button>}</label>
      </header>

      {notice.text && <div className="dui-settings-status" data-tone={notice.tone} role="status" aria-live="polite"><i aria-hidden="true" /><span>{notice.text}</span></div>}

      {pendingConfirmation && (
        <div className="dui-settings-confirm" role="alertdialog" aria-modal="true" aria-labelledby="settings-confirm-title">
          <div><strong id="settings-confirm-title">{confirmationCopy[pendingConfirmation].title}</strong><p>{confirmationCopy[pendingConfirmation].text}</p></div>
          <div><button type="button" onClick={() => setPendingConfirmation(null)}>Cancel</button><button type="button" className="is-danger" onClick={confirmPendingAction}>{confirmationCopy[pendingConfirmation].action}</button></div>
        </div>
      )}

      <div className="dui-settings-layout">
        <nav className="dui-settings-nav" aria-label="Settings categories">
          {SETTINGS_SECTIONS.map((section) => (
            <button key={section.id} type="button" role="tab" aria-selected={!normalizedSearch && activeSection === section.id} aria-controls={`settings-section-${section.id}`} data-settings-section={section.id} data-active={!normalizedSearch && activeSection === section.id ? 'true' : 'false'} onClick={() => { setActiveSection(section.id); setSearchQuery('') }}>
              <strong>{section.label}</strong>
            </button>
          ))}
        </nav>

        <main className="dui-settings-content">
          {normalizedSearch && <div className="dui-settings-results"><strong>{visibleSections.length} matching categor{visibleSections.length === 1 ? 'y' : 'ies'}</strong><span>Results for “{searchQuery.trim()}”</span></div>}
          {visibleSections.length ? visibleSections.map((section) => <div key={section}>{renderSection(section)}</div>) : <div className="dui-settings-empty"><SettingsGlyph name="appearance" /><strong>No settings found</strong><span>Try “voice”, “console”, “mission”, “contrast” or “runtime”.</span><button type="button" onClick={() => setSearchQuery('')}>Clear search</button></div>}
        </main>
      </div>
    </section>
  )
}

export default SettingsPanel
