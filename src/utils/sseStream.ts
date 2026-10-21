export type SseFrame = {
  event: string
  data: string
}

export type SseFrameParser = {
  push: (chunk: string) => SseFrame[]
  flush: () => SseFrame[]
}

export function createSseFrameParser(): SseFrameParser {
  let buffer = ''
  let pendingCr = false

  const consume = (chunk: string, flush = false) => {
    const combined = pendingCr ? `\r${chunk}` : chunk
    pendingCr = !flush && combined.endsWith('\r')
    const ready = pendingCr ? combined.slice(0, -1) : combined
    buffer += ready.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const frames: SseFrame[] = []
    let cursor = 0

    while (true) {
      const boundary = buffer.indexOf('\n\n', cursor)
      if (boundary === -1) break
      const raw = buffer.slice(cursor, boundary)
      cursor = boundary + 2
      let event = 'message'
      const data: string[] = []

      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim() || 'message'
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }

      if (data.length) frames.push({ event, data: data.join('\n') })
    }

    if (cursor > 0) buffer = buffer.slice(cursor)
    return frames
  }

  return {
    push: (chunk: string) => consume(chunk, false),
    flush: () => consume('\n\n', true),
  }
}

