export type ClawHubInstallConfirmation = {
  confirmationId: string
  skillRef: string
  version?: string
  outcome: string
  publisher?: string
  summary: string
  detailsUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseClawHubInstallConfirmation(detail?: string): ClawHubInstallConfirmation | null {
  if (!detail?.trim()) return null
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.confirmation)) return null
    const confirmation = parsed.confirmation
    if (
      typeof confirmation.confirmationId !== 'string' ||
      typeof confirmation.skillRef !== 'string' ||
      typeof confirmation.outcome !== 'string' ||
      typeof confirmation.summary !== 'string'
    ) return null
    return {
      confirmationId: confirmation.confirmationId,
      skillRef: confirmation.skillRef,
      ...(typeof confirmation.version === 'string' ? { version: confirmation.version } : {}),
      outcome: confirmation.outcome,
      ...(typeof confirmation.publisher === 'string' ? { publisher: confirmation.publisher } : {}),
      summary: confirmation.summary,
      ...(typeof confirmation.detailsUrl === 'string' ? { detailsUrl: confirmation.detailsUrl } : {}),
    }
  } catch {
    return null
  }
}

export function clawHubInstallConfirmationPrompt(confirmation: ClawHubInstallConfirmation) {
  const version = confirmation.version ? ` v${confirmation.version}` : ''
  const publisher = confirmation.publisher ? `Publisher: ${confirmation.publisher}` : ''
  const details = confirmation.detailsUrl ? `Audit details: ${confirmation.detailsUrl}` : ''
  return [
    `ClawHub security review: ${confirmation.skillRef}${version}`,
    `Outcome: ${confirmation.outcome}`,
    publisher,
    `Review summary: ${confirmation.summary}`,
    details,
    '',
    'Install this third-party skill anyway?',
  ].filter(Boolean).join('\n')
}
