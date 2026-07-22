import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('entry CSS hygiene', () => {
  it('does not keep retired global selectors in the eager stylesheet', () => {
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(entryCss).not.toContain('.filter-bar')
    expect(entryCss).not.toContain('.stop-reason')
    expect(entryCss).not.toContain('.lifecycle-feedback')
  })

  it('keeps dynamically generated run stream states available for the skeleton and live route', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/RunWorkspacePage.tsx',
        '../features/runs/RunWorkspaceSkeleton.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(files['../features/runs/RunWorkspacePage.tsx']).toContain('stream-${streamState}')
    expect(files['../features/runs/RunWorkspaceSkeleton.tsx']).toContain('stream-connecting')
    expect(entryCss).toContain('.stream-state')
    expect(entryCss).toContain('.stream-open')
    expect(entryCss).toContain('.stream-error')
  })
})
