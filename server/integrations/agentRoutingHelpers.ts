/**
 * Source patches injected into supported OpenClaw plugin bundles.
 *
 * These are intentionally isolated from server startup and route composition:
 * they are large, versioned integration assets rather than executable control
 * plane logic.
 */

export const CLAWTALK_CORE_BRIDGE_ROUTING_HELPER = String.raw`
var CLAWTALK_ROUTING_PATCH_VERSION = 11;
function resolveClawTalkStateRoot() {
    var root = process.env.OPENCLAW_STATE_ROOT || process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || '';
    if (!root) {
        var home = process.env.USERPROFILE || process.env.HOME || process.cwd();
        root = /[\\/]\.openclaw$/i.test(home) ? home : path.join(home, '.openclaw');
    }
    return root;
}
function readClawTalkOpenClawConfig(fallback) {
    var configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(resolveClawTalkStateRoot(), 'openclaw.json');
    try {
        var parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (unused) {}
    return fallback && typeof fallback === 'object' ? fallback : {};
}
function normalizeClawTalkAgentAlias(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/^[@/]+/, '').replace(/['"\`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function addClawTalkAgentAlias(aliases, seen, display, agentId) {
    var text = String(display == null ? '' : display).trim();
    var key = normalizeClawTalkAgentAlias(text);
    if (!key || !agentId) return;
    if (seen.has(key)) {
        for(var i = 0; i < aliases.length; i++){
            if (aliases[i].key === key && aliases[i].agentId !== agentId) aliases[i].ambiguous = true;
        }
        return;
    }
    seen.add(key);
    aliases.push({
        display: text,
        key: key,
        agentId: agentId,
        ambiguous: false
    });
}
function clawTalkNameTokens(value) {
    var parts = String(value == null ? '' : value).trim().split(/\s+/).map(function(part) {
        return part.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    }).filter(Boolean);
    while(parts.length && /^(dr|mr|mrs|ms)\.?$/i.test(parts[0]))parts.shift();
    return parts;
}
function addClawTalkNameAliases(aliases, seen, name, agentId) {
    var text = String(name == null ? '' : name).trim();
    if (!text) return;
    addClawTalkAgentAlias(aliases, seen, text, agentId);
    addClawTalkAgentAlias(aliases, seen, text.replace(/\s+/g, '-'), agentId);
    var tokens = clawTalkNameTokens(text);
    if (!tokens.length) return;
    addClawTalkAgentAlias(aliases, seen, tokens[0], agentId);
    if (tokens.length > 1) {
        var last = tokens[tokens.length - 1];
        addClawTalkAgentAlias(aliases, seen, last, agentId);
        var firstLast = tokens[0] + ' ' + last;
        addClawTalkAgentAlias(aliases, seen, firstLast, agentId);
        addClawTalkAgentAlias(aliases, seen, firstLast.replace(/\s+/g, '-'), agentId);
    }
    for(var i = 0; i < tokens.length; i++){
        if (tokens[i].length > 1) addClawTalkAgentAlias(aliases, seen, tokens[i], agentId);
    }
}
function buildClawTalkAgentAliases(config, fallbackAgentId) {
    var aliases = [];
    var seen = new Set();
    var agentIds = new Set();
    var list = config && config.agents && Array.isArray(config.agents.list) ? config.agents.list : [];
    for(var i = 0; i < list.length; i++){
        var id = typeof list[i].id === 'string' ? list[i].id.trim() : '';
        if (id) agentIds.add(id);
    }
    if (fallbackAgentId) agentIds.add(fallbackAgentId);
    for(var j = 0; j < list.length; j++){
        var agent = list[j] || {};
        var agentId = typeof agent.id === 'string' ? agent.id.trim() : '';
        if (!agentId) continue;
        addClawTalkAgentAlias(aliases, seen, agentId, agentId);
        if (/^hn-/i.test(agentId)) addClawTalkAgentAlias(aliases, seen, agentId.replace(/^hn-/i, ''), agentId);
        var names = [
            agent.name,
            agent.identity && agent.identity.name
        ];
        for(var k = 0; k < names.length; k++){
            var name = String(names[k] == null ? '' : names[k]).trim();
            addClawTalkNameAliases(aliases, seen, name, agentId);
        }
    }
    return {
        aliases: aliases.filter(function(alias) {
            return !alias.ambiguous;
        }),
        agentIds: agentIds
    };
}
function normalizeClawTalkModelRef(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (text.indexOf('/') === -1 && /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(text)) return 'openai/' + text;
    return text;
}
function modelRefFromClawTalkModelSelection(selection) {
    if (typeof selection === 'string') return normalizeClawTalkModelRef(selection);
    if (!selection || typeof selection !== 'object') return '';
    return normalizeClawTalkModelRef(selection.primary || selection.model || selection.id || '');
}
function findClawTalkAgentConfig(config, agentId) {
    var wanted = String(agentId || '').trim().toLowerCase();
    if (!wanted) return null;
    var list = config && config.agents && Array.isArray(config.agents.list) ? config.agents.list : [];
    for(var i = 0; i < list.length; i++){
        var entry = list[i] || {};
        if (String(entry.id || '').trim().toLowerCase() === wanted) return entry;
    }
    return null;
}
function readClawTalkAgentLocalModelRef(agent) {
    try {
        var agentDir = String(agent && agent.agentDir || '').trim();
        if (!agentDir) return '';
        var parsed = JSON.parse(fs.readFileSync(path.join(agentDir, 'config.json'), 'utf8'));
        return modelRefFromClawTalkModelSelection(parsed && parsed.model);
    } catch (unused) {
        return '';
    }
}
function resolveClawTalkAgentModelRef(config, agentId) {
    var agent = findClawTalkAgentConfig(config, agentId);
    var agentModel = modelRefFromClawTalkModelSelection(agent && agent.model) || readClawTalkAgentLocalModelRef(agent);
    if (agentModel) return agentModel;
    var defaults = config && config.agents && config.agents.defaults ? config.agents.defaults.model : null;
    return modelRefFromClawTalkModelSelection(defaults);
}
function escapeClawTalkRegExp(value) {
    var text = String(value);
    var out = '';
    for(var i = 0; i < text.length; i++){
        var ch = text.charAt(i);
        out += '\\^$*+?.()|{}[]'.indexOf(ch) === -1 ? ch : '\\' + ch;
    }
    return out;
}
function parseClawTalkRouteReset(prompt) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    if (trimmed.charAt(0) !== '/') return null;
    var rest = trimmed.slice(1).replace(/^\s+/, '');
    var match = /^(default|main|reset|clear)(?:\s+|$)/i.exec(rest);
    if (!match) return null;
    return {
        prompt: rest.slice(match[0].length).replace(/^\s+/, '')
    };
}
function parseClawTalkRoutePrefix(prompt, aliases) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    var mode = trimmed.charAt(0);
    if (mode !== '@' && mode !== '/') return null;
    var rest = trimmed.slice(1).replace(/^\s+/, '');
    var sorted = aliases.slice().sort(function(a, b) {
        return b.display.length - a.display.length;
    });
    for(var i = 0; i < sorted.length; i++){
        var alias = sorted[i];
        if (!alias.display) continue;
        var match = new RegExp('^' + escapeClawTalkRegExp(alias.display) + '(?:\\s+|\\s*[:;,]\\s*|$)', 'i').exec(rest);
        if (!match) continue;
        return {
            mode: mode,
            alias: alias.display,
            agentId: alias.agentId,
            prompt: rest.slice(match[0].length).replace(/^\s+/, '')
        };
    }
    return null;
}
function resolveClawTalkRouteStatePath() {
    return path.join(resolveClawTalkStateRoot(), 'plugins', 'clawtalk', 'agent-routes.json');
}
function readClawTalkRouteState() {
    try {
        var parsed = JSON.parse(fs.readFileSync(resolveClawTalkRouteStatePath(), 'utf8'));
        if (parsed && typeof parsed === 'object') {
            if (!parsed.routes || typeof parsed.routes !== 'object') parsed.routes = {};
            return parsed;
        }
    } catch (unused) {}
    return {
        version: 1,
        routes: {}
    };
}
function writeClawTalkRouteState(state) {
    try {
        var filePath = resolveClawTalkRouteStatePath();
        fs.mkdirSync(path.dirname(filePath), {
            recursive: true
        });
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
    } catch (unused) {}
}
function buildClawTalkRoutedSessionKey(sessionKey, agentId, fallbackAgentId) {
    var base = String(sessionKey || 'clawtalk:default');
    if (!agentId || agentId === fallbackAgentId) return base;
    return base + ':agent:' + String(agentId).replace(/[^A-Za-z0-9_.:-]/g, '_');
}
function buildClawTalkRoutingPrompt(route) {
    var prompt = String(route.prompt || '').trim();
    if (prompt) return prompt;
    if (route.mode === '/') return 'You are now the active ClawTalk agent for this channel. Reply briefly confirming the switch.';
    return 'Reply briefly as the requested ClawTalk agent.';
}
function logClawTalkRoute(logger, message) {
    try {
        if (logger && typeof logger.info === 'function') logger.info(message);
        else if (logger && typeof logger.debug === 'function') logger.debug(message);
    } catch (unused) {}
}
function resolveClawTalkAgentRoute(params, fallbackConfig, fallbackAgentId, logger) {
    var config = readClawTalkOpenClawConfig(fallbackConfig);
    var built = buildClawTalkAgentAliases(config, fallbackAgentId);
    var baseSessionKey = String(params && params.sessionKey ? params.sessionKey : 'clawtalk:default');
    var rawPrompt = String(params && params.prompt != null ? params.prompt : '');
    var state = readClawTalkRouteState();
    var routes = state.routes && typeof state.routes === 'object' ? state.routes : {};
    state.routes = routes;
    var reset = parseClawTalkRouteReset(rawPrompt);
    if (reset) {
        if (Object.prototype.hasOwnProperty.call(routes, baseSessionKey)) {
            delete routes[baseSessionKey];
            writeClawTalkRouteState(state);
        }
        logClawTalkRoute(logger, 'ClawTalk routing reset for ' + baseSessionKey + ' to ' + fallbackAgentId);
        return {
            config: config,
            agentId: fallbackAgentId,
            prompt: reset.prompt || 'Use the default ClawTalk agent for this channel. Reply briefly confirming the switch.',
            sessionKey: baseSessionKey
        };
    }
    var parsed = parseClawTalkRoutePrefix(rawPrompt, built.aliases);
    if (parsed && built.agentIds.has(parsed.agentId)) {
        if (parsed.mode === '/') {
            routes[baseSessionKey] = {
                agentId: parsed.agentId,
                alias: parsed.alias,
                updatedAt: new Date().toISOString()
            };
            writeClawTalkRouteState(state);
            logClawTalkRoute(logger, 'ClawTalk sticky route for ' + baseSessionKey + ' -> ' + parsed.agentId);
        } else {
            logClawTalkRoute(logger, 'ClawTalk one-shot route for ' + baseSessionKey + ' -> ' + parsed.agentId);
        }
        return {
            config: config,
            agentId: parsed.agentId,
            prompt: buildClawTalkRoutingPrompt(parsed),
            sessionKey: buildClawTalkRoutedSessionKey(baseSessionKey, parsed.agentId, fallbackAgentId)
        };
    }
    var sticky = routes[baseSessionKey];
    if (sticky && typeof sticky.agentId === 'string') {
        if (built.agentIds.has(sticky.agentId)) {
            return {
                config: config,
                agentId: sticky.agentId,
                prompt: rawPrompt,
                sessionKey: buildClawTalkRoutedSessionKey(baseSessionKey, sticky.agentId, fallbackAgentId)
            };
        }
        delete routes[baseSessionKey];
        writeClawTalkRouteState(state);
    }
    return {
        config: config,
        agentId: fallbackAgentId,
        prompt: rawPrompt,
        sessionKey: baseSessionKey
    };
}
function resolveClawTalkControlCenterStreamUrl() {
    var url = process.env.CLAWTALK_CONTROL_CENTER_AGENT_TURN_STREAM_URL || process.env.CONTROL_CENTER_AGENT_TURN_STREAM_URL || '';
    return String(url == null ? '' : url).trim();
}
function resolveClawTalkControlCenterConsoleFinalUrl() {
    var url = process.env.CLAWTALK_CONTROL_CENTER_CONSOLE_FINAL_URL || '';
    url = String(url == null ? '' : url).trim();
    if (url) return url;
    var streamUrl = resolveClawTalkControlCenterStreamUrl();
    return streamUrl ? streamUrl.replace(/\/agent-turn\/stream(?:\?.*)?$/, '/clawtalk-console/final') : '';
}
async function notifyClawTalkControlCenterConsoleFinal(options, text) {
    var url = resolveClawTalkControlCenterConsoleFinalUrl();
    if (!url || typeof fetch !== 'function') return;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: 'clawtalk',
                agent: options.agentId,
                sessionKey: options.sessionKey,
                prompt: String(options.prompt == null ? '' : options.prompt),
                reply: String(text == null ? '' : text),
                ok: true,
                transport: 'clawtalk-control-center',
                buffered: true,
                liveTokens: false
            })
        });
    } catch (unused) {}
}
function normalizeClawTalkThinkLevel(value) {
    var text = String(value == null ? '' : value).trim().toLowerCase();
    return /^(off|minimal|low|medium|high)$/.test(text) ? text : 'off';
}
function clampClawTalkTimeoutSeconds(timeoutMs) {
    var seconds = Math.ceil(Number(timeoutMs || DEFAULT_TIMEOUT_MS) / 1000);
    if (!Number.isFinite(seconds)) seconds = 120;
    return Math.max(30, Math.min(7200, seconds));
}
function controlCenterTimeoutMsForClawTalk(timeoutMs) {
    var requestedMs = Number(timeoutMs || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(requestedMs) || requestedMs <= 0) requestedMs = DEFAULT_TIMEOUT_MS;
    var floorSeconds = Number(process.env.CLAWTALK_CONTROL_CENTER_TIMEOUT_FLOOR_SECONDS || 600);
    if (!Number.isFinite(floorSeconds) || floorSeconds < 30) floorSeconds = 600;
    var floorMs = Math.max(30000, Math.min(7200000, Math.round(floorSeconds * 1000)));
    var baseMs = Math.max(requestedMs, floorMs);
    var graceMs = Math.max(120000, Math.ceil(baseMs * 0.1));
    return Math.min(7200000, baseMs + graceMs);
}
function parseClawTalkSseFrames(buffer) {
    var normalized = String(buffer || '').replace(/\r\n/g, '\n');
    var frames = [];
    var cursor = 0;
    for(;;){
        var boundary = normalized.indexOf('\n\n', cursor);
        if (boundary === -1) break;
        var rawFrame = normalized.slice(cursor, boundary);
        cursor = boundary + 2;
        var event = 'message';
        var data = [];
        var lines = rawFrame.split('\n');
        for(var i = 0; i < lines.length; i++){
            var line = lines[i];
            if (line.indexOf('event:') === 0) event = line.slice(6).trim() || 'message';
            if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^\s+/, ''));
        }
        if (data.length) frames.push({
            event: event,
            data: data.join('\n')
        });
    }
    return {
        frames: frames,
        rest: normalized.slice(cursor)
    };
}
function clawTalkPayloadText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    var payloads = [];
    if (Array.isArray(payload.payloads)) payloads = payloads.concat(payload.payloads);
    if (payload.result && Array.isArray(payload.result.payloads)) payloads = payloads.concat(payload.result.payloads);
    var payloadText = payloads.map(function(item) {
        return item && typeof item.text === 'string' ? item.text.trim() : '';
    }).filter(Boolean).join('\n\n');
    if (payloadText) return payloadText;
    if (payload.payload && typeof payload.payload.text === 'string' && payload.payload.text.trim()) return payload.payload.text.trim();
    var keys = [
        'reply',
        'text',
        'message',
        'error',
        'detail',
        'stderr',
        'stdout'
    ];
    for(var i = 0; i < keys.length; i++){
        var value = payload[keys[i]];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}
function clawTalkJsonPayload(text) {
    try {
        var parsed = JSON.parse(String(text || ''));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (unused) {
        return null;
    }
}
async function readClawTalkControlCenterStream(response) {
    if (!response.body || typeof response.body.getReader !== 'function') {
        var raw = await response.text();
        var payload = clawTalkJsonPayload(raw);
        var text = clawTalkPayloadText(payload) || raw.trim();
        if (!response.ok || payload && payload.ok === false) throw new Error(text || 'Control Center agent turn failed.');
        return text;
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var accumulated = '';
    var finalPayload = null;
    var errorText = '';
    for(;;){
        var chunk = await reader.read();
        if (chunk.done) break;
        var parsed = parseClawTalkSseFrames(buffer + decoder.decode(chunk.value, {
            stream: true
        }));
        buffer = parsed.rest;
        for(var i = 0; i < parsed.frames.length; i++){
            var frame = parsed.frames[i];
            var payload = clawTalkJsonPayload(frame.data);
            if (!payload) continue;
            if (frame.event === 'delta') {
                var delta = typeof payload.text === 'string' ? payload.text : '';
                if (payload.replace === true) accumulated = delta;
                else accumulated += delta;
            } else if (frame.event === 'error') {
                errorText = clawTalkPayloadText(payload) || errorText;
            } else if (frame.event === 'final') {
                finalPayload = payload;
            }
        }
    }
    var tail = parseClawTalkSseFrames(buffer + decoder.decode() + '\n\n');
    for(var j = 0; j < tail.frames.length; j++){
        var tailFrame = tail.frames[j];
        var tailPayload = clawTalkJsonPayload(tailFrame.data);
        if (!tailPayload) continue;
        if (tailFrame.event === 'delta') {
            var tailDelta = typeof tailPayload.text === 'string' ? tailPayload.text : '';
            if (tailPayload.replace === true) accumulated = tailDelta;
            else accumulated += tailDelta;
        } else if (tailFrame.event === 'error') {
            errorText = clawTalkPayloadText(tailPayload) || errorText;
        } else if (tailFrame.event === 'final') {
            finalPayload = tailPayload;
        }
    }
    var finalText = accumulated.trim() || clawTalkPayloadText(finalPayload) || errorText;
    if (!response.ok || finalPayload && finalPayload.ok === false) throw new Error(finalText || 'Control Center agent turn failed.');
    return finalText;
}
async function runClawTalkControlCenterOrEmbeddedAgentTurn(options) {
    var timeoutMs = controlCenterTimeoutMsForClawTalk(options.timeoutMs);
    if (options.embeddedParams && typeof options.embeddedParams === 'object') {
        options.embeddedParams.timeoutMs = timeoutMs;
    }
    var url = resolveClawTalkControlCenterStreamUrl();
    if (url && typeof fetch === 'function') {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = controller ? setTimeout(function() {
            controller.abort();
        }, timeoutMs) : null;
        try {
            var prompt = String(options.prompt == null ? '' : options.prompt);
            var extra = String(options.extraSystemPrompt == null ? '' : options.extraSystemPrompt).trim();
            var message = extra ? extra + '\n\n' + prompt : prompt;
            var response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: controller ? controller.signal : undefined,
                body: JSON.stringify({
                    source: 'clawtalk',
                    agent: options.agentId,
                    message: message,
                    intentMessage: prompt,
                    displayPrompt: prompt,
                    sessionKey: options.sessionKey,
                    thinking: normalizeClawTalkThinkLevel(options.thinkLevel),
                    timeoutSeconds: clampClawTalkTimeoutSeconds(timeoutMs),
                    forceOpenClawRuntime: true
                })
            });
            var text = await readClawTalkControlCenterStream(response);
            await notifyClawTalkControlCenterConsoleFinal(options, text);
            return {
                payloads: text ? [
                    {
                        text: text,
                        isError: false
                    }
                ] : [],
                meta: {
                    controlCenter: true
                }
            };
        } catch (err) {
            try {
                var fallbackMessage = 'CoreBridge: Control Center stream unavailable, falling back to embedded agent: ' + (err instanceof Error ? err.message : String(err));
                var logDebug = options.logger && typeof options.logger.debug === 'function' ? options.logger.debug.bind(options.logger) : null;
                var logWarn = options.logger && typeof options.logger.warn === 'function' ? options.logger.warn.bind(options.logger) : null;
                if (/aborted|aborterror/i.test(fallbackMessage) && logDebug) logDebug(fallbackMessage);
                else if (logWarn) logWarn(fallbackMessage);
            } catch (unused) {}
        } finally{
            if (timer) clearTimeout(timer);
        }
    }
    var embeddedResult = await options.embedded(options.embeddedParams);
    var embeddedText = clawTalkPayloadText(embeddedResult);
    if (embeddedText) await notifyClawTalkControlCenterConsoleFinal(options, embeddedText);
    return embeddedResult;
}
`.trim()

