import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('System page CSS loading boundary', () => {
  it('keeps production diagnostics and settings styles with the lazy System route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/system/SystemPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/system/SystemPage.tsx']
    const pageCss = readFileSync(new URL('../features/system/SystemPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const subnavCss = readFileSync(new URL('../components/nexus/Subnav.css', import.meta.url), 'utf8')

    expect(router).toContain("const SystemPage = lazy(() => import('@/features/system/SystemPage'))")
    expect(page).toContain("import './SystemPage.css'")
    expect(page).toContain("import { Subnav")
    expect(page).toContain('<Subnav active={tab}')
    expect(subnavCss).toContain('.subnav')
    expect(pageCss).toContain('.system-refresh-actions')
    expect(pageCss).toContain('.system-refresh-feedback')
    expect(pageCss).toContain('.system-grid')
    expect(pageCss).toContain('.system-overall')
    expect(pageCss).toContain('.health-card')
    expect(pageCss).toContain('.health-orb')
    expect(pageCss).toContain('.model-gateway-card')
    expect(pageCss).toContain('.diagnostic-disclosure')
    expect(pageCss).toContain('.backup-recovery-gate')
    expect(pageCss).toContain('.reconciliation-result-card')
    expect(pageCss).toContain('.operations-list')
    expect(pageCss).toContain('.two-column')
    expect(pageCss).toContain('.system-settings-layout')
    expect(pageCss).toContain('.safe-config-panel')
    expect(pageCss).toContain('.safe-config-pill')
    expect(pageCss).toContain('.appearance-options')
    expect(pageCss).toContain('html[data-theme="dark"] .safe-config-section')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.system-refresh-actions')
    expect(entryCss).not.toContain('.system-refresh-feedback')
    expect(entryCss).not.toMatch(/^\.system-/m)
    expect(entryCss).not.toMatch(/^\.health-card\b/m)
    expect(entryCss).not.toContain('.model-gateway-card')
    expect(entryCss).not.toMatch(/^\.diagnostic-/m)
    expect(entryCss).not.toMatch(/^\.backup-/m)
    expect(entryCss).not.toMatch(/^\.reconciliation-/m)
    expect(entryCss).not.toMatch(/^\.safe-config-/m)
    expect(entryCss).not.toMatch(/^\.appearance-/m)
    expect(entryCss).not.toContain('.operations-list')
    expect(entryCss).not.toContain('.two-column')
    expect(entryCss).not.toContain('.status-dot')
    expect(entryCss).not.toContain('.subnav')
  })
})
