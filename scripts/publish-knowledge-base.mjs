#!/usr/bin/env node

/**
 * Publishes the sanitized Automnia help corpus to the private Discovery Engine
 * data store used by the in-product Automnia Assistant.
 *
 * This intentionally selects product/user documentation instead of uploading
 * the repository wholesale. Source code, admin migration notes, state files,
 * customer records, and credential-bearing material do not belong in a user
 * support index.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = path.resolve(new URL('.', import.meta.url).pathname, '..')
const projectId = process.env.AUTOMNIA_KNOWLEDGE_PROJECT || 'groovy-iris-497718-f3'
const location = process.env.AUTOMNIA_KNOWLEDGE_LOCATION || 'global'
const collection = 'default_collection'
const dataStoreId = process.env.AUTOMNIA_KNOWLEDGE_DATA_STORE || 'automnia-knowledge'
const branch = '0'

function source(relativePath) {
  return path.join(repositoryRoot, relativePath)
}

const sourceGroups = [
  {
    id: 'automnia-assistant-playbook',
    title: 'Automnia Assistant identity and operational playbook',
    description: 'Role instructions, account safety, gateway recovery, product surfaces, and support behavior for Automnia Assistant.',
    files: ['infra/gcloud/knowledge/automnia-assistant-operational-playbook.md'],
  },
  {
    id: 'automnia-product-user-guide',
    title: 'Automnia AI Nexus product user guide',
    description: 'The public Automnia user guide covering accounts, agents, missions, models, workspaces, schedules, plugins, channels, and troubleshooting.',
    files: ['docs/USER_GUIDE.md'],
  },
  {
    id: 'automnia-agent-setup-and-navigation',
    title: 'Automnia exact navigation, setup, and agent-assisted workflow guides',
    description: 'Exact in-app click paths for agents, Command Console, plugins, ClawTalk, Telegram, Google Workspace/Gog, Google Cloud, YouTube workflows, and troubleshooting.',
    files: ['docs/AGENT_SETUP_GUIDES.md'],
  },
  {
    id: 'automnia-bundled-skills-catalog',
    title: 'Automnia bundled OpenClaw skills catalog',
    description: 'Sanitized capability catalog for the bundled OpenClaw skills, their practical uses, prerequisites, and safe ClawHub discovery/install workflow.',
    files: ['docs/BUNDLED_SKILLS_CATALOG.md'],
  },
  {
    id: 'automnia-ui-reference',
    title: 'Automnia exact user interface reference',
    description: 'Source-verified click paths, controls, effects, safeguards, and agent-assisted alternatives for every Automnia workspace.',
    files: ['docs/AUTOMNIA_UI_REFERENCE.md'],
  },
  {
    id: 'automnia-support-recovery',
    title: 'Automnia support and recovery guide',
    description: 'Safe desktop support, Gateway recovery, migrations, local-first boundaries, feedback, and redacted diagnostics.',
    files: ['docs/BETA_SUPPORT.md', 'docs/BETA_RELEASE_NOTES.md', 'SECURITY.md', 'DATA_HANDLING.md'],
  },
  {
    id: 'automnia-command-console',
    title: 'Automnia Command Console and Gateway integration guide',
    description: 'How Automnia uses the OpenClaw Gateway for Command Console sessions, streaming, history, tools, fallback, and recovery.',
    files: ['docs/OPENCLAW_GATEWAY_COMMAND_CONSOLE_GUIDE.md'],
  },
  {
    id: 'openclaw-gateway-runtime',
    title: 'OpenClaw Gateway runtime reference for Automnia',
    description: 'Curated OpenClaw Gateway health, authentication, diagnostics, background process, migration, and troubleshooting reference.',
    files: [
      'docs/openclaw-latest/pages/gateway.md',
      'docs/openclaw-latest/pages/gateway/health.md',
      'docs/openclaw-latest/pages/gateway/background-process.md',
      'docs/openclaw-latest/pages/gateway/authentication.md',
      'docs/openclaw-latest/pages/gateway/diagnostics.md',
      'docs/openclaw-latest/pages/gateway/doctor.md',
    ],
  },
  {
    id: 'openclaw-cli-operations',
    title: 'OpenClaw operational command reference for Automnia',
    description: 'Curated operator reference for Gateway, Doctor, status, migration, models, plugins, and cron operations.',
    files: [
      'docs/openclaw-latest/pages/cli/gateway.md',
      'docs/openclaw-latest/pages/cli/doctor.md',
      'docs/openclaw-latest/pages/cli/status.md',
      'docs/openclaw-latest/pages/cli/migrate.md',
      'docs/openclaw-latest/pages/cli/models.md',
      'docs/openclaw-latest/pages/cli/plugins.md',
      'docs/openclaw-latest/pages/cli/cron.md',
    ],
  },
  {
    id: 'openclaw-agents-models-and-memory',
    title: 'OpenClaw agents, models, providers, OAuth, memory, and streaming reference',
    description: 'Curated concepts reference for Automnia agents, multi-agent work, models, providers, OAuth, memory, and streaming.',
    files: [
      'docs/openclaw-latest/pages/concepts/agent.md',
      'docs/openclaw-latest/pages/concepts/multi-agent.md',
      'docs/openclaw-latest/pages/concepts/models.md',
      'docs/openclaw-latest/pages/concepts/model-providers.md',
      'docs/openclaw-latest/pages/concepts/oauth.md',
      'docs/openclaw-latest/pages/concepts/memory.md',
      'docs/openclaw-latest/pages/concepts/streaming.md',
    ],
  },
]

function redactSensitiveExamples(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|pk|rk|xoxb|xapp|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[redacted credential example]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted credential example]')
    .replace(/(password\s*[:=]\s*)[^\s`'"}]+/gi, '$1[redacted]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s`'"}]+/gi, '$1[redacted]')
}

function buildDocument(group) {
  const sections = group.files.map((relativePath) => {
    const content = redactSensitiveExamples(readFileSync(source(relativePath), 'utf8'))
    return `\n\n---\n\n## Source document: ${relativePath}\n\n${content}`
  })
  const content = `# ${group.title}\n\n${group.description}\n\nThis is a sanitized Automnia help source. It is product guidance, not live machine state.\n${sections.join('')}`
  return {
    id: group.id,
    schemaId: 'default_schema',
    jsonData: JSON.stringify({ title: group.title, description: group.description, source: 'Automnia repository sanitized help corpus' }),
    content: { mimeType: 'text/plain', rawBytes: Buffer.from(content, 'utf8').toString('base64') },
  }
}

function gcloud(args) {
  return execFileSync('gcloud', args, { encoding: 'utf8' }).trim()
}

async function publish(document, token, projectNumber) {
  const resource = `projects/${projectNumber}/locations/${location}/collections/${collection}/dataStores/${dataStoreId}/branches/${branch}/documents/${document.id}`
  const url = `https://discoveryengine.googleapis.com/v1/${resource}?allowMissing=true`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Knowledge document ${document.id} failed (${response.status}): ${body.slice(0, 500)}`)
  return JSON.parse(body)
}

const documents = sourceGroups.map(buildDocument)
const totalBytes = documents.reduce((sum, document) => sum + Buffer.from(document.content.rawBytes, 'base64').byteLength, 0)
console.log(JSON.stringify({ event: 'knowledge_corpus_prepared', documentCount: documents.length, totalBytes, documents: documents.map((document) => ({ id: document.id, bytes: Buffer.from(document.content.rawBytes, 'base64').byteLength })) }, null, 2))

if (process.argv.includes('--dry-run')) process.exit(0)

const token = gcloud(['auth', 'print-access-token'])
const projectNumber = gcloud(['projects', 'describe', projectId, '--format=value(projectNumber)'])
for (const document of documents) {
  const result = await publish(document, token, projectNumber)
  console.log(JSON.stringify({ event: 'knowledge_document_published', id: document.id, name: result.name || null }))
}

console.log(JSON.stringify({ event: 'knowledge_corpus_published', projectId, projectNumber, dataStoreId, documentCount: documents.length }))
