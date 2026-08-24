import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
  AUTOMNIA_OPENCLAW_CONTEXT_TOKENS_DEFAULT,
  AUTOMNIA_COMPACTION_RESERVE_TOKENS,
  enforceAutomniaCompactionPolicy,
  migrateAutomniaCompactBaseline,
} from '../server/services/gateway/compactionPolicy'

test('leaves enough working context for the native compaction reserve', () => {
  assert.equal(AUTOMNIA_COMPACTION_RESERVE_TOKENS, 20_000)
  assert.equal(AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS, 20_000)
  assert.ok(AUTOMNIA_OPENCLAW_CONTEXT_TOKENS_DEFAULT >= AUTOMNIA_COMPACTION_RESERVE_TOKENS * 2)
})

test('caps oversized compaction settings that starve 200k-context prompts', () => {
  const settings = {
    reserveTokensFloor: 128_000,
    reserveTokens: 128_000,
    keepRecentTokens: 80_000,
  }

  assert.equal(enforceAutomniaCompactionPolicy(settings), true)
  assert.equal(settings.reserveTokensFloor, AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  assert.equal(settings.reserveTokens, AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  assert.equal(settings.keepRecentTokens, AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS)
})

test('fills missing settings while preserving smaller intentional values', () => {
  const settings = { reserveTokensFloor: 24_000, keepRecentTokens: 12_000 }

  assert.equal(enforceAutomniaCompactionPolicy(settings), true)
  assert.equal(settings.reserveTokensFloor, AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  assert.equal(settings.keepRecentTokens, 12_000)
})

test('does not rewrite an already safe configuration', () => {
  const settings = {
    reserveTokensFloor: AUTOMNIA_COMPACTION_RESERVE_TOKENS,
    keepRecentTokens: AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
  }

  assert.equal(enforceAutomniaCompactionPolicy(settings), false)
})

test('migrates the prior token-efficient 12k baseline to the native recovery reserve', () => {
  const settings = {
    reserveTokensFloor: 12_000,
    keepRecentTokens: 12_000,
    midTurnPrecheck: { enabled: true },
    truncateAfterCompaction: true,
    maxActiveTranscriptBytes: '8mb',
    notifyUser: false,
    memoryFlush: { enabled: false },
  }

  assert.equal(migrateAutomniaCompactBaseline(settings), true)
  assert.equal(settings.reserveTokensFloor, AUTOMNIA_COMPACTION_RESERVE_TOKENS)
  assert.equal(settings.keepRecentTokens, AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS)
})

test('migrates the older compact-but-unbounded baseline', () => {
  const settings = {
    reserveTokensFloor: AUTOMNIA_COMPACTION_RESERVE_TOKENS,
    keepRecentTokens: AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
    midTurnPrecheck: { enabled: false },
    truncateAfterCompaction: false,
    maxActiveTranscriptBytes: '20mb',
    notifyUser: true,
    memoryFlush: { enabled: false },
  }

  assert.equal(migrateAutomniaCompactBaseline(settings), true)
  assert.equal(settings.midTurnPrecheck.enabled, true)
  assert.equal(settings.truncateAfterCompaction, true)
  assert.equal(settings.maxActiveTranscriptBytes, '8mb')
  assert.equal(settings.notifyUser, false)
})

test('does not migrate a custom compaction choice that differs from the old baseline', () => {
  const settings = {
    reserveTokensFloor: AUTOMNIA_COMPACTION_RESERVE_TOKENS,
    keepRecentTokens: AUTOMNIA_COMPACTION_KEEP_RECENT_TOKENS,
    midTurnPrecheck: { enabled: false },
    truncateAfterCompaction: false,
    maxActiveTranscriptBytes: '24mb',
    notifyUser: true,
    memoryFlush: { enabled: false },
  }

  assert.equal(migrateAutomniaCompactBaseline(settings), false)
  assert.equal(settings.maxActiveTranscriptBytes, '24mb')
  assert.equal(settings.midTurnPrecheck.enabled, false)
})
