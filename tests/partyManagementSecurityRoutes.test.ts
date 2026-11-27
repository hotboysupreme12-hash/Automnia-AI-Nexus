import assert from 'node:assert/strict'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'

import type { PartyManagementRoutesContext } from '../server/controlPlane'
import { registerPartyManagementRoutes } from '../server/routes/partyManagementRoutes'
import {
  AVATAR_UPLOAD_LIMIT_BYTES,
  assertAvatarImageUploadSignature,
  assertAvatarUploadBytes,
  avatarUploadFileName,
  avatarUploadLimitErrorMessage,
} from '../server/services/filesystem/avatarFileService'

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const VALID_SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><script>alert(1)</script><rect width="16" height="16"/></svg>',
  'utf8',
)

type HarnessState = {
  rootDir: string
  workspaceDir: string
  outsideDir: string
  openClawCalls: string[][]
  profileWrites: number
  configWrites: number
  clearedRetiredIds: string[]
  retiredIds: Set<string>
  validatedWorkspaces: string[]
  persistedAvatarPaths: Array<{ agentId: string; sourcePath: string }>
  partyMembers: Array<{
    id: string
    name: string
    workspace?: string
    doctrineWorkspace?: string
    avatar?: string
  }>
  config: {
    agents: {
      defaults?: { model?: { primary?: string; fallbacks?: string[] }; workspace?: string }
      list: Array<{
        id: string
        name?: string
        default?: boolean
        workspace?: string
        model?: { primary?: string; fallbacks?: string[] }
        identity?: { name?: string; emoji?: string; theme?: string; avatar?: string }
      }>
    }
    bindings?: Array<{ agentId: string; match: { channel: string; accountId?: string } }>
  }
  profiles: {
    agents: Record<string, Record<string, unknown>>
  }
}

