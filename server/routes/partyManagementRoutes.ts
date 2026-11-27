import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { PartyManagementRoutesContext } from '../controlPlane'
import { assertContainedRegularFilePath } from '../services/filesystem/atomicControlFile'
import {
  AVATAR_IMAGE_TYPE_ERROR,
  AVATAR_UPLOAD_LIMIT_BYTES,
  assertAvatarImageUploadSignature as defaultAssertAvatarImageUploadSignature,
  assertAvatarUploadBytes as defaultAssertAvatarUploadBytes,
  assertAvatarUploadSize,
  isSupportedAvatarImagePath,
} from '../services/filesystem/avatarFileService'
import { isPathUnder } from '../services/filesystem/safePathService'
import { CREDITS_ONLY_MODEL_ACCESS_MESSAGE } from '../services/license/creditsOnlyModelPolicy'
import { applyDiagnosticRedactions } from '../../src/utils/diagnosticRedaction'
import {
  loadAgencyAgentTemplateCatalog,
  summarizeAgencyAgentTemplate,
  type AgencyAgentTemplateCatalog,
} from '../services/recruit/agencyAgentTemplateService'

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const AVATAR_PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  'sandbox',
].join('; ')

const AVATAR_EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

function hasNullOrControlChars(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function hasWindowsReservedDeviceOrAdsPath(filePath: string) {
  const trimmed = filePath.trim()
  if (!trimmed) return false
  const withoutDrive = trimmed.replace(/^[A-Za-z]:(?=[\\/]|$)/, '')
  if (withoutDrive.includes(':')) return true
  const segments = withoutDrive.split(/[\\/]+/).filter(Boolean)
  for (const rawSegment of segments) {
    const cleaned = rawSegment.trim().replace(/\.+$/, '')
    const stem = cleaned.split('.', 1)[0] || ''
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
      return true
    }
  }
  return false
}

function isUncOrDeviceNamespacePath(rawPath: string) {
  return /^(?:\\\\|\/\/|\\\?\?\\)/.test(rawPath.trim())
}

function redactedErrorDetail(error: unknown) {
  const raw = error instanceof Error && error.message ? error.message : String(error)
  return applyDiagnosticRedactions(raw)
}

async function hasSymlinkInPickedAvatarPath(resolvedPath: string): Promise<boolean> {
  const normalized = path.resolve(resolvedPath)
  const parsed = path.parse(normalized)
  const segments = normalized.slice(parsed.root.length).split(path.sep).filter(Boolean)
  // Check leaf and every non-top-level ancestor directory (skipping depth-1 OS
  // aliases such as macOS /var -> /private/var or /tmp -> private/tmp).
  for (let count = segments.length; count >= 2; count -= 1) {
    const candidate = path.join(parsed.root, ...segments.slice(0, count))
    const stat = await fs.lstat(candidate).catch(() => null)
    if (stat?.isSymbolicLink()) return true
  }
  return false
}

