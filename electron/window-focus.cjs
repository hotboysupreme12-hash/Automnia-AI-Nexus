/** Keep Chromium focus in sync with native activation and renderer navigation. */
function bindWindowFocus(win) {
  const focusContents = () => {
    if (win.isDestroyed() || !win.isVisible() || !win.isFocused() || win.webContents.isDestroyed()) return
    win.webContents.focus()
    win.webContents.invalidate?.()
  }
  win.on('focus', focusContents)
  win.webContents.on('dom-ready', focusContents)
  win.webContents.on('did-finish-load', focusContents)
  win.once('closed', () => {
    win.removeListener('focus', focusContents)
    win.webContents.removeListener('dom-ready', focusContents)
    win.webContents.removeListener('did-finish-load', focusContents)
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