async function withPartySecurityServer<T>(
  setup: (state: HarnessState) => Promise<Partial<PartyManagementRoutesContext> | void> | Partial<PartyManagementRoutesContext> | void,
  run: (baseUrl: string, state: HarnessState) => Promise<T>,
): Promise<T> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automnia-party-mgmt-sec-'))
  const workspaceDir = path.join(rootDir, 'workspace')
  const outsideDir = path.join(rootDir, 'outside')
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.mkdir(outsideDir, { recursive: true })

  const state: HarnessState = {
    rootDir,
    workspaceDir,
    outsideDir,
    openClawCalls: [],
    profileWrites: 0,
    configWrites: 0,
    clearedRetiredIds: [],
    retiredIds: new Set(['retired-agent']),
    validatedWorkspaces: [],
    persistedAvatarPaths: [],
    partyMembers: [
      {
        id: 'hn-coordinator',
        name: 'Sarah Cooper',
        workspace: workspaceDir,
        doctrineWorkspace: path.join(workspaceDir, '.openclaw', 'agents', 'hn-coordinator'),
        avatar: '',
      },
      {
        id: 'hn-architect',
        name: 'Elena Vasquez',
        workspace: workspaceDir,
        doctrineWorkspace: path.join(workspaceDir, '.openclaw', 'agents', 'hn-architect'),
        avatar: '',
      },
    ],
    config: {
      agents: {
        defaults: {
          model: { primary: 'google-vertex/gemini-4-carbon', fallbacks: [] },
          workspace: workspaceDir,
        },
        list: [
          {
            id: 'hn-coordinator',
            name: 'Sarah Cooper',
            default: true,
            workspace: workspaceDir,
            model: { primary: 'google-vertex/gemini-4-carbon' },
            identity: { name: 'Sarah Cooper', emoji: '🧭', theme: 'commander' },
          },
          {
            id: 'hn-architect',
            name: 'Elena Vasquez',
            workspace: workspaceDir,
            model: { primary: 'google-vertex/gemini-4-carbon' },
            identity: { name: 'Elena Vasquez', emoji: '🏛️', theme: 'architect' },
          },
          {
            id: 'retired-agent',
            name: 'Retired Agent',
            workspace: workspaceDir,
          },
        ],
      },
      bindings: [],
    },
    profiles: {
      agents: {
        'hn-coordinator': { role: 'Scope Commander', skills: ['coordination'] },
      },
    },
  }

  const overrides = (await setup(state)) || {}

  const app = express()
  app.use(express.json())

  const context = {
    CANONICAL_DOCTRINE_ONLY: false,
    RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES: ['SOUL.md'],
    WORKSPACE_ROOT: workspaceDir,
    agencyAgentTemplateSourceRoot: path.join(workspaceDir, 'templates-missing'),
    agencyAgentTemplateStateFilePath: path.join(workspaceDir, '.openclaw', 'template-catalog.json'),
    agencyAgentTemplateStateKey: 'agency-agent-templates',
    agentLocalConfigPath: (agentId: string) => path.join(workspaceDir, '.openclaw', 'agents', agentId, 'agent.local.json'),
    applyExecutionWorkspaceToLocalConfig: (local: { routing: { workspace: string }; memory: { journalDir: string } }, nextWs: string) => {
      local.routing.workspace = nextWs
      local.memory.journalDir = path.join(nextWs, 'memory')
      return nextWs
    },
    applyLocalConfigToGlobal: () => undefined,
    assertAvatarImageUploadSignature,
    assertAvatarUploadBytes,
    avatarUploadFileName,
    avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES,
    avatarUploadLimitErrorMessage,
    canonicalDoctrineRoot: (agentId: string) => path.join(workspaceDir, '.openclaw', 'agents', agentId),
    cleanupAgentWorkspaceDoctrineFiles: async (agentId: string, ws: string) => ({
      agentId,
      workspace: ws,
      removed: [],
      skipped: [],
    }),
    clearAgentTurnSessions: () => ({ sessions: 0, histories: 0 }),
    clearDisallowedAutoModelOverridesForAgent: async () => ({ changed: false, cleared: [] }),
    clearRetiredAgentId: async (agentId: string) => {
      state.clearedRetiredIds.push(agentId)
      state.retiredIds.delete(agentId)
    },
    contentTypeFromExt: () => 'application/octet-stream',
    defaultAgentWorkspace: () => workspaceDir,
    deriveAgentAliases: (agentId: string, name: string) => [agentId, name.toLowerCase()],
    ensureAgentLocalConfig: async ({ agentId, entry }: { agentId: string; entry?: { workspace?: string } }) => ({
      agent: { id: agentId, displayName: agentId, aliases: [agentId], updatedAt: '' },
      identity: { name: agentId, emoji: '@', theme: 'adventurer', avatar: '' },
      routing: {
        workspace: entry?.workspace || workspaceDir,
        canonicalFolder: path.join(workspaceDir, '.openclaw', 'agents', agentId),
      },
      memory: { journalDir: path.join(entry?.workspace || workspaceDir, 'memory'), retentionDays: 180 },
      model: { primary: 'google-vertex/gemini-4-carbon', fallbacks: [] },
      profile: {},
      runtime: {},
      attributes: {},
      mds: {},
      heartbeat: {},
      soul: {},
      sandbox: { workspaceRoot: entry?.workspace || workspaceDir },
      tools: {},
    }),
    ensureAgentPersistence: async () => undefined,
    ensureConfiguredModelAllowlist: () => undefined,
    getAgentById: async (agentId: string) => ({
      config: state.config,
      target: state.config.agents.list.find((entry) => entry.id === agentId),
    }),
    getPartyMembers: async () => state.partyMembers,
    isLegacyGenericRecruitAttributes: () => false,
    isLegacyGenericRecruitHeartbeat: () => false,
    isLegacyGenericRecruitMds: () => false,
    isLegacyGenericRecruitRuntime: () => false,
    isLegacyGenericRecruitSoul: () => false,
    isRetiredAgentId: (agentId: string) => state.retiredIds.has(agentId),
    isValidAgentId: (agentId: string) => /^[a-z0-9][a-z0-9-]{1,59}$/.test(agentId),
    modelAuthProblem: () => null,
    modelSelectionBlocked: () => false,
    normalizeAgentMdsState: (base: unknown) => base,
    normalizeAgentToolsConfig: (tools: unknown) => tools,
    normalizeModelWithFallback: (model: unknown) => model,
    normalizeSandboxConfig: (sandbox: unknown) => sandbox,
    persistAgentAvatarBytes: async (agentId: string, _bytes: Buffer, sourceName: string) => ({
      agentId,
      avatar: `.openclaw/avatars/${sourceName}`,
      avatarPath: path.join(workspaceDir, '.openclaw', 'avatars', sourceName),
      previewUrl: `/api/party/avatar/${agentId}`,
    }),
    persistAgentAvatarFromPath: async (agentId: string, sourcePath: string) => {
      state.persistedAvatarPaths.push({ agentId, sourcePath })
      return {
        agentId,
        sourcePath,
        avatar: `.openclaw/avatars/${path.basename(sourcePath)}`,
        avatarPath: path.join(workspaceDir, '.openclaw', 'avatars', path.basename(sourcePath)),
        previewUrl: `/api/party/avatar/${agentId}`,
      }
    },
    readAgencyAgentTemplateCatalog: () => null,
    readControlCenterStateRecord: () => null,
    readOpenclawConfig: async () => state.config,
    readPartyProfiles: async () => state.profiles,
    recoverLocalAgentEntries: async () => [],
    recruitAttributesFromProfile: () => ({}),
    recruitHeartbeatDefaults: () => ({}),
    recruitMdsDefaults: () => ({}),
    recruitRuntimeDefaults: () => ({}),
    recruitSoulDefaults: () => ({}),
    rememberAgentLocalConfigCache: async () => undefined,
    resolveDoctrineWorkspaceForRun: (_agentId: string, ws: string) => ws,
    runOpenClaw: async (args: string[]) => {
      state.openClawCalls.push(args)
      return { code: 0, stdout: '{}', stderr: '' }
    },
    samePath: (left: string, right: string) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(),
    sanitizeProfile: (input: Record<string, unknown>) => ({ ...input }),
    schedulePluginGatewayRestart: () => ({ restarted: false, scheduled: true, detail: 'scheduled' }),
    seedAgentWorkspace: async (agent: { id: string; workspace?: string }) => ({
      targetWorkspace: agent.workspace || workspaceDir,
      copied: ['SOUL.md'],
      skipped: [],
    }),
    syncAgentDerivedFiles: async () => undefined,
    syncAgentProjectionToGlobal: async () => ({ config: state.config }),
    terminateOpenClawRunsForSession: () => 0,
    validateWorkspaceAccess: async (candidateWorkspace: string) => {
      state.validatedWorkspaces.push(candidateWorkspace)
    },
    workspaceAccessFailurePayload: async (_error: unknown, candidateWorkspace: string) => ({
      ok: false,
      workspace: candidateWorkspace,
      reason: 'unwritable',
    }),
    writeAgencyAgentTemplateCatalog: () => true,
    writeControlCenterStateRecord: () => true,
    writeOpenclawConfig: async () => {
      state.configWrites += 1
    },
    writePartyProfiles: async () => {
      state.profileWrites += 1
    },
    writeTextFileWithLockRetry: async () => undefined,
    ...overrides,
  } as unknown as PartyManagementRoutesContext

  registerPartyManagementRoutes(app, context)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    return await run(baseUrl, state)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await fs.rm(rootDir, { recursive: true, force: true })
  }
}

