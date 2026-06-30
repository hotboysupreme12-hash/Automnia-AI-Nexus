import { cloneElement, forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cx } from './utils'
import './field.css'

interface FieldControlProps {
  id?: string
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: ReactElement<FieldControlProps>
}

export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const generatedId = useId()
  const controlId = children.props.id ?? `${generatedId}-control`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
  const control = cloneElement<FieldControlProps>(children, {
    id: controlId,
    required: children.props.required ?? required,
    'aria-describedby': describedBy,
    'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
  })

  return (
    <div className={cx('dui-field', error ? 'dui-field--invalid' : undefined, className)}>
      <label className="dui-field__label" htmlFor={controlId}>
        <span>{label}</span>
        {required ? <span className="dui-field__required" aria-hidden="true">Required</span> : null}
      </label>
      {control}
      {hint ? <p id={hintId} className="dui-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="dui-field__error" role="alert">{error}</p> : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  className,
  invalid = false,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  return (
    <input
      ref={ref}
      className={cx('dui-input', invalid && 'dui-input--invalid', className)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({
  className,
  invalid = false,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  return (
    <select
      ref={ref}
      className={cx('dui-select', invalid && 'dui-select--invalid', className)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  className,
  invalid = false,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  return (
    <textarea
      ref={ref}
      className={cx('dui-textarea', invalid && 'dui-textarea--invalid', className)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  )
})
