import { describe, expect, it } from 'vitest'

describe('conversation history status radio contract', () => {
  it('keeps Active and Archived history filters keyboard-operable as a radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/ConversationHistoryPage.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/ConversationHistoryPage.tsx']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain("const conversationStatusFilters = ['active', 'archived'] as const")
    expect(page).toContain('const statusFilterRefs = useRef')
    expect(page).toContain('const handleStatusFilterKeyDown')
    expect(page).toContain('resolveRadioGroupDirection(event.key)')
    expect(page).toContain('moveRadioGroupValue(conversationStatusFilters, selectedStatusFilter, direction)')
    expect(page).toContain('statusFilterRefs.current[nextFilter]?.focus({ preventScroll: true })')
    expect(page).toContain('className="history-view-switch" role="radiogroup" aria-label="Conversation status"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={!showArchived}')
    expect(page).toContain('aria-checked={showArchived}')
    expect(page).toContain('tabIndex={!showArchived ? 0 : -1}')
    expect(page).toContain('tabIndex={showArchived ? 0 : -1}')
    expect(page).not.toContain('onClick={() => setShowArchived(false)}')
    expect(page).not.toContain('onClick={() => setShowArchived(true)}')
  })
})
