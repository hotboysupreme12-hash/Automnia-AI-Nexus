const END_OF_SPEECH_SILENCE_MS = 1_150
const NO_SPEECH_TIMEOUT_MS = 8_000
const MIN_VOICE_ACTIVITY_MS = 220
const ANALYSIS_INTERVAL_MS = 45

type VoiceActivityCallbacks = {
  onLevel?: (level: number) => void
  onSpeechStart?: () => void
  onSilence: () => void
  onNoSpeech: () => void
}

export function monitorVoiceActivity(
  stream: MediaStream,
  callbacks: VoiceActivityCallbacks,
): () => void {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.12
  source.connect(analyser)

  const samples = new Float32Array(analyser.fftSize)
  const startedAt = performance.now()
  let noiseFloor = 0.004
  let speechStartedAt = 0
  let lastSpeechAt = 0
  let consecutiveSpeechFrames = 0
  let finished = false

  const finish = (callback: () => void) => {
    if (finished) return
    finished = true
    window.clearInterval(interval)
    source.disconnect()
    analyser.disconnect()
    void context.close().catch(() => undefined)
    callbacks.onLevel?.(0)
    callback()
  }

  const interval = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    let sumSquares = 0
    for (const sample of samples) sumSquares += sample * sample
    const level = Math.sqrt(sumSquares / samples.length)
    const now = performance.now()
    const threshold = Math.max(0.011, Math.min(0.05, noiseFloor * 3.2))
    const speechFrame = level >= threshold
    callbacks.onLevel?.(Math.max(0, Math.min(1, (level - noiseFloor) / 0.075)))

    if (speechFrame) {
      consecutiveSpeechFrames += 1
      lastSpeechAt = now
      if (!speechStartedAt && consecutiveSpeechFrames >= 2) {
        speechStartedAt = now - ANALYSIS_INTERVAL_MS
        callbacks.onSpeechStart?.()
      }
    } else {
      consecutiveSpeechFrames = 0
      noiseFloor = Math.max(0.001, Math.min(0.025, noiseFloor * 0.96 + level * 0.04))
    }

    if (speechStartedAt
      && lastSpeechAt - speechStartedAt >= MIN_VOICE_ACTIVITY_MS
      && now - lastSpeechAt >= END_OF_SPEECH_SILENCE_MS) {
      finish(callbacks.onSilence)
      return
    }

    if (!speechStartedAt && now - startedAt >= NO_SPEECH_TIMEOUT_MS) finish(callbacks.onNoSpeech)
  }, ANALYSIS_INTERVAL_MS)

  void context.resume().catch(() => undefined)

  return () => {
    if (finished) return
    finished = true
    window.clearInterval(interval)
    source.disconnect()
    analyser.disconnect()
    void context.close().catch(() => undefined)
    callbacks.onLevel?.(0)
  }
}
