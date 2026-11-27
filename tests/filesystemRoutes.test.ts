import assert from 'node:assert/strict'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import {
  isDisallowedFolderListQueryPath,
  registerFilesystemRoutes,
  sanitizeExtractedIdentityName,
  type FilesystemRoutesOptions,
} from '../server/routes/filesystemRoutes'
import type { PickerSessionService } from '../server/services/filesystem/pickerSessionService'

function createMockPickerSessions(workspaceRoot: string, recordedStarts: Array<string | undefined>): PickerSessionService {
  return {
    normalizePickerStartPath: (startPath?: string, fallback?: string) => {
      recordedStarts.push(startPath)
      return path.resolve(startPath || fallback || workspaceRoot)
    },
    pickFolderWithOsDialog: async (startPath?: string) => ({
      ok: true,
      path: startPath || workspaceRoot,
      cancelled: false,
      detail: 'Folder selected.',
    }),
    startFolderPickerSession: (startPath?: string) => ({
      id: 'folder-session-1',
      status: 'pending',
      path: startPath || workspaceRoot,
      startedAt: 1,
      updatedAt: 1,
      expiresAt: 60_000,
    }),
    serializeFolderPickerSession: (session) => ({ ...session }),
    pruneFolderPickerSessions: () => undefined,
    getFolderPickerSession: () => null,
    startImagePickerSession: (agentId: string, startPath?: string) => ({
      id: 'image-session-1',
      agentId,
      status: 'pending',
      path: startPath || workspaceRoot,
      startedAt: 1,
      updatedAt: 1,
      expiresAt: 60_000,
    }),
    serializeImagePickerSession: (session) => ({ ...session }),
    getImagePickerSession: () => null,
    shutdown: async () => undefined,
  } as unknown as PickerSessionService
}

async function withFilesystemServer<T>(
  overrides: Partial<FilesystemRoutesOptions>,
  run: (ctx: {
    baseUrl: string
    workspaceRoot: string
    canonicalRoot: string
    recordedStarts: Array<string | undefined>
    savedIdentityNames: string[]
  }) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'automnia-fs-routes-'))
  const workspaceRoot = path.join(tempRoot, 'workspace')
  const canonicalRoot = path.join(tempRoot, 'agents')
  await fs.mkdir(workspaceRoot, { recursive: true })
  await fs.mkdir(path.join(canonicalRoot, 'hn-architect'), { recursive: true })

  const recordedStarts: Array<string | undefined> = []
  const savedIdentityNames: string[] = []

  const app = express()
  app.use(express.json())

  const defaultOptions: FilesystemRoutesOptions = {
    agentLocalConfigPath: (agentId) => path.join(canonicalRoot, agentId, 'agent.local.json'),
    applyLocalConfigToGlobal: () => undefined,
    canonicalResourcePath: (agentId, file) => path.join(canonicalRoot, agentId, file),
    deriveAgentAliases: (agentId, displayName) => [agentId, displayName],
    editorResourceFiles: ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'TEAM_SYNC.md'],
    ensureAgentLocalConfig: async ({ agentId }) => ({
      agent: {
        displayName: 'Elena Vasquez',
        aliases: [agentId],
        updatedAt: new Date(0).toISOString(),
      },
      identity: {
        name: 'Elena Vasquez',
      },
    }),
    extractIdentityNameFromMarkdown: (markdown) => {
      const match = markdown.match(/^#\s+(.+)$/m)
      return match ? match[1].trim() : null
    },
    getAgentById: async (agentId) => ({
      config: { agents: { defaults: { workspace: workspaceRoot } } },
      target: agentId === 'hn-architect' ? { id: 'hn-architect', workspace: workspaceRoot } : undefined,
    }),
    isMarkdownResourceFile: (file) => file.toLowerCase().endsWith('.md'),
    isValidAgentId: (agentId) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId),
    mirrorSharedTeamFile: async () => undefined,
    pickerSessions: createMockPickerSessions(workspaceRoot, recordedStarts),
    propagateDisplayNameAcrossAgentFiles: async (_agentId, _prev, local) => {
      savedIdentityNames.push(local.identity.name)
    },
    readAgentLocalConfigIfPresent: async () => null,
    rememberAgentLocalConfigCache: async () => undefined,
    resetAgentTurnSessionsForAgentContextChange: () => ({ sessions: 1, histories: 0 }),
    resolveAgentResourceContext: async (agentId) => {
      if (agentId !== 'hn-architect') return null
      const agentDir = path.join(canonicalRoot, agentId)
      return {
        config: { agents: { list: [{ id: agentId, name: 'Elena Vasquez' }] } },
        target: { id: agentId, name: 'Elena Vasquez' },
        workspace: workspaceRoot,
        executionWorkspace: workspaceRoot,
        canonicalWorkspace: agentDir,
        doctrineWorkspace: agentDir,
      }
    },
    resolveWorkspaceForAgent: () => workspaceRoot,
    samePath: (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(),
    saveAgentFileToCodexProfile: async () => undefined,
    sharedTeamFiles: ['TEAM_SYNC.md'],
    syncAgentDerivedFiles: async () => undefined,
    syncDoctrineToWorkspace: async () => undefined,
    workspaceRoot,
    writeOpenclawConfig: async () => undefined,
    writeTextFileWithLockRetry: async (filePath, content) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    },
    ...overrides,
  }

  registerFilesystemRoutes(app, defaultOptions)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    return await run({ baseUrl, workspaceRoot, canonicalRoot, recordedStarts, savedIdentityNames })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

