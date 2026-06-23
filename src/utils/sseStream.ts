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

  const push = (chunk: string) => {
    buffer = `${buffer}${chunk}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const frames: SseFrame[] = []

    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let event = 'message'
      const data: string[] = []

      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim() || 'message'
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }

      if (data.length) frames.push({ event, data: data.join('\n') })
    }

    return frames
  }

  return {
    push,
    flush: () => push('\n\n'),
  }
}

