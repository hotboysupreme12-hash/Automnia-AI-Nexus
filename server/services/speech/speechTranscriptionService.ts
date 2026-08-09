export const ONLINE_SPEECH_MODEL = 'gpt-4o-mini-transcribe'
export const ONLINE_SPEECH_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024

export type SpeechTranscriptionService = ReturnType<typeof createSpeechTranscriptionService>

type SpeechTranscriptionServiceOptions = {
  fetch?: typeof fetch
  resolveOpenAiApiKey: () => Promise<string>
}

export class SpeechTranscriptionError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'SpeechTranscriptionError'
    this.statusCode = statusCode
  }
}

function audioFileName(mimeType: string, requestedName?: string) {
  const safeRequestedName = requestedName?.trim().replace(/[^a-zA-Z0-9._-]/g, '_')
  if (safeRequestedName && /\.(?:flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i.test(safeRequestedName)) {
    return safeRequestedName
  }
  if (mimeType.includes('ogg')) return 'voice-input.ogg'
  if (mimeType.includes('mp4')) return 'voice-input.m4a'
  if (mimeType.includes('wav')) return 'voice-input.wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'voice-input.mp3'
  return 'voice-input.webm'
}

async function upstreamErrorMessage(response: Response) {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    // Use a stable status-only message for non-JSON upstream failures.
  }
  return `OpenAI transcription returned HTTP ${response.status}.`
}

export function createSpeechTranscriptionService(options: SpeechTranscriptionServiceOptions) {
  const fetchImpl = options.fetch ?? fetch

  async function transcribeOnline(input: { bytes: Buffer; mimeType: string; fileName?: string }) {
    if (!input.bytes.length) throw new SpeechTranscriptionError('The voice recording was empty.', 400)
    if (input.bytes.length > ONLINE_SPEECH_UPLOAD_LIMIT_BYTES) {
      throw new SpeechTranscriptionError('The voice recording is too large. Keep voice input under two minutes.', 413)
    }

    const apiKey = (await options.resolveOpenAiApiKey()).trim()
    if (!apiKey) {
      throw new SpeechTranscriptionError('Online voice input needs an OpenAI API key. Add one in Provider Auth or switch voice input back to Local.', 409)
    }

    const mimeType = input.mimeType.split(';')[0]?.trim().toLowerCase() || 'audio/webm'
    const form = new FormData()
    form.set('model', ONLINE_SPEECH_MODEL)
    form.set('response_format', 'json')
    form.set('file', new Blob([new Uint8Array(input.bytes)], { type: mimeType }), audioFileName(mimeType, input.fileName))

    const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok) {
      throw new SpeechTranscriptionError(await upstreamErrorMessage(response), response.status >= 400 && response.status < 500 ? response.status : 502)
    }

    const payload = await response.json() as { text?: unknown }
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!text) throw new SpeechTranscriptionError('Online transcription completed without recognized speech.', 422)
    return { text, model: ONLINE_SPEECH_MODEL, provider: 'openai' as const }
  }

  return { transcribeOnline }
}
