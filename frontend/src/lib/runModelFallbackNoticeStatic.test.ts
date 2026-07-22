import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  ['../features/runs/RunModelFallbackNotice.tsx'],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

const source = files['../features/runs/RunModelFallbackNotice.tsx']

describe('RunModelFallbackNotice static contract', () => {
  it('pins the notice to the ViewModel contract and accessible status semantics', () => {
    expect(typeof source).toBe('string')
    expect(source).toContain('RunModelFallbackViewModel')
    expect(source).toContain('if (!model.visible) return null')
    expect(source).toContain('role={model.role}')
    expect(source).toContain('aria-live={model.role === \'alert\' ? \'assertive\' : \'polite\'}')
    expect(source).toContain('aria-label={model.label}')
    expect(source).toContain('model.failures.join')
  })
})
