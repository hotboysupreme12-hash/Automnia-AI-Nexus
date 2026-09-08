import { useLayoutEffect, useState } from 'react'

// Small view preferences live for this renderer session. Workspaces can unmount
// their polling effects while keeping search, page and tab choices.
const rememberedViews = new Map<string, unknown>()

export function forgetRememberedState(key: string): unknown {
  const previous = rememberedViews.get(key)
  rememberedViews.delete(key)
  return previous
}

export function useRememberedState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => rememberedViews.has(key)
    ? rememberedViews.get(key) as T
    : typeof initial === 'function' ? (initial as () => T)() : initial)
  useLayoutEffect(() => { rememberedViews.set(key, value) }, [key, value])
  return [value, setValue] as const
}
