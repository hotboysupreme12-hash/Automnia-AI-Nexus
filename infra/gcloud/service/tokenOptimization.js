// Keep the hosted request small enough that a tool turn cannot silently turn
// into a six-figure prompt. These are request-shaping budgets, not estimates
// used for billing; the relay still debits Vertex's authoritative usage.
const DEFAULT_MAX_INPUT_TOKENS = 8_192;
const DEFAULT_MAX_OUTPUT_TOKENS = 3_072;
const DEFAULT_TEXT_OUTPUT_TOKENS = 1_536;
const DEFAULT_TOOL_OUTPUT_TOKENS = 2_048;
const DEFAULT_MAX_SYSTEM_CHARS = 6_000;
const DEFAULT_MAX_MESSAGE_CHARS = 12_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 4_000;
const DEFAULT_MAX_HISTORY_MESSAGES = 8;
const DEFAULT_MAX_INLINE_IMAGES = 8;
const DEFAULT_MAX_INLINE_IMAGE_CHARS = 8_500_000;
const DEFAULT_MAX_TOTAL_INLINE_IMAGE_CHARS = 20_000_000;
// Tool names and required argument fields are capability contracts. The
// remaining schema prose is descriptive metadata and can be aggressively
// bounded before it reaches the hosted provider.
const DEFAULT_MAX_TOOL_TOKENS = 2_048;
const DEFAULT_MAX_TOOLS = 24;
const DEFAULT_MAX_TOOL_DESCRIPTION_CHARS = 96;
const DEFAULT_MAX_SCHEMA_DESCRIPTION_CHARS = 64;
const DEFAULT_MAX_SCHEMA_PROPERTIES = 16;
const DEFAULT_MAX_SCHEMA_ENUM_VALUES = 12;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function environmentInteger(name, fallback, minimum, maximum) {
  return boundedInteger(process.env[name], fallback, minimum, maximum);
}

export const AUTOMNIA_RELAY_TOKEN_OPTIMIZATION_VERSION = '2026-11-27.1';

export const automniaRelayTokenOptimization = Object.freeze({
  version: AUTOMNIA_RELAY_TOKEN_OPTIMIZATION_VERSION,
  maxInputTokens: environmentInteger('AUTOMNIA_RELAY_MAX_INPUT_TOKENS', DEFAULT_MAX_INPUT_TOKENS, 2_000, 64_000),
  maxOutputTokens: environmentInteger('AUTOMNIA_RELAY_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS, 512, 32_768),
  textOutputTokens: environmentInteger('AUTOMNIA_RELAY_TEXT_OUTPUT_TOKENS', DEFAULT_TEXT_OUTPUT_TOKENS, 256, 16_384),
  toolOutputTokens: environmentInteger('AUTOMNIA_RELAY_TOOL_OUTPUT_TOKENS', DEFAULT_TOOL_OUTPUT_TOKENS, 512, 16_384),
  maxToolTokens: environmentInteger('AUTOMNIA_RELAY_MAX_TOOL_TOKENS', DEFAULT_MAX_TOOL_TOKENS, 1_024, 16_384),
  maxTools: environmentInteger('AUTOMNIA_RELAY_MAX_TOOLS', DEFAULT_MAX_TOOLS, 4, 128),
  maxSystemChars: environmentInteger('AUTOMNIA_RELAY_MAX_SYSTEM_CHARS', DEFAULT_MAX_SYSTEM_CHARS, 1_000, 64_000),
  maxMessageChars: environmentInteger('AUTOMNIA_RELAY_MAX_MESSAGE_CHARS', DEFAULT_MAX_MESSAGE_CHARS, 1_000, 100_000),
  maxToolResultChars: environmentInteger('AUTOMNIA_RELAY_MAX_TOOL_RESULT_CHARS', DEFAULT_MAX_TOOL_RESULT_CHARS, 1_000, 100_000),
  maxHistoryMessages: environmentInteger('AUTOMNIA_RELAY_MAX_HISTORY_MESSAGES', DEFAULT_MAX_HISTORY_MESSAGES, 2, 64),
  maxInlineImages: environmentInteger('AUTOMNIA_RELAY_MAX_INLINE_IMAGES', DEFAULT_MAX_INLINE_IMAGES, 1, 8),
  maxInlineImageChars: environmentInteger('AUTOMNIA_RELAY_MAX_INLINE_IMAGE_CHARS', DEFAULT_MAX_INLINE_IMAGE_CHARS, 100_000, 8_500_000),
  maxTotalInlineImageChars: environmentInteger('AUTOMNIA_RELAY_MAX_TOTAL_INLINE_IMAGE_CHARS', DEFAULT_MAX_TOTAL_INLINE_IMAGE_CHARS, 1_000_000, 20_000_000),
});

function isImageContentPart(part) {
  return Boolean(part && typeof part === 'object' && !Array.isArray(part) && (
    part.image_url || part.source?.type === 'base64' || part.type === 'input_image' || part.type === 'image_url' || part.type === 'image'
  ));
}

function inlineImageContentLength(part) {
  if (typeof part.source?.data === 'string') return part.source.data.length;
  if (typeof part.data === 'string') return part.data.length;
  const imageUrl = typeof part.image_url === 'string'
    ? part.image_url
    : typeof part.image_url?.url === 'string'
      ? part.image_url.url
      : '';
  return imageUrl.startsWith('data:') ? imageUrl.length : 0;
}

function budgetShape(value) {
  if (Array.isArray(value)) return value.map(budgetShape);
  if (!value || typeof value !== 'object') return value;
  if (isImageContentPart(value)) {
    return { type: 'inline_image', mimeType: value.mimeType || value.mime_type || value.source?.media_type || '' };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, budgetShape(child)]));
}

