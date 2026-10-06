import type { PiStep } from '../types/pi'

// Only routine successful model spans are folded out of the research view.
// Errors, active calls and spans carrying additional information stay visible.
export function isRoutinePiModel(step: PiStep): boolean {
  return step.kind === 'model' && step.status === 'completed' && !step.text
    && !step.args && !step.artifactId && !step.evidenceIds?.length
}

export function piModelDisplayName(model: string): string {
  const name = model.slice(model.indexOf(':') + 1)
  return name === 'deepseek-flash' ? 'DeepSeek Flash' : name
}

export function piStepFocus(step: PiStep): string | undefined {
  if (step.kind !== 'tool') return undefined
  const value = step.args?.query ?? step.args?.question
  return typeof value === 'string' && value.trim() ? value : undefined
}
