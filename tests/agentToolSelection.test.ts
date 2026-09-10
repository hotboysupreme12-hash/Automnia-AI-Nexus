import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
test('projection uses the canonical permission normalizer', () => {
  const control = read('server/controlPlane.ts')
  const routes = read('server/routes/agentConfigRoutes.ts')
  assert.doesNotMatch(control, /unrestrictedAgentToolsConfig/)
  assert.match(control, /target\.tools = normalizeAgentToolsConfig\(local\.tools\)/)
  assert.match(control, /normalizeAgentToolsConfig\(\{ \.\.\.local\.tools, profile: 'full', exec \}\)/)
  assert.match(routes, /normalizeAgentToolsConfig\(\{ profile: 'full', \.\.\.local\.tools \}\)/)
  assert.match(routes, /patch\.tools \|\|\s+patch\.sandbox/)
  assert.match(control, /input = fullAccessToolPolicy\(input\)/)
})
test('tool selections persist independently of sandbox, serialize, and flush before closing', () => {
  const editor = read('src/components/editor/AgentEditorModal.tsx')
  const picker = read('src/components/editor/AgentToolPicker.tsx')
  assert.doesNotMatch(editor, /SANDBOX_MODE_OPTIONS|>Sandbox</)
  assert.match(editor, /toolAccess !== 'full'/)
  assert.match(editor, /tools: \{ profile: 'full', allow: csv\(draft\.allow\), deny: csv\(draft\.deny\), alsoAllow: \[\] \}/)
  assert.match(editor, /policySaveQueueRef\.current\.catch\(\(\) => undefined\)\.then\(save\)/)
  assert.match(editor, /await flushPolicySave\(\)/)
  assert.match(editor, /flushPolicySave\(\)\.then\(\(\) => setTab\(next\)\)/)
  // Empty allowlists mean unrestricted in OpenClaw: explicitly deny all instead.
  assert.match(picker, /onChange\(ids\.join\(', '\), ids\.length \? '' : '\*'\)/)
})
