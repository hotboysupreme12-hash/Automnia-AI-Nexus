// Exercise native Electron activation without clicking away or test-time refocusing.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { bindWindowFocus, presentWindow } = require('../electron/window-focus.cjs')
const timeout = setTimeout(() => { console.error('Startup focus timed out'); app.exit(1) }, 15000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, acceptFirstMouse: true, webPreferences: { sandbox: true } })
  bindWindowFocus(win)
  win.once('ready-to-show', () => presentWindow(win, app))
  await win.loadURL('data:text/html,<button id="test" onclick="this.textContent=\'clicked\'" style="position:absolute;left:0;top:0;width:200px;height:100px">Click</button>')
  // Observe eventual native activation; do not focus or activate from the test.
  let focused = false
  for (let i = 0; i < 50; i++) {
    focused = await win.webContents.executeJavaScript('document.hasFocus()')
    if (focused) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(focused, true, 'document must have focus on launch')
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 50, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 50, button: 'left', clickCount: 1 })
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("button").textContent'), 'clicked')
  console.log('PASS: native launch focus and first-click response')
  clearTimeout(timeout)
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
