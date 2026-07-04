import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AVATAR_UPLOAD_LIMIT_BYTES,
  assertAvatarImageUploadSignature,
  assertAvatarUploadBytes,
  assertAvatarUploadSize,
  avatarUploadLimitErrorMessage,
  avatarUploadFileName,
  isSupportedAvatarImagePath,
  managedAvatarFileName,
} from '../server/services/filesystem/avatarFileService'

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
])
const WEBP_BYTES = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'binary')
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8')

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

test('avatar file service enforces avatar upload byte limits for persistence helpers', () => {
  assert.equal(AVATAR_UPLOAD_LIMIT_BYTES, 15 * 1024 * 1024)
  assert.equal(avatarUploadLimitErrorMessage(4), 'Choose an image smaller than 4 bytes.')
  assert.doesNotThrow(() => assertAvatarUploadBytes(Buffer.from('1234'), 4))
  assert.doesNotThrow(() => assertAvatarUploadSize(4, 4))
  assert.throws(() => assertAvatarUploadBytes(Buffer.from('12345'), 4), /Choose an image smaller than 4 bytes/)
  assert.throws(() => assertAvatarUploadSize(5, 4), /Choose an image smaller than 4 bytes/)
  assert.throws(() => assertAvatarUploadBytes(Buffer.alloc(0), 4), /Choose an image file to upload/)
})

test('avatar file service requires image signatures to match names and MIME types', () => {
  assert.doesNotThrow(() => assertAvatarImageUploadSignature(PNG_BYTES, 'portrait.png', 'image/png'))
  assert.doesNotThrow(() => assertAvatarImageUploadSignature(WEBP_BYTES, 'portrait.webp', 'image/webp'))
  assert.doesNotThrow(() => assertAvatarImageUploadSignature(SVG_BYTES, 'portrait.svg', 'image/svg+xml; charset=utf-8'))
  assert.throws(
    () => assertAvatarImageUploadSignature(Buffer.from('not an image', 'utf-8'), 'portrait.png', 'image/png'),
    /contents do not match/,
  )
  assert.throws(
    () => assertAvatarImageUploadSignature(PNG_BYTES, 'portrait.webp', 'image/webp'),
    /contents do not match/,
  )
  assert.throws(
    () => assertAvatarImageUploadSignature(PNG_BYTES, 'portrait.png', 'image/webp'),
    /does not match its extension/,
  )
})
