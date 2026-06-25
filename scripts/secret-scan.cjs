const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const maxFileBytes = 5 * 1024 * 1024
const allowlistMarker = /(?:pragma:\s*allowlist\s+secret|secret-scan:\s*allow)/i

const skippedPathPrefixes = [
  '.cache/',
  '.git/',
  '.tmp/',
  'artifacts/',
  'dist/',
  'dist-server/',
  'docs/openclaw-latest/',
  'node_modules/',
  'release/',
  'vendor/',
]

const skippedFileNames = new Set([
  'package-lock.json',
])

const skippedExtensions = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
])

const detectors = [
  {
    id: 'private-key',
    description: 'private key material',
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key ID',
    pattern: /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'anthropic-api-key',
    description: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    id: 'openai-api-key',
    description: 'OpenAI-style API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'jwt',
    description: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'npm-token',
    description: 'npm token',
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    id: 'stripe-key',
    description: 'Stripe key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  },
]

function walkCandidateFiles(directory = root, relativeDirectory = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (shouldSkip(`${relativePath}/`)) continue
      files.push(...walkCandidateFiles(path.join(directory, entry.name), relativePath))
      continue
    }
    if (entry.isFile()) files.push(relativePath)
  }
  return files
}

function candidateFiles() {
  try {
    const insideWorkTree = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (insideWorkTree === 'true') {
      const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'buffer',
      })
      return output
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((filePath) => filePath.replace(/\\/g, '/'))
    }
  } catch {
    // Source archives and release qualification folders may not include .git.
  }
  return walkCandidateFiles()
}

function shouldSkip(filePath) {
  if (skippedFileNames.has(path.basename(filePath))) return true
  if (skippedExtensions.has(path.extname(filePath).toLowerCase())) return true
  return skippedPathPrefixes.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix))
}

function lineNumberAt(text, index) {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end)
}

function redact(value) {
  if (value.length <= 12) return '[redacted]'
  return `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`
}

function scanFile(filePath) {
  const absolutePath = path.join(root, filePath)
  if (!fs.existsSync(absolutePath)) return []
  const stat = fs.statSync(absolutePath)
  if (!stat.isFile() || stat.size > maxFileBytes) return []

  const bytes = fs.readFileSync(absolutePath)
  if (bytes.includes(0)) return []

  const text = bytes.toString('utf8')
  const findings = []
  for (const detector of detectors) {
    detector.pattern.lastIndex = 0
    let match
    while ((match = detector.pattern.exec(text)) !== null) {
      const line = lineAt(text, match.index)
      if (allowlistMarker.test(line)) continue
      findings.push({
        detector: detector.id,
        description: detector.description,
        filePath,
        line: lineNumberAt(text, match.index),
        preview: redact(match[0]),
      })
    }
  }
  return findings
}

function main() {
  const findings = []
  for (const filePath of candidateFiles()) {
    if (shouldSkip(filePath)) continue
    findings.push(...scanFile(filePath))
  }

  if (findings.length) {
    console.error(`[secret-scan] Found ${findings.length} potential checked-in secret(s):`)
    for (const finding of findings.slice(0, 50)) {
      console.error(`- ${finding.filePath}:${finding.line} ${finding.detector} (${finding.description}) ${finding.preview}`)
    }
    if (findings.length > 50) console.error(`[secret-scan] ${findings.length - 50} additional finding(s) omitted.`)
    process.exit(1)
  }

  console.log('[secret-scan] no high-confidence checked-in secrets found')
}

main()
