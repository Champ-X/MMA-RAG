import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Artifact detail page CSS loading boundary', () => {
  it('keeps Artifact lifecycle, delivery, and editor styles with the lazy detail route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/artifacts/ArtifactPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/artifacts/ArtifactPage.tsx']
    const pageCss = readFileSync(new URL('../features/artifacts/ArtifactPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const ArtifactPage = lazy(() => import('@/features/artifacts/ArtifactPage'))")
    expect(page).toContain("import './ArtifactPage.css'")
    expect(pageCss).toContain('.artifact-back-link')
    expect(pageCss).toContain('.artifact-actions')
    expect(pageCss).toContain('.artifact-draft-beacon')
    expect(pageCss).toContain('.artifact-release-dossier')
    expect(pageCss).toContain('.artifact-readiness')
    expect(pageCss).toContain('.artifact-readiness > .artifact-coverage-meter')
    expect(pageCss).toContain('.artifact-delivery-dock')
    expect(pageCss).toContain('.artifact-delivery-card')
    expect(pageCss).toContain('.artifact-json-editor')
    expect(pageCss).toContain('.artifact-editor-frame')
    expect(pageCss).toContain('.refresh-proposal')
    expect(pageCss).toContain('.refresh-proposal .button-group')
    expect(pageCss).toContain('html[data-theme="dark"] .artifact-release-dossier')
    expect(pageCss).toContain('html[data-theme="dark"] .artifact-delivery-card')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toMatch(/^\.artifact-back-link\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-actions\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-draft-beacon\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-release-/m)
    expect(entryCss).not.toMatch(/^\.artifact-readiness\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-delivery-/m)
    expect(entryCss).not.toMatch(/^\.artifact-json-/m)
    expect(entryCss).not.toMatch(/^\.artifact-editor-frame\b/m)
    expect(entryCss).not.toMatch(/^\.refresh-proposal\b/m)
    expect(entryCss).not.toContain('.button-group')
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-release-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-delivery-/m)
    expect(entryCss).not.toContain('.artifact-draft-beacon:hover')
    expect(entryCss).not.toContain('.artifact-delivery-card:hover')
    expect(entryCss).not.toContain('.artifact-json-editor-tools .button:hover')
  })
})
