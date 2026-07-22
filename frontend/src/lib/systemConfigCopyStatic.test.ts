import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  ['../features/system/systemConfigViewModel.ts'],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

describe('system config copy contract', () => {
  it('keeps Settings copy framed as operator-visible configuration, not raw redaction', () => {
    const source = files['../features/system/systemConfigViewModel.ts']
    expect(typeof source).toBe('string')
    const lower = source.toLowerCase()

    expect(lower).toContain('operator-visible allowlist paths')
    expect(lower).not.toContain('raw diagnostic')
    expect(lower).not.toContain('redacted')
    expect(lower).not.toContain('hidden')
  })
})
