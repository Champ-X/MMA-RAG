import './LoadingState.css'

export function LoadingState({ label = 'Reading the control plane' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-rule" />
      <span>{label}</span>
    </div>
  )
}
