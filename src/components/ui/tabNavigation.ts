import type { KeyboardEvent } from 'react'

/** Automatic tab activation with one keyboard stop and a visible active tab. */
export function navigateTabList<T extends string>(event: KeyboardEvent<HTMLButtonElement>, values: readonly T[], value: T, activate: (value: T) => void) {
  const current = values.indexOf(value)
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
  let next = current
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = values.length - 1
  else if (event.key === 'ArrowRight') next = (current + (rtl ? -1 : 1) + values.length) % values.length
  else if (event.key === 'ArrowLeft') next = (current + (rtl ? 1 : -1) + values.length) % values.length
  else return
  if (!values.length || current < 0) return
  event.preventDefault()
  activate(values[next])
  const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabs?.[next]?.focus({ preventScroll: true })
  tabs?.[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
