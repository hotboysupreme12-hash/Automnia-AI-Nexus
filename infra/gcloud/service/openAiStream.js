/** Create a backpressure-aware OpenAI-compatible SSE response. */
export function createOpenAiStreamEmitter(res, { id, created, model }) {
  let started = false;
  let finished = false;
  const write = async (payload) => {
    if (res.destroyed || res.writableEnded) throw new Error('The client closed the response stream.');
    if (res.write(`data: ${JSON.stringify(payload)}\n\n`)) return;
    await new Promise((resolve, reject) => {
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error('The client closed the response stream.')); };
      const cleanup = () => {
        res.off('drain', onDrain);
        res.off('close', onClose);
      };
      res.once('drain', onDrain);
      res.once('close', onClose);
    });
  };
  const start = async (actualModel = model) => {
    if (started) return;
    started = true;
    res.status(200);
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    await write({ id, object: 'chat.completion.chunk', created, model: actualModel, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  };
  return {
    get started() { return started; },
    async textDelta(delta, actualModel) {
      if (!delta) return;
      await start(actualModel);
      await write({ id, object: 'chat.completion.chunk', created, model: actualModel || model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
    },
    async finish(payload) {
      if (finished || res.destroyed || res.writableEnded) return;
      const choice = payload?.choices?.[0] || {};
      const message = choice.message || {};
      const responseModel = payload?.model || model;
      await start(responseModel);
      for (const [index, call] of (Array.isArray(message.tool_calls) ? message.tool_calls : []).entries()) {
        await write({ id, object: 'chat.completion.chunk', created, model: responseModel, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: 'function', function: call.function }] }, finish_reason: null }] });
      }
      await write({
        id,
        object: 'chat.completion.chunk',
        created,
        model: responseModel,
        choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || 'stop' }],
        ...(payload?.usage ? { usage: payload.usage } : {}),
        ...(payload?.automnia ? { automnia: payload.automnia } : {}),
      });
      res.write('data: [DONE]\n\n');
      finished = true;
      res.end();
    },
    fail(error) {
      if (!started || finished || res.destroyed || res.writableEnded) return false;
      const message = error?.publicMessage || error?.message || 'Automnia Cloud stream failed.';
      res.write(`data: ${JSON.stringify({ error: { message, type: error?.publicType || 'api_error', ...(error?.publicCode ? { code: error.publicCode } : {}) } })}\n\n`);
      res.write('data: [DONE]\n\n');
      finished = true;
      res.end();
      return true;
    },
  };
}
