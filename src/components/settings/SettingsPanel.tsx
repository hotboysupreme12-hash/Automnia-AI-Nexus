import { NotificationSettings } from './NotificationSettings'
import { WorkspaceProfiles } from './WorkspaceProfilesPanel'
import { SettingsSearchMatches } from './SettingsSearchMatches'
import { useRememberedState } from '../../hooks/useRememberedState'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  AUTOMNIA_PRO_TOKENS,
  AUTOMNIA_STARTER_TOKENS,
  formatAutomniaCredits,
  formatAutomniaCreditsFromTokens,
} from '../../utils/creditDisplay'
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
import { AppUpdateSettings } from './AppUpdateSettings'
import { buildRuntimePolicyPatch, mixedRuntimeFields, type RuntimeDefaultsDraft } from './runtimePolicyDraft'
import { MicrophoneSettings } from './MicrophoneSettings'
import { lastPreferenceSaveResult, PREFERENCE_STORAGE_STATUS_EVENT } from './preferenceStorage'
import { MAX_PREFERENCES_BACKUP_BYTES, parsePreferencesBackup, serializePreferencesBackup, PREFERENCE_GROUP_LABELS, type PreferenceGroup, type PreferencesBackup } from './preferencesBackup'
import { Button, Dialog } from '../ui'
import {
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
export type SettingsSectionId = 'account' | 'appearance' | 'workspace' | 'voice' | 'missions' | 'agents' | 'telegram' | 'updates' | 'logs' | 'data'
type RuntimeTargetScope = 'party' | 'selection'
type PendingConfirmation = 'reset-all' | 'reset-runtime' | 'clear-workspace' | null

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  label: string
  description: string
  keywords: string
}> = [
  { id: 'account', label: 'Account', description: 'Profile, security and billing', keywords: 'account plan license credits key email tier balance provider oauth usage priority automnia fallback' },
  { id: 'appearance', label: 'Appearance', description: 'Colors, spacing and accessibility', keywords: 'theme color accent contrast glow motion forms scrollbar interface display' },
  { id: 'workspace', label: 'Workspace', description: 'Layout and notifications', keywords: 'agents registry cards grid list sort filter console width drafts layout' },
  { id: 'voice', label: 'Voice', description: 'Microphone and dictation', keywords: 'speech microphone local cloud online silence pause noise echo gain recording' },
  { id: 'missions', label: 'Missions', description: 'Mission setup', keywords: 'mission objective duration risk complexity collaboration evidence build test' },
  { id: 'agents', label: 'Agent Behavior', description: 'Timing, reasoning and teamwork', keywords: 'agent runtime heartbeat timeout thinking fast parallel concurrency simultaneous chat commands sequential recovery continuous' },
  { id: 'telegram', label: 'Telegram', description: 'Chats, replies and permissions', keywords: 'telegram bot commands agents pairing dm group topics streaming reactions polls media history actions settings' },
  { id: 'updates', label: 'Updates', description: 'App version and updates', keywords: 'update upgrade version release download installer restart automatic security' },
  { id: 'logs', label: 'Activity', description: 'Recent activity and history', keywords: 'logs activity agent runs gateway events tail automnia runtime response history channel telegram sms incoming sent retain trim memory' },
  { id: 'data', label: 'Backup & Reset', description: 'Backup, cleanup and recovery', keywords: 'reset default backup export clear console responses simulation party data' },
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
    updates: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v6h-6M12 8v5l3 2" /></>,
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

function SettingsCard({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`dui-settings-card${className ? ` ${className}` : ''}`}>
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
    <label className="dui-settings-field" data-setting-label={label} data-setting-hint={hint}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <div className="dui-settings-control">{children}</div>
    </label>
  )
}

function SettingGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dui-settings-field" data-setting-label={label} data-setting-hint={hint}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <div className="dui-settings-control">{children}</div>
    </div>
  )
}

