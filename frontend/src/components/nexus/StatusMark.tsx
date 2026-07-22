import './StatusMark.css'

type StatusMarkProps = {
  status: string
  label?: string
}

const statusTone = (status: string) => {
  if (['ready', 'completed', 'changed', 'supported', 'enabled', 'active', 'published'].includes(status)) return 'positive'
  if (['failed', 'unavailable', 'cancelled', 'conflicted'].includes(status)) return 'negative'
  if (['partial', 'partially_supported', 'stale', 'degraded', 'not_configured', 'insufficient', 'quarantined', 'candidate'].includes(status)) return 'warning'
  return 'neutral'
}

export function StatusMark({ status, label }: StatusMarkProps) {
  return (
    <span className={`status-mark status-${statusTone(status)}`}>
      <span className="status-dot" aria-hidden="true" />
      {label ?? status.replaceAll('_', ' ')}
    </span>
  )
}
