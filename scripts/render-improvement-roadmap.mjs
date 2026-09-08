import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = new URL('../docs/APP_IMPROVEMENT_ROADMAP.json', import.meta.url)
const roadmap = JSON.parse(readFileSync(source, 'utf8'))
const counts = { performance: 50, qol: 20, responsive: 30, smoothness: 20, appearance: 20, 'product-polish': 20, robustness: 20 }
const labels = { performance: 'Performance and logic', qol: 'Quality of life', responsive: 'Responsive interface', smoothness: 'Smoother operation', appearance: 'Appearance', 'product-polish': 'Product polish', robustness: 'Robustness' }
const ids = new Set()
for (const item of roadmap.items) {
  if (ids.has(item.id)) throw new Error(`Duplicate roadmap ID: ${item.id}`)
  ids.add(item.id)
}
for (const [category, expected] of Object.entries(counts)) {
  const actual = roadmap.items.filter((item) => item.category === category).length
  if (actual !== expected) throw new Error(`${category}: expected ${expected} items, found ${actual}`)
}
const totals = Object.fromEntries(['complete', 'partial', 'planned'].map((status) => [status, roadmap.items.filter((item) => item.status === status).length]))
const lines = [
  '# Application improvement roadmap', '',
  `Updated ${roadmap.date}. ${roadmap.items.length} audited improvements: **${totals.complete} complete, ${totals.partial} partial, ${totals.planned} planned**.`, '',
  'Complete means the described implementation is present and its recorded checks pass. Partial includes work that still needs implementation or the stated validation matrix. The full roadmap is not yet complete.', '',
  '## Verification', '',
  ...Object.entries(roadmap.verification || {}).filter(([key, value]) => key !== 'date' && typeof value === 'string').map(([key, value]) => `- **${key}:** ${value}`),
  ...(roadmap.verification?.limitations || []).map((value) => `- ${value}`), '',
  '## Category progress', '', '| Category | Total | Complete | Partial | Planned |', '| --- | ---: | ---: | ---: | ---: |',
  ...Object.entries(counts).map(([category, total]) => {
    const items = roadmap.items.filter((item) => item.category === category)
    return `| ${labels[category]} | ${total} | ${items.filter((item) => item.status === 'complete').length} | ${items.filter((item) => item.status === 'partial').length} | ${items.filter((item) => item.status === 'planned').length} |`
  }), '',
]
for (const category of Object.keys(counts)) {
  lines.push(`## ${labels[category]}`, '')
  for (const item of roadmap.items.filter((entry) => entry.category === category)) {
    lines.push(`### ${item.id} · ${item.title}`, '', `**Status:** ${item.status} · **Priority:** ${item.priority || 'P2'} · **Effort:** ${item.effort || 'M'}`, '')
    if (item.implementation) lines.push(item.implementation, '')
    if (item.benefit) lines.push(`**Purpose:** ${item.benefit}`, '')
    if (item.acceptance) lines.push(`**Acceptance:** ${item.acceptance}`, '')
    if (item.evidence?.length) lines.push(`**Audit evidence:** ${item.evidence.map((entry) => `\`${entry}\``).join(', ')}. Locations refer to the audit snapshot and may shift.`, '')
  }
}
const target = new URL('../docs/APP_IMPROVEMENT_ROADMAP.md', import.meta.url)
writeFileSync(target, lines.join('\n'))
console.log(`Rendered ${roadmap.items.length} items to ${fileURLToPath(target)}`)
