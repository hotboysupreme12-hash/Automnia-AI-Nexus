import assert from 'node:assert/strict'
import { once } from 'node:events'
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, truncate, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import type { Express } from 'express'
import { registerSkillRoutes } from '../server/routes/skillRoutes'

type CommandOptions = { cwd?: string; envOverrides?: Record<string, string> }
type SkillRouteTestOverrides = {
  installClawHubSkillWithRetry?: (args: string[], slug: string) => Promise<{ result: { stdout: string; stderr: string; code: number }; retried: boolean }>
  runOpenClaw?: (args: string[], timeoutMs?: number, options?: CommandOptions) => Promise<{ stdout: string; stderr: string; code: number }>
  runOpenClawWithManagedSkillsWorkspace?: (args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string; code: number }>
  skillPreviewTtlMs?: number
}

async function makeSkillTestTempRoot(prefix: string) {
  // macOS exposes its temporary directory through /var, which is a symlink to
  // /private/var. Use the physical path because the skill path checks reject
  // symlinked ancestors by design.
  return mkdtemp(path.join(await realpath(os.tmpdir()), prefix))
}

const reviewOutput = [
  '╭─ ClawHub Security Audit ─────────────────────────╮',
  '│ @gigabit-eth/sports@1.0.24                       │',
  '│                                                  │',
  '│ Outcome: Review                                  │',
  '│                                                  │',
  '│ Overview:                                        │',
  '│ This skill stores signing keys and blindly signs │',
  '│ blockchain instructions supplied by its API.    │',
  '│ Details: [security audit](https://clawhub.ai/gigabit-eth/skills/sports/security-audit?version=1.0.24) │',
  '╰──────────────────────────────────────────────────╯',
].join('\n')

function createSkillIntegrityApp(sharedRoot: string, skillPath: string, overrides: SkillRouteTestOverrides = {}) {
  const app = express()
  app.use(express.json())
  registerSkillRoutes(app, {
    findSkillContent: async () => null,
    installClawHubSkillWithRetry: overrides.installClawHubSkillWithRetry || (async () => ({ result: { stdout: '', stderr: '', code: 0 }, retried: false })),
    invalidateSkillLibraryCache: () => undefined,
    listSkillsFromRoot: async () => [],
    readAgentSkillLibrary: async () => ({
      shared: [{ id: 'example-skill', name: 'Example Skill', path: skillPath }],
      agent: [],
      agentSkillsRoot: null,
    }),
    readSkillEntryFromDir: async () => null,
    resolveSkillsCommandContext: async () => ({}),
    runOpenClaw: overrides.runOpenClaw || (async () => ({ stdout: '', stderr: '', code: 0 })),
    runOpenClawWithManagedSkillsWorkspace: overrides.runOpenClawWithManagedSkillsWorkspace || (async () => ({ stdout: '', stderr: '', code: 0 })),
    sharedSkillsRoot: sharedRoot,
    slugifySkillId: (value) => value.toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
    writeLearnedSkill: async () => ({}),
    skillPreviewTtlMs: overrides.skillPreviewTtlMs,
  })
  return app
}

