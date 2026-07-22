import { describe, expect, it } from 'vitest'

const files = import.meta.glob<string>(
  [
    '../features/runs/EvidenceAnswer.tsx',
    '../features/runs/RunCapabilityRecoveryNotice.tsx',
    '../features/runs/RunEvidenceDrawer.tsx',
    '../features/runs/RunModelFallbackNotice.tsx',
    '../features/runs/RunWorkspacePage.tsx',
    '../features/runs/runAnswerMetaViewModel.ts',
    '../features/runs/runCapabilityRecoveryViewModel.ts',
    '../features/runs/runCitationAnswerViewModel.ts',
    '../features/runs/runEvidenceDrawerContract.ts',
    '../features/runs/runEvidenceBindingsViewModel.ts',
    '../features/runs/runModelFallbackViewModel.ts',
    '../features/runs/useRunEvidenceDrawerController.ts',
  ],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

function sourceFor(path: string): string {
  const source = files[path]
  if (typeof source !== 'string') throw new Error(`Missing static source for ${path}`)
  return source
}

describe('run model fallback boundary', () => {
  it('keeps model fallback parsing in a dedicated ViewModel', () => {
    expect(Object.keys(files).sort()).toEqual([
      '../features/runs/EvidenceAnswer.tsx',
      '../features/runs/RunCapabilityRecoveryNotice.tsx',
      '../features/runs/RunEvidenceDrawer.tsx',
      '../features/runs/RunModelFallbackNotice.tsx',
      '../features/runs/RunWorkspacePage.tsx',
      '../features/runs/runAnswerMetaViewModel.ts',
      '../features/runs/runCapabilityRecoveryViewModel.ts',
      '../features/runs/runCitationAnswerViewModel.ts',
      '../features/runs/runEvidenceBindingsViewModel.ts',
      '../features/runs/runEvidenceDrawerContract.ts',
      '../features/runs/runModelFallbackViewModel.ts',
      '../features/runs/useRunEvidenceDrawerController.ts',
    ])
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('buildRunAnswerMetaViewModel')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('EvidenceAnswer')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('buildRunModelFallbackViewModel')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('RunModelFallbackNotice')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('buildRunCapabilityRecoveryViewModel')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('RunCapabilityRecoveryNotice')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('RunEvidenceDrawer')
    expect(sourceFor('../features/runs/EvidenceAnswer.tsx')).toContain('buildCitationRenderModel')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('conversationEvidenceIds')
    expect(sourceFor('../features/runs/RunWorkspacePage.tsx')).toContain('openTurnEvidence')
    expect(sourceFor('../features/runs/runEvidenceBindingsViewModel.ts')).toContain('preservedRecoveryEvidenceIds')
    expect(sourceFor('../features/runs/runModelFallbackViewModel.ts')).toContain('active_model_route_failed')
    expect(sourceFor('../features/runs/runModelFallbackViewModel.ts')).toContain('question_override_model_failed')
    expect(sourceFor('../features/runs/runModelFallbackViewModel.ts')).toContain('pinned_setup_gateway_failed')
  })

  it('prevents the Run page from branching on raw model failure contracts', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')

    expect(pageSource).not.toContain('CAPABILITY_UNAVAILABLE')
    expect(pageSource).not.toContain('active_model_route_failed')
    expect(pageSource).not.toContain('question_override_model_failed')
    expect(pageSource).not.toContain('pinned_setup_gateway_failed')
    expect(pageSource).not.toContain('failed_route_id')
    expect(pageSource).not.toContain('checkpoint_available')
    expect(pageSource).not.toContain('preserved_evidence_revision_ids')
    expect(pageSource).not.toContain('preservedRecoveryEvidenceIds')
  })

  it('keeps recovery evidence actions scoped to the owning turn', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')

    expect(pageSource).toContain('navigate(`/runs/${targetRunId}`, { state: { openEvidence: true } })')
    expect(pageSource).toContain('onOpenEvidence={() => openTurnEvidence(turn.id)}')
    expect(pageSource).not.toContain('onOpenEvidence={() => setEvidenceOpen(true)} /><RunModelFallbackNotice')
  })

  it('keeps answer evidence meta copy out of the page component', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const metaSource = sourceFor('../features/runs/runAnswerMetaViewModel.ts')

    expect(metaSource).toContain('preserved Evidence item')
    expect(metaSource).toContain('citation')
    expect(pageSource).not.toContain("citation{runCitations")
    expect(pageSource).not.toContain("citation{")
    expect(pageSource).not.toContain('preserved Evidence item')
  })

  it('keeps evidence id binding derivation outside the page component', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const bindingsSource = sourceFor('../features/runs/runEvidenceBindingsViewModel.ts')

    expect(bindingsSource).toContain('conversationEvidenceIds')
    expect(bindingsSource).toContain('runEvidenceIds')
    expect(pageSource).not.toContain('const runEvidenceIds')
    expect(pageSource).not.toContain('const runCitations')
    expect(pageSource).not.toContain('turns.flatMap(runEvidenceIds)')
  })

  it('keeps citation markdown derivation outside the page component', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const answerSource = sourceFor('../features/runs/EvidenceAnswer.tsx')
    const citationSource = sourceFor('../features/runs/runCitationAnswerViewModel.ts')

    expect(citationSource).toContain('buildCitationMarkdown')
    expect(citationSource).toContain('createCitationRenderState')
    expect(answerSource).toContain('ReactMarkdown')
    expect(pageSource).not.toContain('answer.replace(/\\[evidence:')
    expect(pageSource).not.toContain('citationOccurrences')
    expect(pageSource).not.toContain('seenMedia')
    expect(pageSource).not.toContain('ReactMarkdown')
    expect(pageSource).not.toContain('function InlineMedia')
  })

  it('keeps Evidence drawer rendering out of the Run page component', () => {
    const pageSource = sourceFor('../features/runs/RunWorkspacePage.tsx')
    const drawerSource = sourceFor('../features/runs/RunEvidenceDrawer.tsx')
    const drawerContractSource = sourceFor('../features/runs/runEvidenceDrawerContract.ts')
    const controllerSource = sourceFor('../features/runs/useRunEvidenceDrawerController.ts')

    expect(drawerSource).toContain('className="run-evidence-column"')
    expect(drawerSource).toContain('route-receipt-card')
    expect(drawerSource).toContain('scope-capsule')
    expect(drawerSource).toContain('EvidenceCard')
    expect(drawerSource).toContain("import { runEvidenceDrawerId } from './runEvidenceDrawerContract'")
    expect(drawerContractSource).toContain("export const runEvidenceDrawerId = 'run-evidence-drawer'")
    expect(controllerSource).toContain('useRunEvidenceDrawerController')
    expect(controllerSource).toContain('onConsumeOpenEvidenceState')
    expect(controllerSource).toContain('shouldOpenEvidenceFromLocationState')
    expect(controllerSource).toContain('shouldDismissEvidenceDrawer')
    expect(pageSource).toContain("lazy(() => import('./RunEvidenceDrawer')")
    expect(pageSource).toContain('<RunEvidenceDrawer closeButtonRef={evidenceCloseRef}')
    expect(pageSource).toContain('aria-controls={runEvidenceDrawerId}')
    expect(pageSource).toContain('Opening evidence ledger')
    expect(pageSource).toContain('useRunEvidenceDrawerController')
    expect(pageSource).not.toContain('route-receipt-card')
    expect(pageSource).not.toContain('scope-capsule')
    expect(pageSource).not.toContain('EvidenceCard')
    expect(pageSource).not.toContain('previousFocusRef')
    expect(pageSource).not.toContain('shouldDismissEvidenceDrawer')
  })
})
