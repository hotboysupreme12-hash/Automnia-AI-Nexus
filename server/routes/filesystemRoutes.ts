import type { Express } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { PickerSessionService } from '../services/filesystem/pickerSessionService'
import {
  ControlFileConflict,
  assertContainedRegularFilePath,
  controlFileRevision,
  normalizedLockKey,
  writeAtomicControlFile,
} from '../services/filesystem/atomicControlFile'

type AgentIdentity = {
  name?: string
  emoji?: string
  theme?: string
  avatar?: string
}

type AgentModelSelection = {
  primary?: string
  fallbacks?: string[]
}

type AgentConfigEntry = {
  id: string
  workspace?: string
  agentDir?: string
  identity?: AgentIdentity
  name?: string
  model?: AgentModelSelection
  [key: string]: unknown
}

type OpenClawConfigFile = {
  agents?: {
    list?: AgentConfigEntry[]
    defaults?: {
      workspace?: string
      model?: AgentModelSelection
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

type AgentLocalConfig = {
  agent: {
    displayName: string
    aliases: string[]
    updatedAt: string
    [key: string]: unknown
  }
  identity: {
    name: string
    emoji?: string
    theme?: string
    avatar?: string
  }
  routing?: {
    workspace?: string
    canonicalFolder?: string
  }
  [key: string]: unknown
}

type AgentResourceContext = {
  config: OpenClawConfigFile
  target: AgentConfigEntry
  workspace: string
  executionWorkspace: string
  canonicalWorkspace: string
  doctrineWorkspace: string
}

export type FilesystemRoutesOptions = {
  agentLocalConfigPath: (agentId: string) => string
  applyLocalConfigToGlobal: (agentId: string, local: AgentLocalConfig, config: OpenClawConfigFile) => void
  canonicalResourcePath: (agentId: string, file: string) => string
  deriveAgentAliases: (agentId: string, displayName: string) => string[]
  editorResourceFiles: readonly string[]
  ensureAgentLocalConfig: (params: {
    agentId: string
    entry?: AgentConfigEntry
    defaultsModel?: AgentModelSelection
  }) => Promise<AgentLocalConfig>
  extractIdentityNameFromMarkdown: (markdown: string) => string | null
  getAgentById: (agentId: string) => Promise<{ config: OpenClawConfigFile; target?: AgentConfigEntry }>
  isMarkdownResourceFile: (file: string) => boolean
  isValidAgentId: (agentId: string) => boolean
  mirrorSharedTeamFile: (file: string, content: string) => Promise<void>
  pickerSessions: PickerSessionService
  propagateDisplayNameAcrossAgentFiles: (agentId: string, previousName: string | null, local: AgentLocalConfig) => Promise<void>
  readAgentLocalConfigIfPresent: (agentId: string) => Promise<AgentLocalConfig | null | undefined>
  rememberAgentLocalConfigCache: (filePath: string, local: AgentLocalConfig) => Promise<void>
  resetAgentTurnSessionsForAgentContextChange: (agentId: string, reason: string) => { sessions: number; histories: number }
  resolveAgentResourceContext: (agentId: string, seedFiles?: readonly string[]) => Promise<AgentResourceContext | null>
  resolveWorkspaceForAgent: (target: AgentConfigEntry | undefined, agentId: string, defaultsWorkspace?: string) => string
  samePath: (left: string, right: string) => boolean
  saveAgentFileToCodexProfile: (agentId: string, file: string, content: string) => Promise<void>
  sharedTeamFiles: readonly string[]
  syncDoctrineToWorkspace: (agentId: string, workspace: string) => Promise<void>
  syncAgentDerivedFiles: (agentId: string, local: AgentLocalConfig) => Promise<void>
  workspaceRoot: string
  writeOpenclawConfig: (config: OpenClawConfigFile) => Promise<void>
  writeTextFileWithLockRetry: (filePath: string, content: string) => Promise<void>
}

const FOLDER_LIST_CACHE_MS = 30_000
const MAX_FOLDER_LIST_CACHE_ENTRIES = 128
const MAX_IDENTITY_DISPLAY_NAME_LENGTH = 120
const WINDOWS_RESERVED_BASENAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

class ResourceContainmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceContainmentError'
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function isSafeMarkdownResourceName(file: string, isMarkdownResourceFile: (candidate: string) => boolean): boolean {
  if (!file || file !== file.trim()) return false
  if (hasControlCharacters(file)) return false
  if (file.includes('/') || file.includes('\\') || file.includes(':')) return false
  if (path.basename(file) !== file) return false
  if (file === '.' || file === '..' || file.startsWith('..')) return false
  if (WINDOWS_RESERVED_BASENAME_PATTERN.test(file)) return false
  return isMarkdownResourceFile(file)
}

function stripAnsiCodes(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x1b && value[index + 1] === '[') {
      let cursor = index + 2
      while (cursor < value.length && ((value[cursor] >= '0' && value[cursor] <= '9') || value[cursor] === ';')) {
        cursor += 1
      }
      if (
        cursor < value.length &&
        ((value[cursor] >= 'A' && value[cursor] <= 'Z') || (value[cursor] >= 'a' && value[cursor] <= 'z'))
      ) {
        index = cursor
        continue
      }
    }
    result += value[index]
  }
  return result
}

export function sanitizeExtractedIdentityName(rawName: string | null | undefined): string | null {
  if (typeof rawName !== 'string') return null
  const withoutAnsi = stripAnsiCodes(rawName)
  let cleaned = ''
  for (let index = 0; index < withoutAnsi.length; index += 1) {
    const code = withoutAnsi.charCodeAt(index)
    cleaned += code <= 31 || code === 127 ? ' ' : withoutAnsi[index]
  }
  const normalized = cleaned.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > MAX_IDENTITY_DISPLAY_NAME_LENGTH) return null
  if (normalized.startsWith('-')) return null
  return normalized
}

