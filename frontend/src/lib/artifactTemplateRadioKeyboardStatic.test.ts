import { describe, expect, it } from 'vitest'

describe('artifact template radio keyboard contract', () => {
  it('keeps template selection as a keyboard-operable radio group', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactTemplateComposer.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/artifacts/ArtifactTemplateComposer.tsx']

    expect(component).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(component).toContain('const templateRefs = useRef')
    expect(component).toContain('const handleTemplateKeyDown')
    expect(component).toContain('resolveRadioGroupDirection(event.key)')
    expect(component).toContain('moveRadioGroupValue(templateItems.map((template) => template.id), templateId, direction)')
    expect(component).toContain('templateRefs.current[nextTemplate.id]?.focus({ preventScroll: true })')
    expect(component).toContain('className="artifact-template-grid" role="radiogroup" aria-label="Artifact template"')
    expect(component).toContain('role="radio"')
    expect(component).toContain('aria-checked={templateId === template.id}')
    expect(component).toContain('tabIndex={templateId === template.id ? 0 : -1}')
    expect(component).toContain('onKeyDown={handleTemplateKeyDown}')
    expect(component).not.toContain('aria-pressed={templateId === template.id}')
  })
})
