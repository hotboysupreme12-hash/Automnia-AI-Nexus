import assert from 'node:assert/strict'

import { createSseFrameParser } from '../src/utils/sseStream'

const parser = createSseFrameParser()
const frames = [
  ...parser.push(': connected\r\n\r\n'),
  ...parser.push('event: status\r\n'),
  ...parser.push('data: {"message":"accepted"}\r\n\r\n'),
  ...parser.push('event: delta\n'),
  ...parser.push('data: {"text":"Hel'),
  ...parser.push('lo"}\n\n'),
  ...parser.push('event: delta\n'),
  ...parser.push('data: {"text":"Replacement","replace":true}\n\n'),
  ...parser.push('event: final\n'),
  ...parser.push('data: {"ok":true'),
  ...parser.flush(),
]

assert.deepEqual(frames, [
  { event: 'status', data: '{"message":"accepted"}' },
  { event: 'delta', data: '{"text":"Hello"}' },
  { event: 'delta', data: '{"text":"Replacement","replace":true}' },
  { event: 'final', data: '{"ok":true' },
])

const multiLineParser = createSseFrameParser()
assert.deepEqual(multiLineParser.push('event: progress\ndata: line 1\ndata: line 2\n\n'), [
  { event: 'progress', data: 'line 1\nline 2' },
])

console.log('SSE parser smoke checks passed.')
