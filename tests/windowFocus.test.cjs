const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { bindWindowFocus, presentWindow } = require('../electron/window-focus.cjs')

function fixture() {
  const win = new EventEmitter()
  const contents = new EventEmitter()
  let visible = false
  let focused = false
  let calls = 0
  Object.assign(contents, { isDestroyed: () => false, focus: () => { calls++ } })
  Object.assign(win, {
    webContents: contents, isDestroyed: () => false, isVisible: () => visible,
    isFocused: () => focused, isMinimized: () => false, setSkipTaskbar() {},
    show: () => { visible = true }, focus() {},
  })
  bindWindowFocus(win)
  return { win, contents, calls: () => calls, activate() { focused = true; win.emit('focus') }, blur() { focused = false } }
}

test('late native activation focuses content even after presentation returns', () => {
  const f = fixture()
  presentWindow(f.win, { focus() { assert.equal(f.win.isVisible(), true) } }, 'darwin')
  assert.equal(f.calls(), 0)
  f.activate()
  assert.equal(f.calls(), 1)
  f.contents.emit('dom-ready')
  f.contents.emit('did-finish-load')
  assert.equal(f.calls(), 3)
})

test('background navigation never steals focus and closed windows release listeners', () => {
  const f = fixture()
  presentWindow(f.win, { focus() {} }, 'darwin')
  f.activate()
  f.blur()
  f.contents.emit('dom-ready')
  f.contents.emit('did-finish-load')
  assert.equal(f.calls(), 1)
  f.win.emit('closed')
  assert.equal(f.contents.listenerCount('dom-ready'), 0)
  assert.equal(f.contents.listenerCount('did-finish-load'), 0)
  assert.equal(f.win.listenerCount('focus'), 0)
})
