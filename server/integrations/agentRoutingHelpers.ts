/**
 * Source patches injected into supported OpenClaw plugin bundles.
 *
 * These are intentionally isolated from server startup and route composition:
 * they are large, versioned integration assets rather than executable control
 * plane logic.
 */

export const CLAWTALK_CORE_BRIDGE_ROUTING_HELPER = String.raw`
var CLAWTALK_ROUTING_PATCH_VERSION = 12;
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
        var alreadyPresent = false;
        var ambiguous = false;
        for(var i = 0; i < aliases.length; i++){
            if (aliases[i].key !== key) continue;
            if (aliases[i].agentId !== agentId) {
                aliases[i].ambiguous = true;
                ambiguous = true;
            }
            if (aliases[i].agentId === agentId && aliases[i].display === text) alreadyPresent = true;
        }
        if (!alreadyPresent) aliases.push({
            display: text,
            key: key,
            agentId: agentId,
            ambiguous: ambiguous
        });
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
    addClawTalkAgentAlias(aliases, seen, text.replace(/\s+/g, ''), agentId);
    var tokens = clawTalkNameTokens(text);
    if (!tokens.length) return;
    addClawTalkAgentAlias(aliases, seen, tokens[0], agentId);
    if (tokens.length > 1) {
        var last = tokens[tokens.length - 1];
        addClawTalkAgentAlias(aliases, seen, last, agentId);
        var firstLast = tokens[0] + ' ' + last;
        addClawTalkAgentAlias(aliases, seen, firstLast, agentId);
        addClawTalkAgentAlias(aliases, seen, firstLast.replace(/\s+/g, '-'), agentId);
        addClawTalkAgentAlias(aliases, seen, firstLast.replace(/\s+/g, ''), agentId);
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
        addClawTalkAgentAlias(aliases, seen, agentId.replace(/[-_]/g, ''), agentId);
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
var TELEGRAM_AGENT_ROUTING_PATCH_VERSION = 11;
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
        var alreadyPresent = false;
        var ambiguous = false;
        for(var i = 0; i < aliases.length; i++){
            if (aliases[i].key !== key) continue;
            if (aliases[i].agentId !== agentId) {
                aliases[i].ambiguous = true;
                ambiguous = true;
            }
            if (aliases[i].agentId === agentId && aliases[i].display === text) alreadyPresent = true;
        }
        if (!alreadyPresent) aliases.push({
            display: text,
            key: key,
            agentId: agentId,
            ambiguous: ambiguous
        });
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
    addTelegramAgentAlias(aliases, seen, text.replace(/\s+/g, ''), agentId);
    var tokens = telegramAgentNameTokens(text);
    if (!tokens.length) return;
    addTelegramAgentAlias(aliases, seen, tokens[0], agentId);
    if (tokens.length > 1) {
        var last = tokens[tokens.length - 1];
        addTelegramAgentAlias(aliases, seen, last, agentId);
        var firstLast = tokens[0] + ' ' + last;
        addTelegramAgentAlias(aliases, seen, firstLast, agentId);
        addTelegramAgentAlias(aliases, seen, firstLast.replace(/\s+/g, '-'), agentId);
        addTelegramAgentAlias(aliases, seen, firstLast.replace(/\s+/g, ''), agentId);
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
        addTelegramAgentAlias(aliases, seen, agentId.replace(/[-_]/g, ''), agentId);
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
function normalizeTelegramAgentModelRef(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (text.indexOf('/') === -1 && /^gpt-5(?:\.\d+)?(?:-[a-z0-9][a-z0-9.-]*)?$/i.test(text)) return 'openai/' + text;
    return text;
}
function modelRefFromTelegramAgentModelSelection(selection) {
    if (typeof selection === 'string') return normalizeTelegramAgentModelRef(selection);
    if (!selection || typeof selection !== 'object') return '';
    return normalizeTelegramAgentModelRef(selection.primary || selection.model || selection.id || '');
}
function resolveTelegramAgentModelRef(config, agentId) {
    var agent = resolveAgentConfig(config || {}, agentId) || {};
    var agentModel = modelRefFromTelegramAgentModelSelection(agent && agent.model);
    if (agentModel) return agentModel;
    var defaults = config && config.agents && config.agents.defaults ? config.agents.defaults.model : null;
    return modelRefFromTelegramAgentModelSelection(defaults);
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
    var marker = trimmed.charAt(0);
    if (marker !== '/' && marker !== '\\') return null;
    var rest = trimmed.slice(1).replace(/^\s+/, '');
    var match = /^(default|main|reset|clear)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.exec(rest);
    if (!match) return null;
    return {
        prompt: rest.slice(match[0].length).replace(/^\s+/, '')
    };
}
function parseTelegramAgentRoutePrefix(prompt, aliases) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    var marker = trimmed.charAt(0);
    if (marker !== '@' && marker !== '/' && marker !== '\\') return null;
    // A literal backslash is accepted as a keyboard-friendly alias for a
    // slash command. Treat it as sticky rather than creating a third routing
    // mode, so the rest of the state machine stays deterministic.
    var mode = marker === '\\' ? '/' : marker;
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
function parseTelegramAgentRouteAutoStart(prompt, aliases) {
    var trimmed = String(prompt == null ? '' : prompt).replace(/^\s+/, '');
    if (!trimmed || trimmed.charAt(0) === '@' || trimmed.charAt(0) === '/' || trimmed.charAt(0) === '\\') return null;
    var sorted = aliases.slice().sort(function(a, b) {
        return b.display.length - a.display.length;
    });
    for(var i = 0; i < sorted.length; i++){
        var alias = sorted[i];
        if (!alias.display) continue;
        var match = new RegExp('^' + escapeTelegramAgentRegExp(alias.display) + '(?:\\s+|\\s*[:;,]\\s*|$)', 'i').exec(trimmed);
        if (!match) continue;
        return {
            mode: 'auto',
            alias: alias.display,
            agentId: alias.agentId,
            prompt: trimmed.slice(match[0].length).replace(/^\s+/, '')
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
    var autoParsed = parseTelegramAgentRouteAutoStart(prompt, built.aliases);
    if (autoParsed && built.agentIds.has(autoParsed.agentId)) return {
        kind: 'route',
        parsed: autoParsed
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
function normalizeTelegramAgentPurpose(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\*\`_>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
function readTelegramAgentPurposeFromIdentity(agent) {
    var agentDir = String(agent && agent.agentDir || '').trim();
    if (!agentDir || typeof process === 'undefined' || typeof process.getBuiltinModule !== 'function') return '';
    try {
        var fs = process.getBuiltinModule('node:fs');
        if (!fs || typeof fs.readFileSync !== 'function') return '';
        var separator = agentDir.indexOf('\\') >= 0 ? '\\' : '/';
        var identityPath = agentDir.replace(/[\\/]+$/, '') + separator + 'IDENTITY.md';
        var lines = String(fs.readFileSync(identityPath, 'utf8') || '').slice(0, 8192).split(/\r?\n/);
        for(var i = 0; i < lines.length; i++){
            var cleaned = normalizeTelegramAgentPurpose(lines[i]);
            var match = /^(?:[- ]+)?(?:role|responsibility|purpose|focus|creature)\s*:\s*(.+)$/i.exec(cleaned);
            if (match) return normalizeTelegramAgentPurpose(match[1]);
        }
    } catch (_error) {
        // The route remains fully usable when an optional identity file is absent.
    }
    return '';
}
function resolveTelegramAgentRouteProfile(config, agentId) {
    var agent = resolveAgentConfig(config || {}, agentId) || {};
    var identity = agent.identity && typeof agent.identity === 'object' ? agent.identity : {};
    var name = String(identity.name || agent.name || agentId || '').trim();
    var role = normalizeTelegramAgentPurpose(identity.role || agent.role || agent.description || agent.className || agent.behaviorProfile || '') || readTelegramAgentPurposeFromIdentity(agent);
    var workspace = String(agent.workspace || (config && config.agents && config.agents.defaults && config.agents.defaults.workspace) || '').trim();
    return {
        name: name,
        role: role,
        workspace: workspace
    };
}
function buildTelegramAgentRouteContext(params) {
    var agentId = String(params && params.agentId || '').trim();
    if (!agentId) return '';
    var profile = resolveTelegramAgentRouteProfile(params.config || {}, agentId);
    var modelRef = resolveTelegramAgentModelRef(params.config || {}, agentId);
    return [
        'Automnia Telegram identity contract (authoritative system facts for this turn):',
        '- Product: Automnia AI Nexus (DystopAI Telegram bot).',
        profile.name ? '- Active Automnia agent: ' + profile.name + ' (agent id: ' + agentId + ').' : '- Active Automnia agent id: ' + agentId + '.',
        profile.role ? '- Assigned role: ' + profile.role + '.' : '',
        modelRef ? '- Configured primary execution model: ' + modelRef + '.' : '- Configured primary execution model: unavailable from the active route configuration.',
        profile.workspace ? '- Active execution workspace: ' + profile.workspace : '',
        params.sessionKey ? '- Active Telegram session key: ' + String(params.sessionKey) : '',
        '- These are runtime routing facts, not optional persona suggestions.',
        '- If prior chat history names another agent or workspace, ignore that stale context.',
        '- Never replace this identity with a generic label such as Codex, an OpenClaw personal agent, or GPT-5 when the route facts name an Automnia agent.',
        '- If asked who you are, begin with the active Automnia agent name, assigned role when present, and agent id. If asked for the model, state the configured primary execution model above exactly, including its provider/model id. If a runtime status explicitly reports a fallback model, name that fallback instead.',
        '- The Telegram delivery layer verifies direct identity and model questions against these routing facts. Do not contradict that verified response.'
    ].filter(Boolean).join('\n');
}
function normalizeTelegramIdentityQuestionText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().replace(/[?!.,:;]+$/g, '').trim().toLowerCase();
}
function resolveTelegramIdentityQuestionKind(prompt) {
    var text = normalizeTelegramIdentityQuestionText(prompt);
    if (!text) return '';
    if (/^(?:who|what)\s+(?:are|r)\s+you(?:\s+exactly)?$/i.test(text) || /^(?:what(?:'s| is) your name|which agent are you|what agent are you)$/i.test(text)) return 'identity';
    if (/^(?:what|which)\s+(?:ai\s+)?model(?:\s+(?:are you|do you)\s+(?:using|running))?$/i.test(text) || /^(?:what|which)\s+model\s+(?:are you|do you)\s+(?:use|run)$/i.test(text) || /^what are you running on$/i.test(text)) return 'model';
    return '';
}
function buildTelegramVerifiedIdentityReply(params) {
    var kind = resolveTelegramIdentityQuestionKind(params && params.prompt);
    if (!kind) return '';
    var agentId = String(params && params.agentId || '').trim();
    if (!agentId) return '';
    var profile = resolveTelegramAgentRouteProfile(params && params.config || {}, agentId);
    var displayName = profile.name || agentId;
    var description = displayName + (profile.role ? ', ' + profile.role : '') + ' (agent id: ' + agentId + ')';
    var modelRef = resolveTelegramAgentModelRef(params && params.config || {}, agentId);
    if (kind === 'model') return 'I am ' + description + '. My configured primary execution model is ' + (modelRef || 'not configured') + '.';
    return 'I am ' + description + '. I am the Automnia agent selected for this Telegram message.';
}
function applyTelegramVerifiedIdentityDeliveryGuard(params) {
    var payload = params && params.payload;
    if (!payload || payload.isError === true || !params.info || params.info.kind !== 'final') return payload;
    var reply = buildTelegramVerifiedIdentityReply(params);
    if (!reply) return payload;
    return {
        ...payload,
        text: reply
    };
}
function withTelegramAgentRouteContext(params) {
    var prompt = String(params && params.prompt != null ? params.prompt : '').trim();
    var context = buildTelegramAgentRouteContext(params || {});
    if (!context) return prompt;
    if (prompt.indexOf('Automnia Telegram identity contract (authoritative system facts for this turn):') === 0 || prompt.indexOf('Telegram route context (system facts for this turn):') === 0) return prompt;
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
function buildTelegramAgentFreshSessionKey(sessionKey) {
    var entropy = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return String(sessionKey || '').replace(/:+$/g, '') + ':fresh:' + entropy;
}
function normalizeTelegramRoutedAgentId(value) {
    return String(value == null ? '' : value).trim();
}
function normalizeTelegramRouteKey(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}
function resolveTelegramRoutedDirectPeerId(params) {
    var senderId = params && params.senderId != null ? String(params.senderId).trim() : '';
    return senderId || String(params && params.chatId != null ? params.chatId : '').trim();
}
function buildTelegramRoutedMainSessionKey(agentId) {
    return 'agent:' + normalizeTelegramRouteKey(agentId) + ':main';
}
function resolveTelegramRoutedLinkedPeerId(identityLinks, peerId) {
    if (!identityLinks || typeof identityLinks !== 'object' || !peerId) return '';
    var candidates = new Set([
        normalizeTelegramRouteKey(peerId),
        normalizeTelegramRouteKey('telegram:' + peerId)
    ]);
    var entries = Object.entries(identityLinks);
    for(var i = 0; i < entries.length; i++){
        var canonical = String(entries[i][0] || '').trim();
        var ids = entries[i][1];
        if (!canonical || !Array.isArray(ids)) continue;
        for(var j = 0; j < ids.length; j++){
            if (candidates.has(normalizeTelegramRouteKey(ids[j]))) return canonical;
        }
    }
    return '';
}
function buildTelegramRoutedSessionKey(params) {
    var agentId = normalizeTelegramRouteKey(params.agentId) || 'main';
    var channel = 'telegram';
    var peer = params.peer || {};
    var peerKind = peer.kind === 'group' ? 'group' : 'direct';
    var peerId = normalizeTelegramRouteKey(peer.id) || 'unknown';
    if (peerKind === 'group') return 'agent:' + agentId + ':' + channel + ':group:' + peerId;
    var dmScope = String(params.dmScope || 'main').trim().toLowerCase();
    var linkedPeerId = dmScope === 'main' ? '' : resolveTelegramRoutedLinkedPeerId(params.identityLinks, peerId);
    if (linkedPeerId) peerId = normalizeTelegramRouteKey(linkedPeerId) || peerId;
    if (dmScope === 'per-account-channel-peer' && peerId !== 'unknown') {
        return 'agent:' + agentId + ':' + channel + ':' + (normalizeTelegramRouteKey(params.accountId) || 'default') + ':direct:' + peerId;
    }
    if (dmScope === 'per-channel-peer' && peerId !== 'unknown') return 'agent:' + agentId + ':' + channel + ':direct:' + peerId;
    if (dmScope === 'per-peer' && peerId !== 'unknown') return 'agent:' + agentId + ':direct:' + peerId;
    return buildTelegramRoutedMainSessionKey(agentId);
}
function buildTelegramRoutedThreadSessionKey(baseSessionKey, chatId, dmThreadId) {
    return String(baseSessionKey || '').replace(/:+$/g, '') + ':thread:' + normalizeTelegramRouteKey(String(chatId) + ':' + String(dmThreadId));
}
function buildTelegramRouteForAgent(params, agentId, options) {
    // This helper is injected into OpenClaw's standalone Telegram bundle. Keep
    // it self-contained: peer/session helpers belong to different bundle scopes.
    var targetAgentId = normalizeTelegramRoutedAgentId(agentId);
    var peerId = params.isGroup ? String(params.chatId) + (params.resolvedThreadId != null ? ':topic:' + String(params.resolvedThreadId) : '') : resolveTelegramRoutedDirectPeerId({
        chatId: params.chatId,
        senderId: params.senderId
    });
    var sessionConfig = params.cfg && params.cfg.session && typeof params.cfg.session === 'object' ? params.cfg.session : {};
    var mainSessionKey = buildTelegramRoutedMainSessionKey(targetAgentId);
    var baseRoute = {
        ...params.route,
        agentId: targetAgentId,
        modelRef: resolveTelegramAgentModelRef(params.cfg || {}, targetAgentId),
        sessionKey: buildTelegramRoutedSessionKey({
            agentId: targetAgentId,
            accountId: params.accountId,
            peer: {
                kind: params.isGroup ? 'group' : 'direct',
                id: peerId
            },
            dmScope: sessionConfig.dmScope,
            identityLinks: sessionConfig.identityLinks
        }),
        mainSessionKey: mainSessionKey,
        matchedBy: 'telegram-agent-route'
    };
    var sessionKey = baseRoute.sessionKey;
    if (!params.isGroup && params.dmThreadId != null && params.botHasTopicsEnabled === true) {
        sessionKey = buildTelegramRoutedThreadSessionKey(sessionKey, params.chatId, params.dmThreadId);
    }
    if (options && options.freshSession === true) sessionKey = buildTelegramAgentFreshSessionKey(sessionKey);
    return {
        ...baseRoute,
        sessionKey: sessionKey,
        lastRoutePolicy: sessionKey === mainSessionKey ? 'main' : 'session'
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
            reason: parsed.mode === '/' ? 'sticky' : parsed.mode === 'auto' ? 'auto-fresh' : 'one-shot-fresh',
            route: buildTelegramRouteForAgent(params, parsed.agentId, {
                freshSession: parsed.mode !== '/'
            }),
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
