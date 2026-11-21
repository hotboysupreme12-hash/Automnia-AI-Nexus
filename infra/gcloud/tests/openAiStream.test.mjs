import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createOpenAiStreamEmitter } from '../service/openAiStream.js';

function responseStub() {
  const response = new EventEmitter();
  response.chunks = [];
  response.headers = {};
  response.writableEnded = false;
  response.destroyed = false;
  response.status = function status(value) { this.statusCode = value; return this; };
  response.set = function set(headers) { Object.assign(this.headers, headers); return this; };
  response.flushHeaders = function flushHeaders() { this.headersFlushed = true; };
  response.write = function write(chunk) { this.chunks.push(chunk); return true; };
  response.end = function end() { this.writableEnded = true; };
  return response;
}

test('OpenAI stream emits text immediately and completes with usage and buffered tool calls', async () => {
  const response = responseStub();
  const stream = createOpenAiStreamEmitter(response, { id: 'chatcmpl_test', created: 123, model: 'gemini-4-hydrogen' });

  await stream.textDelta('Hello', 'gemini-4-hydrogen');
  assert.equal(stream.started, true);
  assert.equal(response.headersFlushed, true);
  assert.equal(response.chunks.length, 2);
  assert.match(response.headers['Content-Type'], /text\/event-stream/);

  await stream.finish({
    model: 'gemini-4-hydrogen',
    choices: [{ finish_reason: 'tool_calls', message: { content: 'Hello', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"hi"}' } }] } }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    automnia: { remainingCredits: 5 },
  });

  const body = response.chunks.join('');
  assert.match(body, /"content":"Hello"/);
  assert.match(body, /"tool_calls"/);
  assert.match(body, /"finish_reason":"tool_calls"/);
  assert.match(body, /"usage":\{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6\}/);
  assert.match(body, /\[DONE\]/);
  assert.equal(response.writableEnded, true);
});

test('OpenAI stream respects backpressure before forwarding more output', async () => {
  const response = responseStub();
  let writes = 0;
  response.write = function write(chunk) {
    this.chunks.push(chunk);
    writes += 1;
    if (writes === 1) {
      setImmediate(() => this.emit('drain'));
      return false;
    }
    return true;
  };
  const stream = createOpenAiStreamEmitter(response, { id: 'chatcmpl_test', created: 123, model: 'gemini-4-hydrogen' });

  await stream.textDelta('A');
  assert.equal(response.chunks.length, 2);
  assert.match(response.chunks[1], /"content":"A"/);
});

test('OpenAI stream terminates with a structured error after partial text', async () => {
  const response = responseStub();
  const stream = createOpenAiStreamEmitter(response, { id: 'chatcmpl_test', created: 123, model: 'gemini-4-hydrogen' });
  await stream.textDelta('Partial');

  assert.equal(stream.fail({ publicMessage: 'Upstream disconnected', publicCode: 'upstream_error' }), true);
  const body = response.chunks.join('');
  assert.match(body, /"error":\{"message":"Upstream disconnected"/);
  assert.match(body, /\[DONE\]/);
  assert.equal(response.writableEnded, true);
});
