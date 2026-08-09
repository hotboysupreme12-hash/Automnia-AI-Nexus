export const LOCAL_TRANSCRIPTION_SAMPLE_RATE = 16_000
export const MAX_VOICE_RECORDING_MS = 2 * 60 * 1000

const SPEECH_FRAME_MS = 20
const SPEECH_PADDING_MS = 240
const MIN_VOICED_AUDIO_MS = 160

const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

export function preferredRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ''
}

export function voiceRecordingFileName(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('ogg')) return 'voice-input.ogg'
  if (normalized.includes('mp4')) return 'voice-input.m4a'
  if (normalized.includes('wav')) return 'voice-input.wav'
  return 'voice-input.webm'
}

export function friendlyMicrophoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow microphone access for Automnia, then try again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect one or select an input device in system settings.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is busy in another app or unavailable to Automnia.'
  }
  return error instanceof Error ? error.message : 'Could not start the microphone.'
}

export type PreparedSpeechAudio = {
  audio: Float32Array
  gain: number
  peak: number
  voicedMs: number
}

function frameRootMeanSquare(audio: Float32Array, start: number, end: number): number {
  let sumSquares = 0
  for (let index = start; index < end; index += 1) {
    const sample = Number.isFinite(audio[index]) ? audio[index] : 0
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / Math.max(1, end - start))
}

export function prepareAudioForSpeechRecognition(
  input: Float32Array,
  sampleRate = LOCAL_TRANSCRIPTION_SAMPLE_RATE,
): PreparedSpeechAudio {
  if (input.length < Math.floor(sampleRate * 0.25)) {
    throw new Error('The recording was too short to recognize. Speak for a moment, then pause.')
  }

  const frameSize = Math.max(1, Math.round(sampleRate * SPEECH_FRAME_MS / 1000))
  const frameLevels: number[] = []
  let peak = 0
  for (let start = 0; start < input.length; start += frameSize) {
    const end = Math.min(input.length, start + frameSize)
    frameLevels.push(frameRootMeanSquare(input, start, end))
    for (let index = start; index < end; index += 1) {
      const sample = Number.isFinite(input[index]) ? Math.abs(input[index]) : 0
      if (sample > peak) peak = sample
    }
  }

  const orderedLevels = [...frameLevels].sort((left, right) => left - right)
  const noiseFloor = orderedLevels[Math.floor(orderedLevels.length * 0.2)] || 0
  let voiceThreshold = Math.max(0.006, Math.min(0.04, noiseFloor * 2.8))
  let voicedFrames = frameLevels
    .map((level, index) => level >= voiceThreshold ? index : -1)
    .filter((index) => index >= 0)

  if (!voicedFrames.length && peak >= 0.018) {
    voiceThreshold = Math.max(0.004, Math.min(0.025, noiseFloor * 1.7))
    voicedFrames = frameLevels
      .map((level, index) => level >= voiceThreshold ? index : -1)
      .filter((index) => index >= 0)
  }

  const voicedMs = voicedFrames.length * SPEECH_FRAME_MS
  if (peak < 0.008 || voicedMs < MIN_VOICED_AUDIO_MS) {
    throw new Error('The microphone did not capture clear speech. Check the selected input and speak a little closer.')
  }

  const paddingFrames = Math.ceil(SPEECH_PADDING_MS / SPEECH_FRAME_MS)
  const firstFrame = Math.max(0, voicedFrames[0] - paddingFrames)
  const lastFrame = Math.min(frameLevels.length - 1, voicedFrames.at(-1)! + paddingFrames)
  const startSample = firstFrame * frameSize
  const endSample = Math.min(input.length, (lastFrame + 1) * frameSize)
  const trimmed = input.subarray(startSample, endSample)

  let mean = 0
  for (const sample of trimmed) mean += Number.isFinite(sample) ? sample : 0
  mean /= Math.max(1, trimmed.length)
  const gain = peak < 0.72 ? Math.min(8, 0.72 / Math.max(peak, 0.001)) : 1
  const normalized = new Float32Array(trimmed.length)
  for (let index = 0; index < trimmed.length; index += 1) {
    const centered = (Number.isFinite(trimmed[index]) ? trimmed[index] : 0) - mean
    normalized[index] = Math.max(-1, Math.min(1, centered * gain))
  }

  return { audio: normalized, gain, peak, voicedMs }
}

export async function decodeAudioToMono16Khz(blob: Blob): Promise<Float32Array> {
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) throw new Error('Audio decoding is not available on this device.')

  const decodeContext = new AudioContextConstructor()
  try {
    const encoded = await blob.arrayBuffer()
    const decoded = await decodeContext.decodeAudioData(encoded.slice(0))
    const frameCount = Math.max(1, Math.ceil(decoded.duration * LOCAL_TRANSCRIPTION_SAMPLE_RATE))
    const renderContext = new OfflineAudioContext(1, frameCount, LOCAL_TRANSCRIPTION_SAMPLE_RATE)
    const source = renderContext.createBufferSource()
    source.buffer = decoded
    source.connect(renderContext.destination)
    source.start()
    const rendered = await renderContext.startRendering()
    return prepareAudioForSpeechRecognition(new Float32Array(rendered.getChannelData(0))).audio
  } finally {
    await decodeContext.close().catch(() => undefined)
  }
}
