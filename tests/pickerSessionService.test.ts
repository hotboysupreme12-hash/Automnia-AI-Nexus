import assert from 'node:assert/strict'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  createPickerSessionService,
  parseWindowsPickerOutput,
  windowsPickerLauncherContents,
} from '../server/services/filesystem/pickerSessionService'

async function createTempRoot(t: { after(callback: () => Promise<void> | void): void }, prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

function fakeDetachedSpawn(calls: Array<{ command: string; args: string[]; options?: SpawnOptions }>) {
  return (command: string, args: string[], options?: SpawnOptions) => {
    calls.push({ command, args, options })
    return Object.assign(new EventEmitter(), {
      kill: () => true,
      unref: () => undefined,
    }) as ChildProcess
  }
}

test('picker session service normalizes start paths, serializes cancellation, and prunes expired sessions', async (t) => {
  const workspaceRoot = await createTempRoot(t, 'dystopai-picker-workspace-')
  let currentTime = 1_000
  const service = createPickerSessionService({
    stateRoot: path.join(workspaceRoot, '.openclaw'),
    workspaceRoot,
    platform: 'linux',
    sessionTtlMs: 10,
    now: () => currentTime,
    randomId: () => 'folder-session',
    pickFolderWithOsDialog: async () => ({ ok: false, cancelled: true }),
  })
  t.after(() => service.dispose())

  assert.equal(service.normalizePickerStartPath('https://example.test/path'), path.resolve(workspaceRoot))
  assert.equal(service.normalizePickerStartPath('/api/party/avatar/agent-1'), path.resolve(workspaceRoot))
  assert.equal(service.normalizePickerStartPath(pathToFileURL(path.join(workspaceRoot, 'nested')).href), path.join(workspaceRoot, 'nested'))

  const session = service.startFolderPickerSession(path.join(workspaceRoot, 'nested'))
  await waitFor(() => session.status === 'cancelled', 'folder picker cancellation')

  assert.deepEqual(service.serializeFolderPickerSession(session), {
    sessionId: 'folder-session',
    status: 'cancelled',
    path: null,
    cancelled: true,
    detail: 'No folder selected.',
  })

  currentTime = 2_000
  service.pruneFolderPickerSessions()
  assert.equal(service.getFolderPickerSession('folder-session'), undefined)
})

test('picker session service resolves relative start paths under fallback and rejects traversal starts', async (t) => {
  const workspaceRoot = await createTempRoot(t, 'dystopai-picker-traversal-')
  const fallbackStart = path.join(workspaceRoot, 'agents', 'starter')
  const service = createPickerSessionService({
    stateRoot: path.join(workspaceRoot, '.openclaw'),
    workspaceRoot,
    platform: 'linux',
  })
  t.after(() => service.dispose())

  assert.equal(
    service.normalizePickerStartPath('nested', fallbackStart),
    path.resolve(fallbackStart, 'nested'),
  )
  assert.equal(
    service.normalizePickerStartPath(path.join('nested', '..', 'safe'), fallbackStart),
    path.resolve(fallbackStart, 'safe'),
  )
  assert.equal(
    service.normalizePickerStartPath(path.join('..', 'outside'), fallbackStart),
    path.resolve(fallbackStart),
  )
  assert.equal(
    service.normalizePickerStartPath(path.join('..', '..', 'outside'), fallbackStart),
    path.resolve(fallbackStart),
  )
})

test('picker session service persists selected image picker avatars through an injected dependency', async (t) => {
  const workspaceRoot = await createTempRoot(t, 'dystopai-picker-avatar-')
  const selectedPath = path.join(workspaceRoot, 'source.png')
  const persistedPath = path.join(workspaceRoot, '.openclaw', 'avatars', 'agent-1-source.png')
  const service = createPickerSessionService({
    stateRoot: path.join(workspaceRoot, '.openclaw'),
    workspaceRoot,
    platform: 'linux',
    randomId: () => 'image-session',
    pickImageWithOsDialog: async () => ({ ok: true, path: selectedPath }),
    persistAgentAvatarFromPath: async (agentId, sourcePath) => {
      assert.equal(agentId, 'agent-1')
      assert.equal(sourcePath, path.resolve(selectedPath))
      return {
        agentId,
        sourcePath,
        avatar: '.openclaw/avatars/agent-1-source.png',
        avatarPath: persistedPath,
        previewUrl: '/api/party/avatar/agent-1?v=123',
      }
    },
  })
  t.after(() => service.dispose())

  const session = service.startImagePickerSession('agent-1', workspaceRoot)
  await waitFor(() => session.status === 'selected', 'image picker selection')

  assert.deepEqual(service.serializeImagePickerSession(session), {
    sessionId: 'image-session',
    status: 'selected',
    path: persistedPath,
    cancelled: false,
    detail: 'Profile picture selected.',
    agentId: 'agent-1',
    sourcePath: path.resolve(selectedPath),
    avatar: '.openclaw/avatars/agent-1-source.png',
    previewUrl: '/api/party/avatar/agent-1?v=123',
  })
})

test('picker session service rejects unsupported image picker file types before avatar persistence', async (t) => {
  const workspaceRoot = await createTempRoot(t, 'dystopai-picker-avatar-type-')
  const selectedPath = path.join(workspaceRoot, 'not-an-image.txt')
  let persistCalls = 0
  const service = createPickerSessionService({
    stateRoot: path.join(workspaceRoot, '.openclaw'),
    workspaceRoot,
    platform: 'linux',
    randomId: () => 'image-session',
    pickImageWithOsDialog: async () => ({ ok: true, path: selectedPath }),
    persistAgentAvatarFromPath: async () => {
      persistCalls += 1
      throw new Error('persistence should not run for unsupported image types')
    },
  })
  t.after(() => service.dispose())

  const session = service.startImagePickerSession('agent-1', workspaceRoot)
  await waitFor(() => session.status === 'error', 'image picker type rejection')

  assert.equal(persistCalls, 0)
  assert.deepEqual(service.serializeImagePickerSession(session), {
    sessionId: 'image-session',
    status: 'error',
    path: null,
    cancelled: false,
    detail: 'Choose a PNG, JPG, WEBP, GIF, BMP, ICO, or SVG image.',
    agentId: 'agent-1',
    sourcePath: null,
    avatar: null,
    previewUrl: null,
  })
})

test('picker session service parses Windows picker output and quotes launcher arguments', () => {
  assert.deepEqual(parseWindowsPickerOutput('\uFEFF{"status":"selected","path":"C:\\\\Users\\\\Me"}'), {
    status: 'selected',
    path: 'C:\\Users\\Me',
  })
  assert.deepEqual(parseWindowsPickerOutput('status=cancelled\r\ndetail=No folder selected.\r\n'), {
    status: 'cancelled',
    detail: 'No folder selected.',
  })

  const launcher = windowsPickerLauncherContents(
    'DystopAI "Profile" 100%',
    'C:\\tmp\\pick "image".ps1',
    'C:\\tmp\\result.json',
    'C:\\Users\\Me\\Pictures',
  )
  assert.match(launcher, /start "DystopAI ""Profile"" 100%%" powershell\.exe/)
  assert.match(launcher, /-File "C:\\tmp\\pick ""image""\.ps1"/)
  assert.match(launcher, /-StartPath "C:\\Users\\Me\\Pictures"/)
})

test('picker session service launches Windows folder and image sessions without opening real dialogs', async (t) => {
  const workspaceRoot = await createTempRoot(t, 'dystopai-picker-win-workspace-')
  const stateRoot = await createTempRoot(t, 'dystopai-picker-win-state-')
  const spawnCalls: Array<{ command: string; args: string[]; options?: SpawnOptions }> = []
  const ids = ['folder-session', 'image-session']
  const selectedFolder = path.join(workspaceRoot, 'chosen-folder')
  const selectedImage = path.join(workspaceRoot, 'portrait.png')
  const persistedImage = path.join(workspaceRoot, '.openclaw', 'avatars', 'agent-1-portrait.png')
  await fs.mkdir(selectedFolder, { recursive: true })
  await fs.writeFile(selectedImage, 'image', 'utf-8')

  const service = createPickerSessionService({
    stateRoot,
    workspaceRoot,
    platform: 'win32',
    timeoutMs: 2_000,
    sessionTtlMs: 25,
    randomId: () => ids.shift() || 'fallback-session',
    spawnProcess: fakeDetachedSpawn(spawnCalls),
    persistAgentAvatarFromPath: async (agentId, sourcePath) => ({
      agentId,
      sourcePath,
      avatar: '.openclaw/avatars/agent-1-portrait.png',
      avatarPath: persistedImage,
      previewUrl: '/api/party/avatar/agent-1?v=456',
    }),
  })
  t.after(() => service.dispose())

  const folderSession = service.startFolderPickerSession(workspaceRoot)
  const folderScriptPath = path.join(stateRoot, 'tmp', 'folder-picker', 'folder-session.ps1')
  const folderLauncherPath = path.join(stateRoot, 'tmp', 'folder-picker', 'folder-session.cmd')
  const folderOutputPath = path.join(stateRoot, 'tmp', 'folder-picker', 'folder-session.json')
  await waitFor(async () => {
    try {
      await fs.access(folderLauncherPath)
      return true
    } catch {
      return false
    }
  }, 'Windows folder picker launcher')
  assert.match(await fs.readFile(folderScriptPath, 'utf-8'), /FolderBrowserDialog/)
  assert.match(await fs.readFile(folderLauncherPath, 'utf-8'), /start "Select Agent Workspace" powershell\.exe/)
  await fs.writeFile(folderOutputPath, JSON.stringify({ status: 'selected', path: selectedFolder }), 'utf-8')
  await waitFor(() => folderSession.status === 'selected', 'Windows folder picker selection')
  assert.equal(folderSession.path, path.resolve(selectedFolder))

  const imageSession = service.startImagePickerSession('agent-1', workspaceRoot)
  const imageScriptPath = path.join(stateRoot, 'tmp', 'image-picker', 'image-session.ps1')
  const imageLauncherPath = path.join(stateRoot, 'tmp', 'image-picker', 'image-session.cmd')
  const imageOutputPath = path.join(stateRoot, 'tmp', 'image-picker', 'image-session.json')
  await waitFor(async () => {
    try {
      await fs.access(imageLauncherPath)
      return true
    } catch {
      return false
    }
  }, 'Windows image picker launcher')
  const imageScript = await fs.readFile(imageScriptPath, 'utf-8')
  assert.match(imageScript, /OpenFileDialog/)
  assert.match(imageScript, /Image files \(\*\.png;\*\.jpg;\*\.jpeg;\*\.webp;\*\.gif;\*\.bmp;\*\.ico;\*\.svg\)/)
  await fs.writeFile(imageOutputPath, JSON.stringify({ status: 'selected', path: selectedImage }), 'utf-8')
  await waitFor(() => imageSession.status === 'selected', 'Windows image picker selection')
  assert.equal(imageSession.path, persistedImage)
  assert.equal(imageSession.sourcePath, path.resolve(selectedImage))

  assert.equal(spawnCalls.length, 2)
  assert.deepEqual(spawnCalls.map((call) => call.command), ['cmd.exe', 'cmd.exe'])
  assert(spawnCalls.every((call) => call.options?.detached === true && call.options?.windowsHide === false))
})
