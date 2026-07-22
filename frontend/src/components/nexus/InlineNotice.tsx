import type { ReactNode } from 'react'
import './InlineNotice.css'

type InlineNoticeTone = 'negative' | 'positive' | 'warning'

export function InlineNotice({
  children,
  role,
  tone,
}: {
  children: ReactNode
  role?: 'alert' | 'note' | 'status'
  tone: InlineNoticeTone
}) {
  const resolvedRole = role ?? (tone === 'negative' ? 'alert' : 'status')

  return (
    <div className={`notice ${tone}`} role={resolvedRole}>
      {children}
    </div>
  )
}
