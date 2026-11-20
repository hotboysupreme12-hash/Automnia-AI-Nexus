import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TELEGRAM_SETTINGS,
  normalizeTelegramSettings,
  parseTelegramConfigOutput,
  telegramSettingBatchCommand,
  telegramSettingCommandEntries,
  telegramSettingCommands,
} from '../src/components/settings/telegramSettings'

test('Telegram settings normalize unsafe or out-of-range drafts to supported values', () => {
  const settings = normalizeTelegramSettings({
    dmPolicy: 'open',
    groupPolicy: 'invalid' as never,
    historyLimit: 999,
    textChunkLimit: 12,
    mediaMaxMb: -1,
    richMessages: true,
    streamChunkMode: 'invalid' as never,
    markdownTableMode: 'code',
    responsePrefix: '  Automnia\u0000  ',
    networkAutoSelectFamily: 'auto' as never,
  })

  assert.equal(settings.dmPolicy, 'open')
  assert.equal(settings.groupPolicy, DEFAULT_TELEGRAM_SETTINGS.groupPolicy)
  assert.equal(settings.historyLimit, 200)
  assert.equal(settings.textChunkLimit, 100)
  assert.equal(settings.mediaMaxMb, 1)
  assert.equal(settings.richMessages, true)
  assert.equal(settings.streamChunkMode, DEFAULT_TELEGRAM_SETTINGS.streamChunkMode)
  assert.equal(settings.markdownTableMode, 'code')
  assert.equal(settings.responsePrefix, 'Automnia')
  assert.equal(settings.networkAutoSelectFamily, DEFAULT_TELEGRAM_SETTINGS.networkAutoSelectFamily)
})

test('Telegram settings parse live non-secret channel config and message settings', () => {
  const channel = parseTelegramConfigOutput(JSON.stringify({
    commands: { native: true, nativeSkills: false },
    streaming: { mode: 'partial', chunkMode: 'newline', preview: { toolProgress: false } },
    linkPreview: false,
    replyToMode: 'first',
    capabilities: { inlineButtons: 'dm' },
    richMessages: true,
    widgets: true,
    markdown: { tables: 'block' },
    responsePrefix: 'Automnia:',
    dmPolicy: 'allowlist',
    groupPolicy: 'open',
    historyLimit: 12,
    dmHistoryLimit: 8,
    textChunkLimit: 3900,
    mediaMaxMb: 25,
    errorPolicy: 'once',
    silentErrorReplies: true,
    configWrites: false,
    actions: { sendMessage: true, editMessage: true, poll: true, createForumTopic: true, editForumTopic: true },
    joinIntro: false,
    autoTopicLabel: { enabled: false },
    network: { autoSelectFamily: false, dnsResultOrder: 'verbatim' },
    reactionNotifications: 'all',
    reactionLevel: 'extensive',
  }))
  const messages = parseTelegramConfigOutput(JSON.stringify({ ackReactionScope: 'direct' }))

  assert.equal(channel?.nativeCommands, 'on')
  assert.equal(channel?.nativeSkills, 'off')
  assert.equal(channel?.streamingMode, 'partial')
  assert.equal(channel?.streamChunkMode, 'newline')
  assert.equal(channel?.toolProgress, false)
  assert.equal(channel?.inlineButtons, 'dm')
  assert.equal(channel?.widgets, true)
  assert.equal(channel?.markdownTableMode, 'block')
  assert.equal(channel?.responsePrefix, 'Automnia:')
  assert.equal(channel?.dmPolicy, 'allowlist')
  assert.equal(channel?.sendMessage, true)
  assert.equal(channel?.editMessage, true)
  assert.equal(channel?.poll, true)
  assert.equal(channel?.createForumTopic, true)
  assert.equal(channel?.editForumTopic, true)
  assert.equal(channel?.joinIntro, false)
  assert.equal(channel?.autoTopicLabel, false)
  assert.equal(channel?.networkAutoSelectFamily, 'off')
  assert.equal(channel?.networkDnsResultOrder, 'verbatim')
  assert.equal(channel?.silentErrorReplies, true)
  assert.equal(channel?.reactionLevel, 'extensive')
  assert.equal(messages?.ackReactionScope, 'direct')
})

test('Telegram setting commands update supported advanced paths and never include secrets', () => {
  const commands = telegramSettingCommands({ ...DEFAULT_TELEGRAM_SETTINGS, nativeCommands: 'on', poll: true })

  assert.equal(commands.length, 36)
  assert.ok(commands.includes('config set channels.telegram.commands.native true'))
  assert.ok(commands.includes('config set channels.telegram.actions.poll true'))
  assert.ok(commands.includes('config set channels.telegram.commands.nativeSkills "auto"'))
  assert.ok(commands.includes('config set channels.telegram.streaming.chunkMode "length"'))
  assert.ok(commands.includes('config set channels.telegram.network.autoSelectFamily true'))
  assert.ok(commands.includes('config set messages.ackReactionScope "group-mentions"'))
  assert.ok(commands.every((command) => !/token|secret|password|api[-_]?key/i.test(command)))
})

test('Telegram settings batch command emits one atomic config update for selected fields', () => {
  const entries = telegramSettingCommandEntries({ ...DEFAULT_TELEGRAM_SETTINGS, poll: true })
  const batch = telegramSettingBatchCommand({ ...DEFAULT_TELEGRAM_SETTINGS, poll: true }, ['poll', 'ackReactionScope'])

  assert.equal(entries.length, 36)
  assert.match(batch, /^config set --batch-json '/)
  assert.match(batch, /channels\.telegram\.actions\.poll/)
  assert.match(batch, /messages\.ackReactionScope/)
  assert.doesNotMatch(batch, /channels\.telegram\.dmPolicy/)
})

test('Telegram open DM policy always includes its required wildcard allowlist', () => {
  const settings = { ...DEFAULT_TELEGRAM_SETTINGS, dmPolicy: 'open' as const }
  const commands = telegramSettingCommands(settings)
  const batch = telegramSettingBatchCommand(settings, ['dmPolicy'])

  assert.ok(commands.includes('config set channels.telegram.allowFrom ["*"]'))
  assert.match(batch, /channels\.telegram\.allowFrom/)
  assert.match(batch, /\["\*"\]/)
})
