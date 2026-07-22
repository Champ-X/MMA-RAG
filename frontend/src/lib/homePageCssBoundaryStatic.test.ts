import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Home page CSS loading boundary', () => {
  it('keeps onboarding and dashboard styles with the lazy Home route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/home/HomePage.tsx',
        '../features/home/GettingStarted.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/home/HomePage.tsx']
    const guide = files['../features/home/GettingStarted.tsx']
    const pageCss = readFileSync(new URL('../features/home/HomePage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const HomePage = lazy(() => import('@/features/home/HomePage'))")
    expect(page).toContain("import './HomePage.css'")
    expect(guide).toContain('getting-started')
    expect(pageCss).toContain('.getting-started')
    expect(pageCss).toContain('.guide-progress')
    expect(pageCss).toContain('.getting-started-steps')
    expect(pageCss).toContain('.home-thesis')
    expect(pageCss).toContain('.evidence-seam')
    expect(pageCss).toContain('.dashboard-grid')
    expect(pageCss).toContain('.run-row')
    expect(pageCss).toContain('.space-stack')
    expect(pageCss).toContain('.health-stack')
    expect(pageCss).toContain('html[data-theme="dark"] .getting-started')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.getting-started')
    expect(entryCss).not.toContain('.guide-progress')
    expect(entryCss).not.toContain('.getting-started-steps')
    expect(entryCss).not.toContain('.home-thesis')
    expect(entryCss).not.toContain('.evidence-seam')
    expect(entryCss).not.toContain('.dashboard-grid')
    expect(entryCss).not.toMatch(/^\.run-row\b/m)
    expect(entryCss).not.toContain('.space-stack')
    expect(entryCss).not.toContain('.health-stack')
    expect(entryCss).toContain('.page-shell')
    expect(entryCss).toContain('.panel')
    expect(entryCss).not.toContain('.submit-readiness-card')
  })
})
