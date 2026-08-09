import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentResponse, AgentSkillEntry } from '../../types/nexus'

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
  const [clawHubQuery, setClawHubQuery] = useState('ui')
  const [clawHubResults, setClawHubResults] = useState<ClawHubSkillResult[]>([])
  const [loadingClawHubSearch, setLoadingClawHubSearch] = useState(false)
  const [installingClawHubSlug, setInstallingClawHubSlug] = useState('')
  const [updatingClawHubSlug, setUpdatingClawHubSlug] = useState('')
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
      setError('')
      setStatus(`Library synced: ${nextLibrary.length} indexed skill${nextLibrary.length === 1 ? '' : 's'}.`)
    } catch (syncError) {
      setError(`Failed to load skill library: ${String(syncError)}`)
    } finally {
      setLoadingLibrary(false)
    }
  }, [])

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
    if (!activeAgentId) return
    const skillRef = clawHubSkillReference(skill)
    setInstallingClawHubSlug(skillRef)
    try {
      const result = await apiRequest<ClawHubInstallPayload>('/api/skills/clawhub/install', {
        method: 'POST',
        timeoutMs: 120_000,
        body: { skillRef },
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      const payload = result.data
      setError('')
      setStatus(`Installed ${payload.skill?.name || skill.displayName || skill.slug} into the shared OpenClaw skills folder.`)
      setInfoOutput(stripAnsi(payload.output || `Installed ${skill.slug}.`))
      await runLibrary(activeAgentId)
    } catch (installError) {
      setError(`Failed to install ClawHub skill: ${String(installError)}`)
    } finally {
      setInstallingClawHubSlug('')
    }
  }, [activeAgentId, runLibrary])

  const updateClawHubSkill = useCallback(async (skill: ClawHubSkillResult) => {
    if (!activeAgentId) return
    const skillRef = clawHubSkillReference(skill)
    setUpdatingClawHubSlug(skillRef)
    try {
      const result = await apiRequest<ClawHubInstallPayload>('/api/skills/clawhub/update', {
        method: 'POST',
        timeoutMs: 180_000,
        body: { skillRef },
      })
      if (!result.ok) {
        setError(apiErrorMessage(result.error))
        return
      }
      const payload = result.data
      setError('')
      setStatus(`Updated ${skill.displayName || skill.slug}.`)
      setInfoOutput(stripAnsi(payload.output || `Updated ${skill.slug}.`))
      await runLibrary(activeAgentId)
    } catch (updateError) {
      setError(`Failed to update ClawHub skill: ${String(updateError)}`)
    } finally {
      setUpdatingClawHubSlug('')
    }
  }, [activeAgentId, runLibrary])

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
            <div className="grid gap-2">
              {filteredLibrary.slice(0, 16).map((skill) => (
                <div key={skill.id} className="rounded-lg border border-white/[0.04] bg-black/15 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-slate-100">{skill.name}</p>
                    <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.10em] text-slate-400">
                      {knownSkillIds.has(skill.id) ? 'equipped' : sourceLabel(skill.source)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{skill.description}</p>
                  {skill.path && <p className="mt-1 truncate font-mono text-[8px] text-slate-600">{skill.path}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => void loadLibrarySkill(skill, 'view')} disabled={Boolean(loadingSkillId)}
                      className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-cyan-200/80 transition hover:bg-cyan-400/[0.08] disabled:opacity-40">
                      {loadingSkillId === skill.id ? 'Opening...' : 'Open'}
                    </button>
                    <button type="button" onClick={() => void loadLibrarySkill(skill, 'draft')} disabled={Boolean(loadingSkillId)}
                      className="rounded-md border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.10em] text-emerald-200/80 transition hover:bg-emerald-400/[0.08] disabled:opacity-40">
                      Draft
                    </button>
                  </div>
                </div>
              ))}
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
