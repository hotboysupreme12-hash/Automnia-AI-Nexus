import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ScriptTarget, transpileModule } from 'typescript'
import {
  TELEGRAM_AGENT_ROUTING_HELPER,
  TELEGRAM_PROGRESS_STATUS_HELPER,
  dedupeTelegramProgressHooks,
} from '../server/integrations/agentRoutingHelpers'

const workspace = process.cwd()
const controlPlane = fs.readFileSync(path.join(workspace, 'server', 'controlPlane.ts'), 'utf8')
const distRoot = path.join(workspace, 'vendor', 'openclaw', 'dist')
const bundleText = (pattern: RegExp) => {
  const name = fs.readdirSync(distRoot).find((entry) => pattern.test(entry))
  assert.ok(name, `missing OpenClaw bundle matching ${pattern}`)
  return fs.readFileSync(path.join(distRoot, name), 'utf8')
}
const telegramTransformStart = controlPlane.indexOf('function patchedTelegramBotRuntimeSource(source: string) {')
const telegramTransformEnd = controlPlane.indexOf('\nfunction openClawPackageRootCandidates()', telegramTransformStart)
assert.ok(telegramTransformStart >= 0 && telegramTransformEnd > telegramTransformStart, 'Control Center should expose a bounded Telegram runtime patch transformer')
const telegramTransformSource = transpileModule(
  controlPlane.slice(telegramTransformStart, telegramTransformEnd),
  { compilerOptions: { target: ScriptTarget.ES2022 } },
).outputText
const patchTelegramBundle = new Function(
  'TELEGRAM_AGENT_ROUTING_HELPER',
  'TELEGRAM_PROGRESS_STATUS_HELPER',
  'dedupeTelegramProgressHooks',
  `${telegramTransformSource}\nreturn patchedTelegramBotRuntimeSource;`,
)(TELEGRAM_AGENT_ROUTING_HELPER, TELEGRAM_PROGRESS_STATUS_HELPER, dedupeTelegramProgressHooks) as (source: string) => string
const botMessageBundle = patchTelegramBundle(bundleText(/^bot-message-[^/]+\.js$/))
const telegramIngressBundle = bundleText(/^telegram-ingress-[^/]+\.js$/)

test('Telegram runtime repair targets OpenClaw split message and ingress bundles', () => {
  assert.match(controlPlane, /startsWith\('bot-message-'\)/)
  assert.match(controlPlane, /hasMessageRoutingShape/)
  assert.match(controlPlane, /hasNativeCommandShape/)
  assert.match(controlPlane, /TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 19/)
  assert.match(controlPlane, /TELEGRAM_PROGRESS_STATUS_HELPER/)
  assert.match(controlPlane, /turn\.dispatchAdmission = turnResult\.admission/)
  assert.match(controlPlane, /const duplicate = \/duplicate\|already\[-_ \]\?handled\/i/)
  assert.match(controlPlane, /if \(!next\.includes\('turn\.telegramProgressStatus\?\.toolStart\(toolName\);'\)\)/)
  assert.match(controlPlane, /dedupeTelegramProgressHooks\(next\)/)
  assert.match(controlPlane, /turn\.telegramProgressStatus\?\.start\(\);/)
})

test('the bundled OpenClaw shape exposes the routing and native-command insertion contracts', () => {
  assert.match(botMessageBundle, /const buildTelegramMessageContext = async/)
  assert.match(botMessageBundle, /function resolveTelegramInboundBody/)
  assert.match(botMessageBundle, /const hasFinalResponse = turn\.finalAnswerDelivered/)
  assert.doesNotMatch(botMessageBundle, /No response was generated for this Telegram message\./)
  assert.match(botMessageBundle, /telegramNoResponseTerminal/)
  assert.match(botMessageBundle, /deferredToActiveRun/)
  assert.match(botMessageBundle, /createAutomniaTelegramProgressStatus/)
  assert.match(telegramIngressBundle, /const registerTelegramNativeCommands =/)
  assert.match(telegramIngressBundle, /const nativeCommandsToHandle =/)
  assert.match(telegramIngressBundle, /for \(const pluginCommand of pluginCatalog\.selectedCommands\)/)
})

