import { describe, expect, it } from 'vitest'

describe('AppShell navigation matching contract', () => {
  it('keeps advanced navigation active state on section-aware ViewModel rules', () => {
    const files = import.meta.glob<string>(
      [
        '../app/AppShell.tsx',
        '../app/appShellViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const viewModel = files['../app/appShellViewModel.ts']

    expect(appShell).toContain("matchPrefix: '/models'")
    expect(appShell).toContain("matchPrefix: '/system'")
    expect(appShell).toContain('resolveAppShellActiveNavItem(location.pathname, advancedItems)')
    expect(appShell).toContain('const isActive = activeAdvancedItem === to')
    expect(appShell).not.toContain("location.pathname.startsWith(item.to.split('/').slice(0, 2).join('/'))")
    expect(viewModel).toContain('export function resolveAppShellActiveNavItem')
    expect(viewModel).toContain('item.matchPrefix')
  })

  it('keeps global shortcuts from stealing editable field keystrokes', () => {
    const files = import.meta.glob<string>(
      [
        '../app/AppShell.tsx',
        '../app/appShellViewModel.ts',
        './keyboardShortcuts.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const viewModel = files['../app/appShellViewModel.ts']
    const shortcuts = files['./keyboardShortcuts.ts']

    expect(appShell).toContain("import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts'")
    expect(appShell).toContain('targetEditable: isEditableShortcutTarget(event.target)')
    expect(viewModel).not.toContain('isEditableShortcutTarget')
    expect(viewModel).toContain('targetEditable')
    expect(shortcuts).toContain('export function isEditableShortcutTarget')
    expect(shortcuts).toContain("['INPUT', 'TEXTAREA', 'SELECT']")
  })
})
