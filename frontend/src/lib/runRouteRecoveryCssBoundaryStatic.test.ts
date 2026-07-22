import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('run route recovery panel CSS loading boundary', () => {
  it('keeps route recovery styles with the lazy Run workspace component', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/RunRouteRecoveryPanel.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/runs/RunRouteRecoveryPanel.tsx']
    const componentCss = readFileSync(new URL('../features/runs/RunRouteRecoveryPanel.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './RunRouteRecoveryPanel.css'")
    expect(componentCss).toContain('.route-overview-card')
    expect(componentCss).toContain('.route-overview-signals')
    expect(componentCss).toContain('.route-current-audit')
    expect(componentCss).toContain('.route-recovery-action')
    expect(componentCss).toContain('html[data-theme="dark"] .route-overview-card')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.route-overview-card')
    expect(entryCss).not.toContain('.route-overview-signals')
    expect(entryCss).not.toContain('.route-current-audit')
    expect(entryCss).not.toContain('.route-recovery-action')
  })
})
