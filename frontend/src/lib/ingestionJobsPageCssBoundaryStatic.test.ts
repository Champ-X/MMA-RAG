import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Ingestion jobs page CSS loading boundary', () => {
  it('keeps durable ingestion timeline styles with the lazy IngestionJobs route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/sources/IngestionJobsPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/sources/IngestionJobsPage.tsx']
    const pageCss = readFileSync(new URL('../features/sources/IngestionJobsPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const IngestionJobsPage = lazy(() => import('@/features/sources/IngestionJobsPage'))")
    expect(page).toContain("import './IngestionJobsPage.css'")
    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('className="job-status-ribbon" role="radiogroup" aria-label="Ingestion status filters"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={status.active}')
    expect(page).toContain('tabIndex={status.active ? 0 : -1}')
    expect(pageCss).toContain('.ingestion-refresh-actions')
    expect(pageCss).toContain('.ingestion-refresh-feedback')
    expect(pageCss).toContain('.job-status-ribbon')
    expect(pageCss).toContain('.job-audit-link')
    expect(pageCss).toContain('.job-arrival-receipt')
    expect(pageCss).toContain('.ingestion-job-action-feedback')
    expect(pageCss).toContain('.job-empty-state')
    expect(pageCss).toContain('.jobs-workspace')
    expect(pageCss).toContain('.job-ledger')
    expect(pageCss).toContain('.job-inspector')
    expect(pageCss).toContain('.job-recovery-briefing')
    expect(pageCss).toContain('.job-stage-track')
    expect(pageCss).toContain('.job-event-timeline')
    expect(pageCss).toContain('.job-event-payload')
    expect(pageCss).toContain('html[data-theme="dark"] .job-arrival-receipt')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.ingestion-refresh-actions')
    expect(entryCss).not.toContain('.ingestion-refresh-feedback')
    expect(entryCss).not.toMatch(/^\.job-/m)
    expect(entryCss).not.toContain('.jobs-workspace')
    expect(entryCss).not.toContain('html[data-theme="dark"] .job-')
    expect(entryCss).not.toContain('.collections-layout')
  })
})
