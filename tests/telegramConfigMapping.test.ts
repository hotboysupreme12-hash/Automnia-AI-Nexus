import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTelegramPluginConfigValues,
  hasTelegramChannelCredential,
} from '../server/services/plugins/telegramConfigMapping'

test('Telegram bot credentials are written to the channel config, not only the plugin entry', () => {
  const config: Record<string, unknown> = {
    plugins: { entries: { telegram: { enabled: true, config: { botToken: 'stale-token' } } } },
  }

  const mapped = applyTelegramPluginConfigValues(config, [['botToken', 'replacement-token']])
  const channels = config.channels as Record<string, unknown>
  const telegram = channels.telegram as Record<string, unknown>

  assert.deepEqual(mapped.pluginValues, [])
  assert.deepEqual(mapped.channelValues, [['botToken', 'replacement-token']])
  assert.equal(telegram.botToken, 'replacement-token')
  assert.equal(telegram.enabled, true)
})

test('non-credential plugin settings remain in the generic plugin config path', () => {
  const config: Record<string, unknown> = {}
  const mapped = applyTelegramPluginConfigValues(config, [
    ['botToken', 'replacement-token'],
    ['customSetting', 'value'],
  ])

  assert.deepEqual(mapped.pluginValues, [['customSetting', 'value']])
  assert.deepEqual(mapped.channelValues, [['botToken', 'replacement-token']])
  assert.equal((config.channels as Record<string, unknown>).telegram !== undefined, true)
})

test('Telegram setup status recognizes a channel credential without exposing its value', () => {
  assert.equal(hasTelegramChannelCredential({ botToken: 'replacement-token' }), true)
  assert.equal(hasTelegramChannelCredential({ tokenFile: 'C:/secrets/telegram.token' }), true)
  assert.equal(hasTelegramChannelCredential({ botToken: '   ' }), false)
  assert.equal(hasTelegramChannelCredential(null), false)
})
