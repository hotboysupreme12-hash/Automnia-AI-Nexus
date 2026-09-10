import { ensureMicrophonePermission, microphonePermissionHelp } from './microphonePermissions'
import { LOCAL_TRANSCRIPTION_SAMPLE_RATE } from './audioProcessing'
import type { SpeechSettings } from './speechSettings'

export { LOCAL_TRANSCRIPTION_SAMPLE_RATE, prepareAudioForSpeechRecognition } from './audioProcessing'
export type { PreparedSpeechAudio } from './audioProcessing'

export const MAX_VOICE_RECORDING_MS = 2 * 60 * 1000

export async function requestSpeechMicrophone(settings: SpeechSettings, mediaDevices = navigator.mediaDevices): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  if (!mediaDevices?.getUserMedia) throw new Error('Microphone recording is not available on this device.')
  await ensureMicrophonePermission()
  const audio: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
    ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
  }
  try { return { stream: await mediaDevices.getUserMedia({ audio }), usedFallback: false } }
  catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (!settings.microphoneDeviceId || !['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'].includes(name)) throw error
    delete audio.deviceId
    return { stream: await mediaDevices.getUserMedia({ audio }), usedFallback: true }
  }
}

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
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return microphonePermissionHelp()
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect one or select an input device in system settings.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is busy in another app or unavailable to Automnia.'
  }
  return error instanceof Error ? error.message : 'Could not start the microphone.'
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
    return new Float32Array(rendered.getChannelData(0))
  } finally {
    await decodeContext.close().catch(() => undefined)
  }
}
