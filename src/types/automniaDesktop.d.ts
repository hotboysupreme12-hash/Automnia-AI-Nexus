import type { DesktopUpdateState } from './desktopUpdate'

type UpdatePreferences = { autoDownload: boolean }
type CursorAgentDesktopSettings = { enabled: boolean; agentId: string; agentName?: string; includeClipboard: boolean }
type CursorAgentDesktopStatus = { ok: boolean; supported: boolean; enabled: boolean; message?: string }
type QuickAgentAttachmentPayload = { name: string; mimeType: string; size: number; data: ArrayBuffer }
type QuickAgentClipboardContext = {
  agentName?: string
  text?: string
  textSource?: 'clipboard' | 'selection' | 'selection+clipboard'
  image?: QuickAgentAttachmentPayload
  attachments?: QuickAgentAttachmentPayload[]
  popupOrigin?: { x: string; y: string }
  contextPending?: boolean
  message?: string
}
type QuickAgentSubmitRequest = {
  requestId: string
  agentId: string
  agentName: string
  prompt: string
  clipboardText?: string
  attachments: QuickAgentAttachmentPayload[]
}

declare global {
  interface Window {
    automniaDesktop?: {
      copyText?: (text: string) => Promise<void>
      requestMicrophoneAccess?: () => Promise<string>
      openMicrophoneSettings?: () => Promise<boolean>
      getPathForFile?: (file: File) => string | Promise<string>
      pickDirectory?: (options?: { startPath?: string }) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string; detail?: string; path?: string | null }>
      bootstrapControlCenterSession?: () => Promise<string | null>
      cursorAgent?: {
        setSettings: (settings: CursorAgentDesktopSettings) => Promise<CursorAgentDesktopStatus>
      }
      quickAgentRuntime?: {
        onSubmit: (listener: (request: QuickAgentSubmitRequest) => void) => () => void
        complete: (requestId: string, result: { ok: boolean; message?: string }) => void
      }
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
    automniaQuickAgent?: {
      onOpen: (listener: (context: QuickAgentClipboardContext) => void) => () => void
      onContext: (listener: (context: QuickAgentClipboardContext) => void) => () => void
      onLogo: (listener: (dataUrl: string) => void) => () => void
      onCollapse: (listener: () => void) => () => void
      submit: (payload: { prompt: string; clipboardText?: string; clipboardImage?: QuickAgentAttachmentPayload; attachments: QuickAgentAttachmentPayload[] }) => Promise<{ ok: boolean; message?: string }>
      close: () => Promise<boolean>
      setFileDialogOpen: (open: boolean) => void
    }
  }
}

export {}
