/** Keep Chromium focus in sync with native activation and renderer navigation. */
function bindWindowFocus(win) {
  // BrowserWindow.webContents throws once the native window has been destroyed.
  // Retain the original EventEmitter so the closed handler never dereferences
  // an already-destroyed BrowserWindow during update restarts or normal quits.
  const contents = win.webContents
  const focusContents = () => {
    if (win.isDestroyed() || !win.isVisible() || !win.isFocused() || contents.isDestroyed()) return
    contents.focus()
    contents.invalidate?.()
  }
  win.on('focus', focusContents)
  contents.on('dom-ready', focusContents)
  contents.on('did-finish-load', focusContents)
  win.once('closed', () => {
    win.removeListener('focus', focusContents)
    contents.removeListener('dom-ready', focusContents)
    contents.removeListener('did-finish-load', focusContents)
  })
}

function presentWindow(win, app, platform = process.platform) {
  if (!win || win.isDestroyed()) return
  win.setSkipTaskbar(false)
  if (win.isMinimized()) win.restore()
  // Make the native window available before asking macOS to activate it.
  win.show()
  if (platform === 'darwin') app.focus({ steal: true })
  win.focus()
  // An already-focused window won't emit another native focus event.
  if (win.isFocused() && !win.webContents.isDestroyed()) {
    win.webContents.focus()
    win.webContents.invalidate?.()
  }
}

module.exports = { bindWindowFocus, presentWindow }
