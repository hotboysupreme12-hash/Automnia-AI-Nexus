import assert from 'node:assert/strict'
import test from 'node:test'
import { repairInvalidTelegramDmPolicy } from '../server/services/plugins/telegramPolicy'

test('invalid open Telegram DM policy repairs to pairing', () => {
  const config: Record<string, unknown> = { channels: { telegram: { dmPolicy: 'open' } } }

  assert.equal(repairInvalidTelegramDmPolicy(config), true)
  assert.equal((config.channels as Record<string, unknown>).telegram && ((config.channels as Record<string, unknown>).telegram as Record<string, unknown>).dmPolicy, 'pairing')
})

test('open Telegram DM policy remains open only with an explicit wildcard allowlist', () => {
  const config: Record<string, unknown> = {
    channels: { telegram: { dmPolicy: 'open', allowFrom: ['*'] } },
  }

  assert.equal(repairInvalidTelegramDmPolicy(config), false)
  assert.equal(((config.channels as Record<string, unknown>).telegram as Record<string, unknown>).dmPolicy, 'open')
})

test('pairing and non-Telegram configurations are left unchanged', () => {
  const pairing: Record<string, unknown> = { channels: { telegram: { dmPolicy: 'pairing' } } }
  const other: Record<string, unknown> = { channels: { discord: { dmPolicy: 'open' } } }

  assert.equal(repairInvalidTelegramDmPolicy(pairing), false)
  assert.equal(repairInvalidTelegramDmPolicy(other), false)
})
