import type { ReactNode } from 'react'
export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="dui-empty-state" role="status"><strong>{title}</strong><p>{description}</p>{children && <div className="dui-empty-state__actions">{children}</div>}</div>
}
