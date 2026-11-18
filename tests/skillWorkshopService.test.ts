import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createSkillWorkshopService,
  MAX_SKILL_WORKSHOP_LEDGER_BYTES,
  SkillWorkshopError,
} from '../server/services/skills/skillWorkshopService'

async function makeSkillRoot() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'automnia-skill-workshop-'))
  const root = path.join(temporary, 'skills')
  const skillDir = path.join(root, 'example-skill')
  await mkdir(path.join(skillDir, 'scripts'), { recursive: true })
  await writeFile(path.join(skillDir, 'SKILL.md'), '# Example v1\n', 'utf8')
  await writeFile(path.join(skillDir, 'scripts', 'run.js'), 'console.log("v1")\n', 'utf8')
  return { temporary, root, skillDir, service: createSkillWorkshopService(root) }
}

test('skill workshop records support-file baselines, compares changes, and rolls back to a prior verified revision', async () => {
  const harness = await makeSkillRoot()
  try {
    const first = await harness.service.verify(harness.root, 'example-skill', 'library')
    assert.equal(first.unchanged, false)
    assert.equal(first.revision.files.length, 2)

    await writeFile(path.join(harness.skillDir, 'SKILL.md'), '# Example v2\n', 'utf8')
    await writeFile(path.join(harness.skillDir, 'scripts', 'extra.js'), 'console.log("extra")\n', 'utf8')
    const comparison = await harness.service.inspect(harness.root, 'example-skill', 'library')
    assert.equal(comparison.status, 'changed')
    assert.deepEqual(comparison.added, ['scripts/extra.js'])
    assert.deepEqual(comparison.modified, ['SKILL.md'])
    assert.deepEqual(comparison.removed, [])

    const second = await harness.service.verify(harness.root, 'example-skill', 'library')
    assert.notEqual(second.revision.revisionId, first.revision.revisionId)
    assert.equal((await harness.service.inspect(harness.root, 'example-skill', 'library')).canRollback, true)

    const rolledBack = await harness.service.rollback(harness.root, 'example-skill', 'library')
    assert.equal(rolledBack.revision.revisionId, first.revision.revisionId)
    assert.equal(await readFile(path.join(harness.skillDir, 'SKILL.md'), 'utf8'), '# Example v1\n')
    await assert.rejects(readFile(path.join(harness.skillDir, 'scripts', 'extra.js'), 'utf8'), (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    assert.equal((await harness.service.inspect(harness.root, 'example-skill', 'library')).status, 'unchanged')
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop quarantines changed skills before skill commands and requires explicit restore', async () => {
  const harness = await makeSkillRoot()
  try {
    await harness.service.verify(harness.root, 'example-skill', 'library')
    await writeFile(path.join(harness.skillDir, 'scripts', 'run.js'), 'console.log("tampered")\n', 'utf8')

    assert.deepEqual(await harness.service.quarantineChangedSkills(harness.root, 'library'), ['example-skill'])
    assert.deepEqual(await harness.service.listQuarantined('library'), [{
      skillId: 'example-skill',
      source: 'library',
      agentId: null,
      reason: 'Support-file hashes differ from the verified baseline.',
      movedAt: (await harness.service.listQuarantined('library'))[0]?.movedAt,
    }])
    await assert.rejects(harness.service.inspect(harness.root, 'example-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_not_found')

    assert.deepEqual(await harness.service.restore(harness.root, 'example-skill', 'library'), {
      skillId: 'example-skill', source: 'library', restored: true,
    })
    assert.equal((await harness.service.listQuarantined('library')).length, 0)
    assert.equal(await readFile(path.join(harness.skillDir, 'scripts', 'run.js'), 'utf8'), 'console.log("tampered")\n')
    assert.equal((await harness.service.inspect(harness.root, 'example-skill', 'library')).status, 'changed')
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop rejects path traversal and symbolic-link support files', async (context) => {
  const harness = await makeSkillRoot()
  const outsideFile = path.join(harness.temporary, 'outside.txt')
  try {
    await assert.rejects(harness.service.verify(harness.root, '../outside', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_path_unsafe')
    await writeFile(outsideFile, 'outside', 'utf8')
    try {
      await symlink(outsideFile, path.join(harness.skillDir, 'scripts', 'escape.txt'), 'file')
    } catch {
      context.skip('Symbolic link creation is unavailable in this Windows environment.')
      return
    }
    await assert.rejects(harness.service.verify(harness.root, 'example-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_invalid')
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop text previews are byte-bounded and omit binary content', async () => {
  const harness = await makeSkillRoot()
  try {
    const longText = 'x'.repeat(10_000)
    await writeFile(path.join(harness.skillDir, 'large.txt'), longText, 'utf8')
    await writeFile(path.join(harness.skillDir, 'binary.dat'), Buffer.from([0x00, 0xff, 0x11]))

    const longPreview = await harness.service.readTextPreview(harness.root, 'example-skill', 'large.txt')
    assert.equal(longPreview.kind, 'text')
    if (longPreview.kind === 'text') {
      assert.equal(longPreview.truncated, true)
      assert.ok(Buffer.byteLength(longPreview.text, 'utf8') <= 4 * 1024)
    }
    assert.deepEqual(await harness.service.readTextPreview(harness.root, 'example-skill', 'binary.dat'), { kind: 'binary' })
    await assert.rejects(harness.service.readTextPreview(harness.root, 'example-skill', '../outside.txt'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_path_unsafe')
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop rejects oversized ledgers before parsing them', async () => {
  const harness = await makeSkillRoot()
  const service = createSkillWorkshopService(harness.root, undefined, { ledgerBytes: 128 })
  const store = path.join(path.dirname(harness.root), `.${path.basename(harness.root)}-automnia-skill-workshop`)
  try {
    await mkdir(store, { recursive: true })
    await writeFile(path.join(store, 'state.json'), `${' '.repeat(129)}`, 'utf8')
    await assert.rejects(service.inspect(harness.root, 'example-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit')
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop evicts only non-active history to satisfy per-skill quotas and keeps the active baseline on failure', async () => {
  const harness = await makeSkillRoot()
  const service = createSkillWorkshopService(harness.root, undefined, {
    perSkillSnapshotBytes: 12,
    totalSnapshotBytes: 64,
    revisionsPerSkill: 3,
  })
  try {
    await rm(path.join(harness.skillDir, 'scripts', 'run.js'))
    await rm(path.join(harness.skillDir, 'scripts'), { recursive: true, force: true })
    await writeFile(path.join(harness.skillDir, 'SKILL.md'), 'one\n', 'utf8')
    const first = await service.verify(harness.root, 'example-skill', 'library')
    await writeFile(path.join(harness.skillDir, 'SKILL.md'), 'two\n', 'utf8')
    await service.verify(harness.root, 'example-skill', 'library')
    await writeFile(path.join(harness.skillDir, 'SKILL.md'), 'tri\n', 'utf8')
    await service.verify(harness.root, 'example-skill', 'library')
    await writeFile(path.join(harness.skillDir, 'SKILL.md'), 'for\n', 'utf8')
    const fourth = await service.verify(harness.root, 'example-skill', 'library')

    assert.equal((await service.inspect(harness.root, 'example-skill', 'library')).baseline?.revisionId, fourth.revision.revisionId)
    assert.equal((await service.inspect(harness.root, 'example-skill', 'library')).revisionCount, 3)
    const statePath = path.join(path.dirname(harness.root), `.${path.basename(harness.root)}-automnia-skill-workshop`, 'state.json')
    const skillRecord = JSON.parse(await readFile(statePath, 'utf8')).skills[JSON.stringify(['library', '', 'example-skill'])] as { revisions: Array<{ revisionId: string }> }
    assert.equal(skillRecord.revisions.some((revision) => revision.revisionId === first.revision.revisionId), false)
    const revisionRoot = path.join(path.dirname(harness.root), `.${path.basename(harness.root)}-automnia-skill-workshop`, 'revisions')
    const keyDirectories = await readdir(revisionRoot)
    const savedRevisionDirectories = await Promise.all(keyDirectories.map(async (keyDirectory) =>
      readdir(path.join(revisionRoot, keyDirectory))))
    assert.equal(savedRevisionDirectories.reduce((count, directories) => count + directories.length, 0), 3)

    await writeFile(path.join(harness.skillDir, 'SKILL.md'), 'too large', 'utf8')
    await assert.rejects(service.verify(harness.root, 'example-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit')
    const afterFailure = await service.inspect(harness.root, 'example-skill', 'library')
    assert.equal(afterFailure.baseline?.revisionId, fourth.revision.revisionId)
    assert.equal(afterFailure.revisionCount, 3)
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop enforces the global snapshot budget without leaving failed snapshots or changing prior ledger state', async () => {
  const harness = await makeSkillRoot()
  const service = createSkillWorkshopService(harness.root, undefined, {
    perSkillSnapshotBytes: 12,
    totalSnapshotBytes: 8,
  })
  const store = path.join(path.dirname(harness.root), `.${path.basename(harness.root)}-automnia-skill-workshop`)
  const firstSkill = path.join(harness.root, 'first-skill')
  const secondSkill = path.join(harness.root, 'second-skill')
  try {
    await mkdir(firstSkill)
    await mkdir(secondSkill)
    await writeFile(path.join(firstSkill, 'SKILL.md'), 'four', 'utf8')
    await writeFile(path.join(secondSkill, 'SKILL.md'), 'five!!', 'utf8')
    const first = await service.verify(harness.root, 'first-skill', 'library')
    const statePath = path.join(store, 'state.json')
    const previousState = await readFile(statePath)

    await assert.rejects(service.verify(harness.root, 'second-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit')
    assert.deepEqual(await readFile(statePath), previousState)
    assert.equal((await service.inspect(harness.root, 'first-skill', 'library')).baseline?.revisionId, first.revision.revisionId)
    assert.equal((await service.inspect(harness.root, 'second-skill', 'library')).baseline, null)

    const revisionRoot = path.join(store, 'revisions')
    const keyDirectories = await readdir(revisionRoot)
    const revisionDirectories = await Promise.all(keyDirectories.map(async (keyDirectory) =>
      readdir(path.join(revisionRoot, keyDirectory))))
    assert.equal(revisionDirectories.reduce((count, directories) => count + directories.length, 0), 1)
    assert.deepEqual((await readdir(store)).filter((name) => name.endsWith('.tmp')), [])
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})

test('skill workshop preserves prior ledger bytes and leaves no temp file when the next ledger exceeds its byte limit', async () => {
  const harness = await makeSkillRoot()
  const firstService = createSkillWorkshopService(harness.root)
  const store = path.join(path.dirname(harness.root), `.${path.basename(harness.root)}-automnia-skill-workshop`)
  try {
    const first = await firstService.verify(harness.root, 'example-skill', 'library')
    const statePath = path.join(store, 'state.json')
    const previousState = await readFile(statePath)
    const boundedService = createSkillWorkshopService(harness.root, undefined, {
      ledgerBytes: Math.min(MAX_SKILL_WORKSHOP_LEDGER_BYTES, previousState.byteLength + 1),
    })
    await writeFile(path.join(harness.skillDir, 'SKILL.md'), '# Example with a second verified revision\n', 'utf8')

    await assert.rejects(boundedService.verify(harness.root, 'example-skill', 'library'), (error: unknown) =>
      error instanceof SkillWorkshopError && error.code === 'skill_workshop_limit')
    assert.deepEqual(await readFile(statePath), previousState)
    assert.equal((await boundedService.inspect(harness.root, 'example-skill', 'library')).baseline?.revisionId, first.revision.revisionId)
    assert.deepEqual((await readdir(store)).filter((name) => name.endsWith('.tmp')), [])
  } finally {
    await rm(harness.temporary, { recursive: true, force: true })
  }
})
