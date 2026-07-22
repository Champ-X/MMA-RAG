import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Studio page CSS loading boundary', () => {
  it('keeps Studio page chrome and artifact cards with the lazy Studio route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/artifacts/StudioPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/artifacts/StudioPage.tsx']
    const pageCss = readFileSync(new URL('../features/artifacts/StudioPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const StudioPage = lazy(() => import('@/features/artifacts/StudioPage'))")
    expect(page).toContain("import './StudioPage.css'")
    expect(pageCss).toContain('.studio-release-gate')
    expect(pageCss).toContain('.studio-summary')
    expect(pageCss).toContain('.studio-toolbar')
    expect(pageCss).toContain('.artifact-grid')
    expect(pageCss).toContain('.artifact-card')
    expect(pageCss).toContain('.artifact-card-gate')
    expect(pageCss).toContain('.artifact-card-note')
    expect(pageCss).toContain('html[data-theme="dark"] .studio-toolbar > label')
    expect(pageCss).toContain('html[data-theme="dark"] .artifact-card-gate')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toMatch(/^\.studio-/m)
    expect(entryCss).not.toMatch(/^\.artifact-grid\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-card\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-card-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.studio-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-card-/m)
    expect(entryCss).not.toContain('.artifact-card:hover')
  })
})
