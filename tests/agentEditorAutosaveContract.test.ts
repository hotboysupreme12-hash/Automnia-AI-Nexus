import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = readFileSync(path.join(process.cwd(), 'src/components/editor/AgentEditorModal.tsx'), 'utf8')

test('agent editor uses autosave for every editable settings surface', () => {
  assert.match(source, /scheduleConfigPatch/)
  assert.match(source, /scheduleModelAutosave/)
  assert.match(source, /schedulePolicyAutosave/)
  assert.match(source, /scheduleWorkspaceAutosave/)
  assert.match(source, /ScheduleResourceAutosave/)
  assert.match(source, /data-editor-autosave="global"/)
  assert.doesNotMatch(source, /onClick=\{\(\)=>void SvM\(\)\}/)
  assert.doesNotMatch(source, /onClick=\{\(\)=>void SvP\(\)\}/)
  assert.doesNotMatch(source, /onClick=\{\(\)=>void SvW\(\)\}/)
  assert.doesNotMatch(source, /onClick=\{\(\)=>void SvF\(\)\}/)
})

test('model autosave retains drafts through auth refresh and retries after OAuth connects', () => {
  assert.match(source, /pendingModelSaveRef/)
  assert.match(source, /await LdAuth\(true\)/)
  assert.match(source, /const retryPendingModelSave = async \(\) =>/)
  assert.match(source, /await retryPendingModelSave\(\)/)
  assert.match(source, /agent\.model\?\.primary/)
  assert.match(source, /applyAgentConfigPayload\(agentId,cached\.value\)/)
  assert.match(source, /applyAgentConfigPayload\(agentId,result\.data\.config\)/)
})
