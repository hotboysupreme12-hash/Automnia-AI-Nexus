export const TELEGRAM_SETTINGS_STORAGE_KEY = 'automnia-telegram-settings-v1'

export type TelegramNativeCommands = 'auto' | 'on' | 'off'
export type TelegramStreamingMode = 'off' | 'partial' | 'block' | 'progress'
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
  streamingMode: TelegramStreamingMode
  toolProgress: boolean
  linkPreview: boolean
  replyToMode: TelegramReplyToMode
  inlineButtons: TelegramInlineButtons
  richMessages: boolean
  dmPolicy: TelegramDmPolicy
  groupPolicy: TelegramGroupPolicy
  historyLimit: number
  dmHistoryLimit: number
  textChunkLimit: number
  mediaMaxMb: number
  errorPolicy: TelegramErrorPolicy
  configWrites: boolean
  sendMessage: boolean
  deleteMessage: boolean
  reactions: boolean
  sticker: boolean
  poll: boolean
  reactionNotifications: TelegramReactionNotifications
  reactionLevel: TelegramReactionLevel
  ackReactionScope: TelegramAckReactionScope
}

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  nativeCommands: 'auto',
  streamingMode: 'progress',
  toolProgress: true,
  linkPreview: true,
  replyToMode: 'off',
  inlineButtons: 'allowlist',
  richMessages: false,
  dmPolicy: 'pairing',
  groupPolicy: 'allowlist',
  historyLimit: 50,
  dmHistoryLimit: 20,
  textChunkLimit: 4_000,
  mediaMaxMb: 100,
  errorPolicy: 'always',
  configWrites: true,
  sendMessage: false,
  deleteMessage: false,
  reactions: false,
  sticker: false,
  poll: false,
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

export function normalizeTelegramSettings(value: Partial<TelegramSettings> | null | undefined): TelegramSettings {
  const input = value || {}
  return {
    nativeCommands: enumValue(input.nativeCommands, ['auto', 'on', 'off'], DEFAULT_TELEGRAM_SETTINGS.nativeCommands),
    streamingMode: enumValue(input.streamingMode, ['off', 'partial', 'block', 'progress'], DEFAULT_TELEGRAM_SETTINGS.streamingMode),
    toolProgress: booleanValue(input.toolProgress, DEFAULT_TELEGRAM_SETTINGS.toolProgress),
    linkPreview: booleanValue(input.linkPreview, DEFAULT_TELEGRAM_SETTINGS.linkPreview),
    replyToMode: enumValue(input.replyToMode, ['off', 'first', 'all'], DEFAULT_TELEGRAM_SETTINGS.replyToMode),
    inlineButtons: enumValue(input.inlineButtons, ['off', 'dm', 'group', 'all', 'allowlist'], DEFAULT_TELEGRAM_SETTINGS.inlineButtons),
    richMessages: booleanValue(input.richMessages, DEFAULT_TELEGRAM_SETTINGS.richMessages),
    dmPolicy: enumValue(input.dmPolicy, ['pairing', 'allowlist', 'open', 'disabled'], DEFAULT_TELEGRAM_SETTINGS.dmPolicy),
    groupPolicy: enumValue(input.groupPolicy, ['open', 'allowlist', 'disabled'], DEFAULT_TELEGRAM_SETTINGS.groupPolicy),
    historyLimit: boundedNumber(input.historyLimit, DEFAULT_TELEGRAM_SETTINGS.historyLimit, 0, 200),
    dmHistoryLimit: boundedNumber(input.dmHistoryLimit, DEFAULT_TELEGRAM_SETTINGS.dmHistoryLimit, 0, 200),
    textChunkLimit: boundedNumber(input.textChunkLimit, DEFAULT_TELEGRAM_SETTINGS.textChunkLimit, 100, 4_096),
    mediaMaxMb: boundedNumber(input.mediaMaxMb, DEFAULT_TELEGRAM_SETTINGS.mediaMaxMb, 1, 2_000),
    errorPolicy: enumValue(input.errorPolicy, ['always', 'once', 'silent'], DEFAULT_TELEGRAM_SETTINGS.errorPolicy),
    configWrites: booleanValue(input.configWrites, DEFAULT_TELEGRAM_SETTINGS.configWrites),
    sendMessage: booleanValue(input.sendMessage, DEFAULT_TELEGRAM_SETTINGS.sendMessage),
    deleteMessage: booleanValue(input.deleteMessage, DEFAULT_TELEGRAM_SETTINGS.deleteMessage),
    reactions: booleanValue(input.reactions, DEFAULT_TELEGRAM_SETTINGS.reactions),
    sticker: booleanValue(input.sticker, DEFAULT_TELEGRAM_SETTINGS.sticker),
    poll: booleanValue(input.poll, DEFAULT_TELEGRAM_SETTINGS.poll),
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
  setEnum('streamingMode', streaming.mode, ['off', 'partial', 'block', 'progress'] as const)
  setBoolean('toolProgress', preview.toolProgress)
  setBoolean('linkPreview', telegram.linkPreview)
  setEnum('replyToMode', telegram.replyToMode, ['off', 'first', 'all'] as const)
  setEnum('inlineButtons', capabilities.inlineButtons, ['off', 'dm', 'group', 'all', 'allowlist'] as const)
  setBoolean('richMessages', telegram.richMessages)
  setEnum('dmPolicy', telegram.dmPolicy, ['pairing', 'allowlist', 'open', 'disabled'] as const)
  setEnum('groupPolicy', telegram.groupPolicy, ['open', 'allowlist', 'disabled'] as const)
  setNumber('historyLimit', telegram.historyLimit, 0, 200)
  setNumber('dmHistoryLimit', telegram.dmHistoryLimit, 0, 200)
  setNumber('textChunkLimit', telegram.textChunkLimit, 100, 4_096)
  setNumber('mediaMaxMb', telegram.mediaMaxMb, 1, 2_000)
  setEnum('errorPolicy', telegram.errorPolicy, ['always', 'once', 'silent'] as const)
  setBoolean('configWrites', telegram.configWrites)
  setBoolean('sendMessage', actions.sendMessage)
  setBoolean('deleteMessage', actions.deleteMessage)
  setBoolean('reactions', actions.reactions)
  setBoolean('sticker', actions.sticker)
  setBoolean('poll', actions.poll)
  setEnum('reactionNotifications', telegram.reactionNotifications, ['off', 'own', 'all'] as const)
  setEnum('reactionLevel', telegram.reactionLevel, ['off', 'ack', 'minimal', 'extensive'] as const)
  setEnum('ackReactionScope', messages.ackReactionScope, ['off', 'direct', 'all', 'group-all', 'group-mentions'] as const)
  return result
}

export function readTelegramSettings(): TelegramSettings {
  if (typeof window === 'undefined') return DEFAULT_TELEGRAM_SETTINGS
  try {
    const raw = window.localStorage.getItem(TELEGRAM_SETTINGS_STORAGE_KEY)
    return normalizeTelegramSettings(raw ? JSON.parse(raw) as Partial<TelegramSettings> : null)
  } catch {
    return DEFAULT_TELEGRAM_SETTINGS
  }
}

export function saveTelegramSettings(settings: TelegramSettings): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TELEGRAM_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeTelegramSettings(settings)))
}

