const test = require('node:test')
const assert = require('node:assert/strict')
const { createMicrophonePermissions } = require('../electron/microphone-permissions.cjs')

test('macOS requests the native permission once for overlapping recording requests', async () => {
  let prompts = 0
  let finish
  const access = createMicrophonePermissions({ platform: 'darwin', shell: {}, systemPreferences: {
    getMediaAccessStatus: () => 'not-determined',
    askForMediaAccess: (type) => { assert.equal(type, 'microphone'); prompts++; return new Promise((resolve) => { finish = resolve }) },
  } })
  const first = access.request()
  const second = access.request()
  assert.equal(prompts, 1)
  finish(true)
  assert.deepEqual(await first, { status: 'granted', platform: 'darwin' })
  assert.deepEqual(await second, await first)
})

test('denied and managed macOS permissions do not repeatedly prompt', async () => {
  for (const state of ['denied', 'restricted', 'granted']) {
    const access = createMicrophonePermissions({ platform: 'darwin', shell: {}, systemPreferences: {
      getMediaAccessStatus: () => state,
      askForMediaAccess: () => { throw new Error('Unexpected prompt') },
    } })
    assert.equal((await access.request()).status, state)
  }
})

test('Windows uses its permission status; Linux lets Chromium request access', async () => {
  for (const platform of ['win32', 'linux']) {
    const access = createMicrophonePermissions({ platform, shell: {}, systemPreferences: {
      getMediaAccessStatus: () => 'denied',
      askForMediaAccess: () => { throw new Error('macOS API used on another OS') },
    } })
    assert.equal((await access.request()).status, platform === 'win32' ? 'denied' : 'unknown')
  }
})

test('permission recovery opens only fixed platform settings destinations', async () => {
  for (const [platform, expected] of [['darwin', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], ['win32', 'ms-settings:privacy-microphone'], ['linux', null]]) {
    let actual = null
    const access = createMicrophonePermissions({ platform, systemPreferences: {}, shell: { openExternal: async (url) => { actual = url } } })
    assert.equal(await access.openSettings(), expected !== null)
    assert.equal(actual, expected)
  }
})
