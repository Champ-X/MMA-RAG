import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelNote } from './PanelNote'

describe('PanelNote', () => {
  it('defaults to header-aligned note copy', () => {
    const markup = renderToStaticMarkup(<PanelNote>Authoritative data only.</PanelNote>)

    expect(markup).toContain('class="panel-note align-end"')
    expect(markup).toContain('Authoritative data only.')
  })

  it('supports body-aligned note copy', () => {
    const markup = renderToStaticMarkup(<PanelNote align="start">No chunks yet.</PanelNote>)

    expect(markup).toContain('class="panel-note align-start"')
  })
})
