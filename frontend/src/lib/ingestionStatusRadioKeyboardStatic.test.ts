import { describe, expect, it } from 'vitest'

describe('ingestion status radio keyboard contract', () => {
  it('keeps ingestion status filters keyboard-operable as a radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/sources/IngestionJobsPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/sources/IngestionJobsPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('ingestionJobStatusFilterOrder')
    expect(page).toContain('const statusFilterRefs = useRef')
    expect(page).toContain('const handleStatusFilterKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(ingestionJobStatusFilterOrder, filter, direction)')
    expect(page).toContain('statusFilterRefs.current[nextFilter]?.focus({ preventScroll: true })')
    expect(page).toContain('className="job-status-ribbon" role="radiogroup" aria-label="Ingestion status filters"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={status.active}')
    expect(page).toContain('tabIndex={status.active ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleStatusFilterKeyDown}')
  })
})
