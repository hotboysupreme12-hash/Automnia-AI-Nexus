function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function vertexStreamError(payload) {
  const errorPayload = isRecord(payload?.error) ? payload.error : payload;
  const message = typeof errorPayload?.message === 'string' && errorPayload.message.trim()
    ? errorPayload.message.trim()
    : 'Vertex AI streaming response failed.';
  const error = new Error(message);
  const status = Number(errorPayload?.code || errorPayload?.statusCode);
  if (Number.isFinite(status) && status >= 400 && status <= 599) error.status = status;
  return error;
}

function readSseData(eventText) {
  const lines = eventText.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return null;
  return JSON.parse(data);
}

/**
 * Consume Vertex's `alt=sse` GenerateContent stream into one normal response
 * while forwarding only user-visible text deltas. Tool calls remain buffered
 * until the final candidate so OpenClaw never sees partial tool arguments.
 */
export async function collectVertexGenerateContentStream(body, onTextDelta = () => undefined) {
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Vertex AI returned no streaming response body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const textByPart = new Map();
  const otherParts = new Map();
  const functionCalls = new Map();
  let candidate = null;
  let usageMetadata;
  let promptFeedback;
  let modelVersion;
  let buffer = '';

  async function consumePayload(payload) {
    if (!isRecord(payload)) return;
    if (payload.error) throw vertexStreamError(payload);
    if (isRecord(payload.usageMetadata)) usageMetadata = payload.usageMetadata;
    if (isRecord(payload.promptFeedback)) promptFeedback = payload.promptFeedback;
    if (typeof payload.modelVersion === 'string') modelVersion = payload.modelVersion;
    const incomingCandidate = Array.isArray(payload.candidates) && isRecord(payload.candidates[0])
      ? payload.candidates[0]
      : null;
    if (!incomingCandidate) return;
    candidate = { ...(candidate || {}), ...incomingCandidate };
    const content = isRecord(incomingCandidate.content) ? incomingCandidate.content : null;
    if (!content || !Array.isArray(content.parts)) return;
    if (typeof content.role === 'string') candidate.contentRole = content.role;

    for (const [partIndex, part] of content.parts.entries()) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string') {
        // Gemini streams text as deltas. Thought parts are intentionally kept
        // out of both the OpenAI stream and the reconstructed user transcript.
        if (part.thought === true) continue;
        textByPart.set(partIndex, (textByPart.get(partIndex) || '') + part.text);
        if (part.text) await onTextDelta(part.text);
        continue;
      }

      if (isRecord(part.functionCall)) {
        const previous = functionCalls.get(partIndex) || { args: {} };
        const call = part.functionCall;
        const args = isRecord(call.args) ? call.args : {};
        functionCalls.set(partIndex, {
          name: typeof call.name === 'string' ? call.name : previous.name,
          args: { ...previous.args, ...args },
          thoughtSignature: typeof part.thoughtSignature === 'string' && part.thoughtSignature.trim()
            ? part.thoughtSignature.trim()
            : previous.thoughtSignature,
        });
        continue;
      }

      otherParts.set(partIndex, part);
    }
  }

  async function consumeEvent(eventText) {
    const payload = readSseData(eventText);
    if (payload) await consumePayload(payload);
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const eventText of events) await consumeEvent(eventText);
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consumeEvent(buffer);
  } finally {
    reader.releaseLock?.();
  }

  if (!candidate) throw new Error('Vertex AI stream ended without an assistant candidate.');
  const parts = [];
  const partIndexes = new Set([...textByPart.keys(), ...otherParts.keys(), ...functionCalls.keys()]);
  for (const partIndex of [...partIndexes].sort((left, right) => left - right)) {
    if (textByPart.has(partIndex)) parts.push({ text: textByPart.get(partIndex) });
    else if (functionCalls.has(partIndex)) {
      const call = functionCalls.get(partIndex);
      parts.push({
        functionCall: { name: call.name, args: call.args },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
      });
    } else if (otherParts.has(partIndex)) parts.push(otherParts.get(partIndex));
  }

  const { content: _incomingContent, contentRole: role, ...candidateFields } = candidate;
  return {
    ...(promptFeedback ? { promptFeedback } : {}),
    ...(modelVersion ? { modelVersion } : {}),
    candidates: [{
      ...candidateFields,
      content: { role: role || 'model', parts },
    }],
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}
