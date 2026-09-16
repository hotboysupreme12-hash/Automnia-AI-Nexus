const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAppUpdater, fetchBoundedText } = require('../electron/app-updater.cjs')
const { manifestBytes } = require('../electron/update-policy.cjs')

class FakeAutoUpdater extends EventEmitter {
  constructor(downloadedFile) {
    super()
    this.downloadedFile = downloadedFile
    this.downloadCalls = 0
    this.installCalls = 0
  }

  setFeedURL(value) { this.feed = value }
  async checkForUpdates() {
    this.emit('update-available', { version: '1.1.0', files: [{ url: 'Automnia-Setup-1.1.0-x64.exe' }] })
    return { updateInfo: { version: '1.1.0' } }
  }
  async downloadUpdate() {
    this.downloadCalls += 1
    this.emit('download-progress', { percent: 55, bytesPerSecond: 100, transferred: 11, total: 20 })
    this.emit('update-downloaded', { downloadedFile: this.downloadedFile, version: '1.1.0' })
    return [this.downloadedFile]
  }
  quitAndInstall() { this.installCalls += 1 }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for updater state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('desktop updater checks, downloads, independently verifies, and installs end to end', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-app-updater-'))
  try {
    const payload = Buffer.from('verified installer payload')
    const downloadedFile = path.join(temp, 'Automnia-Setup-1.1.0-x64.exe')
    fs.writeFileSync(downloadedFile, payload)
    const digest = crypto.createHash('sha256').update(payload).digest('hex')
    const manifest = {
      schema: 1,
      product: 'Automnia AI Nexus',
      version: '1.1.0',
      channel: 'stable',
      generatedAt: new Date().toISOString(),
      minimumVersion: '1.0.0',
      rolloutPercentage: 100,
      artifacts: [{ platform: 'windows', arch: 'x64', file: path.basename(downloadedFile), size: payload.length, sha256: digest }],
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const publicKeyPath = path.join(temp, 'update-public-key.pem')
    fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
    const text = manifestBytes(manifest).toString('utf8')
    const signature = crypto.sign(null, Buffer.from(text), privateKey).toString('base64')
    const fake = new FakeAutoUpdater(downloadedFile)
    let cleanupCalls = 0
    const manager = createAppUpdater({
      app: { getVersion: () => '1.0.0' },
      autoUpdater: fake,
      fetch: async (url) => new Response(String(url).includes('.sig') ? signature : text, { status: 200 }),
      baseUrl: 'https://updates.automnia.app/stable',
      channel: 'stable',
      publicKeyPath,
      userDataPath: path.join(temp, 'user-data'),
      tempPath: temp,
      platform: 'win32',
      arch: 'x64',
      isAppImage: false,
      isPackaged: true,
      initialDelayMs: 60_000,
      checkIntervalMs: 60_000,
      beforeInstall: async () => { cleanupCalls += 1 },
    })
    manager.start()
    await manager.check({ userInitiated: true })
    await waitFor(() => manager.getState().status === 'ready')
    assert.equal(fake.downloadCalls, 1)
    assert.equal(manager.getState().progressPercent, 100)
    await manager.install()
    assert.equal(cleanupCalls, 1)
    assert.equal(fake.installCalls, 1)
    assert.equal(manager.getState().status, 'installing')
    manager.stop()
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('development builds report the production-only boundary before missing-key details', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-app-updater-dev-'))
  try {
    const manager = createAppUpdater({
      app: { getVersion: () => '1.0.0' },
      autoUpdater: new FakeAutoUpdater(path.join(temp, 'unused-update.exe')),
      fetch: async () => new Response('{}', { status: 200 }),
      baseUrl: 'https://updates.automnia.app/stable',
      channel: 'stable',
      publicKeyPath: path.join(temp, 'missing-update-public-key.pem'),
      userDataPath: path.join(temp, 'user-data'),
      tempPath: temp,
      platform: 'win32',
      arch: 'x64',
      isAppImage: false,
      isPackaged: false,
      initialDelayMs: 60_000,
      checkIntervalMs: 60_000,
    })
    assert.equal(manager.getState().status, 'disabled')
    assert.equal(manager.getState().supported, false)
    assert.equal(manager.getState().error, 'Automatic updates are available in installed production builds.')
    manager.stop()
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('bounded update fetch stops reading an oversized chunked response', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(700))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = new Response(body, { status: 200 })
  await assert.rejects(
    fetchBoundedText(async () => response, 'https://updates.automnia.app/stable/update-manifest.json', 1_024, 'https://updates.automnia.app'),
    /size limit/,
  )
  assert.equal(cancelled, true)
})
