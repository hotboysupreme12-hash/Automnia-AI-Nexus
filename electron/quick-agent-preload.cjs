const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('automniaQuickAgent', {
  onOpen: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, context) => listener(context)
    ipcRenderer.on('automnia:quick-agent-open', wrapped)
    return () => ipcRenderer.removeListener('automnia:quick-agent-open', wrapped)
  },
  onContext: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, context) => listener(context)
    ipcRenderer.on('automnia:quick-agent-context', wrapped)
    return () => ipcRenderer.removeListener('automnia:quick-agent-context', wrapped)
  },
  onLogo: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = (_event, dataUrl) => listener(dataUrl)
    ipcRenderer.on('automnia:quick-agent-logo', wrapped)
    return () => ipcRenderer.removeListener('automnia:quick-agent-logo', wrapped)
  },
  onCollapse: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const wrapped = () => listener()
    ipcRenderer.on('automnia:quick-agent-collapse', wrapped)
    return () => ipcRenderer.removeListener('automnia:quick-agent-collapse', wrapped)
  },
  submit: (payload = {}) => ipcRenderer.invoke('automnia:quick-agent-submit', {
    prompt: typeof payload.prompt === 'string' ? payload.prompt.slice(0, 16_000) : '',
    clipboardText: typeof payload.clipboardText === 'string' ? payload.clipboardText.slice(0, 32_000) : '',
    clipboardImage: payload.clipboardImage && typeof payload.clipboardImage === 'object' ? payload.clipboardImage : null,
    attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 8) : [],
  }),
  close: () => ipcRenderer.invoke('automnia:quick-agent-close'),
  setFileDialogOpen: (open) => ipcRenderer.send('automnia:quick-agent-file-dialog', open === true),
})
