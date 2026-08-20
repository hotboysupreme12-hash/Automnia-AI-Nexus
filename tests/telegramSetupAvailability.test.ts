import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Telegram remains configurable after an older credential is already saved', () => {
  const source = readFileSync('src/components/plugins/PluginsPanel.tsx', 'utf8')

  assert.match(source, /canConfigureTelegram = plugin\.id === 'telegram'/)
  assert.match(source, /showSetupAction = !installable && \(plugin\.needsSetup \|\| canConfigureTelegram\)/)
  assert.match(source, /\{canConfigureTelegram \? 'Configure' : 'Setup'\}/)
})
