import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isEquivalentManagedRuntimeBundledPluginPath } from '../server/services/plugins/managedRuntimePluginPath'

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value), 'utf8')
}

async function createRuntimeFixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automnia-managed-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const packagedOpenClawRoot = path.join(root, 'resources', 'openclaw')
  const managedRuntimeRoot = path.join(root, '.automnia-control-center', 'runtimes', 'openclaw', '2026.9.2')
  const bundledPluginRoot = path.join(packagedOpenClawRoot, 'dist', 'extensions', 'telegram')
  const managedPluginRoot = path.join(managedRuntimeRoot, 'dist', 'extensions', 'telegram')

  await writeJson(path.join(packagedOpenClawRoot, 'package.json'), { name: 'openclaw', version: '2026.9.2' })
  await writeJson(path.join(managedRuntimeRoot, 'package.json'), { name: 'openclaw', version: '2026.9.2' })
  await writeJson(path.join(bundledPluginRoot, 'openclaw.plugin.json'), { id: 'telegram' })
  await writeJson(path.join(bundledPluginRoot, 'package.json'), { name: '@openclaw/telegram', version: '2026.9.2' })
  await writeJson(path.join(managedPluginRoot, 'openclaw.plugin.json'), { id: 'telegram' })
  await writeJson(path.join(managedPluginRoot, 'package.json'), { name: '@openclaw/telegram', version: '2026.9.2' })

  return { root, packagedOpenClawRoot, managedRuntimeRoot, managedPluginRoot, bundledPluginRoot }
}

test('recognizes an identical staged copy of a plugin bundled with the active OpenClaw host', async (t) => {
  const fixture = await createRuntimeFixture(t)

  assert.equal(
    isEquivalentManagedRuntimeBundledPluginPath(fixture.managedPluginRoot, 'telegram', fixture.packagedOpenClawRoot),
    true,
  )
})

test('recognizes a bundled plugin when a staged OpenClaw runtime has a different version', async (t) => {
  const fixture = await createRuntimeFixture(t)
  await writeJson(path.join(fixture.managedRuntimeRoot, 'package.json'), { name: 'openclaw', version: '2026.9.3' })

  assert.equal(
    isEquivalentManagedRuntimeBundledPluginPath(fixture.managedPluginRoot, 'telegram', fixture.packagedOpenClawRoot),
    true,
  )
})

test('keeps a staged plugin path when its package identity differs', async (t) => {
  const fixture = await createRuntimeFixture(t)
  await writeJson(path.join(fixture.managedPluginRoot, 'package.json'), { name: '@community/telegram', version: '2026.9.2' })

  assert.equal(
    isEquivalentManagedRuntimeBundledPluginPath(fixture.managedPluginRoot, 'telegram', fixture.packagedOpenClawRoot),
    false,
  )

})

test('keeps paths outside the managed OpenClaw runtime and malformed plugin identities', async (t) => {
  const fixture = await createRuntimeFixture(t)
  const externalPluginRoot = path.join(fixture.root, 'plugins', 'telegram')
  await mkdir(externalPluginRoot, { recursive: true })
  await writeJson(path.join(externalPluginRoot, 'openclaw.plugin.json'), { id: 'telegram' })
  await writeJson(path.join(externalPluginRoot, 'package.json'), { name: '@openclaw/telegram', version: '2026.9.2' })

  assert.equal(
    isEquivalentManagedRuntimeBundledPluginPath(externalPluginRoot, 'telegram', fixture.packagedOpenClawRoot),
    false,
  )
  assert.equal(
    isEquivalentManagedRuntimeBundledPluginPath(fixture.managedPluginRoot, 'browser', fixture.packagedOpenClawRoot),
    false,
  )
})
