import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  appendBoundedProcessOutput,
  runBoundedTextProcess,
} from '../server/services/process/boundedProcessService'

function fakeChild(pid = 4321): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
  })
  return child
}

test('bounded process output caps each stream including its truncation marker', async () => {
  const child = fakeChild()
  let spawnOptions: SpawnOptions | undefined
  const resultPromise = runBoundedTextProcess('fake-command', [], {
    platform: 'linux',
    maxOutputChars: 96,
    spawnProcess: (_command, _args, options) => {
      spawnOptions = options
      return child
    },
  })

  child.stdout?.write('s'.repeat(400))
  child.stderr?.write('e'.repeat(400))
  child.emit('close', 0)
  const result = await resultPromise

  assert.equal(result.code, 0)
  assert.equal(result.timedOut, false)
  assert.ok(result.stdout.length <= 96)
  assert.ok(result.stderr.length <= 96)
  assert.match(result.stdout, /Output truncated/u)
  assert.match(result.stderr, /Output truncated/u)
  assert.equal(spawnOptions?.detached, true)
  assert.deepEqual(spawnOptions?.stdio, ['ignore', 'pipe', 'pipe'])
})

test('bounded process runner marks a timeout and requests tree termination', async () => {
  const child = fakeChild(8765)
  const terminated: Array<{ pid: number | undefined; reason: string | undefined; force: boolean | undefined }> = []
  const result = await runBoundedTextProcess('slow-command', [], {
    platform: 'win32',
    timeoutMs: 10,
    spawnProcess: () => child,
    terminateProcessTree: async (pid, reason, force) => {
      terminated.push({ pid, reason, force })
    },
  })

  assert.equal(result.timedOut, true)
  assert.equal(result.failureKind, 'timeout')
  assert.equal(result.code, null)
  assert.deepEqual(terminated, [{ pid: 8765, reason: 'slow-command helper timeout', force: true }])
})

test('bounded process runner distinguishes spawn errors from command exit codes', async () => {
  const spawnErrorChild = fakeChild()
  const spawnErrorPromise = runBoundedTextProcess('missing-command', [], {
    platform: 'win32',
    spawnProcess: () => spawnErrorChild,
  })
  const spawnOptions: SpawnOptions[] = []
  const windowsChild = fakeChild()
  const windowsResultPromise = runBoundedTextProcess('windows-command', [], {
    platform: 'win32',
    spawnProcess: (_command, _args, options) => {
      spawnOptions.push(options)
      return windowsChild
    },
  })

  spawnErrorChild.emit('error', Object.assign(new Error('not executable'), { code: 'EACCES' }))
  windowsChild.emit('close', 23)
  const [spawnError, windowsResult] = await Promise.all([spawnErrorPromise, windowsResultPromise])

  assert.equal(spawnError.failureKind, 'process_error')
  assert.equal(spawnError.code, 1)
  assert.equal(spawnError.timedOut, false)
  assert.equal(windowsResult.failureKind, undefined)
  assert.equal(windowsResult.code, 23)
  assert.equal(spawnOptions[0].detached, false)
  assert.equal(spawnOptions[0].windowsHide, true)
})

test('appendBoundedProcessOutput stays within the configured limit', () => {
  const result = appendBoundedProcessOutput('prefix', 'x'.repeat(200), 80)
  assert.equal(result.length, 80)
  assert.match(result, /Output truncated/u)
})