test('GET /api/party/avatar/:agentId blocks LFI traversal, symlink escapes, fake image bytes, unsafe schemes, and sandboxes SVG responses', async () => {
  await withPartySecurityServer(async (state) => {
    const avatarsDir = path.join(state.workspaceDir, '.openclaw', 'avatars')
    await fs.mkdir(avatarsDir, { recursive: true })
    await fs.writeFile(path.join(avatarsDir, 'valid.png'), VALID_PNG_BYTES)
    await fs.writeFile(path.join(avatarsDir, 'badge.svg'), VALID_SVG_BYTES)
    await fs.writeFile(path.join(avatarsDir, 'polyglot.png'), '{"secret":"not-a-real-png"}', 'utf8')
    await fs.writeFile(path.join(state.workspaceDir, 'secret.json'), '{"apiKey":"sk-secret"}', 'utf8')
    await fs.writeFile(path.join(state.outsideDir, 'outside.png'), VALID_PNG_BYTES)
  }, async (baseUrl, state) => {
    const member = state.partyMembers[0]!

    // 1. Valid SVG is served with strict sandbox CSP + nosniff + CORP headers
    member.avatar = '.openclaw/avatars/badge.svg'
    const svgRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
    assert.equal(svgRes.status, 200)
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml')
    assert.equal(svgRes.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(svgRes.headers.get('cross-origin-resource-policy'), 'same-site')
    assert.match(svgRes.headers.get('content-security-policy') || '', /\bsandbox\b/)
    assert.match(svgRes.headers.get('content-security-policy') || '', /default-src 'none'/)

    // 2. Relative path traversal outside workspace is blocked (LFI prevention)
    member.avatar = '../outside/outside.png'
    const traversalRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
    assert.equal(traversalRes.status, 400)

    // 3. Absolute path outside workspace is blocked
    member.avatar = path.join(state.outsideDir, 'outside.png')
    const absOutsideRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
    assert.equal(absOutsideRes.status, 400)

    // 4. Non-image file inside workspace is blocked
    member.avatar = 'secret.json'
    const jsonRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
    assert.equal(jsonRes.status, 400)

    // 5. Disguised/corrupt image bytes with .png extension are blocked before send
    member.avatar = '.openclaw/avatars/polyglot.png'
    const polyglotRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
    assert.equal(polyglotRes.status, 400)
    const polyglotText = await polyglotRes.text()
    assert.doesNotMatch(polyglotText, /not-a-real-png/)

    // 6. Symlink inside workspace pointing outside workspace is blocked
    const symlinkAvatar = path.join(state.workspaceDir, '.openclaw', 'avatars', 'escaped-link.png')
    let symlinkCreated = false
    try {
      await fs.symlink(path.join(state.outsideDir, 'outside.png'), symlinkAvatar)
      symlinkCreated = true
    } catch {
      symlinkCreated = false
    }
    if (symlinkCreated) {
      member.avatar = '.openclaw/avatars/escaped-link.png'
      const symlinkRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`)
      assert.equal(symlinkRes.status, 400)
    }

    // 7. Credentialed HTTP(S) redirect and file:// URIs are blocked, clean HTTPS redirect works
    member.avatar = 'https://leaked-user:leaked-pass@evil.example/avatar.png'
    const credUrlRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`, { redirect: 'manual' })
    assert.equal(credUrlRes.status, 400)

    member.avatar = 'file:///etc/passwd'
    const fileUriRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`, { redirect: 'manual' })
    assert.equal(fileUriRes.status, 400)

    member.avatar = 'https://cdn.automnia.example/avatars/sarah.png'
    const safeRedirectRes = await fetch(`${baseUrl}/api/party/avatar/hn-coordinator`, { redirect: 'manual' })
    assert.equal(safeRedirectRes.status, 302)
    assert.equal(safeRedirectRes.headers.get('location'), 'https://cdn.automnia.example/avatars/sarah.png')

    // 8. Retired and prototype-pollution agent IDs return 404
    const retiredRes = await fetch(`${baseUrl}/api/party/avatar/retired-agent`)
    assert.equal(retiredRes.status, 404)
    const protoRes = await fetch(`${baseUrl}/api/party/avatar/__proto__`)
    assert.equal(protoRes.status, 404)
  })
})

test('PUT /api/party/profile/:agentId blocks __proto__ pollution, retired/ghost agents, and unsafe avatar paths', async () => {
  await withPartySecurityServer(async (state) => {
    const avatarsDir = path.join(state.workspaceDir, '.openclaw', 'avatars')
    await fs.mkdir(avatarsDir, { recursive: true })
    await fs.writeFile(path.join(avatarsDir, 'sarah.png'), VALID_PNG_BYTES)
    await fs.writeFile(path.join(state.outsideDir, 'outside.png'), VALID_PNG_BYTES)
  }, async (baseUrl, state) => {
    const protoAttempt = await fetch(`${baseUrl}/api/party/profile/__proto__`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'polluted' }),
    })
    assert.equal(protoAttempt.status, 400)
    assert.equal(({} as { role?: string }).role, undefined)
    assert.equal(state.profileWrites, 0)

    const ghostAttempt = await fetch(`${baseUrl}/api/party/profile/non-existent-agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ghost' }),
    })
    assert.equal(ghostAttempt.status, 404)
    assert.equal(state.profileWrites, 0)

    const retiredAttempt = await fetch(`${baseUrl}/api/party/profile/retired-agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'resurrected' }),
    })
    assert.equal(retiredAttempt.status, 404)
    assert.equal(state.profileWrites, 0)

    const unsafeAvatarAttempt = await fetch(`${baseUrl}/api/party/profile/hn-coordinator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'Scope Commander',
        avatar: '../outside/outside.png',
      }),
    })
    assert.equal(unsafeAvatarAttempt.status, 400)
    assert.equal(state.profileWrites, 0)

    const validUpdate = await fetch(`${baseUrl}/api/party/profile/hn-coordinator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'Operations Lead & Scope Commander',
        avatar: '.openclaw/avatars/sarah.png',
      }),
    })
    assert.equal(validUpdate.status, 200)
    assert.equal(state.profileWrites, 1)
    assert.equal(state.profiles.agents['hn-coordinator']?.avatar, '.openclaw/avatars/sarah.png')
  })
})

test('POST /api/party/identity blocks CLI flag injection, ghost/retired agents, unwritable workspaces, and unsafe avatars', async () => {
  await withPartySecurityServer((state) => ({
    runOpenClaw: async (args: string[]) => {
      state.openClawCalls.push(args)
      return {
        code: 0,
        stdout: '{"ok":true,"apiKey":"sk-live-supersecretvalue1234567890"}',
        stderr: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload',
      }
    },
    validateWorkspaceAccess: async (candidateWorkspace: string) => {
      state.validatedWorkspaces.push(candidateWorkspace)
      if (candidateWorkspace.includes('forbidden-ws')) {
        throw new Error('EACCES: permission denied')
      }
    },
  }), async (baseUrl, state) => {
    // 1. CLI flag injection in agentId or identity fields rejected before CLI spawn
    const flagAgentRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: '--help', name: 'Sarah' }),
    })
    assert.equal(flagAgentRes.status, 400)

    const flagNameRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'hn-coordinator', name: '--workspace=/tmp/pwn' }),
    })
    assert.equal(flagNameRes.status, 400)
    assert.equal(state.openClawCalls.length, 0)

    // 2. Ghost and retired agents rejected before workspace validation or CLI spawn
    const ghostSubdir = path.join(state.outsideDir, 'should-never-be-created')
    const ghostRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'ghost-agent',
        name: 'Ghost',
        workspace: ghostSubdir,
      }),
    })
    assert.equal(ghostRes.status, 404)
    assert.equal(state.openClawCalls.length, 0)
    assert.equal(state.validatedWorkspaces.length, 0)
    await assert.rejects(() => fs.access(path.join(ghostSubdir, 'memory')))

    const retiredRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'retired-agent', name: 'Retired' }),
    })
    assert.equal(retiredRes.status, 404)
    assert.equal(state.openClawCalls.length, 0)

    // 3. Unwritable workspace rejected with 400 workspace_unwritable before CLI spawn
    const unwritableRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'hn-coordinator',
        workspace: path.join(state.rootDir, 'forbidden-ws'),
      }),
    })
    assert.equal(unwritableRes.status, 400)
    const unwritableBody = await unwritableRes.json() as { error: { code: string } }
    assert.equal(unwritableBody.error.code, 'workspace_unwritable')
    assert.equal(state.openClawCalls.length, 0)

    // 4. Valid active agent identity update invokes CLI cleanly and redacts secrets in stdout/stderr
    const validRes = await fetch(`${baseUrl}/api/party/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'hn-coordinator',
        name: 'Sarah Cooper',
        theme: 'commander',
      }),
    })
    assert.equal(validRes.status, 200)
    const validPayload = await validRes.json() as { data: { stdout: string; stderr: string } }
    assert.doesNotMatch(validPayload.data.stdout, /sk-live-supersecretvalue1234567890/)
    assert.doesNotMatch(validPayload.data.stderr, /eyJhbGciOiJIUzI1NiJ9\.secret\.payload/)
    assert.equal(state.openClawCalls.length, 1)
    assert.deepEqual(state.openClawCalls[0], [
      'agents',
      'set-identity',
      '--agent',
      'hn-coordinator',
      '--name',
      'Sarah Cooper',
      '--theme',
      'commander',
      '--json',
    ])
  })
})

