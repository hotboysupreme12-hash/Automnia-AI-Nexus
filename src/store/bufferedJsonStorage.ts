import type { PersistStorage, StorageValue } from 'zustand/middleware'

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Buffer objects, not serialized strings, so transient updates do not repeatedly
 * stringify the persisted store on the renderer's interactive path. */
export function createBufferedJsonStorage<T>(
  getStorage: () => StringStorage,
  onError: (error: unknown) => void = () => {},
  delayMs = 120,
) {
  const pending = new Map<string, StorageValue<T>>()
  const saved = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    for (const [name, value] of pending) {
      try {
        const serialized = JSON.stringify(value)
        if (saved.get(name) !== serialized) getStorage().setItem(name, serialized)
        saved.set(name, serialized)
        pending.delete(name)
      } catch (error) {
        // Keep the last durable value intact and retain the new one in memory.
        // In particular, never remove a valid backup to recover from quota.
        onError(error)
      }
    }
  }
  const storage: PersistStorage<T> = {
    getItem(name) {
      if (pending.has(name)) return pending.get(name)!
      try {
        const raw = getStorage().getItem(name)
        if (raw === null) return null
        const parsed = JSON.parse(raw) as StorageValue<T>
        saved.set(name, raw)
        return parsed
      } catch (error) {
        onError(error)
        return null
      }
    },
    setItem(name, value) {
      pending.set(name, value)
      // A bounded flush interval also saves during continuous streaming.
      if (timer === undefined) timer = setTimeout(flush, delayMs)
    },
    removeItem(name) {
      try {
        getStorage().removeItem(name)
        pending.delete(name)
        saved.delete(name)
      } catch (error) { onError(error) }
    },
  }
  return { storage, flush }
}
