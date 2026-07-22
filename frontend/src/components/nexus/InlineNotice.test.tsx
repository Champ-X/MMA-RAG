import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InlineNotice } from './InlineNotice'

describe('InlineNotice', () => {
  it('renders negative notices as alerts by default', () => {
    const markup = renderToStaticMarkup(
      <InlineNotice tone="negative">
        <strong>Save failed</strong>
        <span>Review the latest revision.</span>
      </InlineNotice>,
    )

    expect(markup).toContain('class="notice negative"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('<strong>Save failed</strong>')
  })

  it('allows status semantics for non-blocking notices', () => {
    const markup = renderToStaticMarkup(
      <InlineNotice tone="negative" role="status">
        Non-blocking background save failed.
      </InlineNotice>,
    )

    expect(markup).toContain('role="status"')
  })
})
