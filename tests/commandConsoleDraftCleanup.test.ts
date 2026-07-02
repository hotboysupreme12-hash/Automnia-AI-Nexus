import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makeCommandConsoleDraftStorageKey,
  readCommandConsoleDraft,
  removeCommandConsoleDraftsForAgent,
  writeCommandConsoleDraft,
  type CommandConsoleDraftStorage,
} from '../src/store/commandConsoleState'

class MemoryDraftStorage implements CommandConsoleDraftStorage {
  private readonly data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

test('command-console draft cleanup removes exact agent lanes without substring collateral', () => {
  const storage = new MemoryDraftStorage()
  const alphaDirect = makeCommandConsoleDraftStorageKey('direct:alpha')
  const alphaParty = makeCommandConsoleDraftStorageKey('party:alpha,beta')
  const alphabetDirect = makeCommandConsoleDraftStorageKey('direct:alphabet')
  const betaDirect = makeCommandConsoleDraftStorageKey('direct:beta')

  writeCommandConsoleDraft(alphaDirect, 'direct alpha', storage)
  writeCommandConsoleDraft(alphaParty, 'party alpha beta', storage)
  writeCommandConsoleDraft(alphabetDirect, 'keep alphabet', storage)
  writeCommandConsoleDraft(betaDirect, 'keep beta', storage)

  assert.equal(removeCommandConsoleDraftsForAgent('ALPHA', storage), 2)
  assert.equal(readCommandConsoleDraft(alphaDirect, storage), '')
  assert.equal(readCommandConsoleDraft(alphaParty, storage), '')
  assert.equal(readCommandConsoleDraft(alphabetDirect, storage), 'keep alphabet')
  assert.equal(readCommandConsoleDraft(betaDirect, storage), 'keep beta')
})
