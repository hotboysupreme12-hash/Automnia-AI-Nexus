import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadAgencyAgentTemplateCatalog,
  scanAgencyAgentTemplateCatalog,
} from '../server/services/recruit/agencyAgentTemplateService'

async function makeAgencyTemplateFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agency-template-service-'))
  await writeFile(path.join(root, 'divisions.json'), JSON.stringify({
    divisions: {
      engineering: {
        label: 'Engineering',
        color: '#3B82F6',
        icon: 'code',
      },
    },
  }, null, 2))
  await writeFile(path.join(root, '.agency-source.json'), JSON.stringify({
    repository: 'msitarzewski/agency-agents',
    commit: 'fixture-commit',
  }, null, 2))
  await writeFile(path.join(root, 'tools.json'), JSON.stringify({
    tools: {
      codex: {
        label: 'Codex',
        installKind: 'per-agent',
        format: 'codex-toml',
        order: 1,
      },
    },
  }, null, 2))
  await mkdir(path.join(root, 'engineering'), { recursive: true })
  await writeFile(path.join(root, 'engineering', 'frontend-developer.md'), `---
name: Frontend Developer
description: Builds reliable user interfaces with clean state boundaries.
color: "#3B82F6"
vibe: "Precise, pragmatic, and verification-minded."
tools: playwright, npm
---
## Identity
You are a frontend specialist who keeps UI behavior grounded in user workflows.

## Workflow
- Inspect existing components first.
- Patch the smallest useful surface.
- Verify responsive states.
`)
  return root
}

async function makeOriginalStyleAgencyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agency-template-original-'))
  await mkdir(path.join(root, 'design'), { recursive: true })
  await mkdir(path.join(root, 'engineering'), { recursive: true })
  await mkdir(path.join(root, 'spatial-computing'), { recursive: true })
  await writeFile(path.join(root, 'design', 'ui-designer.md'), `---
name: UI Designer
description: Designs clear, accessible application interfaces.
---
## Workflow
- Shape interface details.
`)
  await writeFile(path.join(root, 'engineering', 'frontend-developer.md'), `---
name: Frontend Developer
description: Builds reliable user interfaces.
---
## Workflow
- Patch UI behavior.
`)
  await writeFile(path.join(root, 'spatial-computing', 'visionos-spatial-engineer.md'), `# visionOS Spatial Engineer

**Specialization**: Native visionOS spatial computing and SwiftUI volumetric interfaces.

## Core Expertise
- Spatial widgets
- RealityKit integration
`)
  return root
}

test('scans Agency markdown templates into recruit-ready OpenClaw documents', async () => {
  const sourceRoot = await makeAgencyTemplateFixture()
  const catalog = await scanAgencyAgentTemplateCatalog(sourceRoot)

  assert.equal(catalog.templates.length, 1)
  assert.equal(catalog.source.templateCount, 1)
  assert.equal(catalog.divisions.engineering.label, 'Engineering')

  const template = catalog.templates[0]
  assert.equal(template.id, 'engineering:frontend-developer')
  assert.equal(template.defaults.agentId, 'frontend-developer')
  assert.equal(template.defaults.behaviorProfile, 'executor')
  assert.equal(template.defaults.capabilities.codeGeneration, true)
  assert.equal(template.defaults.capabilities.memoryManagement, true)
  assert.deepEqual(new Set(template.documents.map((entry) => entry.file)), new Set([
    'IDENTITY.md',
    'SOUL.md',
    'AGENTS.md',
    'TOOLS.md',
    'BOOTSTRAP.md',
    'USER.md',
    'HEARTBEAT.md',
    'MEMORY.md',
    'MISSION_PROMPT.md',
    'AGENCY_SOURCE.md',
  ]))
  assert(template.defaults.tools.includes('filesystem'))
  assert(template.defaults.tools.includes('shell'))
  assert(template.defaults.tools.includes('playwright'))
  assert(template.defaults.tools.includes('npm'))
  assert(template.documents.find((entry) => entry.file === 'SOUL.md')?.content.includes('frontend specialist'))
  assert(template.documents.find((entry) => entry.file === 'AGENTS.md')?.content.includes('Inspect existing components first'))
  assert(template.documents.find((entry) => entry.file === 'TOOLS.md')?.content.includes('Codex (codex) - per-agent, format: codex-toml'))
})

