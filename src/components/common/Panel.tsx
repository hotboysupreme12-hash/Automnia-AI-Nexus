import type { PropsWithChildren, ReactNode } from 'react'

interface PanelProps extends PropsWithChildren {
  title: string
  action?: ReactNode
  className?: string
  panelId?: string
}

export function Panel({ title, action, className, panelId, children }: PanelProps) {
  const resolvedPanelId = panelId ?? (title === 'Agent Registry' ? 'agent-registry' : undefined)

  return (
    <section
      data-dui-panel={resolvedPanelId}
      className={`dy-surface-enter relative overflow-hidden rounded-3xl border border-white/[0.075] bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(5,10,20,0.68))] p-5 shadow-[0_28px_90px_-60px_rgba(34,211,238,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] ${className ?? ''}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.045] pb-4">
        <h2 className="font-heading text-2xl tracking-normal text-slate-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