test('Telegram status helper serializes safe phase updates and leaves a final status message', async () => {
  const updates: string[] = []
  let stopped = false
  const fakeStream = {
    updatePreview(preview: { text: string }) {
      updates.push(preview.text)
    },
    async flush() {},
    async stop() {
      stopped = true
    },
  }
  const createTelegramDraftStream = () => fakeStream
  const createStatus = new Function(
    'createTelegramDraftStream',
    `${TELEGRAM_PROGRESS_STATUS_HELPER}\nreturn createAutomniaTelegramProgressStatus;`,
  )(createTelegramDraftStream) as (params: Record<string, unknown>) => {
    start(): Promise<unknown>
    toolStart(name: string): Promise<unknown>
    finalize(outcome: string, message: string): Promise<unknown>
  }
  const status = createStatus({
    bot: { api: {} },
    context: {
      chatId: 'chat',
      threadSpec: {},
      ctxPayload: { MessageSid: 17 },
      route: { agentId: 'agent' },
    },
    agentName: 'Research agent',
    runtime: {},
  })
  assert.ok(status)
  await status.start()
  await status.toolStart('exec')
  await status.finalize('done', 'Final answer delivered below.')
  assert.equal(stopped, true)
  assert.match(updates.at(-1) || '', /Automnia status: Completed/)
  const finalStatus = updates.at(-1) || ''
  assert.match(finalStatus, /Current action: Final answer delivered below\./)
  assert.ok(finalStatus.includes('\nAgent: Research agent'))
  assert.ok(finalStatus.includes('\nElapsed: '))
  assert.equal(finalStatus.includes('\\nAgent:'), false)
  assert.equal(updates.some((value) => /secret|token|password|authorization/i.test(value)), false)
})

test('Telegram backslash, mention, and bot-suffixed agent switches resolve to the configured agent', () => {
  const resolveIntent = new Function(
    `${TELEGRAM_AGENT_ROUTING_HELPER}\nreturn resolveTelegramAgentRouteIntent;`,
  )() as (prompt: string, config: Record<string, unknown>, fallbackAgentId: string) => {
    kind: string
    parsed?: { mode: string; agentId: string; prompt: string }
  }
  const config = {
    agents: {
      list: [
        { id: 'hn-architect', name: 'HN Architect' },
        { id: 'hn-crypto-lead', name: 'HN Crypto Lead' },
      ],
    },
  }
  for (const prompt of ['\\architect inspect the route', '@architect inspect the route', '/architect@AutomniaBot inspect the route']) {
    const intent = resolveIntent(prompt, config, 'main')
    assert.equal(intent.kind, 'route', prompt)
    assert.equal(intent.parsed?.agentId, 'hn-architect', prompt)
    assert.equal(intent.parsed?.prompt, 'inspect the route', prompt)
  }
})

test('a stalled Telegram status API cannot hold the agent dispatch or finalization open', async () => {
  const createTelegramDraftStream = () => ({
    updatePreview() {},
    flush: () => new Promise<void>(() => {}),
    async stop() {},
  })
  const createStatus = new Function(
    'createTelegramDraftStream',
    `${TELEGRAM_PROGRESS_STATUS_HELPER}\nreturn createAutomniaTelegramProgressStatus;`,
  )(createTelegramDraftStream) as (params: Record<string, unknown>) => {
    start(): Promise<boolean>
    finalize(outcome: string, message: string): Promise<boolean>
  }
  const status = createStatus({
    bot: { api: {} },
    context: { chatId: 'chat', threadSpec: {}, ctxPayload: {}, route: { agentId: 'architect' } },
    runtime: {},
    statusOperationTimeoutMs: 10,
  })
  assert.ok(status)
  const startTime = Date.now()
  assert.equal(await status.start(), false)
  assert.equal(await status.finalize('done', 'Finished.'), false)
  assert.ok(Date.now() - startTime < 250)
})

test('Telegram runtime repair collapses duplicate hooks left by earlier restarts', () => {
  const toolHook = 'turn.telegramProgressStatus?.toolStart(toolName);'
  const deferredHook = [
    'turn.deferredToActiveRun = turnResult.dispatchResult.deferredToActiveRun;',
    'if (turn.deferredToActiveRun) turn.telegramProgressStatus?.queued("Waiting behind an active Telegram turn. The active run owns the final reply.");',
  ].join('\n\t\t')
  const source = [
    `\t${toolHook}\n\t${toolHook}`,
    `\t\t${deferredHook}\n\t\t${deferredHook}`,
  ].join('\n')
  const repaired = dedupeTelegramProgressHooks(source)
  assert.equal(repaired.split(toolHook).length - 1, 1)
  assert.equal(repaired.split('turn.deferredToActiveRun = turnResult.dispatchResult.deferredToActiveRun;').length - 1, 1)
  assert.equal(dedupeTelegramProgressHooks(repaired), repaired)
})
