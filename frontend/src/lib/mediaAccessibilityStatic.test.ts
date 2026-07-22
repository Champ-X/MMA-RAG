import { describe, expect, it } from 'vitest'

const mediaFiles = import.meta.glob<string>(
  [
    '../components/nexus/CitationPreviewPopover.tsx',
    '../components/nexus/EvidenceCard.tsx',
    '../components/nexus/SourcePreviewDrawer.tsx',
    '../features/evidence/EvidenceDetailPage.tsx',
    '../features/runs/EvidenceAnswer.tsx',
    '../features/runs/RunEvidenceDrawer.tsx',
    '../features/runs/RunWorkspacePage.tsx',
    '../features/runs/runEvidenceDrawerContract.ts',
    '../features/runs/useRunEvidenceDrawerController.ts',
  ],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length
}

function findUnlabeledControlledMedia(filePath: string, source: string) {
  const missing: string[] = []
  const mediaTag = /<(audio|video)\b[\s\S]*?>/g
  let match: RegExpExecArray | null
  while ((match = mediaTag.exec(source))) {
    const tag = match[0]
    if (!/\bcontrols\b/.test(tag)) continue
    if (/\baria-label\s*=/.test(tag) || /\baria-labelledby\s*=/.test(tag)) continue
    missing.push(`${filePath.replace('../', '')}:${lineOf(source, match.index)}`)
  }
  return missing
}

function findEmptyEvidenceImageAlt(filePath: string, source: string) {
  const missing: string[] = []
  const imageTag = /<img\b[\s\S]*?>/g
  let match: RegExpExecArray | null
  while ((match = imageTag.exec(source))) {
    const tag = match[0]
    if (!/(evidence\.asset_url|evidence\.data\.asset_url|figure\.asset_url)/.test(tag)) continue
    if (/\balt=\{\s*media\.imageAlt\s*\}/.test(tag) || /\balt=\{[^}]+\}/.test(tag) && !/\balt=\{\s*['"`]\s*['"`]\s*\}/.test(tag)) continue
    missing.push(`${filePath.replace('../', '')}:${lineOf(source, match.index)}`)
  }
  return missing
}

describe('media accessibility semantics', () => {
  it('requires controlled evidence and source media to expose accessible labels', () => {
    const missing = Object.entries(mediaFiles).flatMap(([filePath, source]) =>
      findUnlabeledControlledMedia(filePath, source),
    )

    expect(missing).toEqual([])
  })

  it('keeps citable evidence images descriptive instead of decorative', () => {
    const missing = Object.entries(mediaFiles).flatMap(([filePath, source]) =>
      findEmptyEvidenceImageAlt(filePath, source),
    )

    expect(missing).toEqual([])
  })

  it('keeps the Run Evidence drawer keyboard reachable and dismissible', () => {
    const pageSource = mediaFiles['../features/runs/RunWorkspacePage.tsx']
    const drawerSource = mediaFiles['../features/runs/RunEvidenceDrawer.tsx']
    const drawerContractSource = mediaFiles['../features/runs/runEvidenceDrawerContract.ts']
    const controllerSource = mediaFiles['../features/runs/useRunEvidenceDrawerController.ts']

    expect(pageSource).toContain('useRunEvidenceDrawerController')
    expect(pageSource).not.toContain('previousEvidenceFocusRef')
    expect(pageSource).not.toContain("if (event.key !== 'Escape') return")
    expect(controllerSource).toContain('const closeButtonRef = useRef<HTMLButtonElement>(null)')
    expect(controllerSource).toContain('closeButtonRef.current?.focus({ preventScroll: true })')
    expect(controllerSource).toContain('shouldDismissEvidenceDrawer(event)')
    expect(controllerSource).toContain('setEvidenceOpen(false)')
    expect(pageSource).toContain('closeButtonRef={evidenceCloseRef}')
    expect(pageSource).toContain('aria-controls={runEvidenceDrawerId}')
    expect(pageSource).toContain('evidenceDrawerId={runEvidenceDrawerId}')
    expect(pageSource).toContain('evidenceDrawerId={turn.id === runId ? runEvidenceDrawerId : undefined}')
    expect(pageSource).toContain('id={runEvidenceDrawerId}')
    expect(pageSource).toContain('Opening evidence ledger')
    expect(drawerContractSource).toContain("export const runEvidenceDrawerId = 'run-evidence-drawer'")
    expect(drawerSource).toContain("import { runEvidenceDrawerId } from './runEvidenceDrawerContract'")
    expect(drawerSource).toContain('id={runEvidenceDrawerId}')
    expect(drawerSource).toContain('role="dialog"')
    expect(drawerSource).toContain('aria-labelledby={drawerTitleId}')
    expect(drawerSource).toContain('aria-describedby={drawerDescriptionId}')
    expect(drawerSource).toContain('ref={closeButtonRef}')
  })

  it('keeps citation preview placement math in its ViewModel', () => {
    const previewSource = mediaFiles['../components/nexus/CitationPreviewPopover.tsx']

    expect(previewSource).toContain('buildCitationPreviewPlacementViewModel')
    expect(previewSource).not.toContain('roomBelow')
    expect(previewSource).not.toContain('roomAbove')
    expect(previewSource).not.toContain('placeAbove =')
    expect(previewSource).not.toContain('viewportWidth - width')
  })

  it('keeps citation preview focus trap decisions in the shared focus trap utility', () => {
    const previewSource = mediaFiles['../components/nexus/CitationPreviewPopover.tsx']

    expect(previewSource).toContain('@/lib/focusTrap')
    expect(previewSource).toContain('getFocusableElements')
    expect(previewSource).toContain('resolveFocusTrapAction')
    expect(previewSource).not.toContain("const focusableSelector = [")
    expect(previewSource).not.toContain('document.activeElement === first')
    expect(previewSource).not.toContain('document.activeElement === last')
  })
})