function ToggleField({ label, hint, checked, mixed, disabled, onChange }: { label: string; hint?: string; checked: boolean; mixed?: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="dui-settings-toggle" data-setting-label={label} data-setting-hint={hint} data-disabled={disabled ? 'true' : 'false'}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input ref={(element) => { if (element) element.indeterminate = Boolean(mixed) }} type="checkbox" aria-checked={mixed ? 'mixed' : checked} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
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
  return formatAutomniaCredits(value)
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
  const saveAgentPolicies = useNexusStore((state) => state.saveAgentPolicies)
  const clearAgentResponses = useNexusStore((state) => state.clearAgentResponses)
  const clearAll = useNexusStore((state) => state.clearAll)
  const resetMission = useNexusStore((state) => state.resetMission)
  const resetSimulation = useNexusStore((state) => state.resetSimulation)
  const setTab = useNexusStore((state) => state.setTab)
  const selectAgent = useNexusStore((state) => state.selectAgent)
  const clearSelectedAgents = useNexusStore((state) => state.clearSelectedAgents)

  const [activeSection, setActiveSection] = useRememberedState<SettingsSectionId>('settings-section', focusSection)
  const [searchQuery, setSearchQuery] = useRememberedState('settings-search', '')
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
  const [runtimeSaveBusy, setRuntimeSaveBusy] = useState(false)
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
  const settingsRoot = useRef<HTMLElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [backupPreview, setBackupPreview] = useState<PreferencesBackup | null>(null)
  const [backupGroups, setBackupGroups] = useState<PreferenceGroup[]>([])
  const [backupReading, setBackupReading] = useState(false)
  const [telegramGatewaySettings, setTelegramGatewaySettings] = useState<TelegramSettings>(() => readTelegramSettings())

  const [appliedFocusRequest, setAppliedFocusRequest] = useRememberedState('settings-focus-request', -1)
  useEffect(() => {
    if (appliedFocusRequest === focusRequest) return
    setActiveSection(focusSection)
    setSearchQuery('')
    setAppliedFocusRequest(focusRequest)
  }, [focusSection, focusRequest, appliedFocusRequest, setAppliedFocusRequest, setActiveSection, setSearchQuery])

  const partyTargetIds = useMemo(() => activePartyIds.filter((id) => agents.some((agent) => agent.id === id)), [activePartyIds, agents])
  const selectedTargetIds = useMemo(() => selectedAgentIds.filter((id) => agents.some((agent) => agent.id === id)), [agents, selectedAgentIds])
  const targetIds = targetScope === 'party' ? partyTargetIds : selectedTargetIds
  const targetAgents = useMemo(
    () => targetIds.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is OpenClawAgent => Boolean(agent)),
    [agents, targetIds],
  )
  const runtimeTargetKey = targetAgents.map((agent) => agent.id).join('|')
  const [runtimeDraft, setRuntimeDraft] = useState(() => ({ targetKey: runtimeTargetKey, values: defaultRuntimeDraft(targetAgents[0]), changedKeys: [] as Array<keyof RuntimeDefaultsDraft> }))
  const activeRuntimeDraft = runtimeDraft.targetKey === runtimeTargetKey ? runtimeDraft.values : defaultRuntimeDraft(targetAgents[0])

  const runtimeChangedKeys = runtimeDraft.targetKey === runtimeTargetKey ? runtimeDraft.changedKeys : []
  const runtimeMixedFields = mixedRuntimeFields(targetAgents.map(defaultRuntimeDraft))
  const runtimeFieldMixed = (key: keyof RuntimeDefaultsDraft) => runtimeMixedFields.has(key) && !runtimeChangedKeys.includes(key)
  const runtimeHint = (key: keyof RuntimeDefaultsDraft, hint = '') => `${runtimeFieldMixed(key) ? 'Varies across the selected agents. ' : ''}${hint}`

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleSections = normalizedSearch
    ? SETTINGS_SECTIONS.map((section) => section.id)
    : [activeSection]

  useEffect(() => {
    const storageStatus = () => { const result = lastPreferenceSaveResult(); if (!result.ok) setNotice({ tone: 'warning', text: result.message }) }
    window.addEventListener(PREFERENCE_STORAGE_STATUS_EVENT, storageStatus)
    return () => window.removeEventListener(PREFERENCE_STORAGE_STATUS_EVENT, storageStatus)
  }, [])

  const announceSaved = (label: string) => {
    const result = lastPreferenceSaveResult()
    setNotice(result.ok ? { tone: 'success', text: `${label} saved and applied.` } : { tone: 'warning', text: result.message })
  }

  const updateUiSettings = (patch: Partial<AutomniaUiSettings>, label: string) => {
    const next = { ...uiSettings, ...patch }
    saveUiSettings(next)
    applyUiSettings(next)
    setUiSettings(next)
    announceSaved(label)
  }

  const updateUiSetting = <Key extends keyof AutomniaUiSettings>(key: Key, value: AutomniaUiSettings[Key], label: string) => {
    updateUiSettings({ [key]: value } as Partial<AutomniaUiSettings>, label)
  }

  const updateSpeechSettings = (patch: Partial<SpeechSettings>, label: string) => {
    const next = { ...speechSettings, ...patch }
    saveSpeechSettings(next)
    setSpeechSettings(next)
    announceSaved(label)
  }

  const updateRegistryPreferences = (patch: Partial<RegistryPreferences>, label: string) => {
    const next = { ...registryPreferences, ...patch }
    saveRegistryPreferences(next)
    setRegistryPreferences(next)
    announceSaved(label)
  }

  const updateConsolePreferences = (patch: Partial<ConsolePreferences>, label: string) => {
    const next = { ...consolePreferences, ...patch }
    saveConsolePreferences(next)
    setConsolePreferences(next)
    if (patch.rememberDrafts === false) clearAllCommandConsoleDrafts()
    announceSaved(label)
  }

  const updateRuntimeDraft = (patch: Partial<RuntimeDefaultsDraft>) => {
    setRuntimeDraft({ targetKey: runtimeTargetKey, values: { ...activeRuntimeDraft, ...patch }, changedKeys: [...new Set([...runtimeChangedKeys, ...Object.keys(patch) as Array<keyof RuntimeDefaultsDraft>])] })
  }

  const updateTelegramDraft = <Key extends keyof TelegramSettings>(key: Key, value: TelegramSettings[Key]) => {
    const next = normalizeTelegramSettings({ ...telegramSettings, [key]: value })
    saveTelegramSettings(next)
    setTelegramSettings(next)
  }

  const openClawCommandFailure = (payload: { ok?: boolean; error?: string; command?: { output?: string; stderr?: string; code?: number } }, fallback: string) => {
    if (payload.ok === false || payload.error || (typeof payload.command?.code === 'number' && payload.command.code !== 0)) {
      return fallback
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
      const telegramFailure = openClawCommandFailure(telegramPayload, 'Telegram settings could not be loaded.')
      const messagesFailure = openClawCommandFailure(messagesPayload, 'Telegram reaction settings could not be loaded.')
      if (telegramFailure) throw new Error(telegramFailure)
      if (messagesFailure) throw new Error(messagesFailure)
      const parsedTelegram = parseTelegramConfigOutput(telegramPayload.command?.output || '')
      const parsedMessages = parseTelegramConfigOutput(messagesPayload.command?.output || '')
      if (!parsedTelegram) throw new Error('Automnia could not read the current Telegram settings.')
      const next = normalizeTelegramSettings({ ...readTelegramSettings(), ...parsedTelegram, ...(parsedMessages || {}) })
      setTelegramSettings(next)
      setTelegramGatewaySettings(next)
      saveTelegramSettings(next)
      setNotice({ tone: 'success', text: 'Telegram settings refreshed.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load Telegram settings.'
      setTelegramLoadError(message)
      setNotice({ tone: 'warning', text: 'Showing your last saved Telegram settings. Try again in a moment.' })
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
        setNotice({ tone: 'success', text: 'Your Telegram settings are already up to date.' })
        return
      }
      const command = telegramSettingBatchCommand(next, changedKeys)
      setNotice({ tone: 'neutral', text: `Saving ${changedKeys.length} Telegram setting${changedKeys.length === 1 ? '' : 's'}…` })
      const payload = await runOpenClawPluginCommand(command, { refreshPlugins: false })
      const failure = openClawCommandFailure(payload, 'Telegram settings could not be saved. Check your Telegram connection and try again.')
      if (failure) throw new Error(failure)
      const restart = await restartPluginGateway()
      if (restart.ok === false || restart.error) throw new Error(restart.error || 'Telegram could not restart with the new settings.')
      setTelegramSettings(next)
      setTelegramGatewaySettings(next)
      saveTelegramSettings(next)
      setNotice({ tone: 'success', text: 'Telegram settings saved and applied.' })
    } catch (error) {
      setNotice({ tone: 'error', text: `Some Telegram settings could not be saved. ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setTelegramSaving(false)
    }
  }

  useEffect(() => {
    if (activeSection === 'telegram' && !telegramLoaded && !telegramLoading) void loadTelegramFromGateway()
  }, [activeSection, telegramLoaded, telegramLoading, loadTelegramFromGateway])

  const applyRuntimeToTargets = async (values = activeRuntimeDraft, reset = false) => {
    if (runtimeSaveBusy) return
    if (!targetIds.length) {
      setNotice({ tone: 'warning', text: `Choose at least one agent from your ${targetScope === 'party' ? 'team' : 'selection'} to update.` })
      return
    }
    if (![values.heartbeatSeconds, values.idleTimeoutSeconds, values.timeoutMinutes].every(Number.isFinite)) {
      setNotice({ tone: 'warning', text: 'Enter valid numbers for the check-in interval, inactivity limit, and maximum task time.' })
      return
    }
    const keys = reset ? Object.keys(values) as Array<keyof RuntimeDefaultsDraft> : runtimeChangedKeys
    if (!keys.length) { setNotice({ tone: 'neutral', text: 'Change a setting before saving.' }); return }
    const patch = buildRuntimePolicyPatch(values, keys)
    const targets = targetAgents.map((agent) => ({ id: agent.id, name: agent.name }))
    setRuntimeSaveBusy(true)
    setPendingConfirmation(null)
    setNotice({ tone: 'neutral', text: `Saving preferences for ${targets.length} agent${targets.length === 1 ? '' : 's'}…` })
    const results = await Promise.allSettled(targets.map(async ({ id }) => {
      if (Object.keys(patch.heartbeat).length) updateHeartbeat(id, patch.heartbeat, { persist: false })
      if (Object.keys(patch.runtimePolicy).length) updateAgentRuntimePolicy(id, patch.runtimePolicy, { persist: false })
      const result = await saveAgentPolicies(id)
      if (!result.ok) throw new Error(result.message)
    }))
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [`${targets[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : [])
    setRuntimeSaveBusy(false)
    setNotice(failures.length
      ? { tone: 'error', text: `Saved ${targets.length - failures.length} of ${targets.length} agents. Not saved: ${failures.join('; ')}. Review the settings and try again.` }
      : { tone: 'success', text: `${reset ? 'Default behavior restored for' : 'Preferences saved for'} ${targets.length} agent${targets.length === 1 ? '' : 's'}.` })
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
    try { window.localStorage.removeItem('automnia-monitor-doctor-dismissed-run') } catch { /* Retain a usable workspace when storage is blocked. */ }
    resetMission()
    setPendingConfirmation(null)
    setNotice(lastPreferenceSaveResult().ok ? { tone: 'success', text: 'All app preferences and mission defaults were restored. Agents, credentials, plugins, and files were kept.' } : { tone: 'warning', text: lastPreferenceSaveResult().message })
  }

  const createSettingsBackup = () => serializePreferencesBackup({ appearance: uiSettings, activity: readChannelActivitySettings(), voice: speechSettings, registry: registryPreferences, console: consolePreferences, mission: missionDraft })

  const copySettingsBackup = async () => {
    try { await navigator.clipboard.writeText(createSettingsBackup()); setNotice({ tone: 'success', text: 'Settings backup copied to the clipboard.' }) }
    catch (error) { setNotice({ tone: 'error', text: `Could not copy the backup. ${error instanceof Error ? error.message : 'Try downloading it instead.'}` }) }
  }

  const downloadSettingsBackup = () => {
    try {
      const url = URL.createObjectURL(new Blob([createSettingsBackup()], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `automnia-preferences-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      setNotice({ tone: 'success', text: 'Preferences backup download started.' })
    } catch (error) { setNotice({ tone: 'error', text: `Could not export preferences: ${error instanceof Error ? error.message : String(error)}` }) }
  }

  const previewSettingsBackup = async (file?: File) => {
    if (!file) return
    setBackupPreview(null)
    setBackupReading(true)
    try {
      if (file.size > MAX_PREFERENCES_BACKUP_BYTES) throw new Error('Choose a preferences backup smaller than 1 MB.')
      const preview = parsePreferencesBackup(await file.text())
      setBackupPreview(preview)
      setBackupGroups(Object.keys(preview) as PreferenceGroup[])
      setNotice({ tone: 'neutral', text: 'Backup validated. Review the fields and select which groups to restore.' })
    } catch (error) { setNotice({ tone: 'error', text: `${error instanceof Error ? error.message : 'Could not read this backup.'} No settings were changed.` }) }
    finally { setBackupReading(false) }
  }

  const applySettingsBackup = () => {
    if (!backupPreview || !backupGroups.length) return
    const failures: string[] = []
    for (const group of backupGroups) {
      const values = backupPreview[group]
      if (!values) continue
      switch (group) {
        case 'appearance': { const value = backupPreview.appearance!; saveUiSettings(value); applyUiSettings(value); setUiSettings(value); break }
        case 'voice': { const value = backupPreview.voice!; saveSpeechSettings(value); setSpeechSettings(value); break }
        case 'registry': { const value = backupPreview.registry!; saveRegistryPreferences(value); setRegistryPreferences(value); break }
        case 'console': { const value = backupPreview.console!; saveConsolePreferences(value); setConsolePreferences(value); if (!value.rememberDrafts) clearAllCommandConsoleDrafts(); break }
        case 'activity': saveChannelActivitySettings(backupPreview.activity!); break
        case 'mission': updateMissionDraft(backupPreview.mission!); break
      }
      if (!lastPreferenceSaveResult().ok && group !== 'mission') failures.push(PREFERENCE_GROUP_LABELS[group])
    }
    setBackupPreview(null)
    setNotice(failures.length ? { tone: 'warning', text: `Preferences applied for this session. Could not save: ${failures.join(', ')}. Keep your backup before closing the app.` } : { tone: 'success', text: `Restored ${backupGroups.length} preference group${backupGroups.length === 1 ? '' : 's'}.` })
  }

  const renderAppearance = () => (
    <div className="dui-settings-section" id="settings-section-appearance">
      <SectionHeader section="appearance" eyebrow="Make Automnia feel right for you" />
      <SettingsCard title="Colors and layout" description="Choose how Automnia looks.">
        <Field label="Accent color" hint="Used for selected items, highlights, and status indicators.">
          <select value={uiSettings.accentMode} onChange={(event) => updateUiSetting('accentMode', event.target.value as UiAccentMode, 'Accent color')}>
            <option value="reference">Cyan</option><option value="no-blue">Graphite</option><option value="ember">Amber</option><option value="green">Green</option>
          </select>
        </Field>
        <Field label="Input style" hint="Changes the appearance of text fields, search boxes, and menus.">
          <select value={uiSettings.formChrome} onChange={(event) => updateUiSetting('formChrome', event.target.value as UiFormChrome, 'Input style')}>
            <option value="graphite">Graphite</option><option value="obsidian">Obsidian</option><option value="warm">Warm black</option>
          </select>
        </Field>
        <SettingGroup label="Spacing" hint="Choose how much room appears between items.">
          <div data-dui-setting="density">
            <SegmentedControl value={uiSettings.density} label="Interface spacing" options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'spacious', label: 'Spacious' }]} onChange={(value: UiDensity) => updateUiSetting('density', value, 'Spacing')} />
          </div>
        </SettingGroup>
      </SettingsCard>
      <SettingsCard title="Accessibility" description="Make Automnia calmer and easier to read.">
        <SettingGroup label="Animation" hint="Choose Reduced to limit movement and transitions.">
          <div data-dui-setting="motion">
            <SegmentedControl value={uiSettings.motion} label="Animation preference" options={[{ id: 'standard', label: 'Standard' }, { id: 'reduced', label: 'Reduced' }]} onChange={(value: UiMotion) => updateUiSetting('motion', value, 'Animation preference')} />
          </div>
        </SettingGroup>
        <ToggleField label="High contrast" hint="Makes text, borders, and selected items easier to see." checked={uiSettings.highContrast} onChange={(value) => updateUiSetting('highContrast', value, 'High contrast')} />
        <ToggleField label="Reduced glow" hint="Limits decorative lighting effects." checked={uiSettings.reducedGlow} onChange={(value) => updateUiSetting('reducedGlow', value, 'Reduced glow')} />
        <ToggleField label="Selection glow" hint="Adds a subtle highlight to selected controls." checked={uiSettings.controlGlow} disabled={uiSettings.reducedGlow} onChange={(value) => updateUiSetting('controlGlow', value, 'Selection glow')} />
        <ToggleField label="Neutral scrollbars" hint="Uses neutral gray instead of your accent color." checked={uiSettings.neutralScrollbars} onChange={(value) => updateUiSetting('neutralScrollbars', value, 'Scrollbar style')} />
        <div className="dui-settings-actions"><button type="button" onClick={resetAppearance}>Restore appearance defaults</button></div>
      </SettingsCard>
    </div>
  )

  const renderWorkspace = () => (
    <div className="dui-settings-section" id="settings-section-workspace">
      <SectionHeader section="workspace" eyebrow="Arrange your everyday workspace" />
      <WorkspaceProfiles onApply={() => { setUiSettings(readUiSettings()); setRegistryPreferences(readRegistryPreferences()); setConsolePreferences(readConsolePreferences()) }} />
      <SettingsCard title="Notifications" description="Choose when Automnia should alert you."><NotificationSettings /></SettingsCard>
      <SettingsCard title="Agent list" description="Choose how your agents are displayed.">
        <Field label="Default view" hint="Simple shows 9 agents. Detailed shows 12 agents with more information.">
          <select value={registryPreferences.displayMode} onChange={(event) => updateRegistryPreferences({ displayMode: event.target.value as AgentDisplayMode }, 'Agent view')}>
            {REGISTRY_DISPLAY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.hint}</option>)}
          </select>
        </Field>
        <ToggleField
          label="Use rarity colors"
          hint="Shows each agent's rarity on its border and badge."
          checked={registryPreferences.rarityColorsEnabled}
          onChange={(value) => updateRegistryPreferences({
            rarityColorsEnabled: value,
            ...(value || registryPreferences.overlayPreset !== 'rarity' ? {} : { overlayPreset: 'original' as AgentOverlayPreset }),
          }, value ? 'Agent card rarity colors' : 'Shared agent card theme')}
        />
        {!registryPreferences.rarityColorsEnabled && (
          <Field label="Card background" hint="Choose one background style for every agent.">
            <select
              value={registryPreferences.overlayPreset}
              onChange={(event) => updateRegistryPreferences({ overlayPreset: event.target.value as AgentOverlayPreset }, 'Agent card background')}
            >
              {REGISTRY_OVERLAY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.hint}</option>)}
            </select>
          </Field>
        )}
        <Field label="Agent order" hint="Choose which agents appear first.">
          <select value={registryPreferences.sortKey} onChange={(event) => updateRegistryPreferences({ sortKey: event.target.value as RegistrySortKey }, 'Agent order')}>
            <option value="party">Team first</option><option value="level">Highest level</option><option value="name">Name A–Z</option><option value="rarity">Rarity</option>
          </select>
        </Field>
        <Field label="Rarity filter" hint="Show every agent or only one rarity.">
          <select value={registryPreferences.rarityFilter} onChange={(event) => updateRegistryPreferences({ rarityFilter: event.target.value as RegistryPreferences['rarityFilter'] }, 'Rarity filter')}>
            <option value="all">All</option><option value="legendary">Legendary</option><option value="epic">Epic</option><option value="rare">Rare</option><option value="common">Common</option>
          </select>
        </Field>
      </SettingsCard>
      <SettingsCard title="Agent chat panel" description="Choose how conversations appear in the Agents workspace.">
        <ToggleField label="Show the chat panel" hint="Turn it off to give the agent list more room." checked={consolePreferences.visible} onChange={(value) => updateConsolePreferences({ visible: value }, 'Chat panel visibility')} />
        <Field label={`Chat panel width · ${consolePreferences.width}px`} hint="The width adjusts automatically on smaller windows.">
          <input type="range" min={360} max={760} step={20} value={consolePreferences.width} onChange={(event) => updateConsolePreferences({ width: Number(event.target.value) }, 'Chat panel width')} />
        </Field>
        <ToggleField label="Remember unfinished messages" hint="Keeps unsent text when you leave or reopen the app." checked={consolePreferences.rememberDrafts} onChange={(value) => updateConsolePreferences({ rememberDrafts: value }, 'Unfinished messages')} />
        <div className="dui-settings-actions"><button type="button" onClick={resetWorkspace}>Restore workspace defaults</button><button type="button" onClick={() => setTab('agents')}>Open Agents</button></div>
      </SettingsCard>
    </div>
  )

  const renderVoice = () => (
    <div className="dui-settings-section" id="settings-section-voice">
      <SectionHeader section="voice" eyebrow="Set up dictation your way" />
      <SettingsCard title="Dictation service" description="Choose private on-device dictation or connected cloud dictation.">
        <SettingGroup label="Dictation mode" hint="Your choice is used the next time you select the microphone.">
          <div className="dui-settings-voice-mode" role="group" aria-label="Voice transcription provider" data-mode={speechSettings.mode}>
            {([{ id: 'local', label: 'Local', detail: 'On-device · offline after setup' }, { id: 'online', label: 'Cloud', detail: 'OpenAI · internet required' }] as Array<{ id: SpeechTranscriptionMode; label: string; detail: string }>).map((option) => (
              <button key={option.id} type="button" aria-pressed={speechSettings.mode === option.id} onClick={() => updateSpeechSettings({ mode: option.id }, 'Voice provider')}>
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </button>
            ))}
          </div>
        </SettingGroup>
      </SettingsCard>
      <SettingsCard title="Language and vocabulary" description="Help Automnia understand your speech more accurately.">
        <Field label="Spoken language" hint="Choose a language, or let cloud dictation detect it automatically.">
          <select value={speechSettings.language || ''} onChange={(event) => updateSpeechSettings({ language: event.target.value }, 'Spoken language')}>
            <option value="">Default · English locally, automatic in cloud</option>
            {Object.entries({ en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', ht: 'Haitian Creole', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', ru: 'Russian', uk: 'Ukrainian' }).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <Field label="Names and special terms" hint="Add names, products, or uncommon words separated by commas. This is used for cloud dictation.">
          <textarea rows={3} maxLength={1000} value={speechSettings.vocabulary || ''} onChange={(event) => updateSpeechSettings({ vocabulary: event.target.value }, 'Dictation vocabulary')} placeholder="Automnia, OpenClaw, Jean" />
        </Field>
      </SettingsCard>
      <SettingsCard title="Recording" description="Choose when dictation stops and how long it can record.">
        <ToggleField label="Stop after a pause" hint="Automatically transcribes when speech ends; turn off for manual stop only." checked={speechSettings.autoStop} onChange={(value) => updateSpeechSettings({ autoStop: value }, 'Automatic pause detection')} />
        <Field label={`Pause sensitivity · ${(speechSettings.pauseDurationMs / 1_000).toFixed(2)}s`} hint="Longer values are better when you pause while thinking.">
          <input type="range" min={600} max={3000} step={50} value={speechSettings.pauseDurationMs} disabled={!speechSettings.autoStop} onChange={(event) => updateSpeechSettings({ pauseDurationMs: Number(event.target.value) }, 'Pause sensitivity')} />
        </Field>
        <Field label="Maximum recording" hint="Recording stops automatically after this amount of time.">
          <select value={speechSettings.maxRecordingSeconds} onChange={(event) => updateSpeechSettings({ maxRecordingSeconds: Number(event.target.value) }, 'Maximum recording length')}>
            <option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option>
          </select>
        </Field>
      </SettingsCard>
      <SettingsCard title="Microphone device and test" description="Record a short local sample and check playback before dictating."><MicrophoneSettings settings={speechSettings} onChange={(microphoneDeviceId) => updateSpeechSettings({ microphoneDeviceId }, 'Microphone selection')} /></SettingsCard>
      <SettingsCard title="Sound quality" description="Improve voice clarity before your speech is transcribed.">
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
      <div className="dui-settings-section" id="settings-section-missions">
        <SectionHeader section="missions" eyebrow="Prepare your next mission" />
        <SettingsCard title="Mission defaults" description="Set the starting choices for new missions.">
          <Field label="Mission title"><input value={missionDraft.title} onChange={(event) => updateMissionDraft({ title: event.target.value })} /></Field>
          <Field label="Default objective" hint="Use a concrete instruction that can be verified."><textarea rows={4} value={missionDraft.description} onChange={(event) => updateMissionDraft({ description: event.target.value })} /></Field>
          <Field label="Mission type"><select value={missionDraft.missionType} onChange={(event) => updateMissionDraft({ missionType: event.target.value as CapabilityKey })}>{MISSION_TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Collaboration"><select value={missionDraft.collaborationMode} onChange={(event) => updateMissionDraft({ collaborationMode: event.target.value as CollaborationMode })}>{COLLABORATION_MODES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
          <Field label="Duration mode"><select value={missionDraft.durationMode} onChange={(event) => updateMissionDraft({ durationMode: event.target.value as DurationMode })}><option value="instant">Instant</option><option value="timed">Timed</option><option value="continuous">Continuous</option><option value="indefinite">Indefinite</option></select></Field>
          <Field label="Duration amount" hint="Used for timed missions."><div className="dui-settings-inline"><input type="number" min={1} disabled={missionDraft.durationMode !== 'timed'} value={missionDraft.durationValue} onChange={(event) => updateMissionDraft({ durationValue: Number(event.target.value) })} /><select disabled={missionDraft.durationMode !== 'timed'} value={missionDraft.durationUnit} onChange={(event) => updateMissionDraft({ durationUnit: event.target.value as DurationUnit })}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div></Field>
          <Field label={`Complexity · ${missionDraft.complexity}%`}><input type="range" min={1} max={100} value={missionDraft.complexity} onChange={(event) => updateMissionDraft({ complexity: Number(event.target.value) })} /></Field>
          <Field label={`Risk tolerance · ${missionDraft.riskTolerance}%`}><input type="range" min={1} max={100} value={missionDraft.riskTolerance} onChange={(event) => updateMissionDraft({ riskTolerance: Number(event.target.value) })} /></Field>
        </SettingsCard>
        <SettingsCard title="Completion checks" description="Choose what must be confirmed before a mission is complete.">
          <div className="dui-settings-checklist">
            {requirements.map((requirement) => (
              <ToggleField key={requirement.kind} label={requirement.label} checked={requirement.required} onChange={(required) => updateMissionDraft({ requiredEvidence: requirements.map((entry) => entry.kind === requirement.kind ? { ...entry, required } : entry) })} />
            ))}
          </div>
          <div className="dui-settings-actions"><button type="button" onClick={resetMission}>Restore mission defaults</button><button type="button" onClick={() => setTab('missions')}>Open Missions</button></div>
        </SettingsCard>
      </div>
    )
  }

  const renderAgents = () => (
    <div className="dui-settings-section" id="settings-section-agents">
      <SectionHeader section="agents" eyebrow="Choose how your agents work" />
      <SettingsCard title="Agent teamwork" description="Choose whether different agents can work at the same time.">
        <ToggleField label="Work on separate requests at the same time" hint="When off, agents begin one after another. Follow-up messages still wait for the same agent to finish." checked={consolePreferences.parallelAgentChat} onChange={(value) => updateConsolePreferences({ parallelAgentChat: value }, 'Agent teamwork')} />
      </SettingsCard>
      <SettingsCard title="Choose agents" description="Select the agents whose preferences you want to change.">
        <div className="dui-settings-targeting" data-target-scope={targetScope}>
          <div className="dui-settings-targeting__head">
            <div><span>Apply to</span><strong>{targetIds.length ? `${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}` : 'No target selected'}</strong></div>
            <SegmentedControl value={targetScope} label="Agent selection source" options={[{ id: 'party', label: `Team ${partyTargetIds.length}` }, { id: 'selection', label: `Selected ${selectedTargetIds.length}` }]} onChange={setTargetScope} />
          </div>
          <div className="dui-settings-agent-targets" aria-label="Choose agents">
            {agents.map((agent) => {
              const selected = selectedTargetIds.includes(agent.id)
              const targeted = targetIds.includes(agent.id)
              return <button key={agent.id} type="button" aria-pressed={selected} data-target={targeted} onClick={() => toggleRuntimeTarget(agent.id)}><span>{agent.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><strong>{agent.name}</strong><small>{targeted ? 'Included' : selected ? 'Selected' : 'Add'}</small></button>
            })}
          </div>
          {selectedTargetIds.length > 0 && <button type="button" className="dui-settings-clear-targets" onClick={clearSelectedAgents}>Clear selection</button>}
        </div>
      </SettingsCard>
      <SettingsCard title="Availability and recovery" description="Choose how long agents stay ready and whether they retry after an interruption.">
        <Field label="Check-in interval" hint={runtimeHint('heartbeatSeconds', 'How often an active agent checks for more work, in seconds.')}><input type="number" min={5} max={1800} placeholder={runtimeFieldMixed('heartbeatSeconds') ? 'Varies' : undefined} value={runtimeFieldMixed('heartbeatSeconds') ? '' : activeRuntimeDraft.heartbeatSeconds} onChange={(event) => updateRuntimeDraft({ heartbeatSeconds: Number(event.target.value) })} /></Field>
        <Field label="Stop after inactivity" hint={runtimeHint('idleTimeoutSeconds', 'How many seconds an inactive agent waits before stopping.')}><input type="number" min={5} max={1800} placeholder={runtimeFieldMixed('idleTimeoutSeconds') ? 'Varies' : undefined} value={runtimeFieldMixed('idleTimeoutSeconds') ? '' : activeRuntimeDraft.idleTimeoutSeconds} onChange={(event) => updateRuntimeDraft({ idleTimeoutSeconds: Number(event.target.value) })} /></Field>
        <ToggleField label="Stay ready between tasks" hint={runtimeHint('continuous', 'Keeps the agent available for ongoing work.')} mixed={runtimeFieldMixed('continuous')} checked={activeRuntimeDraft.continuous} onChange={(continuous) => updateRuntimeDraft({ continuous })} />
        <ToggleField label="Automatic recovery" hint={runtimeHint('recoveryMode', 'Tries again after a temporary interruption.')} mixed={runtimeFieldMixed('recoveryMode')} checked={activeRuntimeDraft.recoveryMode} onChange={(recoveryMode) => updateRuntimeDraft({ recoveryMode })} />
      </SettingsCard>
      <SettingsCard title="Work preferences" description="Set the starting preferences for future requests.">
        <Field label="Maximum task time" hint={runtimeHint('timeoutMinutes', 'Maximum time for one request, in minutes.')}><input type="number" min={1} max={120} placeholder={runtimeFieldMixed('timeoutMinutes') ? 'Varies' : undefined} value={runtimeFieldMixed('timeoutMinutes') ? '' : activeRuntimeDraft.timeoutMinutes} onChange={(event) => updateRuntimeDraft({ timeoutMinutes: Number(event.target.value) })} /></Field>
        <Field label="Reasoning effort" hint={runtimeHint('thinkingDefault', 'Choose how deeply agents should reason by default.')}><select value={runtimeFieldMixed('thinkingDefault') ? '' : activeRuntimeDraft.thinkingDefault} onChange={(event) => updateRuntimeDraft({ thinkingDefault: event.target.value as ThinkingLevel })}>{runtimeFieldMixed('thinkingDefault') && <option value="" disabled>Varies — leave unchanged</option>}<option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option></select></Field>
        <Field label="Speed preference" hint={runtimeHint('fastModeDefault', 'Choose whether agents favor faster responses.')}><select value={runtimeFieldMixed('fastModeDefault') ? '' : activeRuntimeDraft.fastModeDefault} onChange={(event) => updateRuntimeDraft({ fastModeDefault: event.target.value as FastModeDefault })}>{runtimeFieldMixed('fastModeDefault') && <option value="" disabled>Varies — leave unchanged</option>}<option value="auto">Automatic</option><option value="on">Faster</option><option value="off">Standard</option></select></Field>
        <ToggleField label="Allow parallel work" hint={runtimeHint('parallelPreferred', 'Lets independent parts of a task run at the same time.')} mixed={runtimeFieldMixed('parallelPreferred')} checked={activeRuntimeDraft.parallelPreferred} onChange={(parallelPreferred) => updateRuntimeDraft({ parallelPreferred })} />
        <div className="dui-settings-actions"><button type="button" className="is-primary" disabled={runtimeSaveBusy || !targetIds.length || !runtimeChangedKeys.length} onClick={() => void applyRuntimeToTargets()}>{runtimeSaveBusy ? 'Saving preferences…' : `Save for ${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}`}</button><button type="button" disabled={runtimeSaveBusy || !targetIds.length} onClick={() => { setRuntimeDraft({ targetKey: runtimeTargetKey, values: DEFAULT_RUNTIME_SETTINGS, changedKeys: Object.keys(DEFAULT_RUNTIME_SETTINGS) as Array<keyof RuntimeDefaultsDraft> }); setPendingConfirmation('reset-runtime') }}>Restore agent defaults</button></div>
      </SettingsCard>
    </div>
  )

  const renderTelegram = () => (
    <div className="dui-settings-section" id="settings-section-telegram">
      <SectionHeader section="telegram" eyebrow="Manage your Telegram experience" />
      <SettingsCard title="Access and commands" description="Choose who can contact your bot and which commands are available.">
        <Field label="Command menu" hint="Show Automnia commands such as /agents in Telegram.">
          <select value={telegramSettings.nativeCommands} onChange={(event) => updateTelegramDraft('nativeCommands', event.target.value as TelegramSettings['nativeCommands'])}>
            <option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Direct-message access" hint="Pairing requires each new user to be approved.">
          <select value={telegramSettings.dmPolicy} onChange={(event) => updateTelegramDraft('dmPolicy', event.target.value as TelegramSettings['dmPolicy'])}>
            <option value="pairing">Approve new users</option><option value="allowlist">Approved users only</option><option value="open">Anyone</option><option value="disabled">Disabled</option>
          </select>
        </Field>
        <Field label="Group access" hint="Choose which group chats can use your bot.">
          <select value={telegramSettings.groupPolicy} onChange={(event) => updateTelegramDraft('groupPolicy', event.target.value as TelegramSettings['groupPolicy'])}>
            <option value="allowlist">Approved groups only</option><option value="open">Any group</option><option value="disabled">Disabled</option>
          </select>
        </Field>
        <ToggleField label="Allow settings changes from Telegram" hint="Lets approved Telegram commands update bot settings." checked={telegramSettings.configWrites} onChange={(value) => updateTelegramDraft('configWrites', value)} />
      </SettingsCard>

      <SettingsCard title="Replies and formatting" description="Choose how replies appear while Automnia is working.">
        <Field label="Response updates" hint="Choose what Telegram shows before the final answer is ready.">
          <select value={telegramSettings.streamingMode} onChange={(event) => updateTelegramDraft('streamingMode', event.target.value as TelegramSettings['streamingMode'])}>
            <option value="progress">Show progress</option><option value="partial">Preview the answer</option><option value="block">Send when complete</option><option value="off">Off</option>
          </select>
        </Field>
        <ToggleField label="Show work updates" hint="Displays short progress messages while Automnia works." checked={telegramSettings.toolProgress} onChange={(value) => updateTelegramDraft('toolProgress', value)} />
        <ToggleField label="Link previews" hint="Show a preview when a reply includes a link." checked={telegramSettings.linkPreview} onChange={(value) => updateTelegramDraft('linkPreview', value)} />
        <Field label="Quoted replies" hint="Choose when responses should quote the original message.">
          <select value={telegramSettings.replyToMode} onChange={(event) => updateTelegramDraft('replyToMode', event.target.value as TelegramSettings['replyToMode'])}>
            <option value="off">Off</option><option value="first">Reply to first message</option><option value="all">Reply to every message</option>
          </select>
        </Field>
        <Field label="Interactive buttons" hint="Choose where Automnia can show action buttons.">
          <select value={telegramSettings.inlineButtons} onChange={(event) => updateTelegramDraft('inlineButtons', event.target.value as TelegramSettings['inlineButtons'])}>
            <option value="allowlist">Approved chats</option><option value="dm">Direct messages</option><option value="group">Groups</option><option value="all">Every chat</option><option value="off">Off</option>
          </select>
        </Field>
        <ToggleField label="Rich formatting" hint="Turn off if messages do not display correctly on an older Telegram app." checked={telegramSettings.richMessages} onChange={(value) => updateTelegramDraft('richMessages', value)} />
      </SettingsCard>

      <SettingsCard title="Chat history and media" description="Choose how much chat history and media Automnia can use.">
        <Field label="Group history" hint="Number of recent group messages to remember. Enter 0 for none."><input type="number" min={0} max={200} value={telegramSettings.historyLimit} onChange={(event) => updateTelegramDraft('historyLimit', Number(event.target.value))} /></Field>
        <Field label="Direct-message history" hint="Number of recent private messages to remember. Enter 0 for none."><input type="number" min={0} max={200} value={telegramSettings.dmHistoryLimit} onChange={(event) => updateTelegramDraft('dmHistoryLimit', Number(event.target.value))} /></Field>
        <Field label="Maximum reply length" hint="Lower this if Telegram has trouble displaying long replies."><input type="number" min={100} max={4096} value={telegramSettings.textChunkLimit} onChange={(event) => updateTelegramDraft('textChunkLimit', Number(event.target.value))} /></Field>
        <Field label="Maximum media size (MB)" hint="Applies to media received and sent in Telegram."><input type="number" min={1} max={2000} value={telegramSettings.mediaMaxMb} onChange={(event) => updateTelegramDraft('mediaMaxMb', Number(event.target.value))} /></Field>
        <Field label="Problem notifications" hint="Choose when a chat should be told that a reply could not be delivered.">
          <select value={telegramSettings.errorPolicy} onChange={(event) => updateTelegramDraft('errorPolicy', event.target.value as TelegramSettings['errorPolicy'])}>
            <option value="always">Every time</option><option value="once">Once, then pause</option><option value="silent">Do not send</option>
          </select>
        </Field>
      </SettingsCard>

      <SettingsCard title="Actions and reactions" description="Choose what Automnia can do in your Telegram chats.">
        <ToggleField label="Send separate messages" hint="Allow Automnia to start a new Telegram message." checked={telegramSettings.sendMessage} onChange={(value) => updateTelegramDraft('sendMessage', value)} />
        <ToggleField label="Delete messages" hint="Allow Automnia to remove Telegram messages." checked={telegramSettings.deleteMessage} onChange={(value) => updateTelegramDraft('deleteMessage', value)} />
        <ToggleField label="Add or remove reactions" hint="Allow Automnia to manage emoji reactions." checked={telegramSettings.reactions} onChange={(value) => updateTelegramDraft('reactions', value)} />
        <ToggleField label="Send stickers" hint="Allow Automnia to find and send stickers." checked={telegramSettings.sticker} onChange={(value) => updateTelegramDraft('sticker', value)} />
        <ToggleField label="Create polls" hint="Sending messages must also be enabled." checked={telegramSettings.poll} onChange={(value) => updateTelegramDraft('poll', value)} />
        <Field label="Reaction notifications" hint="Choose which reactions Automnia should notice.">
          <select value={telegramSettings.reactionNotifications} onChange={(event) => updateTelegramDraft('reactionNotifications', event.target.value as TelegramSettings['reactionNotifications'])}>
            <option value="own">Own messages</option><option value="all">All messages</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Reaction notification detail" hint="Choose how much information to include with reaction updates.">
          <select value={telegramSettings.reactionLevel} onChange={(event) => updateTelegramDraft('reactionLevel', event.target.value as TelegramSettings['reactionLevel'])}>
            <option value="minimal">Minimal</option><option value="ack">Acknowledgement only</option><option value="extensive">Extensive</option><option value="off">Off</option>
          </select>
        </Field>
        <Field label="Automatic acknowledgement reactions" hint="Choose where Automnia can react to show that a message was received.">
          <select value={telegramSettings.ackReactionScope} onChange={(event) => updateTelegramDraft('ackReactionScope', event.target.value as TelegramSettings['ackReactionScope'])}>
            <option value="group-mentions">Group mentions</option><option value="direct">Direct messages</option><option value="group-all">All group messages</option><option value="all">All chats</option><option value="off">Off</option>
          </select>
        </Field>
        <div className="dui-settings-actions">
          <button type="button" onClick={() => void loadTelegramFromGateway()} disabled={telegramLoading || telegramSaving}>{telegramLoading ? 'Refreshing…' : 'Refresh settings'}</button>
          <button type="button" onClick={() => { const next = normalizeTelegramSettings(DEFAULT_TELEGRAM_SETTINGS); setTelegramSettings(next); saveTelegramSettings(next); void applyTelegramSettings(next) }} disabled={telegramLoading || telegramSaving}>{telegramSaving ? 'Applying…' : 'Restore safe defaults'}</button>
          <button type="button" className="is-primary" onClick={() => void applyTelegramSettings()} disabled={telegramLoading || telegramSaving}>{telegramSaving ? 'Saving and applying…' : 'Save Telegram settings'}</button>
        </div>
        {telegramLoadError && <p role="alert" style={{ color: '#fbbf24', margin: '0.7rem 0 0', fontSize: '0.82rem' }}>{telegramLoadError}</p>}
      </SettingsCard>
    </div>
  )

  const renderData = () => (
    <div className="dui-settings-section" id="settings-section-data">
      <SectionHeader section="data" eyebrow="Keep your preferences safe" />
      <SettingsCard title="Settings backup" description="Save your preferences so you can restore them later. Account and provider sign-ins are not included.">
        <div className="dui-settings-metrics"><div><span>Agents</span><strong>{agents.length}</strong></div><div><span>Active team</span><strong>{activePartyIds.length}</strong></div><div><span>Saved responses</span><strong>{responseCount}</strong></div></div>
        <div className="dui-settings-actions"><button type="button" onClick={downloadSettingsBackup}>Download backup</button><button type="button" onClick={() => void copySettingsBackup()}>Copy settings backup</button><button type="button" disabled={backupReading} onClick={() => backupInputRef.current?.click()}>{backupReading ? 'Reading backup…' : 'Import backup'}</button><input ref={backupInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { void previewSettingsBackup(event.target.files?.[0]); event.target.value = '' }} /></div>
        {backupPreview && <div className="mt-4 space-y-3 rounded-lg border border-white/15 p-3">
          <p className="text-sm text-slate-200">Choose what to restore. Your current choices in those groups will be replaced.</p>
          {(Object.keys(backupPreview) as PreferenceGroup[]).map((group) => <div key={group} className="rounded border border-white/10 p-3"><label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={backupGroups.includes(group)} onChange={(event) => setBackupGroups((current) => event.target.checked ? [...current, group] : current.filter((value) => value !== group))} />{PREFERENCE_GROUP_LABELS[group]}</label><details className="mt-2 text-xs text-slate-400"><summary>Preview contents</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(backupPreview[group], null, 2)}</pre></details></div>)}
          <div className="dui-settings-actions"><button type="button" disabled={!backupGroups.length} onClick={applySettingsBackup}>Restore selected preferences</button><button type="button" onClick={() => setBackupPreview(null)}>Cancel import</button></div>
        </div>}
      </SettingsCard>
      <SettingsCard title="Cleanup" description="Remove drafts and saved activity without changing your agents or sign-ins.">
        <div className="dui-settings-actions dui-settings-actions--stack"><button type="button" onClick={() => { const count = clearAllCommandConsoleDrafts(); setNotice({ tone: 'success', text: `Cleared ${count} unfinished message${count === 1 ? '' : 's'}.` }) }}>Clear unfinished messages</button><button type="button" onClick={async () => { setNotice({ tone: 'neutral', text: 'Clearing saved responses…' }); const result = await clearAgentResponses(); setNotice({ tone: result.ok ? 'success' : 'error', text: result.message }) }}>Clear saved responses</button><button type="button" onClick={() => { resetSimulation(); setNotice({ tone: 'success', text: 'Agent activity status reset.' }) }}>Reset agent activity</button></div>
      </SettingsCard>
      <SettingsCard title="Reset" description="Restore default preferences while keeping your important data.">
        <div className="dui-settings-recovery"><strong>Reset all preferences</strong><p>Restores appearance, workspace, voice, and mission choices. Your agents, sign-ins, plugins, workspaces, and files stay in place.</p><button type="button" onClick={() => setPendingConfirmation('reset-all')}>Reset all preferences</button></div>
        <div className="dui-settings-recovery is-danger"><strong>Clear the active workspace</strong><p>Removes the current team and saved responses. Your agents remain available.</p><button type="button" onClick={() => setPendingConfirmation('clear-workspace')}>Clear team and responses</button></div>
      </SettingsCard>
    </div>
  )

  const renderUpdates = () => (
    <div className="dui-settings-section" id="settings-section-updates">
      <SectionHeader section="updates" eyebrow="Keep Automnia current" />
      <AppUpdateSettings />
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
    const isProPlan = /(?:^|[_-])(pro|enterprise)(?:$|[_-])/.test((license?.tier || '').toLowerCase())
    const isCurrentStarterPlan = license?.active === true && !isProPlan
    const isCurrentProPlan = license?.active === true && isProPlan
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
        setUsagePriorityError('Starter and credit refills use Automnia credits. Upgrade to Pro to use your own provider.')
        return
      }
      if (!byokAllowed && nextPriority !== 'automnia_only') {
        setUsagePriorityError('Starter uses Automnia credits. Upgrade to Pro to add your own provider.')
        return
      }
      setUsagePriorityBusy(true)
      setUsagePriorityError('')
      try {
        await setUsagePriority(nextPriority)
        setNotice({
          tone: 'success',
          text: nextPriority === 'provider_first'
            ? 'Preference saved. Your provider will be used first, with Automnia credits as backup.'
            : nextPriority === 'automnia_first_with_provider_fallback'
              ? 'Preference saved. Automnia credits will be used first, with your provider as backup.'
              : usagePriorityLocked
                ? 'Preference saved. Automnia credits will be used.'
                : 'Preference saved. Automnia credits will be used first, with your provider available when needed.',
        })
      } catch (error) {
        setUsagePriorityError(error instanceof Error ? error.message : 'Could not save your usage preference.')
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
      <div className="dui-settings-section dui-settings-account-section" id="settings-section-account">
        <SectionHeader section="account" eyebrow="Manage your account and access" />
        <div className="dui-settings-account-hero">
          <div>
            <span>Signed in as</span>
            <strong>{license?.email || 'Account email unavailable'}</strong>
            <small>{account?.googleLinked ? 'Google sign-in linked' : account?.hasPassword ? 'Automnia password enabled' : account ? 'Google connection required for password setup' : 'Account security details loading'}</small>
          </div>
          <div data-tone={license?.active ? 'active' : 'inactive'}>
            <span>Account access</span>
            <strong>{license?.active ? `Active · ${isProPlan ? 'Pro Access' : 'Starter'}` : 'Not active'}</strong>
            <small>{license?.active ? 'Ready to use' : 'Choose a plan to get started'}</small>
          </div>
        </div>
        <div className="dui-settings-account-overview">
          <SettingsCard className="dui-settings-account-card dui-settings-account-profile" title="Profile & sign-in" description="Manage your email and password.">
            <Field label="Account email">
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
                        ? 'You can sign in with Google or your Automnia password. Enter your current password below only if you want to change it.'
                        : 'Enter your current password below to choose a new one.'
                      : account.googleLinked
                        ? 'Create a password to add email and password sign-in alongside Google.'
                        : 'Connect Google to confirm your account before creating a password.'}
                </p>
              </div>
              {!checking && account && !account.googleLinked && !account.hasPassword && (
                <button className="dui-settings-account-password__connect" type="button" onClick={() => void reconnectGoogleForPassword()} disabled={googleReconnectBusy}>
                  {googleReconnectBusy ? 'Connecting Google…' : 'Connect Google securely'}
                </button>
              )}
              {!checking && account && (account.hasPassword || account.googleLinked) && <>
                <div className="dui-settings-account-password__form">
                  {account.hasPassword && <label className="dui-settings-account-password__field dui-settings-account-password__field--current">
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
          <SettingsCard className="dui-settings-account-card dui-settings-account-plans" title="Starter and Pro" description="Compare the options available to you.">
            <section className="dui-plan-catalog" aria-label="Starter and Pro comparison">
              <article className={`dui-plan-card${isCurrentStarterPlan ? ' is-current' : ''}`}>
                <div className="dui-plan-card__head">
                  <div><span>STARTER</span><h4>Build your momentum</h4></div>
                  {isCurrentStarterPlan && <b>Selected</b>}
                </div>
                <strong className="dui-plan-card__credits">{formatAutomniaCreditsFromTokens(AUTOMNIA_STARTER_TOKENS, '')} <small>credits</small></strong>
                <p>Everything you need to explore, build, and run core Automnia workflows.</p>
                <ul>
                  <li>Ready-to-use AI</li>
                  <li>Essential agents and workflows</li>
                  <li>Secure processing</li>
                  <li>Simple credit billing</li>
                </ul>
                {!isCurrentStarterPlan && <button type="button" onClick={() => void openCheckout()} disabled={checkoutBusy}>{checkoutBusy ? 'Opening checkout…' : 'Choose Starter'}</button>}
              </article>
              <article className={`dui-plan-card is-pro${isCurrentProPlan ? ' is-current' : ''}`}>
                <div className="dui-plan-card__head">
                  <div><span>MOST CAPABLE</span><h4>Pro</h4></div>
                  {isCurrentProPlan ? <b>Selected</b> : <b>Full access</b>}
                </div>
                <strong className="dui-plan-card__credits">{formatAutomniaCreditsFromTokens(AUTOMNIA_PRO_TOKENS, '')} <small>credits</small></strong>
                <p>Get full access and the flexibility to use your own AI provider.</p>
                <ul>
                  <li>Everything in Starter</li>
                  <li>All Automnia models and advanced workflows</li>
                  <li>Use your own AI provider</li>
                  <li>Choose which service is used first</li>
                </ul>
                {!isCurrentProPlan && <button type="button" onClick={() => void openCheckout()} disabled={checkoutBusy}>{checkoutBusy ? 'Opening checkout…' : 'Upgrade to Pro'}</button>}
              </article>
            </section>
          </SettingsCard>
        </div>
        <SettingsCard className="dui-settings-account-billing" title="Usage & credits" description="Choose your AI service and check your Automnia credits.">
          <div className="dui-settings-account-fields">
            <Field label="AI service" hint={usagePriorityLocked ? 'Starter uses Automnia credits.' : hostedCredits || isByok ? 'Choose Automnia credits, or add your connected provider.' : 'Choose a plan to start using Automnia.'}>
              <select
                value={usagePriorityManaged ? (usagePriority === 'automnia_only' ? 'automnia_only' : 'provider_plus_automnia') : 'automnia_only'}
                disabled={!usagePriorityManaged || usagePriorityBusy || usagePriorityLocked}
                onChange={(event) => void saveUsagePriority(event.target.value === 'automnia_only' ? 'automnia_only' : 'provider_first')}
              >
                <option value="automnia_only">Automnia credits</option>
                <option value="provider_plus_automnia" disabled={!byokAllowed}>My provider + Automnia credits{byokAllowed ? '' : ' — available with Pro'}</option>
              </select>
              {usagePriority !== 'automnia_only' && <div style={{ marginTop: '0.6rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#cbd5e1' }}>
                  Use first
                  <select
                    value={usagePriority}
                    disabled={usagePriorityBusy}
                    onChange={(event) => void saveUsagePriority(event.target.value as 'provider_first' | 'automnia_first_with_provider_fallback')}
                    style={{ display: 'block', width: '100%', marginTop: '0.3rem' }}
                  >
                    <option value="provider_first">My provider, then Automnia credits</option>
                    <option value="automnia_first_with_provider_fallback">Automnia credits, then my provider</option>
                  </select>
                </label>
              </div>}
            </Field>
          </div>
          <section className="dui-settings-billing-summary" data-billing-mode={hostedCredits ? 'hosted' : isByok ? 'byok' : 'inactive'} aria-label="Automnia credit balance">
            <div className="dui-settings-billing-summary__head">
              <div>
                <span>Automnia credits</span>
                <strong>{hostedCredits || isByok ? balance : 'Not available'}</strong>
                <small>{hostedCredits || isByok ? `Updated ${formatAccountTimestamp(license?.creditBalanceUpdatedAt)}` : 'Choose a plan to receive credits.'}</small>
              </div>
              <b>{hostedCredits || isByok ? license?.creditBalance === 0 ? 'Empty' : 'Available' : 'Inactive'}</b>
            </div>
          </section>
          {(hostedCredits || isByok) && usagePriority === 'automnia_only' && license?.creditBalance === 0 && <p role="alert" style={{ margin: '0.8rem 0 0', color: '#fda4af' }}>
            Your Automnia credits are empty. Add credits, or choose your connected provider if your plan includes provider access.
          </p>}
          <section className="dui-settings-account-actions" aria-labelledby="settings-account-actions-title">
            <div className="dui-settings-account-actions__head">
              <div>
                <span>Account options</span>
                <strong id="settings-account-actions-title">Billing and account</strong>
              </div>
              <small>Account settings</small>
            </div>
            <div className="dui-settings-account-actions__grid">
              <button
                type="button"
                className="dui-settings-account-action is-primary"
                onClick={() => void openCheckout()}
                disabled={checkoutBusy}
              >
                <span>
                  <small>Plan and credits</small>
                  <strong>{checkoutBusy ? 'Opening secure checkout…' : hostedCredits ? 'Manage credits or upgrade' : isByok ? 'Upgrade your Automnia access' : 'Choose an Automnia plan'}</strong>
                  <em>{hostedCredits ? 'Add credits or compare available plans.' : 'View available Automnia plans.'}</em>
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
                  <em>Get the latest plan and credit information.</em>
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
                  <strong>{isByok ? 'Link another purchase' : 'Link an existing license'}</strong>
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
          {isByok && <p style={{ color: '#93c5fd', margin: '0.75rem 0 0', fontSize: '0.84rem' }}>Your connected provider and any Automnia credits from Starter remain available. Choose which service you want Automnia to use first.</p>}
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
    if (section === 'updates') return renderUpdates()
    if (section === 'logs') return <SettingsActivityLog />
    return renderData()
  }

  const confirmationCopy: Record<Exclude<PendingConfirmation, null>, { title: string; text: string; action: string }> = {
    'reset-all': { title: 'Reset all preferences?', text: 'Your agents, sign-ins, plugins, and files will stay in place.', action: 'Reset preferences' },
    'reset-runtime': { title: 'Restore agent defaults?', text: `This will restore the default work preferences for ${targetIds.length} agent${targetIds.length === 1 ? '' : 's'}.`, action: 'Restore agent defaults' },
    'clear-workspace': { title: 'Clear team and responses?', text: 'This removes the active team and saved responses. Your agents will remain available.', action: 'Clear workspace' },
  }

  const confirmPendingAction = () => {
    if (pendingConfirmation === 'reset-all') resetAllSettings()
    else if (pendingConfirmation === 'reset-runtime') void applyRuntimeToTargets(DEFAULT_RUNTIME_SETTINGS, true)
    else if (pendingConfirmation === 'clear-workspace') {
      setPendingConfirmation(null)
      setNotice({ tone: 'neutral', text: 'Clearing the active team and saved responses…' })
      void clearAll().then((result) => setNotice({ tone: result.ok ? 'success' : 'error', text: result.message }))
    }
  }

  return (
    <section ref={settingsRoot} data-dui-panel="settings" data-ui-revision="settings-v2" className="dui-settings-panel dui-settings-redesign dui-settings-polished">
      <header className="dui-settings-topbar">
        <div><span>Your preferences</span><h2>Settings</h2><p>Make Automnia work the way you do.</p></div>
        <label className="dui-settings-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" />{searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear settings search">×</button>}</label>
      </header>

      {notice.text && <div className="dui-settings-status" data-tone={notice.tone} role="status" aria-live="polite"><i aria-hidden="true" /><span>{notice.text}</span></div>}

      <Dialog open={pendingConfirmation !== null} role="alertdialog" onClose={() => setPendingConfirmation(null)} title={pendingConfirmation ? confirmationCopy[pendingConfirmation].title : ''} description={pendingConfirmation ? confirmationCopy[pendingConfirmation].text : ''} footer={<>
        <Button variant="secondary" onClick={() => setPendingConfirmation(null)}>Cancel</Button>
        <Button variant="danger" onClick={confirmPendingAction}>{pendingConfirmation ? confirmationCopy[pendingConfirmation].action : 'Confirm'}</Button>
      </>}>{null}</Dialog>

      <div className="dui-settings-layout">
        <nav className="dui-settings-nav" aria-label="Settings categories">
          <p className="dui-settings-nav-label">Settings</p>
          {SETTINGS_SECTIONS.map((section) => (
            <button key={section.id} type="button" aria-current={!normalizedSearch && activeSection === section.id ? 'page' : undefined} aria-controls={`settings-section-${section.id}`} data-settings-section={section.id} data-active={!normalizedSearch && activeSection === section.id ? 'true' : 'false'} onClick={() => { setActiveSection(section.id); setSearchQuery('') }}>
              <span aria-hidden="true"><SettingsGlyph name={section.id} /></span>
              <div><strong>{section.label}</strong><small>{section.description}</small></div>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </nav>

        <div data-workspace-scroll="settings" className="dui-settings-content">
          {normalizedSearch && <div className="dui-settings-results"><strong>Search all settings</strong><span>Results for “{searchQuery.trim()}”</span></div>}
          <SettingsSearchMatches query={searchQuery} root={settingsRoot} />
          {visibleSections.length ? visibleSections.map((section) => <div key={section} data-search-section-name={section} data-search-section-keywords={SETTINGS_SECTIONS.find((entry) => entry.id === section)?.keywords}>{renderSection(section)}</div>) : <div className="dui-settings-empty"><SettingsGlyph name="appearance" /><strong>No settings found</strong><span>Try “voice”, “chat”, “mission”, “contrast”, or “agents”.</span><button type="button" onClick={() => setSearchQuery('')}>Clear search</button></div>}
        </div>
      </div>
    </section>
  )
}

export default SettingsPanel
