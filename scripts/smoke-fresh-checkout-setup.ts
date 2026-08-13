import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

type CommandEvidence = {
  label: string
  command: string
  cwd: string
  durationMs: number
  exitCode: number
  logPath: string
}

const root = process.cwd()
const timestamp = new Date().toISOString()
const runSegment = timestamp.replace(/[:.]/g, '-')
const outputRoot = path.join(root, 'output', 'fresh-checkout-smoke')
const runRoot = path.join(outputRoot, runSegment)
const freshRoot = path.join(runRoot, 'workspace')
const evidenceDir = path.join(root, 'release', 'evidence', 'phase-k-manual-beta-2026-07-01')
const keepWorkspace = /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_KEEP_FRESH_CHECKOUT_SMOKE || ''))

const requiredSnapshotFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'electron/main.cjs',
  'server/index.ts',
  'src/main.tsx',
  'scripts/prepare-openclaw-vendor.cjs',
  'vendor/openclaw/package.json',
  'vendor/openclaw/npm-shrinkwrap.json',
]

const forbiddenParts = new Set([
  '.cache',
  '.git',
  '.openclaw',
  '.playwright-cli',
  '.tmp',
  'coverage',
  'dist',
  'dist-server',
  'node_modules',
  'output',
  'release',
])

function isWithin(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function runGit(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr.toString('utf8') || result.stdout.toString('utf8'))
  return result.stdout.toString('utf8')
}

function npmCommandSpec() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, prefix: [process.env.npm_execpath] }
  }
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      prefix: ['/d', '/s', '/c', 'npm.cmd'],
    }
  }
  return { command: 'npm', prefix: [] }
}

function commandDisplay(command: string, args: string[]) {
  return [command, ...args].join(' ')
}

function tail(value: string, maxLength = 6000) {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value
}

function runNpmStep(label: string, args: string[], stepIndex: number): CommandEvidence {
  const npm = npmCommandSpec()
  const startedAt = Date.now()
  const result = spawnSync(npm.command, [...npm.prefix, ...args], {
    cwd: freshRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      AUTOMNIA_FRESH_CHECKOUT_SMOKE: '1',
    },
    maxBuffer: 80 * 1024 * 1024,
    windowsHide: true,
  })
  const durationMs = Date.now() - startedAt
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const logPath = path.join(evidenceDir, `${String(stepIndex).padStart(2, '0')}-${label}.log`)
  writeFileSync(logPath, output, 'utf8')
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}\n${tail(output)}`)
  }
  return {
    label,
    command: commandDisplay('npm', args),
    cwd: freshRoot,
    durationMs,
    exitCode: result.status,
    logPath,
  }
}

function shouldCopy(relativePath: string) {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) return false
  const normalized = relativePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 && !parts.includes('..') && parts.every((part) => !forbiddenParts.has(part))
}

function snapshotSource() {
  const listed = runGit(['ls-files', '-co', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(shouldCopy)
  const relativeFiles = [...new Set(listed)].sort()

  let copiedFiles = 0
  let copiedBytes = 0
  for (const relativePath of relativeFiles) {
    const sourcePath = path.join(root, relativePath)
    if (!existsSync(sourcePath)) continue

    const sourceStat = lstatSync(sourcePath)
    assert.equal(sourceStat.isSymbolicLink(), false, `fresh snapshot refuses source symlink: ${relativePath}`)
    if (!sourceStat.isFile()) continue

    const targetPath = path.join(freshRoot, relativePath)
    assert.ok(isWithin(freshRoot, targetPath), `fresh snapshot target escaped workspace: ${relativePath}`)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)
    copiedFiles += 1
    copiedBytes += sourceStat.size
  }

  for (const relativePath of requiredSnapshotFiles) {
    const filePath = path.join(freshRoot, relativePath)
    assert.ok(existsSync(filePath), `fresh snapshot is missing required file: ${relativePath}`)
    assert.ok(statSync(filePath).isFile(), `fresh snapshot required path is not a file: ${relativePath}`)
  }
  for (const forbidden of ['node_modules', 'dist', 'dist-server', 'release', 'output']) {
    assert.equal(existsSync(path.join(freshRoot, forbidden)), false, `fresh snapshot must not include ${forbidden}`)
  }

  return { copiedFiles, copiedBytes }
}

function writeMarkdownEvidence(
  packageJson: { name?: string; version?: string },
  snapshot: { copiedFiles: number; copiedBytes: number },
  commands: CommandEvidence[],
  workspaceRemoved: boolean,
) {
  const lines = [
    '# Phase K Fresh Checkout Smoke',
    '',
    `Generated: ${timestamp}`,
    '',
    `Project: ${packageJson.name || 'unknown'} ${packageJson.version || 'unknown'}`,
    `Source root: ${root}`,
    `Fresh workspace: ${freshRoot}`,
    `Workspace removed after success: ${workspaceRemoved ? 'yes' : 'no'}`,
    `Copied source files: ${snapshot.copiedFiles}`,
    `Copied source bytes: ${snapshot.copiedBytes}`,
    '',
    '## Commands',
    '',
    ...commands.flatMap((command) => [
      `- ${command.command}`,
      `  - exit: ${command.exitCode}`,
      `  - durationMs: ${command.durationMs}`,
      `  - log: ${path.relative(root, command.logPath).replace(/\\/g, '/')}`,
    ]),
    '',
    '## Result',
    '',
    'Phase K item 111 fresh install or fresh checkout setup passed against an isolated source snapshot.',
    '',
  ]
  writeFileSync(path.join(evidenceDir, 'FRESH_CHECKOUT_SMOKE.md'), `${lines.join('\n')}`, 'utf8')
}

mkdirSync(evidenceDir, { recursive: true })
mkdirSync(freshRoot, { recursive: true })

const commands: CommandEvidence[] = []
let success = false
let workspaceRemoved = false

try {
  const snapshot = snapshotSource()
  commands.push(runNpmStep('npm-ci', ['ci'], 1))
  commands.push(runNpmStep('prepare-openclaw-vendor', ['run', 'prepare:openclaw-vendor'], 2))
  commands.push(runNpmStep('build-standalone', ['run', 'build:standalone'], 3))
  commands.push(runNpmStep('smoke-server-architecture', ['run', 'smoke:server-architecture'], 4))
  const packageJson = JSON.parse(readFileSync(path.join(freshRoot, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
  }
  success = true

  if (!keepWorkspace) {
    assert.ok(isWithin(outputRoot, runRoot), `refusing to remove fresh smoke workspace outside output root: ${runRoot}`)
    rmSync(runRoot, { recursive: true, force: true })
    workspaceRemoved = true
  }

  const manifest = {
    schema: 1,
    item: 'Phase K item 111',
    generatedAt: timestamp,
    result: 'passed',
    sourceRoot: root,
    freshWorkspace: freshRoot,
    workspaceRemoved,
    copiedFiles: snapshot.copiedFiles,
    copiedBytes: snapshot.copiedBytes,
    commands,
  }
  writeFileSync(path.join(evidenceDir, 'fresh-checkout-smoke.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeMarkdownEvidence(packageJson, snapshot, commands, workspaceRemoved)
  console.log(JSON.stringify({
    ok: true,
    item: 'Phase K item 111',
    copiedFiles: snapshot.copiedFiles,
    evidenceDir,
    commands: commands.map((command) => command.command),
  }, null, 2))
} finally {
  if (!success && existsSync(runRoot)) {
    console.error(`fresh checkout smoke workspace retained for debugging: ${runRoot}`)
  }
}
