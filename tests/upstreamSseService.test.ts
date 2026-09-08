import assert from 'node:assert/strict'
import test from 'node:test'
import { readCompatibleSseCompletion, readUpstreamSse } from '../server/services/agents/upstreamSseService'

function responseWithChunks(chunks: string[], close = true) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      if (close) controller.close()
    },
    cancel() { cancelled = true },
  })
  return { response: new Response(body), body, cancelled: () => cancelled }
}

test('upstream DONE completes without waiting for an open connection and releases its reader', async () => {
  const fixture = responseWithChunks(['data: hello\n\ndata: [DONE]\n\n'], false)
  const frames: string[] = []
  await readUpstreamSse(fixture.response, ({ data }) => { frames.push(data) })
  assert.deepEqual(frames, ['hello'])
  assert.equal(fixture.cancelled(), true)
  assert.equal(fixture.body.locked, false)
})

test('frame handler failure cancels and unlocks the upstream body', async () => {
  const fixture = responseWithChunks(['data: hello\n\n'], false)
  await assert.rejects(readUpstreamSse(fixture.response, () => { throw new Error('handler failed') }), /handler failed/)
  assert.equal(fixture.cancelled(), true)
  assert.equal(fixture.body.locked, false)
})

test('frame budgets apply per frame even when many frames arrive in one chunk', async () => {
  const fixture = responseWithChunks(['data: 12345\n\ndata: 67890\n\n'])
  const frames: string[] = []
  await readUpstreamSse(fixture.response, ({ data }) => { frames.push(data) }, 8)
  assert.deepEqual(frames, ['12345', '67890'])
  assert.equal(fixture.body.locked, false)
})

test('an oversized unfinished frame fails and releases the stream', async () => {
  const fixture = responseWithChunks(['data: 123456789'], false)
  await assert.rejects(readUpstreamSse(fixture.response, () => undefined, 8), /exceeded 8/)
  assert.equal(fixture.cancelled(), true)
  assert.equal(fixture.body.locked, false)
})

test('CRLF, Unicode and a final frame without a blank line survive chunk boundaries', async () => {
  const fixture = responseWithChunks(['event: delta\r', '\ndata: hello 🌍\r\n', '\r\ndata: last'])
  const frames: unknown[] = []
  await readUpstreamSse(fixture.response, (frame) => { frames.push(frame) })
  assert.deepEqual(frames, [{ event: 'delta', data: 'hello 🌍' }, { event: undefined, data: 'last' }])
})

test('many small frames cannot exceed the cumulative stream safety budget', async () => {
  const fixture = responseWithChunks(Array.from({ length: 10 }, () => 'data: abc\n\n'), false)
  await assert.rejects(readUpstreamSse(fixture.response, () => undefined, 30, 40), /safety limit/)
  assert.equal(fixture.cancelled(), true)
})

test('compatible provider error frames fail instead of becoming empty successful answers', async () => {
  const fixture = responseWithChunks(['data: {"error":{"message":"Provider quota exceeded"}}\n\n'], false)
  await assert.rejects(readCompatibleSseCompletion(fixture.response, () => undefined), /quota exceeded/)
  assert.equal(fixture.cancelled(), true)
})

test('compatible provider requires completion and a visible answer', async () => {
  const partial = responseWithChunks(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])
  await assert.rejects(readCompatibleSseCompletion(partial.response, () => undefined), /before confirming completion/)
  const empty = responseWithChunks(['data: [DONE]\n\n'])
  await assert.rejects(readCompatibleSseCompletion(empty.response, () => undefined), /without an answer/)
})

test('compatible provider preserves valid streamed text and bounds combined reasoning/output', async () => {
  const valid = responseWithChunks([
    'data: {"choices":[{"delta":{"reasoning_content":"reason"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    'data: [DONE]\n\n',
  ], false)
  const emitted: string[] = []
  assert.deepEqual(await readCompatibleSseCompletion(valid.response, (text) => emitted.push(text)), { content: 'hello', reasoningContent: 'reason' })
  assert.deepEqual(emitted, ['hello'])
  const oversized = responseWithChunks(['data: {"choices":[{"delta":{"content":"hello","reasoning_content":"reason"}}]}\n\n'], false)
  await assert.rejects(readCompatibleSseCompletion(oversized.response, () => undefined, 8), /output limit/)
  assert.equal(oversized.cancelled(), true)
})