function inputBudgetChars(value) {
  return JSON.stringify(budgetShape(value)).length;
}

export function estimateRelayTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(budgetShape(value ?? ''));
  return Math.max(0, Math.ceil(String(text).length / 4));
}

function shortenText(value, maxChars, marker = '[content shortened to conserve Automnia credits]') {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return { value: text, truncated: false };
  const safeMax = Math.max(marker.length + 16, maxChars);
  const headChars = Math.max(8, Math.floor((safeMax - marker.length - 2) * 0.68));
  const tailChars = Math.max(8, safeMax - marker.length - 2 - headChars);
  return {
    value: `${text.slice(0, headChars)}\n${marker}\n${text.slice(-tailChars)}`,
    truncated: true,
  };
}

function imageLimitError(message, code) {
  return Object.assign(new Error(message), {
    status: 413,
    publicMessage: message,
    publicType: 'invalid_request_error',
    publicCode: code,
  });
}

function compactContent(content, maxChars, imageState, marker, limits, isCurrentTurn = false) {
  if (typeof content === 'string') return shortenText(content, maxChars, marker);
  if (!Array.isArray(content)) return { value: content, truncated: false };

  let truncated = false;
  const value = [];
  for (const part of content) {
    if (typeof part === 'string') {
      const shortened = shortenText(part, maxChars, marker);
      truncated ||= shortened.truncated;
      value.push(shortened.value);
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    if (isImageContentPart(part)) {
      const imageChars = inlineImageContentLength(part);
      const perImageTooLarge = imageChars > limits.maxInlineImageChars;
      const countExceeded = imageState.count >= imageState.limit;
      const totalTooLarge = imageState.totalChars + imageChars > limits.maxTotalInlineImageChars;
      if (perImageTooLarge || countExceeded || totalTooLarge) {
        if (isCurrentTurn) {
          if (perImageTooLarge) {
            throw imageLimitError('An image exceeds Automnia’s hosted vision size limit. Compress it or attach a smaller image, then retry.', 'image_too_large');
          }
          if (countExceeded) {
            throw imageLimitError(`Automnia supports up to ${imageState.limit} images in one request. Send the remaining images in another message.`, 'image_limit_exceeded');
          }
          throw imageLimitError('Images in this request exceed Automnia’s combined hosted vision limit. Split them across messages and retry.', 'image_total_too_large');
        }
        truncated = true;
        imageState.dropped += 1;
        imageState.oversized += Number(perImageTooLarge || totalTooLarge);
        value.push({ type: 'text', text: '[Earlier image omitted to keep this request within the hosted vision limit. Reattach it if the current question refers to that image.]' });
        continue;
      }
      imageState.count += 1;
      imageState.totalChars += imageChars;
      value.push(part);
      continue;
    }
    const text = typeof part.text === 'string'
      ? part.text
      : typeof part.input_text === 'string'
        ? part.input_text
        : null;
    if (text !== null) {
      const shortened = shortenText(text, maxChars, marker);
      truncated ||= shortened.truncated;
      value.push({ ...part, ...(typeof part.text === 'string' ? { text: shortened.value } : { input_text: shortened.value }) });
      continue;
    }
    value.push(part);
  }
  return { value, truncated };
}

function messageRole(message) {
  const role = String(message?.role || '').trim().toLowerCase();
  return role === 'developer' ? 'system' : role;
}

function compactMessage(message, imageState, limits, isCurrentTurn = false) {
  const role = messageRole(message);
  const maxChars = role === 'system'
    ? limits.maxSystemChars
    : role === 'tool'
      ? limits.maxToolResultChars
      : limits.maxMessageChars;
  const marker = role === 'tool'
    ? '[tool output shortened to conserve Automnia credits]'
    : '[conversation context shortened to conserve Automnia credits]';
  const content = compactContent(message?.content, maxChars, imageState, marker, limits, isCurrentTurn);
  return {
    value: {
      ...message,
      role,
      ...(content.value === undefined ? {} : { content: content.value }),
    },
    truncated: content.truncated,
  };
}

function textContentLength(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, part) => {
    if (typeof part === 'string') return total + part.length;
    if (!part || typeof part !== 'object' || isImageContentPart(part)) return total;
    const text = typeof part.text === 'string' ? part.text : typeof part.input_text === 'string' ? part.input_text : '';
    return total + text.length;
  }, 0);
}

