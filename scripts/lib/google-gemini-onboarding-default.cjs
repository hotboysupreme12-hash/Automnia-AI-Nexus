const DEFAULT_MODEL = 'google/gemini-4-hydrogen'
const OLD_DEFAULT = 'const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-4-argon";'
const NEW_DEFAULT = `const GOOGLE_GEMINI_DEFAULT_MODEL = "${DEFAULT_MODEL}";`
const OLD_NOOP = '=== "google/gemini-4-argon" && !hasRetiredGeminiDefaultModelRefs(e)'
const NEW_NOOP = `=== "${DEFAULT_MODEL}" && !hasRetiredGeminiDefaultModelRefs(e)`

function patchGoogleGeminiOnboardingDefault(source) {
  if (typeof source !== 'string') throw new TypeError('Google onboarding source must be text.')
  if (source.includes(NEW_DEFAULT) && source.includes(NEW_NOOP)) return source
  if (!source.includes(OLD_DEFAULT) || !source.includes(OLD_NOOP)) {
    throw new Error('Google onboarding default contract changed; refusing to select an unexpected model.')
  }
  return source.replace(OLD_DEFAULT, NEW_DEFAULT).replace(OLD_NOOP, NEW_NOOP)
}

module.exports = { DEFAULT_MODEL, patchGoogleGeminiOnboardingDefault }
