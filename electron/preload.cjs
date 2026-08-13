const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('automniaDesktop', {
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
