import test from 'node:test'
import assert from 'node:assert/strict'
import { createSseFrameParser } from '../src/utils/sseStream'

test('SSE parser handles split chunks, CRLF, multiline data, and flush', () => {
  const parser = createSseFrameParser()
  assert.deepEqual(parser.push('event: progress\r\ndata: first'), [])
  assert.deepEqual(parser.push('\r\ndata: second\r\n\r\n'), [{ event: 'progress', data: 'first\nsecond' }])
  assert.deepEqual(parser.push('data: final'), [])
  assert.deepEqual(parser.flush(), [{ event: 'message', data: 'final' }])
})
