import { AlertTriangle } from 'lucide-react'
import type { RunModelFallbackViewModel } from './runModelFallbackViewModel'
import './RunModelFallbackNotice.css'

export function RunModelFallbackNotice({ model }: { model: RunModelFallbackViewModel }) {
  if (!model.visible) return null
  return (
    <section
      className={`model-fallback-notice tone-${model.tone}`}
      role={model.role}
      aria-live={model.role === 'alert' ? 'assertive' : 'polite'}
      aria-label={model.label}
    >
      <AlertTriangle size={15} />
      <span>
        <strong>{model.label}</strong>
        <small>{model.detail}</small>
        {model.failures.length > 0 && <em>{model.failures.join(' · ')}</em>}
      </span>
      <code>{model.modelLabel}</code>
    </section>
  )
}
