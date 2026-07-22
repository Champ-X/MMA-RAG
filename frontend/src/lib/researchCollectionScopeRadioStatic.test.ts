import { describe, expect, it } from 'vitest'

describe('research collection scope radio keyboard contract', () => {
  it('keeps optional collection scope as a keyboard reachable single-choice group', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/ResearchNewPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/ResearchNewPage.tsx']

    expect(page).toContain("const entireSpaceCollectionScopeValue = '__entire_space__'")
    expect(page).toContain('const collectionScopeRefs = useRef')
    expect(page).toContain('const collectionScopeOptions = [entireSpaceCollectionScopeValue')
    expect(page).toContain('const selectedCollectionScope = selectedCollection || entireSpaceCollectionScopeValue')
    expect(page).toContain('const selectCollectionScope = (nextScope: string) =>')
    expect(page).toContain('const handleCollectionScopeKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(collectionScopeOptions, selectedCollectionScope, direction)')
    expect(page).toContain('focusRadio(collectionScopeRefs.current, nextScope)')
    expect(page).toContain('className="collection-scope-choice" role="radiogroup" aria-label="Collection scope"')
    expect(page).toContain('role="radio" aria-checked={!selectedCollection}')
    expect(page).toContain('tabIndex={!selectedCollection ? 0 : -1}')
    expect(page).toContain('role="radio" aria-checked={selected}')
    expect(page).toContain('tabIndex={selected ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleCollectionScopeKeyDown}')
    expect(page).toContain('onClick={() => selectCollectionScope(entireSpaceCollectionScopeValue)}')
    expect(page).toContain('onClick={() => selectCollectionScope(collection.id)}')
    expect(page).not.toContain("onClick={() => setSelectedCollection('')}>Entire Space")
    expect(page).not.toContain('onClick={() => setSelectedCollection(collection.id)}')
  })
})
