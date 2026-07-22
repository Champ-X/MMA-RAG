import { describe, expect, it } from 'vitest'

describe('research setup radio keyboard contract', () => {
  it('keeps high-impact Run setup choices on APG radio keyboard semantics', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/ResearchNewPage.tsx',
        '../features/runs/researchNewPageViewModel.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/ResearchNewPage.tsx']
    const viewModel = files['../features/runs/researchNewPageViewModel.ts']

    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('resolveRadioGroupDirection')
    expect(page).toContain('moveRadioGroupValue')
    expect(page).toContain('resolveResearchExecutionChoice')
    expect(page).toContain('role="radiogroup" aria-label="Space routing mode"')
    expect(page).toContain('role="radiogroup" aria-labelledby={researchQualityLegendId}')
    expect(page).toContain('role="radiogroup" aria-label="Execution depth"')
    expect(page).toContain('tabIndex={autoRoute ? 0 : -1}')
    expect(page).toContain('tabIndex={!autoRoute ? 0 : -1}')
    expect(page).toContain('tabIndex={quality === option.value ? 0 : -1}')
    expect(page).toContain("tabIndex={kind === 'quick' ? 0 : -1}")
    expect(page).toContain("tabIndex={kind === 'research' ? 0 : -1}")
    expect(page).toContain('onKeyDown={handleScopeModeKeyDown}')
    expect(page).toContain('onKeyDown={handleQualityKeyDown}')
    expect(page).toContain('onKeyDown={handleExecutionKeyDown}')
    expect(page).not.toContain("setKind('quick'); if (quality === 'deep') setQuality('quality')")
    expect(page).not.toContain("setKind('research'); setQuality('deep')")

    expect(viewModel).toContain('export function resolveResearchExecutionChoice')
    expect(viewModel).not.toContain('resolveResearchRadioDirection')
    expect(viewModel).not.toContain('moveResearchRadioValue')
    expect(viewModel).not.toContain("key === 'ArrowRight' || key === 'ArrowDown'")
    expect(viewModel).not.toContain("key === 'ArrowLeft' || key === 'ArrowUp'")
  })
})
