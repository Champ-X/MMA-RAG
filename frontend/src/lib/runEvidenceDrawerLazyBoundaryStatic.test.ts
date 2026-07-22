import { describe, expect, it } from 'vitest'

describe('run evidence drawer lazy loading boundary', () => {
  it('keeps the evidence drawer out of the Run workspace initial chunk', () => {
    const files = import.meta.glob<string>(
      [
        '../features/runs/RunWorkspacePage.tsx',
        '../features/runs/RunEvidenceDrawer.tsx',
        '../features/runs/runEvidenceDrawerContract.ts',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/RunWorkspacePage.tsx']
    const drawer = files['../features/runs/RunEvidenceDrawer.tsx']
    const contract = files['../features/runs/runEvidenceDrawerContract.ts']

    expect(page).toContain("lazy(() => import('./RunEvidenceDrawer')")
    expect(page).toContain('{evidenceOpen && <Suspense fallback=')
    expect(page).toContain('Opening evidence ledger')
    expect(page).toContain('id={runEvidenceDrawerId}')
    expect(page).toContain('ref={evidenceCloseRef}')
    expect(page).toContain('aria-controls={runEvidenceDrawerId}')
    expect(page).toContain("import { runEvidenceDrawerId } from './runEvidenceDrawerContract'")
    expect(page).not.toContain("import { RunEvidenceDrawer")
    expect(page).not.toContain("from './RunEvidenceDrawer'")
    expect(page).not.toContain('EvidenceCard')
    expect(drawer).toContain("import { runEvidenceDrawerId } from './runEvidenceDrawerContract'")
    expect(drawer).toContain('export function RunEvidenceDrawer')
    expect(contract).toContain("export const runEvidenceDrawerId = 'run-evidence-drawer'")
  })
})