function shortenContentText(content, targetLength, marker) {
  if (typeof content === 'string') return shortenText(content, targetLength, marker);
  if (!Array.isArray(content)) return { value: content, truncated: false };

  let excess = Math.max(0, textContentLength(content) - targetLength);
  let truncated = false;
  const value = content.map((part) => {
    if (excess <= 0) return part;
    if (typeof part === 'string') {
      const shortened = shortenText(part, Math.max(64, part.length - excess), marker);
      excess = Math.max(0, excess - (part.length - shortened.value.length));
      truncated ||= shortened.truncated;
      return shortened.value;
    }
    if (!part || typeof part !== 'object' || isImageContentPart(part)) return part;
    const key = typeof part.text === 'string' ? 'text' : typeof part.input_text === 'string' ? 'input_text' : '';
    if (!key) return part;
    const shortened = shortenText(part[key], Math.max(64, part[key].length - excess), marker);
    excess = Math.max(0, excess - (part[key].length - shortened.value.length));
    truncated ||= shortened.truncated;
    return { ...part, [key]: shortened.value };
  });
  return { value, truncated };
}

function conversationUnits(messages) {
  const units = [];
  for (const message of messages) {
    const previous = units.at(-1);
    const first = previous?.[0];
    const toolResult = messageRole(message) === 'tool' || messageRole(message) === 'function';
    // A parallel tool batch is indivisible: never trim its call separately
    // from its results, or retain a result without the preceding call.
    if (toolResult && messageRole(first) === 'assistant' && (first.tool_calls?.length || first.function_call)) {
      previous.push(message);
    } else {
      units.push([message]);
    }
  }
  return units;
}

