import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const electronMain = readFileSync(path.join(process.cwd(), 'electron', 'main.cjs'), 'utf8')

test('packaged main process tolerates closed inherited console pipes', () => {
  assert.match(electronMain, /function guardMainProcessOutputStream\(stream\)/)
  assert.match(electronMain, /stream\.on\('error', \(\) => \{[\s\S]*keep the[\s\S]*desktop process alive/)
  assert.doesNotMatch(electronMain, /setImmediate\(\(\) => \{ throw error \}\)/)
  assert.match(electronMain, /guardMainProcessOutputStream\(process\.stdout\)/)
  assert.match(electronMain, /guardMainProcessOutputStream\(process\.stderr\)/)
})

test('Windows desktop keeps hardware acceleration by default with an explicit safe-renderer opt-in', () => {
  assert.match(electronMain, /const WINDOWS_DISABLE_GPU = process\.platform === 'win32'/)
  assert.match(electronMain, /AUTOMNIA_WINDOWS_DISABLE_GPU === '1'/)
  assert.match(electronMain, /AUTOMNIA_WINDOWS_SAFE_RENDERER === '1'/)
  assert.match(electronMain, /AUTOMNIA_WINDOWS_FORCE_GPU !== '1'/)
  assert.match(electronMain, /app\.disableHardwareAcceleration\(\)/)
})

test('Windows desktop records and recovers from an unexpected GPU child-process failure', () => {
  assert.match(electronMain, /desktop-lifecycle\.jsonl/)
  assert.match(electronMain, /app\.on\('child-process-gone'/)
  assert.match(electronMain, /diagnostic\.type === 'GPU'/)
  assert.match(electronMain, /writeWindowsGpuRecoveryState\(diagnostic\)/)
  assert.match(electronMain, /app\.relaunch\(\{ args: process\.argv\.slice\(1\) \}\)/)
  assert.match(electronMain, /renderer-process-gone/)
})
