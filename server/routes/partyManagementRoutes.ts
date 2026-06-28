import express from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { PartyManagementRoutesContext } from '../controlPlane'

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
    agentLocalConfigPath,
    applyExecutionWorkspaceToLocalConfig,
    applyLocalConfigToGlobal,
    avatarUploadFileName,
    canonicalAgentModelId,
    canonicalDoctrineRoot,
    cleanupAgentWorkspaceDoctrineFiles,
    clearAgentTurnSessions,
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
    normalizeAgentMdsState,
    normalizeAgentToolsConfig,
    normalizeModelWithFallback,
    normalizeRecruitAutoForgeFiles,
    normalizeRecruitMarkdownFileName,
    normalizeRecruitPersonalityDepth,
    normalizeSandboxConfig,
    persistAgentAvatarBytes,
    purgeAgentState,
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
    seedAgentWorkspace,
    splitModelId,
    syncAgentDerivedFiles,
    syncAgentProjectionToGlobal,
    terminateOpenClawRunsForSession,
    validateWorkspaceAccess,
    workspaceAccessFailurePayload,
    writeOpenclawConfig,
    writePartyProfiles,
    writeTextFileWithLockRetry,
  } = options

  app.get('/api/party/overview', async (_req, res) => {
    try {
      const party = await getPartyMembers()
      return apiSuccess(res, { party })
    } catch (error) {
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to fetch party', String(error))
    }
  })

  app.put('/api/party/profile/:agentId', async (req, res) => {
    const { agentId } = req.params
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

    const profiles = await readPartyProfiles()
    const sanitized = sanitizeProfile(parsed.data)
    profiles.agents[agentId] = sanitized
    await writePartyProfiles(profiles)

    try {
      const config = await readOpenclawConfig()
      const entry = (config.agents?.list || []).find((item) => item.id === agentId)
      const local = await ensureAgentLocalConfig({
        agentId,
        entry,
        profile: sanitized,
        defaultsModel: config.agents?.defaults?.model || {},
      })
      local.profile = sanitized
      local.agent.updatedAt = new Date().toISOString()
      await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
      await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
      await syncAgentDerivedFiles(agentId, local)
    } catch {
      // profile still persisted in party-profiles; local file sync best-effort
    }

    return apiSuccess(res, { ok: true, agentId })
  })

  app.post('/api/party/identity', async (req, res) => {
    const schema = z.object({
      agentId: z.string().min(1),
      name: z.string().optional(),
      emoji: z.string().optional(),
      theme: z.string().optional(),
      avatar: z.string().optional(),
      workspace: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const { agentId, name, emoji, theme, avatar, workspace } = parsed.data
    const args = ['agents', 'set-identity', '--agent', agentId]
    const normalizedWorkspace = workspace ? path.resolve(workspace) : undefined
    const safeAvatar = avatar ? configSafeAgentAvatar(avatar, normalizedWorkspace || WORKSPACE_ROOT) : ''
    if (normalizedWorkspace && !CANONICAL_DOCTRINE_ONLY) args.push('--workspace', normalizedWorkspace)
    if (name) args.push('--name', name)
    if (emoji) args.push('--emoji', emoji)
    if (theme) args.push('--theme', theme)
    if (safeAvatar) args.push('--avatar', safeAvatar)
    args.push('--json')

    const shouldRunCli = !CANONICAL_DOCTRINE_ONLY && args.length > 5
    const result = shouldRunCli
      ? await runOpenClaw(args, 60000)
      : { code: 0, stdout: '', stderr: '' }
    if (result.code === 0) {
      try {
        const config = await readOpenclawConfig()
        const target = (config.agents?.list || []).find((entry) => entry.id === agentId)
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
          if (avatar !== undefined) local.identity.avatar = configSafeAgentAvatar(avatar, local.routing.workspace)
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
    const normalizedAgentId = payload.agentId?.trim()
    if (normalizedAgentId && !/^[a-z0-9-]{3,60}$/.test(normalizedAgentId)) {
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
        provider: isOpenAiCodexSubscriptionModel(canonicalModelId) ? 'openai-codex' : provider,
        model,
        personalityDepth: normalizeRecruitPersonalityDepth(payload.personalityDepth),
        files: markdownFiles,
        generatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const typed = error as Error & { statusCode?: number; provider?: string; providerStatus?: unknown }
      const statusCode = typed.name === 'AbortError' ? 504 : typed.statusCode || 500
      return apiFailure(res, statusCode, 'recruit_failed', statusCode === 504
        ? 'Auto Forge timed out while waiting for the selected model.'
        : (typed.message || String(error)), {
        ok: false,
        error: statusCode === 504 ? 'Auto Forge timed out while waiting for the selected model.' : (typed.message || String(error)),
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
      name: z.string().min(1).max(80),
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
          thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
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
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const payload = parsed.data
    try {
      const config = await readOpenclawConfig()
      const profiles = await readPartyProfiles()
      if (!config.agents) config.agents = {}
      if (!config.agents.list) config.agents.list = []

      const recovered = await recoverLocalAgentEntries(config, profiles)
      if (recovered.length) {
        config.agents.list = [...config.agents.list, ...recovered]
      }

      if (config.agents.list.some((agent) => agent.id === payload.agentId)) {
        return apiFailure(res, 409, 'recruit_failed', `Agent already exists: ${payload.agentId}`)
      }

      const workspacePath = payload.workspace?.trim() ? path.resolve(payload.workspace) : WORKSPACE_ROOT
      const identityAvatar = configSafeAgentAvatar(payload.avatar, workspacePath)
      try {
        await validateWorkspaceAccess(workspacePath)
      } catch (error) {
        return apiFailure(
          res,
          400,
          'workspace_unwritable',
          'Workspace is not writable. Choose a folder you own (for example in your user profile).',
          String(error),
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

      const sanitized = sanitizeProfile({
        ...(payload.profile || {}),
        avatar: payload.avatar,
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
      local.sandbox = normalizeSandboxConfig({
        ...local.sandbox,
        mode: 'off',
        scope: 'agent',
        workspaceAccess: 'rw',
        ...(payload.sandbox || {}),
      })
      local.tools = normalizeAgentToolsConfig({
        profile: 'full',
        allow: inferredMds.toolAccess,
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
      return apiFailure(res, 500, 'recruit_failed', 'Failed to recruit agent', String(error))
    }
  })

  app.delete('/api/party/agent/:agentId', async (req, res) => {
    const agentId = (req.params.agentId || '').trim().toLowerCase()
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')
    if (agentId === 'main') return apiFailure(res, 400, 'invalid_payload', 'The main agent cannot be retired.')
    if (isRetiredAgentId(agentId)) {
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
      return apiFailure(res, 500, 'agent_retire_failed', 'Failed to retire agent', String(error))
    }
  })

  app.post('/api/party/workspace', async (req, res) => {
    const schema = z.object({
      agentId: z.string().min(1),
      workspace: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const normalizedWorkspace = path.resolve(parsed.data.workspace)
    try {
      await validateWorkspaceAccess(normalizedWorkspace)
    } catch (error) {
      return apiSuccess(res, await workspaceAccessFailurePayload(error, normalizedWorkspace))
    }

    try {
      const requestedAgent = parsed.data.agentId
      const resolved = await getAgentById(requestedAgent)
      if (!resolved.target) return apiFailure(res, 404, 'agent_not_found', `Agent not found: ${requestedAgent}`)
      const agentId = resolved.target.id
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
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to update workspace', String(error))
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

    try {
      const config = await readOpenclawConfig()
      const profiles = await readPartyProfiles()
      const requested = new Set((parsed.data.agentIds || []).filter((id) => id !== 'main'))
      const candidates = (config.agents?.list || []).filter((agent) => agent.id !== 'main')
      const selected = requested.size ? candidates.filter((agent) => requested.has(agent.id)) : candidates

      const report: Array<{
        agentId: string
        doctrineWorkspace: string
        executionWorkspace: string
        copied: string[]
        skipped: string[]
      }> = []
      for (const agent of selected) {
        if (!isValidAgentId(agent.id)) continue
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
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to provision agent resources', String(error))
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

    try {
      const config = await readOpenclawConfig()
      const defaultsModel = config.agents?.defaults?.model || {}
      const requested = new Set((parsed.data.agentIds || []).filter((id) => id !== 'main'))
      const candidates = (config.agents?.list || []).filter((agent) => agent.id !== 'main')
      const selected = requested.size ? candidates.filter((agent) => requested.has(agent.id)) : candidates

      const report: Array<Awaited<ReturnType<typeof cleanupAgentWorkspaceDoctrineFiles>>> = []
      for (const agent of selected) {
        if (!isValidAgentId(agent.id)) continue
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
      return apiFailure(res, 500, 'party_operation_failed', 'Failed to cleanup doctrine mirrors', String(error))
    }
  })

  app.get('/api/party/avatar/:agentId', async (req, res) => {
    try {
      const party = await getPartyMembers()
      const agent = party.find((member) => member.id === req.params.agentId)
      if (!agent?.avatar) return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar not set')

      if (agent.avatar.startsWith('http://') || agent.avatar.startsWith('https://')) {
        return res.redirect(agent.avatar)
      }
      if (agent.avatar.startsWith('data:')) {
        return apiFailure(res, 400, 'avatar_preview_failed', 'Data URI avatar preview is not supported through this endpoint.')
      }

      const candidate = path.isAbsolute(agent.avatar)
        ? agent.avatar
        : path.resolve(agent.workspace || WORKSPACE_ROOT, agent.avatar)
      const bytes = await fs.readFile(candidate)
      res.setHeader('Content-Type', contentTypeFromExt(candidate))
      return res.send(bytes)
    } catch (error) {
      return apiFailure(res, 404, 'avatar_preview_failed', 'Avatar preview not available', String(error))
    }
  })

  app.post('/api/party/avatar-upload/:agentId', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }), async (req, res) => {
    const agentId = String(req.params.agentId || '')
    if (!isValidAgentId(agentId)) return apiFailure(res, 400, 'invalid_payload', 'Invalid agent id.')

    try {
      const rawName = typeof req.query.filename === 'string' ? req.query.filename : 'avatar'
      const sourceName = avatarUploadFileName(rawName, req.headers['content-type'])
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
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
        error instanceof Error && error.message ? error.message : String(error),
      )
    }
  })
}