test('sanitizeExtractedIdentityName strips ANSI/control characters and blocks CLI flag or oversized names', () => {
  assert.equal(sanitizeExtractedIdentityName('  \u001b[31mMarcus\u001b[0m\t\nVance  '), 'Marcus Vance')
  assert.equal(sanitizeExtractedIdentityName('--exec=evil'), null)
  assert.equal(sanitizeExtractedIdentityName('-n'), null)
  assert.equal(sanitizeExtractedIdentityName('A'.repeat(121)), null)
  assert.equal(sanitizeExtractedIdentityName('   '), null)
  assert.equal(sanitizeExtractedIdentityName(null), null)
})

test('isDisallowedFolderListQueryPath blocks UNC/SMB shares, Win32 device prefixes, schemes, reserved names, and control chars', () => {
  assert.equal(isDisallowedFolderListQueryPath('\\\\attacker.example\\share'), true)
  assert.equal(isDisallowedFolderListQueryPath('//attacker.example/share'), true)
  assert.equal(isDisallowedFolderListQueryPath('\\\\?\\UNC\\attacker\\share'), true)
  assert.equal(isDisallowedFolderListQueryPath('\\??\\C:\\Windows'), true)
  assert.equal(isDisallowedFolderListQueryPath('file://attacker/share'), true)
  assert.equal(isDisallowedFolderListQueryPath('smb://attacker/share'), true)
  assert.equal(isDisallowedFolderListQueryPath('C:\\Users\\CON\\project'), true)
  assert.equal(isDisallowedFolderListQueryPath('NUL.txt'), true)
  assert.equal(isDisallowedFolderListQueryPath('C:\\Temp\\bad\u0000path'), true)

  assert.equal(isDisallowedFolderListQueryPath(''), false)
  assert.equal(isDisallowedFolderListQueryPath('C:\\Users\\hotbo\\Downloads\\new'), false)
  assert.equal(isDisallowedFolderListQueryPath('/tmp/automnia-config/console'), false)
})

test('party resource routes block traversal, reserved names, symlinks, and directory collisions on read and write', async (t) => {
  await withFilesystemServer({}, async ({ baseUrl, canonicalRoot, workspaceRoot }) => {
    for (const unsafeName of ['CON.md', '..\\SOUL.md', 'sub:stream.md']) {
      const badGet = await fetch(`${baseUrl}/api/party/resources/hn-architect/${encodeURIComponent(unsafeName)}`)
      assert.equal(badGet.status, 400)
      assert.equal((await badGet.json()).error.code, 'invalid_payload')
    }

    const agentDir = path.join(canonicalRoot, 'hn-architect')
    await fs.mkdir(path.join(agentDir, 'DIRECTORY.md'))
    const dirRead = await fetch(`${baseUrl}/api/party/resources/hn-architect/DIRECTORY.md`)
    assert.equal(dirRead.status, 400)
    assert.equal((await dirRead.json()).error.code, 'invalid_payload')

    const dirWrite = await fetch(`${baseUrl}/api/party/resources/hn-architect/DIRECTORY.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Overwrite directory\n' }),
    })
    assert.equal(dirWrite.status, 400)
    assert.equal((await dirWrite.json()).error.code, 'invalid_payload')

    const outsideSecret = path.join(workspaceRoot, 'outside-secret.md')
    await fs.writeFile(outsideSecret, 'TOP_SECRET_TOKEN', 'utf-8')
    const symlinkResource = path.join(agentDir, 'SOUL.md')
    let symlinkCreated = true
    try {
      await fs.symlink(outsideSecret, symlinkResource, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EINVAL') {
        symlinkCreated = false
      } else {
        throw error
      }
    }

    if (!symlinkCreated) {
      t.diagnostic('Skipping symlink escape assertions because OS denied file symlink creation')
      return
    }

    const listRes = await fetch(`${baseUrl}/api/party/resources/hn-architect`)
    assert.equal(listRes.status, 200)
    const listBody = await listRes.json()
    assert.ok(!listBody.data.files.includes('SOUL.md'), 'symlinked markdown file must not be listed as regular resource')
    assert.ok(!listBody.data.files.includes('DIRECTORY.md'), 'directory ending in .md must not be listed')

    const linkRead = await fetch(`${baseUrl}/api/party/resources/hn-architect/SOUL.md`)
    assert.equal(linkRead.status, 400)
    assert.equal((await linkRead.json()).error.code, 'invalid_payload')

    const linkWrite = await fetch(`${baseUrl}/api/party/resources/hn-architect/SOUL.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'OVERWRITTEN' }),
    })
    assert.equal(linkWrite.status, 400)
    assert.equal((await linkWrite.json()).error.code, 'invalid_payload')
    assert.equal(await fs.readFile(outsideSecret, 'utf-8'), 'TOP_SECRET_TOKEN')
  })
})

