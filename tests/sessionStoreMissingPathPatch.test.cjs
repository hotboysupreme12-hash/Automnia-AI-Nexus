const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { ensureMissingSessionStoreRecovery, patchMissingSessionStoreSource } = require('../scripts/lib/session-store-missing-path-patch.cjs')

const pretty = 'function readSessionStoreTargetSnapshot(e, t) {\n\tconst n = e.readCandidates ? assertSessionStoreReadCandidate(e.sqlitePath, e.readCandidates) : e.sqlitePath;\n\treturn n;\n}'
const compact = 'function readSessionStoreTargetSnapshot(e,t){let n=e.readCandidates?O(e.sqlitePath,e.readCandidates):e.sqlitePath,r=n;return r}'

for (const [format, source] of [['pretty', pretty], ['compact', compact]]) {
  test(`${format} session recovery skips absent databases but still checks custody for existing files`, () => {
    const patched = patchMissingSessionStoreSource(source)
    assert.equal(patchMissingSessionStoreSource(patched), patched)
    let checks = 0
    const exists = { value: false }
    const fileSystem = { existsSync: () => exists.value }
    const custody = () => { checks += 1; throw new Error('custody refused') }
    const reader = new Function('fs', 'K', 'assertSessionStoreReadCandidate', 'O', `${patched}; return readSessionStoreTargetSnapshot`)(fileSystem, fileSystem, custody, custody)
    assert.deepEqual(reader({ sqlitePath: 'missing', readCandidates: [] }), { available: false, reason: 'database-missing' })
    assert.equal(checks, 0)
    exists.value = true
    assert.throws(() => reader({ sqlitePath: 'existing', readCandidates: [] }), /custody refused/)
    assert.equal(checks, 1)
  })
}

test('unknown snapshot shapes fail closed', () => {
  assert.throws(() => patchMissingSessionStoreSource('function readSessionStoreTargetSnapshot() {}'), /changed/)
})

test('runtime preparation patches both implementations while ignoring re-export shims', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-session-store-patch-'))
  try {
    const dist = path.join(root, 'dist')
    const nested = path.join(dist, 'config', 'sessions')
    fs.mkdirSync(nested, { recursive: true })
    const main = path.join(dist, 'session-store-target-inventory-test.mjs')
    const transcript = path.join(nested, 'transcript-session-store-target-inventory-test.mjs')
    fs.writeFileSync(main, pretty)
    fs.writeFileSync(transcript, compact)
    fs.writeFileSync(path.join(nested, 'transcript-session-store-target-inventory-shim.mjs'), 'export {}')
    ensureMissingSessionStoreRecovery(root)
    for (const file of [main, transcript]) assert.match(fs.readFileSync(file, 'utf8'), /skip missing session database before custody check/)
    ensureMissingSessionStoreRecovery(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
