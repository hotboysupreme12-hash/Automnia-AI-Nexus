import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const manual = readFileSync(path.join(repositoryRoot, 'docs/AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md'), 'utf8')
const publisher = readFileSync(path.join(repositoryRoot, 'scripts/publish-knowledge-base.mjs'), 'utf8')
const cloudService = readFileSync(path.join(repositoryRoot, 'infra/gcloud/service/server.js'), 'utf8')

test('assistant operations manual covers the required operator surfaces', () => {
  for (const phrase of [
    'Documentation source map',
    'Running Automnia',
    'Agent Editor: every tab and control',
    'Agent files',
    'Retire an agent from Agent files',
    'Settings: every category and nuance',
    'Account & License',
    'Google Cloud and private Help operations',
    'Assistant response contract',
  ]) {
    assert.ok(manual.includes(phrase), `Manual section missing: ${phrase}`)
  }
})

test('knowledge publisher includes all canonical Automnia Markdown trees', () => {
  assert.match(publisher, /markdownFiles\('docs', \['docs\/openclaw-latest\/'\]\)/)
  assert.match(publisher, /markdownFiles\('infra\/gcloud\/knowledge'\)/)
  assert.match(publisher, /AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL\.md/)
  assert.match(cloudService, /KNOWLEDGE_DETAIL_INSTRUCTION/)
  assert.match(cloudService, /addKnowledgeDetailInstruction\(requestBody\(modelVersion\)\)/)
})
