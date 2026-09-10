/** Native permission handling. Chromium still owns getUserMedia on every platform. */
function createMicrophonePermissions({ platform, systemPreferences, shell }) {
  let pendingRequest = null
  const status = () => {
    const state = platform === 'darwin' || platform === 'win32'
      ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown'
    return { status: state, platform }
  }
  const request = async () => {
    const current = status()
    if (platform !== 'darwin' || current.status !== 'not-determined') return current
    if (!pendingRequest) {
      pendingRequest = systemPreferences.askForMediaAccess('microphone')
        .then((granted) => ({ status: granted ? 'granted' : 'denied', platform }))
        .finally(() => { pendingRequest = null })
    }
    return pendingRequest
  }
  const openSettings = async () => {
    const url = platform === 'darwin'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
      : platform === 'win32' ? 'ms-settings:privacy-microphone' : null
    if (!url) return false
    await shell.openExternal(url)
    return true
  }
  return { status, request, openSettings }
}
module.exports = { createMicrophonePermissions }
