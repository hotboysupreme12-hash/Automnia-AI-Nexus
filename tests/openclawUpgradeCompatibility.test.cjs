const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const source = fs.readFileSync(require('node:path').join(__dirname, '../server/controlPlane.ts'), 'utf8')
function load(name, context = {}) {
  const start = source.indexOf(`function ${name}(`)
  const closing = /\r?\n}\r?\n/.exec(source.slice(start))
  if (start < 0 || !closing) throw new Error(`Unable to extract ${name} from controlPlane.ts`)
  const end = start + closing.index + closing[0].indexOf('}') + 1
  return vm.runInNewContext(ts.transpile(source.slice(start, end)) + `\n${name}`, context)
}
test('projection removes retired per-agent limits on repeated saves without losing supported limits', () => {
  const project = load('projectConfigForOpenClaw2026_10_6', {
    RECOMMENDED_OPENCLAW_VERSION: '2026.10.6',
    resolvedOpenClawRuntimeInfo: () => ({ version: '2026.10.6' }),
    isLooseRecord: x => x !== null && typeof x === 'object' && !Array.isArray(x),
  })
  const config = { agents: { entries: { existing: { contextLimits: { memoryGetDefaultLines: 20, toolResultMaxChars: 1000, memoryGetMaxChars: 500 } } }, list: [{ id: 'new', contextLimits: { toolResultMaxChars: 1000, postCompactionMaxChars: 800 } }] } }
  project(config)
  config.agents.ownership = 'explicit'
  config.agents.entries.new.default = true
  project(config)
  assert.equal(config.agents.entries.new.default, undefined)
  assert.equal(config.agents.entries.existing.contextLimits.memoryGetMaxChars, 500)
  assert.equal(config.agents.entries.new.contextLimits.postCompactionMaxChars, 800)
  assert.equal(config.agents.entries.existing.contextLimits.memoryGetDefaultLines, undefined)
  assert.equal(config.agents.entries.new.contextLimits.toolResultMaxChars, undefined)
})
test('canonical agents hydrate for billing sync and round-trip selected tiers and deletions', () => {
  const context = {
    RECOMMENDED_OPENCLAW_VERSION: '2026.10.6',
    resolvedOpenClawRuntimeInfo: () => ({ version: '2026.10.6' }),
    isLooseRecord: x => x !== null && typeof x === 'object' && !Array.isArray(x),
  }
  const hydrate = load('hydrateOpenClawAgentEntries', context)
  const project = load('projectConfigForOpenClaw2026_10_6', context)
  const config = { agents: { entries: { architect: { model: { primary: 'automnia-cloud/gemini-3.8-flash' } }, removed: {} } } }
  hydrate(config)
  assert.equal(config.agents.list[0].id, 'architect')
  assert.equal(config.agents.list[0].model.primary, 'automnia-cloud/gemini-3.8-flash')
  config.agents.list = config.agents.list.filter(agent => agent.id !== 'removed')
  project(config)
  assert.equal(config.agents.entries.architect.model.primary, 'automnia-cloud/gemini-3.8-flash')
  assert.equal(config.agents.entries.removed, undefined)
  hydrate(config)
  hydrate(config)
  assert.equal(config.agents.list.length, 1)
})
test('Telegram 10.6 bundle patch handles authorized /agents and resilient delivery hook markers', () => {
  const warnings = []
  const patchTelegram = load('patchedTelegramBotRuntimeSource', {
    TELEGRAM_AGENT_ROUTING_HELPER: 'var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 20;\n//#endregion telegram-agent-routing-patch',
    TELEGRAM_PROGRESS_STATUS_HELPER: 'var AUTOMNIA_TELEGRAM_PROGRESS_STATUS_PATCH = 1;',
    dedupeTelegramProgressHooks: value => value,
    console: { warn: value => warnings.push(value) },
  })
  const source = [
    '//#region extensions/telegram/src/bot-message-context.body.ts',
    'const buildTelegramMessageContext = async () => {',
    'function resolveTelegramInboundBody() {}',
    '//#region extensions/telegram/src/bot-message-dispatch-status.ts',
    'if (!bodyResult) return null;',
    'const telegramAgentRoute = resolveTelegramAgentRouteForMessage({',
    'dispatcherOptions: {',
    '\t\t\t\t\t\tbeforeDeliver: async (payload) => payload,',
    '\t\t\t\t\t\tonBeforeDeliverCancelled: (payload, info) => {',
    '}',
  ].join('\n')

  const patched = patchTelegram(source)
  assert.match(patched, /bodyResult\.commandAuthorized && telegramAgentsCommandMatch/)
  assert.match(patched, /beforeDeliver: async \(payload, info\) => applyTelegramVerifiedIdentityDeliveryGuard/)
  assert.doesNotMatch(warnings.join('\n'), /agents command patch skipped|identity delivery guard skipped|credits-only model .* skipped/)
})
test('Telegram 10.6 patch declares the model-selection callback before dispatch uses it', () => {
  const patchTelegram = load('patchedTelegramBotRuntimeSource', {
    TELEGRAM_AGENT_ROUTING_HELPER: 'var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 20;\n//#endregion telegram-agent-routing-patch',
    TELEGRAM_PROGRESS_STATUS_HELPER: 'var AUTOMNIA_TELEGRAM_PROGRESS_STATUS_PATCH = 1;',
    dedupeTelegramProgressHooks: value => value,
    console: { warn() {} },
  })
  const source = [
    'const { onModelSelected, ...replyPipeline } = (turn.telegramDeps.createChannelMessageReplyPipeline ?? createChannelReplyPipeline)({',
    '\t\t});',
    '\t\tconst turnResult = await runChannelInboundEvent({',
    '\t\t\t\t\t\ttelegramModelSelected',
    'const telegramAgentRoute = resolveTelegramAgentRouteForMessage({',
  ].join('\n')
  const patched = patchTelegram(source)
  const declaration = patched.indexOf('const telegramModelSelected = typeof onModelSelected === "function"')
  const callbackUse = patched.indexOf('telegramModelSelected', declaration + 1)
  assert.ok(declaration >= 0, 'model-selection wrapper declaration is present')
  assert.ok(callbackUse > declaration, 'model-selection wrapper is declared before dispatch use')
  assert.match(patched, /return onModelSelected\(\.\.\.args\);/)
})
test('Telegram runtime repair produces a declaration in the actual bundled dispatch shape', () => {
  const patchTelegram = load('patchedTelegramBotRuntimeSource', {
    TELEGRAM_AGENT_ROUTING_HELPER: 'var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 20;\n//#endregion telegram-agent-routing-patch',
    TELEGRAM_PROGRESS_STATUS_HELPER: 'var AUTOMNIA_TELEGRAM_PROGRESS_STATUS_PATCH = 1;',
    dedupeTelegramProgressHooks: value => value,
    console: { warn() {} },
  })
  const dist = require('node:path').join(__dirname, '../vendor/openclaw/dist')
  const bundle = fs.readdirSync(dist).find(name => /^bot-message-[^/]+\.mjs$/.test(name))
  assert.ok(bundle, 'Telegram message bundle exists')
  const patched = patchTelegram(fs.readFileSync(require('node:path').join(dist, bundle), 'utf8'))
  const declaration = patched.indexOf('const telegramModelSelected = typeof onModelSelected === "function"')
  const dispatch = patched.indexOf('\n\t\tconst turnResult = await runChannelInboundEvent({', declaration)
  const callbackUse = patched.indexOf('telegramModelSelected', dispatch)
  assert.ok(declaration >= 0, 'actual bundle receives the callback declaration')
  assert.ok(dispatch > declaration, 'declaration is inside the dispatch function before the turn begins')
  assert.ok(callbackUse > dispatch, 'dispatch callback use follows its declaration')
})
test('cron projection reads runtime state from schema-15 JSON and supports legacy columns', () => {
  const project = load('cronJobsCompatibleSource')
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE cron_jobs(job_json TEXT, state_json TEXT)')
    db.prepare('INSERT INTO cron_jobs VALUES (?, ?)').run(JSON.stringify({ schedule: { kind: 'every', everyMs: 30000 }, payload: { model: 'test' } }), JSON.stringify({ runningAtMs: 123, nextRunAtMs: 456 }))
    const row = db.prepare(`SELECT running_at_ms, next_run_at_ms, every_ms, payload_model FROM ${project(db)}`).get()
    assert.equal(row.running_at_ms, 123)
    assert.equal(row.next_run_at_ms, 456)
    assert.equal(row.every_ms, 30000)
    assert.equal(row.payload_model, 'test')
    db.exec('ALTER TABLE cron_jobs ADD COLUMN running_at_ms INTEGER; UPDATE cron_jobs SET running_at_ms=789')
    assert.equal(db.prepare(`SELECT running_at_ms FROM ${project(db)}`).get().running_at_ms, 789)
  } finally { db.close() }
})
