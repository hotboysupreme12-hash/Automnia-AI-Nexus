/** Keep writes in intent order even if an earlier request is slow or fails. */
export function createSerialSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(save: () => Promise<T>): Promise<T> => {
    const next = tail.then(save)
    tail = next.catch(() => undefined)
    return next
  }
}
