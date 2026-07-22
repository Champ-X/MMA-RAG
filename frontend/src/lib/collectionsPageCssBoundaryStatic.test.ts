import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Collections page CSS loading boundary', () => {
  it('keeps saved-view shelf and creation dialog styles with the lazy Collections route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/spaces/CollectionsPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/spaces/CollectionsPage.tsx']
    const pageCss = readFileSync(new URL('../features/spaces/CollectionsPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const CollectionsPage = lazy(() => import('@/features/spaces/CollectionsPage'))")
    expect(page).toContain("import './CollectionsPage.css'")
    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('className="collection-kind-choice" role="radiogroup"')
    expect(page).toContain('className="collection-color-choice" role="radiogroup"')
    expect(page).toContain('aria-checked={viewKind ===')
    expect(page).toContain('aria-checked={color === item}')
    expect(page).not.toContain('aria-pressed={viewKind ===')
    expect(page).not.toContain('aria-pressed={color === item}')
    expect(pageCss).toContain('.collection-signal-strip')
    expect(pageCss).toContain('.collections-layout')
    expect(pageCss).toContain('.collection-card')
    expect(pageCss).toContain('.collection-card-cover')
    expect(pageCss).toContain('.collection-inspector')
    expect(pageCss).toContain('.collection-rule-summary')
    expect(pageCss).toContain('.collection-source-picker')
    expect(pageCss).toContain('.collection-resolved-list')
    expect(pageCss).toContain('.collection-create-backdrop')
    expect(pageCss).toContain('.collection-create-sheet')
    expect(pageCss).toContain('.collection-create-materials .material-cover')
    expect(pageCss).toContain('html[data-theme="dark"] .collection-create-materials button')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.collection-signal-strip')
    expect(entryCss).not.toContain('.collections-layout')
    expect(entryCss).not.toContain('.collection-card')
    expect(entryCss).not.toContain('.collection-card-cover')
    expect(entryCss).not.toContain('.collection-inspector')
    expect(entryCss).not.toContain('.collection-rule-summary')
    expect(entryCss).not.toContain('.collection-source-picker')
    expect(entryCss).not.toContain('.collection-resolved-list')
    expect(entryCss).not.toContain('.modal-backdrop')
    expect(entryCss).not.toContain('.collection-create-backdrop')
    expect(entryCss).not.toContain('.collection-create-sheet')
    expect(entryCss).not.toContain('.collection-create-materials')
    expect(entryCss).not.toContain('.submit-readiness-card')
    expect(entryCss).not.toContain('.source-type')
  })
})
