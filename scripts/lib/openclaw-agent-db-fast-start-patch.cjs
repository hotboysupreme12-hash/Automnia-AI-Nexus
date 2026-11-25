const fs = require('node:fs')
const path = require('node:path')

const dbMarker = 'Automnia: bypass stale agent database full integrity gate'
const schemaMarker = 'Automnia: bypass stale agent database integrity scan'

function ensureAutomniaAgentDatabaseFastStart(vendorRoot) {
  const distRoot = path.join(vendorRoot, 'dist')
  const dbFiles = fs.readdirSync(distRoot)
    .filter((name) => /^openclaw-agent-db-[^/]+\.mjs$/.test(name))
    .map((name) => ({ file: path.join(distRoot, name), source: fs.readFileSync(path.join(distRoot, name), 'utf8') }))
    .filter(({ source }) => source.includes(dbMarker) || (source.includes('integrityGateReason = _ ?') && source.includes('"stale-lease-full"')))
  if (dbFiles.length !== 1) {
    throw new Error(`[openclaw-vendor] Expected one agent database admission bundle, found ${dbFiles.length}`)
  }

  const db = dbFiles[0]
  if (!db.source.includes(dbMarker)) {
    const reasonCount = db.source.split('"stale-lease-full"').length - 1
    if (reasonCount < 2) {
      throw new Error('[openclaw-vendor] Agent database stale-lease integrity gate changed')
    }
    const originalBranch = 'y.integrityGateReason = _ ? v && S !== null && readAgentDatabaseLeaseProvenance(l) === S ? "process-death" : "stale-lease-full" :'
    if (!db.source.includes(originalBranch)) {
      throw new Error('[openclaw-vendor] Agent database stale-lease provenance branch changed')
    }
    const withoutProvenanceGate = db.source.replace(originalBranch, 'y.integrityGateReason = _ ? "process-death" :')
    const bypassed = withoutProvenanceGate.replaceAll('"stale-lease-full"', '"process-death"')
    fs.writeFileSync(db.file, `// ${dbMarker}\n${bypassed}`)
  } else {
    const redundantBranch = 'y.integrityGateReason = _ ? v && S !== null && readAgentDatabaseLeaseProvenance(l) === S ? "process-death" : "process-death" :'
    if (db.source.includes(redundantBranch)) {
      const withoutProvenanceGate = db.source.replace(redundantBranch, 'y.integrityGateReason = _ ? "process-death" :')
      fs.writeFileSync(db.file, withoutProvenanceGate)
    }
  }

  const schemaFiles = fs.readdirSync(distRoot)
    .filter((name) => /^openclaw-agent-db-schema-[^/]+\.mjs$/.test(name))
    .map((name) => ({ file: path.join(distRoot, name), source: fs.readFileSync(path.join(distRoot, name), 'utf8') }))
    .filter(({ source }) => source.includes('function* agentDatabaseIntegrityBeforeMutationSteps('))
  if (schemaFiles.length !== 1) {
    throw new Error(`[openclaw-vendor] Expected one agent database schema gate, found ${schemaFiles.length}`)
  }

  const schema = schemaFiles[0]
  if (!schema.source.includes(schemaMarker)) {
    const signature = 'function* agentDatabaseIntegrityBeforeMutationSteps('
    const start = schema.source.indexOf(signature)
    const body = schema.source.indexOf('{', start + signature.length)
    if (start < 0 || body < 0 || !schema.source.slice(start, body).includes('r,')) {
      throw new Error('[openclaw-vendor] Agent database integrity gate signature changed')
    }
    const bypass = `\n\t// ${schemaMarker}\n\tif (r?.integrityGateReason === "process-death") {\n\t\tr.integrityGateMode = "bypassed";\n\t\tr.integrityGateOutcome = "bypassed";\n\t\treturn false;\n\t}\n`
    fs.writeFileSync(schema.file, `${schema.source.slice(0, body + 1)}${bypass}${schema.source.slice(body + 1)}`)
  }

  const pending = [distRoot]
  let schedulerCalls = 0
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(file)
        continue
      }
      const relative = path.relative(distRoot, file).toLowerCase()
      if (!relative.includes('database-preflight') || (!file.endsWith('.mjs') && !file.endsWith('.js'))) continue
      let source = fs.readFileSync(file, 'utf8')
      const calls = source.split('?.scheduling(').length - 1
      const patchedCalls = source.split('?.scheduling?.(').length - 1
      schedulerCalls += calls + patchedCalls
      if (calls) {
        source = source.replaceAll('?.scheduling(', '?.scheduling?.(')
        fs.writeFileSync(file, source)
      }
    }
  }
  if (schedulerCalls === 0) {
    throw new Error('[openclaw-vendor] Agent database startup scheduler call sites changed')
  }
}

module.exports = { ensureAutomniaAgentDatabaseFastStart }
