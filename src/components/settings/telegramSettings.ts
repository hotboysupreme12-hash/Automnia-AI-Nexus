import { readPreferenceValue, savePreferenceEntries } from './preferenceStorage'
export const TELEGRAM_SETTINGS_STORAGE_KEY = 'automnia-telegram-settings-v1'

export type TelegramNativeCommands = 'auto' | 'on' | 'off'
export type TelegramStreamingMode = 'off' | 'partial' | 'block' | 'progress'
export type TelegramStreamChunkMode = 'length' | 'newline'
export type TelegramMarkdownTableMode = 'off' | 'bullets' | 'code' | 'block'
export type TelegramNetworkFamily = 'on' | 'off'
export type TelegramDnsResultOrder = 'auto' | 'ipv4first' | 'verbatim'
export type TelegramInlineButtons = 'off' | 'dm' | 'group' | 'all' | 'allowlist'
export type TelegramReplyToMode = 'off' | 'first' | 'all'
export type TelegramDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
export type TelegramGroupPolicy = 'open' | 'allowlist' | 'disabled'
export type TelegramReactionNotifications = 'off' | 'own' | 'all'
export type TelegramReactionLevel = 'off' | 'ack' | 'minimal' | 'extensive'
export type TelegramAckReactionScope = 'off' | 'direct' | 'all' | 'group-all' | 'group-mentions'
export type TelegramErrorPolicy = 'always' | 'once' | 'silent'

export type TelegramSettings = {
  nativeCommands: TelegramNativeCommands
  nativeSkills: TelegramNativeCommands
  streamingMode: TelegramStreamingMode
  streamChunkMode: TelegramStreamChunkMode
  toolProgress: boolean
  linkPreview: boolean
  replyToMode: TelegramReplyToMode
  inlineButtons: TelegramInlineButtons
  richMessages: boolean
  widgets: boolean
  markdownTableMode: TelegramMarkdownTableMode
  responsePrefix: string
  dmPolicy: TelegramDmPolicy
  groupPolicy: TelegramGroupPolicy
  historyLimit: number
  dmHistoryLimit: number
  textChunkLimit: number
  mediaMaxMb: number
  errorPolicy: TelegramErrorPolicy
  silentErrorReplies: boolean
  configWrites: boolean
  sendMessage: boolean
  editMessage: boolean
  deleteMessage: boolean
  reactions: boolean
  sticker: boolean
  poll: boolean
  createForumTopic: boolean
  editForumTopic: boolean
  joinIntro: boolean
  autoTopicLabel: boolean
  networkAutoSelectFamily: TelegramNetworkFamily
  networkDnsResultOrder: TelegramDnsResultOrder
  reactionNotifications: TelegramReactionNotifications
  reactionLevel: TelegramReactionLevel
  ackReactionScope: TelegramAckReactionScope
}

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  nativeCommands: 'auto',
  nativeSkills: 'auto',
  streamingMode: 'progress',
  streamChunkMode: 'length',
  toolProgress: true,
  linkPreview: true,
  replyToMode: 'off',
  inlineButtons: 'allowlist',
  richMessages: false,
  widgets: false,
  markdownTableMode: 'off',
  responsePrefix: '',
  dmPolicy: 'pairing',
  groupPolicy: 'allowlist',
  historyLimit: 50,
  dmHistoryLimit: 20,
  textChunkLimit: 4_000,
  mediaMaxMb: 100,
  errorPolicy: 'always',
  silentErrorReplies: false,
  configWrites: true,
  sendMessage: false,
  editMessage: false,
  deleteMessage: false,
  reactions: false,
  sticker: false,
  poll: false,
  createForumTopic: false,
  editForumTopic: false,
  joinIntro: true,
  autoTopicLabel: true,
  networkAutoSelectFamily: 'on',
  networkDnsResultOrder: 'ipv4first',
  reactionNotifications: 'own',
  reactionLevel: 'minimal',
  ackReactionScope: 'group-mentions',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): Record<string, unknown> {
  const record = isRecord(value) && isRecord(value[key]) ? value[key] : {}
  return record
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function boundedText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
}

