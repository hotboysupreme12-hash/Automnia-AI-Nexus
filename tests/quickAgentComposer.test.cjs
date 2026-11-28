const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function composer() {
  class Element {
    constructor(tag = '') { this.tag = tag; this.children = []; this.listeners = {}; this.style = { setProperty() {} }; this.classList = { values: new Set(), add: (...v) => v.forEach((x) => this.classList.values.add(x)), remove: (...v) => v.forEach((x) => this.classList.values.delete(x)), contains: (v) => this.classList.values.has(v) }; this.value = ''; this.hidden = false }
    addEventListener(type, listener) { this.listeners[type] = listener }
    append(...children) { this.children.push(...children) }
    replaceChildren(...children) { this.children = children }
    querySelectorAll(tag) { return this.children.flatMap((child) => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]) }
    setAttribute() {}
    focus() {}
    contains() { return false }
  }
  const ids = Object.fromEntries(['quick-agent', 'prompt', 'quick-agent-form', 'file-input', 'file-list', 'clipboard-context', 'quick-agent-status', 'send-button', 'agent-name', 'automnia-mark'].map((id) => [id, new Element()]))
  const selectors = Object.fromEntries(['.quick-agent__bubble', '.quick-agent__add', '.quick-agent__close', '.quick-agent__logo'].map((key) => [key, new Element()]))
  const callbacks = {}
  let payload
  const bridge = {
    onOpen: (f) => { callbacks.open = f }, onContext: (f) => { callbacks.context = f }, onLogo() {}, onFade: (f) => { callbacks.fade = f }, onCollapse: (f) => { callbacks.collapse = f },
    submit: async (p) => { payload = p; return { ok: false, message: 'Retry this draft' } }, close: async () => true, setFileDialogOpen() {},
  }
  const window = { automniaQuickAgent: bridge, setTimeout: (f) => { f(); return 1 }, clearTimeout() {}, requestAnimationFrame: (f) => f(), addEventListener() {} }
  const document = { getElementById: (id) => ids[id], querySelector: (s) => selectors[s], createElement: (tag) => new Element(tag) }
  const URL = { createObjectURL: () => 'blob:preview', revokeObjectURL() {} }
  vm.runInNewContext(fs.readFileSync('electron/quick-agent.js', 'utf8'), { window, document, URL, Blob, ArrayBuffer, Uint8Array, Error })
  return { ids, callbacks, getPayload: () => payload }
}

test('quick composer waits for file reads, previews images, and retains a failed draft', async () => {
  const ui = composer()
  ui.callbacks.open({})
  let finishRead
  const data = new Uint8Array([1, 2, 3]).buffer
  const file = { name: 'screen.png', type: 'image/png', size: 3, lastModified: 5, arrayBuffer: () => new Promise((resolve) => { finishRead = resolve }) }
  const event = { preventDefault() {}, dataTransfer: { files: [file] } }
  ui.ids['quick-agent'].listeners.drop(event)
  assert.equal(ui.ids['send-button'].disabled, true)
  await ui.ids['quick-agent-form'].listeners.submit({ preventDefault() {} })
  assert.equal(ui.getPayload(), undefined)
  finishRead(data)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(ui.ids['send-button'].disabled, false)
  assert.equal(ui.ids['file-list'].children[0].children[0].tag, 'img')
  ui.ids.prompt.value = 'Describe the image'
  await ui.ids['quick-agent-form'].listeners.submit({ preventDefault() {} })
  assert.equal(ui.getPayload().attachments[0].data.byteLength, 3)
  assert.equal(ui.ids.prompt.value, 'Describe the image')
  assert.equal(ui.ids['file-list'].children.length, 1)
  ui.callbacks.collapse()
  ui.callbacks.open({})
  assert.equal(ui.ids.prompt.value, 'Describe the image')
  assert.equal(ui.ids['file-list'].children.length, 1)
})

test('image worker preserves transparency-capable formats', async () => {
  let type
  let result
  const context = { drawImage() {} }
  const worker = { postMessage: (blob) => { result = blob } }
  class Canvas { getContext() { return context } async convertToBlob(options) { type = options.type; return { type } } }
  vm.runInNewContext(fs.readFileSync('src/components/monitor/attachmentImage.worker.js', 'utf8'), { self: worker, OffscreenCanvas: Canvas, createImageBitmap: async () => ({ width: 2000, height: 1000, close() {} }) })
  await worker.onmessage({ data: { type: 'image/png' } })
  assert.equal(type, 'image/png')
  assert.equal(result.type, 'image/png')
  await worker.onmessage({ data: { type: 'image/jpeg' } })
  assert.equal(type, 'image/jpeg')
})
