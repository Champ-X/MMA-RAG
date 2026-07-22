import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunModelFallbackNotice } from './RunModelFallbackNotice'
import type { RunModelFallbackViewModel } from './runModelFallbackViewModel'

describe('RunModelFallbackNotice', () => {
  it('renders fallback state as a non-blocking status message', () => {
    const model: RunModelFallbackViewModel = {
      detail: 'The active model route did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.',
      failures: ['ReadTimeout · route 019f7a79 · deployment 019f7a45'],
      label: 'Model route fallback used',
      modelLabel: 'extractive-local-v1',
      role: 'status',
      tone: 'fallback',
      visible: true,
    }

    const markup = renderToStaticMarkup(<RunModelFallbackNotice model={model} />)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-label="Model route fallback used"')
    expect(markup).toContain('Model route fallback used')
    expect(markup).toContain('ReadTimeout · route 019f7a79 · deployment 019f7a45')
    expect(markup).toContain('extractive-local-v1')
  })

  it('renders nothing when hidden', () => {
    const model: RunModelFallbackViewModel = {
      detail: '',
      failures: [],
      label: '',
      modelLabel: '',
      role: 'status',
      tone: 'fallback',
      visible: false,
    }

    expect(renderToStaticMarkup(<RunModelFallbackNotice model={model} />)).toBe('')
  })

  it('renders legacy blocked states as assertive alerts', () => {
    const model: RunModelFallbackViewModel = {
      detail: 'Every deployment in the active Model Route failed. Evidence and trace were preserved.',
      failures: ['ReadTimeout · deployment 019f7a45'],
      label: 'Capability unavailable',
      modelLabel: 'No answer model completed',
      role: 'alert',
      tone: 'blocked',
      visible: true,
    }

    const markup = renderToStaticMarkup(<RunModelFallbackNotice model={model} />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('Capability unavailable')
  })
})
