import { describe, expect, it } from 'vitest'

describe('collection creation radio keyboard contract', () => {
  it('keeps saved-view behavior and marker choices as keyboard-operable radio groups', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/CollectionsPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/spaces/CollectionsPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain("const collectionViewKinds = ['manual', 'dynamic'] as const")
    expect(page).toContain('const viewKindRefs = useRef')
    expect(page).toContain('const colorRefs = useRef')
    expect(page).toContain('const handleViewKindKeyDown')
    expect(page).toContain('const handleColorKeyDown')
    expect(page).toContain('moveRadioGroupValue(collectionViewKinds, viewKind, direction)')
    expect(page).toContain('moveRadioGroupValue(colors, color, direction)')
    expect(page).toContain('viewKindRefs.current[nextViewKind]?.focus({ preventScroll: true })')
    expect(page).toContain('colorRefs.current[nextColor]?.focus({ preventScroll: true })')
    expect(page).toContain('className="collection-kind-choice" role="radiogroup" aria-label="Collection view behavior"')
    expect(page).toContain('className="collection-color-choice" role="radiogroup" aria-label="Collection visual marker"')
    expect(page).toContain('aria-checked={viewKind ===')
    expect(page).toContain('aria-checked={color === item}')
    expect(page).toContain('tabIndex={viewKind ===')
    expect(page).toContain('tabIndex={color === item ? 0 : -1}')
    expect(page).not.toContain('aria-pressed={viewKind ===')
    expect(page).not.toContain('aria-pressed={color === item}')
  })
})
