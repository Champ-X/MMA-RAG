import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Models page CSS loading boundary', () => {
  it('keeps model gateway page, provider, catalog, and route styles with the lazy Models route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/models/ModelsPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/models/ModelsPage.tsx']
    const pageCss = readFileSync(new URL('../features/models/ModelsPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const subnavCss = readFileSync(new URL('../components/nexus/Subnav.css', import.meta.url), 'utf8')
    const panelNoteCss = readFileSync(new URL('../components/nexus/PanelNote.css', import.meta.url), 'utf8')

    expect(router).toContain("const ModelsPage = lazy(() => import('@/features/models/ModelsPage'))")
    expect(page).toContain("import './ModelsPage.css'")
    expect(page).toContain("import { Subnav")
    expect(page).toContain('<Subnav active={tab}')
    expect(page).toContain("import { PanelNote")
    expect(page).toContain('<PanelNote>')
    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('className="task-route-matrix" role="radiogroup" aria-label="Model task route role"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={role === id}')
    expect(page).toContain('tabIndex={role === id ? 0 : -1}')
    expect(subnavCss).toContain('.subnav')
    expect(panelNoteCss).toContain('.panel-note')
    expect(pageCss).toContain('.model-gateway-page')
    expect(pageCss).toContain('.model-gateway-summary')
    expect(pageCss).toContain('.model-subnav')
    expect(pageCss).toContain('.advanced-model-form .inline-form')
    expect(pageCss).toContain('.provider-card-grid')
    expect(pageCss).toContain('.provider-card')
    expect(pageCss).toContain('.model-brand-mark')
    expect(pageCss).toContain('.catalog-toolbar')
    expect(pageCss).toContain('.model-catalog-card')
    expect(pageCss).toContain('.capability-stack')
    expect(pageCss).toContain('.task-route-matrix')
    expect(pageCss).toContain('.route-composer')
    expect(pageCss).toContain('.route-composer .catalog-model-picker')
    expect(pageCss).toContain('.route-drafts')
    expect(pageCss).toContain('html[data-theme="dark"] .model-catalog-card')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (max-width: 520px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toMatch(/^\.model-gateway-page\b/m)
    expect(entryCss).not.toMatch(/^\.model-gateway-summary\b/m)
    expect(entryCss).not.toMatch(/^\.model-subnav\b/m)
    expect(entryCss).not.toContain('.subnav')
    expect(entryCss).not.toContain('.panel-note')
    expect(entryCss).not.toContain('.inline-form')
    expect(entryCss).not.toMatch(/^\.provider-card\b/m)
    expect(entryCss).not.toMatch(/^\.provider-card-grid\b/m)
    expect(entryCss).not.toMatch(/^\.model-brand-mark\b/m)
    expect(entryCss).not.toMatch(/^\.catalog-toolbar\b/m)
    expect(entryCss).not.toMatch(/^\.model-catalog-card\b/m)
    expect(entryCss).not.toMatch(/^\.capability-stack\b/m)
    expect(entryCss).not.toMatch(/^\.task-route-matrix\b/m)
    expect(entryCss).not.toMatch(/^\.route-composer\b/m)
    expect(entryCss).not.toMatch(/^\.route-drafts\b/m)
    expect(entryCss).not.toContain('.route-composer .catalog-model-picker')
    expect(entryCss).not.toContain('.model-catalog-card:hover')
    expect(entryCss).not.toContain('.model-gateway-card')
  })
})
