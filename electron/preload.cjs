const { contextBridge, ipcRenderer, webUtils } = require('electron')
const supportsMainIpcV2 = process.argv.includes('--automnia-main-ipc-v2')

if (process.env.AUTOMNIA_ELECTRON_E2E_SCREENSHOT_DIR && process.env.CONTROL_CENTER_TOKEN) {
  try {
    localStorage.setItem('control-center-token', process.env.CONTROL_CENTER_TOKEN)
    sessionStorage.removeItem('control-center-token')
    sessionStorage.removeItem('control-center-signed-out')
    localStorage.removeItem('control-center-signed-out')
  } catch {
    // Screenshot E2E falls back to the main-process bootstrap if storage is unavailable.
  }
}

contextBridge.exposeInMainWorld('automniaDesktop', {
  ...(supportsMainIpcV2 ? { copyText: (text) => ipcRenderer.invoke('automnia:copy-text', text) } : {}),
  requestMicrophoneAccess: () => ipcRenderer.invoke('automnia:microphone-request'),
  openMicrophoneSettings: () => ipcRenderer.invoke('automnia:microphone-settings'),
  getPathForFile: (file) => {
    if (!file) return ''
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file)
    }
    return typeof file.path === 'string' ? file.path : ''
  },
  pickDirectory: (options = {}) => ipcRenderer.invoke('automnia:pick-directory', {
    startPath: typeof options.startPath === 'string' ? options.startPath : '',
  }),
  bootstrapControlCenterSession: () => ipcRenderer.invoke('automnia:bootstrap-control-center-session'),
  ...(supportsMainIpcV2 ? { cursorAgent: {
    setSettings: (settings = {}) => ipcRenderer.invoke('automnia:cursor-agent-set-settings', {
      enabled: settings.enabled === true,
      agentId: typeof settings.agentId === 'string' ? settings.agentId : '',
      agentName: typeof settings.agentName === 'string' ? settings.agentName : '',
      includeClipboard: settings.includeClipboard !== false,
    }),
  } } : {}),
  ...(supportsMainIpcV2 ? { quickAgentRuntime: {
    onSubmit: (listener) => {
      if (typeof listener !== 'function') return () => {}
      const wrapped = (_event, request) => listener(request)
      ipcRenderer.on('automnia:quick-agent-submit', wrapped)
      return () => ipcRenderer.removeListener('automnia:quick-agent-submit', wrapped)
    },
    complete: (requestId, result = {}) => ipcRenderer.send('automnia:quick-agent-complete', {
      requestId: typeof requestId === 'string' ? requestId : '',
      ok: result.ok === true,
      message: typeof result.message === 'string' ? result.message.slice(0, 500) : '',
    }),
  } } : {}),
  updates: {
    getState: () => ipcRenderer.invoke('automnia:update-get-state'),
    check: () => ipcRenderer.invoke('automnia:update-check'),
    download: () => ipcRenderer.invoke('automnia:update-download'),
    install: () => ipcRenderer.invoke('automnia:update-install'),
    defer: (hours = 24) => ipcRenderer.invoke('automnia:update-defer', hours),
    setPreferences: (preferences = {}) => ipcRenderer.invoke('automnia:update-set-preferences', {
      autoDownload: preferences.autoDownload === true,
    }),
    openReleaseNotes: () => ipcRenderer.invoke('automnia:update-open-release-notes'),
    openManualDownload: () => ipcRenderer.invoke('automnia:update-open-manual-download'),
    onState: (listener) => {
      if (typeof listener !== 'function') return () => {}
      const wrapped = (_event, state) => listener(state)
      ipcRenderer.on('automnia:update-state', wrapped)
      return () => ipcRenderer.removeListener('automnia:update-state', wrapped)
    },
  },
})
