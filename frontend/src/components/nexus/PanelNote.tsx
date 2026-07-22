import type { ReactNode } from 'react'
import './PanelNote.css'

export function PanelNote({
  align = 'end',
  children,
}: {
  align?: 'end' | 'start'
  children: ReactNode
}) {
  return <p className={`panel-note align-${align}`}>{children}</p>
}