export function compactOpenAiMessages(messages, overrides = {}) {
  const limits = {
    maxInputTokens: overrides.maxInputTokens || automniaRelayTokenOptimization.maxInputTokens,
    maxSystemChars: overrides.maxSystemChars || automniaRelayTokenOptimization.maxSystemChars,
    maxMessageChars: overrides.maxMessageChars || automniaRelayTokenOptimization.maxMessageChars,
    maxToolResultChars: overrides.maxToolResultChars || automniaRelayTokenOptimization.maxToolResultChars,
    maxHistoryMessages: overrides.maxHistoryMessages || automniaRelayTokenOptimization.maxHistoryMessages,
    maxInlineImages: overrides.maxInlineImages ?? automniaRelayTokenOptimization.maxInlineImages,
    maxInlineImageChars: overrides.maxInlineImageChars || automniaRelayTokenOptimization.maxInlineImageChars,
    maxTotalInlineImageChars: overrides.maxTotalInlineImageChars || automniaRelayTokenOptimization.maxTotalInlineImageChars,
  };
  const source = Array.isArray(messages) ? messages.filter((message) => message && typeof message === 'object') : [];
  const inputLimitChars = Math.max(8_000, limits.maxInputTokens * 4);
  const systemMessages = source.filter((message) => ['system', 'developer'].includes(messageRole(message)));
  const conversationMessages = source.filter((message) => !['system', 'developer'].includes(messageRole(message)));
  const imageState = { count: 0, dropped: 0, oversized: 0, totalChars: 0, limit: limits.maxInlineImages };
  let truncatedMessages = 0;

  let compactedSystem = [];
  if (systemMessages.length) {
    const systemContent = systemMessages.map((message) => {
      const compacted = compactMessage(message, imageState, limits);
      truncatedMessages += Number(compacted.truncated);
      return typeof compacted.value.content === 'string' ? compacted.value.content : JSON.stringify(compacted.value.content || '');
    }).filter(Boolean).join('\n\n');
    const shortenedSystem = shortenText(
      systemContent,
      Math.min(limits.maxSystemChars, Math.max(512, inputLimitChars - 512)),
      '[system context shortened to conserve Automnia credits]',
    );
    truncatedMessages += Number(shortenedSystem.truncated);
    compactedSystem = [{ role: 'system', content: shortenedSystem.value }];
  }
  const allUnits = conversationUnits(conversationMessages);
  // Raw message windows can contain only tools after four round trips. Keep
  // recent user instructions even then, including the context for "go ahead".
  const userUnits = allUnits.filter(unit => messageRole(unit[0]) === 'user').slice(-3);
  const protectedUnits = new Set(userUnits);
  // The current task includes its completed steps, not just its instruction.
  // Dropping early reads makes the model repeat them indefinitely. Preserve
  // this whole turn and compact result text to fit the budget instead.
  const activeTurnStart = userUnits.length ? allUnits.indexOf(userUnits.at(-1)) : allUnits.length;
  for (const unit of allUnits.slice(activeTurnStart)) protectedUnits.add(unit);
  for (const unit of allUnits.slice(-2)) protectedUnits.add(unit);
  const selectedUnits = new Set(protectedUnits);
  for (const unit of userUnits) {
    const preceding = allUnits[allUnits.indexOf(unit) - 1];
    if (preceding?.length === 1 && messageRole(preceding[0]) === 'assistant' && !preceding[0].tool_calls?.length && !preceding[0].function_call) {
      selectedUnits.add(preceding);
    }
  }
  let recentCount = 0;
  for (let index = allUnits.length - 1; index >= 0 && recentCount < limits.maxHistoryMessages; index -= 1) {
    selectedUnits.add(allUnits[index]);
    recentCount += allUnits[index].length;
  }
  const keptUnits = allUnits.filter(unit => selectedUnits.has(unit));
  const protectedMessages = new Set();
  const keptMessages = keptUnits.flatMap((unit) => unit.map((message) => ({ message, protected: protectedUnits.has(unit) })));
  const currentTurnMessages = new Set(allUnits.slice(activeTurnStart).flat());
  const imagePriorityOrder = [
    ...keptMessages.filter(({ message }) => currentTurnMessages.has(message)),
    ...keptMessages.filter(({ message }) => !currentTurnMessages.has(message)),
  ];
  const compactedByMessage = new Map();
  for (const { message, protected: isProtected } of imagePriorityOrder) {
    const compactedMessage = compactMessage(message, imageState, limits, currentTurnMessages.has(message));
    truncatedMessages += Number(compactedMessage.truncated);
    if (isProtected) protectedMessages.add(compactedMessage.value);
    compactedByMessage.set(message, compactedMessage.value);
  }
  let conversation = keptMessages.map(({ message }) => compactedByMessage.get(message));
  const rebuild = () => [...compactedSystem, ...conversation];
  let compacted = rebuild();
  const originalChars = JSON.stringify(source).length;
  let removedMessages = Math.max(0, conversationMessages.length - conversation.length);

  // Drop old exchanges atomically, retaining the instructions and newest
  // exchange. Shorten their text below if those alone exceed the budget.
  while (inputBudgetChars(compacted) > inputLimitChars && conversation.length > 2) {
    const removable = conversationUnits(conversation).find(unit => !unit.some(message => protectedMessages.has(message)));
    if (!removable) break;
    const removed = new Set(removable);
    conversation = conversation.filter(message => !removed.has(message));
    removedMessages += removable.length;
    compacted = rebuild();
  }

  // Keep trimming the largest text payload until the serialized request is
  // within budget. This is intentionally iterative because JSON overhead,
  // tool-call metadata, and multiple large messages can require several
  // reductions before the limit is actually met.
  for (let pass = 0; inputBudgetChars(compacted) > inputLimitChars && pass < 64; pass += 1) {
    const candidates = [];
    if (compactedSystem[0]?.content) {
      candidates.push({ scope: 'system', index: 0, valueLength: String(compactedSystem[0].content).length, minimum: 512 });
    }
    conversation.forEach((message, index) => {
      const valueLength = textContentLength(message.content);
      if (valueLength) candidates.push({ scope: 'conversation', index, valueLength, minimum: 256 });
    });
    const largest = candidates.sort((left, right) => right.valueLength - left.valueLength)[0];
    if (!largest || largest.valueLength <= largest.minimum) break;

    const overBudget = inputBudgetChars(compacted) - inputLimitChars;
    const targetLength = Math.max(
      largest.minimum,
      largest.valueLength - Math.max(128, Math.ceil(overBudget * 1.15)),
    );
    const marker = largest.scope === 'system'
      ? '[system context shortened to fit the hosted credit budget]'
      : '[current context shortened to fit the hosted credit budget]';
    const shortened = largest.scope === 'system'
      ? shortenText(String(compactedSystem[0].content), targetLength, marker)
      : shortenContentText(conversation[largest.index].content, targetLength, marker);
    if (!shortened.truncated || textContentLength(shortened.value) >= largest.valueLength) break;
    if (largest.scope === 'system') {
      compactedSystem[0] = { ...compactedSystem[0], content: shortened.value };
    } else {
      conversation[largest.index] = { ...conversation[largest.index], content: shortened.value };
    }
    truncatedMessages += 1;
    compacted = rebuild();
  }

  const compactedChars = JSON.stringify(compacted).length;
  return {
    messages: compacted,
    stats: {
      originalMessages: source.length,
      sentMessages: compacted.length,
      removedMessages,
      originalChars,
      compactedChars,
      estimatedPromptTokens: estimateRelayTokens(compacted),
      truncatedMessages,
      droppedImages: imageState.dropped,
      oversizedImages: imageState.oversized,
      changed: originalChars !== compactedChars || removedMessages > 0 || truncatedMessages > 0 || imageState.dropped > 0,
    },
  };
}

