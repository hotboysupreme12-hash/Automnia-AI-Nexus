import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const serverSource = readFileSync(path.join(rootDir, 'server/controlPlane.ts'), 'utf8')
const missionSchedulerServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionSchedulerService.ts'), 'utf8')
const missionStateServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionStateService.ts'), 'utf8')
const missionReportServiceSource = readFileSync(path.join(rootDir, 'server/services/missions/missionReportService.ts'), 'utf8')
const typesSource = readFileSync(path.join(rootDir, 'src/types/nexus.ts'), 'utf8')
const reportPanelSource = readFileSync(path.join(rootDir, 'src/components/monitor/MissionReportPanel.tsx'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }

assert.match(serverSource, /controlCenterRunId\?: string/)
assert.match(serverSource, /controlCenterRunId: runRecord\.id/)
assert.match(missionSchedulerServiceSource, /type MissionCronRunReference/)
assert.match(missionStateServiceSource, /runtimeRunId: string \| null/)
assert.match(missionStateServiceSource, /cronRunId: string \| null/)
assert.match(missionStateServiceSource, /sessionId: string \| null/)
assert.match(missionStateServiceSource, /sessionKey: string \| null/)
assert.match(missionSchedulerServiceSource, /function extractCronRunReference/)
assert.match(missionSchedulerServiceSource, /collectParsedAgentRunOutputs\(stripAnsi, stdout, stderr\)/)
assert.match(missionSchedulerServiceSource, /job\.runtimeRunId = result\.controlCenterRunId \|\| null/)
assert.match(missionSchedulerServiceSource, /job\.cronRunId = cronRunReference\.cronRunId/)
assert.match(missionSchedulerServiceSource, /job\.sessionId = cronRunReference\.sessionId/)
assert.match(missionSchedulerServiceSource, /job\.sessionKey = cronRunReference\.sessionKey/)
assert.match(missionReportServiceSource, /runtimeRunIds = Array\.from\(new Set\(jobs\.map\(\(job\) => job\.runtimeRunId\)/)
assert.match(missionReportServiceSource, /cronRunIds = Array\.from\(new Set\(jobs\.map\(\(job\) => job\.cronRunId\)/)
assert.match(missionReportServiceSource, /sessionIds = Array\.from\(new Set\(jobs\.map\(\(job\) => job\.sessionId\)/)
assert.match(missionReportServiceSource, /source: hasRuntimeEvidence && missionEvents\.length \? 'mixed' : hasRuntimeEvidence \? 'runtime-responses'/)
assert.match(missionReportServiceSource, /runtimeRunIds,\s*\n\s*cronRunIds,\s*\n\s*sessionIds,\s*\n\s*sessionKeys,/)

assert.match(typesSource, /runtimeRunIds\?: string\[\]/)
assert.match(typesSource, /cronRunIds\?: string\[\]/)
assert.match(typesSource, /sessionIds\?: string\[\]/)
assert.match(typesSource, /sessionKeys\?: string\[\]/)

assert.match(reportPanelSource, /Runtime runs:/)
assert.match(reportPanelSource, /Cron runs:/)
assert.match(reportPanelSource, /Sessions:/)

const scripts = packageJson.scripts || {}
assert.equal(typeof scripts['smoke:mission-runtime-references'], 'string')
assert.match(scripts['test:ci'] || '', /npm run smoke:mission-runtime-references/)

console.log('mission runtime references contract ok')
