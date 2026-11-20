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
const rawBotMessageBundle = fs.readdirSync(distRoot)
  .filter((entry) => /^bot-message-[^.]+\.mjs$/.test(entry))
  .map((entry) => fs.readFileSync(path.join(distRoot, entry), 'utf8'))
  .find((source) => source.includes('const buildTelegramMessageContext = async') && source.includes('function resolveTelegramInboundBody')) || ''
const telegramCommandBundle = fs.readdirSync(distRoot)
  .filter((entry) => entry.endsWith('.mjs'))
  .map((entry) => fs.readFileSync(path.join(distRoot, entry), 'utf8'))
  .find((source) => source.includes('const registerTelegramNativeCommands =') && source.includes('buildPluginTelegramMenuCommands')) || ''
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
function patchBundleWithWarnings(source: string) {
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    return { source: patchTelegramBundle(source), warnings }
  } finally {
    console.warn = originalWarn
  }
}
const botMessagePatch = patchBundleWithWarnings(rawBotMessageBundle.replace(
  /\n\t\tconst telegramModelSelected = typeof onModelSelected === "function" \? \(\.\.\.args\) => \{[\s\S]*?\n\t\t\} : onModelSelected;/,
  '',
))
const botMessageBundle = botMessagePatch.source
const telegramCommandPatch = patchBundleWithWarnings(telegramCommandBundle)
const patchedTelegramCommandBundle = telegramCommandPatch.source

test('Telegram runtime repair targets OpenClaw split message and ingress bundles', () => {
  assert.match(controlPlane, /startsWith\('bot-message-'\)/)
  assert.match(controlPlane, /hasMessageRoutingShape/)
  assert.match(controlPlane, /hasNativeCommandShape/)
  assert.match(controlPlane, /TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 21/)
  assert.match(controlPlane, /TELEGRAM_PROGRESS_STATUS_HELPER/)
  assert.match(controlPlane, /bot-message-dispatch-turn\.ts/)
  assert.match(controlPlane, /resolveTelegramInboundBody/)
  assert.match(controlPlane, /selectedPluginCommandLoopPattern/)
  assert.match(controlPlane, /turn\.dispatchAdmission = turnResult\.admission/)
  assert.match(controlPlane, /const duplicate = \/duplicate\|already\[-_ \]\?handled\/i/)
  assert.match(controlPlane, /if \(!next\.includes\('turn\.telegramProgressStatus\?\.toolStart\(toolName\);'\)\)/)
  assert.match(controlPlane, /dedupeTelegramProgressHooks\(next\)/)
  assert.match(controlPlane, /turn\.telegramProgressStatus\?\.start\(\);/)
})

