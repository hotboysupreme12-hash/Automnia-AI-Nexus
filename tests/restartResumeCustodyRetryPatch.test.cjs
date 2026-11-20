const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { ensureRestartResumeCustodyRetry, patchRestartResumeCustodyRetrySource } = require('../scripts/lib/restart-resume-custody-retry-patch.cjs')

const original = `/** Admit one ordinary input per marker without holding healthy agents behind preparation. */
async function resumeMarkedSessions(e) {
	const { context: t, signal: n, log: r } = e;
	const i = getAgentDatabaseStartupAdmission();
	const a = /* @__PURE__ */ new Set();
	const o = [];
	for (const s of listConfiguredSessionStoreAgentIds(t.getRuntimeConfig())) {
		const t = i?.waitForAgentPreparation(s, {
			forWrite: true,
			signal: n
		});
		if (!t || !i) {
			o.push(s);
			continue;
		}
		i.track(t.then(() => runWithGatewayIndependentRootWorkAdmission(() => resumeAgentSessions(e, [s], a), "startup:deferred-session-resume", n)).catch((e) => {
			if (!n.aborted) r.warn("Deferred restart resume failed for agent " + s + ": " + String(e));
		}));
	}
	await resumeAgentSessions(e, o, a);
}
async function resumeAgentSessions(e, t, n) {}`

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function loadPatchedResume(source, dependencies) {
  const patched = patchRestartResumeCustodyRetrySource(source)
  const start = patched.indexOf('// Automnia: retry restart resume after session database custody drift.')
  const end = patched.indexOf('\nasync function resumeAgentSessions(e, t, n) {', start)
  assert.ok(start >= 0 && end > start)
  const module = new Function(
    'getAgentDatabaseStartupAdmission',
    'listConfiguredSessionStoreAgentIds',
    'runWithGatewayIndependentRootWorkAdmission',
    'resumeAgentSessions',
    `${patched.slice(start, end)}; return resumeMarkedSessions`,
  )(
    dependencies.getAdmission,
    dependencies.listAgents,
    dependencies.runWithAdmission,
    dependencies.resumeAgentSessions,
  )
  return { module, patched }
}

test('deferred restart resume retries custody drift once after all configured agent database prep settles', async () => {
  const agentPrep = new Map([['hn-architect', deferred()], ['hn-coordinator', deferred()]])
  const tracked = []
  const calls = []
  const warnings = []
  let architectAttempts = 0
  const admission = {
    waitForAgentPreparation: (agentId) => agentPrep.get(agentId).promise,
    track: (promise) => tracked.push(promise),
  }
  const { module } = loadPatchedResume(original, {
    getAdmission: () => admission,
    listAgents: () => [...agentPrep.keys()],
    runWithAdmission: (run, _label) => run(),
    resumeAgentSessions: async (_event, agentIds) => {
      calls.push([...agentIds])
      if (agentIds[0] === 'hn-architect' && architectAttempts++ === 0) {
        throw new Error('Session store target data read failed', {
          cause: new Error('Session database target changed outside captured discovery custody: hn-coordinator/agent/openclaw-agent.sqlite'),
        })
      }
    },
  })

  await module({
    context: { getRuntimeConfig: () => ({}) },
    signal: { aborted: false },
    log: { warn: (message) => warnings.push(message) },
  })
  agentPrep.get('hn-architect').resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [['hn-architect']])
  assert.equal(warnings.length, 1)
  agentPrep.get('hn-coordinator').resolve()
  await Promise.all(tracked)

  assert.deepEqual(calls, [['hn-architect'], ['hn-coordinator'], ['hn-architect']])
  assert.match(warnings[0], /waiting for agent database preparation before one fresh retry/)
})

test('deferred restart resume does not retry failures unrelated to session database custody', async () => {
  const tracked = []
  const warnings = []
  let attempts = 0
  const { module } = loadPatchedResume(original, {
    getAdmission: () => ({
      waitForAgentPreparation: async () => undefined,
      track: (promise) => tracked.push(promise),
    }),
    listAgents: () => ['agent-a'],
    runWithAdmission: (run, _label) => run(),
    resumeAgentSessions: async () => {
      attempts += 1
      throw new Error('provider startup failed')
    },
  })

  await module({
    context: { getRuntimeConfig: () => ({}) },
    signal: { aborted: false },
    log: { warn: (message) => warnings.push(message) },
  })
  await Promise.all(tracked)
  assert.equal(attempts, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /provider startup failed/)
})

test('runtime preparation applies the retry patch idempotently to the pinned restart-resume bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-restart-resume-patch-'))
  try {
    const dist = path.join(root, 'dist')
    fs.mkdirSync(dist, { recursive: true })
    const file = path.join(dist, 'session-restart-resume-test.mjs')
    fs.writeFileSync(file, original)
    ensureRestartResumeCustodyRetry(root)
    const patched = fs.readFileSync(file, 'utf8')
    assert.match(patched, /retry restart resume after session database custody drift/)
    ensureRestartResumeCustodyRetry(root)
    assert.equal(fs.readFileSync(file, 'utf8'), patched)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('unknown OpenClaw restart-resume source shape fails closed', () => {
  assert.throws(() => patchRestartResumeCustodyRetrySource('async function resumeMarkedSessions() {}'), /entry point changed/)
})
