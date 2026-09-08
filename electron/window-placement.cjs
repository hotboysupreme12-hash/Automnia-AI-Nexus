/** @typedef {{x:number,y:number,width:number,height:number}} Bounds */
/** @typedef {{id:number,workArea:Bounds}} Display */

/** @param {unknown} value @param {number} fallback */
function restoreZoom(value, fallback = 1) {
  return value === undefined ? fallback : typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 1
}

/** @param {unknown} saved @param {Display[]} displays @param {number} primaryId */
function restoreWindowPlacement(saved, displays, primaryId) {
  const primary = displays.find((display) => display.id === primaryId) || displays[0]
  if (!primary) throw new Error('No display is available')
  const record = saved && typeof saved === 'object' ? /** @type {Record<string, unknown>} */ (saved) : {}
  const candidate = record.bounds && typeof record.bounds === 'object' ? /** @type {Bounds} */ (record.bounds) : null
  const bounds = candidate && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(candidate[key])) && candidate.width >= 320 && candidate.height >= 200 ? candidate : null
  let display = primary
  let largestOverlap = 0
  if (bounds) for (const current of displays) {
    const area = current.workArea
    const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y))
    if (overlap > largestOverlap) { largestOverlap = overlap; display = current }
  }
  const area = display.workArea
  const minWidth = Math.min(880, area.width)
  const minHeight = Math.min(600, area.height)
  const width = Math.round(Math.min(area.width, Math.max(minWidth, bounds?.width || Math.min(1440, area.width - 48))))
  const height = Math.round(Math.min(area.height, Math.max(minHeight, bounds?.height || Math.min(960, area.height - 48))))
  const x = Math.round(Math.min(area.x + area.width - width, Math.max(area.x, bounds?.x ?? area.x + (area.width - width) / 2)))
  const y = Math.round(Math.min(area.y + area.height - height, Math.max(area.y, bounds?.y ?? area.y + (area.height - height) / 2)))
  return { x, y, width, height, minWidth, minHeight, maximized: record.maximized === true }
}

module.exports = { restoreWindowPlacement, restoreZoom }