export function isDisallowedFolderListQueryPath(rawPath: string): boolean {
  if (hasControlCharacters(rawPath)) return true
  const trimmed = rawPath.trim()
  if (!trimmed) return false
  if (/^[\\/]{2}/.test(trimmed)) return true
  if (/^\\\?\?\\/.test(trimmed)) return true
  if (/^(?:https?|file|smb|dav|davs|ftp):/i.test(trimmed)) return true
  if (trimmed.split(/[\\/]+/).some((segment) => WINDOWS_RESERVED_BASENAME_PATTERN.test(segment))) return true
  const winNormalized = path.win32.normalize(trimmed)
  if (winNormalized.startsWith('\\\\') || /^\\\?\?\\/.test(winNormalized)) return true
  return false
}

async function assertCanonicalResourceFileContained(canonicalWorkspace: string, filePath: string): Promise<string> {
  const resolvedCanonical = path.resolve(canonicalWorkspace)
  const workspaceStats = await fs.lstat(resolvedCanonical).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (workspaceStats) {
    if (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory()) {
      throw new ResourceContainmentError('Canonical resource workspace must be a regular directory.')
    }
  }

  try {
    return await assertContainedRegularFilePath(filePath, {
      allowedRoots: [resolvedCanonical],
      label: 'Resource file',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ResourceContainmentError(message)
  }
}

function resourceSeedFiles(options: FilesystemRoutesOptions, file: string) {
  return options.editorResourceFiles.includes(file) ? [file] : []
}

export function registerFilesystemRoutes(app: Express, options: FilesystemRoutesOptions) {
  const folderListCache = new Map<string, { expiresAt: number; value: { base: string; folders: string[] } }>()
  const resourceMutationLocks = new Map<string, Promise<unknown>>()

  function withResourceMutationLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const key = normalizedLockKey(filePath)
    const pending = (resourceMutationLocks.get(key) || Promise.resolve()).catch(() => undefined).then(operation)
    resourceMutationLocks.set(key, pending)
    void pending.finally(() => {
      if (resourceMutationLocks.get(key) === pending) resourceMutationLocks.delete(key)
    }).catch(() => undefined)
    return pending
  }

  function readCachedFolderList(cacheKey: string, nowMs: number) {
    const cached = folderListCache.get(cacheKey)
    if (!cached) return null
    if (cached.expiresAt <= nowMs) {
      folderListCache.delete(cacheKey)
      return null
    }
    folderListCache.delete(cacheKey)
    folderListCache.set(cacheKey, cached)
    return cloneJson(cached.value)
  }

  function writeCachedFolderList(cacheKey: string, value: { base: string; folders: string[] }, nowMs: number) {
    for (const [key, entry] of folderListCache) {
      if (entry.expiresAt <= nowMs) folderListCache.delete(key)
    }
    if (folderListCache.has(cacheKey)) folderListCache.delete(cacheKey)
    while (folderListCache.size >= MAX_FOLDER_LIST_CACHE_ENTRIES) {
      const oldestKey = folderListCache.keys().next().value
      if (oldestKey === undefined) break
      folderListCache.delete(oldestKey)
    }
    folderListCache.set(cacheKey, {
      expiresAt: nowMs + FOLDER_LIST_CACHE_MS,
      value: cloneJson(value),
    })
  }

  app.get('/api/party/resources/:agentId', async (req, res) => {
    const { agentId } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')

    try {
      const context = await options.resolveAgentResourceContext(agentId)
      if (!context) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      const workspaceStats = await fs.lstat(path.resolve(context.canonicalWorkspace)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (workspaceStats && (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory())) {
        return apiFailure(res, 400, 'invalid_payload', 'Canonical resource workspace must be a regular directory.')
      }
      const entries = workspaceStats ? await fs.readdir(context.canonicalWorkspace, { withFileTypes: true }) : []
      const files = entries
        .filter((entry) => entry.isFile() && isSafeMarkdownResourceName(entry.name, options.isMarkdownResourceFile))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
      return apiSuccess(res, {
        agentId,
        workspace: context.workspace,
        executionWorkspace: context.executionWorkspace,
        canonicalWorkspace: context.canonicalWorkspace,
        doctrineWorkspace: context.doctrineWorkspace,
        files,
      })
    } catch (error) {
      return apiFailure(res, 500, 'filesystem_operation_failed', 'Failed to fetch agent resources', String(error))
    }
  })

  app.get('/api/party/resources/:agentId/:file', async (req, res) => {
    const { agentId, file } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (!isSafeMarkdownResourceName(file, options.isMarkdownResourceFile)) {
      return apiFailure(res, 400, 'invalid_payload', 'Resource file not allowed.')
    }

    try {
      const context = await options.resolveAgentResourceContext(agentId, resourceSeedFiles(options, file))
      if (!context) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      const filePath = options.canonicalResourcePath(agentId, file)
      await assertCanonicalResourceFileContained(context.canonicalWorkspace, filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      await assertCanonicalResourceFileContained(context.canonicalWorkspace, filePath)
      return apiSuccess(res, {
        agentId,
        workspace: context.workspace,
        executionWorkspace: context.executionWorkspace,
        canonicalWorkspace: context.canonicalWorkspace,
        doctrineWorkspace: context.doctrineWorkspace,
        file,
        resourcePath: filePath,
        content,
        revision: controlFileRevision(content),
      })
    } catch (error) {
      if (error instanceof ResourceContainmentError) {
        return apiFailure(res, 400, 'invalid_payload', error.message)
      }
      const status = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500
      return apiFailure(
        res,
        status,
        status === 404 ? 'resource_not_found' : 'filesystem_operation_failed',
        status === 404 ? 'Resource file not found' : 'Could not read resource file',
        String(error),
      )
    }
  })

  app.put('/api/party/resources/:agentId/:file', async (req, res) => {
    const { agentId, file } = req.params
    if (!options.isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (!isSafeMarkdownResourceName(file, options.isMarkdownResourceFile)) {
      return apiFailure(res, 400, 'invalid_payload', 'Resource file not allowed.')
    }
    const schema = z.object({
      content: z.string().max(2_000_000),
      expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const initialContext = await options.resolveAgentResourceContext(agentId, resourceSeedFiles(options, file))
      if (!initialContext) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      const filePath = options.canonicalResourcePath(agentId, file)

      const payload = await withResourceMutationLock(filePath, async () => {
        const context = await options.resolveAgentResourceContext(agentId, resourceSeedFiles(options, file))
        if (!context) return null
        await assertCanonicalResourceFileContained(context.canonicalWorkspace, filePath)
        await fs.mkdir(context.canonicalWorkspace, { recursive: true })
        await assertCanonicalResourceFileContained(context.canonicalWorkspace, filePath)

        const revision = await writeAtomicControlFile(filePath, parsed.data.content, parsed.data.expectedRevision)
        const persisted = await fs.readFile(filePath, 'utf-8')
        if (persisted !== parsed.data.content) {
          throw new Error('Canonical save verification failed.')
        }
        await options.saveAgentFileToCodexProfile(agentId, file, parsed.data.content)

        if (file.toUpperCase() === 'IDENTITY.MD') {
          const parsedName = sanitizeExtractedIdentityName(options.extractIdentityNameFromMarkdown(parsed.data.content))
          if (parsedName) {
            const existingLocal = await options.readAgentLocalConfigIfPresent(agentId)
            const currentName = existingLocal?.identity?.name || context.target.identity?.name || context.target.name || ''
            if (parsedName !== currentName) {
              const local = await options.ensureAgentLocalConfig({
                agentId,
                entry: context.target,
                defaultsModel: context.config.agents?.defaults?.model || {},
              })
              const previousName = local.identity.name || local.agent.displayName || ''
              local.identity.name = parsedName
              local.agent.displayName = parsedName
              local.agent.aliases = options.deriveAgentAliases(agentId, parsedName)
              local.agent.updatedAt = new Date().toISOString()
              await options.writeTextFileWithLockRetry(options.agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
              await options.rememberAgentLocalConfigCache(options.agentLocalConfigPath(agentId), local)
              await options.propagateDisplayNameAcrossAgentFiles(agentId, previousName, local)
              options.applyLocalConfigToGlobal(agentId, local, context.config)
              await options.writeOpenclawConfig(context.config)
            }
          }
        }

        if (options.sharedTeamFiles.includes(file)) {
          await options.mirrorSharedTeamFile(file, parsed.data.content)
        }
        const localForRuntimeSync = await options.ensureAgentLocalConfig({
          agentId,
          entry: context.target,
          defaultsModel: context.config.agents?.defaults?.model || {},
        })
        await options.syncAgentDerivedFiles(agentId, localForRuntimeSync)
        options.resetAgentTurnSessionsForAgentContextChange(agentId, 'agent markdown changed')
        if (!options.samePath(context.executionWorkspace, context.canonicalWorkspace)) {
          await options.syncDoctrineToWorkspace(agentId, context.executionWorkspace)
        }
        return {
          agentId,
          workspace: context.workspace,
          executionWorkspace: context.executionWorkspace,
          canonicalWorkspace: context.canonicalWorkspace,
          doctrineWorkspace: context.doctrineWorkspace,
          file,
          resourcePath: filePath,
          revision,
        }
      })

      if (!payload) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      return apiSuccess(res, payload)
    } catch (error) {
      if (error instanceof ResourceContainmentError) return apiFailure(res, 400, 'invalid_payload', error.message)
      if (error instanceof ControlFileConflict) return apiFailure(res, 409, 'resource_conflict', error.message)
      return apiFailure(res, 500, 'filesystem_operation_failed', 'Failed to update resource file', String(error))
    }
  })

  app.get('/api/party/folders', async (req, res) => {
    if (req.query.path !== undefined && typeof req.query.path !== 'string') {
      return apiFailure(res, 400, 'invalid_payload', 'Folder path query must be a string.')
    }
    const rawQueryPath = typeof req.query.path === 'string' ? req.query.path : ''
    if (rawQueryPath && isDisallowedFolderListQueryPath(rawQueryPath)) {
      return apiFailure(res, 400, 'invalid_payload', 'Network share, UNC, device, or malformed folder paths are not allowed.')
    }
    const base = rawQueryPath.trim() ? rawQueryPath.trim() : options.workspaceRoot
    const full = path.resolve(base)
    if (process.platform === 'win32' && full.startsWith('\\\\')) {
      return apiFailure(res, 400, 'invalid_payload', 'UNC or Win32 device folder paths are not allowed.')
    }
    try {
      const nowMs = Date.now()
      const cacheKey = process.platform === 'win32' ? full.toLowerCase() : full
      const cached = readCachedFolderList(cacheKey, nowMs)
      if (cached) {
        return apiSuccess(res, cached)
      }
      const folderStats = await fs.lstat(full)
      if (folderStats.isSymbolicLink()) {
        const linkTarget = await fs.readlink(full).catch(() => '')
        const normalizedLocalLinkTarget = linkTarget.replace(/^\\\\\?\\(?=[A-Za-z]:[\\/])/, '')
        if (!normalizedLocalLinkTarget || isDisallowedFolderListQueryPath(normalizedLocalLinkTarget)) {
          return apiFailure(res, 400, 'invalid_payload', 'Network share, UNC, device, or malformed folder paths are not allowed.')
        }
      }
      const entries = await fs.readdir(full, { withFileTypes: true })
      const folders = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(full, entry.name))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 200)
      const payload = { base: full, folders }
      writeCachedFolderList(cacheKey, payload, nowMs)
      return apiSuccess(res, payload)
    } catch (error) {
      return apiFailure(res, 400, 'folder_list_failed', 'Could not list folders', String(error))
    }
  })

  app.post('/api/party/folder-picker', async (req, res) => {
    const schema = z.object({
      startPath: z.string().max(4096).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const safeRawStartPath = parsed.data.startPath && !isDisallowedFolderListQueryPath(parsed.data.startPath)
        ? parsed.data.startPath
        : undefined
      const startPath = options.pickerSessions.normalizePickerStartPath(safeRawStartPath)
      const controller = new AbortController()
      req.once('aborted', () => controller.abort())
      const picked = await options.pickerSessions.pickFolderWithOsDialog(startPath, controller.signal)
      if (res.writableEnded) return

      if (picked.ok && picked.path) {
        return apiSuccess(res, { status: 'selected', path: path.resolve(picked.path), cancelled: false, detail: 'Folder selected.' })
      }
      if (picked.cancelled) {
        return apiSuccess(res, { status: 'cancelled', path: null, cancelled: true, detail: 'No folder selected.' })
      }
      return apiFailure(
        res,
        501,
        'folder_picker_failed',
        'Folder picker unavailable',
        picked.detail || 'No supported native folder picker is available in this environment.',
      )
    } catch (error) {
      if (res.writableEnded) return
      return apiFailure(res, 500, 'folder_picker_failed', 'Failed to open folder picker', String(error))
    }
  })

  app.post('/api/party/folder-picker/start', async (req, res) => {
    const schema = z.object({
      startPath: z.string().max(4096).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const safeRawStartPath = parsed.data.startPath && !isDisallowedFolderListQueryPath(parsed.data.startPath)
        ? parsed.data.startPath
        : undefined
      const startPath = options.pickerSessions.normalizePickerStartPath(safeRawStartPath)
      const session = options.pickerSessions.startFolderPickerSession(startPath)
      return apiSuccess(res, options.pickerSessions.serializeFolderPickerSession(session))
    } catch (error) {
      return apiFailure(res, 500, 'folder_picker_failed', 'Failed to start folder picker', String(error))
    }
  })

  app.get('/api/party/folder-picker/:sessionId', (req, res) => {
    options.pickerSessions.pruneFolderPickerSessions()
    const session = options.pickerSessions.getFolderPickerSession(String(req.params.sessionId || ''))
    if (!session) {
      return apiFailure(
        res,
        404,
        'folder_picker_failed',
        'Folder picker session not found.',
        'The folder picker session expired. Press Browse again.',
      )
    }
    return apiSuccess(res, options.pickerSessions.serializeFolderPickerSession(session))
  })

  app.post('/api/party/avatar-picker/start', async (req, res) => {
    const schema = z.object({
      agentId: z.string().min(1),
      startPath: z.string().max(4096).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())
    if (!options.isValidAgentId(parsed.data.agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')

    try {
      const { config, target } = await options.getAgentById(parsed.data.agentId)
      if (!target) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${parsed.data.agentId}`)

      const fallbackStart = path.resolve(options.resolveWorkspaceForAgent(target, target.id, config.agents?.defaults?.workspace))
      const safeRawStartPath = parsed.data.startPath && !isDisallowedFolderListQueryPath(parsed.data.startPath)
        ? parsed.data.startPath
        : undefined
      const startPath = options.pickerSessions.normalizePickerStartPath(safeRawStartPath, fallbackStart)
      const session = options.pickerSessions.startImagePickerSession(target.id, startPath)
      return apiSuccess(res, options.pickerSessions.serializeImagePickerSession(session))
    } catch (error) {
      return apiFailure(res, 500, 'image_picker_failed', 'Failed to start image picker', String(error))
    }
  })

  app.get('/api/party/avatar-picker/:sessionId', (req, res) => {
    options.pickerSessions.pruneFolderPickerSessions()
    const session = options.pickerSessions.getImagePickerSession(String(req.params.sessionId || ''))
    if (!session) {
      return apiFailure(
        res,
        404,
        'image_picker_failed',
        'Image picker session not found.',
        'The image picker session expired. Press Browse again.',
      )
    }
    return apiSuccess(res, options.pickerSessions.serializeImagePickerSession(session))
  })
}
