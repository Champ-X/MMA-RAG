import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SubmitReadinessCard } from './SubmitReadinessCard'

describe('SubmitReadinessCard', () => {
  it('renders shared readiness feedback with accessible status semantics', () => {
    const markup = renderToStaticMarkup(
      <SubmitReadinessCard
        className="source-action-feedback"
        detail="Existing evidence remains available until the request settles."
        id="source-action-feedback"
        label="Action ready"
        tone="ready"
      />,
    )

    expect(markup).toContain('class="submit-readiness-card source-action-feedback tone-ready"')
    expect(markup).toContain('id="source-action-feedback"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('<strong>Action ready</strong>')
    expect(markup).toContain('<small>Existing evidence remains available until the request settles.</small>')
  })

  it('keeps pending progress visible only when the feedback is visible', () => {
    const visibleMarkup = renderToStaticMarkup(
      <SubmitReadinessCard detail="Saving." id="feedback" label="Saving" pending tone="pending" />,
    )
    const hiddenMarkup = renderToStaticMarkup(
      <SubmitReadinessCard detail="Saving." id="feedback" label="Saving" pending tone="pending" visible={false} />,
    )

    expect(visibleMarkup).toContain('class="spin"')
    expect(hiddenMarkup).toContain('class="sr-only"')
    expect(hiddenMarkup).not.toContain('class="spin"')
  })

  it('allows alert semantics and appended actions without changing the card contract', () => {
    const markup = renderToStaticMarkup(
      <SubmitReadinessCard
        detail="Copy the visible URL manually."
        id="copy-feedback"
        label="Copy failed"
        liveMode="assertive"
        role="alert"
        tone="error"
      >
        <a href="/audit">Open audit</a>
      </SubmitReadinessCard>,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('<a href="/audit">Open audit</a>')
  })

  it('derives assertive alert semantics for error tone by default', () => {
    const markup = renderToStaticMarkup(
      <SubmitReadinessCard
        detail="The operation failed."
        id="error-feedback"
        label="Save failed"
        tone="error"
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
  })

  it('can consume a structured feedback model directly', () => {
    const markup = renderToStaticMarkup(
      <SubmitReadinessCard
        className="space-archive-feedback"
        id="space-archive-feedback"
        model={{
          feedbackDetail: 'The Space is hidden from new auto-routing decisions.',
          feedbackLabel: 'Space archived',
          feedbackTone: 'ready',
          liveMode: 'polite',
          role: 'status',
          visible: true,
        }}
      />,
    )

    expect(markup).toContain('class="submit-readiness-card space-archive-feedback tone-ready"')
    expect(markup).toContain('<strong>Space archived</strong>')
    expect(markup).toContain('<small>The Space is hidden from new auto-routing decisions.</small>')
  })

  it('lets callers add live-region semantics around partial feedback models', () => {
    const markup = renderToStaticMarkup(
      <SubmitReadinessCard
        id="space-create-feedback"
        model={{
          feedbackDetail: 'Name the Space before creating it.',
          feedbackLabel: 'Space name required',
          feedbackTone: 'blocked',
        }}
        liveMode="assertive"
        role="alert"
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
  })
})
