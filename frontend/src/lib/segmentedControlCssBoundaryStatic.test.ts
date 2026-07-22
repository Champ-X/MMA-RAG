import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SegmentedControl CSS loading boundary', () => {
  it('keeps segmented filter styles with SegmentedControl instead of entry CSS', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/SegmentedControl.tsx',
        '../components/nexus/SegmentedControlViewModel.ts',
        '../app/**/*.tsx',
        '../features/**/*.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/SegmentedControl.tsx']
    const viewModel = files['../components/nexus/SegmentedControlViewModel.ts']
    const radioGroupKeyboard = readFileSync(new URL('./radioGroupKeyboard.ts', import.meta.url), 'utf8')
    const componentCss = readFileSync(new URL('../components/nexus/SegmentedControl.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import { resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(component).toContain("import { moveSegmentedControlValue } from './SegmentedControlViewModel'")
    expect(component).toContain("import './SegmentedControl.css'")
    expect(component).toContain('role="radiogroup"')
    expect(component).toContain('role="radio"')
    expect(component).toContain('options: ReadonlyArray<SegmentedControlOption<T>>')
    expect(component).toContain('aria-checked={value === option.value}')
    expect(component).toContain('tabIndex={value === option.value ? 0 : -1}')
    expect(component).toContain('resolveRadioGroupDirection(event.key)')
    expect(component).not.toContain("event.key === 'ArrowRight' || event.key === 'ArrowDown'")
    expect(component).not.toContain("event.key === 'ArrowLeft' || event.key === 'ArrowUp'")
    expect(component).not.toContain('aria-pressed')
    expect(viewModel).toContain('export function moveSegmentedControlValue')
    expect(viewModel).toContain('export type SegmentedControlOption')
    expect(viewModel).not.toContain("from './SegmentedControl'")
    expect(viewModel).toContain("from '@/lib/radioGroupKeyboard'")
    expect(viewModel).toContain('moveRadioGroupValue')
    expect(viewModel).not.toContain('(currentIndex + 1) % options.length')
    expect(radioGroupKeyboard).toContain('export function resolveRadioGroupDirection')
    expect(radioGroupKeyboard).toContain('export function moveRadioGroupValue')
    expect(componentCss).toContain('.segmented')
    expect(componentCss).toContain('.segmented button.active')
    expect(componentCss).toContain('html[data-theme="dark"] .segmented')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.segmented')

    const rogueOwners = Object.entries(files)
      .filter(([filePath]) => filePath !== '../components/nexus/SegmentedControl.tsx')
      .filter(([, source]) => source.includes('className="segmented"') || source.includes("className='segmented'"))
      .map(([filePath]) => filePath.replace('../', ''))
    expect(rogueOwners).toEqual([])
  })
})
