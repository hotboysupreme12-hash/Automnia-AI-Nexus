/** Returns the exact edit distance within the threshold, or threshold + 1. */
export function boundedEditDistance(a: string, b: string, threshold: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1
  if (!a.length || !b.length) return Math.min(threshold + 1, a.length + b.length)
  const limit = threshold + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => Math.min(index, limit))
  let current = new Array<number>(b.length + 1).fill(limit)
  for (let row = 1; row <= a.length; row++) {
    current.fill(limit)
    current[0] = Math.min(row, limit)
    let minimum = current[0]
    for (let col = Math.max(1, row - threshold); col <= Math.min(b.length, row + threshold); col++) {
      current[col] = Math.min(current[col - 1] + 1, previous[col] + 1, previous[col - 1] + Number(a[row - 1] !== b[col - 1]))
      minimum = Math.min(minimum, current[col])
    }
    if (minimum > threshold) return limit
    ;[previous, current] = [current, previous]
  }
  return Math.min(previous[b.length], limit)
}