export function telegramSettingCommands(settings: TelegramSettings): string[] {
  const normalized = normalizeTelegramSettings(settings)
  const value = (input: string | number | boolean) => JSON.stringify(input)
  const nativeCommands: string | boolean = normalized.nativeCommands === 'on' ? true : normalized.nativeCommands === 'off' ? false : 'auto'
  return [
    `config set channels.telegram.commands.native ${value(nativeCommands)}`,
    `config set channels.telegram.streaming.mode ${value(normalized.streamingMode)}`,
    `config set channels.telegram.streaming.preview.toolProgress ${value(normalized.toolProgress)}`,
    `config set channels.telegram.linkPreview ${value(normalized.linkPreview)}`,
    `config set channels.telegram.replyToMode ${value(normalized.replyToMode)}`,
    `config set channels.telegram.capabilities.inlineButtons ${value(normalized.inlineButtons)}`,
    `config set channels.telegram.richMessages ${value(normalized.richMessages)}`,
    `config set channels.telegram.dmPolicy ${value(normalized.dmPolicy)}`,
    `config set channels.telegram.groupPolicy ${value(normalized.groupPolicy)}`,
    `config set channels.telegram.historyLimit ${value(normalized.historyLimit)}`,
    `config set channels.telegram.dmHistoryLimit ${value(normalized.dmHistoryLimit)}`,
    `config set channels.telegram.textChunkLimit ${value(normalized.textChunkLimit)}`,
    `config set channels.telegram.mediaMaxMb ${value(normalized.mediaMaxMb)}`,
    `config set channels.telegram.errorPolicy ${value(normalized.errorPolicy)}`,
    `config set channels.telegram.configWrites ${value(normalized.configWrites)}`,
    `config set channels.telegram.actions.sendMessage ${value(normalized.sendMessage)}`,
    `config set channels.telegram.actions.deleteMessage ${value(normalized.deleteMessage)}`,
    `config set channels.telegram.actions.reactions ${value(normalized.reactions)}`,
    `config set channels.telegram.actions.sticker ${value(normalized.sticker)}`,
    `config set channels.telegram.actions.poll ${value(normalized.poll)}`,
    `config set channels.telegram.reactionNotifications ${value(normalized.reactionNotifications)}`,
    `config set channels.telegram.reactionLevel ${value(normalized.reactionLevel)}`,
    `config set messages.ackReactionScope ${value(normalized.ackReactionScope)}`,
  ]
}