test('loads Agency template catalog through state cache and disk snapshot fallback', async () => {
  const sourceRoot = await makeAgencyTemplateFixture()
  const stateFilePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'agency-template-state-')), 'catalog.json')
  let stateValue: unknown = null
  let templateCatalogValue: unknown = null
  let writeCount = 0
  let templateWriteCount = 0

  const catalog = await loadAgencyAgentTemplateCatalog({
    sourceRoot,
    stateKey: 'agents:agency-templates',
    stateFilePath,
    readState: () => null,
    writeState: (_stateKey, value) => {
      stateValue = value
      writeCount += 1
      return true
    },
    readTemplateCatalog: () => null,
    writeTemplateCatalog: (value) => {
      templateCatalogValue = value
      templateWriteCount += 1
      return true
    },
  })

  assert.equal(catalog.templates.length, 1)
  assert.equal(writeCount, 1)
  assert.equal(templateWriteCount, 1)
  assert.equal(JSON.parse(await readFile(stateFilePath, 'utf-8')).templates.length, 1)

  const sqliteCached = await loadAgencyAgentTemplateCatalog({
    sourceRoot,
    stateKey: 'agents:agency-templates',
    stateFilePath,
    readState: () => {
      throw new Error('sqlite catalog should load before state cache')
    },
    writeState: () => {
      throw new Error('sqlite catalog should not rewrite state cache')
    },
    readTemplateCatalog: () => templateCatalogValue as never,
    writeTemplateCatalog: () => {
      throw new Error('sqlite catalog cache hit should not rewrite')
    },
  })
  assert.equal(sqliteCached.templates[0].id, 'engineering:frontend-developer')

  const cached = await loadAgencyAgentTemplateCatalog({
    sourceRoot: path.join(sourceRoot, 'missing'),
    stateKey: 'agents:agency-templates',
    stateFilePath,
    readState: () => stateValue,
    writeState: () => {
      throw new Error('cache hit should not rewrite')
    },
  })
  assert.equal(cached.templates[0].id, 'engineering:frontend-developer')

  const diskFallback = await loadAgencyAgentTemplateCatalog({
    sourceRoot: path.join(sourceRoot, 'still-missing'),
    stateKey: 'agents:agency-templates',
    stateFilePath,
    readState: () => null,
    writeState: () => false,
  })
  assert.equal(diskFallback.templates[0].id, 'engineering:frontend-developer')

  const staleCatalog = {
    ...catalog,
    source: { ...catalog.source, commit: 'older-commit' },
    templates: [],
  }
  const staleStateFilePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'agency-template-stale-')), 'catalog.json')
  let refreshWrites = 0
  const refreshed = await loadAgencyAgentTemplateCatalog({
    sourceRoot,
    stateKey: 'agents:agency-templates',
    stateFilePath: staleStateFilePath,
    readState: () => staleCatalog,
    writeState: () => {
      refreshWrites += 1
      return true
    },
  })
  assert.equal(refreshed.templates.length, 1)
  assert.equal(refreshWrites, 1)
})

test('scans original Agency folder layout and plain markdown templates', async () => {
  const sourceRoot = await makeOriginalStyleAgencyFixture()
  const catalog = await scanAgencyAgentTemplateCatalog(sourceRoot)

  assert.equal(catalog.templates.length, 3)
  assert.deepEqual(Object.keys(catalog.divisions), ['engineering', 'design', 'spatial-computing'])
  assert.equal(catalog.divisions['spatial-computing'].label, 'Spatial Computing')
  assert.deepEqual(catalog.templates.map((template) => template.id), [
    'engineering:frontend-developer',
    'design:ui-designer',
    'spatial-computing:visionos-spatial-engineer',
  ])
  const spatial = catalog.templates.find((template) => template.id === 'spatial-computing:visionos-spatial-engineer')
  assert.equal(spatial?.name, 'visionOS Spatial Engineer')
  assert.equal(spatial?.description, 'Native visionOS spatial computing and SwiftUI volumetric interfaces.')
  assert(spatial?.documents.find((entry) => entry.file === 'AGENCY_SOURCE.md')?.content.includes('# visionOS Spatial Engineer'))
})
