import { isDeepStrictEqual } from 'node:util'

const snapshots = new WeakMap<object, unknown>()
const missing = Symbol('missing')

export class ConfigEditConflict extends Error {
  readonly status = 409
  readonly code = 'resource_conflict'
  constructor() { super('Configuration changed while this edit was being saved. Reload the settings and retry.'); this.name = 'ConfigEditConflict' }
}

export function rememberConfigSnapshot<T extends object>(config: T, base: unknown = config): T {
  snapshots.set(config, structuredClone(base))
  return config
}

export function configSnapshot(config: object): unknown { return snapshots.get(config) }

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function keyedArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every((row) => object(row) && typeof row.id === 'string')
    && new Set(value.map((row) => row.id)).size === value.length
}

/** Apply only the caller's changed fields to the latest disk revision. */
export function mergeConfigEdit(base: unknown, desired: unknown, current: unknown): unknown {
  if (isDeepStrictEqual(desired, base)) return current
  if (isDeepStrictEqual(current, base) || isDeepStrictEqual(desired, current)) return desired
  if (object(base) && object(desired) && object(current)) {
    const result: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(base), ...Object.keys(desired), ...Object.keys(current)])) {
      const value = mergeConfigEdit(
        Object.hasOwn(base, key) ? base[key] : missing,
        Object.hasOwn(desired, key) ? desired[key] : missing,
        Object.hasOwn(current, key) ? current[key] : missing,
      )
      if (value !== missing) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  if (keyedArray(base) && keyedArray(desired) && keyedArray(current)) {
    const before = new Map(base.map((row) => [row.id, row]))
    const after = new Map(desired.map((row) => [row.id, row]))
    const disk = new Map(current.map((row) => [row.id, row]))
    // Reorders carry meaning (for example the primary agent). If both editors
    // reorder the same surviving entries differently, ask for a reload.
    const retained = new Set(base.map((row) => row.id).filter((id) => after.has(id) && disk.has(id)))
    const order = (rows: typeof base) => rows.map((row) => row.id).filter((id) => retained.has(id))
    const originalOrder = order(base), desiredOrder = order(desired), currentOrder = order(current)
    const reordered = !isDeepStrictEqual(originalOrder, desiredOrder)
    if (reordered && !isDeepStrictEqual(originalOrder, currentOrder) && !isDeepStrictEqual(desiredOrder, currentOrder)) throw new ConfigEditConflict()
    const ids = new Set([...(reordered ? after : disk).keys(), ...(reordered ? disk : after).keys(), ...before.keys()])
    const result: unknown[] = []
    for (const id of ids) {
      const value = mergeConfigEdit(before.get(id) ?? missing, after.get(id) ?? missing, disk.get(id) ?? missing)
      if (value !== missing) result.push(value)
    }
    return result
  }
  // Scalars and unkeyed arrays are indivisible edits; guessing would lose data.
  throw new ConfigEditConflict()
}
