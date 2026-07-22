import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { RunCapabilityRecoveryViewModel } from './runCapabilityRecoveryViewModel'
import './RunCapabilityRecoveryNotice.css'

export function RunCapabilityRecoveryNotice({
  evidenceDrawerId,
  model,
  onOpenEvidence,
}: {
  evidenceDrawerId?: string
  model: RunCapabilityRecoveryViewModel
  onOpenEvidence?: () => void
}) {
  if (!model.visible) return null
  const canOpenEvidence = model.preservedEvidenceIds.length > 0 && Boolean(onOpenEvidence)
  return (
    <section
      className="capability-recovery-notice"
      role={model.role}
      aria-live={model.role === 'alert' ? 'assertive' : 'polite'}
      aria-label={model.label}
    >
      <AlertTriangle size={16} />
      <div>
        <strong>{model.label}</strong>
        <small>{model.detail}</small>
      </div>
      <dl>
        <div><dt>Phase</dt><dd>{model.phaseLabel}</dd></div>
        <div><dt>Preserved</dt><dd>{model.evidenceLabel}</dd></div>
      </dl>
      <ul aria-label="Recovery actions">
        {model.actions.map((action) => <li key={action}><RotateCcw size={12} />{action}</li>)}
      </ul>
      {model.preservedEvidenceIds.length > 0 && (
        <p>
          <span>Evidence ids</span>
          <code>{model.preservedEvidenceIds.map((id) => id.slice(0, 8)).join(' · ')}</code>
        </p>
      )}
      {canOpenEvidence && (
        <button type="button" aria-controls={evidenceDrawerId} onClick={onOpenEvidence}>
          Review preserved evidence
        </button>
      )}
    </section>
  )
}
