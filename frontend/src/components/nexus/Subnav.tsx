import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './Subnav.css'

export type SubnavItem<T extends string> = {
  value: T
  label: string
  to: string
  icon?: ReactNode
}

export function Subnav<T extends string>({
  active,
  ariaLabel,
  children,
  className,
  items,
}: {
  active: T
  ariaLabel: string
  children?: ReactNode
  className?: string
  items: Array<SubnavItem<T>>
}) {
  return (
    <nav className={['subnav', className].filter(Boolean).join(' ')} aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = active === item.value
        return (
          <Link
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'active' : undefined}
            key={item.value}
            to={item.to}
          >
            {item.icon}
            {item.label}
          </Link>
        )
      })}
      {children}
    </nav>
  )
}
