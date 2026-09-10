import { useEffect, useId, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { CapabilityKey, CollaborationMode, DurationMode, DurationUnit } from '../../types/nexus'
import { agentPortraitSrc } from '../../utils/portrait'
import { Badge, Button, StatusChip } from '../ui'
import { MISSION_GLYPH_ASSETS, MISSION_PRESET_ASSETS, type MissionGlyph } from './missionIconAssets'
import './MissionDeploymentPanel.css'
import { MissionTemplates } from './MissionTemplates'

type HeartbeatUnit = 'seconds' | 'minutes' | 'hours'
type MissionAccent = 'code' | 'plan' | 'research' | 'command' | 'memory' | 'relay'

const ACCENTS: Record<MissionAccent, { color: string; rgb: string; iconFilter?: string }> = {
  code: {
    color: '#9fb3bc',
    rgb: '159, 179, 188',
  },
  plan: { color: '#f3c760', rgb: '243, 199, 96' },
  research: { color: '#48e0da', rgb: '72, 224, 218' },
  command: { color: '#b590ff', rgb: '181, 144, 255' },
  memory: { color: '#75e2a5', rgb: '117, 226, 165' },
  relay: { color: '#ff8c78', rgb: '255, 140, 120' },
}

function accentVars(accent: MissionAccent): CSSProperties {
  const tone = ACCENTS[accent]
  return {
    '--dui-option-color': tone.color,
    '--dui-option-rgb': tone.rgb,
    '--dui-option-icon-filter': tone.iconFilter || 'none',
  } as CSSProperties
}

export function MissionGlyphIcon({ icon, className = 'dui-flat-glyph' }: { icon: MissionGlyph; className?: string }) {
  const asset = MISSION_GLYPH_ASSETS[icon]

  if (asset) {
    return (
      <img
        src={asset}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={48}
        height={48}
        loading="eager"
        decoding="async"
        className={`dui-mission-glyph ${className}`}
      />
    )
  }

  return (
    <img
      src={MISSION_GLYPH_ASSETS[icon]}
      alt=""
      aria-hidden="true"
      decoding="async"
      className={`dui-mission-glyph ${className}`}
    />
  )
}

function FlatGlyph({ icon }: { icon: MissionGlyph }) {
  // Use the authored mission assets so presets and option controls share one icon language.
  return <MissionGlyphIcon icon={icon} className="dui-flat-glyph" />
}

function optionLabel(value: CapabilityKey): string {
  if (value === 'codeGeneration') return 'Code'
  if (value === 'planning') return 'Plan'
  if (value === 'research') return 'Research'
  if (value === 'orchestration') return 'Orch'
  return 'Memory'
}

function modeLabel(value: CollaborationMode): string {
  if (value === 'hierarchical') return 'Command'
  if (value === 'parallel') return 'Parallel'
  if (value === 'specialist') return 'Specialist'
  if (value === 'sequential') return 'Relay'
  return 'Swarm'
}

const MISSION_TYPES: Array<{ id: CapabilityKey; label: string; hint: string; detail: string; icon: MissionGlyph; accent: MissionAccent }> = [
  { id: 'codeGeneration', label: 'Build', hint: 'Patch code', detail: 'Implementation lanes claim files, edit, verify, and report exact changes.', icon: 'build', accent: 'code' },
  { id: 'planning', label: 'Plan', hint: 'Scope work', detail: 'Commander turns objectives into owned lanes, dependencies, risks, and success checks.', icon: 'plan', accent: 'plan' },
  { id: 'research', label: 'Research', hint: 'Find truth', detail: 'Researchers gather facts, cite constraints, name unknowns, and feed decisions.', icon: 'research', accent: 'research' },
  { id: 'orchestration', label: 'Command', hint: 'Delegate', detail: '', icon: 'command', accent: 'command' },
  { id: 'memoryManagement', label: 'Memory', hint: 'Learn', detail: 'Agents update durable notes, skill libraries, and continuity files.', icon: 'memory', accent: 'memory' },
]

const COLLAB_MODES: Array<{ id: CollaborationMode; label: string; hint: string; detail: string; icon: MissionGlyph; accent: MissionAccent }> = [
  { id: 'hierarchical', label: 'Command', hint: 'Slot 1 delegates', detail: 'Best default. Slot 1 commands, teammates execute owned lanes and report back.', icon: 'command', accent: 'command' },
  { id: 'parallel', label: 'Parallel', hint: 'Fast lanes', detail: 'Everyone starts now with non-overlapping ownership. Good for broad code sweeps.', icon: 'parallel', accent: 'code' },
  { id: 'specialist', label: 'Specialist', hint: 'Capability match', detail: 'Only agents with the mission capability run. Good for precise assignments.', icon: 'specialist', accent: 'plan' },
  { id: 'sequential', label: 'Relay', hint: 'Ordered handoff', detail: 'Agents work in order, each building on the previous lane.', icon: 'relay', accent: 'relay' },
  { id: 'swarm', label: 'Swarm', hint: 'Many angles', detail: 'High-variance brainstorming and research. Use when breadth matters.', icon: 'swarm', accent: 'research' },
]

const DURATION_MODES: Array<{ id: DurationMode; label: string; hint: string; icon: MissionGlyph; accent: MissionAccent }> = [
  { id: 'instant', label: 'Strike', hint: 'One cron cycle', icon: 'strike', accent: 'plan' },
  { id: 'timed', label: 'Shift', hint: 'Cron cycles until time ends', icon: 'shift', accent: 'code' },
  { id: 'continuous', label: 'Loop', hint: 'Cron cycles until stopped', icon: 'loop', accent: 'research' },
  { id: 'indefinite', label: 'Watch', hint: 'Persistent cron mission', icon: 'watch', accent: 'memory' },
]

const PRESETS: Array<{
  label: string; title: string; missionType: CapabilityKey; collaborationMode: CollaborationMode
  complexity: number; riskTolerance: number; description: string; asset: string; accent: MissionAccent
}> = [
  { label: 'Code Sweep', title: 'Critical Code Sweep', missionType: 'codeGeneration', collaborationMode: 'parallel', complexity: 72, riskTolerance: 32, description: 'Audit for bugs, performance issues, broken flows, and safe fixes.', asset: MISSION_PRESET_ASSETS.codeSweep, accent: 'code' },
  { label: 'Mission Plan', title: 'Mission Plan', missionType: 'planning', collaborationMode: 'specialist', complexity: 58, riskTolerance: 24, description: 'Break objective into owned lanes, risks, and concrete next actions.', asset: MISSION_PRESET_ASSETS.missionPlan, accent: 'plan' },
  { label: 'Research Map', title: 'Research Map', missionType: 'research', collaborationMode: 'swarm', complexity: 64, riskTolerance: 18, description: 'Map facts, missing evidence, contradictions, and next documents needed.', asset: MISSION_PRESET_ASSETS.researchMap, accent: 'research' },
  { label: 'Launch Push', title: 'Launch Push', missionType: 'orchestration', collaborationMode: 'hierarchical', complexity: 82, riskTolerance: 42, description: 'Commander delegates implementation, verification, and polish lanes, then synthesizes release status.', asset: MISSION_PRESET_ASSETS.launchPush, accent: 'command' },
  { label: 'Command Ops', title: 'Commander Delegation Run', missionType: 'orchestration', collaborationMode: 'hierarchical', complexity: 76, riskTolerance: 28, description: 'Lead agent assigns owned lanes, tracks blockers, routes handoffs, and keeps TEAM_SYNC current until completion.', asset: MISSION_PRESET_ASSETS.commandOps, accent: 'command' },
]

const PRESET_OBJECTIVES = new Set(PRESETS.map((preset) => preset.description.trim()))

type GaugeTone = 'cool' | 'strong' | 'warn' | 'danger' | 'neutral'

function gaugeTone(value: number, kind: 'complexity' | 'risk'): GaugeTone {
  if (kind === 'risk') {
    if (value >= 70) return 'danger'
    if (value >= 40) return 'warn'
    return 'strong'
  }
  if (value >= 75) return 'strong'
  if (value >= 45) return 'cool'
  return 'neutral'
}

function readinessTone(value: number): GaugeTone {
  if (value >= 100) return 'strong'
  if (value >= 75) return 'cool'
  if (value >= 50) return 'warn'
  return 'danger'
}

function msToHeartbeat(ms: number): { value: number; unit: HeartbeatUnit } {
  if (ms >= 60 * 60 * 1000 && ms % (60 * 60 * 1000) === 0) return { value: ms / (60 * 60 * 1000), unit: 'hours' }
  if (ms >= 60 * 1000 && ms % (60 * 1000) === 0) return { value: ms / (60 * 1000), unit: 'minutes' }
  return { value: Math.max(1, Math.round(ms / 1000)), unit: 'seconds' }
}

function heartbeatToMs(value: number, unit: HeartbeatUnit): number {
  const safe = Math.max(1, Math.round(value || 1))
  if (unit === 'hours') return safe * 60 * 60 * 1000
  if (unit === 'minutes') return safe * 60 * 1000
  return safe * 1000
}

function formatHeartbeat(ms: number): string {
  const parts = msToHeartbeat(ms)
  const label = parts.unit === 'hours' ? 'hr' : parts.unit === 'minutes' ? 'min' : 'sec'
  return `${parts.value} ${label}${parts.value === 1 ? '' : 's'}`
}

function formatWorkTimeout(seconds: number | undefined): string {
  return formatHeartbeat(Math.max(30, Math.round(seconds || 720)) * 1000)
}

function formatNextMissionRun(nextRoundAt: string | null | undefined): string {
  if (!nextRoundAt) return 'next cycle pending'
  const timestamp = Date.parse(nextRoundAt)
  if (!Number.isFinite(timestamp)) return 'next cycle pending'
  return `next ${new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function MissionDeploymentPanel() {
  const fieldId = useId()
  const agents = useNexusStore((s) => s.agents)
  const missionDraft = useNexusStore((s) => s.missionDraft)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const confirmedPartyIds = useNexusStore((s) => s.confirmedPartyIds)
  const activeMission = useNexusStore((s) => s.activeMission)
  const missionLaunchPending = useNexusStore((s) => s.missionLaunchPending)
  const missionHistory = useNexusStore((s) => s.missionHistory)
  const busyAgentIds = useNexusStore((s) => s.busyAgentIds)
  const updateMissionDraft = useNexusStore((s) => s.updateMissionDraft)
  const updateHeartbeat = useNexusStore((s) => s.updateHeartbeat)
  const deployMission = useNexusStore((s) => s.deployMission)
  const steerMission = useNexusStore((s) => s.steerMission)
  const stopMission = useNexusStore((s) => s.stopMission)

  const [showTiming, setShowTiming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [heartbeatValue, setHeartbeatValue] = useState(30)
  const [heartbeatUnit, setHeartbeatUnit] = useState<HeartbeatUnit>('seconds')
  const [failedPortraitKeys, setFailedPortraitKeys] = useState<Set<string>>(() => new Set())
  const missionRunning = activeMission?.status === 'running'
  const selectedParty = confirmedPartyIds.length ? confirmedPartyIds : activePartyIds
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const busyAgentSet = useMemo(() => new Set(busyAgentIds), [busyAgentIds])
  const selectedAgents = useMemo(
    () => selectedParty.map((id) => agentById.get(id)).filter((agent): agent is typeof agents[number] => Boolean(agent)),
    [agentById, selectedParty],
  )
  const specialistAgents = useMemo(
    () => selectedAgents.filter((agent) => agent.mds.capabilities[missionDraft.missionType]),
    [missionDraft.missionType, selectedAgents],
  )
  const effectiveAgents = missionDraft.collaborationMode === 'specialist' ? specialistAgents : selectedAgents
  const excludedAgents = missionDraft.collaborationMode === 'specialist'
    ? selectedAgents.filter((agent) => !agent.mds.capabilities[missionDraft.missionType])
    : []
  const capabilityCoverage = selectedAgents.length ? Math.round((specialistAgents.length / selectedAgents.length) * 100) : 0
  const objectiveLength = missionDraft.description.trim().length
  const objectiveIsPresetCopy = PRESET_OBJECTIVES.has(missionDraft.description.trim())
  const objectiveIsCustom = objectiveLength > 0 && !objectiveIsPresetCopy
  const displayedCollaborationMode = activeMission?.collaborationMode || missionDraft.collaborationMode
  const checks = [
    { label: 'Party', ready: effectiveAgents.length > 0 },
    { label: 'Title', ready: missionDraft.title.trim().length > 0 },
    { label: 'Objective', ready: objectiveLength >= 20 },
  ]
  const readinessScore = Math.round((checks.filter((check) => check.ready).length / checks.length) * 100)
  const readinessState = readinessTone(readinessScore)
  const canDeploy = readinessScore === 100
  const schedulerStatusText = activeMission?.scheduler?.lastError
    ? `Attention needed / ${activeMission.scheduler.lastError}`
    : activeMission?.scheduler?.status === 'running'
    ? `agents working now / cycle ${activeMission.scheduler.round}`
    : activeMission?.scheduler?.status === 'waiting'
      ? `schedule active / ${formatNextMissionRun(activeMission.scheduler.nextRoundAt)}`
      : `${activeMission?.scheduler?.status || 'preparing'} / cycle ${activeMission?.scheduler?.round ?? 0}`
  const currentType = MISSION_TYPES.find((type) => type.id === missionDraft.missionType) || MISSION_TYPES[0]
  const currentMode = COLLAB_MODES.find((mode) => mode.id === missionDraft.collaborationMode) || COLLAB_MODES[0]
  const matchingPreset = PRESETS.find(
    (preset) => preset.title === missionDraft.title && preset.missionType === missionDraft.missionType,
  )
  const activePreset = matchingPreset && matchingPreset.collaborationMode === missionDraft.collaborationMode && matchingPreset.complexity === missionDraft.complexity && matchingPreset.riskTolerance === missionDraft.riskTolerance && matchingPreset.description === missionDraft.description ? matchingPreset : undefined
  const missionDisplayName = missionDraft.title.trim() || 'Custom setup'
  const objectiveCue = !objectiveLength
    ? 'Needs objective'
    : objectiveIsCustom
      ? 'Custom objective preserved'
      : 'Preset objective'

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const currentObjective = missionDraft.description.trim()
    const shouldReplaceObjective = !currentObjective || PRESET_OBJECTIVES.has(currentObjective)
    updateMissionDraft({
      title: preset.title, missionType: preset.missionType, collaborationMode: preset.collaborationMode,
      complexity: preset.complexity, riskTolerance: preset.riskTolerance,
      ...(shouldReplaceObjective ? { description: preset.description } : {}),
    })
  }

  const selectedHeartbeat = useMemo(() => {
    if (!selectedAgents.length) return null
    const values = selectedAgents.map((agent) => agent.heartbeat.tickIntervalMs)
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { min, max, mixed: min !== max }
  }, [selectedAgents])

  useEffect(() => {
    if (!selectedHeartbeat || selectedHeartbeat.mixed) return
    const timer = window.setTimeout(() => {
      const next = msToHeartbeat(selectedHeartbeat.min)
      setHeartbeatValue(next.value)
      setHeartbeatUnit(next.unit)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedHeartbeat])

  const applyHeartbeatToParty = () => {
    const tickIntervalMs = heartbeatToMs(heartbeatValue, heartbeatUnit)
    for (const agent of selectedAgents) {
      updateHeartbeat(agent.id, { tickIntervalMs })
    }
  }

  const applyHeartbeatToAgent = (agentId: string, value: number, unit: HeartbeatUnit) => {
    updateHeartbeat(agentId, { tickIntervalMs: heartbeatToMs(value, unit) })
  }

  return (
    <div className="dui-mission-wrap dui-missions-polished">
      <header className="dui-missions-page-head">
        <div><span>Mission control</span><h2>Missions</h2><p>Define the outcome. Assemble your team. Put your agents to work.</p></div>
        <div className="dui-missions-page-actions">
          <Button type="button" variant="secondary" size="compact" aria-expanded={showHistory} aria-controls={`${fieldId}-history`} onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? 'Hide recent jobs' : 'Recent jobs'} ({missionHistory.length})
          </Button>
        <div className="dui-missions-page-status" data-active={missionRunning || missionLaunchPending}>
          <i aria-hidden="true" />{missionLaunchPending ? 'Launching mission' : missionRunning ? 'Mission active' : 'New mission'}
        </div>
        </div>
      </header>
      <section data-dui-panel="missions" className="dui-mission-screen dui-mission-polished">
        <div className="dui-mission-stage">
          <div className="dui-mission-main dui-mission-main--organized">
            <div className="dui-card dui-template-card dui-template-card--organized">
              <div className="dui-section-head">
                <div>
                  <span>Quick start</span>
                  <strong>Start with a template</strong>
                </div>
                <div className="flex flex-wrap items-center gap-2"><p>{activePreset?.label || (matchingPreset ? `${matchingPreset.label} · Customized` : missionDisplayName)}</p><MissionTemplates /></div>
              </div>
              <div className="dui-template-strip">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    aria-pressed={activePreset?.label === preset.label}
                    style={accentVars(preset.accent)}
                    className={`dui-template-tile ${activePreset?.label === preset.label ? 'is-active' : ''}`}
                  >
                    <span className="dui-template-art">
                      <img src={preset.asset} alt="" aria-hidden="true" decoding="async" className="dui-template-icon" />
                    </span>
                    <span className="dui-template-copy">
                      <strong>{preset.label}</strong>
                      <small>{optionLabel(preset.missionType)} / {modeLabel(preset.collaborationMode)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="dui-card dui-mission-config-card">
              <div className="dui-section-head">
                <div>
                  <span>01 / Configuration</span>
                  <strong>Shape your mission</strong>
                </div>
                <p>{currentMode.hint}</p>
              </div>
              {activeMission && (
                <div className="dui-active-mission-strip" data-mission-projection-state={activeMission.status} data-mission-id={activeMission.id} aria-live="polite">
                  <span>Mission</span>
                  <strong>{activeMission.title}</strong>
                  <StatusChip
                    label={activeMission.scheduler?.status === 'running' ? 'Working now' : 'Mission active'}
                    value={schedulerStatusText}
                    state={activeMission.status}
                    tone={activeMission.scheduler?.lastError || activeMission.status === 'failed' ? 'error' : activeMission.status === 'running' ? 'success' : 'neutral'}
                    className="dui-active-mission-status"
                  />
                </div>
              )}
              <div className="dui-mission-config-grid">
                <div className="dui-field dui-mission-title-field">
                  <label htmlFor={`${fieldId}-title`}>Mission title</label>
                  <input
                    id={`${fieldId}-title`}
                    type="text"
                    value={missionDraft.title}
                    onChange={(e) => updateMissionDraft({ title: e.target.value })}
                    placeholder="Give your mission a clear name"
                    className="dui-control"
                  />
                </div>

                <div className="dui-mission-choice-group dui-mission-choice-group--mode">
                  <div className="dui-choice-head">
                    <div>
                      <span>How your team works</span>
                      <strong>{currentMode.label}</strong>
                    </div>
                    <p>{currentMode.hint}</p>
                  </div>
                  <div className="dui-segment-grid dui-segment-grid--organized">
                    {COLLAB_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => updateMissionDraft({ collaborationMode: mode.id })}
                        aria-pressed={missionDraft.collaborationMode === mode.id}
                        title={mode.detail}
                        style={accentVars(mode.accent)}
                        className="dui-option"
                      >
                        <span className="dui-option-art">
                          <FlatGlyph icon={mode.icon} />
                        </span>
                        <span className="dui-option-copy">
                          <strong>{mode.label}</strong>
                          <span>{mode.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dui-mission-choice-group dui-mission-choice-group--type">
                  <div className="dui-choice-head">
                    <div>
                      <span>Mission type</span>
                      <strong>{currentType.label}</strong>
                    </div>
                    <p>{currentType.hint}</p>
                  </div>
                  <div className="dui-type-grid dui-type-grid--organized">
                    {MISSION_TYPES.map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => updateMissionDraft({ missionType: type.id })}
                        aria-pressed={missionDraft.missionType === type.id}
                        title={type.detail}
                        style={accentVars(type.accent)}
                        className="dui-option"
                      >
                        <span className="dui-option-art">
                          <FlatGlyph icon={type.icon} />
                        </span>
                        <span className="dui-option-copy">
                          <strong>{type.label}</strong>
                          <span>{type.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

              {currentType.detail ? <p className="dui-inline-note dui-mission-config-note">{currentType.detail}</p> : null}
            </div>
            </div>

            <section className="dui-card dui-mission-bottom-objective">
              <div className="dui-section-head">
                <div>
                  <span>02 / Objective</span>
                  <strong>What does success look like?</strong>
                </div>
              </div>
              <textarea
                id={`${fieldId}-objective`}
                aria-label="Mission objective"
                aria-describedby={`${fieldId}-objective-hint`}
                value={missionDraft.description}
                rows={4}
                onChange={(e) => updateMissionDraft({ description: e.target.value })}
                placeholder="Describe the outcome, key requirements, and what your team should deliver…"
                className="dui-control dui-textarea"
              />
              <p id={`${fieldId}-objective-hint`} className="dui-objective-hint"><span>{objectiveCue} · At least 20 characters.</span><span>{missionDraft.description.trim().length} characters</span></p>
            </section>
          </div>

          <aside className="dui-mission-sidebar">
            <div className="dui-card dui-agents-card">
              <div className="dui-section-head">
                <div>
                  <span>Your team</span>
                  <strong>{effectiveAgents.length || 0} agent{effectiveAgents.length === 1 ? '' : 's'} ready</strong>
                </div>
                <p>{missionLaunchPending ? 'Launching now' : missionRunning ? activeMission.scheduler?.status === 'running' ? 'Agents running' : 'Schedule active' : 'Standing by'}</p>
              </div>
              <div className="dui-agent-list">
                {selectedAgents.map((agent, index) => {
                  const busy = busyAgentSet.has(agent.id)
                  const heartbeat = msToHeartbeat(agent.heartbeat.tickIntervalMs)
                  const excluded = excludedAgents.some((entry) => entry.id === agent.id)
                  const portraitSrc = agentPortraitSrc(agent.id, agent.portrait)
                  const portraitKey = `${agent.id}::${portraitSrc}`
                  const portraitFailed = portraitSrc ? failedPortraitKeys.has(portraitKey) : false
                  const laneLabel = displayedCollaborationMode === 'hierarchical'
                    ? index === 0 ? 'Slot 1 commander' : `Execution lane ${index + 1}`
                    : displayedCollaborationMode === 'sequential'
                      ? `Relay slot ${index + 1}`
                      : displayedCollaborationMode === 'swarm'
                        ? `Swarm lane ${index + 1}`
                        : displayedCollaborationMode === 'specialist'
                          ? `Specialist lane ${index + 1}`
                          : `Parallel lane ${index + 1}`
                  return (
                    <div key={agent.id} className={`dui-agent-row ${busy ? 'is-busy' : ''} ${excluded ? 'is-excluded' : ''}`}>
                      <div className="dui-agent-avatar">
                        {portraitSrc && !portraitFailed ? (
                          <img
                            src={portraitSrc}
                            alt=""
                            onError={() => setFailedPortraitKeys((current) => new Set(current).add(portraitKey))}
                          />
                        ) : <span>{agent.name.charAt(0)}</span>}
                      </div>
                      <div className="dui-agent-main">
                        <strong>{agent.name}</strong>
                        <p>{excluded ? 'Specialist standby' : laneLabel} / {agent.role}</p>
                        <div>
                          <span>{formatHeartbeat(agent.heartbeat.tickIntervalMs)} cron</span>
                          <span>{formatWorkTimeout(agent.runtimePolicy?.timeoutSeconds)} work</span>
                        </div>
                      </div>
                      <div className="dui-agent-cadence">
                        <input
                          type="number"
                          aria-label={`${agent.name} cadence interval`}
                          inputMode="numeric"
                          min={1}
                          value={heartbeat.value}
                          disabled={missionRunning}
                          onChange={(e) => applyHeartbeatToAgent(agent.id, Number(e.target.value), heartbeat.unit)}
                          className="dui-control dui-cadence-number"
                        />
                        <select
                          aria-label={`${agent.name} cadence unit`}
                          value={heartbeat.unit}
                          disabled={missionRunning}
                          onChange={(e) => applyHeartbeatToAgent(agent.id, heartbeat.value, e.target.value as HeartbeatUnit)}
                          className="dui-control dui-cadence-unit"
                        >
                          <option value="seconds">Seconds</option>
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                        </select>
                      </div>
                    </div>
                  )
                })}
                {!selectedAgents.length && <div className="dui-empty-state"><MissionGlyphIcon icon="command" /><strong>Every mission starts with a team</strong><p>Add agents to your active party from the Agents tab. They’ll appear here, ready to deploy.</p></div>}
              </div>
            </div>
            <section className="dui-card dui-mission-bottom-tuning">
              <div className="dui-section-head dui-section-head--dispatch">
                <div>
                  <span>03 / Review & launch</span>
                  <strong>Review your mission</strong>
                </div>
                <div className="dui-readiness-mini" data-tone={readinessState}>
                  <div className="dui-readiness-mini-head">
                    <span>Form readiness</span>
                    <strong>{readinessScore}%</strong>
                  </div>
                  <div className="dui-progress-track" role="meter" aria-label="Mission form readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readinessScore}>
                    <div className="dui-progress-fill" style={{ width: `${readinessScore}%` }} />
                  </div>
                  <div className="dui-readiness-mini-checks" aria-hidden="true">
                    {checks.map((check) => (
                      <i key={check.label} className={check.ready ? 'is-ready' : 'is-missing'} title={check.label} />
                    ))}
                  </div>
                  <ul className="dui-readiness-checklist">
                    {checks.map((check) => <li key={check.label} data-ready={check.ready}><span aria-hidden="true">{check.ready ? '✓' : '○'}</span> {check.label}: {check.ready ? 'ready' : <button type="button" className="underline underline-offset-2" onClick={() => {
                      if (check.label === 'Party') { useNexusStore.getState().setTab('agents'); return }
                      const control = document.getElementById(`${fieldId}-${check.label === 'Title' ? 'title' : 'objective'}`)
                      control?.scrollIntoView({ block: 'center', behavior: 'instant' }); control?.focus({ preventScroll: true })
                    }}>Add {check.label.toLowerCase()}</button>}</li>)}
                  </ul>
                </div>
              </div>
              <p className="dui-dispatch-copy">{currentMode.detail}</p>
              <p className="text-[12px] text-slate-400">Form readiness checks your inputs. Provider access and agent runtime are checked when you launch.</p>
              <div className="dui-stat-grid">
                <div><span>Eligible</span><strong>{effectiveAgents.length}</strong></div>
                <div><span>Fit</span><strong>{capabilityCoverage}%</strong></div>
                <div><span>Type</span><strong>{currentType.label}</strong></div>
              </div>

              <div className="dui-slider-grid">
                {([
                  ['Complexity', missionDraft.complexity, 'complexity'] as const,
                  ['Risk', missionDraft.riskTolerance, 'risk'] as const,
                ]).map(([label, value, kind]) => (
                  <label key={label} className="dui-range-field" data-tone={gaugeTone(value, kind)}>
                    <span>{label}<strong>{value}%</strong></span>
                    <input
                      type="range"
                      aria-label={label}
                      aria-valuetext={`${value}%`}
                      className="dy-colored-range"
                      min={1}
                      max={100}
                      value={value}
                      onChange={(e) => updateMissionDraft(kind === 'complexity' ? { complexity: Number(e.target.value) } : { riskTolerance: Number(e.target.value) })}
                      style={{ '--dy-range-value': `${value}%` } as CSSProperties}
                    />
                  </label>
                ))}
              </div>

              <div className="dui-action-grid">
                <Button type="button" aria-expanded={showTiming} aria-controls={`${fieldId}-timing`} onClick={() => setShowTiming((v) => !v)} className="dui-secondary-button" variant="secondary" size="compact">
                  Timing <span>{missionDraft.durationMode}</span>
                </Button>
                <Button
                  type="button"
                  onClick={missionRunning ? stopMission : deployMission}
                  disabled={missionLaunchPending || (!missionRunning && !canDeploy)}
                  variant={missionRunning ? 'danger' : 'primary'}
                  size="primary"
                  className={`dui-primary-button dui-mission-deploy-button ${missionRunning ? 'is-stop' : ''}`}
                >
                  {missionRunning ? 'Stop Mission' : missionLaunchPending ? 'Deploying…' : 'Deploy & Run Now'}
                </Button>
              </div>

              {showTiming && (
                <div id={`${fieldId}-timing`} className="dui-timing-panel dy-surface-enter">
                  <section className="dui-mission-bottom-cron">
                    <div className="dui-section-head compact">
                      <div>
                        <span>Schedule</span>
                        <strong>{selectedHeartbeat ? `Run now · then ${selectedHeartbeat.mixed ? `${formatHeartbeat(selectedHeartbeat.min)}-${formatHeartbeat(selectedHeartbeat.max)}` : formatHeartbeat(selectedHeartbeat.min)}` : 'Set a cadence'}</strong>
                      </div>
                      <p>{missionDraft.durationMode}</p>
                    </div>
                    <div className="dui-cadence-grid">
                      <input aria-label="Party cadence interval" type="number" inputMode="numeric" min={1} value={heartbeatValue} onChange={(e) => setHeartbeatValue(Number(e.target.value))} className="dui-control dui-cadence-number" />
                      <select aria-label="Party cadence unit" value={heartbeatUnit} onChange={(e) => setHeartbeatUnit(e.target.value as HeartbeatUnit)} className="dui-control dui-cadence-unit">
                        <option value="seconds">Seconds</option>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                      </select>
                      <Button type="button" onClick={applyHeartbeatToParty} disabled={!selectedAgents.length || missionRunning} className="dui-secondary-button" variant="secondary" size="compact">
                        Apply Cadence
                      </Button>
                    </div>
                    <p className="dui-mission-schedule-note">Deploy starts the first cycle immediately. The cadence controls later cycles only.</p>

                    <div className="dui-loadout-head">
                      <span>Team capacity</span>
                      <div className="dui-avatar-stack">
                        {effectiveAgents.slice(0, 6).map((agent) => {
                          const portraitSrc = agentPortraitSrc(agent.id, agent.portrait)
                          const portraitKey = `${agent.id}::${portraitSrc}`
                          const portraitFailed = portraitSrc ? failedPortraitKeys.has(portraitKey) : false
                          return (
                            <div key={agent.id}>
                              {portraitSrc && !portraitFailed ? (
                                <img
                                  src={portraitSrc}
                                  alt=""
                                  onError={() => setFailedPortraitKeys((current) => new Set(current).add(portraitKey))}
                                />
                              ) : <span>{agent.name.charAt(0)}</span>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <div className="dui-meter-grid">
                      {([
                        ['Complexity', missionDraft.complexity, 'complexity'] as const,
                        ['Risk', missionDraft.riskTolerance, 'risk'] as const,
                        ['Lanes', Math.min(100, effectiveAgents.length * 17), 'complexity'] as const,
                      ]).map(([label, value, kind]) => (
                        <div key={label} className="dui-meter" data-tone={label === 'Lanes' ? 'cool' : gaugeTone(value, kind)}>
                          <div><span>{label}</span><strong>{label === 'Lanes' ? effectiveAgents.length : `${value}%`}</strong></div>
                          <div className="dui-progress-track"><div className="dui-progress-fill" style={{ width: `${value}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <div className="dui-duration-grid">
                    {DURATION_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => updateMissionDraft({ durationMode: mode.id })}
                        title={mode.hint}
                        aria-pressed={missionDraft.durationMode === mode.id}
                        style={accentVars(mode.accent)}
                        className="dui-option"
                      >
                        <span className="dui-option-art">
                          <FlatGlyph icon={mode.icon} />
                        </span>
                        <span className="dui-option-copy">
                          <strong>{mode.label}</strong>
                          <span>{mode.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {missionDraft.durationMode === 'timed' && (
                    <div className="dui-timed-row">
                      <input aria-label="Mission duration" type="number" min={1} value={missionDraft.durationValue} onChange={(e) => updateMissionDraft({ durationValue: Number(e.target.value) })} className="dui-control" />
                      <select aria-label="Mission duration unit" value={missionDraft.durationUnit} onChange={(e) => updateMissionDraft({ durationUnit: e.target.value as DurationUnit })} className="dui-control">
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {missionRunning && (
                <Button type="button" onClick={steerMission} disabled={!canDeploy} className="dui-steer-button" variant="secondary" size="compact">
                  Steer Mission
                </Button>
              )}
            </section>
          </aside>


        </div>
      </section>

      {showHistory && (
        <section id={`${fieldId}-history`} className="dui-mission-history" aria-label="Recent jobs">
          <div className="dui-section-head">
            <div>
              <span>Recent jobs</span>
              <strong>{missionHistory.length} runs</strong>
            </div>
            <Button type="button" variant="secondary" size="compact" onClick={() => setShowHistory(false)}>Hide recent jobs</Button>
          </div>
          {missionHistory.length === 0 && <p>No recent jobs yet.</p>}
          <div className="dui-history-grid">
            {missionHistory.slice(0, 9).map((mission) => (
              <div key={mission.id} className="dui-history-item">
                <strong>{mission.title}</strong>
                <Badge tone={mission.status === 'running' ? 'success' : mission.status === 'failed' ? 'error' : 'neutral'} size="micro">{mission.status}</Badge>
                <p>{mission.collaborationMode} / {mission.selectedAgents.length} agents / {new Date(mission.startedAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
