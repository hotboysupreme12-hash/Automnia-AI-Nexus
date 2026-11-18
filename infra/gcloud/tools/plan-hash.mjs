import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) throw new Error('Usage: node plan-hash.mjs <shopify-plan-mappings.json>')

const source = JSON.parse(await readFile(path, 'utf8'))
if (!Array.isArray(source) || source.length === 0) throw new Error('Plan mappings must be a non-empty array.')
const TOKENS_PER_CREDIT = 1_000

function tierRank(tier) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'frontier' || normalized === 'frontier_tier' || normalized === 'automnia_frontier' || normalized.endsWith('_frontier')) return 4
  if (normalized.includes('enterprise') || normalized.includes('pro')) return 3
  if (normalized === 'starter' || normalized.includes('starter') || normalized === 'byok' || normalized.includes('byok')) return 1
  if (normalized.includes('credit') || normalized.includes('refill') || normalized.includes('topup')) return 0
  return normalized ? 1 : 0
}

function hasProSubscriptionTerms({ tier, mode, planPriceCents }) {
  const normalizedTier = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return mode === 'hosted_credits' && normalizedTier.includes('pro') && Number(planPriceCents) === 2_999
}

function hasPermanentTierAccess(tier) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized.includes('enterprise') || tierRank(normalized) >= 4
}

const normalized = source.flatMap((candidate) => {
  if (!candidate || typeof candidate !== 'object') return []
  const tier = String(candidate.tier || '').trim()
  const mode = candidate.mode === 'byok' ? 'byok' : candidate.mode === 'hosted_credits' ? 'hosted_credits' : null
  const initialTokens = Number(candidate.initialTokens ?? candidate.initialCredits)
  const kind = candidate.kind === 'topup' ? 'topup' : candidate.kind === 'subscription' ? 'subscription' : 'license'
  if (!tier || !mode || !Number.isFinite(initialTokens) || initialTokens < 0) return []
  const ids = (field) => Array.isArray(candidate[field]) ? candidate[field].map((value) => String(value || '').trim()).filter(Boolean) : []
  const planPriceCents = Number.isInteger(Number(candidate.planPriceCents)) && Number(candidate.planPriceCents) >= 0
    ? Number(candidate.planPriceCents)
    : null
  return [{
    tier,
    mode,
    planPriceCents,
    initialTokens: Math.floor(initialTokens),
    initialCredits: Math.round((Math.floor(initialTokens) / TOKENS_PER_CREDIT) * 1000) / 1000,
    kind,
    permanentAccess: !hasProSubscriptionTerms({ tier, mode, planPriceCents })
      && (candidate.permanentAccess === true || mode === 'byok' || hasPermanentTierAccess(tier)),
    trialDays: Number.isInteger(Number(candidate.trialDays)) && Number(candidate.trialDays) > 0 ? Number(candidate.trialDays) : 0,
    productIds: ids('productIds'),
    variantIds: ids('variantIds'),
    sellingPlanIds: ids('sellingPlanIds'),
    skus: ids('skus').map((sku) => sku.toLowerCase()),
  }]
})

if (normalized.length !== source.length) throw new Error('One or more plan mappings are invalid.')
process.stdout.write(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'))