function compactJsonSchema(value, depth = 0, overrides = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12) return undefined;
  const maxSchemaDescriptionChars = overrides.maxSchemaDescriptionChars || DEFAULT_MAX_SCHEMA_DESCRIPTION_CHARS;
  const maxSchemaProperties = overrides.maxSchemaProperties || DEFAULT_MAX_SCHEMA_PROPERTIES;
  const maxSchemaEnumValues = overrides.maxSchemaEnumValues || DEFAULT_MAX_SCHEMA_ENUM_VALUES;
  const schema = {};
  for (const key of ['type', 'nullable']) {
    if (value[key] !== undefined) schema[key] = value[key];
  }
  if (Array.isArray(value.enum)) schema.enum = value.enum.slice(0, maxSchemaEnumValues);
  if (typeof value.description === 'string' && value.description.trim()) {
    schema.description = shortenText(value.description, maxSchemaDescriptionChars).value;
  }
  if (value.items && typeof value.items === 'object') {
    const items = compactJsonSchema(value.items, depth + 1, overrides);
    if (items) schema.items = items;
  }
  if (value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)) {
    const properties = {};
    const names = Object.keys(value.properties);
    const requiredNames = Array.isArray(value.required)
      ? value.required.filter((name) => typeof name === 'string' && names.includes(name))
      : [];
    const optionalLimit = Math.max(0, maxSchemaProperties - requiredNames.length);
    const orderedNames = [
      ...requiredNames,
      ...names.filter((name) => !requiredNames.includes(name)).slice(0, optionalLimit),
    ];
    for (const name of orderedNames) {
      const property = value.properties[name];
      const compacted = compactJsonSchema(property, depth + 1, overrides);
      if (compacted) properties[name] = compacted;
    }
    if (Object.keys(properties).length) schema.properties = properties;
  }
  if (Array.isArray(value.required)) {
    const available = new Set(Object.keys(schema.properties || {}));
    const required = value.required.filter((name) => typeof name === 'string' && available.has(name));
    if (required.length) schema.required = required;
  }
  if (value.additionalProperties === false) schema.additionalProperties = false;
  return schema;
}

