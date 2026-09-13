import type { DesktopUpdateState } from './desktopUpdate'

type UpdatePreferences = { autoDownload: boolean }

declare global {
  interface Window {
    automniaDesktop?: {
      requestMicrophoneAccess?: () => Promise<string>
      openMicrophoneSettings?: () => Promise<boolean>
      getPathForFile?: (file: File) => string | Promise<string>
      pickDirectory?: (options?: { startPath?: string }) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string; detail?: string; path?: string | null }>
      bootstrapControlCenterSession?: () => Promise<string | null>
      updates: {
        getState: () => Promise<DesktopUpdateState>
        check: () => Promise<DesktopUpdateState>
        download: () => Promise<DesktopUpdateState>
        install: () => Promise<DesktopUpdateState>
        defer: (hours?: number) => Promise<DesktopUpdateState>
        setPreferences: (preferences: UpdatePreferences) => Promise<DesktopUpdateState>
        openReleaseNotes: () => Promise<boolean>
        openManualDownload: () => Promise<boolean>
        onState: (listener: (state: DesktopUpdateState) => void) => () => void
      }
    }
  }
}

export {}
