import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Spaces page CSS loading boundary', () => {
  it('keeps Space creation and Space card styles with the lazy Spaces route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/spaces/SpacesPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/spaces/SpacesPage.tsx']
    const pageCss = readFileSync(new URL('../features/spaces/SpacesPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const SpacesPage = lazy(() => import('@/features/spaces/SpacesPage'))")
    expect(page).toContain("import './SpacesPage.css'")
    expect(pageCss).toContain('.space-create-sheet')
    expect(pageCss).toContain('.space-create-fields')
    expect(pageCss).toContain('.policy-picker')
    expect(pageCss).toContain('.policy-option')
    expect(pageCss).toContain('.space-grid')
    expect(pageCss).toContain('.space-card')
    expect(pageCss).toContain('.space-card-cover')
    expect(pageCss).toContain('.space-card-actions')
    expect(pageCss).toContain('.space-modality-row')
    expect(pageCss).toContain('.card-link')
    expect(pageCss).toContain('html[data-theme="dark"] .policy-option.selected')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.space-create-sheet')
    expect(entryCss).not.toContain('.space-create-fields')
    expect(entryCss).not.toContain('.policy-picker')
    expect(entryCss).not.toContain('.policy-option')
    expect(entryCss).not.toMatch(/^\.space-grid\b/m)
    expect(entryCss).not.toMatch(/^\.space-card\b/m)
    expect(entryCss).not.toContain('.space-card-cover')
    expect(entryCss).not.toContain('.space-card-actions')
    expect(entryCss).not.toContain('.space-modality-row')
    expect(entryCss).not.toContain('.space-cover-masthead')
    expect(entryCss).not.toContain('.space-policy-band')
    expect(entryCss).not.toContain('.space-material-copy')
    expect(entryCss).not.toContain('.collection-card')
    expect(entryCss).not.toContain('.submit-readiness-card')
  })
})
