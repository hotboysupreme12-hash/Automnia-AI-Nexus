import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useNexusStore } from '../../store/nexusStore'
import type { CapabilityKey, CollaborationMode, DurationMode, DurationUnit } from '../../types/nexus'
import { MISSION_GLYPH_ASSETS, MISSION_PRESET_ASSETS, preloadMissionIconAssets } from './missionIconAssets'
import type { MissionGlyph } from './missionIconAssets'
import './MissionDeploymentPanel.css'

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

function glyphShape(icon: MissionGlyph) {
  switch (icon) {
    case 'code':
      return (
        <>
          <path className="dui-mission-glyph__line" d="M18.5 15.5 10.5 24l8 8.5" />
          <path className="dui-mission-glyph__line" d="M29.5 15.5 37.5 24l-8 8.5" />
          <path className="dui-mission-glyph__soft" d="M27 12.5 21 35.5" />
          <path className="dui-mission-glyph__soft" d="M14 38h11" />
          <path className="dui-mission-glyph__soft" d="M29 38h7" />
          <circle className="dui-mission-glyph__dot" cx="12" cy="10" r="2" />
          <circle className="dui-mission-glyph__dot" cx="19" cy="10" r="2" />
        </>
      )
    case 'plan':
      return (
        <>
          <rect className="dui-mission-glyph__panel" x="13" y="12" width="22" height="28" rx="4" />
          <path className="dui-mission-glyph__line" d="M19 17h10" />
          <path className="dui-mission-glyph__line" d="M19 24h13" />
          <path className="dui-mission-glyph__line" d="M19 31h10" />
          <path className="dui-mission-glyph__soft" d="m14.5 24 2 2 4-5" />
          <path className="dui-mission-glyph__soft" d="m14.5 31 2 2 4-5" />
          <rect className="dui-mission-glyph__solid" x="19" y="8" width="10" height="6" rx="2" />
        </>
      )
    case 'research':
      return (
        <>
          <path className="dui-mission-glyph__soft" d="m13 28 7-5 7 4 8-10" />
          <circle className="dui-mission-glyph__dot" cx="13" cy="28" r="2.2" />
          <circle className="dui-mission-glyph__dot" cx="20" cy="23" r="2.2" />
          <circle className="dui-mission-glyph__dot" cx="27" cy="27" r="2.2" />
          <circle className="dui-mission-glyph__dot" cx="35" cy="17" r="2.2" />
          <circle className="dui-mission-glyph__line" cx="23" cy="24" r="9" />
          <path className="dui-mission-glyph__line" d="m30 31 7 7" />
        </>
      )
    case 'launch':
      return (
        <>
          <path className="dui-mission-glyph__panel" d="M25 9c5 3 8 8 8 15l-7 7h-4l-5-5v-4l8-13Z" />
          <circle className="dui-mission-glyph__dot" cx="27" cy="19" r="3" />
          <path className="dui-mission-glyph__line" d="M17 22h-5l5-7" />
          <path className="dui-mission-glyph__line" d="M26 31v5l7-5" />
          <path className="dui-mission-glyph__solid" d="M18 31c-3 1-5 3-6 6 4-1 6-3 7-6h-1Z" />
        </>
      )
    case 'command':
      return (
        <>
          <path className="dui-mission-glyph__soft" d="M14 14h20v20H14z" />
          <path className="dui-mission-glyph__soft" d="M14 24h20M24 14v20" />
          <path className="dui-mission-glyph__solid" d="m24 17 2.2 4.6 5 1-3.6 3.6.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.6 5-1L24 17Z" />
          <circle className="dui-mission-glyph__dot" cx="14" cy="14" r="2.8" />
          <circle className="dui-mission-glyph__dot" cx="34" cy="14" r="2.8" />
          <circle className="dui-mission-glyph__dot" cx="14" cy="34" r="2.8" />
          <circle className="dui-mission-glyph__dot" cx="34" cy="34" r="2.8" />
        </>
      )
    case 'build':
      return (
        <>
          <path className="dui-mission-glyph__line" d="m14 35 13-13" />
          <path className="dui-mission-glyph__line" d="m11 32 5 5" />
          <path className="dui-mission-glyph__panel" d="M26 13c4-3 8-2 11 1l-7 2 2 5-5 2-4-4 3-6Z" />
          <path className="dui-mission-glyph__soft" d="M27 35h11M31 30h7" />
          <circle className="dui-mission-glyph__dot" cx="15" cy="33" r="2" />
        </>
      )
    case 'memory':
      return (
        <>
          <path className="dui-mission-glyph__panel" d="M13 14c0-4 22-4 22 0v20c0 4-22 4-22 0V14Z" />
          <path className="dui-mission-glyph__line" d="M13 14c0 4 22 4 22 0" />
          <path className="dui-mission-glyph__soft" d="M13 21c0 4 22 4 22 0M13 28c0 4 22 4 22 0M13 35c0 4 22 4 22 0" />
        </>
      )
    case 'parallel':
      return (
        <>
          <path className="dui-mission-glyph__line" d="M11 14h20" />
          <path className="dui-mission-glyph__line" d="M11 24h25" />
          <path className="dui-mission-glyph__line" d="M11 34h20" />
          <path className="dui-mission-glyph__line" d="m31 10 5 4-5 4" />
          <path className="dui-mission-glyph__line" d="m36 20 5 4-5 4" />
          <path className="dui-mission-glyph__line" d="m31 30 5 4-5 4" />
          <circle className="dui-mission-glyph__dot" cx="11" cy="14" r="2" />
          <circle className="dui-mission-glyph__dot" cx="11" cy="24" r="2" />
          <circle className="dui-mission-glyph__dot" cx="11" cy="34" r="2" />
        </>
      )
    case 'specialist':
      return (
        <>
          <circle className="dui-mission-glyph__soft" cx="24" cy="24" r="15" />
          <circle className="dui-mission-glyph__line" cx="24" cy="24" r="9" />
          <circle className="dui-mission-glyph__solid" cx="24" cy="24" r="4" />
          <path className="dui-mission-glyph__line" d="M24 7v8M24 33v8M7 24h8M33 24h8" />
        </>
      )
    case 'relay':
      return (
        <>
          <path className="dui-mission-glyph__line" d="M14 17h13c5 0 8 3 8 7s-3 7-8 7H16" />
          <path className="dui-mission-glyph__line" d="m16 25-6 6 6 6" />
          <path className="dui-mission-glyph__line" d="m32 11 6 6-6 6" />
          <circle className="dui-mission-glyph__dot" cx="14" cy="17" r="2.4" />
          <circle className="dui-mission-glyph__dot" cx="35" cy="31" r="2.4" />
        </>
      )
    case 'swarm':
      return (
        <>
          <path className="dui-mission-glyph__soft" d="M15 16 24 24l10-10M24 24l-8 9m8-9 9 8m-18 1h18" />
          <circle className="dui-mission-glyph__dot" cx="15" cy="16" r="4" />
          <circle className="dui-mission-glyph__dot" cx="34" cy="14" r="4" />
          <circle className="dui-mission-glyph__solid" cx="24" cy="24" r="5" />
          <circle className="dui-mission-glyph__dot" cx="16" cy="33" r="4" />
          <circle className="dui-mission-glyph__dot" cx="33" cy="32" r="4" />
        </>
      )
    case 'strike':
      return (
        <>
          <path className="dui-mission-glyph__soft" d="M28 8 15 26h9l-4 14 13-19h-9l4-13Z" />
          <path className="dui-mission-glyph__solid" d="M28 8 15 26h9l-4 14 13-19h-9l4-13Z" />
        </>
      )
    case 'shift':
      return (
        <>
          <path className="dui-mission-glyph__panel" d="M15 10h18M15 38h18M17 10c0 9 14 9 14 14S17 29 17 38M31 10c0 9-14 9-14 14s14 5 14 14" />
          <path className="dui-mission-glyph__soft" d="M20 18h8M20 30h8" />
          <circle className="dui-mission-glyph__dot" cx="24" cy="24" r="2.5" />
        </>
      )
    case 'loop':
      return (
        <>
          <path className="dui-mission-glyph__line" d="M34 18a12 12 0 0 0-21 4" />
          <path className="dui-mission-glyph__line" d="m34 11 1 8-8-1" />
          <path className="dui-mission-glyph__line" d="M14 30a12 12 0 0 0 21-4" />
          <path className="dui-mission-glyph__line" d="m14 37-1-8 8 1" />
          <circle className="dui-mission-glyph__solid" cx="24" cy="24" r="3" />
        </>
      )
    case 'watch':
      return (
        <>
          <path className="dui-mission-glyph__panel" d="M8 24s6-10 16-10 16 10 16 10-6 10-16 10S8 24 8 24Z" />
          <circle className="dui-mission-glyph__line" cx="24" cy="24" r="6" />
          <circle className="dui-mission-glyph__solid" cx="24" cy="24" r="2.7" />
          <path className="dui-mission-glyph__soft" d="M24 9v-3M24 42v-3M39 24h3M6 24h3" />
        </>
      )
    default:
      return null
  }
}