test('workspace, default-agent, provision-resources, cleanup-doctrine, and avatar-path routes enforce retired/invalid/symlink/device guards', async () => {
  await withPartySecurityServer(async (state) => {
    await fs.writeFile(path.join(state.outsideDir, 'picked.png'), VALID_PNG_BYTES)
  }, async (baseUrl, state) => {
    // 1. /api/party/workspace verifies active agent BEFORE probing disk via validateWorkspaceAccess
    const ghostWsRes = await fetch(`${baseUrl}/api/party/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'ghost-agent',
        workspace: path.join(state.outsideDir, 'unprobed-dir'),
      }),
    })
    assert.equal(ghostWsRes.status, 404)
    assert.equal(state.validatedWorkspaces.length, 0)

    const retiredWsRes = await fetch(`${baseUrl}/api/party/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'retired-agent',
        workspace: state.workspaceDir,
      }),
    })
    assert.equal(retiredWsRes.status, 404)
    assert.equal(state.validatedWorkspaces.length, 0)

    // 2. /api/party/default-agent rejects reserved channel names & invalid agent IDs
    const protoChannelRes = await fetch(`${baseUrl}/api/party/default-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'hn-coordinator',
        channels: ['__proto__'],
      }),
    })
    assert.equal(protoChannelRes.status, 400)

    // 3. /api/party/provision-resources & /api/party/workspace/cleanup-doctrine reject retired/invalid agentIds
    const provisionRetiredRes = await fetch(`${baseUrl}/api/party/provision-resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: ['retired-agent'] }),
    })
    assert.equal(provisionRetiredRes.status, 400)

    const cleanupFlagRes = await fetch(`${baseUrl}/api/party/workspace/cleanup-doctrine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: ['--force'] }),
    })
    assert.equal(cleanupFlagRes.status, 400)

    // Default sweep (no agentIds specified) skips retired-agent automatically
    const cleanupSweepRes = await fetch(`${baseUrl}/api/party/workspace/cleanup-doctrine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    })
    assert.equal(cleanupSweepRes.status, 200)
    const cleanupSweepPayload = await cleanupSweepRes.json() as {
      data: { agentsProcessed: number; report: Array<{ agentId: string }> }
    }
    assert.equal(cleanupSweepPayload.data.agentsProcessed, 2)
    assert.deepEqual(
      cleanupSweepPayload.data.report.map((entry) => entry.agentId),
      ['hn-coordinator', 'hn-architect'],
    )

    // 4. /api/party/avatar-path/:agentId blocks Windows device names, URIs, retired agents, and symlinks
    const deviceAvatarRes = await fetch(`${baseUrl}/api/party/avatar-path/hn-coordinator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(state.outsideDir, 'NUL.png') }),
    })
    assert.equal(deviceAvatarRes.status, 400)

    const uriAvatarRes = await fetch(`${baseUrl}/api/party/avatar-path/hn-coordinator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'file:///C:/Windows/win.ini' }),
    })
    assert.equal(uriAvatarRes.status, 400)

    const retiredAvatarPathRes = await fetch(`${baseUrl}/api/party/avatar-path/retired-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(state.outsideDir, 'picked.png') }),
    })
    assert.equal(retiredAvatarPathRes.status, 404)

    const symlinkParentDir = path.join(state.workspaceDir, 'symlinked-parent')
    let parentSymlinkCreated = false
    try {
      await fs.symlink(state.outsideDir, symlinkParentDir, process.platform === 'win32' ? 'junction' : 'dir')
      parentSymlinkCreated = true
    } catch {
      parentSymlinkCreated = false
    }
    if (parentSymlinkCreated) {
      const symlinkParentRes = await fetch(`${baseUrl}/api/party/avatar-path/hn-coordinator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.join(symlinkParentDir, 'picked.png') }),
      })
      assert.equal(symlinkParentRes.status, 400)
      assert.equal(state.persistedAvatarPaths.length, 0)
    }

    const validPickedRes = await fetch(`${baseUrl}/api/party/avatar-path/hn-coordinator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(state.outsideDir, 'picked.png') }),
    })
    assert.equal(validPickedRes.status, 200)
    assert.equal(state.persistedAvatarPaths.length, 1)
  })
})

test('POST /api/party/recruit preserves retirement tombstones on failed preflights, allows clean re-recruitment, blocks reserved main, and avoids double URL decode 500s', async () => {
  await withPartySecurityServer((state) => ({
    readAgencyAgentTemplateCatalog: <T>() => ({
      schemaVersion: 1,
      source: {
        repository: 'Automnia Agent Templates',
        sourceRoot: path.join(state.workspaceDir, 'templates-missing'),
        commit: null,
        importedAt: '2026-11-26T00:00:00.000Z',
        templateCount: 1,
      },
      divisions: { engineering: { label: 'Engineering', color: '#3B82F6' } },
      templates: [
        {
          id: 'pct%25template',
          slug: 'pct-template',
          name: 'Percent Template',
          description: 'Test template',
          division: 'engineering',
          divisionLabel: 'Engineering',
          color: '#3B82F6',
          relativePath: 'engineering/pct-template.md',
          sourceUrl: 'https://example.com/pct-template.md',
          defaults: {
            agentId: 'pct-template',
            name: 'Percent Template',
            className: 'Engineer',
            role: 'Engineer',
            behaviorProfile: 'executor',
            level: 1,
            capabilities: {
              codeGeneration: true,
              planning: true,
              research: true,
              orchestration: false,
              memoryManagement: false,
            },
            tools: [],
          },
          documents: [{ file: 'SOUL.md', content: '# Soul' }],
          sourceMarkdown: '# Percent Template',
        },
      ],
    }) as unknown as T,
    recoverLocalAgentEntries: async () => {
      // Simulate disk scan that recovers any unretired agent still on disk
      return state.retiredIds.has('retired-agent')
        ? []
        : [{ id: 'retired-agent', name: 'Stale Disk Corpse', workspace: state.workspaceDir }]
    },
    validateWorkspaceAccess: async (candidateWorkspace: string) => {
      state.validatedWorkspaces.push(candidateWorkspace)
      if (candidateWorkspace.includes('unwritable-recruit')) {
        throw new Error('EACCES: denied')
      }
    },
  }), async (baseUrl, state) => {
    // 1. Encoded %25 in templateId must not throw 500 URIError via double decodeURIComponent
    const malformedPctRes = await fetch(`${baseUrl}/api/party/recruit/templates/%25E0%25A4%25A`)
    assert.equal(malformedPctRes.status, 404)
    const exactPctRes = await fetch(`${baseUrl}/api/party/recruit/templates/pct%2525template`)
    assert.equal(exactPctRes.status, 200)

    // 2. Reserved "main" agent ID cannot be recruited
    const mainRecruitRes = await fetch(`${baseUrl}/api/party/recruit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'main', name: 'Main Override' }),
    })
    assert.equal(mainRecruitRes.status, 400)

    // 3. Failed preflight (invalid avatar or unwritable workspace) MUST NOT wipe retired tombstone
    const failedAvatarRecruit = await fetch(`${baseUrl}/api/party/recruit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'retired-agent',
        name: 'Fresh Recruit',
        avatar: '../outside/escape.png',
      }),
    })
    assert.equal(failedAvatarRecruit.status, 400)
    assert.equal(state.retiredIds.has('retired-agent'), true)
    assert.equal(state.clearedRetiredIds.length, 0)

    const failedWsRecruit = await fetch(`${baseUrl}/api/party/recruit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'retired-agent',
        name: 'Fresh Recruit',
        workspace: path.join(state.rootDir, 'unwritable-recruit'),
      }),
    })
    assert.equal(failedWsRecruit.status, 400)
    assert.equal(state.retiredIds.has('retired-agent'), true)
    assert.equal(state.clearedRetiredIds.length, 0)

    // 4. Valid re-recruit of a retired ID clears tombstone AFTER recovery/preflight and replaces stale list row
    const cleanRecruit = await fetch(`${baseUrl}/api/party/recruit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'retired-agent',
        name: 'Reborn Specialist',
        theme: 'savant',
      }),
    })
    assert.equal(cleanRecruit.status, 200)
    assert.equal(state.retiredIds.has('retired-agent'), false)
    assert.deepEqual(state.clearedRetiredIds, ['retired-agent'])
    const matchingEntries = state.config.agents.list.filter((entry) => entry.id === 'retired-agent')
    assert.equal(matchingEntries.length, 1)
    assert.equal(matchingEntries[0]?.name, 'Reborn Specialist')
  })
})
