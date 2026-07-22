import { describe, expect, it } from 'vitest'

const forbiddenFocusableFilters = [
  ':not([aria-disabled])',
  'hasAttribute(\'aria-disabled\')',
  'hasAttribute("aria-disabled")',
  'getAttribute(\'aria-disabled\')',
  'getAttribute("aria-disabled")',
]

describe('focus trap accessibility selectors', () => {
  it('keeps aria-disabled controls in focus loops so disabled gates remain explainable', () => {
    const files = import.meta.glob<string>(['../app/**/*.tsx', '../components/**/*.tsx', '../features/**/*.tsx'], {
      eager: true,
      import: 'default',
      query: '?raw',
    })
    const violations = Object.entries(files).flatMap(([filePath, source]) =>
      forbiddenFocusableFilters.flatMap((pattern) => {
        const index = source.indexOf(pattern)
        if (index === -1) return []
        const line = source.slice(0, index).split('\n').length
        return `${filePath.replace('../', '')}:${line} uses ${pattern}`
      }),
    )

    expect(violations).toEqual([])
  })

  it('keeps migrated modal focus traps on the shared utility', () => {
    const files = import.meta.glob<string>(
      [
        '../app/AppShell.tsx',
        '../components/nexus/CitationPreviewPopover.tsx',
        '../components/nexus/CommandPalette.tsx',
        '../components/nexus/ConceptGuide.tsx',
        '../components/nexus/ConfirmDialog.tsx',
        '../components/nexus/SourcePreviewDrawer.tsx',
        '../features/spaces/CollectionsPage.tsx',
        './focusTrap.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const appShell = files['../app/AppShell.tsx']
    const citationPreview = files['../components/nexus/CitationPreviewPopover.tsx']
    const commandPalette = files['../components/nexus/CommandPalette.tsx']
    const conceptGuide = files['../components/nexus/ConceptGuide.tsx']
    const confirmDialog = files['../components/nexus/ConfirmDialog.tsx']
    const sourcePreviewDrawer = files['../components/nexus/SourcePreviewDrawer.tsx']
    const collectionsPage = files['../features/spaces/CollectionsPage.tsx']
    const utility = files['./focusTrap.ts']

    expect(utility).toContain('focusTrapFocusableSelector')
    expect(utility).toContain('resolveFocusTrapAction')
    expect(utility).toContain("'summary'")
    expect(utility).toContain("'iframe'")
    expect(appShell).toContain('@/lib/focusTrap')
    expect(appShell).not.toContain('railFocusableSelector')
    expect(appShell).not.toContain('document.activeElement === first')
    expect(appShell).not.toContain('className="rail-backdrop" onClick={closeMobileRailAndRestoreFocus} aria-controls')
    expect(appShell).not.toContain('className="rail-backdrop" onClick={closeMobileRailAndRestoreFocus} aria-label')
    expect(citationPreview).toContain('@/lib/focusTrap')
    expect(citationPreview).not.toContain("const focusableSelector = [")
    expect(commandPalette).toContain('@/lib/focusTrap')
    expect(commandPalette).not.toContain("querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href]')")
    expect(commandPalette).not.toContain('document.activeElement === first')
    expect(conceptGuide).toContain('@/lib/focusTrap')
    expect(conceptGuide).not.toContain('conceptGuideFocusableSelector')
    expect(conceptGuide).not.toContain('document.activeElement === first')
    expect(confirmDialog).toContain('@/lib/focusTrap')
    expect(confirmDialog).not.toContain("const focusableSelector = [")
    expect(confirmDialog).not.toContain('function focusableElements')
    expect(sourcePreviewDrawer).toContain('@/lib/focusTrap')
    expect(sourcePreviewDrawer).not.toContain('drawerFocusableSelector')
    expect(sourcePreviewDrawer).not.toContain('document.activeElement === first')
    expect(collectionsPage).toContain('@/lib/focusTrap')
    expect(collectionsPage).not.toContain("const focusableSelector = [")
    expect(collectionsPage).not.toContain('function focusableElements')
    expect(collectionsPage).not.toContain('document.activeElement === first')
  })
})