export function normalizeTelegramSettings(value: Partial<TelegramSettings> | null | undefined): TelegramSettings {
  const input = value || {}
  return {
    nativeCommands: enumValue(input.nativeCommands, ['auto', 'on', 'off'], DEFAULT_TELEGRAM_SETTINGS.nativeCommands),
    nativeSkills: enumValue(input.nativeSkills, ['auto', 'on', 'off'], DEFAULT_TELEGRAM_SETTINGS.nativeSkills),
    streamingMode: enumValue(input.streamingMode, ['off', 'partial', 'block', 'progress'], DEFAULT_TELEGRAM_SETTINGS.streamingMode),
    streamChunkMode: enumValue(input.streamChunkMode, ['length', 'newline'], DEFAULT_TELEGRAM_SETTINGS.streamChunkMode),
    toolProgress: booleanValue(input.toolProgress, DEFAULT_TELEGRAM_SETTINGS.toolProgress),
    linkPreview: booleanValue(input.linkPreview, DEFAULT_TELEGRAM_SETTINGS.linkPreview),
    replyToMode: enumValue(input.replyToMode, ['off', 'first', 'all'], DEFAULT_TELEGRAM_SETTINGS.replyToMode),
    inlineButtons: enumValue(input.inlineButtons, ['off', 'dm', 'group', 'all', 'allowlist'], DEFAULT_TELEGRAM_SETTINGS.inlineButtons),
    richMessages: booleanValue(input.richMessages, DEFAULT_TELEGRAM_SETTINGS.richMessages),
    widgets: booleanValue(input.widgets, DEFAULT_TELEGRAM_SETTINGS.widgets),
    markdownTableMode: enumValue(input.markdownTableMode, ['off', 'bullets', 'code', 'block'], DEFAULT_TELEGRAM_SETTINGS.markdownTableMode),
    responsePrefix: boundedText(input.responsePrefix, DEFAULT_TELEGRAM_SETTINGS.responsePrefix, 200),
    dmPolicy: enumValue(input.dmPolicy, ['pairing', 'allowlist', 'open', 'disabled'], DEFAULT_TELEGRAM_SETTINGS.dmPolicy),
    groupPolicy: enumValue(input.groupPolicy, ['open', 'allowlist', 'disabled'], DEFAULT_TELEGRAM_SETTINGS.groupPolicy),
    historyLimit: boundedNumber(input.historyLimit, DEFAULT_TELEGRAM_SETTINGS.historyLimit, 0, 200),
    dmHistoryLimit: boundedNumber(input.dmHistoryLimit, DEFAULT_TELEGRAM_SETTINGS.dmHistoryLimit, 0, 200),
    textChunkLimit: boundedNumber(input.textChunkLimit, DEFAULT_TELEGRAM_SETTINGS.textChunkLimit, 100, 4_096),
    mediaMaxMb: boundedNumber(input.mediaMaxMb, DEFAULT_TELEGRAM_SETTINGS.mediaMaxMb, 1, 2_000),
    errorPolicy: enumValue(input.errorPolicy, ['always', 'once', 'silent'], DEFAULT_TELEGRAM_SETTINGS.errorPolicy),
    silentErrorReplies: booleanValue(input.silentErrorReplies, DEFAULT_TELEGRAM_SETTINGS.silentErrorReplies),
    configWrites: booleanValue(input.configWrites, DEFAULT_TELEGRAM_SETTINGS.configWrites),
    sendMessage: booleanValue(input.sendMessage, DEFAULT_TELEGRAM_SETTINGS.sendMessage),
    editMessage: booleanValue(input.editMessage, DEFAULT_TELEGRAM_SETTINGS.editMessage),
    deleteMessage: booleanValue(input.deleteMessage, DEFAULT_TELEGRAM_SETTINGS.deleteMessage),
    reactions: booleanValue(input.reactions, DEFAULT_TELEGRAM_SETTINGS.reactions),
    sticker: booleanValue(input.sticker, DEFAULT_TELEGRAM_SETTINGS.sticker),
    poll: booleanValue(input.poll, DEFAULT_TELEGRAM_SETTINGS.poll),
    createForumTopic: booleanValue(input.createForumTopic, DEFAULT_TELEGRAM_SETTINGS.createForumTopic),
    editForumTopic: booleanValue(input.editForumTopic, DEFAULT_TELEGRAM_SETTINGS.editForumTopic),
    joinIntro: booleanValue(input.joinIntro, DEFAULT_TELEGRAM_SETTINGS.joinIntro),
    autoTopicLabel: booleanValue(input.autoTopicLabel, DEFAULT_TELEGRAM_SETTINGS.autoTopicLabel),
    networkAutoSelectFamily: enumValue(input.networkAutoSelectFamily, ['on', 'off'], DEFAULT_TELEGRAM_SETTINGS.networkAutoSelectFamily),
    networkDnsResultOrder: enumValue(input.networkDnsResultOrder, ['ipv4first', 'verbatim'], DEFAULT_TELEGRAM_SETTINGS.networkDnsResultOrder),
    reactionNotifications: enumValue(input.reactionNotifications, ['off', 'own', 'all'], DEFAULT_TELEGRAM_SETTINGS.reactionNotifications),
    reactionLevel: enumValue(input.reactionLevel, ['off', 'ack', 'minimal', 'extensive'], DEFAULT_TELEGRAM_SETTINGS.reactionLevel),
    ackReactionScope: enumValue(input.ackReactionScope, ['off', 'direct', 'all', 'group-all', 'group-mentions'], DEFAULT_TELEGRAM_SETTINGS.ackReactionScope),
  }
}

