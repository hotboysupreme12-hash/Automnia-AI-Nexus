const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
})
