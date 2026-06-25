#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function usage() {
  return `
Usage: node scripts/setup-openclaw-gateway-auth.mjs [options]

Creates or repairs OpenClaw gateway shared-secret auth for a local machine.

Options:
  --home <path>       OpenClaw home directory (default: OPENCLAW_HOME or ~/.openclaw)
  --config <path>     Config path (default: <home>/openclaw.json)
  --token <token>     Use this gateway token instead of existing/generated token
  --password <value>  Also store an explicit password fallback (token-only by default)
  --no-password       Do not add or update a password fallback (default)
  --no-env            Do not write <home>/.env
  --dry-run           Print planned changes without writing
  --help              Show this help
`.trim()
}

function parseArgs(argv) {
  const args = {
    password: undefined,
    writePassword: false,
    writeEnv: true,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const nextValue = (label) => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${label} requires a value`)
      i += 1
      return value
    }

    switch (arg) {
      case '--home':
        args.home = nextValue(arg)
        break
      case '--config':
        args.config = nextValue(arg)
        break
      case '--token':
        args.token = nextValue(arg)
        break
      case '--password':
        args.password = nextValue(arg)
        args.writePassword = true
        break
      case '--no-password':
        args.password = undefined
        args.writePassword = false
        break
      case '--no-env':
        args.writeEnv = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return args
}

function resolveOpenClawHome(explicitHome) {
  if (explicitHome) return path.resolve(explicitHome)
  if (process.env.OPENCLAW_HOME?.trim()) return path.resolve(process.env.OPENCLAW_HOME.trim())
  return path.join(os.homedir(), '.openclaw')
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return { lines: [], values: new Map() }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const values = new Map()
  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match) values.set(match[1], match[2])
  }
  return { lines, values }
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {}
  return parent[key]
}

function configuredString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex')
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function writeTextWithBackup(filePath, text, dryRun) {
  const existed = fs.existsSync(filePath)
  const previous = existed ? fs.readFileSync(filePath, 'utf8') : undefined
  if (previous === text) return { changed: false, backup: null }

  const backup = existed ? `${filePath}.bak-auth-setup-${timestampForFile()}` : null
  if (!dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (backup) fs.copyFileSync(filePath, backup)
    fs.writeFileSync(filePath, text, 'utf8')
  }
  return { changed: true, backup }
}

function serializeJson(config) {
  return `${JSON.stringify(config, null, 2)}\n`
}

function upsertEnv(lines, key, value) {
  let found = false
  const next = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line
    found = true
    return `${key}=${value}`
  })
  if (!found) next.push(`${key}=${value}`)
  while (next.length > 0 && next[next.length - 1] === '') next.pop()
  return `${next.join('\n')}\n`
}

function redactSummary(value) {
  return value ? '<configured>' : '<missing>'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  if (args.writePassword && !configuredString(args.password)) {
    throw new Error('Password fallback cannot be empty. Use --no-password to skip it.')
  }

  const openclawHome = resolveOpenClawHome(args.home)
  const configPath = path.resolve(args.config || path.join(openclawHome, 'openclaw.json'))
  const envPath = path.join(openclawHome, '.env')
  const config = readJsonFile(configPath)
  const envFile = readDotEnv(envPath)

  const gateway = ensureObject(config, 'gateway')
  const auth = ensureObject(gateway, 'auth')
  const remote = ensureObject(gateway, 'remote')

  const existingToken =
    configuredString(args.token) ||
    configuredString(auth.token) ||
    configuredString(envFile.values.get('OPENCLAW_GATEWAY_TOKEN')) ||
    randomToken()

  auth.mode = 'token'
  auth.token = existingToken
  remote.token = existingToken

  if (args.writePassword) {
    auth.password = args.password
    remote.password = args.password
  }

  const configWrite = writeTextWithBackup(configPath, serializeJson(config), args.dryRun)

  let envWrite = { changed: false, backup: null }
  if (args.writeEnv) {
    let envText = upsertEnv(envFile.lines, 'OPENCLAW_GATEWAY_TOKEN', existingToken)
    if (args.writePassword) {
      envText = upsertEnv(envText.split(/\r?\n/), 'OPENCLAW_GATEWAY_PASSWORD', args.password)
    }
    envWrite = writeTextWithBackup(envPath, envText, args.dryRun)
  }

  const summary = {
    dryRun: args.dryRun,
    openclawHome,
    configPath,
    envPath: args.writeEnv ? envPath : null,
    configChanged: configWrite.changed,
    envChanged: envWrite.changed,
    configBackup: configWrite.backup,
    envBackup: envWrite.backup,
    authMode: auth.mode,
    token: redactSummary(auth.token),
    password: args.writePassword ? redactSummary(auth.password) : '<skipped>',
    remoteToken: redactSummary(remote.token),
    remotePassword: args.writePassword ? redactSummary(remote.password) : '<skipped>',
  }

  console.log(JSON.stringify(summary, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
