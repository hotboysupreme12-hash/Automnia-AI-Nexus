import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedEditDistance } from '../src/utils/searchDistance'

test('bounded typo matching agrees with exact edit distance for insertions, deletions and substitutions', () => {
  const exact = (a: string, b: string) => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? j ? 0 : i : j))
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]))
    }
    return rows[a.length][b.length]
  }
  const words = ['', 'a', 'ab', 'ba', 'aab', 'baba', 'architect', 'archtect', 'research', 'reserach', 'longunrelatedword']
  for (const a of words) for (const b of words) for (const threshold of [0, 1, 2]) {
    assert.equal(boundedEditDistance(a, b, threshold), Math.min(exact(a, b), threshold + 1), `${a}/${b}/${threshold}`)
  }
  assert.equal(boundedEditDistance('x'.repeat(100_000), 'agent', 2), 3)
})
