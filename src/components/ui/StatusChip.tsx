import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'
import type { BadgeTone } from './Badge'
import './badge.css'

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  label: string
  value?: ReactNode
  tone?: BadgeTone
  state?: string
  icon?: ReactNode
  live?: boolean
}

export function StatusChip({
  label,
  value,
  tone = 'neutral',
  state,
  icon,
  live = false,
  className,
  'aria-label': ariaLabel,
  ...props
}: StatusChipProps) {
  const visibleValue = value ?? state ?? label
  const accessibleLabel = ariaLabel ?? `${label}: ${typeof visibleValue === 'string' || typeof visibleValue === 'number' ? visibleValue : state ?? tone}`

  return (
    <span
      className={cx('dui-status-chip', `dui-badge--${tone}`, className)}
      data-state={state}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
      aria-label={accessibleLabel}
      {...props}
    >
      <span className="dui-status-chip__dot" aria-hidden="true" />
      {icon ? <span className="dui-status-chip__icon" aria-hidden="true">{icon}</span> : null}
      <span className="dui-status-chip__label dy-status-label">{label}</span>
      <span className="dui-status-chip__value dy-status-value">{visibleValue}</span>
    </span>
  )
}
