import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVertexGenerateContentStream } from '../service/vertexStream.js';

function readableFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

test('Vertex SSE parser forwards split text deltas and reconstructs usage and finish metadata', async () => {
  const events = [
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]}}]}\r\n\r\n',
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\r\n\r\n',
  ];
  const wire = events.join('');
  const chunks = [wire.slice(0, 19), wire.slice(19, 74), wire.slice(74)];
  const deltas = [];
  const result = await collectVertexGenerateContentStream(readableFromChunks(chunks), (delta) => deltas.push(delta));

  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.deepEqual(result.candidates[0].content, { role: 'model', parts: [{ text: 'Hello' }] });
  assert.equal(result.candidates[0].finishReason, 'STOP');
  assert.deepEqual(result.usageMetadata, { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 });
});

test('Vertex SSE parser never forwards thought text and buffers tool arguments to completion', async () => {
  const wire = [
    'data: {"candidates":[{"content":{"parts":[{"text":"private thought","thought":true},{"text":"Visible"},{"functionCall":{"name":"search","args":{"query":"hel"}}}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"still private","thought":true},{"text":" answer"},{"functionCall":{"name":"search","args":{"query":"hello"}}}]},"finishReason":"STOP"}]}\n\n',
  ].join('');
  const deltas = [];
  const result = await collectVertexGenerateContentStream(readableFromChunks([wire]), (delta) => deltas.push(delta));

  assert.deepEqual(deltas, ['Visible', ' answer']);
  assert.deepEqual(result.candidates[0].content.parts, [
    { text: 'Visible answer' },
    { functionCall: { name: 'search', args: { query: 'hello' } } },
  ]);
});

test('Vertex SSE parser preserves structured upstream errors', async () => {
  const stream = readableFromChunks(['data: {"error":{"code":403,"message":"Model access denied"}}\n\n']);
  await assert.rejects(collectVertexGenerateContentStream(stream), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /Model access denied/);
    return true;
  });
});
