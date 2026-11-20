import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { telegramRuntimeRepairFiles } from '../server/services/plugins/telegramRuntimeRepairFiles'

test('finds both Telegram bundle shapes only in the active managed runtime', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'automnia-telegram-repair-'))
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }))
  const managed = path.join(temporaryRoot, 'managed')
  const bundled = path.join(temporaryRoot, 'Program Files', 'resources', 'openclaw')
  await Promise.all([fs.mkdir(path.join(managed, 'dist'), { recursive: true }), fs.mkdir(path.join(bundled, 'dist'), { recursive: true })])
  await Promise.all([
    fs.writeFile(path.join(managed, 'dist', 'bot-message-active.mjs'), 'active'),
    fs.writeFile(path.join(managed, 'dist', 'telegram-ingress.mjs'), 'active'),
    fs.writeFile(path.join(managed, 'dist', 'unrelated.mjs'), 'ignore'),
    fs.writeFile(path.join(bundled, 'dist', 'bot-message-protected.mjs'), 'protected'),
  ])

  assert.deepEqual((await telegramRuntimeRepairFiles(managed)).map((file) => path.basename(file)).sort(), [
    'bot-message-active.mjs', 'telegram-ingress.mjs',
  ])
  assert.deepEqual(await telegramRuntimeRepairFiles(''), [])
  assert.equal(await fs.readFile(path.join(bundled, 'dist', 'bot-message-protected.mjs'), 'utf8'), 'protected')
})
