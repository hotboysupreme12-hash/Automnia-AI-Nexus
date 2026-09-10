# Dictation accuracy and microphone access

## Changes

- Local transcription now uses multilingual `onnx-community/whisper-base` instead of English-only `whisper-tiny.en`. WebGPU uses FP32 encoder/Q8 decoder weights, with Q8 CPU/WASM fallback for initialization or inference failures. Requests are serialized to avoid concurrent decoder state use. The WASM path uses basic graph optimization because the installed ORT extended optimizer rejects the model's merged quantized embeddings; a real CPU transcription verified this workaround.
- Thirty-second chunks with five-second overlap and up to 440 generated tokens replace 15-second chunks capped at 96 tokens. This preserves more sentence context and avoids prematurely limiting fast speech. The first model download and CPU transcription can take longer; cancellation and saved-recording retry remain available.
- Spoken-language selection applies to local and cloud transcription. When unset, local defaults to English (the installed Transformers.js implementation does not implement automatic language detection); cloud detects the language. Cloud vocabulary hints support names and technical terms, with bounded, deduplicated input. Backup/restore includes these preferences.
- Cloud dictation uses `gpt-transcribe`, the model recommended in OpenAI's file-transcription documentation checked on September 8, 2026. It requires a configured OpenAI API key, internet access, and billed API usage. Existing local/cloud preferences are preserved; no recording is automatically uploaded from local mode.
- Cloud audio is decoded, checked for silence, padded and normalized, then uploaded as 16 kHz mono PCM WAV. This also avoids provider incompatibilities with browser Ogg recordings. Uploads are larger than compressed Opus but remain below 25 MB for the five-minute recording limit.
- Quiet continuous speech is no longer rejected just because every audio frame contains speech. Extra padding preserves quiet word endings. The volume monitor no longer discards a recording before the recognizer can check it.
- New settings default to a 1.8-second end-of-speech pause and permit 15 seconds before the no-speech timeout. Existing saved pause preferences are preserved. Disable “Stop after a pause” for extended dictation with thinking pauses.
- Microphone acquisition requests mono audio and retains saved-device fallback. macOS requests native access when not yet determined, deduplicates concurrent prompts, and does not repeatedly prompt after denial. Windows checks OS permission status; Linux and browsers use `getUserMedia` and their system/browser permission flow.
- Permission recovery buttons open the exact macOS or Windows microphone privacy page. Linux/browser users receive appropriate instructions. Native IPC is restricted to the trusted app renderer. Only microphone access is requested; the existing macOS usage description and audio-input entitlement are retained.
- Cloud cancellation propagates to the upstream request. Browser CORS permits the new speech preference headers.

## Suggested setup

In Settings → Voice, select the microphone and use Test microphone to listen to playback. Select the language you speak. Use Cloud for the recommended OpenAI transcription model and optionally enter a short list of names or technical terms. Local remains available after its one-time download. Set a longer pause or use manual stop if you pause while thinking.

If macOS access was denied, enable Automnia under System Settings → Privacy & Security → Microphone, then quit and reopen it. Development builds may appear as Electron. On Windows enable both microphone access and desktop-app access. Managed-device restrictions require administrator intervention.

## Verification and limits

Focused regression tests cover audio preparation, quiet continuous speech, WAV encoding, permission prompts/denial/settings links, local cancellation/deadlines, cloud upload validation/cancellation/vocabulary, and preference migration/backup. All 27 focused tests passed, along with type checks, targeted lint, diff whitespace checks, and the client/server production build. A 12.2-second generated English recording was transcribed end-to-end through the production Electron worker on both WebGPU and WASM. The GPU run retained the passage but misheard one phrase; the CPU run preserved the spoken wording. These were setup-inclusive smoke runs, not representative latency or accuracy benchmarks. The broad UI smoke check passed desktop/wide layouts but failed its mobile layout check with 192 pixels of horizontal overflow; that separate layout issue remains. Native OS permission dialogs still need acceptance testing on signed macOS, Windows, and Linux packages; mocked platform tests cannot establish that a particular user's OS settings or microphone hardware work.

Accuracy depends on the microphone, room, language, accent, and content. These changes do not establish a numerical 10× improvement or parity with ChatGPT dictation. Measure word error rate and transcription latency on representative consenting recordings before making such a claim. A generated-voice smoke test can establish that the engine runs, but cannot substitute for that evaluation.

## Research

- [OpenAI file transcription and context hints](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI GPT-Transcribe model](https://developers.openai.com/api/docs/models/gpt-transcribe)
- [Whisper Base ONNX model](https://huggingface.co/onnx-community/whisper-base)
- [Transformers.js speech pipelines](https://huggingface.co/docs/transformers.js/api/pipelines)
- [Electron native media permissions](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Electron session permission handlers](https://www.electronjs.org/docs/latest/api/session)
