import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { AgentConfigRoutesContext } from '../controlPlane'

/**
 * Registers agent configuration and model routes. Domain behavior is supplied
 * by the control-plane composition root so this module owns HTTP validation
 * and response semantics without duplicating runtime state.
 */
export function registerAgentConfigRoutes(app: Express, options: AgentConfigRoutesContext) {
  const {
    KNOWN_UNAVAILABLE_MODEL_IDS,
    agentLocalConfigPath,
    applyExecutionWorkspaceToLocalConfig,
    applyLocalConfigToGlobal,
    canonicalAgentModelId,
    clearDisallowedAutoModelOverridesForAgent,
    deriveAgentAliases,
    ensureAgentLocalConfig,
    ensureConfiguredModelAllowlist,
    getAgentById,
    isLegacyGenericRecruitAttributes,
    isLegacyGenericRecruitHeartbeat,
    isLegacyGenericRecruitMds,
    isLegacyGenericRecruitRuntime,
    isLegacyGenericRecruitSoul,
    modelAuthProblem,
    normalizeAgentMdsState,
    normalizeAgentToolsConfig,
    normalizeModelWithFallback,
    normalizeSandboxConfig,
    propagateDisplayNameAcrossAgentFiles,
    readPartyProfiles,
    recruitAttributesFromProfile,
    recruitHeartbeatDefaults,
    recruitMdsDefaults,
    recruitRuntimeDefaults,
    recruitSoulDefaults,
    rememberAgentLocalConfigCache,
    resetAgentTurnSessionsForAgentContextChange,
    resetAgentTurnSessionsForModelChange,
    sanitizeProfile,
    schedulePluginGatewayRestart,
    syncAgentDerivedFiles,
    syncAllAgentLocalConfigs,
    validateWorkspaceAccess,
    writeOpenclawConfig,
    writePartyProfiles,
    writeTextFileWithLockRetry,
  } = options

  app.get('/api/party/agent/:agentId/config', async (req, res) => {
    const requestedAgent = req.params.agentId
    const { config, target } = await getAgentById(requestedAgent)
    if (!target) return apiFailure(res, 404, 'agent_not_found', 'Agent not found')

    const local = await ensureAgentLocalConfig({
      agentId: target.id,
      entry: target,
      defaultsModel: config.agents?.defaults?.model || {},
      defaultsSandbox: config.agents?.defaults?.sandbox,
    })

    return apiSuccess(res, {
      agentId: target.id,
      path: agentLocalConfigPath(target.id),
      config: local,
    })
  })

  app.post('/api/party/configs/sync', async (_req, res) => {
    try {
      const result = await syncAllAgentLocalConfigs()
      return apiSuccess(res, { ok: true, ...result })
    } catch (error) {
      return apiFailure(res, 500, 'agent_config_sync_failed', 'Failed to sync agent configs', String(error))
    }
  })

  app.post('/api/party/agent/:agentId/config', async (req, res) => {
    const requestedAgent = req.params.agentId
    const { config, target } = await getAgentById(requestedAgent)
    if (!target) return apiFailure(res, 404, 'agent_not_found', 'Agent not found')

    const schema = z.object({
      identity: z
        .object({
          name: z.string().optional(),
          emoji: z.string().optional(),
          theme: z.string().optional(),
          avatar: z.string().optional(),
        })
        .optional(),
      routing: z
        .object({
          workspace: z.string().optional(),
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
          skillLibrary: z
            .object({
              knownSkills: z
                .array(z.object({
                  id: z.string(),
                  name: z.string(),
                  description: z.string(),
                  source: z.enum(['bundled', 'library', 'agent', 'learned', 'clawhub']),
                  path: z.string().optional(),
                  learnedAt: z.string().optional(),
                  xpValue: z.number().optional(),
                }))
                .max(100)
                .optional(),
              preferredSkills: z.array(z.string()).max(100).optional(),
              lastSyncedAt: z.string().optional(),
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
      auth: z
        .object({
          providers: z
            .record(z.string(), z.object({ mode: z.enum(['oauth', 'apiKey']), apiKey: z.string().optional() }))
            .optional(),
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
          byProvider: z
            .record(
              z.string(),
              z.object({
                profile: z.string().optional(),
                allow: z.array(z.string()).optional(),
                deny: z.array(z.string()).optional(),
              }),
            )
            .optional(),
          sandbox: z
            .object({
              tools: z
                .object({
                  allow: z.array(z.string()).optional(),
                  deny: z.array(z.string()).optional(),
                })
                .optional(),
            })
            .optional(),
          elevated: z
            .object({
              enabled: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const local = await ensureAgentLocalConfig({
      agentId: target.id,
      entry: target,
      defaultsModel: config.agents?.defaults?.model || {},
      defaultsSandbox: config.agents?.defaults?.sandbox,
    })
    const previousDisplayName = local.identity.name || local.agent.displayName || ''

    const patch = parsed.data
    const beforeSerialized = JSON.stringify(local)
    const isRecruitProfileConfigPatch = Boolean(
      patch.profile && (
        patch.profile.behaviorProfile
        || patch.profile.abilities?.length
        || patch.profile.tools?.length
        || patch.profile.stats
        || patch.profile.level !== undefined
      ),
    )
    let profilePatched = false
    let modelOverrideCleanup: Awaited<ReturnType<typeof clearDisallowedAutoModelOverridesForAgent>> | null = null
    if (patch.identity) {
      local.identity = {
        ...local.identity,
        ...patch.identity,
      }
      if (patch.identity.name?.trim()) {
        local.agent.displayName = patch.identity.name.trim()
        local.agent.aliases = deriveAgentAliases(target.id, local.agent.displayName)
      }
    }
    if (patch.routing?.workspace?.trim()) {
      const workspace = path.resolve(patch.routing.workspace.trim())
      try {
        await validateWorkspaceAccess(workspace)
      } catch (error) {
        return apiFailure(res, 400, 'workspace_unwritable', 'Workspace is not writable. Choose a folder you own (for example in your user profile).', String(error))
      }
      applyExecutionWorkspaceToLocalConfig(local, workspace)
      await fs.mkdir(local.memory.journalDir, { recursive: true })
    }
    if (patch.model) {
      const authProblem = modelAuthProblem(patch.model.primary || local.model.primary)
      if (authProblem) {
        return apiFailure(res, 409, 'invalid_payload', `Missing auth for ${authProblem.provider}. Connect this provider before saving the model.`, {
          provider: authProblem.provider,
          providerStatus: authProblem.providerStatus,
        })
      }
      local.model = normalizeModelWithFallback(
        {
          primary: patch.model.primary || local.model.primary,
          fallbacks: patch.model.fallbacks || local.model.fallbacks,
        },
        config.agents?.defaults?.model || {},
      )
      ensureConfiguredModelAllowlist(config, [local.model.primary, ...local.model.fallbacks])
    }
    if (patch.profile) {
      local.profile = sanitizeProfile({
        ...local.profile,
        ...patch.profile,
        stats: {
          ...local.profile.stats,
          ...(patch.profile.stats || {}),
        },
      })
      profilePatched = true
    }
    if (patch.attributes) {
      const attributesPatch = isRecruitProfileConfigPatch && isLegacyGenericRecruitAttributes(patch.attributes)
        ? recruitAttributesFromProfile(local.profile)
        : patch.attributes
      local.attributes = {
        ...local.attributes,
        ...attributesPatch,
      }
    }
    if (patch.mds) {
      const inferredMds = recruitMdsDefaults(local.profile)
      const mdsPatch = isRecruitProfileConfigPatch && isLegacyGenericRecruitMds(patch.mds, inferredMds)
        ? inferredMds
        : patch.mds
      local.mds = normalizeAgentMdsState(local.mds, mdsPatch)
    }
    if (patch.heartbeat) {
      const heartbeatPatch = isRecruitProfileConfigPatch && isLegacyGenericRecruitHeartbeat(patch.heartbeat)
        ? recruitHeartbeatDefaults()
        : patch.heartbeat
      local.heartbeat = { ...local.heartbeat, ...heartbeatPatch }
    }
    if (patch.runtime) {
      const runtimePatch = isRecruitProfileConfigPatch && isLegacyGenericRecruitRuntime(patch.runtime)
        ? recruitRuntimeDefaults()
        : patch.runtime
      local.runtime = { ...local.runtime, ...runtimePatch }
    }
    if (patch.soul) {
      const soulPatch = isRecruitProfileConfigPatch && isLegacyGenericRecruitSoul(patch.soul)
        ? recruitSoulDefaults(local.profile.behaviorProfile)
        : patch.soul
      local.soul = { ...local.soul, ...soulPatch }
    }
    if (patch.auth?.providers) {
      local.auth.providers = { ...local.auth.providers, ...patch.auth.providers }
    }
    if (patch.sandbox) {
      local.sandbox = normalizeSandboxConfig({
        ...local.sandbox,
        ...patch.sandbox,
        ...(patch.sandbox.workspaceRoot ? { workspaceRoot: patch.sandbox.workspaceRoot } : {}),
      })
    }
    if (patch.tools) {
      local.tools = normalizeAgentToolsConfig({
        ...local.tools,
        ...patch.tools,
        byProvider: {
          ...(local.tools.byProvider || {}),
          ...(patch.tools.byProvider || {}),
        },
        sandbox: {
          ...(local.tools.sandbox || {}),
          ...(patch.tools.sandbox || {}),
          tools: {
            ...(local.tools.sandbox?.tools || {}),
            ...(patch.tools.sandbox?.tools || {}),
          },
        },
        elevated: {
          ...(local.tools.elevated || {}),
          ...(patch.tools.elevated || {}),
        },
      })
    }
    if (local.sandbox.mode === 'off') {
      local.sandbox = normalizeSandboxConfig({
        ...local.sandbox,
        mode: 'off',
        scope: 'agent',
        workspaceAccess: 'rw',
      })
      local.tools = normalizeAgentToolsConfig({ profile: 'full' })
    }

    applyExecutionWorkspaceToLocalConfig(local, local.routing.workspace)
    const changed = JSON.stringify(local) !== beforeSerialized
    if (!changed) {
      return apiSuccess(res, {
        agentId: target.id,
        path: agentLocalConfigPath(target.id),
        config: local,
        unchanged: true,
        modelOverrideCleanup: null,
        modelSessionReset: null,
      })
    }

    await fs.mkdir(local.memory.journalDir, { recursive: true })
    local.agent.updatedAt = new Date().toISOString()
    await fs.mkdir(path.dirname(agentLocalConfigPath(target.id)), { recursive: true })
    await writeTextFileWithLockRetry(agentLocalConfigPath(target.id), `${JSON.stringify(local, null, 2)}\n`)
    await rememberAgentLocalConfigCache(agentLocalConfigPath(target.id), local)
    if (profilePatched) {
      const profiles = await readPartyProfiles()
      profiles.agents[target.id] = local.profile
      await writePartyProfiles(profiles)
    }
    const currentDisplayName = local.identity.name || local.agent.displayName || ''
    const needsDerivedFileSync = Boolean(patch.identity || patch.routing || patch.profile || patch.attributes || patch.mds || patch.soul)
    if (needsDerivedFileSync || (currentDisplayName && currentDisplayName !== previousDisplayName)) {
      await syncAgentDerivedFiles(target.id, local)
    }
    if (currentDisplayName && currentDisplayName !== previousDisplayName) {
      await propagateDisplayNameAcrossAgentFiles(target.id, previousDisplayName, local)
    }

    applyLocalConfigToGlobal(target.id, local, config)
    await writeOpenclawConfig(config)
    const shouldResetContextSession = Boolean(
      needsDerivedFileSync ||
      patch.tools ||
      patch.auth ||
      (currentDisplayName && currentDisplayName !== previousDisplayName),
    )
    const contextSessionReset = shouldResetContextSession
      ? resetAgentTurnSessionsForAgentContextChange(target.id, 'agent context changed')
      : null
    const modelSessionReset = patch.model ? resetAgentTurnSessionsForModelChange(target.id) : null
    if (patch.model) {
      modelOverrideCleanup = await clearDisallowedAutoModelOverridesForAgent(target.id, local.model, { clearManualOverrides: true })
    }
    const gatewayRestart = patch.runtime
      ? schedulePluginGatewayRestart()
      : null

    return apiSuccess(res, {
      agentId: target.id,
      path: agentLocalConfigPath(target.id),
      config: local,
      contextSessionReset,
      modelOverrideCleanup,
      modelSessionReset,
      gatewayRestart,
    })
  })

  app.get('/api/party/agent/:agentId/model', async (req, res) => {
    const requestedAgent = req.params.agentId
    try {
      const { config, target } = await getAgentById(requestedAgent)
      if (!target) return apiFailure(res, 404, 'agent_not_found', 'Agent not found', { agentId: requestedAgent })
      const agentId = target.id

      const defaults = config.agents?.defaults?.model || {}
      const local = await ensureAgentLocalConfig({
        agentId,
        entry: target,
        defaultsModel: defaults,
        defaultsSandbox: config.agents?.defaults?.sandbox,
      })
      const model = normalizeModelWithFallback(local.model, defaults)
      return apiSuccess(res, { model })
    } catch (error) {
      return apiFailure(res, 500, 'model_operation_failed', 'Failed to read agent model', { agentId: requestedAgent, detail: String(error) })
    }
  })

  app.post('/api/party/agent/:agentId/model', async (req, res) => {
    const requestedAgent = req.params.agentId
    const schema = z.object({
      primary: z.string().min(1),
      fallbacks: z.array(z.string()).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    const unavailableModel = [parsed.data.primary, ...(parsed.data.fallbacks || [])]
      .map((modelId) => canonicalAgentModelId(modelId))
      .find((modelId) => KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId))
    if (unavailableModel) {
      return apiFailure(res, 422, 'model_operation_failed', `${unavailableModel} is temporarily blocked because this model is known to fail Gateway-backed agent runs. Pick another model or fallback before saving.`, {
        modelId: unavailableModel,
        failureKind: 'provider_unsupported',
      })
    }

    try {
      const { config, target } = await getAgentById(requestedAgent)
      if (!target) return apiFailure(res, 404, 'agent_not_found', 'Agent not found', { agentId: requestedAgent })
      const agentId = target.id

      const local = await ensureAgentLocalConfig({
        agentId,
        entry: target,
        defaultsModel: config.agents?.defaults?.model || {},
        defaultsSandbox: config.agents?.defaults?.sandbox,
      })
      const requestedAuthProblem = modelAuthProblem(parsed.data.primary)
      if (requestedAuthProblem) {
        return apiFailure(res, 409, 'model_auth_required', `Missing auth for ${requestedAuthProblem.provider}. Connect this provider before saving the model.`, {
          provider: requestedAuthProblem.provider,
          providerStatus: requestedAuthProblem.providerStatus,
        })
      }
      const nextModel = normalizeModelWithFallback(
        { primary: parsed.data.primary, fallbacks: parsed.data.fallbacks || [] },
        config.agents?.defaults?.model || {},
      )
      const authProblem = modelAuthProblem(nextModel.primary)
      if (authProblem) {
        return apiFailure(res, 409, 'model_auth_required', `Missing auth for ${authProblem.provider}. Connect this provider before saving the model.`, {
          provider: authProblem.provider,
          providerStatus: authProblem.providerStatus,
        })
      }
      local.model = nextModel
      ensureConfiguredModelAllowlist(config, [nextModel.primary, ...nextModel.fallbacks])
      local.agent.updatedAt = new Date().toISOString()
      await writeTextFileWithLockRetry(agentLocalConfigPath(agentId), `${JSON.stringify(local, null, 2)}\n`)
      await rememberAgentLocalConfigCache(agentLocalConfigPath(agentId), local)
      await syncAgentDerivedFiles(agentId, local)

      applyLocalConfigToGlobal(agentId, local, config)

      await writeOpenclawConfig(config)
      const modelSessionReset = resetAgentTurnSessionsForModelChange(agentId)
      const modelOverrideCleanup = await clearDisallowedAutoModelOverridesForAgent(agentId, nextModel, { clearManualOverrides: true })
      return apiSuccess(res, { ok: true, model: nextModel, modelOverrideCleanup, modelSessionReset })
    } catch (error) {
      return apiFailure(res, 500, 'model_operation_failed', 'Failed to update agent model', { agentId: requestedAgent, detail: String(error) })
    }
  })
}
