const test = require('node:test')
const assert = require('node:assert/strict')
const { restoreWindowPlacement, restoreZoom } = require('../electron/window-placement.cjs')
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 672 } }
const portrait = { id: 2, workArea: { x: -1080, y: -300, width: 1080, height: 1880 } }

test('restores a secondary portrait window and its maximized preference', () => {
  const result = restoreWindowPlacement({ bounds: { x: -1000, y: 50, width: 900, height: 1200 }, maximized: true }, [primary, portrait], 1)
  assert.deepEqual(result, { x: -1000, y: 50, width: 900, height: 1200, minWidth: 880, minHeight: 600, maximized: true })
})
test('unplugged monitor bounds become fully visible in a short work area', () => {
  const result = restoreWindowPlacement({ bounds: { x: -1900, y: -900, width: 1800, height: 1200 } }, [primary], 1)
  assert.equal(result.x, 0); assert.equal(result.y, 0)
  assert.equal(result.width, 1280); assert.equal(result.height, 672)
})
test('small displays and corrupt preferences cannot strand the window', () => {
  const tiny = { id: 3, workArea: { x: 100, y: 100, width: 640, height: 480 } }
  const result = restoreWindowPlacement({ bounds: { x: NaN, width: -20 } }, [tiny], 3)
  assert.equal(result.minWidth, 640); assert.equal(result.minHeight, 480)
  assert.equal(result.x, 100); assert.equal(result.y, 100)
  assert.equal(restoreZoom(NaN), 1); assert.equal(restoreZoom(99), 1)
  assert.equal(restoreZoom(1.25), 1.25); assert.equal(restoreZoom(undefined, 0.8), 0.8)
})
