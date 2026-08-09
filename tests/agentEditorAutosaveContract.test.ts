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
