// Keep the hosted request small enough that a tool turn cannot silently turn
// into a six-figure prompt. These are request-shaping budgets, not estimates
// used for billing; the relay still debits Vertex's authoritative usage.
const DEFAULT_MAX_INPUT_TOKENS = 8_192;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_TEXT_OUTPUT_TOKENS = 1_536;
const DEFAULT_TOOL_OUTPUT_TOKENS = 3_072;
const DEFAULT_MAX_SYSTEM_CHARS = 6_000;
const DEFAULT_MAX_MESSAGE_CHARS = 12_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 6_000;
const DEFAULT_MAX_HISTORY_MESSAGES = 8;
const DEFAULT_MAX_INLINE_IMAGES = 1;
const DEFAULT_MAX_INLINE_IMAGE_CHARS = 400_000;
const DEFAULT_MAX_TOOL_TOKENS = 4_096;
const DEFAULT_MAX_TOOLS = 32;
const DEFAULT_MAX_TOOL_DESCRIPTION_CHARS = 180;
const DEFAULT_MAX_SCHEMA_DESCRIPTION_CHARS = 120;
const DEFAULT_MAX_SCHEMA_PROPERTIES = 24;
const DEFAULT_MAX_SCHEMA_ENUM_VALUES = 16;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function environmentInteger(name, fallback, minimum, maximum) {
  return boundedInteger(process.env[name], fallback, minimum, maximum);
}

export const AUTOMNIA_RELAY_TOKEN_OPTIMIZATION_VERSION = '2026-08-20.2';

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
  maxInlineImages: environmentInteger('AUTOMNIA_RELAY_MAX_INLINE_IMAGES', DEFAULT_MAX_INLINE_IMAGES, 0, 8),
  maxInlineImageChars: environmentInteger('AUTOMNIA_RELAY_MAX_INLINE_IMAGE_CHARS', DEFAULT_MAX_INLINE_IMAGE_CHARS, 100_000, 4_000_000),
});

export function estimateRelayTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
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

