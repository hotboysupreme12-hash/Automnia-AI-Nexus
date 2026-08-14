import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

type AuditMetadata = {
  vulnerabilities?: Record<string, number>
}

type AuditReport = {
  vulnerabilities?: Record<string, unknown>
  metadata?: AuditMetadata
}

const npmExecPath = process.env.npm_execpath
const KNOWN_UNFIXED_DEV_ENTRIES = new Set(['@huggingface/transformers', 'adm-zip', 'onnxruntime-node', 'sharp'])

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

function runAudit(label: string, args: string[], allowedEntries = new Set<string>()) {
  const invocation = getNpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
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

  const unexpectedEntries = entries.filter((entry) => !allowedEntries.has(entry))
  assert.equal(
    unexpectedEntries.length,
    0,
    `${label} npm audit reported unexpected vulnerability entries: ${unexpectedEntries.join(', ')}`,
  )
  if (allowedEntries.size === 0) {
    assert.equal(total, 0, `${label} npm audit must report zero vulnerabilities, got ${JSON.stringify(counts)}`)
    assert.equal(result.status, 0, `${label} npm audit exited ${result.status}: ${result.stderr.trim()}`)
  }

  return counts
}

// These advisories currently have no upstream fix and are confined to the
// dev-only local speech build chain. Production excludes the chain entirely;
// the allowlist ensures a new vulnerability still fails this contract.
const full = runAudit('full', [], KNOWN_UNFIXED_DEV_ENTRIES)
const production = runAudit('production-only', ['--omit=dev'])

console.log(`dependency audit clean: full=${full.total || 0} known dev-only upstream-unfixed, production=${production.total || 0}`)