function isSafeExternalAvatarUrl(rawUrl: string) {
  if (!rawUrl || hasNullOrControlChars(rawUrl)) return false
  try {
    const parsed = new URL(rawUrl)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function fallbackConfigSafeAgentAvatar(rawAvatar: string | undefined, workspacePath: string) {
  const avatar = (rawAvatar || '').trim()
  if (!avatar || avatar.includes('\0')) return ''
  if (/^https?:\/\//i.test(avatar)) {
    return isSafeExternalAvatarUrl(avatar) ? new URL(avatar).href : ''
  }
  if (/^(?:data|file):/i.test(avatar) || isUncOrDeviceNamespacePath(avatar)) return ''
  const workspace = path.resolve(workspacePath)
  const candidate = path.isAbsolute(avatar) ? path.resolve(avatar) : path.resolve(workspace, avatar)
  if (!isPathUnder(workspace, candidate)) return ''
  return path.isAbsolute(avatar) ? candidate : avatar
}

/**
 * Owns roster, recruitment, workspace, identity, retirement, and avatar HTTP
 * contracts. Runtime state and persistence primitives stay injected so the
 * module remains testable without booting the desktop control plane.
 */
export function registerPartyManagementRoutes(app: Express, options: PartyManagementRoutesContext) {
  const {
    CANONICAL_DOCTRINE_ONLY,
    RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES,
    WORKSPACE_ROOT,
    agencyAgentTemplateSourceRoot,
    agencyAgentTemplateStateFilePath,
    agencyAgentTemplateStateKey,
    agentLocalConfigPath,
    applyExecutionWorkspaceToLocalConfig,
    applyLocalConfigToGlobal,
    assertAvatarImageUploadSignature,
    assertAvatarUploadBytes,
    avatarUploadLimitBytes,
    avatarUploadLimitErrorMessage,
    avatarUploadFileName,
    canonicalAgentModelId,
    canonicalDoctrineRoot,
    cleanupAgentWorkspaceDoctrineFiles,
    clearAgentTurnSessions,
    clearDisallowedAutoModelOverridesForAgent,
    configSafeAgentAvatar,
    contentTypeFromExt,
    defaultAgentWorkspace,
    deriveAgentAliases,
    ensureAgentLocalConfig,
    ensureAgentPersistence,
    ensureConfiguredModelAllowlist,
    extractRecruitAutoForgeJson,
    generateRecruitAutoForgeMarkdown,
    getAgentById,
    getPartyMembers,
    isLegacyGenericRecruitAttributes,
    isLegacyGenericRecruitHeartbeat,
    isLegacyGenericRecruitMds,
    isLegacyGenericRecruitRuntime,
    isLegacyGenericRecruitSoul,
    isOpenAiCodexSubscriptionModel,
    isRetiredAgentId,
    isValidAgentId,
    modelAuthProblem,
    modelSelectionBlocked,
    normalizeAgentMdsState,
    normalizeAgentToolsConfig,
    normalizeModelWithFallback,
    normalizeRecruitAutoForgeFiles,
    normalizeRecruitMarkdownFileName,
    normalizeRecruitPersonalityDepth,
    normalizeSandboxConfig,
    persistAgentAvatarBytes,
    persistAgentAvatarFromPath,
    purgeAgentState,
    readAgencyAgentTemplateCatalog,
    readControlCenterStateRecord,
    readOpenclawConfig,
    readPartyProfiles,
    recoverLocalAgentEntries,
    recruitAttributesFromProfile,
    recruitAutoForgePrompt,
    recruitHeartbeatDefaults,
    recruitMdsDefaults,
    recruitRuntimeDefaults,
    recruitSoulDefaults,
    rememberAgentLocalConfigCache,
    resolveDoctrineWorkspaceForRun,
    runOpenClaw,
    samePath,
    sanitizeProfile,
    schedulePluginGatewayRestart,
    seedAgentWorkspace,
    splitModelId,
    syncAgentDerivedFiles,
    syncAgentProjectionToGlobal,
    terminateOpenClawRunsForSession,
    validateWorkspaceAccess,
    workspaceAccessFailurePayload,
    writeAgencyAgentTemplateCatalog,
    writeControlCenterStateRecord,
    writeOpenclawConfig,
    writePartyProfiles,
    writeTextFileWithLockRetry,
  } = options

  const checkValidAgentId = (rawId: string) => {
    const normalized = rawId.trim().toLowerCase()
    if (!normalized || normalized.length > 80) return false
    if (RESERVED_OBJECT_KEYS.has(normalized)) return false
    if (normalized.startsWith('-') || /[\0\\/]/.test(normalized)) return false
    return isValidAgentId ? isValidAgentId(normalized) : /^[a-z0-9-]+$/.test(normalized)
  }

  const sanitizeRequestedAvatar = async (rawAvatar: string | undefined, workspacePath: string, agentId?: string) => {
    if (rawAvatar === undefined) return { ok: true as const, value: undefined as string | undefined }
    const trimmed = rawAvatar.trim()
    if (!trimmed) return { ok: true as const, value: '' }
    if (hasNullOrControlChars(trimmed) || trimmed.startsWith('-') || isUncOrDeviceNamespacePath(trimmed)) {
      return {
        ok: false as const,
        error: 'Avatar must be a safe workspace-relative image path or credential-free HTTP(S) URL.',
      }
    }
    const safe = configSafeAgentAvatar
      ? configSafeAgentAvatar(trimmed, workspacePath)
      : fallbackConfigSafeAgentAvatar(trimmed, workspacePath)
    if (!safe) {
      return {
        ok: false as const,
        error: 'Avatar must be a safe workspace-relative image path or credential-free HTTP(S) URL.',
      }
    }
    if (!/^https?:\/\//i.test(safe)) {
      if (isUncOrDeviceNamespacePath(safe) || hasWindowsReservedDeviceOrAdsPath(safe)) {
        return {
          ok: false as const,
          error: 'Avatar must be a safe workspace-relative image path or credential-free HTTP(S) URL.',
        }
      }
      if (!isSupportedAvatarImagePath(safe)) {
        return {
          ok: false as const,
          error: AVATAR_IMAGE_TYPE_ERROR,
        }
      }
      const workspaceBase = path.resolve(workspacePath)
      const resolvedCandidate = path.isAbsolute(safe) ? path.resolve(safe) : path.resolve(workspaceBase, safe)
      const existingStat = await fs.lstat(resolvedCandidate).catch((err: NodeJS.ErrnoException) => {
        if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null
        throw err
      })
      if (existingStat) {
        const allowedRoots = Array.from(
          new Set(
            [
              workspaceBase,
              WORKSPACE_ROOT ? path.resolve(WORKSPACE_ROOT) : '',
              agentId && defaultAgentWorkspace ? path.resolve(defaultAgentWorkspace(agentId)) : '',
              agentId && canonicalDoctrineRoot ? path.resolve(canonicalDoctrineRoot(agentId)) : '',
            ].filter(Boolean),
          ),
        )
        try {
          await assertContainedRegularFilePath(resolvedCandidate, {
            allowedRoots,
            label: 'Agent avatar',
          })
        } catch (containmentError) {
          return {
            ok: false as const,
            error: containmentError instanceof Error
              ? containmentError.message
              : 'Avatar must be a regular image file inside the agent workspace.',
          }
        }
      }
    }
    return { ok: true as const, value: safe }
  }

  app.get('/api/party/overview', async (_req, res) => {
    try {
      const party = await getPartyMembers()
      return apiSuccess(res, { party })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to fetch party', redactedErrorDetail(error))
    }
  })

  /**
   * Makes an agent the deterministic destination for otherwise-unbound inbound
   * messages. `agents.list[].default` covers every channel's fallback and the
   * generic Telegram binding prevents roster order from deciding Telegram DMs.
   */
  app.post('/api/party/default-agent', async (req, res) => {
    const schema = z.object({
      agentId: z.string().trim().min(1).max(80),
      channels: z.array(z.string().trim().min(1).max(80)).max(20).default(['telegram']),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const requestedAgentId = parsed.data.agentId.trim().toLowerCase()
    if (!checkValidAgentId(requestedAgentId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    }
    const requestedChannels = Array.from(
      new Set(parsed.data.channels.map((channel) => channel.trim().toLowerCase()).filter(Boolean)),
    )
    if (requestedChannels.some((channel) => RESERVED_OBJECT_KEYS.has(channel) || !/^[a-z0-9._-]+$/.test(channel))) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid channel name.')
    }

    try {
      const config = await readOpenclawConfig()
      const list = config.agents?.list || []
      const target = list.find((entry) => entry.id === requestedAgentId)
      if (!target || isRetiredAgentId?.(target.id)) {
        return apiFailure(res, 404, 'agent_not_found', 'Agent not found or retired.')
      }

      for (const entry of list) {
        if (entry.id === target.id) entry.default = true
        else delete entry.default
      }

      const existingBindings = Array.isArray(config.bindings) ? config.bindings : []
      const replacementBindings = existingBindings.filter((binding) => {
        const match = binding && typeof binding === 'object' && !Array.isArray(binding)
          ? (binding as { match?: { channel?: unknown; accountId?: unknown } }).match
          : undefined
        const channel = typeof match?.channel === 'string' ? match.channel.trim().toLowerCase() : ''
        const accountId = typeof match?.accountId === 'string' ? match.accountId.trim() : ''
        // Preserve account-specific routing. Replace only each channel's
        // catch-all route, which is what controls ordinary inbound messages.
        return !(requestedChannels.includes(channel) && (!accountId || accountId === '*'))
      })
      for (const channel of requestedChannels) {
        replacementBindings.push({ agentId: target.id, match: { channel, accountId: '*' } })
      }
      config.bindings = replacementBindings

      await writeOpenclawConfig(config)
      const modelOverrideCleanup = await clearDisallowedAutoModelOverridesForAgent(
        target.id,
        target.model,
        { clearManualOverrides: true },
      )
      const sessionReset = clearAgentTurnSessions(target.id)
      const gatewayRestart = schedulePluginGatewayRestart()
      return apiSuccess(res, {
        ok: true,
        agentId: target.id,
        channels: requestedChannels,
        modelOverrideCleanup,
        sessionReset,
        gatewayRestart,
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to set the default message agent.', redactedErrorDetail(error))
    }
  })

  const loadAgencyTemplates = (forceRefresh = false) => loadAgencyAgentTemplateCatalog({
    sourceRoot: agencyAgentTemplateSourceRoot,
    stateKey: agencyAgentTemplateStateKey,
    stateFilePath: agencyAgentTemplateStateFilePath,
    forceRefresh,
    readState: readControlCenterStateRecord,
    writeState: writeControlCenterStateRecord,
    readTemplateCatalog: () => readAgencyAgentTemplateCatalog<AgencyAgentTemplateCatalog>(),
    writeTemplateCatalog: writeAgencyAgentTemplateCatalog,
  })

  app.get('/api/party/recruit/templates', async (req, res) => {
    try {
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
      const catalog = await loadAgencyTemplates(refresh)
      return apiSuccess(res, {
        source: catalog.source,
        divisions: catalog.divisions,
        templates: catalog.templates.map(summarizeAgencyAgentTemplate),
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to load recruit templates', redactedErrorDetail(error))
    }
  })

  app.get('/api/party/recruit/templates/:templateId', async (req, res) => {
    const templateId = (req.params.templateId || '').trim()
    if (!templateId || templateId.length > 160 || hasNullOrControlChars(templateId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid recruit template id.')
    }
    try {
      const catalog = await loadAgencyTemplates(false)
      const template = catalog.templates.find((entry) => entry.id === templateId)
      if (!template) return apiFailure(res, 404, 'invalid_payload', 'Recruit template not found.')
      return apiSuccess(res, { template })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to load recruit template', redactedErrorDetail(error))
    }
  })

  app.put('/api/party/profile/:agentId', async (req, res) => {
    const agentId = (req.params.agentId || '').trim().toLowerCase()
    if (!checkValidAgentId(agentId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    }
    if (isRetiredAgentId?.(agentId)) {
      return apiFailure(res, 404, 'agent_not_found', 'Agent not found or retired.')
    }

    const schema = z.object({
      skills: z.array(z.string()).default([]),
      abilities: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
      className: z.string().default(''),
      role: z.string().default(''),
      behaviorProfile: z.enum(['executor', 'architect', 'auditor', 'researcher', 'hybrid']).optional(),
      motto: z.string().default(''),
      bio: z.string().default(''),
      avatar: z.string().optional(),
      level: z.number().optional(),
      stats: z
        .object({
          execution: z.number().optional(),
          reliability: z.number().optional(),
          speed: z.number().optional(),
          analysis: z.number().optional(),
          communication: z.number().optional(),
        })
        .optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const config = await readOpenclawConfig()
      let entry = (config.agents?.list || []).find((item) => item.id === agentId)
      if (!entry && getAgentById) {
        const resolved = await getAgentById(agentId)
        if (resolved.target?.id === agentId) entry = resolved.target
      }
      if (!entry || isRetiredAgentId?.(entry.id)) {
        return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      }

      const agentWorkspace = entry.workspace?.trim() ? path.resolve(entry.workspace) : (WORKSPACE_ROOT || process.cwd())
      const avatarCheck = await sanitizeRequestedAvatar(parsed.data.avatar, agentWorkspace, agentId)
      if (!avatarCheck.ok) {
        return apiFailure(res, 400, 'invalid_payload', avatarCheck.error)
      }

      const profiles = await readPartyProfiles()
      if (!profiles.agents || typeof profiles.agents !== 'object') {
        profiles.agents = {}
      }
      const sanitized = sanitizeProfile({
        ...parsed.data,
        avatar: avatarCheck.value !== undefined ? (avatarCheck.value || undefined) : undefined,
      })
      profiles.agents[agentId] = sanitized
      await writePartyProfiles(profiles)

      try {
        const local = await ensureAgentLocalConfig({
          agentId,
          entry,
          profile: sanitized,
          defaultsModel: config.agents?.defaults?.model || {},
        })
        local.profile = sanitized
        if (avatarCheck.value !== undefined) {
          local.identity.avatar = avatarCheck.value
        }
        local.agent.updatedAt = new Date().toISOString()
        await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
        await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
        await syncAgentDerivedFiles(agentId, local)
        clearAgentTurnSessions(agentId)
      } catch {
        // profile still persisted in party-profiles; local file sync best-effort
      }

      return apiSuccess(res, { ok: true, agentId })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to update agent profile', redactedErrorDetail(error))
    }
  })

  app.post('/api/party/identity', async (req, res) => {
    const schema = z.object({
      agentId: z.string().trim().min(1).max(80),
      name: z.string().max(80).optional(),
      emoji: z.string().max(32).optional(),
      theme: z.string().max(80).optional(),
      avatar: z.string().max(500).optional(),
      workspace: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const agentId = parsed.data.agentId.trim().toLowerCase()
    if (!checkValidAgentId(agentId)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    }
    if (isRetiredAgentId?.(agentId)) {
      return apiFailure(res, 404, 'agent_not_found', 'Agent not found or retired.')
    }

    const { avatar, workspace } = parsed.data
    const name = parsed.data.name !== undefined ? parsed.data.name.trim() : undefined
    const emoji = parsed.data.emoji !== undefined ? parsed.data.emoji.trim() : undefined
    const theme = parsed.data.theme !== undefined ? parsed.data.theme.trim() : undefined
    if (name !== undefined && !name) {
      return apiFailure(res, 400, 'invalid_payload', 'Agent name must not be empty.')
    }
    for (const [field, rawValue] of [
      ['name', parsed.data.name],
      ['emoji', parsed.data.emoji],
      ['theme', parsed.data.theme],
      ['avatar', avatar],
      ['workspace', workspace],
    ] as const) {
      if (rawValue !== undefined && hasNullOrControlChars(rawValue)) {
        return apiFailure(res, 400, 'invalid_payload', `Invalid characters in ${field}.`)
      }
    }
    for (const [field, rawValue] of [
      ['name', name],
      ['emoji', emoji],
      ['theme', theme],
    ] as const) {
      if (rawValue !== undefined && rawValue.startsWith('-')) {
        return apiFailure(res, 400, 'invalid_payload', `${field} must not start with '-'.`)
      }
    }

    try {
      const preflightConfig = await readOpenclawConfig()
      let preflightTarget = (preflightConfig.agents?.list || []).find((entry) => entry.id === agentId)
      if (!preflightTarget && getAgentById) {
        const resolved = await getAgentById(agentId)
        if (resolved.target?.id === agentId) preflightTarget = resolved.target
      }
      if (!preflightTarget || isRetiredAgentId?.(preflightTarget.id)) {
        return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
      }

      const trimmedWorkspace = workspace?.trim()
      if (
        trimmedWorkspace
        && (
          trimmedWorkspace.startsWith('-')
          || isUncOrDeviceNamespacePath(trimmedWorkspace)
          || hasWindowsReservedDeviceOrAdsPath(trimmedWorkspace)
        )
      ) {
        return apiFailure(res, 400, 'invalid_payload', 'Workspace must be a local folder path.')
      }
      const normalizedWorkspace = trimmedWorkspace ? path.resolve(trimmedWorkspace) : undefined
      if (normalizedWorkspace && validateWorkspaceAccess) {
        try {
          await validateWorkspaceAccess(normalizedWorkspace)
        } catch (error) {
          return apiFailure(
            res,
            400,
            'workspace_unwritable',
            'Workspace is not writable. Choose a folder you own (for example in your user profile).',
            redactedErrorDetail(error),
          )
        }
      }

      const effectiveWorkspace = normalizedWorkspace
        || (preflightTarget.workspace?.trim() ? path.resolve(preflightTarget.workspace) : (WORKSPACE_ROOT || process.cwd()))
      const avatarCheck = await sanitizeRequestedAvatar(avatar, effectiveWorkspace, agentId)
      if (!avatarCheck.ok) {
        return apiFailure(res, 400, 'invalid_payload', avatarCheck.error)
      }
      const safeAvatar = avatarCheck.value || ''

      const args = ['agents', 'set-identity', '--agent', agentId]
      if (normalizedWorkspace && !CANONICAL_DOCTRINE_ONLY) args.push('--workspace', normalizedWorkspace)
      if (name) args.push('--name', name)
      if (emoji) args.push('--emoji', emoji)
      if (theme) args.push('--theme', theme)
      if (safeAvatar) args.push('--avatar', safeAvatar)
      args.push('--json')

      const shouldRunCli = !CANONICAL_DOCTRINE_ONLY && args.length > 5
      const rawResult = shouldRunCli
        ? await runOpenClaw(args, 60000)
        : { code: 0, stdout: '', stderr: '' }
      const result = {
        code: rawResult.code,
        stdout: applyDiagnosticRedactions(rawResult.stdout || ''),
        stderr: applyDiagnosticRedactions(rawResult.stderr || ''),
      }
      if (result.code === 0) {
        try {
          const config = await readOpenclawConfig()
          const target = (config.agents?.list || []).find((entry) => entry.id === agentId) || preflightTarget
          if (target) {
            const local = await ensureAgentLocalConfig({
              agentId,
              entry: target,
              defaultsModel: config.agents?.defaults?.model || {},
            })
            if (name) {
              local.identity.name = name
              local.agent.displayName = name
              local.agent.aliases = deriveAgentAliases(agentId, name)
            }
            if (emoji) local.identity.emoji = emoji
            if (theme) local.identity.theme = theme
            if (avatarCheck.value !== undefined) {
              const localAvatarCheck = await sanitizeRequestedAvatar(
                avatarCheck.value,
                local.routing.workspace || effectiveWorkspace,
                agentId,
              )
              local.identity.avatar = localAvatarCheck.ok ? (localAvatarCheck.value || '') : ''
            }
            if (normalizedWorkspace) {
              applyExecutionWorkspaceToLocalConfig(local, normalizedWorkspace)
              await fs.mkdir(local.memory.journalDir, { recursive: true })
            }
            local.agent.updatedAt = new Date().toISOString()
            await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
            await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
            await syncAgentDerivedFiles(agentId, local)
            applyLocalConfigToGlobal(agentId, local, config)
            await writeOpenclawConfig(config)
            clearAgentTurnSessions(agentId)

            if (normalizedWorkspace && CANONICAL_DOCTRINE_ONLY) {
              await cleanupAgentWorkspaceDoctrineFiles(agentId, normalizedWorkspace, {
                dryRun: false,
                removeRootMirrors: true,
                force: true,
              })
            }
          }
        } catch {
          // keep identity update success even if local mirror update fails
        }
      }
      return apiSuccess(res, {
        ok: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to update agent identity', redactedErrorDetail(error))
    }
  })

  app.post('/api/party/recruit/auto-markdown', async (req, res) => {
    const schema = z.object({
      model: z.string().trim().min(3).max(180),
      name: z.string().trim().min(1).max(80),
      agentId: z.string().trim().max(60).optional(),
      className: z.string().trim().min(1).max(100),
      role: z.string().trim().min(1).max(260),
      behaviorProfile: z.enum(['executor', 'architect', 'auditor', 'researcher', 'hybrid']).optional(),
      level: z.number().int().min(1).max(99).optional(),
      personalityDepth: z.number().int().min(1).max(5).optional(),
      capabilities: z.record(z.string(), z.boolean()).optional(),
      files: z.array(z.string().trim().min(1).max(80)).min(1).max(24).optional(),
      currentFiles: z.record(z.string(), z.string().max(20000)).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    if (modelSelectionBlocked?.(payload.model)) {
      return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE, { modelId: payload.model })
    }
    const normalizedAgentId = payload.agentId?.trim().toLowerCase()
    if (normalizedAgentId && (!/^[a-z0-9-]{3,60}$/.test(normalizedAgentId) || !checkValidAgentId(normalizedAgentId))) {
      return apiFailure(res, 400, 'invalid_payload', 'Agent ID must be 3-60 lowercase letters, numbers, and hyphens.')
    }

    const files = (payload.files?.length ? payload.files : RECRUIT_AUTO_MARKDOWN_DEFAULT_FILES)
      .map(normalizeRecruitMarkdownFileName)
      .filter(Boolean)
    if (!files.length) return apiFailure(res, 400, 'invalid_payload', 'Auto Forge requires at least one markdown file name.')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    timeout.unref?.()

    try {
      const prompt = recruitAutoForgePrompt({
        name: payload.name,
        ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
        className: payload.className,
        role: payload.role,
        behaviorProfile: payload.behaviorProfile,
        level: payload.level,
        personalityDepth: payload.personalityDepth,
        capabilities: payload.capabilities || {},
        files,
        currentFiles: payload.currentFiles || {},
      })
      const generated = await generateRecruitAutoForgeMarkdown({
        modelId: payload.model,
        prompt,
        signal: controller.signal,
      })
      const parsedJson = extractRecruitAutoForgeJson(generated.content)
      const markdownFiles = normalizeRecruitAutoForgeFiles(parsedJson, files)
      const canonicalModelId = canonicalAgentModelId(payload.model)
      const { provider, model } = splitModelId(canonicalModelId)
      return apiSuccess(res, {
        ok: true,
        modelId: canonicalModelId,
        provider: isOpenAiCodexSubscriptionModel(canonicalModelId) ? 'openai' : provider,
        model,
        personalityDepth: normalizeRecruitPersonalityDepth(payload.personalityDepth),
        files: markdownFiles,
        generatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const typed = error as Error & { statusCode?: number; provider?: string; providerStatus?: unknown }
      const statusCode = typed.name === 'AbortError' ? 504 : typed.statusCode || 500
      const safeErrorMessage = statusCode === 504
        ? 'Auto Forge timed out while waiting for the selected model.'
        : redactedErrorDetail(typed)
      return apiFailure(res, statusCode, 'recruit_failed', safeErrorMessage, {
        ok: false,
        error: safeErrorMessage,
        ...(typed.provider ? { provider: typed.provider } : {}),
        ...(typed.providerStatus ? { providerStatus: typed.providerStatus } : {}),
      })
    } finally {
      clearTimeout(timeout)
    }
  })

  app.post('/api/party/recruit', async (req, res) => {
    const schema = z.object({
      agentId: z.string().min(3).max(60).regex(/^[a-z0-9-]+$/),
      name: z.string().trim().min(1).max(80),
      workspace: z.string().optional(),
      emoji: z.string().optional(),
      theme: z.string().optional(),
      avatar: z.string().optional(),
      profile: z
        .object({
          className: z.string().optional(),
          role: z.string().optional(),
          behaviorProfile: z.enum(['executor', 'architect', 'auditor', 'researcher', 'hybrid']).optional(),
          motto: z.string().optional(),
          bio: z.string().optional(),
          skills: z.array(z.string()).optional(),
          abilities: z.array(z.string()).optional(),
          tools: z.array(z.string()).optional(),
          level: z.number().optional(),
          stats: z
            .object({
              execution: z.number().optional(),
              reliability: z.number().optional(),
              speed: z.number().optional(),
              analysis: z.number().optional(),
              communication: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
      model: z
        .object({
          primary: z.string().optional(),
          fallbacks: z.array(z.string()).optional(),
        })
        .optional(),
      runtime: z
        .object({
          thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
          timeoutSeconds: z.number().int().min(30).max(86400).optional(),
          parallelPreferred: z.boolean().optional(),
          fastModeDefault: z.enum(['auto', 'on', 'off']).optional(),
        })
        .optional(),
      attributes: z
        .object({
          intelligence: z.number().optional(),
          speed: z.number().optional(),
          precision: z.number().optional(),
          creativity: z.number().optional(),
          stability: z.number().optional(),
          compute: z.number().optional(),
          parallelism: z.number().optional(),
        })
        .optional(),
      mds: z
        .object({
          maxContextTokens: z.number().optional(),
          delegationAllowed: z.boolean().optional(),
          subAgentSpawnLimit: z.number().optional(),
          toolAccess: z.array(z.string()).optional(),
          capabilities: z
            .object({
              codeGeneration: z.boolean().optional(),
              planning: z.boolean().optional(),
              research: z.boolean().optional(),
              orchestration: z.boolean().optional(),
              memoryManagement: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
      heartbeat: z
        .object({
          tickIntervalMs: z.number().int().min(250).max(3600000).optional(),
          maxExecutionTimeMs: z.number().int().min(1000).max(86400000).nullable().optional(),
          continuous: z.boolean().optional(),
          idleTimeoutMs: z.number().int().min(1000).max(86400000).optional(),
          recoveryMode: z.boolean().optional(),
        })
        .optional(),
      soul: z
        .object({
          personality: z.enum(['analytical', 'creative', 'aggressive', 'conservative']).optional(),
          autonomyLevel: z.number().min(0).max(100).optional(),
          riskTolerance: z.number().min(0).max(100).optional(),
          reflectionDepth: z.number().min(0).max(100).optional(),
          goalOrientation: z.number().min(0).max(100).optional(),
          persistence: z.number().min(0).max(100).optional(),
          alignmentMode: z.enum(['strict', 'balanced', 'exploratory']).optional(),
        })
        .optional(),
      sandbox: z
        .object({
          mode: z.enum(['off', 'all', 'non-main']).optional(),
          scope: z.enum(['session', 'agent', 'shared']).optional(),
          workspaceRoot: z.string().optional(),
          workspaceAccess: z.enum(['rw', 'ro', 'none']).optional(),
          docker: z.record(z.string(), z.unknown()).optional(),
          browser: z.record(z.string(), z.unknown()).optional(),
          prune: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
      tools: z
        .object({
          profile: z.string().optional(),
          allow: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        })
        .optional(),
      commandAccess: z.enum(['ask', 'full']).default('ask'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    if (!checkValidAgentId(payload.agentId) || payload.agentId === 'main') {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid or reserved agent id.')
    }
    for (const [field, rawValue] of [
      ['name', payload.name],
      ['emoji', payload.emoji],
      ['theme', payload.theme],
      ['workspace', payload.workspace],
    ] as const) {
      if (rawValue !== undefined && hasNullOrControlChars(rawValue)) {
        return apiFailure(res, 400, 'invalid_payload', `Invalid characters in ${field}.`)
      }
    }
    for (const [field, rawValue] of [
      ['name', payload.name],
      ['emoji', payload.emoji],
      ['theme', payload.theme],
    ] as const) {
      if (rawValue !== undefined && rawValue.trim().startsWith('-')) {
        return apiFailure(res, 400, 'invalid_payload', `${field} must not start with '-'.`)
      }
    }
    const blockedModel = payload.model
      && [payload.model.primary, ...(payload.model.fallbacks || [])].find((modelId) => modelId && modelSelectionBlocked?.(modelId))
    if (blockedModel) {
      return apiFailure(res, 403, 'byok_not_allowed', CREDITS_ONLY_MODEL_ACCESS_MESSAGE, { modelId: blockedModel })
    }
    try {
      const config = await readOpenclawConfig()
      const profiles = await readPartyProfiles()
      if (!config.agents) config.agents = {}
      if (!config.agents.list) config.agents.list = []

      // Run recovery BEFORE clearing any retired marker so a retired ID is not
      // resurrected from stale disk folders before preflight checks succeed.
      const recovered = await recoverLocalAgentEntries(config, profiles)
      if (recovered.length) {
        config.agents.list = [...config.agents.list, ...recovered]
      }

      if (config.agents.list.some((agent) => agent.id === payload.agentId && !isRetiredAgentId?.(agent.id))) {
        return apiFailure(res, 409, 'recruit_failed', `Agent already exists: ${payload.agentId}`)
      }

      const trimmedRecruitWorkspace = payload.workspace?.trim()
      if (
        trimmedRecruitWorkspace
        && (
          trimmedRecruitWorkspace.startsWith('-')
          || isUncOrDeviceNamespacePath(trimmedRecruitWorkspace)
          || hasWindowsReservedDeviceOrAdsPath(trimmedRecruitWorkspace)
        )
      ) {
        return apiFailure(res, 400, 'invalid_payload', 'Workspace must be a local folder path.')
      }
      const workspacePath = trimmedRecruitWorkspace ? path.resolve(trimmedRecruitWorkspace) : WORKSPACE_ROOT
      const avatarCheck = await sanitizeRequestedAvatar(payload.avatar, workspacePath, payload.agentId)
      if (!avatarCheck.ok) {
        return apiFailure(res, 400, 'invalid_payload', avatarCheck.error)
      }
      const identityAvatar = avatarCheck.value || ''
      try {
        await validateWorkspaceAccess(workspacePath)
      } catch (error) {
        return apiFailure(
          res,
          400,
          'workspace_unwritable',
          'Workspace is not writable. Choose a folder you own (for example in your user profile).',
          redactedErrorDetail(error),
        )
      }

      if (payload.model) {
        const authProblem = modelAuthProblem(payload.model.primary)
        if (authProblem) {
          return apiFailure(
            res,
            409,
            'recruit_failed',
            `Missing auth for ${authProblem.provider}. Connect this provider before recruiting with this model.`,
            { provider: authProblem.provider, providerStatus: authProblem.providerStatus },
          )
        }
      }

      // Retirement is lifecycle history, not a permanent id reservation. Clear
      // the tombstone only once all preflight checks pass so failed recruits
      // never resurrect retired agents, and replace any stale retired list row.
      await options.clearRetiredAgentId(payload.agentId)
      config.agents.list = config.agents.list.filter((agent) => agent.id !== payload.agentId)

      config.agents.list.push({
        id: payload.agentId,
        workspace: workspacePath,
        identity: {
          name: payload.name,
          emoji: payload.emoji || '@',
          theme: payload.theme || 'adventurer',
          ...(identityAvatar ? { avatar: identityAvatar } : {}),
        },
        name: payload.name,
      })

      if (!profiles.agents || typeof profiles.agents !== 'object') {
        profiles.agents = {}
      }
      const sanitized = sanitizeProfile({
        ...(payload.profile || {}),
        avatar: identityAvatar || undefined,
      })
      profiles.agents[payload.agentId] = sanitized
      await writePartyProfiles(profiles)

      const local = await ensureAgentLocalConfig({
        agentId: payload.agentId,
        entry: (config.agents?.list || []).find((entry) => entry.id === payload.agentId),
        profile: sanitized,
        defaultsModel: config.agents?.defaults?.model || {},
        defaultsSandbox: config.agents?.defaults?.sandbox,
      })
      applyExecutionWorkspaceToLocalConfig(local, workspacePath)
      const inferredMds = recruitMdsDefaults(sanitized)
      const runtimePayload = isLegacyGenericRecruitRuntime(payload.runtime) ? undefined : payload.runtime
      const attributesPayload = isLegacyGenericRecruitAttributes(payload.attributes) ? undefined : payload.attributes
      const mdsPayload = isLegacyGenericRecruitMds(payload.mds, inferredMds) ? undefined : payload.mds
      const heartbeatPayload = isLegacyGenericRecruitHeartbeat(payload.heartbeat) ? undefined : payload.heartbeat
      const soulPayload = isLegacyGenericRecruitSoul(payload.soul) ? undefined : payload.soul
      if (payload.model) {
        local.model = normalizeModelWithFallback(
          {
            primary: payload.model.primary || local.model.primary,
            fallbacks: payload.model.fallbacks || local.model.fallbacks,
          },
          config.agents?.defaults?.model || {},
        )
        ensureConfiguredModelAllowlist(config, [local.model.primary, ...local.model.fallbacks])
      }
      local.runtime = { ...recruitRuntimeDefaults(), ...(runtimePayload || {}) }
      if (payload.profile) local.profile = sanitized
      local.attributes = { ...recruitAttributesFromProfile(sanitized), ...(attributesPayload || {}) }
      local.mds = normalizeAgentMdsState(inferredMds, mdsPayload)
      local.heartbeat = { ...recruitHeartbeatDefaults(), ...(heartbeatPayload || {}) }
      local.soul = { ...recruitSoulDefaults(sanitized.behaviorProfile), ...(soulPayload || {}) }
      local.sandbox = normalizeSandboxConfig({ mode: 'off', scope: 'agent', workspaceAccess: 'rw' })
      local.tools = normalizeAgentToolsConfig({
        profile: 'full',
        exec: { host: 'gateway', security: payload.commandAccess === 'full' ? 'full' : 'allowlist', ask: payload.commandAccess === 'full' ? 'off' : 'on-miss' },
        allow: ['read', 'write', 'edit', 'apply_patch', 'session_status'],
        deny: [],
        ...(payload.tools || {}),
      })
      await fs.mkdir(local.memory.journalDir, { recursive: true })
      local.agent.updatedAt = new Date().toISOString()
      await writeTextFileWithLockRetry(agentLocalConfigPath(payload.agentId), `${JSON.stringify(local, null, 2)}\n`)
      await rememberAgentLocalConfigCache(agentLocalConfigPath(payload.agentId), local)
      await syncAgentDerivedFiles(payload.agentId, local)
      applyLocalConfigToGlobal(payload.agentId, local, config)
      await writeOpenclawConfig(config)

      return apiSuccess(res, { agentId: payload.agentId })
    } catch (error) {
      return apiFailure(res, 500, 'recruit_failed', 'Failed to recruit agent', redactedErrorDetail(error))
    }
  })

  app.delete('/api/party/agent/:agentId', async (req, res) => {
    const agentId = (req.params.agentId || '').trim().toLowerCase()
    if (!checkValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (agentId === 'main') return apiFailure(res, 400, 'invalid_payload', 'The main agent cannot be retired.')
    if (isRetiredAgentId?.(agentId)) {
      return apiSuccess(res, {
        agentId,
        alreadyRetired: true,
        workspaceDeleted: false,
        configRemoved: false,
        profileRemoved: false,
        heartbeatDefaultsRemoved: false,
        retiredIdRecorded: true,
        sessionsCleared: clearAgentTurnSessions(agentId),
        runsTerminated: terminateOpenClawRunsForSession({ agentId }),
        gatewayRestart: { restarted: false, scheduled: false, detail: 'gateway restart skipped; agent was already retired' },
        removedPaths: [],
        skippedPaths: [],
      })
    }

    try {
      const result = await purgeAgentState(agentId)
      return apiSuccess(res, {
        agentId,
        workspaceDeleted: false,
        ...result,
      })
    } catch (error) {
      return apiFailure(res, 500, 'agent_retire_failed', 'Failed to retire agent', redactedErrorDetail(error))
    }
  })

  app.post('/api/party/workspace', async (req, res) => {
    const schema = z.object({
      agentId: z.string().trim().min(1).max(80),
      workspace: z.string().trim().min(1).max(500),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const requestedAgent = parsed.data.agentId.trim().toLowerCase()
    if (!checkValidAgentId(requestedAgent)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    }
    if (hasNullOrControlChars(parsed.data.workspace)) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid characters in workspace.')
    }
    if (
      parsed.data.workspace.startsWith('-')
      || isUncOrDeviceNamespacePath(parsed.data.workspace)
      || hasWindowsReservedDeviceOrAdsPath(parsed.data.workspace)
    ) {
      return apiFailure(res, 400, 'invalid_payload', 'Workspace must be a local folder path.')
    }
    if (isRetiredAgentId?.(requestedAgent)) {
      return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${requestedAgent}`)
    }

    let resolvedTarget: { id: string } | undefined
    try {
      const resolved = await getAgentById(requestedAgent)
      if (!resolved.target || isRetiredAgentId?.(resolved.target.id)) {
        return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${requestedAgent}`)
      }
      resolvedTarget = resolved.target
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to update workspace', redactedErrorDetail(error))
    }

    const normalizedWorkspace = path.resolve(parsed.data.workspace)
    try {
      await validateWorkspaceAccess(normalizedWorkspace)
    } catch (error) {
      return apiSuccess(res, await workspaceAccessFailurePayload(error, normalizedWorkspace))
    }

    try {
      const agentId = resolvedTarget.id
      const { config } = await syncAgentProjectionToGlobal(agentId)
      const current = (config.agents?.list || []).find((entry) => entry.id === agentId)
      const currentLocal = await ensureAgentLocalConfig({
        agentId,
        entry: current,
        defaultsModel: config.agents?.defaults?.model || {},
      })
      const previousWorkspace = currentLocal.routing.workspace?.trim() || defaultAgentWorkspace(agentId)

      // Prefer official CLI write path so any internal metadata stays consistent.
      if (!CANONICAL_DOCTRINE_ONLY) {
        const cliUpdate = await runOpenClaw(
          [
            'agents',
            'set-identity',
            '--agent',
            agentId,
            '--workspace',
            normalizedWorkspace,
            '--json',
          ],
          60000,
        )
        if (cliUpdate.code !== 0) {
          console.warn(`[workspace] CLI update failed for ${agentId}: ${cliUpdate.stderr || cliUpdate.stdout}`)
        }
      }

      // Ensure config file has the selected value even if CLI write path failed.
      if (!config.agents) config.agents = {}
      if (!config.agents.list) config.agents.list = []
      const target = config.agents.list.find((entry) => entry.id === agentId)
      if (!target) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)

      const local = await ensureAgentLocalConfig({
        agentId,
        entry: target,
        defaultsModel: config.agents?.defaults?.model || {},
      })
      applyExecutionWorkspaceToLocalConfig(local, normalizedWorkspace)
      await fs.mkdir(local.memory.journalDir, { recursive: true })
      local.agent.updatedAt = new Date().toISOString()
      await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
      await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
      await syncAgentDerivedFiles(agentId, local)

      applyLocalConfigToGlobal(agentId, local, config)
      await writeOpenclawConfig(config)

      // Preserve per-agent resources when moving to a new workspace.
      if (!samePath(previousWorkspace, normalizedWorkspace)) {
        await ensureAgentPersistence(agentId, previousWorkspace)
        await ensureAgentPersistence(agentId, normalizedWorkspace)
      } else {
        await ensureAgentPersistence(agentId, normalizedWorkspace)
      }

      if (CANONICAL_DOCTRINE_ONLY) {
        await cleanupAgentWorkspaceDoctrineFiles(agentId, normalizedWorkspace, {
          dryRun: false,
          removeRootMirrors: true,
          force: true,
        })
      }

      // Verify persisted value by re-reading config from disk.
      const verify = await readOpenclawConfig()
      const persistedLocal = await ensureAgentLocalConfig({
        agentId,
        entry: (verify.agents?.list || []).find((entry) => entry.id === agentId),
        defaultsModel: verify.agents?.defaults?.model || {},
      })
      const persisted = persistedLocal.routing.workspace?.trim()
      if (!persisted || !samePath(persisted, normalizedWorkspace)) {
        return apiFailure(res, 500, 'party_operation_failed', 'Workspace update did not persist to config.', {
          agentId,
          expected: normalizedWorkspace,
          persisted: persisted || null,
        })
      }

      return apiSuccess(res, {
        ok: true,
        agentId,
        workspace: normalizedWorkspace,
        executionWorkspace: normalizedWorkspace,
        memoryDir: path.join(normalizedWorkspace, 'memory'),
        sandboxWorkspaceRoot: local.sandbox.workspaceRoot,
        doctrineWorkspace: resolveDoctrineWorkspaceForRun(agentId, normalizedWorkspace, canonicalDoctrineRoot(agentId)),
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to update workspace', redactedErrorDetail(error))
    }
  })

  app.post('/api/party/provision-resources', async (req, res) => {
    const schema = z.object({
      agentIds: z.array(z.string().min(1)).optional(),
      setWorkspace: z.boolean().default(false),
      force: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const normalizedRequestedIds = (parsed.data.agentIds || []).map((id) => id.trim().toLowerCase())
    if (normalizedRequestedIds.some((id) => !checkValidAgentId(id) || Boolean(isRetiredAgentId?.(id)))) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid or retired agent id in agentIds.')
    }

    try {
      const config = await readOpenclawConfig()
      const profiles = await readPartyProfiles()
      const requested = new Set(normalizedRequestedIds.filter((id) => id !== 'main'))
      const candidates = (config.agents?.list || []).filter(
        (agent) => agent.id !== 'main' && checkValidAgentId(agent.id) && !isRetiredAgentId?.(agent.id),
      )
      const selected = requested.size ? candidates.filter((agent) => requested.has(agent.id)) : candidates

      const report: Array<{
        agentId: string
        doctrineWorkspace: string
        executionWorkspace: string
        copied: string[]
        skipped: string[]
      }> = []
      for (const agent of selected) {
        if (!checkValidAgentId(agent.id)) continue
        const profile = sanitizeProfile(profiles.agents[agent.id] || {})
        const result = await seedAgentWorkspace(agent, profile, parsed.data.force)
        if (parsed.data.setWorkspace) {
          agent.workspace = result.targetWorkspace
        }
        const local = await ensureAgentLocalConfig({
          agentId: agent.id,
          entry: agent,
          profile,
          defaultsModel: config.agents?.defaults?.model || {},
        })
        if (parsed.data.setWorkspace) {
          applyExecutionWorkspaceToLocalConfig(local, result.targetWorkspace)
          await fs.mkdir(local.memory.journalDir, { recursive: true })
          local.agent.updatedAt = new Date().toISOString()
          await writeTextFileWithLockRetry(agentLocalConfigPath(agent.id), `${JSON.stringify(local, null, 2)}\n`)
          await rememberAgentLocalConfigCache(agentLocalConfigPath(agent.id), local)
        }
        applyLocalConfigToGlobal(agent.id, local, config)
        report.push({
          agentId: agent.id,
          doctrineWorkspace: result.targetWorkspace,
          executionWorkspace: local.routing.workspace || result.targetWorkspace,
          copied: result.copied,
          skipped: result.skipped,
        })
      }

      if (parsed.data.setWorkspace) {
        await writeOpenclawConfig(config)
      }

      return apiSuccess(res, {
        ok: true,
        provisioned: report.length,
        report,
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to provision agent resources', redactedErrorDetail(error))
    }
  })

  app.post('/api/party/workspace/cleanup-doctrine', async (req, res) => {
    const schema = z.object({
      agentIds: z.array(z.string().min(1)).optional(),
      dryRun: z.boolean().default(false),
      removeRootMirrors: z.boolean().default(true),
      force: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const normalizedRequestedIds = (parsed.data.agentIds || []).map((id) => id.trim().toLowerCase())
    if (normalizedRequestedIds.some((id) => !checkValidAgentId(id) || Boolean(isRetiredAgentId?.(id)))) {
      return apiFailure(res, 400, 'invalid_payload', 'Invalid or retired agent id in agentIds.')
    }

    try {
      const config = await readOpenclawConfig()
      const defaultsModel = config.agents?.defaults?.model || {}
      const requested = new Set(normalizedRequestedIds.filter((id) => id !== 'main'))
      const candidates = (config.agents?.list || []).filter(
        (agent) => agent.id !== 'main' && checkValidAgentId(agent.id) && !isRetiredAgentId?.(agent.id),
      )
      const selected = requested.size ? candidates.filter((agent) => requested.has(agent.id)) : candidates

      const report: Array<Awaited<ReturnType<typeof cleanupAgentWorkspaceDoctrineFiles>>> = []
      for (const agent of selected) {
        if (!checkValidAgentId(agent.id)) continue
        const local = await ensureAgentLocalConfig({
          agentId: agent.id,
          entry: agent,
          defaultsModel,
        })
        const workspace = local.routing.workspace || defaultAgentWorkspace(agent.id)
        const result = await cleanupAgentWorkspaceDoctrineFiles(agent.id, workspace, {
          dryRun: parsed.data.dryRun,
          removeRootMirrors: parsed.data.removeRootMirrors,
          force: parsed.data.force,
        })
        report.push(result)
      }

      return apiSuccess(res, {
        ok: true,
        dryRun: parsed.data.dryRun,
        force: parsed.data.force,
        agentsProcessed: report.length,
        removedCount: report.reduce((sum, item) => sum + item.removed.length, 0),
        skippedCount: report.reduce((sum, item) => sum + item.skipped.length, 0),
        report,
      })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to cleanup doctrine mirrors', redactedErrorDetail(error))
    }
  })

  app.get('/api/party/avatar/:agentId', async (req, res) => {
    const requestedAgentId = (req.params.agentId || '').trim().toLowerCase()
    if (!checkValidAgentId(requestedAgentId) || isRetiredAgentId?.(requestedAgentId)) {
      return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar not set')
    }

    try {
      const party = await getPartyMembers()
      const agent = party.find((member) => member.id.toLowerCase() === requestedAgentId)
      if (!agent?.avatar) return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar not set')

      const rawAvatar = agent.avatar.trim()
      if (!rawAvatar) return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar not set')
      if (hasNullOrControlChars(rawAvatar)) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'Invalid avatar path.')
      }

      if (/^https?:\/\//i.test(rawAvatar)) {
        if (!isSafeExternalAvatarUrl(rawAvatar)) {
          return apiFailure(res, 400, 'avatar_preview_failed', 'External avatar URL is invalid or contains credentials.')
        }
        if (rawAvatar !== agent.avatar) {
          return res.redirect(new URL(rawAvatar).href)
        }
        return res.redirect(agent.avatar)
      }
      if (/^data:/i.test(rawAvatar)) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'Data URI avatar preview is not supported through this endpoint.')
      }
      if (/^file:/i.test(rawAvatar)) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'File URI avatar preview is not supported through this endpoint.')
      }
      if (isUncOrDeviceNamespacePath(rawAvatar) || hasWindowsReservedDeviceOrAdsPath(rawAvatar)) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'Invalid avatar path.')
      }

      const workspaceBase = path.resolve(
        agent.workspace
        || (defaultAgentWorkspace ? defaultAgentWorkspace(agent.id) : '')
        || WORKSPACE_ROOT
        || process.cwd(),
      )
      const candidate = path.isAbsolute(rawAvatar)
        ? path.resolve(rawAvatar)
        : path.resolve(workspaceBase, rawAvatar)
      if (!isSupportedAvatarImagePath(candidate)) {
        return apiFailure(res, 400, 'avatar_preview_failed', AVATAR_IMAGE_TYPE_ERROR)
      }

      const memberDoctrineWorkspace = (agent as { doctrineWorkspace?: string }).doctrineWorkspace
      const allowedRoots = Array.from(
        new Set(
          [
            workspaceBase,
            memberDoctrineWorkspace ? path.resolve(memberDoctrineWorkspace) : '',
            WORKSPACE_ROOT ? path.resolve(WORKSPACE_ROOT) : '',
            defaultAgentWorkspace ? path.resolve(defaultAgentWorkspace(agent.id)) : '',
            canonicalDoctrineRoot ? path.resolve(canonicalDoctrineRoot(agent.id)) : '',
          ].filter(Boolean),
        ),
      )

      let containedAvatarPath: string
      try {
        containedAvatarPath = await assertContainedRegularFilePath(candidate, {
          allowedRoots,
          label: 'Agent avatar',
        })
      } catch (containmentError) {
        const message = containmentError instanceof Error ? containmentError.message : 'Invalid avatar path.'
        return apiFailure(res, 400, 'avatar_preview_failed', message)
      }

      const stat = await fs.stat(containedAvatarPath)
      if (!stat.isFile()) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'Agent avatar must be a regular file.')
      }
      const effectiveLimitBytes = avatarUploadLimitBytes ?? AVATAR_UPLOAD_LIMIT_BYTES
      try {
        assertAvatarUploadSize(stat.size, effectiveLimitBytes)
      } catch (sizeError) {
        const message = sizeError instanceof Error ? sizeError.message : 'Avatar file exceeds size limit.'
        return apiFailure(res, 400, 'avatar_preview_failed', message)
      }

      const bytes = await fs.readFile(containedAvatarPath)
      try {
        const checkBytes = assertAvatarUploadBytes ?? defaultAssertAvatarUploadBytes
        const checkSignature = assertAvatarImageUploadSignature ?? defaultAssertAvatarImageUploadSignature
        checkBytes(bytes, effectiveLimitBytes)
        checkSignature(bytes, containedAvatarPath)
      } catch (signatureError) {
        const message = signatureError instanceof Error ? signatureError.message : 'Avatar image failed validation.'
        return apiFailure(res, 400, 'avatar_preview_failed', message)
      }

      const ext = path.extname(containedAvatarPath).toLowerCase()
      const resolvedContentType = AVATAR_EXTENSION_CONTENT_TYPES[ext]
        || contentTypeFromExt?.(containedAvatarPath)
        || 'application/octet-stream'
      res.setHeader('Content-Type', resolvedContentType)
      res.setHeader('Cache-Control', 'no-store, max-age=0')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', AVATAR_PREVIEW_CONTENT_SECURITY_POLICY)
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
      return res.send(bytes)
    } catch (error) {
      return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar preview not available', redactedErrorDetail(error))
    }
  })

  const avatarUploadBodyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    const typed = error as { status?: unknown; statusCode?: unknown; type?: unknown }
    if (typed?.type === 'entity.too.large' || typed?.status === 413 || typed?.statusCode === 413) {
      return apiFailure(
        res,
        413,
        'avatar_upload_failed',
        'Avatar upload failed',
        avatarUploadLimitErrorMessage(avatarUploadLimitBytes),
      )
    }
    return next(error)
  }

  app.post('/api/party/avatar-upload/:agentId', express.raw({
    type: ['image/*', 'application/octet-stream'],
    limit: avatarUploadLimitBytes,
  }), avatarUploadBodyErrorHandler, async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId || '').trim().toLowerCase()
    if (!checkValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (isRetiredAgentId?.(agentId)) return apiFailure(res, 404, 'agent_not_found', 'Agent not found or retired.')
    if (getAgentById) {
      try {
        const resolved = await getAgentById(agentId)
        if (!resolved.target || isRetiredAgentId?.(resolved.target.id)) {
          return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
        }
      } catch (error) {
        return apiFailure(res, 500, 'party_operation_failed', 'Failed to resolve agent for avatar update', redactedErrorDetail(error))
      }
    }

    try {
      const rawName = typeof req.query.filename === 'string' ? req.query.filename : 'avatar'
      const sourceName = avatarUploadFileName(rawName, req.headers['content-type'])
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      assertAvatarUploadBytes(bytes, avatarUploadLimitBytes)
      assertAvatarImageUploadSignature(bytes, sourceName, req.headers['content-type'])
      const persisted = await persistAgentAvatarBytes(agentId, bytes, sourceName)
      return apiSuccess(res, {
        status: 'selected',
        sourcePath: null,
        path: persisted.avatarPath,
        avatar: persisted.avatar,
        previewUrl: persisted.previewUrl,
        detail: 'Profile picture selected.',
      })
    } catch (error) {
      return apiFailure(
        res,
        400,
        'avatar_upload_failed',
        'Avatar upload failed',
        redactedErrorDetail(error),
      )
    }
  })

  app.post('/api/party/avatar-path/:agentId', async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId || '').trim().toLowerCase()
    if (!checkValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (isRetiredAgentId?.(agentId)) return apiFailure(res, 404, 'agent_not_found', 'Agent not found or retired.')

    const schema = z.object({
      path: z.string().trim().min(1).max(500),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const requestedPath = parsed.data.path.trim()
    if (
      hasNullOrControlChars(requestedPath)
      || requestedPath.startsWith('-')
      || hasWindowsReservedDeviceOrAdsPath(requestedPath)
      || isUncOrDeviceNamespacePath(requestedPath)
      || /^(?:file|data|https?):/i.test(requestedPath)
    ) {
      return apiFailure(res, 400, 'avatar_upload_failed', 'Avatar upload failed', 'Invalid avatar file path.')
    }
    if (!isSupportedAvatarImagePath(requestedPath)) {
      return apiFailure(res, 400, 'avatar_upload_failed', 'Avatar upload failed', AVATAR_IMAGE_TYPE_ERROR)
    }

    if (getAgentById) {
      try {
        const resolved = await getAgentById(agentId)
        if (!resolved.target || isRetiredAgentId?.(resolved.target.id)) {
          return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${agentId}`)
        }
      } catch (error) {
        return apiFailure(res, 500, 'party_operation_failed', 'Failed to resolve agent for avatar update', redactedErrorDetail(error))
      }
    }

    try {
      const resolvedRequestedPath = path.resolve(requestedPath)
      const candidateStat = await fs.lstat(resolvedRequestedPath).catch(() => null)
      if (!candidateStat) {
        return apiFailure(
          res,
          400,
          'avatar_upload_failed',
          'Avatar upload failed',
          'Selected avatar file does not exist.',
        )
      }
      if (
        candidateStat.isSymbolicLink()
        || !candidateStat.isFile()
        || await hasSymlinkInPickedAvatarPath(resolvedRequestedPath)
      ) {
        return apiFailure(
          res,
          400,
          'avatar_upload_failed',
          'Avatar upload failed',
          'Selected avatar must be a regular image file, not a symbolic link or directory.',
        )
      }
      const persisted = await persistAgentAvatarFromPath(agentId, resolvedRequestedPath)
      return apiSuccess(res, {
        status: 'selected',
        sourcePath: persisted.sourcePath,
        path: persisted.avatarPath,
        avatar: persisted.avatar,
        previewUrl: persisted.previewUrl,
        detail: 'Profile picture selected.',
      })
    } catch (error) {
      return apiFailure(
        res,
        400,
        'avatar_upload_failed',
        'Avatar upload failed',
        redactedErrorDetail(error),
      )
    }
  })
}