test('party resource PUT serializes concurrent updates without false-500 verification failure and sanitizes IDENTITY.md display names', async () => {
  await withFilesystemServer({}, async ({ baseUrl, canonicalRoot, savedIdentityNames }) => {
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/api/party/resources/hn-architect/AGENTS.md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Concurrent Write Alpha\n' }),
      }),
      fetch(`${baseUrl}/api/party/resources/hn-architect/AGENTS.md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Concurrent Write Beta\n' }),
      }),
    ])
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    const persisted = await fs.readFile(path.join(canonicalRoot, 'hn-architect', 'AGENTS.md'), 'utf-8')
    assert.ok(persisted === '# Concurrent Write Alpha\n' || persisted === '# Concurrent Write Beta\n')

    // Flag-like identity heading must not propagate into agent config display name
    const flagIdentity = await fetch(`${baseUrl}/api/party/resources/hn-architect/IDENTITY.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# --dangerous-cli-flag\n' }),
    })
    assert.equal(flagIdentity.status, 200)
    assert.equal(savedIdentityNames.length, 0)

    // Valid identity heading with ANSI escape sequences is sanitized before propagation
    const validIdentity = await fetch(`${baseUrl}/api/party/resources/hn-architect/IDENTITY.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# \u001b[32mElena   Vasquez-Prime\u001b[0m\n' }),
    })
    assert.equal(validIdentity.status, 200)
    assert.deepEqual(savedIdentityNames, ['Elena Vasquez-Prime'])
  })
})

test('party folders & picker routes block UNC/SMB NTLM leak paths and return sorted local subfolders', async () => {
  await withFilesystemServer({}, async ({ baseUrl, workspaceRoot, recordedStarts }) => {
    await fs.mkdir(path.join(workspaceRoot, 'zeta'))
    await fs.mkdir(path.join(workspaceRoot, 'alpha'))
    await fs.writeFile(path.join(workspaceRoot, 'readme.md'), 'note\n', 'utf-8')

    for (const badPath of ['\\\\192.0.2.99\\ntlm-capture', '//192.0.2.99/share', 'smb://192.0.2.99/share']) {
      const res = await fetch(`${baseUrl}/api/party/folders?path=${encodeURIComponent(badPath)}`)
      assert.equal(res.status, 400)
      const body = await res.json()
      assert.equal(body.error.code, 'invalid_payload')
    }

    const okRes = await fetch(`${baseUrl}/api/party/folders?path=${encodeURIComponent(workspaceRoot)}`)
    assert.equal(okRes.status, 200)
    const okBody = await okRes.json()
    assert.equal(okBody.ok, true)
    assert.deepEqual(okBody.data.folders, [
      path.join(workspaceRoot, 'alpha'),
      path.join(workspaceRoot, 'zeta'),
    ])

    // Disallowed UNC startPath in picker endpoints must be stripped before reaching picker service
    const pickerRes = await fetch(`${baseUrl}/api/party/folder-picker/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startPath: '\\\\192.0.2.99\\ntlm-capture' }),
    })
    assert.equal(pickerRes.status, 200)
    assert.equal(recordedStarts.at(-1), undefined)

    const avatarPickerRes = await fetch(`${baseUrl}/api/party/avatar-picker/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'hn-architect', startPath: '//192.0.2.99/share' }),
    })
    assert.equal(avatarPickerRes.status, 200)
    assert.equal(recordedStarts.at(-1), undefined)
  })
})
