const fs = require('node:fs')
const path = require('node:path')

const marker = 'Automnia: skip missing session database before custody check'

function patchMissingSessionStoreSource(source) {
  if (source.includes(marker)) return source
  const pretty = 'function readSessionStoreTargetSnapshot(e, t) {\n\tconst n = e.readCandidates ? assertSessionStoreReadCandidate(e.sqlitePath, e.readCandidates) : e.sqlitePath;'
  const compact = 'function readSessionStoreTargetSnapshot(e,t){let n=e.readCandidates?O(e.sqlitePath,e.readCandidates):e.sqlitePath,'
  if (source.includes(pretty)) {
    return source.replace(pretty, `function readSessionStoreTargetSnapshot(e, t) {\n\t// ${marker}.\n\tif (!fs.existsSync(e.sqlitePath)) return { available: false, reason: "database-missing" };\n\tconst n = e.readCandidates ? assertSessionStoreReadCandidate(e.sqlitePath, e.readCandidates) : e.sqlitePath;`)
  }
  if (source.includes(compact)) {
    return source.replace(compact, `function readSessionStoreTargetSnapshot(e,t){/* ${marker} */if(!K.existsSync(e.sqlitePath))return{available:!1,reason:\`database-missing\`};let n=e.readCandidates?O(e.sqlitePath,e.readCandidates):e.sqlitePath,`)
  }
  throw new Error('OpenClaw session-store snapshot reader changed; cannot safely skip missing databases')
}

function ensureMissingSessionStoreRecovery(vendorRoot) {
  const dirs = [path.join(vendorRoot, 'dist'), path.join(vendorRoot, 'dist', 'config', 'sessions')]
  const patterns = [/^session-store-target-inventory-.*\.mjs$/, /^transcript-session-store-target-inventory-.*\.mjs$/]
  dirs.forEach((dir, index) => {
    const matches = fs.readdirSync(dir).filter((name) => patterns[index].test(name))
      .map((name) => ({ file: path.join(dir, name), source: fs.readFileSync(path.join(dir, name), 'utf8') }))
      .filter(({ source }) => source.includes('function readSessionStoreTargetSnapshot('))
    if (matches.length !== 1) throw new Error(`Expected exactly one session-store inventory implementation in ${dir}; found ${matches.length}`)
    const { file, source: original } = matches[0]
    const patched = patchMissingSessionStoreSource(original)
    if (patched !== original) fs.writeFileSync(file, patched)
  })
}

module.exports = { ensureMissingSessionStoreRecovery, patchMissingSessionStoreSource }
