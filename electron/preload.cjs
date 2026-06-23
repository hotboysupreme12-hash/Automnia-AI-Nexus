const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('dystopaiDesktop', {
  getPathForFile: (file) => {
    if (!file) return ''
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file)
    }
    return typeof file.path === 'string' ? file.path : ''
  },
  pickDirectory: (options = {}) => ipcRenderer.invoke('dystopai:pick-directory', {
    startPath: typeof options.startPath === 'string' ? options.startPath : '',
  }),
})