function parseJsonObject(output: string): Record<string, unknown> | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(output || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

export function parseTelegramConfigOutput(output: string): Partial<TelegramSettings> | null {
  const root = parseJsonObject(output)
  if (!root) return null
  const telegram = isRecord(root.telegram) ? root.telegram : recordAt(root, 'channels').telegram || root
  if (!isRecord(telegram)) return null
  const commands = recordAt(telegram, 'commands')
  const streaming = recordAt(telegram, 'streaming')
  const preview = recordAt(streaming, 'preview')
  const capabilities = recordAt(telegram, 'capabilities')
  const actions = recordAt(telegram, 'actions')
  const markdown = recordAt(telegram, 'markdown')
  const network = recordAt(telegram, 'network')
  const messages = isRecord(root.messages) ? root.messages : root.ackReactionScope !== undefined ? root : {}
  const result: Partial<TelegramSettings> = {}
  const setBoolean = <Key extends keyof TelegramSettings>(key: Key, value: unknown) => {
    if (typeof value === 'boolean') result[key] = value as TelegramSettings[Key]
  }
  const setNumber = <Key extends keyof TelegramSettings>(key: Key, value: unknown, min: number, max: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = boundedNumber(value, 0, min, max) as TelegramSettings[Key]
  }
  const setEnum = <Key extends keyof TelegramSettings, Value extends string>(key: Key, value: unknown, allowed: readonly Value[]) => {
    if (typeof value === 'string' && allowed.includes(value as Value)) result[key] = value as TelegramSettings[Key]
  }

  if (commands.native === true) result.nativeCommands = 'on'
  else if (commands.native === false) result.nativeCommands = 'off'
  else setEnum('nativeCommands', commands.native, ['auto', 'on', 'off'] as const)
  if (commands.nativeSkills === true) result.nativeSkills = 'on'
  else if (commands.nativeSkills === false) result.nativeSkills = 'off'
  else setEnum('nativeSkills', commands.nativeSkills, ['auto', 'on', 'off'] as const)
  setEnum('streamingMode', streaming.mode, ['off', 'partial', 'block', 'progress'] as const)
  setEnum('streamChunkMode', streaming.chunkMode, ['length', 'newline'] as const)
  setBoolean('toolProgress', preview.toolProgress)
  setBoolean('linkPreview', telegram.linkPreview)
  setEnum('replyToMode', telegram.replyToMode, ['off', 'first', 'all'] as const)
  setEnum('inlineButtons', capabilities.inlineButtons, ['off', 'dm', 'group', 'all', 'allowlist'] as const)
  setBoolean('richMessages', telegram.richMessages)
  setBoolean('widgets', telegram.widgets)
  setEnum('markdownTableMode', markdown.tables, ['off', 'bullets', 'code', 'block'] as const)
  if (typeof telegram.responsePrefix === 'string') result.responsePrefix = boundedText(telegram.responsePrefix, '', 200)
  setEnum('dmPolicy', telegram.dmPolicy, ['pairing', 'allowlist', 'open', 'disabled'] as const)
  setEnum('groupPolicy', telegram.groupPolicy, ['open', 'allowlist', 'disabled'] as const)
  setNumber('historyLimit', telegram.historyLimit, 0, 200)
  setNumber('dmHistoryLimit', telegram.dmHistoryLimit, 0, 200)
  setNumber('textChunkLimit', telegram.textChunkLimit, 100, 4_096)
  setNumber('mediaMaxMb', telegram.mediaMaxMb, 1, 2_000)
  setEnum('errorPolicy', telegram.errorPolicy, ['always', 'once', 'silent'] as const)
  setBoolean('silentErrorReplies', telegram.silentErrorReplies)
  setBoolean('configWrites', telegram.configWrites)
  setBoolean('sendMessage', actions.sendMessage)
  setBoolean('editMessage', actions.editMessage)
  setBoolean('deleteMessage', actions.deleteMessage)
  setBoolean('reactions', actions.reactions)
  setBoolean('sticker', actions.sticker)
  setBoolean('poll', actions.poll)
  setBoolean('createForumTopic', actions.createForumTopic)
  setBoolean('editForumTopic', actions.editForumTopic)
  setBoolean('joinIntro', telegram.joinIntro)
  if (typeof telegram.autoTopicLabel === 'boolean') result.autoTopicLabel = telegram.autoTopicLabel
  else if (isRecord(telegram.autoTopicLabel)) setBoolean('autoTopicLabel', telegram.autoTopicLabel.enabled)
  if (network.autoSelectFamily === true) result.networkAutoSelectFamily = 'on'
  else if (network.autoSelectFamily === false) result.networkAutoSelectFamily = 'off'
  setEnum('networkDnsResultOrder', network.dnsResultOrder, ['ipv4first', 'verbatim'] as const)
  setEnum('reactionNotifications', telegram.reactionNotifications, ['off', 'own', 'all'] as const)
  setEnum('reactionLevel', telegram.reactionLevel, ['off', 'ack', 'minimal', 'extensive'] as const)
  setEnum('ackReactionScope', messages.ackReactionScope, ['off', 'direct', 'all', 'group-all', 'group-mentions'] as const)
  return result
}

export function readTelegramSettings(): TelegramSettings {
  if (typeof window === 'undefined') return DEFAULT_TELEGRAM_SETTINGS
  try {
    const raw = readPreferenceValue(TELEGRAM_SETTINGS_STORAGE_KEY)
    return normalizeTelegramSettings(raw ? JSON.parse(raw) as Partial<TelegramSettings> : null)
  } catch {
    return DEFAULT_TELEGRAM_SETTINGS
  }
}

export function saveTelegramSettings(settings: TelegramSettings): void {
  if (typeof window === 'undefined') return
  savePreferenceEntries([[TELEGRAM_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeTelegramSettings(settings))]])
}

