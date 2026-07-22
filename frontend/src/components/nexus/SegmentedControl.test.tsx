import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

describe('SegmentedControl', () => {
  it('renders a single-choice filter as a radio group with option detail', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="Artifact status filter"
        value="all"
        options={[
          { value: 'all', label: 'All', detail: 'Every item.' },
          { value: 'attention', label: 'Needs review', detail: 'Review required.' },
        ]}
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('class="segmented"')
    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('aria-label="Artifact status filter"')
    expect(markup).toContain('role="radio"')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).not.toContain('aria-pressed')
    expect(markup).toContain('title="Review required."')
    expect(markup).toContain('<button type="button"')
  })
})
