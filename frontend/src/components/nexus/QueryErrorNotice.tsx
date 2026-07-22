import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { QueryErrorNoticeViewModel } from './queryErrorNoticeViewModel'
import './QueryErrorNotice.css'

export function QueryErrorNotice({
  model,
  onRetry,
}: {
  model: QueryErrorNoticeViewModel
  onRetry: () => void
}) {
  if (!model.visible) return null

  return (
    <section
      className={`query-error-notice tone-${model.tone}`}
      role={model.role}
      aria-live={model.role === 'alert' ? 'assertive' : 'polite'}
      aria-label={model.label}
    >
      <span aria-hidden="true"><AlertTriangle size={18} /></span>
      <span><strong>{model.label}</strong><small>{model.detail}</small></span>
      <button type="button" className="button" onClick={onRetry}><RotateCcw size={14} />{model.actionLabel}</button>
    </section>
  )
}