type TelegramSettingKey = keyof TelegramSettings
type TelegramSettingValue = string | number | boolean
type TelegramSettingDefinition = {
  key: TelegramSettingKey
  path: string
  read: (settings: TelegramSettings) => TelegramSettingValue
}

const TELEGRAM_SETTING_DEFINITIONS: TelegramSettingDefinition[] = [
  { key: 'nativeCommands', path: 'channels.telegram.commands.native', read: (settings) => settings.nativeCommands === 'on' ? true : settings.nativeCommands === 'off' ? false : 'auto' },
  { key: 'nativeSkills', path: 'channels.telegram.commands.nativeSkills', read: (settings) => settings.nativeSkills === 'on' ? true : settings.nativeSkills === 'off' ? false : 'auto' },
  { key: 'streamingMode', path: 'channels.telegram.streaming.mode', read: (settings) => settings.streamingMode },
  { key: 'streamChunkMode', path: 'channels.telegram.streaming.chunkMode', read: (settings) => settings.streamChunkMode },
  { key: 'toolProgress', path: 'channels.telegram.streaming.preview.toolProgress', read: (settings) => settings.toolProgress },
  { key: 'linkPreview', path: 'channels.telegram.linkPreview', read: (settings) => settings.linkPreview },
  { key: 'replyToMode', path: 'channels.telegram.replyToMode', read: (settings) => settings.replyToMode },
  { key: 'inlineButtons', path: 'channels.telegram.capabilities.inlineButtons', read: (settings) => settings.inlineButtons },
  { key: 'richMessages', path: 'channels.telegram.richMessages', read: (settings) => settings.richMessages },
  { key: 'widgets', path: 'channels.telegram.widgets', read: (settings) => settings.widgets },
  { key: 'markdownTableMode', path: 'channels.telegram.markdown.tables', read: (settings) => settings.markdownTableMode },
  { key: 'responsePrefix', path: 'channels.telegram.responsePrefix', read: (settings) => settings.responsePrefix },
  { key: 'dmPolicy', path: 'channels.telegram.dmPolicy', read: (settings) => settings.dmPolicy },
  { key: 'groupPolicy', path: 'channels.telegram.groupPolicy', read: (settings) => settings.groupPolicy },
  { key: 'historyLimit', path: 'channels.telegram.historyLimit', read: (settings) => settings.historyLimit },
  { key: 'dmHistoryLimit', path: 'channels.telegram.dmHistoryLimit', read: (settings) => settings.dmHistoryLimit },
  { key: 'textChunkLimit', path: 'channels.telegram.textChunkLimit', read: (settings) => settings.textChunkLimit },
  { key: 'mediaMaxMb', path: 'channels.telegram.mediaMaxMb', read: (settings) => settings.mediaMaxMb },
  { key: 'errorPolicy', path: 'channels.telegram.errorPolicy', read: (settings) => settings.errorPolicy },
  { key: 'silentErrorReplies', path: 'channels.telegram.silentErrorReplies', read: (settings) => settings.silentErrorReplies },
  { key: 'configWrites', path: 'channels.telegram.configWrites', read: (settings) => settings.configWrites },
  { key: 'sendMessage', path: 'channels.telegram.actions.sendMessage', read: (settings) => settings.sendMessage },
  { key: 'editMessage', path: 'channels.telegram.actions.editMessage', read: (settings) => settings.editMessage },
  { key: 'deleteMessage', path: 'channels.telegram.actions.deleteMessage', read: (settings) => settings.deleteMessage },
  { key: 'reactions', path: 'channels.telegram.actions.reactions', read: (settings) => settings.reactions },
  { key: 'sticker', path: 'channels.telegram.actions.sticker', read: (settings) => settings.sticker },
  { key: 'poll', path: 'channels.telegram.actions.poll', read: (settings) => settings.poll },
  { key: 'createForumTopic', path: 'channels.telegram.actions.createForumTopic', read: (settings) => settings.createForumTopic },
  { key: 'editForumTopic', path: 'channels.telegram.actions.editForumTopic', read: (settings) => settings.editForumTopic },
  { key: 'joinIntro', path: 'channels.telegram.joinIntro', read: (settings) => settings.joinIntro },
  { key: 'autoTopicLabel', path: 'channels.telegram.autoTopicLabel', read: (settings) => settings.autoTopicLabel },
  { key: 'networkAutoSelectFamily', path: 'channels.telegram.network.autoSelectFamily', read: (settings) => settings.networkAutoSelectFamily === 'on' },
  { key: 'networkDnsResultOrder', path: 'channels.telegram.network.dnsResultOrder', read: (settings) => settings.networkDnsResultOrder },
  { key: 'reactionNotifications', path: 'channels.telegram.reactionNotifications', read: (settings) => settings.reactionNotifications },
  { key: 'reactionLevel', path: 'channels.telegram.reactionLevel', read: (settings) => settings.reactionLevel },
  { key: 'ackReactionScope', path: 'messages.ackReactionScope', read: (settings) => settings.ackReactionScope },
]

