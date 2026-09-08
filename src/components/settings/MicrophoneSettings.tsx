import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyMicrophoneError, preferredRecordingMimeType, requestSpeechMicrophone } from '../../speech/audioCapture'
import type { SpeechSettings } from '../../speech/speechSettings'

export function MicrophoneSettings({ settings, onChange }: { settings: SpeechSettings; onChange: (deviceId: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [running, setRunning] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [notice, setNotice] = useState('')
  const [playbackUrl, setPlaybackUrl] = useState('')
  const generation = useRef(0)
  const stopRef = useRef<() => void>(() => undefined)
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')) }
    catch (error) { setNotice(friendlyMicrophoneError(error)) }
  }, [])
  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => { generation.current += 1; stopRef.current(); navigator.mediaDevices?.removeEventListener('devicechange', refresh) }
  }, [refresh])
  useEffect(() => () => { if (playbackUrl) URL.revokeObjectURL(playbackUrl) }, [playbackUrl])

  const test = async () => {
    if (running || requesting) return
    const revision = ++generation.current
    setRequesting(true)
    setNotice('Allow microphone access to record an eight-second local test.')
    setPlaybackUrl('')
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    try {
      const result = await requestSpeechMicrophone(settings)
      stream = result.stream
      if (revision !== generation.current) { stream.getTracks().forEach((track) => track.stop()); return }
      if (typeof MediaRecorder === 'undefined' || !window.AudioContext) throw new Error('Local microphone testing is unavailable on this device.')
      context = new AudioContext()
      await context.resume()
      if (revision !== generation.current) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return }
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const mimeType = preferredRecordingMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      let frame = 0
      let timer = 0
      let stopped = false
      const audioContext = context
      const audioStream = stream
      const stop = () => {
        if (stopped) return
        stopped = true
        cancelAnimationFrame(frame)
        window.clearTimeout(timer)
        if (recorder.state !== 'inactive') recorder.stop()
        audioStream.getTracks().forEach((track) => track.stop())
        void audioContext.close().catch(() => undefined)
        if (revision === generation.current) { setRunning(false); setLevel(0) }
      }
      stopRef.current = stop
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        if (revision !== generation.current) return
        if (chunks.length) { setPlaybackUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }))); setNotice('Test complete. Play it back to check your microphone. Audio stays on this device.') }
        else setNotice('No audio was captured. Check the microphone and try again.')
      }
      recorder.onerror = () => { stop(); setNotice('The microphone test was interrupted. Try again.') }
      stream.getAudioTracks().forEach((track) => { track.onended = stop })
      const samples = new Uint8Array(analyser.fftSize)
      const measure = () => {
        if (stopped) return
        analyser.getByteTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length)
        setLevel(Math.min(100, Math.round(rms * 400)))
        frame = requestAnimationFrame(measure)
      }
      recorder.start()
      setRunning(true)
      setNotice(result.usedFallback ? 'Preferred microphone is unavailable. Testing the system default; your preference is saved.' : 'Recording locally for eight seconds. Speak normally, then play back the test.')
      measure()
      timer = window.setTimeout(stop, 8_000)
      void refresh()
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (context && context.state !== 'closed') void context.close().catch(() => undefined)
      if (revision === generation.current) { setNotice(friendlyMicrophoneError(error)); setRunning(false) }
    } finally { if (revision === generation.current) setRequesting(false) }
  }
  const missing = Boolean(settings.microphoneDeviceId && !devices.some((device) => device.deviceId === settings.microphoneDeviceId))
  return <div className="space-y-3">
    <label className="dui-settings-field"><span><strong>Input device</strong><small>Used for tests and future voice recordings.</small></span><div className="dui-settings-control">
      <select value={settings.microphoneDeviceId || ''} disabled={running || requesting} onChange={(event) => onChange(event.target.value)}>
        <option value="">System default microphone</option>
        {missing && <option value={settings.microphoneDeviceId}>Saved microphone · currently unavailable</option>}
        {devices.filter((device) => device.deviceId && device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
      </select>
    </div></label>
    {missing && <p className="text-sm text-amber-200">The saved microphone is unavailable or needs permission. Voice recording will use the system default when the device cannot be opened.</p>}
    <div className="dui-settings-actions"><button type="button" disabled={requesting || !navigator.mediaDevices?.getUserMedia} onClick={() => running ? stopRef.current() : void test()}>{requesting ? 'Waiting for microphone…' : running ? 'Stop test' : 'Test microphone'}</button><button type="button" onClick={() => void refresh()}>Refresh devices</button></div>
    {running && <label className="flex flex-wrap items-center gap-3 text-sm text-slate-300">Input level <meter className="min-w-0 flex-1" min={0} max={100} value={level} aria-label="Microphone input level" /></label>}
    {notice && <p role="status" className="text-sm text-slate-300">{notice}</p>}
    {playbackUrl && <audio className="w-full" controls src={playbackUrl} aria-label="Local microphone test playback" />}
  </div>
}