function compactContent(content, maxChars, imageState, marker, maxInlineImageChars) {
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
    const isImage = Boolean(part.image_url || part.source?.type === 'base64' || part.type === 'input_image');
    if (isImage) {
      const imageChars = typeof part.source?.data === 'string'
        ? part.source.data.length
        : typeof part.data === 'string'
          ? part.data.length
          : typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:')
            ? part.image_url.url.length
            : 0;
      if (imageChars > maxInlineImageChars) {
        truncated = true;
        imageState.dropped += 1;
        imageState.oversized += 1;
        value.push({ type: 'text', text: '[large inline image omitted to conserve Automnia credits; attach a smaller image if it is required]' });
        continue;
      }
      if (imageState.count >= imageState.limit) {
        truncated = true;
        imageState.dropped += 1;
        continue;
      }
      imageState.count += 1;
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

function compactMessage(message, imageState, limits) {
  const role = messageRole(message);
  const maxChars = role === 'system'
    ? limits.maxSystemChars
    : role === 'tool'
      ? limits.maxToolResultChars
      : limits.maxMessageChars;
  const marker = role === 'tool'
    ? '[tool output shortened to conserve Automnia credits]'
    : '[conversation context shortened to conserve Automnia credits]';
  const content = compactContent(message?.content, maxChars, imageState, marker, limits.maxInlineImageChars);
  return {
    value: {
      ...message,
      role,
      ...(content.value === undefined ? {} : { content: content.value }),
    },
    truncated: content.truncated,
  };
}

function messageSize(message) {
  return JSON.stringify(message ?? '').length;
}

function preserveToolCallContext(messages, allConversationMessages) {
  const toolCallIds = new Set(
    messages
      .filter((message) => messageRole(message) === 'tool')
      .map((message) => String(message?.tool_call_id || '').trim())
      .filter(Boolean),
  );
  if (!toolCallIds.size) return messages;
  const existingCallIds = new Set(
    messages
      .flatMap((message) => Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .map((call) => String(call?.id || '').trim())
      .filter(Boolean),
  );
  const missing = new Set([...toolCallIds].filter((id) => !existingCallIds.has(id)));
  if (!missing.size) return messages;
  const predecessors = allConversationMessages.filter((message) => {
    if (messageRole(message) !== 'assistant' || !Array.isArray(message?.tool_calls)) return false;
    return message.tool_calls.some((call) => missing.has(String(call?.id || '').trim()));
  });
  return [...predecessors.slice(-2), ...messages];
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
  };
  const source = Array.isArray(messages) ? messages.filter((message) => message && typeof message === 'object') : [];
  const systemMessages = source.filter((message) => ['system', 'developer'].includes(messageRole(message)));
  const conversationMessages = source.filter((message) => !['system', 'developer'].includes(messageRole(message)));
  const imageState = { count: 0, dropped: 0, oversized: 0, limit: limits.maxInlineImages };
  let truncatedMessages = 0;

  const compactedSystem = systemMessages.length
    ? [{
        role: 'system',
        content: systemMessages.map((message) => {
          const compacted = compactMessage(message, imageState, limits);
          truncatedMessages += Number(compacted.truncated);
          return typeof compacted.value.content === 'string' ? compacted.value.content : JSON.stringify(compacted.value.content || '');
        }).filter(Boolean).join('\n\n'),
      }]
    : [];
  let conversation = conversationMessages
    .slice(-limits.maxHistoryMessages)
    .map((message) => {
      const compacted = compactMessage(message, imageState, limits);
      truncatedMessages += Number(compacted.truncated);
      return compacted.value;
    });
  conversation = preserveToolCallContext(conversation, conversationMessages);
  let compacted = [...compactedSystem, ...conversation];
  const originalChars = JSON.stringify(source).length;
  let removedMessages = Math.max(0, conversationMessages.length - conversation.length);

  const inputLimitChars = Math.max(8_000, limits.maxInputTokens * 4);
  while (JSON.stringify(compacted).length > inputLimitChars && conversation.length > 2) {
    const removableIndex = conversation.findIndex((message, index) => index < conversation.length - 4 && messageRole(message) !== 'tool');
    const index = removableIndex >= 0 ? removableIndex : 0;
    conversation.splice(index, 1);
    removedMessages += 1;
    compacted = [...compactedSystem, ...conversation];
  }

  if (JSON.stringify(compacted).length > inputLimitChars) {
    const largestIndex = conversation.reduce((largest, message, index, list) => (
      messageSize(message) > messageSize(list[largest]) ? index : largest
    ), 0);
    const largest = conversation[largestIndex];
    if (largest) {
      const currentContent = typeof largest.content === 'string' ? largest.content : JSON.stringify(largest.content || '');
      const shortened = shortenText(currentContent, Math.max(1_024, Math.floor(limits.maxMessageChars / 2)), '[current context shortened to fit the hosted credit budget]');
      if (shortened.truncated) {
        conversation[largestIndex] = { ...largest, content: shortened.value };
        truncatedMessages += 1;
        compacted = [...compactedSystem, ...conversation];
      }
    }
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

function compactJsonSchema(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12) return undefined;
  const schema = {};
  for (const key of ['type', 'nullable']) {
    if (value[key] !== undefined) schema[key] = value[key];
  }
  if (Array.isArray(value.enum)) schema.enum = value.enum.slice(0, DEFAULT_MAX_SCHEMA_ENUM_VALUES);
  if (typeof value.description === 'string' && value.description.trim()) {
    schema.description = shortenText(value.description, DEFAULT_MAX_SCHEMA_DESCRIPTION_CHARS).value;
  }
  if (value.items && typeof value.items === 'object') {
    const items = compactJsonSchema(value.items, depth + 1);
    if (items) schema.items = items;
  }
  if (value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)) {
    const properties = {};
    const names = Object.keys(value.properties);
    const requiredNames = Array.isArray(value.required)
      ? value.required.filter((name) => typeof name === 'string' && names.includes(name))
      : [];
    const orderedNames = [
      ...requiredNames,
      ...names.filter((name) => !requiredNames.includes(name)),
    ].slice(0, DEFAULT_MAX_SCHEMA_PROPERTIES);
    for (const name of orderedNames) {
      const property = value.properties[name];
      const compacted = compactJsonSchema(property, depth + 1);
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
  };
  const requiredToolNames = new Set(
    (Array.isArray(overrides.requiredToolNames) ? overrides.requiredToolNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  );
  const candidates = source.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || tool.type !== 'function' || !tool.function || typeof tool.function !== 'object') return [];
    const name = String(tool.function.name || '').trim();
    if (!name) return [];
    const nextFunction = { name };
    if (typeof tool.function.description === 'string' && tool.function.description.trim()) {
      nextFunction.description = shortenText(tool.function.description, DEFAULT_MAX_TOOL_DESCRIPTION_CHARS).value;
    }
    if (tool.function.parameters && typeof tool.function.parameters === 'object' && !Array.isArray(tool.function.parameters)) {
      const parameters = compactJsonSchema(tool.function.parameters);
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
