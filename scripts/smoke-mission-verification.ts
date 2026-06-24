import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}

const scripts = packageJson.scripts ?? {}
const requiredScripts = ['test', 'test:ci', 'typecheck', 'smoke:ledger', 'smoke:mission-verification']

for (const scriptName of requiredScripts) {
  assert.equal(typeof scripts[scriptName], 'string', `package.json is missing the ${scriptName} script`)
  assert.ok(scripts[scriptName].trim().length > 0, `package.json script ${scriptName} is empty`)
}

assert.ok(
  /\bnpm run typecheck\b/.test(scripts['test:ci']),
  'test:ci must include semantic type-checking',
)
assert.ok(
  /\bnpm run smoke:ledger\b/.test(scripts['test:ci']),
  'test:ci must include JSONL ledger recovery coverage',
)
assert.ok(
  /\bnpm run smoke:mission-verification\b/.test(scripts['test:ci']),
  'test:ci must include the mission verification contract smoke',
)

const sourceFiles = [
  'src/engine/missionVerification.ts',
  'src/engine/MDSValidator.ts',
  'src/data/seeds.ts',
]

for (const relativePath of sourceFiles) {
  const source = readFileSync(join(rootDir, relativePath), 'utf8')
  assert.doesNotMatch(source, /command:\s*['"]npm test['"]/, `${relativePath} still embeds unavailable npm test evidence`)
}

const missionVerificationSource = readFileSync(join(rootDir, 'src/engine/missionVerification.ts'), 'utf8')
assert.match(
  missionVerificationSource,
  /PROJECT_TEST_VERIFICATION_COMMAND\s*=\s*['"]npm run test:ci['"]/,
  'mission verification must use the reproducible test:ci command',
)

console.log('mission verification command contract ok')

