import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentResponse, AgentSkillEntry } from '../../types/nexus'
import { clawHubInstallConfirmationPrompt, parseClawHubInstallConfirmation } from '../../utils/clawHubInstallConfirmation'

type SkillsApiPayload = {
  ok: boolean
  agentId?: string | null
  output?: string
  error?: string
}

type SkillLibraryPayload = {
  agentId?: string | null
  shared?: AgentSkillEntry[]
  agent?: AgentSkillEntry[]
  index?: {
    knownSkills?: AgentSkillEntry[]
    preferredSkills?: string[]
    lastSyncedAt?: string
  } | null
}

type SkillContentPayload = {
  skill?: AgentSkillEntry
  content?: string
}

type ClawHubSkillResult = {
  slug: string
  install?: { reference?: string }
  displayName?: string
  summary?: string
  version?: string | null
  updatedAt?: number | null
  downloads?: number | null
  rating?: number | null
  ownerHandle?: string
  owner?: {
    handle?: string
    displayName?: string
    image?: string
  }
}

type ClawHubSearchPayload = {
  results?: ClawHubSkillResult[]
}

type ClawHubInstallPayload = {
  skill?: AgentSkillEntry
  output?: string
  quarantined?: string[]
}

type SkillPreviewFile = { path: string; sizeBytes: number; mode: number; sha256: string }
type SkillPreviewChange = {
  path: string
  change: 'added' | 'removed' | 'modified'
  before?: SkillPreviewFile
  after?: SkillPreviewFile
  contentPreview?: {
    kind: 'text' | 'binary' | 'omitted' | 'permission-only'
    before?: { text: string; truncated: boolean }
    after?: { text: string; truncated: boolean }
  }
}
type ClawHubPreviewPayload = {
  previewId: string
  operation: 'install' | 'update'
  skillRef: string
  version: string
  expiresAt: string
  currentSha256: string | null
  stagedSha256: string
  totalBytes: number
  files: number
  changes: SkillPreviewChange[]
}

type QuarantinedSkillEntry = {
  skillId: string
  source: 'library' | 'agent'
  agentId: string | null
  reason: string
  movedAt: string
}

type SkillIntegrityState = {
  status: 'unverified' | 'unchanged' | 'changed'
  canRollback: boolean
  added: string[]
  removed: string[]
  modified: string[]
}

function clawHubSkillReference(skill: ClawHubSkillResult) {
  const registryReference = skill.install?.reference?.trim()
  if (registryReference) return registryReference.includes('/') && !registryReference.startsWith('@') ? `@${registryReference}` : registryReference
  const owner = (skill.ownerHandle || skill.owner?.handle || '').trim().replace(/^@/, '')
  return owner ? `@${owner}/${skill.slug}` : skill.slug
}

type SkillSourceFilter = 'all' | 'equipped' | AgentSkillEntry['source']

type SkillCandidate = {
  id: string
  name: string
  description: string
  body: string
  sourcePrompt: string
  createdAt: string
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
}

function extractSkillNames(output: string): string[] {
  if (!output.trim()) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('│')) continue
    const columns = line.split('│').map((col) => col.trim()).filter(Boolean)
    if (columns.length < 3) continue
    const rawSkill = columns[1].replace(/^[^\p{L}\p{N}]+/gu, '').trim()
    if (!rawSkill || !/^[a-z0-9][a-z0-9-_]*$/i.test(rawSkill)) continue
    const key = rawSkill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(rawSkill)
  }
  return names
}

function slugifySkillId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function sourceLabel(source: AgentSkillEntry['source']) {
  if (source === 'clawhub') return 'clawhub'
  if (source === 'library') return 'shared'
  if (source === 'learned') return 'learned'
  return source
}

function compactText(value: string, max = 180) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 1)).trim()}…`
}

function formatClawHubDate(value?: number | null) {
  if (!value || !Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return ''
  }
}

function formatClawHubMetric(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
  return new Intl.NumberFormat().format(value)
}

function titleCaseSkill(value: string) {
  const cleaned = value
    .replace(/^\/new\s+/i, '')
    .replace(/^(mission|task|prompt|objective)\s*:\s*/i, '')
    .replace(/[^a-zA-Z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6)
  const fallback = words.length ? words.join(' ') : 'Reusable Workflow'
  return fallback
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 72)
}

function makeSkillCandidate(response: AgentResponse, agentName: string): SkillCandidate {
  const baseName = titleCaseSkill(response.prompt || response.response)
  const name = baseName.toLowerCase().includes('workflow') ? baseName : `${baseName} Workflow`
  const description = `Reusable workflow distilled from ${agentName}'s successful run.`
  const body = [
    `Learned from ${agentName} at ${new Date(response.timestamp).toLocaleString()}.`,
    '',
    'Original prompt:',
    compactText(response.prompt, 500),
    '',
    'Reusable notes:',
    response.response.trim(),
  ].join('\n')
  return {
    id: response.id,
    name,
    description,
    body,
    sourcePrompt: response.prompt,
    createdAt: response.timestamp,
  }
}

async function readSkillsEndpoint(url: string): Promise<SkillsApiPayload> {
  try {
    const result = await apiRequest<Omit<SkillsApiPayload, 'ok' | 'error'>>(url, {
      cache: 'no-store',
      timeoutMs: 90_000,
    })
    if (!result.ok) return { ok: false, error: apiErrorMessage(result.error) }
    return { ok: true, ...result.data }
  } catch (error) {
    return { ok: false, error: `Request failed: ${String(error)}` }
  }
}

