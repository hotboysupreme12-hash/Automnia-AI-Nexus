import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'
import './icon-button.css'

export type IconButtonVariant = 'default' | 'quiet' | 'danger'
export type IconButtonSize = 'compact' | 'default'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  'aria-label': string
  icon: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
}

export function IconButton({
  type = 'button',
  icon,
  variant = 'default',
  size = 'default',
  className,
  title,
  'aria-label': ariaLabel,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('dui-icon-button', `dui-icon-button--variant-${variant}`, `dui-icon-button--size-${size}`, className)}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      {...props}
    >
      <span className="dui-icon-button__glyph" aria-hidden="true">{icon}</span>
    </button>
  )
}
