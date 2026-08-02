import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type RecoveredCodexBindingSidecar = {
  agentId: string
  sourcePath: string
  recoveryPath: string
  reason: string
}

export type CodexSidecarRecoveryResult = {
  recovered: RecoveredCodexBindingSidecar[]
  warnings: string[]
}

function invalidSidecarRecoveryName(agentId: string, fileName: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  return `${agentId}--${fileName}.invalid-json-${suffix}`
}

/**
 * OpenClaw used to create a JSON sidecar next to some session JSONL files for
 * Codex bindings.  A partially-written sidecar makes its legacy migration
 * fail before the Gateway can finish starting.  Preserve the original bytes
 * under the state-root recovery folder, then leave the session directory in a
 * state OpenClaw can safely migrate on the next launch.
 */
export async function recoverMalformedCodexBindingSidecars(stateRoot: string): Promise<CodexSidecarRecoveryResult> {
  const resolvedRoot = path.resolve(stateRoot)
  const agentsRoot = path.join(resolvedRoot, 'agents')
  const recoveryRoot = path.join(resolvedRoot, 'recovery', 'codex-binding-sidecars')
  const result: CodexSidecarRecoveryResult = { recovered: [], warnings: [] }
  const agentEntries = await fs.readdir(agentsRoot, { withFileTypes: true }).catch((error: unknown) => {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === 'ENOENT') return []
    result.warnings.push(`Could not inspect legacy Codex sidecars: ${String(error)}`)
    return []
  })

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,80}$/iu.test(agentEntry.name)) continue
    const sessionsRoot = path.join(agentsRoot, agentEntry.name, 'sessions')
    const sessionEntries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch((error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code !== 'ENOENT') result.warnings.push(`Could not inspect Codex sidecars for ${agentEntry.name}: ${String(error)}`)
      return []
    })

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.codex-app-server.json')) continue
      const sourcePath = path.join(sessionsRoot, sessionEntry.name)
      const raw = await fs.readFile(sourcePath, 'utf8').catch((error: unknown) => {
        result.warnings.push(`Could not read legacy Codex sidecar ${sourcePath}: ${String(error)}`)
        return null
      })
      if (raw === null) continue

      try {
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('legacy Codex binding sidecar must contain a JSON object')
        }
        continue
      } catch (error) {
        const reason = String(error).replace(/\s+/gu, ' ').trim()
        try {
          await fs.mkdir(recoveryRoot, { recursive: true })
          const recoveryPath = path.join(recoveryRoot, invalidSidecarRecoveryName(agentEntry.name, sessionEntry.name))
          await fs.rename(sourcePath, recoveryPath)
          result.recovered.push({ agentId: agentEntry.name, sourcePath, recoveryPath, reason })
        } catch (recoveryError) {
          result.warnings.push(`Could not preserve malformed legacy Codex sidecar ${sourcePath}: ${String(recoveryError)}`)
        }
      }
    }
  }

  return result
}
