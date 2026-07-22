import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunCapabilityRecoveryNotice } from './RunCapabilityRecoveryNotice'
import type { RunCapabilityRecoveryViewModel } from './runCapabilityRecoveryViewModel'

describe('RunCapabilityRecoveryNotice', () => {
  it('renders recovery guidance as an assertive alert', () => {
    const model: RunCapabilityRecoveryViewModel = {
      actions: ['Enable or repair the missing capability before retrying this Run.'],
      detail: 'Synthesis provider disabled. A runtime checkpoint is available.',
      evidenceLabel: '2 preserved Evidence items',
      label: 'Capability recovery required',
      phaseLabel: 'Evidence retrieved',
      preservedEvidenceIds: ['019f8400-f17f-7b62-bb89-54f4df9b3d42'],
      role: 'alert',
      visible: true,
    }

    const markup = renderToStaticMarkup(<RunCapabilityRecoveryNotice model={model} />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('aria-label="Capability recovery required"')
    expect(markup).toContain('Evidence retrieved')
    expect(markup).toContain('2 preserved Evidence items')
    expect(markup).toContain('Enable or repair the missing capability')
    expect(markup).toContain('019f8400')
    expect(markup).not.toContain('Review preserved evidence')
  })

  it('offers a direct evidence drawer action when preserved evidence exists', () => {
    const model: RunCapabilityRecoveryViewModel = {
      actions: ['Review the preserved Evidence ledger before rerunning.'],
      detail: 'Synthesis provider disabled. A runtime checkpoint is available.',
      evidenceLabel: '1 preserved Evidence item',
      label: 'Capability recovery required',
      phaseLabel: 'Evidence retrieved',
      preservedEvidenceIds: ['019f8400-f17f-7b62-bb89-54f4df9b3d42'],
      role: 'alert',
      visible: true,
    }

    const markup = renderToStaticMarkup(
      <RunCapabilityRecoveryNotice evidenceDrawerId="run-evidence-drawer" model={model} onOpenEvidence={() => undefined} />,
    )

    expect(markup).toContain('<button type="button"')
    expect(markup).toContain('aria-controls="run-evidence-drawer"')
    expect(markup).toContain('Review preserved evidence')
  })

  it('does not claim control over a drawer when the action navigates to another Run', () => {
    const model: RunCapabilityRecoveryViewModel = {
      actions: ['Review the preserved Evidence ledger before rerunning.'],
      detail: 'Synthesis provider disabled. A runtime checkpoint is available.',
      evidenceLabel: '1 preserved Evidence item',
      label: 'Capability recovery required',
      phaseLabel: 'Evidence retrieved',
      preservedEvidenceIds: ['019f8400-f17f-7b62-bb89-54f4df9b3d42'],
      role: 'alert',
      visible: true,
    }

    const markup = renderToStaticMarkup(
      <RunCapabilityRecoveryNotice model={model} onOpenEvidence={() => undefined} />,
    )

    expect(markup).toContain('Review preserved evidence')
    expect(markup).not.toContain('aria-controls')
  })

  it('does not offer an empty evidence drawer action', () => {
    const model: RunCapabilityRecoveryViewModel = {
      actions: ['Retry after the connector is available.'],
      detail: 'Vector index is warming. No retrieval checkpoint was created before the interruption.',
      evidenceLabel: '0 preserved Evidence items',
      label: 'Capability recovery required',
      phaseLabel: 'Before retrieval',
      preservedEvidenceIds: [],
      role: 'alert',
      visible: true,
    }

    const markup = renderToStaticMarkup(
      <RunCapabilityRecoveryNotice model={model} onOpenEvidence={() => undefined} />,
    )

    expect(markup).not.toContain('Review preserved evidence')
  })

  it('renders nothing when hidden', () => {
    const model: RunCapabilityRecoveryViewModel = {
      actions: [],
      detail: '',
      evidenceLabel: '',
      label: '',
      phaseLabel: '',
      preservedEvidenceIds: [],
      role: 'status',
      visible: false,
    }

    expect(renderToStaticMarkup(<RunCapabilityRecoveryNotice model={model} />)).toBe('')
  })
})
