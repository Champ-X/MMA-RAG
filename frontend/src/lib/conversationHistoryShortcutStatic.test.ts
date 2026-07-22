import { describe, expect, it } from 'vitest'

describe('conversation history search shortcut boundary', () => {
  it('keeps slash shortcut ownership in the conversation history ViewModel', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/ConversationHistoryPage.tsx',
        '../features/runs/conversationHistory.ts',
        './keyboardShortcuts.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/ConversationHistoryPage.tsx']
    const viewModel = files['../features/runs/conversationHistory.ts']
    const shortcuts = files['./keyboardShortcuts.ts']

    expect(page).toContain('shouldFocusConversationSearch({')
    expect(page).not.toContain("['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)")
    expect(viewModel).toContain("import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts'")
    expect(viewModel).toContain('isEditableShortcutTarget(target)')
    expect(viewModel).toContain("key === '/'")
    expect(viewModel).not.toContain('@/app/appShellViewModel')
    expect(shortcuts).toContain('export function isEditableShortcutTarget')
  })
})
