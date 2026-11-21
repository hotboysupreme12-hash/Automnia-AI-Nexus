// Exercise the built theme in Chromium with a resized registry pane.
const { app, BrowserWindow } = require('electron')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')

app.whenReady().then(async () => {
  const assets = path.join(__dirname, '..', 'dist', 'assets')
  const cssName = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name))
  if (!cssName) throw new Error('Build the client before checking the responsive grid')
  const css = readFileSync(path.join(assets, cssName), 'utf8')
  const win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<html class="dui-pro-overhaul dui-cohesive-ui"><body><div data-dui-panel="agent-registry"><div class="agent-card-registry-grid--grid8" data-agent-grid-mode="grid8"><div></div><div></div><div></div><div></div></div></div></body></html>')
  await win.webContents.insertCSS(css)
  const results = await win.webContents.executeJavaScript(`(() => {
    const grid = document.querySelector('[data-agent-grid-mode]');
    return [240, 570, 860].map(width => {
      grid.style.setProperty('width', width + 'px', 'important');
      const cards = Array.from(grid.children, child => child.getBoundingClientRect());
      const style = getComputedStyle(grid);
      return { width, columns: new Set(cards.map(card => Math.round(card.left))).size,
        template: style.gridTemplateColumns, gap: style.columnGap, padding: style.padding,
        preferred: style.getPropertyValue('--agent-readable-width'), rootFont: getComputedStyle(document.documentElement).fontSize,
        smallestCard: Math.min(...cards.map(card => card.width)),
        overflow: grid.scrollWidth - grid.clientWidth };
    });
  })()`)
  if (results[0].columns !== 1 || results[1].columns < 2 || results[2].columns < 3 ||
      results.some((result) => result.overflow > 1 || result.smallestCard < Math.min(result.width, 250))) {
    throw new Error(`Registry grid did not reflow safely: ${JSON.stringify(results)}`)
  }
  console.log(`Responsive registry grid: ${JSON.stringify(results)}`)
  win.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