test('the bundled OpenClaw shape exposes the routing and native-command insertion contracts', () => {
  assert.ok(rawBotMessageBundle.length > 0, 'OpenClaw 2026.11.x should expose a Telegram message-context bundle')
  assert.ok(telegramCommandBundle.length > 0, 'OpenClaw 2026.11.x should expose a Telegram native-command bundle')
  assert.match(botMessageBundle, /const buildTelegramMessageContext = async/)
  assert.match(botMessageBundle, /function resolveTelegramInboundBody/)
  assert.match(botMessageBundle, /previewLifecycle\.finalDelivered/)
  assert.doesNotMatch(botMessageBundle, /No response was generated for this Telegram message\./)
  assert.match(botMessageBundle, /const telegramModelSelected = typeof [\w$]+ === "function"/)
  assert.ok(botMessageBundle.indexOf('const telegramModelSelected =') < botMessageBundle.indexOf('telegramModelSelected\n'))
  assert.match(botMessageBundle, /beforeDeliver: async \(payload, info\) => applyTelegramVerifiedIdentityDeliveryGuard/)
  assert.match(botMessageBundle, /config: [\w$]+\.cfg,[\s\S]*?agentId: [\w$]+\.route\.agentId,[\s\S]*?prompt: [\w$]+\.ctxPayload\.RawBody/)
  assert.match(botMessageBundle, /createAutomniaTelegramProgressStatus/)
  assert.match(botMessageBundle, /telegramProgressStatus\?\.start\(\)/)
  assert.match(botMessageBundle, /telegramProgressStatus\?\.toolStart\(/)
  assert.match(botMessageBundle, /telegramProgressStatus\?\.finalize\(telegramStatusOutcome/)
  assert.match(botMessageBundle, /resolveTelegramAgentRouteForMessage\(\{/)
  assert.match(botMessageBundle, /withTelegramAgentRouteContext\(\{/)
  const earlyRouteIndex = botMessageBundle.indexOf('const automniaTelegramAgentRoute = resolveTelegramAgentRouteForMessage({')
  const targetSessionIndex = botMessageBundle.indexOf('applyTelegramTargetSession({', earlyRouteIndex)
  assert.ok(earlyRouteIndex >= 0 && targetSessionIndex > earlyRouteIndex, 'agent route selection should precede target session resolution')
  assert.match(botMessageBundle, /\.rawBody = automniaTelegramAgentRoute\.rawBody/)
  assert.match(botMessageBundle, /\.bodyText = withTelegramAgentRouteContext\(\{ config:/)
  assert.match(patchedTelegramCommandBundle, /if \(n && ![\w$]+\.some\(\(command\) => normalizeTelegramCommandName\(command\.name\) === "agents"\)\) [\w$]+\.command\("agents", runAutomniaTelegramAgentsCommand\)/)
  assert.doesNotMatch([...botMessagePatch.warnings, ...telegramCommandPatch.warnings].join('\n'), /\[plugins\/telegram\].*patch skipped/)
  assert.match(telegramCommandBundle, /const registerTelegramNativeCommands =/)
  assert.match(telegramCommandBundle, /buildPluginTelegramMenuCommands/)
  assert.match(telegramCommandBundle, /for \(const \w+ of \w+\.selectedCommands\) \w+\.command\(/)
  assert.match(patchedTelegramCommandBundle, /AUTOMNIA_TELEGRAM_AGENTS_COMMAND_PATCH/)
  assert.match(patchedTelegramCommandBundle, /resolveTelegramAgentsCommandResponse\(\{/)
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

test('Telegram dispatch does not wait for a status preview, including previously patched bundles', () => {
  const oldBundle = `${botMessageBundle}\nawait turn.telegramProgressStatus?.start();`
  const patched = patchTelegramBundle(oldBundle)
  assert.match(patched, /turn\.telegramProgressStatus\?\.start\(\);/)
  assert.doesNotMatch(patched, /await turn\.telegramProgressStatus\?\.start\(\);/)
  assert.doesNotMatch(patchTelegramBundle(patched), /await turn\.telegramProgressStatus\?\.start\(\);/)
})

test('repeated runtime repair does not duplicate the inbound agent routing context', () => {
  const twice = patchTelegramBundle(botMessageBundle)
  const countRouteContexts = (source: string) => (source.match(/\.bodyText = withTelegramAgentRouteContext\(\{ config:/g) || []).length
  assert.equal(countRouteContexts(botMessageBundle), 1)
  assert.equal(countRouteContexts(twice), 1)
  const block = /if \(automniaTelegramAgentRoute\.changed\) \{\n\t[\w$]+\.rawBody = automniaTelegramAgentRoute\.rawBody;\n\t[\w$]+\.bodyText = automniaTelegramAgentRoute\.bodyText;\n\t\}\n\t[\w$]+\.bodyText = withTelegramAgentRouteContext\(\{ config: [^\n]+/.exec(botMessageBundle)?.[0]
  assert.ok(block)
  const duplicated = botMessageBundle.replace(block, `${block}\n\t${block}`)
  assert.equal(countRouteContexts(duplicated), 2)
  assert.equal(countRouteContexts(patchTelegramBundle(duplicated)), 1)
})

test('repaired status messages do not imply that replaying completed tool work is safe', () => {
  const oldBundle = `${botMessageBundle}\n"The Telegram turn ended without a final answer; retrying is safe."`
  const patched = patchTelegramBundle(oldBundle)
  assert.doesNotMatch(patched, /retrying is safe/)
  assert.match(patched, /Check completed work before retrying/)
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