export function compactOpenAiTools(tools, overrides = {}) {
  const source = Array.isArray(tools) ? tools : [];
  const limits = {
    maxToolTokens: overrides.maxToolTokens || automniaRelayTokenOptimization.maxToolTokens,
    maxTools: overrides.maxTools || automniaRelayTokenOptimization.maxTools,
    maxToolDescriptionChars: overrides.maxToolDescriptionChars || DEFAULT_MAX_TOOL_DESCRIPTION_CHARS,
    maxSchemaDescriptionChars: overrides.maxSchemaDescriptionChars || DEFAULT_MAX_SCHEMA_DESCRIPTION_CHARS,
    maxSchemaProperties: overrides.maxSchemaProperties || DEFAULT_MAX_SCHEMA_PROPERTIES,
    maxSchemaEnumValues: overrides.maxSchemaEnumValues || DEFAULT_MAX_SCHEMA_ENUM_VALUES,
  };
  const requiredToolNames = new Set(
    (Array.isArray(overrides.requiredToolNames) ? overrides.requiredToolNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  );
  // Preserve core execution tools that the host already authorized. Budget
  // trimming must not silently turn an execution agent into a text-only one.
  for (const name of [
    'tool_search', 'tool_describe', 'tool_call', 'tool_search_code',
    'exec', 'process', 'read', 'write', 'edit', 'apply_patch',
    'browser', 'web_search', 'web_fetch', 'image', 'canvas',
    'automations', 'cron', 'session_status', 'sessions_list',
    'sessions_history', 'sessions_send', 'sessions_spawn', 'subagents',
    'agents_list', 'memory_search', 'memory_get', 'message',
    'ask_user', 'computer', 'terminal', 'gateway', 'openclaw',
    'nodes', 'mobile_ui', 'portal', 'secrets', 'skill_workshop',
    'conversations_send', 'conversations_turn', 'conversations_list',
    'sessions', 'sessions_search', 'sessions_yield', 'agents_wait',
    'create_goal', 'get_goal', 'update_goal', 'dashboard', 'progress_card', 'tts',
  ]) requiredToolNames.add(name);
  const candidates = source.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || tool.type !== 'function' || !tool.function || typeof tool.function !== 'object') return [];
    const name = String(tool.function.name || '').trim();
    if (!name) return [];
    const nextFunction = { name };
    if (typeof tool.function.description === 'string' && tool.function.description.trim()) {
      nextFunction.description = shortenText(tool.function.description, limits.maxToolDescriptionChars).value;
    }
    if (tool.function.parameters && typeof tool.function.parameters === 'object' && !Array.isArray(tool.function.parameters)) {
      const parameters = compactJsonSchema(tool.function.parameters, 0, limits);
      if (parameters && Object.keys(parameters).length) nextFunction.parameters = parameters;
    }
    return [{ type: 'function', function: nextFunction }];
  });
  const maxToolChars = Math.max(4_096, limits.maxToolTokens * 4);
  const compacted = [];
  let compactedChars = 2;
  for (const candidate of candidates) {
    const name = candidate.function.name;
    const required = requiredToolNames.has(name);
    if (compacted.length >= limits.maxTools && !required) continue;
    const candidateChars = JSON.stringify(candidate).length + (compacted.length ? 1 : 0);
    if (!required && compacted.length && compactedChars + candidateChars > maxToolChars) continue;
    compacted.push(candidate);
    compactedChars += candidateChars;
  }
  const originalChars = JSON.stringify(source).length;
  const serializedCompactedChars = JSON.stringify(compacted).length;
  return {
    tools: compacted,
    stats: {
      originalTools: source.length,
      sentTools: compacted.length,
      originalChars,
      compactedChars: serializedCompactedChars,
      estimatedToolTokens: estimateRelayTokens(compacted),
      droppedTools: Math.max(0, candidates.length - compacted.length),
      sentToolNames: compacted.map((tool) => tool.function.name),
      maxToolTokens: limits.maxToolTokens,
      changed: originalChars !== serializedCompactedChars,
    },
  };
}

