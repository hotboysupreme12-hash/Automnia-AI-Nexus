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

const coverage = process.argv.includes('--coverage') || /^(1|true|yes)$/i.test(String(process.env.DYSTOPAI_UNIT_TEST_COVERAGE || ''))
const args = [
  ...(coverage ? [
    '--experimental-test-coverage',
    '--test-coverage-lines=85',
    '--test-coverage-functions=80',
    '--test-coverage-branches=75',
  ] : []),
  '--import',
  'tsx',
  '--test',
  ...tests,
]

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
