import { describe, expect, it } from 'vitest'

describe('space policy radio keyboard contract', () => {
  it('keeps Space creation policy cards keyboard-operable with shared radio semantics', () => {
    const files = import.meta.glob<string>(
      ['../features/spaces/SpacesPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/spaces/SpacesPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('const policyRefs = useRef')
    expect(page).toContain('const handlePolicyKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(spacePolicyTemplates.map((policy) => policy.profile), profile, direction)')
    expect(page).toContain('policyRefs.current[nextProfile]?.focus({ preventScroll: true })')
    expect(page).toContain('role="radiogroup" aria-label="Space usage strategy"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('tabIndex={profile === policy.profile ? 0 : -1}')
    expect(page).toContain('onKeyDown={handlePolicyKeyDown}')
    expect(page).not.toContain("onClick={() => setProfile(policy.profile)}")
  })
})