export function MissionGlyphIcon({ icon, className }: { icon: MissionGlyph; className: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={`dui-mission-glyph ${className}`}
    >
      {glyphShape(icon)}
    </svg>
  )
}

function FlatGlyph({ icon }: { icon: MissionGlyph }) {
  return (
    <>
      <img
        src={MISSION_GLYPH_ASSETS[icon]}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={52}
        height={52}
        loading="eager"
        decoding="sync"
        className="dui-flat-glyph"
      />
    </>
  )
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

export function MissionDeploymentPanel() {
  const agents = useNexusStore((s) => s.agents)
  const missionDraft = useNexusStore((s) => s.missionDraft)
  const activePartyIds = useNexusStore((s) => s.activePartyIds)
  const confirmedPartyIds = useNexusStore((s) => s.confirmedPartyIds)
  const activeMission = useNexusStore((s) => s.activeMission)
  const missionHistory = useNexusStore((s) => s.missionHistory)
  const busyAgentIds = useNexusStore((s) => s.busyAgentIds)
  const updateMissionDraft = useNexusStore((s) => s.updateMissionDraft)
  const updateHeartbeat = useNexusStore((s) => s.updateHeartbeat)
  const deployMission = useNexusStore((s) => s.deployMission)
  const steerMission = useNexusStore((s) => s.steerMission)
  const stopMission = useNexusStore((s) => s.stopMission)

  const [showTiming, setShowTiming] = useState(false)
  const [heartbeatValue, setHeartbeatValue] = useState(30)
  const [heartbeatUnit, setHeartbeatUnit] = useState<HeartbeatUnit>('seconds')
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
  const runningLaneCount = effectiveAgents.filter((agent) => busyAgentSet.has(agent.id)).length
  const objectiveLength = missionDraft.description.trim().length
  const objectiveIsPresetCopy = PRESET_OBJECTIVES.has(missionDraft.description.trim())
  const objectiveIsCustom = objectiveLength > 0 && !objectiveIsPresetCopy
  const checks = [
    { label: 'Party', ready: effectiveAgents.length > 0 },
    { label: 'Title', ready: missionDraft.title.trim().length > 0 },
    { label: 'Objective', ready: objectiveLength >= 20 },
  ]
  const readinessScore = Math.round((checks.filter((check) => check.ready).length / checks.length) * 100)
  const readinessState = readinessTone(readinessScore)
  const canDeploy = readinessScore === 100
  const currentType = MISSION_TYPES.find((type) => type.id === missionDraft.missionType) || MISSION_TYPES[0]
  const currentMode = COLLAB_MODES.find((mode) => mode.id === missionDraft.collaborationMode) || COLLAB_MODES[0]
  const activePreset = PRESETS.find(
    (preset) => preset.title === missionDraft.title && preset.missionType === missionDraft.missionType,
  )
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
    void preloadMissionIconAssets()
  }, [])

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
    <div className="dui-mission-wrap">
      <section data-dui-panel="missions" className="dui-mission-screen">
        <div className="dui-mission-stage">
          <main className="dui-mission-main dui-mission-main--organized">
            <div className="dui-card dui-template-card dui-template-card--organized">
              <div className="dui-section-head">
                <div>
                  <span>Mission Presets</span>
                  <strong>{activePreset?.label || missionDisplayName}</strong>
                </div>
                <p>Preset shapes</p>
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
                      <img
                        src={preset.asset}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        width={72}
                        height={72}
                        loading="eager"
                        decoding="sync"
                        className="dui-template-icon"
                      />
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
                  <span>Mission Setup</span>
                  <strong>{currentMode.label} / {currentType.label}</strong>
                </div>
                <p>{currentMode.hint}</p>
              </div>
              {activeMission && (
                <div className="dui-active-mission-strip" data-mission-projection-state={activeMission.status} data-mission-id={activeMission.id} aria-live="polite">
                  <span>Mission</span>
                  <strong>{activeMission.title}</strong>
                  <small>
                    {activeMission.status} / {activeMission.scheduler?.status || 'scheduler'} / round {activeMission.scheduler?.round ?? 0}
                  </small>
                </div>
              )}
              <div className="dui-mission-config-grid">
                <div className="dui-field dui-mission-title-field">
                  <label>Mission title</label>
                  <input
                    type="text"
                    value={missionDraft.title}
                    onChange={(e) => updateMissionDraft({ title: e.target.value })}
                    placeholder="Name the operation"
                    className="dui-control"
                  />
                </div>

                <div className="dui-mission-choice-group dui-mission-choice-group--mode">
                  <div className="dui-choice-head">
                    <div>
                      <span>Dispatch mode</span>
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

          </main>

          <aside className="dui-mission-sidebar">
            <div className="dui-card dui-agents-card">
              <div className="dui-section-head">
                <div>
                  <span>Agents</span>
                  <strong>{effectiveAgents.length || 0} armed</strong>
                </div>
                <p>{missionRunning ? `${runningLaneCount} live` : 'Standing by'}</p>
              </div>
              <div className="dui-agent-list">
                {selectedAgents.map((agent, index) => {
                  const busy = busyAgentSet.has(agent.id)
                  const heartbeat = msToHeartbeat(agent.heartbeat.tickIntervalMs)
                  const excluded = excludedAgents.some((entry) => entry.id === agent.id)
                  return (
                    <div key={agent.id} className={`dui-agent-row ${busy ? 'is-busy' : ''} ${excluded ? 'is-excluded' : ''}`}>
                      <div className="dui-agent-avatar">
                        {agent.portrait ? <img src={agent.portrait} alt="" /> : <span>{agent.name.charAt(0)}</span>}
                      </div>
                      <div className="dui-agent-main">
                        <strong>{agent.name}</strong>
                        <p>{excluded ? 'Specialist standby' : index === 0 ? 'Slot 1 commander' : `Lane ${index + 1}`} / {agent.role}</p>
                        <div>
                          <span>{formatHeartbeat(agent.heartbeat.tickIntervalMs)} cron</span>
                          <span>{formatWorkTimeout(agent.runtimePolicy?.timeoutSeconds)} work</span>
                        </div>
                      </div>
                      <div className="dui-agent-cadence">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={heartbeat.value}
                          disabled={missionRunning}
                          onChange={(e) => applyHeartbeatToAgent(agent.id, Number(e.target.value), heartbeat.unit)}
                          className="dui-control dui-cadence-number"
                        />
                        <select
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
                {!selectedAgents.length && <div className="dui-empty-state">Add agents from the registry first.</div>}
              </div>
            </div>
          </aside>

          <div className="dui-card dui-mission-bottom-card">
            <section className="dui-mission-bottom-objective">
              <div className="dui-section-head">
                <div>
                  <span>Objective</span>
                  <strong>{objectiveCue}</strong>
                </div>
              </div>
              <textarea
                value={missionDraft.description}
                rows={4}
                onChange={(e) => updateMissionDraft({ description: e.target.value })}
                placeholder="What should the active party accomplish?"
                className="dui-control dui-textarea"
              />
            </section>

            <section className="dui-mission-bottom-cron">
              <div className="dui-section-head compact">
                <div>
                  <span>Mission Cron</span>
                  <strong>{selectedHeartbeat ? selectedHeartbeat.mixed ? `${formatHeartbeat(selectedHeartbeat.min)}-${formatHeartbeat(selectedHeartbeat.max)}` : formatHeartbeat(selectedHeartbeat.min) : 'Unset'}</strong>
                </div>
                <p>{missionDraft.durationMode}</p>
              </div>
              <div className="dui-cadence-grid">
                <input type="number" inputMode="numeric" min={1} value={heartbeatValue} onChange={(e) => setHeartbeatValue(Number(e.target.value))} className="dui-control dui-cadence-number" />
                <select value={heartbeatUnit} onChange={(e) => setHeartbeatUnit(e.target.value as HeartbeatUnit)} className="dui-control dui-cadence-unit">
                  <option value="seconds">Seconds</option>
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                </select>
                <button type="button" onClick={applyHeartbeatToParty} disabled={!selectedAgents.length || missionRunning} className="dui-secondary-button">
                  Apply Cadence
                </button>
              </div>

              <div className="dui-loadout-head">
                <span>Active Loadout</span>
                <div className="dui-avatar-stack">
                  {effectiveAgents.slice(0, 6).map((agent) => (
                    <div key={agent.id}>
                      {agent.portrait ? <img src={agent.portrait} alt="" /> : <span>{agent.name.charAt(0)}</span>}
                    </div>
                  ))}
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

            <section className="dui-mission-bottom-tuning">
              <div className="dui-section-head dui-section-head--dispatch">
                <div>
                  <span>Dispatch Mode</span>
                  <strong>{currentMode.label}</strong>
                </div>
                <div className="dui-readiness-mini" data-tone={readinessState} aria-label={`Launch readiness ${readinessScore}%`}>
                  <div className="dui-readiness-mini-head">
                    <span>Launch readiness</span>
                    <strong>{readinessScore}%</strong>
                  </div>
                  <div className="dui-progress-track">
                    <motion.div className="dui-progress-fill" initial={false} animate={{ width: `${readinessScore}%` }} transition={{ duration: 0.28 }} />
                  </div>
                  <div className="dui-readiness-mini-checks" aria-hidden="true">
                    {checks.map((check) => (
                      <i key={check.label} className={check.ready ? 'is-ready' : 'is-missing'} title={check.label} />
                    ))}
                  </div>
                </div>
              </div>
              <p className="dui-dispatch-copy">{currentMode.detail}</p>
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
                <button type="button" onClick={() => setShowTiming((v) => !v)} className="dui-secondary-button">
                  Timing <span>{missionDraft.durationMode}</span>
                </button>
                <button
                  type="button"
                  onClick={missionRunning ? stopMission : deployMission}
                  disabled={!missionRunning && !canDeploy}
                  className={`dui-primary-button dui-mission-deploy-button ${missionRunning ? 'is-stop' : ''}`}
                >
                  {missionRunning ? 'Stop Mission' : 'Deploy Mission'}
                </button>
              </div>

              {showTiming && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="dui-timing-panel">
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
                      <input type="number" min={1} value={missionDraft.durationValue} onChange={(e) => updateMissionDraft({ durationValue: Number(e.target.value) })} className="dui-control" />
                      <select value={missionDraft.durationUnit} onChange={(e) => updateMissionDraft({ durationUnit: e.target.value as DurationUnit })} className="dui-control">
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                      </select>
                    </div>
                  )}
                </motion.div>
              )}

              {missionRunning && (
                <button type="button" onClick={steerMission} disabled={!canDeploy} className="dui-steer-button">
                  Steer Mission
                </button>
              )}
            </section>
          </div>
        </div>
      </section>

      {missionHistory.length > 0 && (
        <section className="dui-mission-history">
          <div className="dui-section-head">
            <div>
              <span>Mission History</span>
              <strong>{missionHistory.length} runs</strong>
            </div>
            <p>Recent</p>
          </div>
          <div className="dui-history-grid">
            {missionHistory.slice(0, 9).map((mission) => (
              <div key={mission.id} className="dui-history-item">
                <strong>{mission.title}</strong>
                <span>{mission.status}</span>
                <p>{mission.collaborationMode} / {mission.selectedAgents.length} agents / {new Date(mission.startedAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
