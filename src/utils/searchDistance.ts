/** Returns the exact edit distance within the threshold, or threshold + 1. */
export function boundedEditDistance(a: string, b: string, threshold: number): number {
  if (threshold < 0) return threshold + 1
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1
  let start = 0
  const minLen = Math.min(a.length, b.length)
  while (start < minLen && a.charCodeAt(start) === b.charCodeAt(start)) start += 1
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a.charCodeAt(aEnd - 1) === b.charCodeAt(bEnd - 1)) {
    aEnd -= 1
    bEnd -= 1
  }
  const left = start > 0 || aEnd < a.length ? a.slice(start, aEnd) : a
  const right = start > 0 || bEnd < b.length ? b.slice(start, bEnd) : b
  if (!left.length || !right.length) return Math.min(threshold + 1, left.length + right.length)
  const limit = threshold + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => Math.min(index, limit))
  let current = new Array<number>(right.length + 1).fill(limit)
  for (let row = 1; row <= left.length; row++) {
    const colStart = Math.max(1, row - threshold)
    const colEnd = Math.min(right.length, row + threshold)
    current[0] = Math.min(row, limit)
    if (colStart > 1) current[colStart - 1] = limit
    let minimum = limit
    for (let col = colStart; col <= colEnd; col++) {
      const value = Math.min(
        current[col - 1] + 1,
        previous[col] + 1,
        previous[col - 1] + Number(left.charCodeAt(row - 1) !== right.charCodeAt(col - 1)),
      )
      current[col] = value
      if (value < minimum) minimum = value
    }
    if (colEnd < right.length) current[colEnd + 1] = limit
    if (minimum > threshold) return limit
    ;[previous, current] = [current, previous]
  }
  return Math.min(previous[right.length], limit)
}
