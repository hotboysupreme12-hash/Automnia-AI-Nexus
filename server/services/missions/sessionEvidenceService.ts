import { open } from 'node:fs/promises'

/** Read newest JSONL rows first without retaining an entire long session. */
export async function* readSessionLinesReverse(filePath: string, chunkBytes = 64 * 1024) {
  const file = await open(filePath, 'r')
  const maxLineBytes = 256 * 1024
  let pending = Buffer.alloc(0)
  let skippingOversizedRow = false
  try {
    let position = (await file.stat()).size
    while (position > 0) {
      const length = Math.min(chunkBytes, position)
      position -= length
      const chunk = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(chunk, 0, length, position)
      const data = Buffer.concat([chunk.subarray(0, bytesRead), pending])
      let end = data.length
      for (let newline = data.lastIndexOf(10, end - 1); newline >= 0; newline = newline > 0 ? data.lastIndexOf(10, newline - 1) : -1) {
        const row = data.subarray(newline + 1, end)
        if (!skippingOversizedRow && row.length > 0 && row.length <= maxLineBytes) yield row.toString('utf8')
        skippingOversizedRow = false
        end = newline
      }
      pending = Buffer.from(data.subarray(0, end))
      if (pending.length > maxLineBytes) {
        pending = Buffer.alloc(0)
        skippingOversizedRow = true
      }
    }
    if (!skippingOversizedRow && pending.length) yield pending.toString('utf8')
  } finally {
    await file.close()
  }
}
