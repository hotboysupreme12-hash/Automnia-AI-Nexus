import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import type { Express } from 'express'
import { registerSkillRoutes } from '../server/routes/skillRoutes'

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

function createSkillIntegrityApp(sharedRoot: string, skillPath: string) {
  const app = express()
  app.use(express.json())
  registerSkillRoutes(app, {
    findSkillContent: async () => null,
    installClawHubSkillWithRetry: async () => ({ result: { stdout: '', stderr: '', code: 0 }, retried: false }),
    invalidateSkillLibraryCache: () => undefined,
    listSkillsFromRoot: async () => [],
    readAgentSkillLibrary: async () => ({
      shared: [{ id: 'example-skill', name: 'Example Skill', path: skillPath }],
      agent: [],
      agentSkillsRoot: null,
    }),
    readSkillEntryFromDir: async () => null,
    resolveSkillsCommandContext: async () => ({}),
    runOpenClaw: async () => ({ stdout: '', stderr: '', code: 0 }),
    runOpenClawWithManagedSkillsWorkspace: async () => ({ stdout: '', stderr: '', code: 0 }),
    sharedSkillsRoot: sharedRoot,
    slugifySkillId: (value) => value.toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
    writeLearnedSkill: async () => ({}),
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-skill-integrity-'))
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

test('skill integrity endpoint rejects oversized files before reading them', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-skill-integrity-large-'))
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-skill-integrity-dirs-'))
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'automnia-skill-integrity-error-'))
  const sharedRoot = path.join(tempRoot, 'shared')
  const missingSkillPath = path.join(sharedRoot, 'example-skill', 'SKILL.md')
  try {
    await mkdir(sharedRoot, { recursive: true })
    await withSkillRouteServer(createSkillIntegrityApp(sharedRoot, missingSkillPath), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/skills/library/example-skill/integrity`)
      assert.equal(response.status, 500)
      const text = await response.text()
      assert.match(text, /Failed to inspect skill file integrity/)
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
    assert.equal(confirmed.status, 200)
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
