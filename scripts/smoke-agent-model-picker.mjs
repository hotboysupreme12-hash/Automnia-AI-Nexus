import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const root = process.cwd()
const output = path.join(root, '.tmp', 'agent-model-picker-check')
mkdirSync(output, { recursive: true })
await build({
  stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AgentModelPicker } from './src/components/models/AgentModelPicker';
    const models = [
      {id:'automnia-cloud/gemini-3.8-flash', name:'Automnia Prime', provider:'automnia-cloud'},
      {id:'openai/gpt-5.4', name:'GPT-5.4', provider:'openai'},
      {id:'anthropic/claude-sonnet-4-6', name:'Claude Sonnet', provider:'anthropic'},
    ];
    function Fixture() {
      const [primary, setPrimary] = useState('openai/gpt-5.4');
      const [fallbacks, setFallbacks] = useState(['anthropic/claude-sonnet-4-6']);
      const [connected, setConnected] = useState(false);
      return <div data-dui-modal="agent-editor" className="agent-settings-refresh" style={{padding:24, maxWidth:800, margin:'24px auto'}}>
        <div data-editor-panel="model"><AgentModelPicker models={models} selectedIds={[primary]} fallbackIds={fallbacks}
          onSelect={id => {setPrimary(id); setFallbacks(ids => ids.filter(v => v !== id));}}
          onToggleFallback={id => setFallbacks(ids => ids.includes(id) ? ids.filter(v => v !== id) : [...ids,id])}
          providerAuthStatusFor={() => ({ configured: connected })}
          onProviderAuth={() => setConnected(true)} />
        </div><output id="fixture-state" style={{display:'none'}}>{JSON.stringify({primary,fallbacks,connected})}</output>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: root, loader: 'tsx' },
  bundle: true, outfile: path.join(output, 'fixture.js'), format: 'iife', jsx: 'automatic',
  loader: { '.woff2': 'file', '.png': 'file', '.svg': 'file' },
})

async function run() {
  const { app, BrowserWindow } = require('electron')
  const { createServer } = require('node:http')
  const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
  const path = require('node:path')
  const assert = require('node:assert/strict')
  const root = process.cwd()
  const output = path.join(root, '.tmp', 'agent-model-picker-check')
  app.setPath('userData', path.join(output, 'user-data'))
  await app.whenReady()
  const theme = readdirSync(path.join(root, 'dist/assets')).find(name => /^index-.*\.css$/.test(name))
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost').pathname
    const file = url === '/theme.css' ? path.join(root, 'dist/assets', theme)
      : url === '/' ? null : url.startsWith('/icons/') || url.startsWith('/brand/') ? path.join(root, 'public', url)
      : url.endsWith('.woff2') ? path.join(root, 'dist/assets', path.basename(url)) : path.join(output, path.basename(url))
    if (!file) { res.setHeader('Content-Type', 'text/html'); res.end('<html class="dui-pro-overhaul dui-cohesive-ui"><head><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/fixture.css"></head><body style="background:#111418"><div id="root"></div><script src="/fixture.js"></script></body></html>'); return }
    try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream'); res.end(readFileSync(file)) } catch { res.statusCode = 404; res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ width: 1024, height: 950, show: true, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } })
  const errors = []
  window.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message) })
  const wait = () => new Promise(resolve => setTimeout(resolve, 200))
  const js = script => window.webContents.executeJavaScript(script)
  const click = async text => { assert.equal(await js(`(() => {const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b})()`), true, `Missing ${text}`); await wait() }
  const state = async () => JSON.parse(await js("document.querySelector('#fixture-state').textContent"))
  const search = async text => { await js(`(() => {const el=document.querySelector('input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait() }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await wait()
    assert.equal(await js("document.querySelectorAll('select').length"), 0)
    assert.equal(await js("document.querySelector('.amp-backups').open"), false)
    await click('Connect provider')
    assert.equal((await state()).connected, true)
    await click('☆ Save to favorites')
    await click('Change model')
    assert.equal(await js("document.activeElement.getAttribute('aria-label')"), 'Search models and providers')
    await click('Favorites')
    assert.equal(await js("document.querySelectorAll('.amp-result').length"), 1)
    await click('All models')
    await search('anthropic')
    assert.equal(await js("document.querySelectorAll('.amp-result').length"), 1)
    await js("document.querySelector('.amp-result').click()")
    await wait()
    assert.equal((await state()).primary, 'anthropic/claude-sonnet-4-6')
    assert.deepEqual((await state()).fallbacks, [])
    await js("document.querySelector('.amp-backups summary').click()")
    await wait()
    await click('Add backup model')
    await search('openai')
    await js("document.querySelector('.amp-result').click()")
    await wait()
    assert.deepEqual((await state()).fallbacks, ['openai/gpt-5.4'])
    await click('Add backup model')
    assert.equal(await js("Array.from(document.querySelectorAll('.amp-result')).some(b=>b.textContent.includes('GPT-5.4') || b.textContent.includes('Claude Sonnet'))"), false)
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await wait()
    assert.equal(await js("document.querySelector('.amp-chooser') === null"), true)
    assert.equal(await js("document.activeElement.textContent"), 'Add backup model')
    await click('Remove')
    assert.deepEqual((await state()).fallbacks, [])
    await js("document.querySelector('.amp-backups summary').click()")
    await wait()
    for (const width of [1024, 390]) {
      window.setSize(width, 950)
      await wait()
      assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true, `Overflow at ${width}`)
      writeFileSync(path.join(output, `model-settings-${width}.png`), (await window.webContents.capturePage()).toPNG())
      await click('Change model')
      await search('no-such-model')
      assert.equal(await js("document.querySelectorAll('.amp-result').length"), 0)
      await search('')
      assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true, `Picker overflow at ${width}`)
      writeFileSync(path.join(output, `model-search-${width}.png`), (await window.webContents.capturePage()).toPNG())
      await click('Cancel')
    }
    assert.deepEqual(errors, [])
    console.log('Agent model picker: selection, search, favorites, backup add/remove, connection, Escape/focus, and desktop/mobile layout passed.')
  } finally { window.destroy(); server.close(); app.quit() }
}
writeFileSync(path.join(output, 'main.cjs'), `(${run.toString()})().catch(error => { console.error(error); require('electron').app.exit(1) })`)
const result = spawnSync(require('electron'), [path.join(output, 'main.cjs')], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
