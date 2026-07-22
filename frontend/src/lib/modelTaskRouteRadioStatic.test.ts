import { describe, expect, it } from 'vitest'

describe('model task route radio keyboard contract', () => {
  it('keeps task route selection keyboard-operable as one radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/models/ModelsPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/models/ModelsPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('const roleRefs = useRef')
    expect(page).toContain('const handleRoleKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(taskRoles.map(([id]) => id), role, direction)')
    expect(page).toContain('roleRefs.current[nextRole]?.focus({ preventScroll: true })')
    expect(page).toContain('className="task-route-matrix" role="radiogroup" aria-label="Model task route role"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={role === id}')
    expect(page).toContain('tabIndex={role === id ? 0 : -1}')
    expect(page).toContain('onKeyDown={handleRoleKeyDown}')
    expect(page).not.toContain("onClick={() => { setRole(id); setDeploymentId('') }}")
  })
})
