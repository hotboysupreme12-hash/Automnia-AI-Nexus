import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
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
