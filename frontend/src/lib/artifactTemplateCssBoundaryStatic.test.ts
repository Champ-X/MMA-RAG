import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('artifact template composer CSS loading boundary', () => {
  it('keeps ArtifactTemplateComposer styles with the lazy Studio child component', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactTemplateComposer.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/artifacts/ArtifactTemplateComposer.tsx']
    const componentCss = readFileSync(new URL('../features/artifacts/ArtifactTemplateComposer.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const panelNoteCss = readFileSync(new URL('../components/nexus/PanelNote.css', import.meta.url), 'utf8')

    expect(component).toContain("import './ArtifactTemplateComposer.css'")
    expect(component).toContain("import { PanelNote")
    expect(component).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(component).toContain('className="artifact-template-grid" role="radiogroup"')
    expect(component).toContain('role="radio"')
    expect(component).toContain('aria-checked={templateId === template.id}')
    expect(component).not.toContain('aria-pressed={templateId === template.id}')
    expect(component).toContain('<PanelNote align="start">')
    expect(panelNoteCss).toContain('.panel-note.align-start')
    expect(componentCss).toContain('.artifact-template-composer')
    expect(componentCss).toContain('.artifact-template-grid')
    expect(componentCss).toContain('.artifact-template-fields')
    expect(componentCss).toContain('.artifact-template-empty')
    expect(componentCss).toContain('html[data-theme="dark"] .artifact-template-composer > footer')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toMatch(/^\.artifact-template-/m)
    expect(entryCss).not.toMatch(/^\s+\.artifact-template-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-template-/m)
    expect(entryCss).not.toContain('.panel-note')
  })
})
