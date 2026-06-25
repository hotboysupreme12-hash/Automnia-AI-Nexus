const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const output = path.resolve(process.env.DYSTOPAI_THIRD_PARTY_NOTICES_PATH || path.join(root, 'THIRD_PARTY_NOTICES.txt'))
const checkOnly = process.argv.includes('--check')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const packages = lock.packages && typeof lock.packages === 'object' ? lock.packages : {}
const rows = new Map()

function packageName(packagePath, entry) {
  if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim()
  const normalized = packagePath.replace(/\\/g, '/')
  const tail = normalized.split('/node_modules/').pop() || normalized.replace(/^node_modules\//, '')
  return tail
}

for (const [packagePath, entry] of Object.entries(packages)) {
  if (!packagePath.startsWith('node_modules/') || !entry || typeof entry !== 'object' || !entry.version) continue
  const name = packageName(packagePath, entry)
  const version = String(entry.version)
  const key = `${name}@${version}`
  if (rows.has(key)) continue
  const license = typeof entry.license === 'string' && entry.license.trim() ? entry.license.trim() : 'SEE PACKAGE LICENSE'
  rows.set(key, { name, version, license })
}

const sorted = [...rows.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`))
const body = [
  'DystopAI Third-Party Software Notices',
  '=====================================',
  '',
  'This product includes third-party software. The applicable license files',
  'shipped with those packages remain controlling. This inventory is generated',
  'from package-lock.json and is intended to make review easier.',
  '',
  `Generated package count: ${sorted.length}`,
  '',
  ...sorted.map((row) => `${row.name}@${row.version}\n  License: ${row.license}`),
  '',
].join('\n')

if (checkOnly) {
  if (!fs.existsSync(output)) throw new Error(`[third-party-notices] Missing ${path.relative(root, output)}`)
  if (fs.readFileSync(output, 'utf8') !== body) {
    throw new Error('[third-party-notices] THIRD_PARTY_NOTICES.txt is stale. Run npm run notices:generate.')
  }
  console.log(`[third-party-notices] verified ${sorted.length} package notice entries`)
} else {
  fs.writeFileSync(output, body, 'utf8')
  console.log(`[third-party-notices] wrote ${path.relative(root, output)} with ${sorted.length} package entries`)
}