async function withSkillRouteServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    return await run(base)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('skill integrity endpoint returns bounded hashes for the installed skill and support files', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-integrity-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const skillDir = path.join(sharedRoot, 'example-skill')
  const skillPath = path.join(skillDir, 'SKILL.md')
  await mkdir(path.join(skillDir, 'scripts'), { recursive: true })
  await writeFile(skillPath, '# Example Skill\n', 'utf8')
  await writeFile(path.join(skillDir, 'scripts', 'run.js'), 'console.log("ok")\n', 'utf8')

  const app = createSkillIntegrityApp(sharedRoot, skillPath)
  try {
    await withSkillRouteServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      assert.equal(response.status, 200)
      const text = await response.text()
      const payload = JSON.parse(text) as {
        ok: boolean
        data: {
          complete: boolean
          skill: { id: string; source: string }
          algorithm: string
          files: Array<{ path: string; sizeBytes: number; sha256: string }>
          totalBytes: number
          sha256: string
          symlinksSkipped: number
        }
      }
      assert.equal(payload.ok, true)
      assert.equal(payload.data.complete, true)
      assert.equal(payload.data.skill.id, 'example-skill')
      assert.equal(payload.data.skill.source, 'library')
      assert.equal(payload.data.algorithm, 'sha256')
      assert.deepEqual(payload.data.files.map((file) => file.path), ['SKILL.md', 'scripts/run.js'])
      assert.ok(payload.data.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)))
      assert.equal(payload.data.totalBytes, Buffer.byteLength('# Example Skill\n') + Buffer.byteLength('console.log("ok")\n'))
      assert.equal(payload.data.symlinksSkipped, 0)
      assert.match(payload.data.sha256, /^[a-f0-9]{64}$/)
      assert.equal(text.includes(tempRoot), false)
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('Skill Workshop API compares a verified baseline, quarantines before skills check, and restores explicitly', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-workshop-route-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const skillDir = path.join(sharedRoot, 'example-skill')
  const skillPath = path.join(skillDir, 'SKILL.md')
  const supportPath = path.join(skillDir, 'helper.js')
  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillPath, '# Example Skill\n', 'utf8')
    await writeFile(supportPath, 'export const version = 1\n', 'utf8')

    await withSkillRouteServer(createSkillIntegrityApp(sharedRoot, skillPath), async (baseUrl) => {
      const verify = await fetch(`${baseUrl}/api/skills/library/example-skill/verify`, { method: 'POST' })
      assert.equal(verify.status, 200)
      const verified = await verify.json() as { data: { revision: { revisionId: string }; integrity: { sha256: string } } }
      assert.match(verified.data.revision.revisionId, /^[a-f0-9-]{36}$/i)
      assert.match(verified.data.integrity.sha256, /^[a-f0-9]{64}$/)

      await writeFile(supportPath, 'export const version = 2\n', 'utf8')
      const integrity = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      const integrityPayload = await integrity.json() as { data: { comparison: { status: string; modified: string[] } } }
      assert.equal(integrityPayload.data.comparison.status, 'changed')
      assert.deepEqual(integrityPayload.data.comparison.modified, ['helper.js'])

      const trustUpdate = await fetch(`${baseUrl}/api/skills/library/example-skill/verify`, { method: 'POST' })
      assert.equal(trustUpdate.status, 200)
      const rollback = await fetch(`${baseUrl}/api/skills/library/example-skill/rollback`, { method: 'POST' })
      assert.equal(rollback.status, 200)
      assert.equal(await readFile(supportPath, 'utf8'), 'export const version = 1\n')

      await writeFile(supportPath, 'export const version = 3\n', 'utf8')
      const check = await fetch(`${baseUrl}/api/skills/check`)
      assert.equal(check.status, 200)
      await assert.rejects(readFile(skillPath, 'utf8'), (error: unknown) =>
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))

      const quarantinedResponse = await fetch(`${baseUrl}/api/skills/quarantine`)
      const quarantinedPayload = await quarantinedResponse.json() as { data: { skills: Array<{ skillId: string; reason: string }> } }
      assert.deepEqual(quarantinedPayload.data.skills.map((entry) => entry.skillId), ['example-skill'])
      assert.match(quarantinedPayload.data.skills[0]?.reason || '', /hashes differ/)

      const restored = await fetch(`${baseUrl}/api/skills/quarantine/example-skill/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'library' }),
      })
      assert.equal(restored.status, 200)
      assert.equal(await readFile(supportPath, 'utf8'), 'export const version = 3\n')
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('skill integrity endpoint rejects oversized files before reading them', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-integrity-large-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const skillDir = path.join(sharedRoot, 'example-skill')
  const skillPath = path.join(skillDir, 'SKILL.md')
  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillPath, '', 'utf8')
    const largeFilePath = path.join(skillDir, 'large.bin')
    await writeFile(largeFilePath, '', 'utf8')
    await truncate(largeFilePath, 8 * 1024 * 1024 + 1)
    await withSkillRouteServer(createSkillIntegrityApp(sharedRoot, skillPath), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      assert.equal(response.status, 413)
      const payload = await response.json() as { error: { code: string; message: string } }
      assert.equal(payload.error.code, 'skill_integrity_limit')
      assert.match(payload.error.message, /safety limits/)
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('skill integrity endpoint bounds empty directory traversal', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-integrity-dirs-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const skillDir = path.join(sharedRoot, 'example-skill')
  const skillPath = path.join(skillDir, 'SKILL.md')
  try {
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillPath, '# Example Skill\n', 'utf8')
    await Promise.all(Array.from({ length: 256 }, (_, index) => mkdir(path.join(skillDir, `empty-${index}`))))
    await withSkillRouteServer(createSkillIntegrityApp(sharedRoot, skillPath), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      assert.equal(response.status, 413)
      const payload = await response.json() as { error: { code: string } }
      assert.equal(payload.error.code, 'skill_integrity_limit')
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('skill integrity server errors do not disclose local paths', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-integrity-error-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const missingSkillPath = path.join(sharedRoot, 'example-skill', 'SKILL.md')
  try {
    await mkdir(sharedRoot, { recursive: true })
    await withSkillRouteServer(createSkillIntegrityApp(sharedRoot, missingSkillPath), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      assert.equal(response.status, 404)
      const text = await response.text()
      assert.match(text, /Skill files are unavailable/)
      assert.equal(text.includes(tempRoot), false)
      assert.doesNotMatch(text, /ENOENT|Error:/)
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('ClawHub Review becomes an explicit one-time confirmation before install', async () => {
  const calls: string[][] = []
  const results = [
    { result: { stdout: reviewOutput, stderr: '', code: 1 }, retried: false },
    { result: { stdout: 'installed', stderr: '', code: 0 }, retried: false },
  ]
  const app = express()
  app.use(express.json())
  registerSkillRoutes(app, {
    findSkillContent: async () => null,
    installClawHubSkillWithRetry: async (args) => {
      calls.push(args)
      return results.shift()!
    },
    invalidateSkillLibraryCache: () => undefined,
    listSkillsFromRoot: async () => [],
    readAgentSkillLibrary: async () => ({ shared: [], agent: [], agentSkillsRoot: null }),
    readSkillEntryFromDir: async () => ({ id: 'sports', name: 'Sports', source: 'clawhub' }),
    resolveSkillsCommandContext: async () => ({}),
    runOpenClaw: async () => ({ stdout: '', stderr: '', code: 0 }),
    runOpenClawWithManagedSkillsWorkspace: async () => ({ stdout: '', stderr: '', code: 0 }),
    sharedSkillsRoot: 'C:/skills',
    slugifySkillId: (value) => value.toLowerCase(),
    writeLearnedSkill: async () => ({}),
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (body: unknown) => fetch(`${base}/api/skills/clawhub/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  try {
    const first = await post({ skillRef: '@gigabit-eth/sports', version: '1.0.24' })
    assert.equal(first.status, 409)
    const firstBody = await first.json() as {
      error: { code: string; detail: unknown }
    }
    assert.equal(firstBody.error.code, 'skill_install_confirmation_required')
    const detail = (typeof firstBody.error.detail === 'string'
      ? JSON.parse(firstBody.error.detail)
      : firstBody.error.detail) as {
      confirmation: { confirmationId: string; outcome: string; publisher: string; summary: string; detailsUrl: string }
    }
    assert.equal(detail.confirmation.outcome, 'Review')
    assert.equal(detail.confirmation.publisher, 'gigabit-eth')
    assert.match(detail.confirmation.summary, /signing keys/)
    assert.match(detail.confirmation.detailsUrl, /security-audit/)
    assert.equal(calls[0]?.includes('--acknowledge-install-policy-warning'), false)

    const confirmed = await post({
      skillRef: '@gigabit-eth/sports',
      version: '1.0.24',
      confirmReview: true,
      confirmationId: detail.confirmation.confirmationId,
    })
    assert.equal(confirmed.status, 200, await confirmed.clone().text())
    assert.equal(calls[1]?.at(-1), '--acknowledge-install-policy-warning')

    const replay = await post({
      skillRef: '@gigabit-eth/sports',
      version: '1.0.24',
      confirmReview: true,
      confirmationId: detail.confirmation.confirmationId,
    })
    assert.equal(replay.status, 400)
    assert.equal(calls.length, 2)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('ClawHub preview stages and diffs in isolated state, then applies only after explicit preview confirmation', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-preview-route-')
  const sharedRoot = path.join(tempRoot, 'shared')
  const installedDir = path.join(sharedRoot, 'demo')
  await mkdir(installedDir, { recursive: true })
  await writeFile(path.join(installedDir, 'SKILL.md'), 'old instructions\n', 'utf8')
  const stagedRoots: string[] = []
  const calls: string[][] = []
  let liveInstallCalls = 0
  let managedWorkspaceCalls = 0
  const app = createSkillIntegrityApp(sharedRoot, path.join(installedDir, 'SKILL.md'), {
    runOpenClaw: async (args, _timeoutMs, commandOptions) => {
      calls.push(args)
      const stateRoot = commandOptions?.envOverrides?.OPENCLAW_STATE_DIR || ''
      stagedRoots.push(path.dirname(stateRoot))
      assert.ok(stateRoot)
      if (process.platform === 'darwin') assert.equal(await realpath(path.dirname(stateRoot)), path.dirname(stateRoot))
      assert.notEqual(path.resolve(stateRoot), path.resolve(sharedRoot))
      assert.ok(commandOptions?.cwd && path.resolve(commandOptions.cwd).startsWith(path.resolve(path.dirname(stateRoot))))
      assert.equal(path.resolve(commandOptions?.envOverrides?.OPENCLAW_CONFIG_PATH || ''), path.join(path.resolve(stateRoot), 'openclaw.json'))
      if (args[1] === 'search') {
        return { stdout: JSON.stringify({ results: [{ ownerHandle: 'example', slug: 'demo', version: '2.0.0' }] }), stderr: '', code: 0 }
      }
      assert.deepEqual(args.slice(0, 2), ['skills', 'install'])
      const skillsRoot = path.join(stateRoot, 'skills')
      await mkdir(path.join(skillsRoot, 'demo'), { recursive: true })
      await writeFile(path.join(skillsRoot, 'demo', 'SKILL.md'), 'new instructions\n', 'utf8')
      const config = JSON.parse(await readFile(commandOptions?.envOverrides?.OPENCLAW_CONFIG_PATH || '', 'utf8')) as {
        skills: { load: { extraDirs: string[] } }
      }
      assert.deepEqual(config.skills.load.extraDirs.map((entry) => path.resolve(entry)), [path.resolve(skillsRoot)])
      return { stdout: 'staged', stderr: '', code: 0 }
    },
    installClawHubSkillWithRetry: async (args) => {
      liveInstallCalls += 1
      assert.ok(args.includes('--version'))
      assert.ok(args.includes('2.0.0'))
      return { result: { stdout: 'installed live', stderr: '', code: 0 }, retried: false }
    },
    runOpenClawWithManagedSkillsWorkspace: async () => {
      managedWorkspaceCalls += 1
      return { stdout: '', stderr: '', code: 0 }
    },
  })

  try {
    await withSkillRouteServer(app, async (baseUrl) => {
      const previewResponse = await fetch(`${baseUrl}/api/skills/clawhub/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'install', skillRef: '@example/demo', version: '2.0.0' }),
      })
      assert.equal(previewResponse.status, 200)
      const previewPayload = await previewResponse.json() as { data: {
        previewId: string; version: string; currentSha256: string; stagedSha256: string
        changes: Array<{ path: string; change: string; before?: { mode: number }; after?: { mode: number }; contentPreview?: { kind: string; before?: { text: string }; after?: { text: string } } }>
      } }
      const preview = previewPayload.data
      assert.equal(preview.version, '2.0.0')
      assert.match(preview.currentSha256, /^[a-f0-9]{64}$/)
      assert.match(preview.stagedSha256, /^[a-f0-9]{64}$/)
      assert.equal(preview.changes.length, 1)
      assert.equal(preview.changes[0]?.path, 'SKILL.md')
      assert.equal(preview.changes[0]?.change, 'modified')
      assert.equal(preview.changes[0]?.contentPreview?.kind, 'text')
      assert.equal(preview.changes[0]?.contentPreview?.before?.text, 'old instructions\n')
      assert.equal(preview.changes[0]?.contentPreview?.after?.text, 'new instructions\n')
      assert.equal(liveInstallCalls, 0)
      assert.equal(managedWorkspaceCalls, 0)
      assert.equal(calls.filter((args) => args[1] === 'install').length, 1)

      const missingConfirmation = await fetch(`${baseUrl}/api/skills/clawhub/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRef: '@example/demo', version: '2.0.0', previewId: preview.previewId }),
      })
      assert.equal(missingConfirmation.status, 400)
      assert.equal(liveInstallCalls, 0)

      const applyResponse = await fetch(`${baseUrl}/api/skills/clawhub/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRef: '@example/demo', version: '2.0.0', previewId: preview.previewId, confirmPreview: true }),
      })
      assert.equal(applyResponse.status, 200)
      assert.equal(liveInstallCalls, 1)
      assert.ok(calls.filter((args) => args[1] === 'search').length >= 2)
      await assert.rejects(lstat(stagedRoots[0]!), (error: unknown) =>
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('failed and expired ClawHub previews cannot be applied and are cleaned up', async () => {
  const tempRoot = await makeSkillTestTempRoot('automnia-skill-preview-expiry-')
  const sharedRoot = path.join(tempRoot, 'shared')
  await mkdir(sharedRoot, { recursive: true })
  const stagedRoots: string[] = []
  let stageCount = 0
  let liveInstallCalls = 0
  const app = createSkillIntegrityApp(sharedRoot, path.join(sharedRoot, 'demo', 'SKILL.md'), {
    skillPreviewTtlMs: 30,
    runOpenClaw: async (args, _timeoutMs, commandOptions) => {
      const stateRoot = commandOptions?.envOverrides?.OPENCLAW_STATE_DIR || ''
      stagedRoots.push(path.dirname(stateRoot))
      if (process.platform === 'darwin') assert.equal(await realpath(path.dirname(stateRoot)), path.dirname(stateRoot))
      if (args[1] === 'search') return { stdout: JSON.stringify({ results: [{ ownerHandle: 'example', slug: 'demo', version: '2.0.0' }] }), stderr: '', code: 0 }
      stageCount += 1
      if (stageCount === 1) return { stdout: '', stderr: 'download failed', code: 1 }
      await mkdir(path.join(stateRoot, 'skills', 'demo'), { recursive: true })
      await writeFile(path.join(stateRoot, 'skills', 'demo', 'SKILL.md'), 'new skill\n', 'utf8')
      return { stdout: 'staged', stderr: '', code: 0 }
    },
    installClawHubSkillWithRetry: async () => {
      liveInstallCalls += 1
      return { result: { stdout: 'unexpected', stderr: '', code: 0 }, retried: false }
    },
  })
  try {
    await withSkillRouteServer(app, async (baseUrl) => {
      const postPreview = () => fetch(`${baseUrl}/api/skills/clawhub/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'install', skillRef: '@example/demo' }),
      })
      const failedPreview = await postPreview()
      assert.equal(failedPreview.status, 502)
      const failedApply = await fetch(`${baseUrl}/api/skills/clawhub/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRef: '@example/demo', version: '2.0.0', previewId: '8ab36992-4c71-4ad3-977d-315c4ac6653d', confirmPreview: true }),
      })
      assert.equal(failedApply.status, 410)
      await assert.rejects(lstat(stagedRoots[0]!), (error: unknown) =>
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))

      const successfulPreview = await postPreview()
      assert.equal(successfulPreview.status, 200)
      const preview = (await successfulPreview.json() as { data: { previewId: string; version: string } }).data
      await new Promise((resolve) => setTimeout(resolve, 60))
      const expiredApply = await fetch(`${baseUrl}/api/skills/clawhub/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillRef: '@example/demo', version: preview.version, previewId: preview.previewId, confirmPreview: true }),
      })
      assert.equal(expiredApply.status, 410)
      assert.equal(liveInstallCalls, 0)
      await assert.rejects(lstat(stagedRoots.at(-1)!), (error: unknown) =>
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
