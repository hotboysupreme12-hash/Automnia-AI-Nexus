import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Shift, StartShiftPayload } from '../../shiftContracts'
import { writeAtomicControlFile } from '../filesystem/atomicControlFile'

export type PreparedShift = { shift: Shift; args: string[] }
type Receipt = { version: 1; digest: string; state: 'pending' | 'completed'; prepared: PreparedShift; result?: Shift }
export class ShiftCreationUnconfirmed extends Error {
  readonly statusCode = 409
  constructor(message = 'Job creation is unconfirmed. Check Runtime Monitor before creating another job; retrying this same request will check for the existing job.') { super(message) }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value) || 'null'
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function createIdempotentShiftService(options: {
  directory: string
  prepare: (input: StartShiftPayload) => Promise<PreparedShift>
  dispatch: (prepared: PreparedShift) => Promise<string>
  reconcile: (prepared: PreparedShift) => Promise<string | null>
  activate: (shift: Shift) => void
}) {
  const inFlight = new Map<string, { digest: string; result: Promise<Shift> }>()
  const execute = async (file: string, digest: string, input: StartShiftPayload) => {
    await fs.mkdir(options.directory, { recursive: true })
    const read = async (): Promise<Receipt | null> => {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Receipt
        if (raw.version !== 1 || !raw.prepared?.shift?.id || !Array.isArray(raw.prepared?.args) || !['pending', 'completed'].includes(raw.state)) throw new ShiftCreationUnconfirmed()
        if (raw.digest !== digest) throw new ShiftCreationUnconfirmed('This request identifier belongs to a different job. Restore the original request or start a new job intentionally.')
        return raw
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error instanceof ShiftCreationUnconfirmed ? error : new ShiftCreationUnconfirmed() }
    }
    const finish = async (record: Receipt, cronId: string) => {
      const result = { ...record.prepared.shift, cronId }
      await writeAtomicControlFile(file, JSON.stringify({ ...record, state: 'completed', result }))
      options.activate(result)
      return result
    }
    const recover = async (record: Receipt) => {
      if (record.state === 'completed' && record.result?.cronId) return record.result
      const cronId = await options.reconcile(record.prepared).catch(() => null)
      if (!cronId) throw new ShiftCreationUnconfirmed()
      return finish(record, cronId)
    }
    const existing = await read()
    if (existing) return recover(existing)
    const prepared = await options.prepare(input)
    const record: Receipt = { version: 1, digest, state: 'pending', prepared }
    let claim
    try { claim = await fs.open(file, 'wx', 0o600) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const raced = await read()
      if (!raced) throw new ShiftCreationUnconfirmed()
      return recover(raced)
    }
    try { await claim.writeFile(JSON.stringify(record)); await claim.sync() } finally { await claim.close() }
    let cronId: string
    try { cronId = await options.dispatch(prepared) } catch {
      // The add command may have succeeded before its acknowledgement was lost.
      return recover(record)
    }
    if (!cronId) return recover(record)
    return finish(record, cronId)
  }
  return {
    create(input: StartShiftPayload): Promise<Shift> {
      const key = input.idempotencyKey || randomUUID()
      const digest = hash(canonical({ ...input, idempotencyKey: undefined }))
      const file = path.join(options.directory, `${hash(key)}.json`)
      const active = inFlight.get(file)
      if (active) return active.digest === digest ? active.result : Promise.reject(new ShiftCreationUnconfirmed('This request identifier is already creating a different job.'))
      const result = execute(file, digest, input)
      inFlight.set(file, { digest, result })
      void result.finally(() => { if (inFlight.get(file)?.result === result) inFlight.delete(file) }).catch(() => undefined)
      return result
    },
  }
}
