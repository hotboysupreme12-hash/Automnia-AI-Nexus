import { automniaRelayModelLabel } from './licenseEntitlement'
import { modelProviderLabel } from './modelGrouping'

export type AgentModelDisplay = {
  providerLabel: string
  modelLabel: string
  cardLabel: string
  title: string
  isAutomnia: boolean
}

const CODEX_PROVIDER_IDS = new Set(['openai', 'openai-codex', 'codex'])

function formatModelName(modelId: string) {
  const friendlyModel = modelId
    .replace(/(\d+)-(\d+)(?=-|$)/g, '$1.$2')
    .replace(/[-_:@]+/g, ' ')

  return friendlyModel
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase()
      if (normalized === 'gpt') return 'GPT'
      if (normalized === 'gemini') return 'Gemini'
      if (normalized === 'claude') return 'Claude'
      if (normalized === 'llama') return 'Llama'
      if (/^o\d+$/i.test(part)) return part.toUpperCase()
      if (/^\d+(?:\.\d+)?[a-z]+$/i.test(part)) {
        return part.replace(/[a-z]+$/i, (suffix) => suffix.toUpperCase())
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
    })
    .join(' ')
}

function providerLabelFor(provider: string) {
  if (CODEX_PROVIDER_IDS.has(provider)) return 'Codex'
  return modelProviderLabel(provider)
}

/**
 * Resolve the label shown on an agent card from the configured primary model.
 * The model id is intentionally not returned to the UI: provider ids are
 * routing details, while managed Automnia classes are the customer-facing
 * names for the hosted models.
 */
export function describeAgentModel(modelId: string | null | undefined): AgentModelDisplay {
  const normalized = modelId?.trim() || ''
  if (!normalized) {
    return {
      providerLabel: 'Unassigned',
      modelLabel: 'Unassigned',
      cardLabel: 'Unassigned',
      title: 'No primary model assigned',
      isAutomnia: false,
    }
  }

  const [rawProvider = '', ...modelParts] = normalized.split('/').filter(Boolean)
  const provider = rawProvider.toLowerCase()
  const selectedModel = modelParts.join('/').trim() || normalized

  if (provider === 'automnia-cloud') {
    const managedLabel = automniaRelayModelLabel(normalized, 'Automnia model')
    return {
      providerLabel: 'Automnia',
      modelLabel: managedLabel,
      cardLabel: managedLabel,
      title: `${managedLabel} · Automnia managed model`,
      isAutomnia: true,
    }
  }

  const modelLabel = formatModelName(selectedModel)
  const providerDisplayLabel = provider ? providerLabelFor(provider) : ''
  const cardLabel = providerDisplayLabel ? `${providerDisplayLabel} · ${modelLabel}` : modelLabel

  return {
    providerLabel: providerDisplayLabel || 'Model',
    modelLabel,
    cardLabel,
    title: cardLabel,
    isAutomnia: false,
  }
}
