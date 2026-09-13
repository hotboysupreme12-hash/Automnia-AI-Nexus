export type DesktopUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'manual-required'
  | 'error'

export type DesktopUpdateState = {
  status: DesktopUpdateStatus
  supported: boolean
  currentVersion: string
  availableVersion: string | null
  mandatory: boolean
  autoDownload: boolean
  deferredUntil: string | null
  progressPercent: number | null
  bytesPerSecond: number | null
  transferred: number | null
  total: number | null
  releaseNotesUrl: string | null
  manualDownloadUrl: string | null
  lastCheckedAt: string | null
  error: string | null
  errorVisible: boolean
}

export const DEFAULT_DESKTOP_UPDATE_STATE: DesktopUpdateState = {
  status: 'disabled',
  supported: false,
  currentVersion: 'Development',
  availableVersion: null,
  mandatory: false,
  autoDownload: true,
  deferredUntil: null,
  progressPercent: null,
  bytesPerSecond: null,
  transferred: null,
  total: null,
  releaseNotesUrl: null,
  manualDownloadUrl: null,
  lastCheckedAt: null,
  error: 'Automatic updates are available in installed production builds.',
  errorVisible: false,
}
