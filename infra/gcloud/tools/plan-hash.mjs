import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const path = process.argv[2]
if (!path) throw new Error('Usage: node plan-hash.mjs <shopify-plan-mappings.json>')

const source = JSON.parse(await readFile(path, 'utf8'))
if (!Array.isArray(source) || source.length === 0) throw new Error('Plan mappings must be a non-empty array.')

const normalized = source.flatMap((candidate) => {
  if (!candidate || typeof candidate !== 'object') return []
  const tier = String(candidate.tier || '').trim()
  const mode = candidate.mode === 'byok' ? 'byok' : candidate.mode === 'hosted_credits' ? 'hosted_credits' : null
  const initialCredits = Number(candidate.initialCredits)
  const kind = candidate.kind === 'topup' ? 'topup' : candidate.kind === 'subscription' ? 'subscription' : 'license'
  if (!tier || !mode || !Number.isFinite(initialCredits) || initialCredits < 0) return []
  const ids = (field) => Array.isArray(candidate[field]) ? candidate[field].map((value) => String(value || '').trim()).filter(Boolean) : []
  return [{
    tier,
    mode,
    initialCredits: Math.floor(initialCredits),
    kind,
    productIds: ids('productIds'),
    variantIds: ids('variantIds'),
    skus: ids('skus').map((sku) => sku.toLowerCase()),
  }]
})

if (normalized.length !== source.length) throw new Error('One or more plan mappings are invalid.')
process.stdout.write(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'))
