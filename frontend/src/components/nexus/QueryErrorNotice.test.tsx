import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueryErrorNotice } from './QueryErrorNotice'

describe('QueryErrorNotice', () => {
  it('renders blocking query failures as alerts with retry affordance', () => {
    const markup = renderToStaticMarkup(
      <QueryErrorNotice
        model={{
          actionLabel: 'Retry control plane',
          detail: 'Spaces: Network offline',
          label: 'Nexus could not load Spaces.',
          role: 'alert',
          tone: 'blocking',
          visible: true,
        }}
        onRetry={() => undefined}
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('Nexus could not load Spaces.')
    expect(markup).toContain('Retry control plane')
  })

  it('renders nothing when hidden', () => {
    expect(renderToStaticMarkup(
      <QueryErrorNotice
        model={{
          actionLabel: 'Retry',
          detail: '',
          label: '',
          role: 'status',
          tone: 'inline',
          visible: false,
        }}
        onRetry={() => undefined}
      />,
    )).toBe('')
  })
})
