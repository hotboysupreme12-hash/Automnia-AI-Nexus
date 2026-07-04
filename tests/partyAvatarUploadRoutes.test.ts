import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express, { type Express } from 'express'

import type { PartyManagementRoutesContext } from '../server/controlPlane'
import { registerPartyManagementRoutes } from '../server/routes/partyManagementRoutes'
import {
  AVATAR_UPLOAD_LIMIT_BYTES,
  assertAvatarImageUploadSignature,
  assertAvatarUploadBytes,
  avatarUploadLimitErrorMessage,
  avatarUploadFileName,
} from '../server/services/filesystem/avatarFileService'

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
])
const WEBP_BYTES = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'binary')
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8')

function createAvatarUploadHarness(options: { uploadLimitBytes?: number } = {}) {
  const calls: Array<{ agentId: string; sourceName: string; size: number }> = []
  const app = express()
  registerPartyManagementRoutes(app, {
    WORKSPACE_ROOT: process.cwd(),
    assertAvatarImageUploadSignature,
    assertAvatarUploadBytes,
    avatarUploadLimitBytes: options.uploadLimitBytes ?? AVATAR_UPLOAD_LIMIT_BYTES,
    avatarUploadLimitErrorMessage,
    avatarUploadFileName,
    isValidAgentId: (agentId: string) => /^[a-z0-9-]{3,60}$/.test(agentId),
    persistAgentAvatarBytes: async (agentId: string, bytes: Buffer, sourceName: string) => {
      calls.push({ agentId, sourceName, size: bytes.length })
      return {
        agentId,
        avatar: `.openclaw/avatars/${sourceName}`,
        avatarPath: `/workspace/.openclaw/avatars/${sourceName}`,
        previewUrl: `/api/party/avatar/${agentId}?v=1`,
      }
    },
  } as unknown as PartyManagementRoutesContext)
  return { app, calls }
}

async function withRouteServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

test('avatar upload route rejects unsupported file types before persistence', async () => {
  const { app, calls } = createAvatarUploadHarness()

  await withRouteServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=payload.exe`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.from('not an avatar', 'utf-8'),
    })
    const text = await response.text()

    assert.equal(response.status, 400)
    assert.doesNotMatch(text, /not an avatar/)
    const payload = JSON.parse(text) as { ok: boolean; error: { code: string; detail?: string } }
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'avatar_upload_failed')
    assert.match(payload.error.detail || '', /Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image/)
  })

  assert.deepEqual(calls, [])
})

test('avatar upload route accepts supported MIME fallback for extensionless images', async () => {
  const { app, calls } = createAvatarUploadHarness()

  await withRouteServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: WEBP_BYTES,
    })
    const payload = await response.json() as {
      ok: boolean
      data: { avatar: string; path: string; previewUrl: string; status: string }
    }

    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.data.status, 'selected')
    assert.equal(payload.data.avatar, '.openclaw/avatars/portrait.webp')
    assert.equal(payload.data.path, '/workspace/.openclaw/avatars/portrait.webp')
    assert.equal(payload.data.previewUrl, '/api/party/avatar/agent-1?v=1')
  })

  assert.deepEqual(calls, [{ agentId: 'agent-1', sourceName: 'portrait.webp', size: WEBP_BYTES.length }])
})

test('avatar upload route rejects misleading MIME and image bytes before persistence', async () => {
  const { app, calls } = createAvatarUploadHarness()

  await withRouteServer(app, async (baseUrl) => {
    const invalidBytes = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: Buffer.from('not a webp image', 'utf-8'),
    })
    const invalidPayload = await invalidBytes.json() as { ok: boolean; error: { code: string; detail?: string } }
    assert.equal(invalidBytes.status, 400)
    assert.equal(invalidPayload.ok, false)
    assert.equal(invalidPayload.error.code, 'avatar_upload_failed')
    assert.match(invalidPayload.error.detail || '', /contents do not match/)

    const mismatchedMime = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=portrait.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: PNG_BYTES,
    })
    const mismatchPayload = await mismatchedMime.json() as { ok: boolean; error: { code: string; detail?: string } }
    assert.equal(mismatchedMime.status, 400)
    assert.equal(mismatchPayload.ok, false)
    assert.equal(mismatchPayload.error.code, 'avatar_upload_failed')
    assert.match(mismatchPayload.error.detail || '', /does not match its extension/)
  })

  assert.deepEqual(calls, [])
})

test('avatar upload route enforces byte limits before avatar persistence', async () => {
  const { app, calls } = createAvatarUploadHarness({ uploadLimitBytes: SVG_BYTES.length })

  await withRouteServer(app, async (baseUrl) => {
    const exactLimit = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=limit.svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: SVG_BYTES,
    })
    assert.equal(exactLimit.status, 200)

    const tooLarge = await fetch(`${baseUrl}/api/party/avatar-upload/agent-1?filename=too-large.svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: Buffer.concat([SVG_BYTES, Buffer.from('x')]),
    })
    const payload = await tooLarge.json() as { ok: boolean; error: { code: string; detail?: string } }

    assert.equal(tooLarge.status, 413)
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'avatar_upload_failed')
    assert.match(payload.error.detail || '', new RegExp(`Choose an image smaller than ${SVG_BYTES.length} bytes`))
  })

  assert.deepEqual(calls, [{ agentId: 'agent-1', sourceName: 'limit.svg', size: SVG_BYTES.length }])
})