export function telegramSettingCommandEntries(settings: TelegramSettings): Array<{ key: TelegramSettingKey; command: string }> {
  const normalized = normalizeTelegramSettings(settings)
  const value = (input: string | number | boolean) => JSON.stringify(input)
  return TELEGRAM_SETTING_DEFINITIONS.map(({ key, path, read }) => ({ key, command: `config set ${path} ${value(read(normalized))}` }))
}

export function telegramSettingBatchCommand(settings: TelegramSettings, keys?: readonly TelegramSettingKey[]): string {
  const normalized = normalizeTelegramSettings(settings)
  const allowedKeys = keys ? new Set(keys) : null
  const batch: Array<{ path: string; value: TelegramSettingValue | string[] }> = TELEGRAM_SETTING_DEFINITIONS
    .filter(({ key }) => !allowedKeys || allowedKeys.has(key))
    .map(({ path, read }) => ({ path, value: read(normalized) }))
  if (normalized.dmPolicy === 'open') batch.push({ path: 'channels.telegram.allowFrom', value: ['*'] })
  const payload = JSON.stringify(batch).replace(/'/g, "'\\''")
  return `config set --batch-json '${payload}'`
}

export function telegramSettingCommands(settings: TelegramSettings): string[] {
  const normalized = normalizeTelegramSettings(settings)
  const commands = telegramSettingCommandEntries(normalized).map(({ command }) => command)
  if (normalized.dmPolicy === 'open') commands.push('config set channels.telegram.allowFrom ["*"]')
  return commands
}
