const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const source = fs.readFileSync(require('node:path').join(__dirname, '../server/controlPlane.ts'), 'utf8')
function load(name, context = {}) {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf('\n}\n', start) + 2
  return vm.runInNewContext(ts.transpile(source.slice(start, end)) + `\n${name}`, context)
}
test('projection removes retired per-agent limits on repeated saves without losing supported limits', () => {
  const project = load('projectConfigForOpenClaw2026_9_2', {
    resolvedOpenClawRuntimeInfo: () => ({ version: '2026.9.2' }),
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
    resolvedOpenClawRuntimeInfo: () => ({ version: '2026.9.2' }),
    isLooseRecord: x => x !== null && typeof x === 'object' && !Array.isArray(x),
  }
  const hydrate = load('hydrateOpenClawAgentEntries', context)
  const project = load('projectConfigForOpenClaw2026_9_2', context)
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
