import { describe, expect, it } from 'vitest'

describe('system appearance radio keyboard contract', () => {
  it('keeps appearance preference cards keyboard-operable with shared radio semantics', () => {
    const files = import.meta.glob<string>(
      ['../features/system/SystemPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/system/SystemPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('const appearanceRefs = useRef')
    expect(page).toContain('const handleAppearanceKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(appearanceOptions.map((option) => option.value), preference, direction)')
    expect(page).toContain('appearanceRefs.current[nextPreference]?.focus({ preventScroll: true })')
    expect(page).toContain('role="radiogroup" aria-label="Workspace appearance"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('tabIndex={preference === value ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleAppearanceKeyDown}')
    expect(page).not.toContain('onClick={() => setPreference(value)}')
  })
})
