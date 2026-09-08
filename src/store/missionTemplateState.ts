import type { MissionDraft, MissionEvidenceRequirement } from '../types/nexus'

/** Copy only editable configuration; a rerun must never inherit execution state. */
export function missionDraftFromRecord(value: unknown): MissionDraft | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.title !== 'string' || input.title.length > 300 || typeof input.description !== 'string' || input.description.length > 100_000) return null
  for (const field of ['complexity', 'riskTolerance']) if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < 0 || input[field] > 100) return null
  if (typeof input.durationValue !== 'number' || !Number.isFinite(input.durationValue) || input.durationValue < 1 || input.durationValue > 10_000) return null
  if (!['instant', 'timed', 'continuous', 'indefinite'].includes(String(input.durationMode))) return null
  if (!['hours', 'days', 'weeks'].includes(String(input.durationUnit))) return null
  if (!['parallel', 'sequential', 'hierarchical', 'swarm', 'specialist'].includes(String(input.collaborationMode))) return null
  if (!['codeGeneration', 'planning', 'research', 'orchestration', 'memoryManagement'].includes(String(input.missionType))) return null
  let requiredEvidence: MissionEvidenceRequirement[] | undefined
  if (input.requiredEvidence !== undefined) {
    if (!Array.isArray(input.requiredEvidence) || input.requiredEvidence.length > 50) return null
    requiredEvidence = []
    for (const row of input.requiredEvidence) {
      if (!row || typeof row !== 'object' || !['filesChanged', 'tests', 'build', 'humanPath', 'riskReview', 'runtimePreflight', 'teamSync'].includes(row.kind) || typeof row.label !== 'string' || row.label.length > 4000 || typeof row.required !== 'boolean' || (row.command !== undefined && (typeof row.command !== 'string' || row.command.length > 16_000))) return null
      requiredEvidence.push({ kind: row.kind, label: row.label, required: row.required, ...(row.command === undefined ? {} : { command: row.command }) })
    }
  }
  return {
    title: input.title, description: input.description,
    complexity: input.complexity as number, riskTolerance: input.riskTolerance as number,
    durationValue: input.durationValue, durationMode: input.durationMode as MissionDraft['durationMode'], durationUnit: input.durationUnit as MissionDraft['durationUnit'],
    collaborationMode: input.collaborationMode as MissionDraft['collaborationMode'], missionType: input.missionType as MissionDraft['missionType'],
    ...(requiredEvidence ? { requiredEvidence } : {}),
  }
}
