import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'
import './badge.css'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'
export type BadgeSize = 'micro' | 'default'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  size?: BadgeSize
  icon?: ReactNode
}

export function Badge({
  tone = 'neutral',
  size = 'default',
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cx('dui-badge', `dui-badge--${tone}`, `dui-badge--${size}`, className)} {...props}>
      {icon ? <span className="dui-badge__icon" aria-hidden="true">{icon}</span> : null}
      <span className="dui-badge__label">{children}</span>
    </span>
  )
}
