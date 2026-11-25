const fs = require('node:fs')
const path = require('node:path')

const marker = 'Automnia: retry restart resume after session database custody drift v3'
const legacyMarker = 'Automnia: retry restart resume after session database custody drift'
const start = '/** Admit one ordinary input per marker without holding healthy agents behind preparation. */\nasync function resumeMarkedSessions(e) {'
const end = '\nasync function resumeAgentSessions(e, t, n) {'

function patchAgentDatabaseStartupPreparationBarrier(source) {
  const marker = 'Automnia: wait for complete agent database preparation before Gateway writes and restart resume v3'
  const previousMarkers = [
    'Automnia: wait for complete agent database preparation before Gateway writes and restart resume v2',
    'Automnia: wait for complete agent database preparation before restart resume',
  ]
  if (source.includes(marker)) return source

  const waitMethod = `\tasync waitForAgentPreparations(e) {
		const n = e === void 0 ? void 0 : normalizeAgentId(e);
		while (true) {
			const r = n ? [...(this.agentPreparationWork.get(n) || [])] : [...this.agentPreparationWork.values()].flatMap((e) => [...e]);
			if (r.length === 0) return;
			await Promise.allSettled(r);
		}
	}`
  const waitForAgentPreparationMethod = `\twaitForAgentPreparation(e, t = {}) {
		const agentId = normalizeAgentId(e);
		const pending = this.pending.get(agentId);
		const signal = t.signal ? AbortSignal.any([this.signal, t.signal]) : this.signal;
		if (!pending || readAgentDatabaseAdmissionRefusal(e, t) !== pending.refusal) {
			if (!t.forWrite) return;
			return this.waitForAgentPreparations(agentId).then(() => assertAgentDatabaseAdmitted(e, t));
		}
		if (!t.forWrite) {
			const ready = t.forWrite === false ? pending.readReady : pending.completion;
			return ready && racePromiseWithAbortSignal(ready, signal);
		}
		const timeoutMs = GATEWAY_STARTUP_ADMISSION_WAIT_MS + Math.ceil(this.pending.size / 2) * 6e4;
		return raceWithTimeout(Promise.all([pending.completion, this.waitForAgentPreparations(agentId)]), timeoutMs, () => {
			throw new AgentDatabaseAdmissionError({
				...pending.refusal,
				repairHint: "This agent is still preparing. Retry the request after background inspection and preparation finish."
			});
		}, {
			signal,
			ref: false
		}).then(() => assertAgentDatabaseAdmitted(e, t));
	}`
  const existingMarker = previousMarkers.find((candidate) => source.includes(candidate))
  if (existingMarker) {
    const previousWaitMethod = /\tasync waitForAgentPreparations\(.*?\) \{[\s\S]*?\n\t\}/u
    const previousAdmissionMethod = /\twaitForAgentPreparation\(e, t = \{\}\) \{[\s\S]*?\n\t\}/u
    if (!previousWaitMethod.test(source) || !previousAdmissionMethod.test(source)) {
      throw new Error('OpenClaw agent database preparation barrier changed; cannot extend write admission')
    }
    return source
      .replace(previousWaitMethod, waitMethod)
      .replace(previousAdmissionMethod, waitForAgentPreparationMethod)
      .replace(existingMarker, marker)
  }

  const workAnchor = 'this.work = /* @__PURE__ */ new Set();'
  const trackingMethodAnchor = '\ttrack(e) {'
  const trackAnchor = '\t\t\tthis.track(p);'
  if (!source.includes(workAnchor) || !source.includes(trackingMethodAnchor)) {
    throw new Error('OpenClaw agent database startup admission changed; cannot add preparation completion barrier')
  }
  const trackIndex = source.indexOf(trackAnchor)
  if (trackIndex < 0 || source.indexOf(trackAnchor, trackIndex + trackAnchor.length) >= 0) {
    throw new Error('OpenClaw agent database preparation tracking changed; cannot add completion barrier')
  }

  const methods = `\ttrackAgentPreparation(e, t) {
		const n = normalizeAgentId(e);
		let r = this.agentPreparationWork.get(n);
		if (!r) {
			r = /* @__PURE__ */ new Set();
			this.agentPreparationWork.set(n, r);
		}
		r.add(t);
		this.track(t);
		const i = () => {
			r.delete(t);
			if (r.size === 0 && this.agentPreparationWork.get(n) === r) this.agentPreparationWork.delete(n);
		};
		t.then(i, i);
	}
	${waitMethod.trimStart()}`
  let patched = source.replace(workAnchor, `${workAnchor}\n\t\tthis.agentPreparationWork = /* @__PURE__ */ new Map();`)
  patched = patched.replace(trackingMethodAnchor, `${methods}\n${trackingMethodAnchor}`)
  patched = patched.replace(trackAnchor, '\t\t\tthis.trackAgentPreparation(i, p);')
  const previousAdmissionMethod = /\twaitForAgentPreparation\(e, t = \{\}\) \{[\s\S]*?\n\t\}/u
  if (!previousAdmissionMethod.test(patched)) {
    throw new Error('OpenClaw agent database write admission changed; cannot wait for complete preparation')
  }
  patched = patched.replace(previousAdmissionMethod, waitForAgentPreparationMethod)
  return `// ${marker}\n${patched}`
}

