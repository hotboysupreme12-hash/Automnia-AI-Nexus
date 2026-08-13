export const LOCAL_TRANSCRIPTION_SAMPLE_RATE = 16_000

const SPEECH_FRAME_MS = 20
const SPEECH_PADDING_MS = 240
const MIN_VOICED_AUDIO_MS = 160

export type PreparedSpeechAudio = {
  audio: Float32Array
  gain: number
  peak: number
  voicedMs: number
}

type VoicedFrameRange = {
  count: number
  first: number
  last: number
}

function findVoicedFrameRange(frameLevels: number[], threshold: number): VoicedFrameRange {
  let count = 0
  let first = -1
  let last = -1
  for (let index = 0; index < frameLevels.length; index += 1) {
    if (frameLevels[index] < threshold) continue
    if (first < 0) first = index
    last = index
    count += 1
  }
  return { count, first, last }
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
  const frameSums: number[] = []
  let peak = 0
  for (let start = 0; start < input.length; start += frameSize) {
    const end = Math.min(input.length, start + frameSize)
    let sumSquares = 0
    let sum = 0
    for (let index = start; index < end; index += 1) {
      let sample = input[index]
      if (!Number.isFinite(sample)) sample = 0
      const absoluteSample = sample < 0 ? -sample : sample
      if (absoluteSample > peak) peak = absoluteSample
      sumSquares += sample * sample
      sum += sample
    }
    frameLevels.push(Math.sqrt(sumSquares / Math.max(1, end - start)))
    frameSums.push(sum)
  }

  const orderedLevels = [...frameLevels].sort((left, right) => left - right)
  const noiseFloor = orderedLevels[Math.floor(orderedLevels.length * 0.2)] || 0
  let voiceThreshold = Math.max(0.006, Math.min(0.04, noiseFloor * 2.8))
  let voicedFrames = findVoicedFrameRange(frameLevels, voiceThreshold)

  if (!voicedFrames.count && peak >= 0.018) {
    voiceThreshold = Math.max(0.004, Math.min(0.025, noiseFloor * 1.7))
    voicedFrames = findVoicedFrameRange(frameLevels, voiceThreshold)
  }

  const voicedMs = voicedFrames.count * SPEECH_FRAME_MS
  if (peak < 0.008 || voicedMs < MIN_VOICED_AUDIO_MS) {
    throw new Error('The microphone did not capture clear speech. Check the selected input and speak a little closer.')
  }

  const paddingFrames = Math.ceil(SPEECH_PADDING_MS / SPEECH_FRAME_MS)
  const firstFrame = Math.max(0, voicedFrames.first - paddingFrames)
  const lastFrame = Math.min(frameLevels.length - 1, voicedFrames.last + paddingFrames)
  const startSample = firstFrame * frameSize
  const endSample = Math.min(input.length, (lastFrame + 1) * frameSize)
  const trimmed = input.subarray(startSample, endSample)

  let mean = 0
  for (let frame = firstFrame; frame <= lastFrame; frame += 1) mean += frameSums[frame]
  mean /= Math.max(1, trimmed.length)
  const gain = peak < 0.72 ? Math.min(8, 0.72 / Math.max(peak, 0.001)) : 1
  const normalized = new Float32Array(trimmed.length)
  for (let index = 0; index < trimmed.length; index += 1) {
    let sample = trimmed[index]
    if (!Number.isFinite(sample)) sample = 0
    const centered = (sample - mean) * gain
    normalized[index] = centered < -1 ? -1 : centered > 1 ? 1 : centered
  }

  return { audio: normalized, gain, peak, voicedMs }
}