export const TELEGRAM_AGENT_ROUTING_HELPER = String.raw`
var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 2;
var TELEGRAM_AGENT_ROUTE_MEMORY_KEY = '__openclawTelegramAgentRoutes';
function resolveTelegramAgentRouteMemory() {
    var root = globalThis;
    var state = root[TELEGRAM_AGENT_ROUTE_MEMORY_KEY];
    if (!state || typeof state !== 'object') {
        state = {
            routes: {}
        };
        root[TELEGRAM_AGENT_ROUTE_MEMORY_KEY] = state;
    }
    if (!state.routes || typeof state.routes !== 'object') state.routes = {};
    return state;
}
function normalizeTelegramAgentAlias(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/^[@/]+/, '').replace(/[\u0027\u0022\u0060]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function addTelegramAgentAlias(aliases, seen, display, agentId) {
    var text = String(display == null ? '' : display).trim();
    var key = normalizeTelegramAgentAlias(text);
    if (!key || !agentId) return;
    if (seen.has(key)) {
        for(var i = 0; i < aliases.length; i++){
            if (aliases[i].key === key && aliases[i].agentId !== agentId) aliases[i].ambiguous = true;
        }
        return;
    }
    seen.add(key);
    aliases.push({
        display: text,
        key: key,
        agentId: agentId,
        ambiguous: false
    });
}
function telegramAgentNameTokens(value) {
    var parts = String(value == null ? '' : value).trim().split(/\s+/).map(function(part) {
        return part.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    }).filter(Boolean);
    while(parts.length && /^(dr|mr|mrs|ms)\.?$/i.test(parts[0]))parts.shift();
    return parts;
}
function addTelegramAgentNameAliases(aliases, seen, name, agentId) {
    var text = String(name == null ? '' : name).trim();
    if (!text) return;
    addTelegramAgentAlias(aliases, seen, text, agentId);
    addTelegramAgentAlias(aliases, seen, text.replace(/\s+/g, '-'), agentId);
    var tokens = telegramAgentNameTokens(text);
    if (!tokens.length) return;
    addTelegramAgentAlias(aliases, seen, tokens[0], agentId);
    if (tokens.length > 1) {
        var last = tokens[tokens.length - 1];
        addTelegramAgentAlias(aliases, seen, last, agentId);
        var firstLast = tokens[0] + ' ' + last;
        addTelegramAgentAlias(aliases, seen, firstLast, agentId);
        addTelegramAgentAlias(aliases, seen, firstLast.replace(/\s+/g, '-'), agentId);
    }
    for(var i = 0; i < tokens.length; i++){
        if (tokens[i].length > 1) addTelegramAgentAlias(aliases, seen, tokens[i], agentId);
    }
}
function buildTelegramAgentAliases(config, fallbackAgentId) {
    var aliases = [];
    var seen = new Set();
    var agentIds = new Set();
    var list = config && config.agents && Array.isArray(config.agents.list) ? config.agents.list : [];
    for(var i = 0; i < list.length; i++){
        var id = typeof list[i].id === 'string' ? list[i].id.trim() : '';
        if (id) agentIds.add(id);
    }
    if (fallbackAgentId) agentIds.add(fallbackAgentId);
    for(var j = 0; j < list.length; j++){
        var agent = list[j] || {};
        var agentId = typeof agent.id === 'string' ? agent.id.trim() : '';
        if (!agentId) continue;
        addTelegramAgentAlias(aliases, seen, agentId, agentId);
        if (/^hn-/i.test(agentId)) addTelegramAgentAlias(aliases, seen, agentId.replace(/^hn-/i, ''), agentId);
        var names = [
            agent.name,
            agent.identity && agent.identity.name
        ];
        for(var k = 0; k < names.length; k++){
            addTelegramAgentNameAliases(aliases, seen, names[k], agentId);
        }
    }
    return {
        aliases: aliases.filter(function(alias) {
            return !alias.ambiguous;
        }),
        agentIds: agentIds
    };
}
function escapeTelegramAgentRegExp(value) {
    var text = String(value);
    var out = '';
    for(var i = 0; i < text.length; i++){
        var ch = text.charAt(i);
        out += '\\^$*+?.()|{}[]'.indexOf(ch) === -1 ? ch : '\\' + ch;
    }
    return out;
}
function parseTelegramAgentRouteReset(prompt) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    if (trimmed.charAt(0) !== '/') return null;
    var rest = trimmed.slice(1).replace(/^\s+/, '');
    var match = /^(default|main|reset|clear)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.exec(rest);
    if (!match) return null;
    return {
        prompt: rest.slice(match[0].length).replace(/^\s+/, '')
    };
}
function parseTelegramAgentRoutePrefix(prompt, aliases) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    var mode = trimmed.charAt(0);
    if (mode !== '@' && mode !== '/') return null;
    var rest = trimmed.slice(1).replace(/^\s+/, '');
    var sorted = aliases.slice().sort(function(a, b) {
        return b.display.length - a.display.length;
    });
    for(var i = 0; i < sorted.length; i++){
        var alias = sorted[i];
        if (!alias.display) continue;
        var botSuffix = mode === '/' ? '(?:@[A-Za-z0-9_]+)?' : '';
        var match = new RegExp('^' + escapeTelegramAgentRegExp(alias.display) + botSuffix + '(?:\\s+|\\s*[:;,]\\s*|$)', 'i').exec(rest);
        if (!match) continue;
        return {
            mode: mode,
            alias: alias.display,
            agentId: alias.agentId,
            prompt: rest.slice(match[0].length).replace(/^\s+/, '')
        };
    }
    return null;
}
function resolveTelegramAgentRouteIntent(prompt, config, fallbackAgentId) {
    var built = buildTelegramAgentAliases(config, fallbackAgentId);
    var reset = parseTelegramAgentRouteReset(prompt);
    if (reset) return {
        kind: 'reset',
        prompt: reset.prompt
    };
    var parsed = parseTelegramAgentRoutePrefix(prompt, built.aliases);
    if (parsed && built.agentIds.has(parsed.agentId)) return {
        kind: 'route',
        parsed: parsed
    };
    return {
        kind: 'none'
    };
}
function isTelegramAgentRouteCommand(prompt, config, fallbackAgentId) {
    var intent = resolveTelegramAgentRouteIntent(prompt, config, fallbackAgentId);
    return intent.kind === 'reset' || intent.kind === 'route';
}
function buildTelegramAgentRouteStateKey(params) {
    var accountId = normalizeAccountId(params.accountId || 'default');
    var key = 'telegram:' + accountId + ':' + (params.isGroup ? 'group' : 'direct') + ':' + String(params.chatId);
    if (params.isGroup && params.resolvedThreadId != null) key += ':topic:' + String(params.resolvedThreadId);
    if (!params.isGroup && params.dmThreadId != null) key += ':dm-topic:' + String(params.dmThreadId);
    return key;
}
function buildTelegramAgentRoutingPrompt(route) {
    var prompt = String(route.prompt || '').trim();
    if (prompt) return prompt;
    if (route.mode === '/') return 'You are now the active Telegram agent for this chat. Reply briefly confirming the switch.';
    return 'Reply briefly as the requested Telegram agent.';
}
function resolveTelegramAgentRouteProfile(config, agentId) {
    var agent = resolveAgentConfig(config || {}, agentId) || {};
    var identity = agent.identity && typeof agent.identity === 'object' ? agent.identity : {};
    var name = String(identity.name || agent.name || agentId || '').trim();
    var workspace = String(agent.workspace || (config && config.agents && config.agents.defaults && config.agents.defaults.workspace) || '').trim();
    return {
        name: name,
        workspace: workspace
    };
}
function buildTelegramAgentRouteContext(params) {
    var agentId = String(params && params.agentId || '').trim();
    if (!agentId) return '';
    var profile = resolveTelegramAgentRouteProfile(params.config || {}, agentId);
    return [
        'Telegram route context (system facts for this turn):',
        '- Active agent id: ' + agentId,
        profile.name ? '- Active agent name: ' + profile.name : '',
        profile.workspace ? '- Active execution workspace: ' + profile.workspace : '',
        params.sessionKey ? '- Active Telegram session key: ' + String(params.sessionKey) : '',
        '- If prior chat history names another agent or workspace, ignore that stale context.',
        '- If asked who you are or what workspace is active, answer from these route facts.'
    ].filter(Boolean).join('\n');
}
function withTelegramAgentRouteContext(params) {
    var prompt = String(params && params.prompt != null ? params.prompt : '').trim();
    var context = buildTelegramAgentRouteContext(params || {});
    if (!context) return prompt;
    if (prompt.indexOf('Telegram route context (system facts for this turn):') === 0) return prompt;
    return prompt ? context + '\n\n' + prompt : context;
}
function applyTelegramAgentRoutedText(original, rawPrompt, prompt) {
    var text = String(original == null ? '' : original);
    var raw = String(rawPrompt == null ? '' : rawPrompt);
    var next = String(prompt == null ? '' : prompt);
    if (!raw || text === raw) return next;
    if (text.indexOf(raw) === 0) return (next + text.slice(raw.length)).trim();
    var index = text.indexOf(raw);
    if (index >= 0) return (text.slice(0, index) + next + text.slice(index + raw.length)).trim();
    return next || text;
}
function buildTelegramRouteForAgent(params, agentId) {
    var targetAgentId = sanitizeAgentId(agentId);
    var peerId = params.isGroup ? buildTelegramGroupPeerId(params.chatId, params.resolvedThreadId) : resolveTelegramDirectPeerId({
        chatId: params.chatId,
        senderId: params.senderId
    });
    var mainSessionKey = normalizeLowercaseStringOrEmpty(buildAgentMainSessionKey({
        agentId: targetAgentId
    }));
    var baseRoute = {
        ...params.route,
        agentId: targetAgentId,
        sessionKey: normalizeLowercaseStringOrEmpty(buildAgentSessionKey({
            agentId: targetAgentId,
            channel: 'telegram',
            accountId: params.accountId,
            peer: {
                kind: params.isGroup ? 'group' : 'direct',
                id: peerId
            },
            dmScope: params.cfg.session && params.cfg.session.dmScope,
            identityLinks: params.cfg.session && params.cfg.session.identityLinks
        })),
        mainSessionKey: mainSessionKey,
        matchedBy: 'telegram-agent-route'
    };
    var baseSessionKey = resolveTelegramConversationBaseSessionKey({
        cfg: params.cfg,
        route: baseRoute,
        chatId: params.chatId,
        isGroup: params.isGroup,
        senderId: params.senderId
    });
    var sessionKey = (!params.isGroup && params.dmThreadId != null && shouldUseTelegramDmThreadSession({
        dmThreadId: params.dmThreadId,
        botHasTopicsEnabled: params.botHasTopicsEnabled
    }) ? resolveThreadSessionKeys({
        baseSessionKey: baseSessionKey,
        threadId: String(params.chatId) + ':' + String(params.dmThreadId)
    }) : null)?.sessionKey ?? baseSessionKey;
    return {
        ...baseRoute,
        sessionKey: sessionKey,
        lastRoutePolicy: deriveLastRoutePolicy({
            sessionKey: sessionKey,
            mainSessionKey: mainSessionKey
        })
    };
}
function resolveTelegramAgentRouteForMessage(params) {
    var rawPrompt = String(params.rawBody == null ? '' : params.rawBody);
    var state = resolveTelegramAgentRouteMemory();
    var routes = state.routes;
    var routeKey = buildTelegramAgentRouteStateKey(params);
    var intent = resolveTelegramAgentRouteIntent(rawPrompt, params.cfg, params.route.agentId);
    if (intent.kind === 'reset') {
        if (Object.prototype.hasOwnProperty.call(routes, routeKey)) delete routes[routeKey];
        var resetPrompt = intent.prompt || 'Use the default Telegram agent for this chat. Reply briefly confirming the switch.';
        return {
            changed: true,
            reason: 'reset',
            route: params.route,
            rawBody: resetPrompt,
            bodyText: applyTelegramAgentRoutedText(params.bodyText, rawPrompt, resetPrompt)
        };
    }
    if (intent.kind === 'route') {
        var parsed = intent.parsed;
        if (parsed.mode === '/') routes[routeKey] = {
            agentId: parsed.agentId,
            alias: parsed.alias,
            updatedAt: new Date().toISOString()
        };
        var prompt = buildTelegramAgentRoutingPrompt(parsed);
        return {
            changed: true,
            reason: parsed.mode === '/' ? 'sticky' : 'one-shot',
            route: buildTelegramRouteForAgent(params, parsed.agentId),
            rawBody: prompt,
            bodyText: applyTelegramAgentRoutedText(params.bodyText, rawPrompt, prompt)
        };
    }
    var sticky = routes[routeKey];
    if (sticky && typeof sticky.agentId === 'string') {
        var built = buildTelegramAgentAliases(params.cfg, params.route.agentId);
        if (built.agentIds.has(sticky.agentId)) return {
            changed: true,
            reason: 'sticky',
            route: buildTelegramRouteForAgent(params, sticky.agentId),
            rawBody: params.rawBody,
            bodyText: params.bodyText
        };
        delete routes[routeKey];
    }
    return {
        changed: false,
        route: params.route,
        rawBody: params.rawBody,
        bodyText: params.bodyText
    };
}
//#endregion telegram-agent-routing-patch
`.trim()
