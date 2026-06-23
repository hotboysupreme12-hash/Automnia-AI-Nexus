import type { ReactNode } from 'react'

export type ActionStatusBannerTone = 'neutral' | 'warning' | 'success' | 'error'

interface ActionStatusBannerProps {
  message: ReactNode
  detail?: ReactNode
  detailTitle?: string
  tone?: ActionStatusBannerTone
  className?: string
  detailClassName?: string
  actionTextClassName?: string
  rounded?: 'none' | 'md' | 'lg' | '2xl'
  buttonRounded?: 'none' | 'md' | 'default'
  confirmLabel?: string
  confirmBusyLabel?: string
  confirmAriaLabel?: string
  cancelLabel?: string
  cancelAriaLabel?: string
  busy?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

const toneClassNames: Record<ActionStatusBannerTone, string> = {
  neutral: 'border-white/[0.07] bg-white/[0.035] text-slate-200/90',
  warning: 'border-amber-300/20 bg-amber-300/[0.055] text-amber-100/90',
  success: 'border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-100/90',
  error: 'border-rose-400/20 bg-rose-400/[0.055] text-rose-100/90',
}

const roundedClassNames = {
  none: 'rounded-none',
  md: 'rounded-md',
  lg: 'rounded-lg',
  '2xl': 'rounded-2xl',
}

const buttonRoundedClassNames = {
  none: 'rounded-none',
  md: 'rounded-md',
  default: 'rounded',
}

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function ActionStatusBanner({
  message,
  detail,
  detailTitle,
  tone = 'warning',
  className,
  detailClassName = 'text-[10px] opacity-70',
  actionTextClassName = 'text-[10px]',
  rounded = 'lg',
  buttonRounded = 'default',
  confirmLabel = 'Confirm',
  confirmBusyLabel,
  confirmAriaLabel,
  cancelLabel = 'Keep',
  cancelAriaLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ActionStatusBannerProps) {
  const hasActions = Boolean(onConfirm || onCancel)
  const role = tone === 'error' ? 'alert' : 'status'
  const liveMode = tone === 'error' ? 'assertive' : 'polite'

  return (
    <div
      className={classes(
        'flex flex-wrap items-center justify-between gap-3 border px-3.5 py-3',
        roundedClassNames[rounded],
        toneClassNames[tone],
        className,
      )}
      role={role}
      aria-live={liveMode}
    >
      <div className="min-w-0">
        {typeof message === 'string' ? <p className="font-semibold">{message}</p> : message}
        {detail ? (
          <p className={classes('mt-0.5 truncate', detailClassName)} title={detailTitle}>
            {detail}
          </p>
        ) : null}
      </div>
      {hasActions ? (
        <div className="flex shrink-0 items-center gap-2">
          {onConfirm ? (
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              aria-label={confirmAriaLabel}
              className={classes(
                buttonRoundedClassNames[buttonRounded],
                'border border-rose-300/25 bg-rose-300/[0.08] px-3 py-1.5 font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:border-rose-300/45 hover:bg-rose-300/[0.13] disabled:cursor-not-allowed disabled:opacity-50',
                actionTextClassName,
              )}
            >
              {busy && confirmBusyLabel ? confirmBusyLabel : confirmLabel}
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              aria-label={cancelAriaLabel}
              className={classes(
                buttonRoundedClassNames[buttonRounded],
                'border border-white/[0.10] bg-white/[0.035] px-3 py-1.5 font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50',
                actionTextClassName,
              )}
            >
              {cancelLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
