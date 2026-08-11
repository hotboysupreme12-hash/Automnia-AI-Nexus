import type { AgentTurnPayload } from '../api/agentTurns'

export function modelIdFromParts(provider?: string, model?: string) {
  const providerText = provider?.trim()
  const modelText = model?.trim()
  if (!modelText) return ''
  if (modelText.includes('/')) return modelText
  return providerText ? `${providerText}/${modelText}` : modelText
}

export function modelIdFromTurnPayload(payload?: AgentTurnPayload | null) {
  if (!payload) return ''
  return payload.modelId?.trim() ||
    modelIdFromParts(payload.provider, payload.model) ||
    payload.streaming?.modelId?.trim() ||
    modelIdFromParts(payload.streaming?.provider, payload.streaming?.model)
}

export function transportFromTurnPayload(payload?: AgentTurnPayload | null) {
  const streamingTransport = payload?.streaming?.transport?.trim()
  if (streamingTransport) return streamingTransport
  const runtimeTransport = payload?.runtimeTransport?.trim()
  return runtimeTransport ? `${runtimeTransport}-agent` : ''
}

export function remainingCreditsFromTurnPayload(payload?: AgentTurnPayload | null) {
  const remainingCredits = payload?.remainingCredits
  return typeof remainingCredits === 'number' && Number.isFinite(remainingCredits) && remainingCredits >= 0
    ? remainingCredits
    : undefined
}

export function bufferedFromTurnPayload(payload?: AgentTurnPayload | null) {
  return payload?.streaming?.buffered === true || payload?.streaming?.liveTokens === false
}