function ensureAgentDatabaseStartupPreparationBarrier(vendorRoot) {
  const dist = path.join(vendorRoot, 'dist')
  const candidates = fs.readdirSync(dist)
    .filter((name) => /^agent-database-startup-.*\.mjs$/.test(name))
    .map((name) => ({ file: path.join(dist, name), source: fs.readFileSync(path.join(dist, name), 'utf8') }))
    .filter(({ source }) => source.includes('this.work = /* @__PURE__ */ new Set();')
      && (source.includes('\t\t\tthis.track(p);') || source.includes('\t\t\tthis.trackAgentPreparation(i, p);')))
  if (candidates.length !== 1) throw new Error(`Expected one OpenClaw agent database startup implementation; found ${candidates.length}`)
  const { file, source } = candidates[0]
  const patched = patchAgentDatabaseStartupPreparationBarrier(source)
  if (patched !== source) fs.writeFileSync(file, patched)
}

function patchRestartResumeCustodyRetrySource(source) {
  if (source.includes(marker)) return source

  const legacyStartIndex = source.indexOf(legacyMarker)
  const startIndex = legacyStartIndex >= 0 ? source.lastIndexOf('//', legacyStartIndex) : source.indexOf(start)
  if (startIndex < 0) throw new Error('OpenClaw deferred restart-resume entry point changed; cannot apply custody retry')
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (endIndex < 0) throw new Error('OpenClaw deferred restart-resume boundary changed; cannot apply custody retry')

  const patched = `${String.raw`// ${marker}.
function restartResumeSessionStoreCustodyMismatchPath(error) {
	const prefix = "Session database target changed outside captured discovery custody:";
	const pending = [error];
	const seen = new Set();
	while (pending.length > 0) {
		const value = pending.pop();
		if (typeof value === "string") {
			const index = value.indexOf(prefix);
			if (index >= 0) return value.slice(index + prefix.length).split(/\r?\n/u, 1)[0].trim();
			continue;
		}
		if (!value || typeof value !== "object" || seen.has(value)) continue;
		seen.add(value);
		pending.push(value.message, value.cause, value.readError, value.error);
	}
	return "";
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
		if (typeof i.waitForAgentPreparations === "function") await i.waitForAgentPreparations();
		else await Promise.allSettled([...o.values()].filter(Boolean));
	};
	const resumeWithCustodyRetry = async (agentIds) => {
		if (agentIds.length === 0) return;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				await resumeAgentSessions(e, agentIds, a);
				return;
			} catch (error) {
				const changedPath = restartResumeSessionStoreCustodyMismatchPath(error);
				if (!changedPath || attempt >= 3) throw error;
				a.delete(changedPath);
				r.warn("Restart resume for " + agentIds.join(", ") + " found a session database custody change; waiting for complete agent database preparation before retry " + (attempt + 1) + "/3.");
				await waitForAllAgentPreparations();
			}
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

module.exports = {
  ensureAgentDatabaseStartupPreparationBarrier,
  ensureRestartResumeCustodyRetry,
  patchAgentDatabaseStartupPreparationBarrier,
  patchRestartResumeCustodyRetrySource,
}
