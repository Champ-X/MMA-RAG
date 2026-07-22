import type { ReactNode } from 'react'
import './SubmitReadinessCard.css'

type SubmitReadinessTone = 'blocked' | 'error' | 'pending' | 'ready'

type SubmitReadinessModel = {
  feedbackDetail?: ReactNode
  feedbackLabel?: ReactNode
  feedbackTone?: SubmitReadinessTone
  detail?: ReactNode
  label?: ReactNode
  liveMode?: 'assertive' | 'polite'
  role?: 'alert' | 'status'
  tone?: SubmitReadinessTone
  visible?: boolean
}

type SubmitReadinessCardProps = {
  detail: ReactNode
  id: string
  label: ReactNode
  liveMode?: 'assertive' | 'polite'
  pending?: boolean
  role?: 'alert' | 'status'
  tone: SubmitReadinessTone
  visible?: boolean
  children?: ReactNode
  className?: string
}

type SubmitReadinessCardModelProps = {
  id: string
  model: SubmitReadinessModel
  liveMode?: 'assertive' | 'polite'
  pending?: boolean
  role?: 'alert' | 'status'
  visible?: boolean
  children?: ReactNode
  className?: string
}

export function SubmitReadinessCard({
  children,
  className,
  id,
  ...props
}: SubmitReadinessCardProps | SubmitReadinessCardModelProps) {
  const model: SubmitReadinessModel = 'model' in props
    ? props.model
    : {
      detail: props.detail,
      label: props.label,
      liveMode: props.liveMode,
      role: props.role,
      tone: props.tone,
      visible: props.visible,
    }
  const detail = model.feedbackDetail ?? model.detail ?? ''
  const label = model.feedbackLabel ?? model.label ?? ''
  const tone = model.feedbackTone ?? model.tone ?? 'blocked'
  const liveMode = props.liveMode ?? model.liveMode ?? (tone === 'error' ? 'assertive' : 'polite')
  const role = props.role ?? model.role ?? (tone === 'error' ? 'alert' : 'status')
  const visible = props.visible ?? model.visible ?? true
  const pending = 'pending' in props ? Boolean(props.pending) : tone === 'pending'
  const classes = visible
    ? ['submit-readiness-card', className, `tone-${tone}`].filter(Boolean).join(' ')
    : 'sr-only'

  return (
    <div className={classes} id={id} role={role} aria-live={liveMode}>
      {pending && visible && <span className="spin" />}
      <span><strong>{label}</strong><small>{detail}</small>{children}</span>
    </div>
  )
}
