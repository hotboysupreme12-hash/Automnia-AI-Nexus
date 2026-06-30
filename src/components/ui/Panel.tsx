import { useId } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'
import './panel.css'

export type PanelTone = 'neutral' | 'accent' | 'warning' | 'danger'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title?: ReactNode
  action?: ReactNode
  tone?: PanelTone
  compact?: boolean
}

export function Panel({
  eyebrow,
  title,
  action,
  tone = 'neutral',
  compact = false,
  className,
  id,
  children,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: PanelProps) {
  const generatedTitleId = useId()
  const titleId = id ? `${id}-title` : generatedTitleId

  return (
    <section
      id={id}
      data-dui-panel="primitive"
      data-tone={tone}
      className={cx('dui-panel', compact && 'dui-panel--compact', className)}
      aria-labelledby={ariaLabelledBy ?? (title ? titleId : undefined)}
      {...props}
    >
      {(eyebrow || title || action) ? (
        <header className="dui-panel__header">
          <div className="dui-panel__title-group">
            {eyebrow ? <span className="dui-panel__eyebrow">{eyebrow}</span> : null}
            {title ? <h2 id={titleId} className="dui-panel__title">{title}</h2> : null}
          </div>
          {action ? <div className="dui-panel__action">{action}</div> : null}
        </header>
      ) : null}
      <div className="dui-panel__body">{children}</div>
    </section>
  )
}
