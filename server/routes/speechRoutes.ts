import express, { type Express } from 'express'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import {
  ONLINE_SPEECH_UPLOAD_LIMIT_BYTES,
  SpeechTranscriptionError,
  type SpeechTranscriptionService,
} from '../services/speech/speechTranscriptionService'

type SpeechRoutesOptions = {
  speechTranscription: SpeechTranscriptionService
  localAiAllowed?: () => boolean
}

const SPEECH_CONTENT_TYPES = [
  'audio/*',
  'application/octet-stream',
  'video/webm',
  'video/mp4',
]

export function registerSpeechRoutes(app: Express, options: SpeechRoutesOptions) {
  app.post('/api/speech/transcribe', express.raw({
    type: SPEECH_CONTENT_TYPES,
    limit: ONLINE_SPEECH_UPLOAD_LIMIT_BYTES,
  }), async (req, res) => {
    if (options.localAiAllowed?.() === false) {
      return apiFailure(res, 403, 'byok_not_allowed', 'Starter Subscription and credit-refill access cannot use local or external AI provider features.')
    }
    const controller = new AbortController()
    const cancel = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', cancel)
    try {
      let vocabulary = ''
      try { vocabulary = decodeURIComponent(req.get('x-speech-vocabulary') || '').slice(0, 1000) }
      catch { return apiFailure(res, 400, 'speech_transcription_failed', 'Invalid dictation vocabulary encoding.') }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const result = await options.speechTranscription.transcribeOnline({
        bytes,
        language: req.get('x-speech-language'),
        vocabulary,
        signal: controller.signal,
        mimeType: req.get('content-type') || 'audio/webm',
        fileName: typeof req.query.filename === 'string' ? req.query.filename : undefined,
      })
      return apiSuccess(res, result)
    } catch (error) {
      if (error instanceof SpeechTranscriptionError) {
        return apiFailure(
          res,
          error.statusCode,
          error.statusCode === 409 ? 'model_auth_required' : 'speech_transcription_failed',
          error.message,
        )
      }
      if (controller.signal.aborted) return
      return apiFailure(res, 502, 'speech_transcription_failed', 'Voice transcription could not finish. Check your connection and retry the saved recording.')
    } finally {
      res.off('close', cancel)
    }
  })
}