export function SkillsPanel() {
  const agents = useNexusStore((state) => state.agents)
  const selectedAgentId = useNexusStore((state) => state.selectedAgentId)
  const selectedAgentIds = useNexusStore((state) => state.selectedAgentIds)
  const agentResponses = useNexusStore((state) => state.agentResponses)
  const recordSkillLearned = useNexusStore((state) => state.recordSkillLearned)

  const activeAgentId = selectedAgentId || selectedAgentIds[0] || ''
  const activeAgent = useMemo(() => agents.find((agent) => agent.id === activeAgentId) ?? null, [agents, activeAgentId])

  const [checkOutput, setCheckOutput] = useState('')
  const [listOutput, setListOutput] = useState('')
  const [infoOutput, setInfoOutput] = useState('')
  const [skillName, setSkillName] = useState('weather')
  const [loadingCheck, setLoadingCheck] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [loadingSkillId, setLoadingSkillId] = useState('')
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [library, setLibrary] = useState<AgentSkillEntry[]>([])
  const [quarantinedSkills, setQuarantinedSkills] = useState<QuarantinedSkillEntry[]>([])
  const [skillIntegrity, setSkillIntegrity] = useState<Record<string, SkillIntegrityState>>({})
  const [restoringSkillId, setRestoringSkillId] = useState('')
  const [clawHubQuery, setClawHubQuery] = useState('ui')
  const [clawHubResults, setClawHubResults] = useState<ClawHubSkillResult[]>([])
  const [loadingClawHubSearch, setLoadingClawHubSearch] = useState(false)
  const [installingClawHubSlug, setInstallingClawHubSlug] = useState('')
  const [updatingClawHubSlug, setUpdatingClawHubSlug] = useState('')
  const [clawHubPreview, setClawHubPreview] = useState<ClawHubPreviewPayload | null>(null)
  const [applyingClawHubPreview, setApplyingClawHubPreview] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SkillSourceFilter>('all')
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDescription, setNewSkillDescription] = useState('')
  const [newSkillBody, setNewSkillBody] = useState('')
  const [shareSkill, setShareSkill] = useState(false)
  const [dismissedCandidateIds, setDismissedCandidateIds] = useState<string[]>([])
  const skillOptions = useMemo(() => extractSkillNames(listOutput), [listOutput])
  const knownSkillIds = useMemo(() => new Set([
    ...(activeAgent?.unlockedSkills || []),
    ...(activeAgent?.mds.skillLibrary?.knownSkills || []).map((skill) => skill.id),
  ]), [activeAgent])
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()
    return library.filter((skill) => {
      const equipped = knownSkillIds.has(skill.id)
      if (sourceFilter === 'equipped' && !equipped) return false
      if (sourceFilter !== 'all' && sourceFilter !== 'equipped' && skill.source !== sourceFilter) return false
      if (!query) return true
      return [skill.id, skill.name, skill.description, skill.path || ''].some((value) => value.toLowerCase().includes(query))
    })
  }, [knownSkillIds, library, libraryQuery, sourceFilter])
  const libraryStats = useMemo(() => ({
    total: library.length,
    equipped: library.filter((skill) => knownSkillIds.has(skill.id)).length,
    learned: library.filter((skill) => skill.source === 'learned').length,
    shared: library.filter((skill) => skill.source === 'library').length,
    clawhub: library.filter((skill) => skill.source === 'clawhub').length,
  }), [knownSkillIds, library])
  const installedClawHubIds = useMemo(() => new Set(
    library
      .filter((skill) => skill.source === 'clawhub')
      .map((skill) => skill.id),
  ), [library])
  const duplicateSkill = useMemo(() => {
    const id = slugifySkillId(newSkillName)
    const name = newSkillName.trim().toLowerCase()
    if (!id && !name) return null
    return library.find((skill) => skill.id === id || skill.name.trim().toLowerCase() === name) || null
  }, [library, newSkillName])
  const skillCandidates = useMemo(() => {
    if (!activeAgent) return []
    return agentResponses
      .filter((response) =>
        response.agentId === activeAgent.id &&
        response.ok &&
        response.response.trim().length >= 220 &&
        !dismissedCandidateIds.includes(response.id),
      )
      .slice(0, 5)
      .map((response) => makeSkillCandidate(response, activeAgent.name))
  }, [activeAgent, agentResponses, dismissedCandidateIds])

  const runCheck = useCallback(async (agentId: string) => {
    setLoadingCheck(true)
    const result = await readSkillsEndpoint(`/api/skills/check?agentId=${encodeURIComponent(agentId)}`)
    setLoadingCheck(false)
    if (!result.ok) { setError(result.error || 'Failed to run skills check.'); return }
    setError('')
    setStatus('Skill check completed.')
    setCheckOutput(stripAnsi(result.output || 'No output returned.'))
  }, [])

  const runList = useCallback(async (agentId: string) => {
    setLoadingList(true)
    const result = await readSkillsEndpoint(`/api/skills/list?agentId=${encodeURIComponent(agentId)}`)
    setLoadingList(false)
    if (!result.ok) { setError(result.error || 'Failed to list skills.'); return }
    setError('')
    setStatus('Available skills refreshed.')
    setListOutput(stripAnsi(result.output || 'No output returned.'))
  }, [])

  const runLibrary = useCallback(async (agentId: string) => {
    setLoadingLibrary(true)
    try {
      const result = await apiRequest<SkillLibraryPayload>(`/api/skills/library?agentId=${encodeURIComponent(agentId)}`, {
        cache: 'no-store',
        timeoutMs: 20_000,
      })
      if (!result.ok) { setError(apiErrorMessage(result.error)); return }
      const payload = result.data
      const merged = new Map<string, AgentSkillEntry>()
      for (const skill of [...(payload.shared || []), ...(payload.agent || []), ...(payload.index?.knownSkills || [])]) {
        merged.set(skill.id, skill)
      }
      const nextLibrary = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
      setLibrary(nextLibrary)
      const quarantined = await apiRequest<{ skills?: QuarantinedSkillEntry[] }>(`/api/skills/quarantine?agentId=${encodeURIComponent(agentId)}`, {
        cache: 'no-store',
        timeoutMs: 20_000,
      })
      setQuarantinedSkills(quarantined.ok ? quarantined.data.skills || [] : [])
      setError('')
      setStatus(`Library synced: ${nextLibrary.length} indexed skill${nextLibrary.length === 1 ? '' : 's'}.`)
    } catch (syncError) {
      setError(`Failed to load skill library: ${String(syncError)}`)
    } finally {
      setLoadingLibrary(false)
    }
  }, [])

  const skillLifecycleSource = (skill: AgentSkillEntry): 'library' | 'agent' =>
    skill.source === 'agent' || skill.source === 'learned' ? 'agent' : 'library'

  const lifecycleKey = (skill: AgentSkillEntry) => `${skillLifecycleSource(skill)}:${skill.id}`

  const inspectSkillIntegrity = async (skill: AgentSkillEntry) => {
    if (!activeAgentId) return
    try {
      const result = await apiRequest<{ comparison: SkillIntegrityState }>(
        `/api/skills/library/${encodeURIComponent(skill.id)}/integrity?agentId=${encodeURIComponent(activeAgentId)}`,
        { cache: 'no-store', timeoutMs: 30_000 },
      )
      if (!result.ok) { setError(apiErrorMessage(result.error)); return }
      setSkillIntegrity((current) => ({ ...current, [lifecycleKey(skill)]: result.data.comparison }))
      const { status, added, removed, modified } = result.data.comparison
      setStatus(`Integrity ${status}${added.length || removed.length || modified.length ? ` · +${added.length} −${removed.length} ~${modified.length}` : ''}: ${skill.name}.`)
      setError('')
    } catch (integrityError) {
      setError(`Failed to inspect skill integrity: ${String(integrityError)}`)
    }
  }

  const verifySkillBaseline = async (skill: AgentSkillEntry) => {
    if (!activeAgentId) return
    if (!window.confirm(`Trust the current files for ${skill.name} as a verified baseline?`)) return
    const source = skillLifecycleSource(skill)
    const result = await apiRequest<{ revision?: { revisionId: string } }>(`/api/skills/library/${encodeURIComponent(skill.id)}/verify`, {
      method: 'POST',
      timeoutMs: 30_000,
      body: { source, agentId: activeAgentId },
    })
    if (!result.ok) { setError(apiErrorMessage(result.error)); return }
    setStatus(`Verified a support-file baseline for ${skill.name}.`)
    setError('')
    await inspectSkillIntegrity(skill)
  }

  const rollbackSkill = async (skill: AgentSkillEntry) => {
    if (!activeAgentId) return
    if (!window.confirm(`Restore ${skill.name} to its prior verified revision?`)) return
    const result = await apiRequest(`/api/skills/library/${encodeURIComponent(skill.id)}/rollback`, {
      method: 'POST',
      timeoutMs: 30_000,
      body: { source: skillLifecycleSource(skill), agentId: activeAgentId },
    })
    if (!result.ok) { setError(apiErrorMessage(result.error)); return }
    setStatus(`Rolled ${skill.name} back to its prior verified revision.`)
    setError('')
    await runLibrary(activeAgentId)
  }

  const restoreQuarantinedSkill = async (skill: QuarantinedSkillEntry) => {
    if (!activeAgentId) return
    setRestoringSkillId(`${skill.source}:${skill.skillId}`)
    try {
      const result = await apiRequest(`/api/skills/quarantine/${encodeURIComponent(skill.skillId)}/restore`, {
        method: 'POST',
        timeoutMs: 30_000,
        body: { source: skill.source, ...(skill.agentId ? { agentId: skill.agentId } : {}) },
      })
      if (!result.ok) { setError(apiErrorMessage(result.error)); return }
      setStatus(`Restored ${skill.skillId}. Check its integrity before using it.`)
      setError('')
      await runLibrary(activeAgentId)
    } catch (restoreError) {
      setError(`Failed to restore ${skill.skillId}: ${String(restoreError)}`)
    } finally {
      setRestoringSkillId('')
    }
  }

  const searchClawHub = useCallback(async () => {
    setLoadingClawHubSearch(true)
    try {
      const result = await apiRequest<ClawHubSearchPayload>(`/api/skills/clawhub/search?q=${encodeURIComponent(clawHubQuery.trim())}&limit=10`, {
        timeoutMs: 90_000,
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      const payload = result.data
      const results = (payload.results || []).filter((result): result is ClawHubSkillResult => typeof result.slug === 'string' && result.slug.trim().length > 0)
      setClawHubResults(results)
      setError('')
      setStatus(`ClawHub returned ${results.length} skill${results.length === 1 ? '' : 's'}.`)
    } catch (searchError) {
      setError(`Failed to search ClawHub: ${String(searchError)}`)
    } finally {
      setLoadingClawHubSearch(false)
    }
  }, [clawHubQuery])

  const installClawHubSkill = useCallback(async (skill: ClawHubSkillResult) => {
    const skillRef = clawHubSkillReference(skill)
    setInstallingClawHubSlug(skillRef)
    setClawHubPreview(null)
    try {
      const result = await apiRequest<ClawHubPreviewPayload>('/api/skills/clawhub/preview', {
        method: 'POST',
        timeoutMs: 180_000,
        body: {
          operation: 'install',
          skillRef,
          ...(skill.version ? { version: skill.version } : {}),
        },
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      setClawHubPreview(result.data)
      setError('')
      setStatus(`Review the ${result.data.changes.length} staged file change${result.data.changes.length === 1 ? '' : 's'} for ${skillRef}@${result.data.version} before installing.`)
    } catch (previewError) {
      setError(`Failed to preview ClawHub skill: ${String(previewError)}`)
    } finally {
      setInstallingClawHubSlug('')
    }
  }, [])

  const updateClawHubSkill = useCallback(async (skill: ClawHubSkillResult) => {
    const skillRef = clawHubSkillReference(skill)
    setUpdatingClawHubSlug(skillRef)
    setClawHubPreview(null)
    try {
      const result = await apiRequest<ClawHubPreviewPayload>('/api/skills/clawhub/preview', {
        method: 'POST',
        timeoutMs: 180_000,
        body: { operation: 'update', skillRef, ...(skill.version ? { version: skill.version } : {}) },
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      setClawHubPreview(result.data)
      setError('')
      setStatus(`Review the ${result.data.changes.length} staged file change${result.data.changes.length === 1 ? '' : 's'} for ${skillRef}@${result.data.version} before updating.`)
    } catch (previewError) {
      setError(`Failed to preview ClawHub update: ${String(previewError)}`)
    } finally {
      setUpdatingClawHubSlug('')
    }
  }, [])

  const applyClawHubPreview = useCallback(async () => {
    if (!clawHubPreview) return
    const preview = clawHubPreview
    setApplyingClawHubPreview(true)
    try {
      const path = preview.operation === 'install' ? '/api/skills/clawhub/install' : '/api/skills/clawhub/update'
      const applyRequest = (confirmation?: { confirmationId: string }) => apiRequest<ClawHubInstallPayload>(path, {
        method: 'POST',
        timeoutMs: 180_000,
        body: {
          skillRef: preview.skillRef,
          version: preview.version,
          previewId: preview.previewId,
          confirmPreview: true,
          ...(confirmation ? { confirmReview: true, confirmationId: confirmation.confirmationId } : {}),
        },
      })
      let result = await applyRequest()
      if (!result.ok && result.error.code === 'skill_install_confirmation_required') {
        const confirmation = parseClawHubInstallConfirmation(result.error.detail)
        if (!confirmation || !window.confirm(clawHubInstallConfirmationPrompt(confirmation))) {
          setStatus(`${preview.operation === 'install' ? 'Install' : 'Update'} canceled; the ClawHub security review was not acknowledged.`)
          return
        }
        result = await applyRequest(confirmation)
      }
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        if (result.error.code === 'invalid_payload') setClawHubPreview(null)
        return
      }
      const payload = result.data
      setClawHubPreview(null)
      setError('')
      setStatus(payload.quarantined?.length
        ? `${preview.operation === 'install' ? 'Installed' : 'Updated'} ${preview.skillRef}; quarantined ${payload.quarantined.join(', ')} after integrity checks.`
        : `${preview.operation === 'install' ? 'Installed' : 'Updated'} ${preview.skillRef} at version ${preview.version}.`)
      setInfoOutput(stripAnsi(payload.output || `${preview.operation === 'install' ? 'Installed' : 'Updated'} ${preview.skillRef}.`))
      await runLibrary(activeAgentId)
    } catch (applyError) {
      setError(`Failed to apply the reviewed ClawHub ${preview.operation}: ${String(applyError)}`)
    } finally {
      setApplyingClawHubPreview(false)
    }
  }, [activeAgentId, clawHubPreview, runLibrary])

  const runInfo = useCallback(async (agentId: string, name: string) => {
    const safe = name.trim()
    if (!safe) { setError('Enter a skill name to fetch details.'); return }
    setLoadingInfo(true)
    const result = await readSkillsEndpoint(`/api/skills/info/${encodeURIComponent(safe)}?agentId=${encodeURIComponent(agentId)}`)
    setLoadingInfo(false)
    if (!result.ok) { setError(result.error || 'Failed to fetch skill info.'); return }
    setError('')
    setStatus(`Loaded info for ${safe}.`)
    setInfoOutput(stripAnsi(result.output || 'No output returned.'))
  }, [])

  const useInfoAsDraft = () => {
    const name = skillName.trim()
    if (name && !newSkillName.trim()) setNewSkillName(name)
    if (!newSkillDescription.trim()) setNewSkillDescription(`Reusable workflow for ${name || 'this skill'}.`)
    if (infoOutput.trim()) setNewSkillBody(infoOutput.trim())
  }

  const useStarterTemplate = () => {
    setNewSkillBody([
      '1. Confirm the task goal and relevant files/resources.',
      '2. Inspect the smallest useful context before acting.',
      '3. Apply the reusable procedure or snippet.',
      '4. Verify with a command, UI check, or concrete evidence.',
      '5. Report changed files, result, and any follow-up risk.',
    ].join('\n'))
  }

  const draftCandidate = (candidate: SkillCandidate) => {
    setNewSkillName(candidate.name)
    setNewSkillDescription(candidate.description)
    setNewSkillBody(candidate.body)
    setShareSkill(false)
    setStatus(`Drafted candidate from ${new Date(candidate.createdAt).toLocaleTimeString()}.`)
  }

  const loadLibrarySkill = useCallback(async (skill: AgentSkillEntry, mode: 'view' | 'draft') => {
    if (!activeAgentId) return
    setLoadingSkillId(skill.id)
    try {
      const result = await apiRequest<SkillContentPayload>(`/api/skills/library/${encodeURIComponent(skill.id)}?agentId=${encodeURIComponent(activeAgentId)}`, {
        cache: 'no-store',
        timeoutMs: 20_000,
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      const payload = result.data
      if (!payload.content) {
        setError('Failed to read skill content.')
        return
      }
      const content = payload.content.trim()
      setSkillName(skill.id)
      setInfoOutput(content || 'No content returned.')
      if (mode === 'draft') {
        setNewSkillName(skill.name)
        setNewSkillDescription(skill.description)
        setNewSkillBody(content)
        setShareSkill(skill.source === 'library')
      }
      setError('')
      setStatus(mode === 'draft' ? `Draft loaded from ${skill.name}.` : `Opened ${skill.name}.`)
    } catch (skillError) {
      setError(`Failed to read skill content: ${String(skillError)}`)
    } finally {
      setLoadingSkillId('')
    }
  }, [activeAgentId])

  const learnSkill = async () => {
    if (!activeAgentId) return
    const name = newSkillName.trim()
    const description = newSkillDescription.trim()
    if (!name || !description) {
      setError('Name the skill and give it a short description.')
      return
    }
    setLearning(true)
    try {
      const result = await apiRequest<{ skill?: AgentSkillEntry }>('/api/skills/learn', {
        method: 'POST',
        timeoutMs: 20_000,
        body: {
          agentId: activeAgentId,
          name,
          description,
          body: newSkillBody,
          shared: shareSkill,
          xpValue: duplicateSkill ? 0 : 250,
        },
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      const payload = result.data
      if (!payload.skill) {
        setError('Failed to save learned skill.')
        return
      }
      setError('')
      setStatus(`${duplicateSkill ? 'Updated' : 'Unlocked'} ${payload.skill.name}.`)
      setNewSkillName('')
      setNewSkillDescription('')
      setNewSkillBody('')
      recordSkillLearned(activeAgentId, payload.skill)
      setLibrary((current) => [...current.filter((skill) => skill.id !== payload.skill?.id), payload.skill as AgentSkillEntry].sort((a, b) => a.name.localeCompare(b.name)))
      setInfoOutput(`SKILL ${duplicateSkill ? 'UPDATED' : 'UNLOCKED'}\n${payload.skill.name}\n${payload.skill.description}\nPath: ${payload.skill.path || 'agent skill library'}`)
    } catch (learnError) {
      setError(`Failed to save learned skill: ${String(learnError)}`)
    } finally {
      setLearning(false)
    }
  }

  useEffect(() => {
    if (!activeAgentId) return
    setCheckOutput('')
    setListOutput('')
    setInfoOutput('')
    setStatus('')
    setError('')
    const timer = window.setTimeout(() => {
      void runLibrary(activeAgentId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeAgentId, runLibrary])

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[linear-gradient(180deg,#0b1425,#060b18)] shadow-2xl shadow-black/40 p-5">
      <div className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold tracking-[-0.01em] text-slate-100">Skills</h2>
            <p className="mt-1 text-[10px] text-slate-500/80">
              {activeAgent ? `${activeAgent.name} · ${activeAgent.role}` : 'No agent selected'}
            </p>
          </div>
          {activeAgent && (
            <div className="flex flex-wrap justify-end gap-1.5">
              <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-cyan-200/80">{libraryStats.total} indexed</span>
              <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-emerald-200/80">{libraryStats.equipped} equipped</span>
              <span className="rounded-full border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-violet-200/80">{libraryStats.learned} learned</span>
              <span className="rounded-full border border-blue-400/15 bg-blue-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-blue-200/80">{libraryStats.shared} shared</span>
              <span className="rounded-full border border-sky-400/15 bg-sky-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-sky-200/80">{libraryStats.clawhub} clawhub</span>
            </div>
          )}
        </div>
      </div>

      {!activeAgent ? (
        <div className="rounded-xl border border-dashed border-white/[0.06] py-8 text-center text-[12px] font-medium text-slate-600">
          Select an agent from the registry to inspect skills.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runCheck(activeAgentId)} disabled={loadingCheck}
              className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200/90 transition hover:bg-cyan-400/[0.10] hover:border-cyan-400/30 disabled:opacity-40">
              {loadingCheck ? 'Checking...' : 'Check'}
            </button>
            <button type="button" onClick={() => void runList(activeAgentId)} disabled={loadingList}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300 transition hover:bg-white/[0.04] hover:border-white/[0.12] disabled:opacity-40">
              {loadingList ? 'Loading...' : 'List'}
            </button>
          </div>

          <div className="flex gap-2">
            <input value={skillName} onChange={(e) => setSkillName(e.target.value)}
              className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12px] font-medium text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-400/30"
              placeholder="Skill name (e.g. weather)" />
            <button type="button" onClick={() => void runInfo(activeAgentId, skillName)} disabled={loadingInfo}
              className="rounded-lg border border-violet-400/20 bg-violet-400/[0.05] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200/90 transition hover:bg-violet-400/[0.10] disabled:opacity-40">
              {loadingInfo ? '...' : 'Info'}
            </button>
          </div>

          {skillOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skillOptions.map((name) => (
                <button key={name} type="button" disabled={loadingInfo}
                  onClick={() => { setSkillName(name); void runInfo(activeAgentId, name) }}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.04] px-2.5 py-1 text-[10px] font-medium text-cyan-200/80 transition hover:bg-cyan-400/[0.10] hover:border-cyan-400/35 disabled:opacity-40">
                  {name}
                </button>
              ))}
            </div>
          )}

          {skillCandidates.length > 0 && (
            <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.025] p-3.5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">Background Skill Candidates</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">Successful recent runs that look reusable.</p>
                </div>
                <span className="rounded-full border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-1 text-[9px] font-semibold text-amber-200/80">
                  {skillCandidates.length} queued
                </span>
              </div>
              <div className="grid gap-2">
                {skillCandidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-lg border border-white/[0.04] bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-bold text-slate-100">{candidate.name}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{compactText(candidate.sourcePrompt, 160)}</p>
                      </div>
                      <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-600">
                        {new Date(candidate.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => draftCandidate(candidate)}
                        className="rounded-md border border-amber-400/15 bg-amber-400/[0.05] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-amber-200/80 transition hover:bg-amber-400/[0.10]">
                        Draft
                      </button>
                      <button type="button" onClick={() => setDismissedCandidateIds((current) => [...new Set([...current, candidate.id])])}
                        className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-500 transition hover:border-white/[0.12] hover:text-slate-300">
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-sky-400/10 bg-sky-400/[0.025] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/80">ClawHub</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Installs are saved to the shared OpenClaw skills folder.</p>
              </div>
              <button type="button" onClick={() => void searchClawHub()} disabled={loadingClawHubSearch}
                className="rounded-lg border border-sky-400/20 bg-sky-400/[0.05] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-sky-200/90 transition hover:bg-sky-400/[0.10] disabled:opacity-40">
                {loadingClawHubSearch ? 'Searching...' : 'Search'}
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              <input value={clawHubQuery} onChange={(e) => setClawHubQuery(e.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void searchClawHub() }}
                className="flex-1 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2 text-[11px] font-medium text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400/30"
                placeholder="Search ClawHub skills" />
            </div>
            <div className="grid gap-2">
              {clawHubResults.map((result) => {
                const skillRef = clawHubSkillReference(result)
                const installed = installedClawHubIds.has(slugifySkillId(result.slug))
                const busyInstall = installingClawHubSlug === skillRef
                const busyUpdate = updatingClawHubSlug === skillRef
                const updated = formatClawHubDate(result.updatedAt)
                const downloads = formatClawHubMetric(result.downloads)
                const rating = formatClawHubMetric(result.rating)
                return (
                  <div key={skillRef} className="rounded-lg border border-white/[0.04] bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[11px] font-bold text-slate-100">{result.displayName || result.slug}</p>
                          <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-400">
                            {installed ? 'installed' : 'clawhub'}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{compactText(result.summary || 'No summary available.', 260)}</p>
                        <p className="mt-1 font-mono text-[8px] text-slate-600">
                          {skillRef}{updated ? ` updated ${updated}` : ''}
                        </p>
                        {(downloads || rating) && <p className="mt-1 flex flex-wrap gap-x-2 font-mono text-[8px] text-slate-500">
                          {rating && <span title="ClawHub ratings">★ {rating}</span>}
                          {downloads && <span title="ClawHub downloads">↓ {downloads}</span>}
                        </p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {installed ? (
                          <button type="button" onClick={() => void updateClawHubSkill(result)} disabled={Boolean(installingClawHubSlug || updatingClawHubSlug)}
                            className="rounded-md border border-sky-400/15 bg-sky-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-sky-200/80 transition hover:bg-sky-400/[0.08] disabled:opacity-40">
                            {busyUpdate ? 'Updating...' : 'Update'}
                          </button>
                        ) : (
                          <button type="button" onClick={() => void installClawHubSkill(result)} disabled={Boolean(installingClawHubSlug || updatingClawHubSlug)}
                            className="rounded-md border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-emerald-200/80 transition hover:bg-emerald-400/[0.08] disabled:opacity-40">
                            {busyInstall ? 'Installing...' : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {!clawHubResults.length && (
                <p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">No ClawHub search results loaded.</p>
              )}
            </div>
            {clawHubPreview && (
              <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3" role="dialog" aria-label="Review staged skill changes">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100/90">Review before {clawHubPreview.operation}</p>
                    <p className="mt-1 font-mono text-[9px] text-slate-300">{clawHubPreview.skillRef}@{clawHubPreview.version}</p>
                    <p className="mt-1 break-all font-mono text-[8px] text-slate-500">Current {clawHubPreview.currentSha256 || 'not installed'} → staged {clawHubPreview.stagedSha256}</p>
                    <p className="mt-1 text-[8px] text-slate-500">{clawHubPreview.files} files · {clawHubPreview.totalBytes.toLocaleString()} bytes · expires {new Date(clawHubPreview.expiresAt).toLocaleTimeString()}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => { setClawHubPreview(null); setStatus('Preview dismissed; its staged files will expire automatically.') }} disabled={applyingClawHubPreview}
                      className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-400 hover:text-slate-200 disabled:opacity-40">
                      Dismiss
                    </button>
                    <button type="button" onClick={() => void applyClawHubPreview()} disabled={applyingClawHubPreview}
                      className="rounded-md border border-amber-200/25 bg-amber-300/[0.10] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-amber-100 hover:bg-amber-300/[0.16] disabled:opacity-40">
                      {applyingClawHubPreview ? 'Rechecking…' : `Confirm ${clawHubPreview.operation}`}
                    </button>
                  </div>
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-white/[0.05] bg-black/20">
                  {clawHubPreview.changes.length ? clawHubPreview.changes.map((change) => (
                    <div key={`${change.change}:${change.path}`} className="border-b border-white/[0.04] px-2.5 py-2 last:border-b-0">
                      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                        <span className={`shrink-0 text-[8px] font-bold uppercase ${change.change === 'removed' ? 'text-rose-300' : change.change === 'added' ? 'text-emerald-300' : 'text-amber-200'}`}>{change.change}</span>
                        <code className="min-w-0 break-all text-[9px] text-slate-200">{change.path}</code>
                      </div>
                      <div className="mt-1 grid gap-1 font-mono text-[7px] leading-relaxed text-slate-500">
                        {change.before && <span className="break-all">before · mode {(change.before.mode & 0o777).toString(8).padStart(3, '0')} · sha256 {change.before.sha256}</span>}
                        {change.after && <span className="break-all">after · mode {(change.after.mode & 0o777).toString(8).padStart(3, '0')} · sha256 {change.after.sha256}</span>}
                      </div>
                      {change.contentPreview?.kind === 'text' && (
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          {change.contentPreview.before && <div className="min-w-0 rounded bg-rose-400/[0.04] p-1.5"><span className="text-[7px] font-bold uppercase text-rose-200/70">Before</span><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[8px] leading-relaxed text-slate-400">{change.contentPreview.before.text}{change.contentPreview.before.truncated ? '\n… preview truncated …' : ''}</pre></div>}
                          {change.contentPreview.after && <div className="min-w-0 rounded bg-emerald-400/[0.04] p-1.5"><span className="text-[7px] font-bold uppercase text-emerald-200/70">After</span><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[8px] leading-relaxed text-slate-300">{change.contentPreview.after.text}{change.contentPreview.after.truncated ? '\n… preview truncated …' : ''}</pre></div>}
                        </div>
                      )}
                      {change.contentPreview?.kind === 'binary' && <p className="mt-1 text-[7px] text-slate-500">Binary or non-UTF-8 content omitted.</p>}
                      {change.contentPreview?.kind === 'omitted' && <p className="mt-1 text-[7px] text-slate-500">Text preview omitted to stay within the response budget.</p>}
                      {change.contentPreview?.kind === 'permission-only' && <p className="mt-1 text-[7px] text-slate-500">File content is unchanged; only its permission mode changed.</p>}
                    </div>
                  )) : (
                    <p className="px-2.5 py-3 text-[9px] text-slate-500">The staged version has no file or permission changes.</p>
                  )}
                </div>
                <p className="mt-2 text-[8px] leading-relaxed text-slate-500">Confirm applies this exact reviewed version only after Automnia rechecks the staged hash, current installed files, and ClawHub’s latest version.</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.025] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/80">Skill Library</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Learned abilities are saved as SKILL.md and indexed for future runs.</p>
              </div>
              <button type="button" onClick={() => void runLibrary(activeAgentId)} disabled={loadingLibrary}
                className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200/90 transition hover:bg-emerald-400/[0.10] disabled:opacity-40">
                {loadingLibrary ? 'Syncing...' : 'Sync'}
              </button>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)}
                className="rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2 text-[11px] font-medium text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-400/30"
                placeholder="Search library" />
              <div className="flex flex-wrap gap-1">
                {(['all','equipped','clawhub','learned','library','agent'] as const).map((filter) => (
                  <button key={filter} type="button" onClick={() => setSourceFilter(filter)}
                    className={`rounded-md border px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] transition ${sourceFilter === filter ? 'border-emerald-300/35 bg-emerald-400/[0.10] text-emerald-100' : 'border-white/[0.05] bg-white/[0.02] text-slate-500 hover:text-slate-300'}`}>
                    {filter === 'library' ? 'shared' : filter}
                  </button>
                ))}
              </div>
            </div>
            {quarantinedSkills.length > 0 && (
              <div className="mb-3 rounded-lg border border-rose-400/15 bg-rose-400/[0.035] p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-200/90">Quarantined skills</p>
                <p className="mt-1 text-[9px] text-slate-500">These skills are kept outside their loadable roots. Restore is explicit; inspect and verify before running.</p>
                <div className="mt-2 grid gap-2">
                  {quarantinedSkills.map((skill) => (
                    <div key={`${skill.source}:${skill.agentId || ''}:${skill.skillId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/[0.04] bg-black/15 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold text-slate-200">{skill.skillId} · {skill.source}</p>
                        <p className="mt-0.5 text-[9px] text-slate-500">{skill.reason}</p>
                      </div>
                      <button type="button" onClick={() => void restoreQuarantinedSkill(skill)} disabled={restoringSkillId === `${skill.source}:${skill.skillId}`}
                        className="rounded-md border border-rose-400/20 bg-rose-400/[0.06] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-rose-100/90 hover:bg-rose-400/[0.12] disabled:opacity-40">
                        {restoringSkillId === `${skill.source}:${skill.skillId}` ? 'Restoring...' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-2">
              {filteredLibrary.slice(0, 16).map((skill) => {
                const integrity = skillIntegrity[lifecycleKey(skill)]
                return (
                <div key={skill.id} className="rounded-lg border border-white/[0.04] bg-black/15 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-slate-100">{skill.name}</p>
                    <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-400">
                      {knownSkillIds.has(skill.id) ? 'equipped' : sourceLabel(skill.source)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{skill.description}</p>
                  {skill.path && <p className="mt-1 truncate font-mono text-[8px] text-slate-600">{skill.path}</p>}
                  {integrity && <p className={`mt-1 text-[9px] font-semibold ${integrity.status === 'changed' ? 'text-amber-200' : integrity.status === 'unchanged' ? 'text-emerald-200/80' : 'text-slate-500'}`}>
                    File baseline: {integrity.status}{integrity.added.length || integrity.removed.length || integrity.modified.length ? ` · +${integrity.added.length} −${integrity.removed.length} ~${integrity.modified.length}` : ''}
                  </p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => void loadLibrarySkill(skill, 'view')} disabled={Boolean(loadingSkillId)}
                      className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-cyan-200/80 transition hover:bg-cyan-400/[0.08] disabled:opacity-40">
                      {loadingSkillId === skill.id ? 'Opening...' : 'Open'}
                    </button>
                    <button type="button" onClick={() => void loadLibrarySkill(skill, 'draft')} disabled={Boolean(loadingSkillId)}
                      className="rounded-md border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-emerald-200/80 transition hover:bg-emerald-400/[0.08] disabled:opacity-40">
                      Draft
                    </button>
                    <button type="button" onClick={() => void inspectSkillIntegrity(skill)}
                      className="rounded-md border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-amber-200/80 transition hover:bg-amber-400/[0.08]">
                      Check files
                    </button>
                    <button type="button" onClick={() => void verifySkillBaseline(skill)}
                      className="rounded-md border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-violet-200/80 transition hover:bg-violet-400/[0.08]">
                      Verify baseline
                    </button>
                    {integrity?.canRollback && <button type="button" onClick={() => void rollbackSkill(skill)}
                      className="rounded-md border border-rose-400/15 bg-rose-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-rose-200/80 transition hover:bg-rose-400/[0.08]">
                      Roll back
                    </button>}
                  </div>
                </div>
              )})}
              {filteredLibrary.length > 16 && <p className="text-center text-[10px] text-slate-600">{filteredLibrary.length - 16} more hidden by the current view.</p>}
              {!library.length && <p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">No learned skills indexed yet.</p>}
              {library.length > 0 && !filteredLibrary.length && <p className="rounded-lg border border-dashed border-white/[0.05] py-4 text-center text-[11px] text-slate-600">No skills match this filter.</p>}
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Teach New Skill</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={useStarterTemplate}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-400 transition hover:border-white/[0.12] hover:text-slate-200">
                  Template
                </button>
                <button type="button" onClick={useInfoAsDraft} disabled={!infoOutput.trim()}
                  className="rounded-md border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-violet-200/80 transition hover:bg-violet-400/[0.08] disabled:opacity-40">
                  Use Info
                </button>
              </div>
            </div>
            <input value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)}
              className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12px] font-medium text-slate-200 outline-none focus:border-emerald-400/30"
              placeholder="Skill name" />
            {duplicateSkill && (
              <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-3 py-2 text-[10px] font-medium text-amber-200/90">
                Existing skill matched: {duplicateSkill.name}. Saving will update it without extra XP.
              </div>
            )}
            <input value={newSkillDescription} onChange={(e) => setNewSkillDescription(e.target.value)}
              className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12px] font-medium text-slate-200 outline-none focus:border-emerald-400/30"
              placeholder="What this skill helps with" />
            <textarea value={newSkillBody} onChange={(e) => setNewSkillBody(e.target.value)}
              className="min-h-20 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12px] font-medium text-slate-200 outline-none focus:border-emerald-400/30"
              placeholder="Optional procedure, gotchas, references, or verification steps." />
            <label className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <input type="checkbox" checked={shareSkill} onChange={(e) => setShareSkill(e.target.checked)} />
              Add to shared party library
            </label>
            <button type="button" onClick={() => void learnSkill()} disabled={learning}
              className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-400/[0.12] disabled:opacity-40">
              {learning ? 'Learning...' : duplicateSkill ? 'Update Skill' : 'Unlock Skill'}
            </button>
          </div>

          {status && !error && (
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.035] px-3.5 py-2 text-[11px] font-medium text-emerald-200/90">{status}</div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-400/15 bg-rose-400/[0.04] px-3.5 py-2.5 text-[11px] font-medium text-rose-200/90">{error}</div>
          )}

          <div className="grid gap-3">
            {[
              ['Check Output', checkOutput],
              ['List Output', listOutput],
              ['Info Output', infoOutput],
            ].map(([label, output]) => (
              <div key={label} className="rounded-xl border border-white/[0.04] bg-white/[0.015] overflow-hidden">
                <div className="px-3.5 py-2 border-b border-white/[0.04]">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
                </div>
                <pre className="max-h-44 overflow-auto p-3.5 text-[11px] leading-relaxed text-slate-300/90 whitespace-pre-wrap font-mono">
                  {output || 'No output yet.'}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
