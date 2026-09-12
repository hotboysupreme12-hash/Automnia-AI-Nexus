import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) throw new Error('Usage: node plan-hash.mjs <shopify-plan-mappings.json>')

const source = JSON.parse(await readFile(path, 'utf8'))
if (!Array.isArray(source) || source.length === 0) throw new Error('Plan mappings must be a non-empty array.')
const TOKENS_PER_CREDIT = 1_000

function tierRank(tier) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized.includes('enterprise')) return 3
  if (normalized.includes('pro')) return 2
  if (normalized === 'starter' || normalized.includes('starter') || normalized === 'byok' || normalized.includes('byok')) return 1
  if (normalized.includes('credit') || normalized.includes('refill') || normalized.includes('topup')) return 0
  return normalized ? 1 : 0
}

const normalized = source.flatMap((candidate) => {
  if (!candidate || typeof candidate !== 'object') return []
  const tier = String(candidate.tier || '').trim()
  const mode = candidate.mode === 'byok' ? 'byok' : candidate.mode === 'hosted_credits' ? 'hosted_credits' : null
  const initialTokens = Number(candidate.initialTokens ?? candidate.initialCredits)
  const kind = candidate.kind === 'topup' ? 'topup' : candidate.kind === 'subscription' ? 'subscription' : 'license'
  if (!tier || !mode || !Number.isFinite(initialTokens) || initialTokens < 0) return []
  const ids = (field) => Array.isArray(candidate[field]) ? candidate[field].map((value) => String(value || '').trim()).filter(Boolean) : []
  return [{
    tier,
    mode,
    planPriceCents: Number.isInteger(Number(candidate.planPriceCents)) && Number(candidate.planPriceCents) >= 0 ? Number(candidate.planPriceCents) : null,
    initialTokens: Math.floor(initialTokens),
    initialCredits: Math.round((Math.floor(initialTokens) / TOKENS_PER_CREDIT) * 1000) / 1000,
    kind,
    permanentAccess: candidate.permanentAccess === true || mode === 'byok' || tierRank(tier) >= 2,
    trialDays: Number.isInteger(Number(candidate.trialDays)) && Number(candidate.trialDays) > 0 ? Number(candidate.trialDays) : 0,
    productIds: ids('productIds'),
    variantIds: ids('variantIds'),
    sellingPlanIds: ids('sellingPlanIds'),
    skus: ids('skus').map((sku) => sku.toLowerCase()),
  }]
})

if (normalized.length !== source.length) throw new Error('One or more plan mappings are invalid.')
process.stdout.write(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'))
