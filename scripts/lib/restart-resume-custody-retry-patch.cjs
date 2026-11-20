const fs = require('node:fs')
const path = require('node:path')

const marker = 'Automnia: retry restart resume after session database custody drift'
const start = '/** Admit one ordinary input per marker without holding healthy agents behind preparation. */\nasync function resumeMarkedSessions(e) {'
const end = '\nasync function resumeAgentSessions(e, t, n) {'

function patchRestartResumeCustodyRetrySource(source) {
  if (source.includes(marker)) return source

  const startIndex = source.indexOf(start)
  if (startIndex < 0) throw new Error('OpenClaw deferred restart-resume entry point changed; cannot apply custody retry')
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (endIndex < 0) throw new Error('OpenClaw deferred restart-resume boundary changed; cannot apply custody retry')

  const patched = `${String.raw`// ${marker}.
function isRestartResumeSessionStoreCustodyMismatch(error) {
	const pending = [error];
	const seen = new Set();
	while (pending.length > 0) {
		const value = pending.pop();
		if (typeof value === "string") {
			if (value.includes("Session database target changed outside captured discovery custody")) return true;
			continue;
		}
		if (!value || typeof value !== "object" || seen.has(value)) continue;
		seen.add(value);
		pending.push(value.message, value.cause, value.readError, value.error);
	}
	return false;
}
async function resumeMarkedSessions(e) {
	const { context: t, signal: n, log: r } = e;
	const i = getAgentDatabaseStartupAdmission();
	const a = /* @__PURE__ */ new Set();
	const s = listConfiguredSessionStoreAgentIds(t.getRuntimeConfig());
	const o = /* @__PURE__ */ new Map();
	if (i) for (const agentId of s) o.set(agentId, i.waitForAgentPreparation(agentId, {
		forWrite: true,
		signal: n
	}));
	const waitForAllAgentPreparations = async () => {
		if (!i) return;
		await Promise.allSettled([...o.values()].filter(Boolean));
	};
	const resumeWithCustodyRetry = async (agentIds) => {
		if (agentIds.length === 0) return;
		try {
			await resumeAgentSessions(e, agentIds, a);
		} catch (error) {
			if (!isRestartResumeSessionStoreCustodyMismatch(error)) throw error;
			r.warn("Restart resume for " + agentIds.join(", ") + " found a session database custody change; waiting for agent database preparation before one fresh retry.");
			await waitForAllAgentPreparations();
			await resumeAgentSessions(e, agentIds, a);
		}
	};
	const withoutAdmission = [];
	for (const agentId of s) {
		const preparation = o.get(agentId);
		if (!preparation || !i) {
			withoutAdmission.push(agentId);
			continue;
		}
		i.track(preparation.then(() => runWithGatewayIndependentRootWorkAdmission(() => resumeWithCustodyRetry([agentId]), "startup:deferred-session-resume", n)).catch((error) => {
			if (!n.aborted) r.warn("Deferred restart resume failed for agent " + agentId + ": " + String(error));
		}));
	}
	await resumeWithCustodyRetry(withoutAdmission);
}`}${source.slice(endIndex)}`

  return source.slice(0, startIndex) + patched
}

function ensureRestartResumeCustodyRetry(vendorRoot) {
  const dist = path.join(vendorRoot, 'dist')
  const candidates = fs.readdirSync(dist).filter((name) => /^session-restart-resume-.*\.mjs$/.test(name))
  const matches = candidates.map((name) => ({ file: path.join(dist, name), source: fs.readFileSync(path.join(dist, name), 'utf8') }))
    .filter(({ source }) => source.includes('async function resumeMarkedSessions(e) {'))
  if (matches.length !== 1) throw new Error(`Expected one OpenClaw deferred restart-resume implementation; found ${matches.length}`)
  const { file, source } = matches[0]
  const patched = patchRestartResumeCustodyRetrySource(source)
  if (patched !== source) fs.writeFileSync(file, patched)
}

module.exports = { ensureRestartResumeCustodyRetry, patchRestartResumeCustodyRetrySource }
