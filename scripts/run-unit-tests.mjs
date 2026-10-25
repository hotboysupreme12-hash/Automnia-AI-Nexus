#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const testsRoot = path.join(root, 'tests')

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const filePath = path.join(directory, name)
    return statSync(filePath).isDirectory() ? walk(filePath) : [filePath]
  })
}

const tests = walk(testsRoot)
  .filter((filePath) => /\.test\.(?:cjs|mjs|ts)$/.test(filePath))
  .sort()

if (!tests.length) throw new Error(`No unit tests found under ${testsRoot}`)

const coverage = process.argv.includes('--coverage') || /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_UNIT_TEST_COVERAGE || ''))
const coverageExcludes = [
  'tests/**',
  'vendor/**',
  'dist/**',
  'dist-server/**',
  'server/controlPlaneHttp.ts',
  'server/routes/**',
  'server/runtimeLedger.ts',
  'server/services/agents/**',
  'server/services/browser/**',
  'server/services/gateway/**',
  'server/services/filesystem/pickerSessionService.ts',
  'server/services/missions/missionReportService.ts',
  'server/services/missions/missionSchedulerService.ts',
  'server/services/providers/**',
  'server/services/runtime/runtimeStatusService.ts',
]
const args = [
  ...(coverage ? [
    '--experimental-test-coverage',
    '--test-coverage-lines=85',
    '--test-coverage-functions=80',
    '--test-coverage-branches=75',
    ...coverageExcludes.flatMap((glob) => [`--test-coverage-exclude=${glob}`]),
  ] : []),
  '--import',
  'tsx',
  '--test',
  ...tests,
]

const testEnv = {
  ...process.env,
  NO_PROXY: '127.0.0.1,localhost,::1',
  no_proxy: '127.0.0.1,localhost,::1',
}
for (const key of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
]) {
  delete testEnv[key]
}

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: testEnv,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
