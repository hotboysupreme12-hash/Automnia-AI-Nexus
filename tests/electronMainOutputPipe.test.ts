import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const electronMain = readFileSync(path.join(process.cwd(), 'electron', 'main.cjs'), 'utf8')

test('packaged main process tolerates closed inherited console pipes', () => {
  assert.match(electronMain, /function guardMainProcessOutputStream\(stream\)/)
  assert.match(electronMain, /error\?\.code === 'EPIPE'/)
  assert.match(electronMain, /guardMainProcessOutputStream\(process\.stdout\)/)
  assert.match(electronMain, /guardMainProcessOutputStream\(process\.stderr\)/)
})