export function resolveRelayOutputTokenBudget(body = {}, { maxAllowed = automniaRelayTokenOptimization.maxOutputTokens, hasTools = false } = {}) {
  const allowed = Math.max(512, Math.min(32_768, Number(maxAllowed) || automniaRelayTokenOptimization.maxOutputTokens));
  const requestedRaw = body?.max_tokens ?? body?.max_completion_tokens;
  const requested = Number(requestedRaw);
  if (Number.isFinite(requested) && requested > 0) {
    return { maxOutputTokens: Math.max(128, Math.min(allowed, Math.round(requested))), source: 'caller', explicit: true };
  }
  const effort = String(body?.reasoning_effort || body?.thinking || '').trim().toLowerCase();
  const base = hasTools ? automniaRelayTokenOptimization.toolOutputTokens : automniaRelayTokenOptimization.textOutputTokens;
  const effortBudget = effort === 'max' || effort === 'xhigh'
    ? Math.min(allowed, 8_192)
    : effort === 'high'
      ? Math.min(allowed, 6_144)
      : effort === 'medium'
        ? Math.min(allowed, 4_096)
        : base;
  return { maxOutputTokens: Math.max(128, Math.min(allowed, effortBudget)), source: 'automnia_auto', explicit: false };
}

export function relayOptimizationSummary(messageStats, toolStats, outputBudget) {
  return {
    version: AUTOMNIA_RELAY_TOKEN_OPTIMIZATION_VERSION,
    input: messageStats,
    tools: toolStats,
    output: outputBudget,
  };
}
