export function isResponseRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
export function isUploadResponse(value: unknown): boolean {
  if (!isResponseRecord(value) || !isResponseRecord(value.attachment)) return false
  const file = value.attachment
  return ['id', 'name', 'path', 'mimeType'].every((key) => typeof file[key] === 'string' && (file[key] as string).length > 0)
    && typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 25 * 1024 * 1024
    && (file.kind === 'image' || file.kind === 'file')
    && (file.delivery === undefined || file.delivery === 'inline' || file.delivery === 'workspace')
}
function isShift(value: unknown) {
  return isResponseRecord(value) && ['id', 'agent', 'name'].every((key) => typeof value[key] === 'string') && Boolean(value.id)
}
export function isShiftStartResponse(value: unknown): boolean { return isResponseRecord(value) && isShift(value.shift) }
export function isShiftListResponse(value: unknown): boolean { return isResponseRecord(value) && Array.isArray(value.shifts) && value.shifts.every(isShift) }
export function isShiftBatchResponse(value: unknown): boolean {
  return isResponseRecord(value) && isShiftListResponse(value)
    && Number.isSafeInteger(value.startedCount) && Number.isSafeInteger(value.failedCount)
    && Array.isArray(value.errors) && value.errors.every((error) => isResponseRecord(error) && typeof error.agentId === 'string' && typeof error.error === 'string')
    && ['unstartedAgentIds', 'unconfirmedAgentIds'].every((key) => value[key] === undefined || (Array.isArray(value[key]) && value[key].every((id: unknown) => typeof id === 'string')))
}
