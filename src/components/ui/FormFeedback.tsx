import type { ReactNode } from 'react'
import './formFeedback.css'

export function FormFeedback({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' }) {
  if (!children) return null
  return <p className="dui-form-feedback" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{tone === 'error' ? '!' : tone === 'success' ? '✓' : 'i'}</span><span>{children}</span></p>
}
