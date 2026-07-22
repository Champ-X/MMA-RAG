import type { ReactNode } from 'react'
import './EmptyState.css'

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-glyph" aria-hidden="true">∴</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )
}
