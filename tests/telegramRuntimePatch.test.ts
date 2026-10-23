import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workspace = process.cwd()
const controlPlane = fs.readFileSync(path.join(workspace, 'server', 'controlPlane.ts'), 'utf8')
const distRoot = path.join(workspace, 'vendor', 'openclaw', 'dist')
const bundleText = (pattern: RegExp) => {
  const name = fs.readdirSync(distRoot).find((entry) => pattern.test(entry))
  assert.ok(name, `missing OpenClaw bundle matching ${pattern}`)
  return fs.readFileSync(path.join(distRoot, name), 'utf8')
}
const botMessageBundle = bundleText(/^bot-message-[^/]+\.js$/)
const telegramIngressBundle = bundleText(/^telegram-ingress-[^/]+\.js$/)

test('Telegram runtime repair targets OpenClaw split message and ingress bundles', () => {
  assert.match(controlPlane, /startsWith\('bot-message-'\)/)
  assert.match(controlPlane, /hasMessageRoutingShape/)
  assert.match(controlPlane, /hasNativeCommandShape/)
  assert.match(controlPlane, /TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 17/)
})

test('the bundled OpenClaw shape exposes the routing and native-command insertion contracts', () => {
  assert.match(botMessageBundle, /const buildTelegramMessageContext = async/)
  assert.match(botMessageBundle, /function resolveTelegramInboundBody/)
  assert.match(botMessageBundle, /const hasFinalResponse = turn\.finalAnswerDelivered/)
  assert.match(telegramIngressBundle, /const registerTelegramNativeCommands =/)
  assert.match(telegramIngressBundle, /const nativeCommandsToHandle =/)
  assert.match(telegramIngressBundle, /for \(const pluginCommand of pluginCatalog\.selectedCommands\)/)
})
