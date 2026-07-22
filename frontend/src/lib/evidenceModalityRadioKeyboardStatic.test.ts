import { describe, expect, it } from 'vitest'

describe('evidence modality radio keyboard contract', () => {
  it('keeps Evidence modality filters as a keyboard-operable radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/evidence/EvidenceBrowserPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/evidence/EvidenceBrowserPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('const modalityRefs = useRef')
    expect(page).toContain('const handleModalityKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(evidenceModalityOptions.map((option) => option.id), selectedModality, direction)')
    expect(page).toContain('modalityRefs.current[nextModality]?.focus({ preventScroll: true })')
    expect(page).toContain('className="modality-ledger" role="radiogroup" aria-label="Filter by modality"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={selectedModality === option.id}')
    expect(page).toContain('tabIndex={selectedModality === option.id ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleModalityKeyDown}')
    expect(page).not.toContain('aria-pressed={selectedModality === option.id}')
  })
})
