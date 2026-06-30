import assert from 'node:assert/strict'
import test from 'node:test'

import {
  avatarUploadFileName,
  isSupportedAvatarImagePath,
  managedAvatarFileName,
} from '../server/services/filesystem/avatarFileService'

test('avatar file service accepts supported extensions and MIME fallbacks', () => {
  assert.equal(isSupportedAvatarImagePath('portrait.WEBP'), true)
  assert.equal(isSupportedAvatarImagePath('notes.txt'), false)
  assert.equal(avatarUploadFileName('Hero Portrait.PNG', 'application/octet-stream'), 'Hero Portrait.png')
  assert.equal(avatarUploadFileName('avatar', 'image/svg+xml; charset=utf-8'), 'avatar.svg')
  assert.equal(avatarUploadFileName('', 'image/jpeg'), 'avatar.jpg')
})

test('avatar file service rejects unsupported explicit extensions before MIME fallback', () => {
  assert.throws(
    () => avatarUploadFileName('payload.exe', 'image/png'),
    /Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image/,
  )
  assert.throws(
    () => avatarUploadFileName('payload', 'application/octet-stream'),
    /Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image/,
  )
})

test('avatar file service builds managed avatar names with sanitized stems', () => {
  assert.equal(
    managedAvatarFileName('agent-1', 'My Portrait!!.WEBP', {
      now: () => 1_234,
      randomHex: () => 'deadbeef',
    }),
    'agent-1-my-portrait-ya-deadbeef.webp',
  )
})
