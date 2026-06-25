import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const serverRoot = path.join(root, 'server')
const inventoryPath = path.join(serverRoot, 'routes', 'controlPlaneRouteInventory.json')
const routePattern = /\bapp\.(get|post|put|patch|delete|options|head)\(\s*(['"])(\/api\/[^'"]+)\2/g

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const filePath = path.join(directory, name)
    return statSync(filePath).isDirectory() ? walk(filePath) : [filePath]
  })
}

const expected = JSON.parse(readFileSync(inventoryPath, 'utf8')) as string[]
const sources = new Map<string, string[]>()

for (const filePath of walk(serverRoot).filter((candidate) => candidate.endsWith('.ts'))) {
  const source = readFileSync(filePath, 'utf8')
  for (const match of source.matchAll(routePattern)) {
    const signature = `${match[1].toUpperCase()} ${match[3]}`
    const locations = sources.get(signature) || []
    locations.push(path.relative(root, filePath))
    sources.set(signature, locations)
  }
}

const actual = [...sources.keys()].sort()
const duplicates = [...sources.entries()].filter(([, locations]) => locations.length > 1)
const missing = expected.filter((route) => !sources.has(route))
const unexpected = actual.filter((route) => !expected.includes(route))

assert.deepEqual(expected, [...new Set(expected)].sort(), 'route inventory must stay sorted and duplicate-free')
assert.equal(duplicates.length, 0, `API routes must have one owner:\n${duplicates.map(([route, files]) => `${route}: ${files.join(', ')}`).join('\n')}`)
assert.equal(missing.length, 0, `Control-plane routes disappeared without an inventory update:\n${missing.join('\n')}`)
assert.equal(unexpected.length, 0, `Control-plane routes were added without an inventory update:\n${unexpected.join('\n')}`)
assert.ok(actual.includes('POST /api/auth/logout'), 'route inventory must retain server-side session revocation')

for (const forbiddenOwner of ['server/index.ts', 'server/controlPlane.ts']) {
  const ownedRoutes = [...sources.entries()].filter(([, files]) => files.includes(forbiddenOwner))
  assert.equal(ownedRoutes.length, 0, `${forbiddenOwner} must remain route-free`)
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
assert.equal(packageJson.scripts?.['smoke:route-inventory'], 'tsx scripts/smoke-route-inventory.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:route-inventory'))

console.log(`control-plane route inventory ok (${actual.length} unique API routes)`)
