import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('pending attachment tray CSS loading boundary', () => {
  it('keeps queued attachment tray styles with the shared tray component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/PendingAttachmentTray.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/PendingAttachmentTray.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/PendingAttachmentTray.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './PendingAttachmentTray.css'")
    expect(componentCss).toContain('.queued-attachments')
    expect(componentCss).toContain('.queued-attachment')
    expect(componentCss).toContain('.queued-attachment-visual')
    expect(componentCss).toContain('@media (max-width: 520px)')
    expect(entryCss).not.toContain('.research-attachment-trigger')
    expect(entryCss).not.toContain('.queued-attachments')
    expect(entryCss).not.toContain('.queued-attachment')
    expect(entryCss).not.toContain('.attachment-composer')
    expect(entryCss).not.toContain('.attachment-add')
    expect(entryCss).not.toContain('.attachment-tile')
  })
})
