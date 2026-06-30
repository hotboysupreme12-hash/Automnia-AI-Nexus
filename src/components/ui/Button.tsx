import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'
import './button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type ButtonSize = 'compact' | 'default' | 'primary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  loading?: boolean
  fullWidth?: boolean
}

export function Button({
  type = 'button',
  variant = 'secondary',
  size = 'default',
  leadingIcon,
  trailingIcon,
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      className={cx(
        'dui-button',
        `dui-button--variant-${variant}`,
        `dui-button--size-${size}`,
        fullWidth && 'dui-button--full',
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      data-loading={loading ? 'true' : undefined}
      {...props}
    >
      {loading ? <span className="dui-button__spinner" aria-hidden="true" /> : null}
      {leadingIcon ? <span className="dui-button__icon" aria-hidden="true">{leadingIcon}</span> : null}
      <span className="dui-button__label">{children}</span>
      {trailingIcon ? <span className="dui-button__icon" aria-hidden="true">{trailingIcon}</span> : null}
    </button>
  )
}
