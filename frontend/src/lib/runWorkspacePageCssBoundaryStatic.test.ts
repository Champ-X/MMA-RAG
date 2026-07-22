import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('run workspace page CSS loading boundary', () => {
  it('keeps full Run workspace page styles with the lazy route while preserving skeleton shell styles eagerly', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/RunWorkspacePage.tsx',
        '../features/runs/RunWorkspaceSkeleton.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/RunWorkspacePage.tsx']
    const skeleton = files['../features/runs/RunWorkspaceSkeleton.tsx']
    const pageCss = readFileSync(new URL('../features/runs/RunWorkspacePage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(page).toContain("import './RunWorkspacePage.css'")
    expect(skeleton).toContain('run-workspace run-workspace-skeleton')
    expect(pageCss).toContain('.conversation-workspace')
    expect(pageCss).toContain('.conversation-turns')
    expect(pageCss).toContain('.process-details')
    expect(pageCss).toContain('.query-understanding')
    expect(pageCss).toContain('.evidence-drawer-toggle')
    expect(pageCss).toContain('.follow-up-composer')
    expect(pageCss).toContain('.follow-up-composer .catalog-model-picker')
    expect(pageCss).toContain('.inline-citation')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).toContain('.run-workspace')
    expect(entryCss).toContain('.run-workspace-skeleton')
    expect(entryCss).toContain('.skeleton-panel')
    expect(entryCss).toContain('.run-topbar')
    expect(entryCss).toContain('.run-columns')
    expect(entryCss).toContain('.run-plan-column')
    expect(entryCss).toContain('.run-result-column')
    expect(entryCss).toContain('.column-head')
    expect(entryCss).toContain('.citation-preview-loading')
    expect(entryCss).not.toContain('.conversation-workspace')
    expect(entryCss).not.toContain('.conversation-turns')
    expect(entryCss).not.toContain('.query-understanding')
    expect(entryCss).not.toContain('.evidence-drawer-toggle')
    expect(entryCss).not.toContain('.follow-up-composer')
    expect(entryCss).not.toContain('.follow-up-composer .catalog-model-picker')
    expect(entryCss).not.toContain('.inline-citation')
  })
})
