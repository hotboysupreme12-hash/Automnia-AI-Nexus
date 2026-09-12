import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

type AuditMetadata = {
  vulnerabilities?: Record<string, number>
}

type AuditReport = {
  vulnerabilities?: Record<string, unknown>
  metadata?: AuditMetadata
}

const npmExecPath = process.env.npm_execpath

function getNpmInvocation(args: string[]) {
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, 'audit', '--json', ...args],
      shell: false,
    }
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['audit', '--json', ...args],
    shell: process.platform === 'win32',
  }
}

function parseAuditJson(label: string, stdout: string, stderr: string): AuditReport {
  const payload = stdout.trim()
  assert.ok(payload, `${label} npm audit did not return JSON output: ${stderr.trim()}`)
  try {
    return JSON.parse(payload) as AuditReport
  } catch (error) {
    assert.fail(`${label} npm audit returned invalid JSON: ${(error as Error).message}`)
  }
}

function runAudit(label: string, args: string[], cwd: string) {
  const invocation = getNpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: invocation.shell,
    windowsHide: true,
  })
  if (result.error) throw result.error

  const report = parseAuditJson(label, result.stdout, result.stderr)
  const counts = report.metadata?.vulnerabilities || {}
  const entries = Object.keys(report.vulnerabilities || {})
  const total = Number(counts.total || entries.length)

  assert.equal(entries.length, 0, `${label} npm audit reported vulnerabilities: ${entries.join(', ')}`)
  assert.equal(total, 0, `${label} npm audit must report zero vulnerabilities, got ${JSON.stringify(counts)}`)
  assert.equal(result.status, 0, `${label} npm audit exited ${result.status}: ${result.stderr.trim()}`)

  return counts
}

const root = process.cwd()
const service = path.join(root, 'infra', 'gcloud', 'service')
const full = runAudit('root full', [], root)
const production = runAudit('root production-only', ['--omit=dev'], root)
const serviceFull = runAudit('gcloud service full', [], service)
const serviceProduction = runAudit('gcloud service production-only', ['--omit=dev'], service)

console.log(
  `dependency audit clean: root full=${full.total || 0}, root production=${production.total || 0}, ` +
  `gcloud service full=${serviceFull.total || 0}, gcloud service production=${serviceProduction.total || 0}`,
)
