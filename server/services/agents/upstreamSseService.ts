export type UpstreamSseFrame = { event?: string; data: string }

function parseFrames(buffer: string): { frames: UpstreamSseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: UpstreamSseFrame[] = []
  let cursor = 0
  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break
    const rawFrame = normalized.slice(cursor, boundary)
    cursor = boundary + 2
    const dataLines: string[] = []
    let event: string | undefined
    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest: normalized.slice(cursor) }
}

export async function readUpstreamSse(
  response: Response,
  onFrame: (frame: UpstreamSseFrame) => void | false,
  maxFrameChars = 1_000_000,
  maxStreamChars = 4_000_000,
) {
  if (!response.body) throw new Error('Streaming response did not include a body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reachedEof = false
  let receivedChars = 0
  const deliver = (frames: UpstreamSseFrame[]) => {
    for (const frame of frames) {
      if (frame.data.length > maxFrameChars) throw new Error(`Streaming response frame exceeded ${maxFrameChars} chars.`)
      if (frame.data.trim() === '[DONE]') return 'done' as const
      if (onFrame(frame) === false) return 'handler' as const
    }
    return true
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        reachedEof = true
        break
      }
      const decoded = decoder.decode(value, { stream: true })
      receivedChars += decoded.length
      if (receivedChars > maxStreamChars) throw new Error(`Streaming response exceeded the ${maxStreamChars}-character safety limit.`)
      buffer += decoded
      const parsed = parseFrames(buffer)
      buffer = parsed.rest
      if (buffer.length > maxFrameChars) throw new Error(`Streaming response frame exceeded ${maxFrameChars} chars without an SSE boundary.`)
      const terminal = deliver(parsed.frames)
      if (terminal !== true) return terminal
    }
    buffer += decoder.decode()
    const terminal = deliver(parseFrames(`${buffer}\n\n`).frames)
    return terminal === true ? 'eof' as const : terminal
  } finally {
    try {
      if (!reachedEof) await reader.cancel().catch(() => undefined)
    } finally {
      reader.releaseLock()
    }
  }
}

export async function readCompatibleSseCompletion(
  response: Response,
  emitText: (text: string) => void,
  maxOutputChars = 256_000,
) {
  let content = ''
  let reasoningContent = ''
  let completed = false
  const terminal = await readUpstreamSse(response, (frame) => {
    let payload: {
      error?: { message?: string } | string
      choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string | null }>
    } | null
    try {
      payload = JSON.parse(frame.data)
    } catch {
      return
    }
    if (!payload || typeof payload !== 'object') return
    if (payload.error || frame.event === 'error') {
      const detail = typeof payload.error === 'string' ? payload.error : payload.error?.message
      throw new Error(detail || 'Provider reported a streaming error.')
    }
    const choice = payload.choices?.[0]
    const reasoning = typeof choice?.delta?.reasoning_content === 'string' ? choice.delta.reasoning_content : ''
    const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : ''
    if (content.length + reasoningContent.length + text.length + reasoning.length > maxOutputChars) {
      throw new Error(`Provider response exceeded the ${maxOutputChars}-character output limit.`)
    }
    reasoningContent += reasoning
    content += text
    if (text) emitText(text)
    if (choice?.finish_reason) completed = true
  })
  if (!completed && terminal !== 'done') throw new Error('Provider stream ended before confirming completion. Retry the request.')
  if (!content.trim()) throw new Error('Provider completed without an answer. Retry the request.')
  return { content, ...(reasoningContent ? { reasoningContent } : {}) }
}
