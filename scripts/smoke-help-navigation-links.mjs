#!/usr/bin/env node

/**
 * Static contract smoke check for Help Assistant navigation links.
 *
 * This is intentionally dependency-free and does not launch Electron, Vite,
 * the Gateway, or the cloud service. It catches the easy-to-miss failure mode
 * where the knowledge prompt names a real Automnia surface but the Help panel
 * no longer maps that name to a shell navigation target.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(new URL('.', import.meta.url).pathname, '..')
const helpPanel = readFileSync(path.join(repositoryRoot, 'src/components/help/HelpAssistantPanel.tsx'), 'utf8')
const nexusShell = readFileSync(path.join(repositoryRoot, 'src/components/layout/NexusShell.tsx'), 'utf8')
const capabilityPlaybook = readFileSync(path.join(repositoryRoot, 'docs/AGENT_CAPABILITY_PLAYBOOK.md'), 'utf8')

const requiredAliases = [
  'Recruit',
  'Agents',
  'Agent Editor',
  'Edit menu',
  'Edit settings',
  'Agent files',
  'Files',
  'Command Console',
  'Missions',
  'Monitor',
  'Plugins',
  'ClawTalk',
  'Telegram',
  'Settings',
  'UI settings',
  'Appearance',
  'Account & License',
  'Data & reset',
]

for (const alias of requiredAliases) {
  assert.ok(helpPanel.includes(`alias: '${alias}'`) || helpPanel.includes(`alias: "${alias}"`), `Help alias missing: ${alias}`)
}

for (const target of [
  'recruit',
  'agents',
  'command-console',
  'missions',
  'monitor',
  'plugins',
  'plugins-clawtalk',
  'plugins-telegram',
  'settings',
  'agent-editor',
  'agent-editor-files',
  'agent-editor-heartbeat',
  'agent-editor-policy',
  'agent-editor-workspace',
  'agent-editor-skills',
  'settings-appearance',
  'settings-account',
  'settings-workspace',
  'settings-voice',
  'settings-missions',
  'settings-agents',
  'settings-data',
]) {
  assert.ok(helpPanel.includes(`target: '${target}'`) || helpPanel.includes(`target: "${target}"`), `Help target missing: ${target}`)
}

for (const shellBranch of [
  "target === 'recruit'",
  "target === 'command-console'",
  "target === 'plugins-clawtalk'",
  "target === 'plugins-telegram'",
]) {
  assert.ok(nexusShell.includes(shellBranch), `Shell navigation branch missing: ${shellBranch}`)
}

assert.ok(nexusShell.includes("target.startsWith('agent-editor')"), 'Shell must route exact Agent Editor targets')
assert.ok(nexusShell.includes("target.startsWith('settings-')"), 'Shell must route exact Settings targets')
assert.ok(nexusShell.includes('resolveAgentEditorId'), 'Shell must resolve an agent before opening editor references')

for (const topic of [
  'Customize an agent',
  'Manage email with an agent',
  'Give an agent a phone number',
  'Set up Telegram with an agent',
  'Give an agent new skills',
  'Automate a recurring task',
  'Build an advanced agent team',
  'Research YouTube with an agent',
  'Automate browser workflows',
  'Plan Instagram safely',
  'Use Google Cloud and Gog CLI',
  'Explore 100 agent ideas',
]) {
  assert.ok(helpPanel.includes(`title: '${topic}'`), `Help topic missing: ${topic}`)
}

for (const playbookSection of [
  '## Template 1: Customize an agent',
  '## Template 2: Manage email with an agent',
  '## Template 3: Give an agent a phone number with ClawTalk',
  '## Template 4: Connect Telegram safely',
  '## Template 6: Automate a recurring task',
  '## Template 8: Research and manage YouTube content',
  '## Template 10: Manage Instagram with an agent',
  '## A compact catalog of creative starting points',
  '100. Build an approval matrix for an automation.',
]) {
  assert.ok(capabilityPlaybook.includes(playbookSection), `Capability playbook section missing: ${playbookSection}`)
}

console.log(JSON.stringify({ event: 'help_navigation_links_contract_ok', aliases: requiredAliases.length }))
