type MicrophoneAccess = { status: string; platform: string }
type MicrophoneBridge = {
  requestMicrophoneAccess?: () => Promise<MicrophoneAccess>
  openMicrophoneSettings?: () => Promise<boolean>
}
function desktopBridge(): MicrophoneBridge | undefined {
  return typeof window === 'undefined' ? undefined
    : (window as Window & { automniaDesktop?: MicrophoneBridge }).automniaDesktop
}
export async function ensureMicrophonePermission(): Promise<void> {
  const result = await desktopBridge()?.requestMicrophoneAccess?.()
  if (result?.status === 'denied' || result?.status === 'restricted') {
    throw new DOMException(microphonePermissionHelp(result.platform), 'NotAllowedError')
  }
}
export function microphonePermissionHelp(platform?: string): string {
  const os = platform || (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (/darwin|Mac/i.test(os)) return 'Microphone access is blocked. Open System Settings → Privacy & Security → Microphone, enable Automnia (Electron during development), then quit and reopen the app. Managed devices may require an administrator.'
  if (/win32|Windows/i.test(os)) return 'Microphone access is blocked. Open Settings → Privacy & security → Microphone. Enable microphone access and access for desktop apps, then retry. In a browser, also allow this site to use the microphone.'
  return 'Microphone access is blocked. Allow the microphone in your browser site permissions and system sound/privacy settings. For sandboxed Linux apps, also check the package microphone permission, then retry.'
}
export async function openMicrophoneSettings(): Promise<string> {
  const opened = await desktopBridge()?.openMicrophoneSettings?.()
  return opened ? `${microphonePermissionHelp()} Return here and test the microphone after enabling it.` : microphonePermissionHelp()
}
