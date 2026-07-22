import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('run outcome notice CSS loading boundary', () => {
  it('keeps Run workspace outcome notice styles with their lazy route components', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/SearchOutcomeNotice.tsx',
        '../features/runs/RunModelFallbackNotice.tsx',
        '../features/runs/RunCapabilityRecoveryNotice.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const searchOutcome = files['../features/runs/SearchOutcomeNotice.tsx']
    const modelFallback = files['../features/runs/RunModelFallbackNotice.tsx']
    const capabilityRecovery = files['../features/runs/RunCapabilityRecoveryNotice.tsx']
    const searchCss = readFileSync(new URL('../features/runs/SearchOutcomeNotice.css', import.meta.url), 'utf8')
    const fallbackCss = readFileSync(new URL('../features/runs/RunModelFallbackNotice.css', import.meta.url), 'utf8')
    const recoveryCss = readFileSync(new URL('../features/runs/RunCapabilityRecoveryNotice.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(searchOutcome).toContain("import './SearchOutcomeNotice.css'")
    expect(modelFallback).toContain("import './RunModelFallbackNotice.css'")
    expect(capabilityRecovery).toContain("import './RunCapabilityRecoveryNotice.css'")
    expect(searchCss).toContain('.search-outcome-notice')
    expect(searchCss).toContain('.outcome-copy')
    expect(fallbackCss).toContain('.model-fallback-notice')
    expect(fallbackCss).toContain('html[data-theme="dark"] .model-fallback-notice')
    expect(recoveryCss).toContain('.capability-recovery-notice')
    expect(recoveryCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toContain('.search-outcome-notice')
    expect(entryCss).not.toContain('.outcome-copy')
    expect(entryCss).not.toContain('.model-fallback-notice')
    expect(entryCss).not.toContain('.capability-recovery-notice')
  })
})
