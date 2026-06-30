import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPathUnder,
  createSafePathService,
  isInsidePath,
  isPathUnder,
  samePath,
} from '../server/services/filesystem/safePathService'

test('safe path service accepts exact paths and descendants', () => {
  assert.equal(isPathUnder('/workspace/project', '/workspace/project', { flavor: 'posix' }), true)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/file.txt', { flavor: 'posix' }), true)
  assert.equal(isInsidePath('/workspace/project', '/workspace/project/nested/file.txt', { flavor: 'posix' }), true)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/..safe/file.txt', { flavor: 'posix' }), true)
})

test('safe path service rejects traversal and sibling-prefix escapes', () => {
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/../outside.txt', { flavor: 'posix' }), false)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/nested/../../outside.txt', { flavor: 'posix' }), false)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project-other/file.txt', { flavor: 'posix' }), false)
  assert.equal(isInsidePath('/workspace/project', '/workspace/project/../../etc/passwd', { flavor: 'posix' }), false)
})

test('safe path service rejects multi-segment traversal attempts across POSIX and Windows paths', () => {
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/nested/../safe/file.txt', { flavor: 'posix' }), true)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/nested/../../../etc/passwd', { flavor: 'posix' }), false)
  assert.equal(isPathUnder('/workspace/project', '/workspace/project/..', { flavor: 'posix' }), false)
  assert.equal(isPathUnder('C:\\Users\\Operator\\Project', 'C:\\Users\\Operator\\Project\\nested\\..\\safe\\file.txt', { flavor: 'win32' }), true)
  assert.equal(isPathUnder('C:\\Users\\Operator\\Project', 'C:\\Users\\Operator\\Project\\nested\\..\\..\\Secrets\\file.txt', { flavor: 'win32' }), false)
  assert.equal(isPathUnder('C:\\Users\\Operator\\Project', 'D:\\Users\\Operator\\Project\\file.txt', { flavor: 'win32' }), false)
})

test('safe path service treats filesystem roots as containing descendants', () => {
  assert.equal(isPathUnder('/', '/tmp/upload.bin', { flavor: 'posix' }), true)
  assert.equal(isPathUnder('C:\\', 'C:\\Users\\operator\\file.txt', { flavor: 'win32' }), true)
})

test('safe path service compares Windows paths case-insensitively without allowing prefix siblings', () => {
  const service = createSafePathService({ flavor: 'win32' })
  assert.equal(service.samePath('C:\\Users\\Operator\\Project', 'c:\\users\\operator\\project'), true)
  assert.equal(service.isPathUnder('C:\\Users\\Operator\\Project', 'c:\\users\\operator\\project\\file.txt'), true)
  assert.equal(service.isPathUnder('C:\\Users\\Operator\\Project', 'c:\\users\\operator\\project-other\\file.txt'), false)
})

test('safe path assertion throws when the target escapes the approved root', () => {
  assert.equal(samePath('/workspace/project', '/workspace/project', { flavor: 'posix' }), true)
  assert.doesNotThrow(() => assertPathUnder('/workspace/project', '/workspace/project/file.txt', { flavor: 'posix' }))
  assert.throws(
    () => assertPathUnder('/workspace/project', '/workspace/project/../outside.txt', { flavor: 'posix' }),
    /outside the approved root/,
  )
})
