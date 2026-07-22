import { describe, expect, it } from 'vitest'

describe('source connector radio keyboard contract', () => {
  it('keeps connector contract cards as one keyboard-operable radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/sources/SourcesPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/sources/SourcesPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('const connectorRefs = useRef')
    expect(page).toContain('const handleConnectorKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(connectorOptions.map((option) => option.kind), connectorKind, direction)')
    expect(page).toContain('connectorRefs.current[nextKind]?.focus({ preventScroll: true })')
    expect(page).toContain('className="source-contracts" role="radiogroup" aria-label="Source connector type"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={connectorKind === kind}')
    expect(page).toContain('tabIndex={connectorKind === kind ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleConnectorKeyDown}')
    expect(page).not.toContain('onClick={() => setConnectorKind(kind)}')
  })
})
