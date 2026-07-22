import { describe, expect, it } from 'vitest'
import type { IngestionJob } from '@/api/nexus'
import {
  buildIngestionJobActionConfirmation,
  buildIngestionJobActionViewModel,
  buildIngestionJobAuditLinkCopyViewModel,
  buildIngestionJobAuditLinkViewModel,
  buildIngestionJobArrivalViewModel,
  buildIngestionJobEventNarrative,
  buildIngestionJobRecoveryBriefing,
  buildIngestionJobsEmptyState,
  buildIngestionJobStatusFilters,
  buildIngestionJobStatusSearchParams,
  buildIngestionTimelineRefreshViewModel,
  countIngestionJobsByStatus,
  getIngestionJobStageProgress,
  type IngestionJobEvent,
  parseIngestionJobStatusFilter,
  resolveIngestionJobSelection,
} from './ingestionJobsPageViewModel'

const job = (overrides: Partial<IngestionJob> = {}): IngestionJob => ({
  attempt_count: 1,
  created_at: '2026-07-21T12:00:00.000Z',
  error_code: null,
  error_message: null,
  event_count: 3,
  events: [],
  id: '019f8081-9e41-7554-a2a5-91ecdf95e501',
  mime_type: 'text/markdown',
  modality: 'text',
  source_id: 'source-1',
  source_version_id: 'version-1',
  stage: 'parsing',
  status: 'running',
  updated_at: '2026-07-21T12:01:00.000Z',
  ...overrides,
})

const event = (overrides: Partial<IngestionJobEvent> = {}): IngestionJobEvent => ({
  event_type: 'ingestion.raw.stored',
  occurred_at: '2026-07-21T12:00:00.000Z',
  payload: {},
  sequence: 1,
  ...overrides,
})

describe('Ingestion jobs page view model', () => {
  it('keeps a linked job selected even when it is not in the visible ledger window', () => {
    const visible = [job({ id: 'job-visible', status: 'completed' })]

    expect(resolveIngestionJobSelection({
      currentSelectedId: '',
      jobs: visible,
      requestedJobId: 'job-from-intake-receipt',
    })).toBe('job-from-intake-receipt')
  })

  it('falls back to the current or first ledger job when there is no deep link', () => {
    const visible = [
      job({ id: 'job-a', status: 'completed' }),
      job({ id: 'job-b', status: 'failed' }),
    ]

    expect(resolveIngestionJobSelection({
      currentSelectedId: 'job-b',
      jobs: visible,
      requestedJobId: '',
    })).toBe('job-b')
    expect(resolveIngestionJobSelection({
      currentSelectedId: 'missing',
      jobs: visible,
      requestedJobId: '',
    })).toBe('job-a')
  })

  it('summarizes linked active jobs as a refreshable worker receipt', () => {
    const receipt = buildIngestionJobArrivalViewModel(job({ display_name: 'Board memo' }))

    expect(receipt).toMatchObject({
      statusLabel: 'Worker active',
      title: 'Board memo is at parsing',
      tone: 'active',
    })
    expect(receipt.detail).toContain('opened from an intake receipt')
    expect(receipt.metrics).toContainEqual({ label: 'Events', value: '3' })
  })

  it('makes failed linked jobs recoverable without implying data loss', () => {
    const receipt = buildIngestionJobArrivalViewModel(job({
      error_code: 'PARSER_FAILED',
      error_message: 'Cannot parse file',
      stage: 'parsing',
      status: 'failed',
    }))

    expect(receipt).toMatchObject({
      statusLabel: 'Needs recovery',
      title: 'Ingestion attempt needs review',
      tone: 'failed',
    })
    expect(receipt.detail).toContain('Original material is retained')
    expect(receipt.detail).toContain('PARSER_FAILED')
  })

  it('counts visible job statuses for the filter ribbon', () => {
    expect(countIngestionJobsByStatus([
      job({ id: 'job-a', status: 'running' }),
      job({ id: 'job-b', status: 'completed' }),
      job({ id: 'job-c', status: 'completed' }),
    ])).toMatchObject({
      all: 3,
      completed: 2,
      running: 1,
    })
  })

  it('builds status filters including cancelled recovery work', () => {
    const filters = buildIngestionJobStatusFilters({
      all: 4,
      cancelled: 1,
      completed: 2,
      failed: 1,
    }, 'cancelled')

    expect(filters.map((item) => item.key)).toEqual([
      'all',
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ])
    expect(filters.find((item) => item.key === 'cancelled')).toMatchObject({
      active: true,
      ariaLabel: '1 cancelled ingestion job',
      count: 1,
      tone: 'failed',
    })
  })

  it('parses status filter query params with a safe all fallback', () => {
    expect(parseIngestionJobStatusFilter('failed')).toBe('failed')
    expect(parseIngestionJobStatusFilter('cancelled')).toBe('cancelled')
    expect(parseIngestionJobStatusFilter('unsupported')).toBe('all')
    expect(parseIngestionJobStatusFilter(null)).toBe('all')
  })

  it('serializes status filter params while preserving the linked job', () => {
    const current = new URLSearchParams('job=job-1&status=completed')
    const failed = buildIngestionJobStatusSearchParams(current, 'failed')
    const all = buildIngestionJobStatusSearchParams(failed, 'all')

    expect(failed.toString()).toBe('job=job-1&status=failed')
    expect(all.toString()).toBe('job=job-1')
  })

  it('builds a shareable audit link with the current job and recovery filter', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'failed',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams('job=old-job&status=completed'),
      selectedJobId: '019f7f60-a88c-7173-a34f-714a82288d4a',
    })

    expect(link).toMatchObject({
      copyLabel: 'Copy audit link',
      href: 'http://127.0.0.1:3000/spaces/space-a/jobs?job=019f7f60-a88c-7173-a34f-714a82288d4a&status=failed',
      title: 'Audit link',
    })
    expect(link.ariaLabel).toContain('failed')
    expect(link.facets).toContainEqual({ label: 'Job', value: '019f7f60' })
    expect(link.facets).toContainEqual({ label: 'Status', value: 'failed' })
  })

  it('omits status from audit links for the all-jobs view', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'all',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams('job=job-1&status=failed'),
      selectedJobId: 'job-1',
    })

    expect(link.href).toBe('http://127.0.0.1:3000/spaces/space-a/jobs?job=job-1')
    expect(link.facets).toContainEqual({ label: 'Status', value: 'all jobs' })
  })

  it('keeps audit link copy guidance quiet before copying', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'failed',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams(),
      selectedJobId: '019f7f60-a88c-7173-a34f-714a82288d4a',
    })

    expect(buildIngestionJobAuditLinkCopyViewModel({
      auditLink: link,
      state: 'idle',
    })).toMatchObject({
      feedbackDetail: 'Copies an audit URL that preserves failed, job 019f7f60 for recovery handoff. It does not retry, cancel or mutate any ingestion job.',
      feedbackLabel: 'Audit link ready',
      feedbackTone: 'ready',
      role: 'status',
      submitLabel: 'Copy audit link',
      visible: false,
    })
  })

  it('announces audit link copy while the clipboard is settling', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'failed',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams(),
      selectedJobId: '019f7f60-a88c-7173-a34f-714a82288d4a',
    })

    expect(buildIngestionJobAuditLinkCopyViewModel({
      auditLink: link,
      state: 'copying',
    })).toMatchObject({
      feedbackDetail: 'Copying an audit URL for failed, job 019f7f60. It preserves the current filter, selected job and event context without changing the ingestion ledger.',
      feedbackLabel: 'Copying audit link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    })
  })

  it('summarizes copied audit links as handoff receipts', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'failed',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams(),
      selectedJobId: '019f7f60-a88c-7173-a34f-714a82288d4a',
    })

    expect(buildIngestionJobAuditLinkCopyViewModel({
      auditLink: link,
      state: 'copied',
    })).toMatchObject({
      feedbackDetail: 'Audit URL copied for failed, job 019f7f60. Teammates opening it will land on the same durable job ledger context.',
      feedbackLabel: 'Audit link copied',
      feedbackTone: 'ready',
      submitLabel: 'Audit link copied',
      visible: true,
    })
  })

  it('turns audit link copy failures into assertive manual-copy guidance', () => {
    const link = buildIngestionJobAuditLinkViewModel({
      filter: 'all',
      origin: 'http://127.0.0.1:3000',
      pathname: '/spaces/space-a/jobs',
      searchParams: new URLSearchParams(),
    })

    expect(buildIngestionJobAuditLinkCopyViewModel({
      auditLink: link,
      state: 'failed',
    })).toMatchObject({
      feedbackDetail: 'Clipboard access failed. Copy the visible audit URL manually; all jobs, job not pinned remains encoded in the current page URL.',
      feedbackLabel: 'Copy failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    })
  })

  it('explains timeline refresh readiness with the selected inspector', () => {
    expect(buildIngestionTimelineRefreshViewModel({
      activeJobCount: 1,
      pending: false,
      selectedJobId: '019f8081-9e41-7554-a2a5-91ecdf95e501',
      totalJobCount: 4,
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'Refresh 4 jobs, selected job 019f8081, and the material ledger. 1 job still active.',
      feedbackLabel: 'Timeline refresh ready',
      feedbackTone: 'ready',
      submitLabel: 'Refresh',
    })
  })

  it('blocks duplicate timeline refreshes while pending', () => {
    expect(buildIngestionTimelineRefreshViewModel({
      activeJobCount: 0,
      pending: true,
      totalJobCount: 2,
    })).toMatchObject({
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: 'Timeline refresh is locked while the durable job ledger and material projections are updating.',
      feedbackDetail: 'Refreshing the durable job ledger, the selected-job inspector, and material projections.',
      feedbackLabel: 'Refreshing timeline',
      feedbackTone: 'pending',
      submitLabel: 'Refreshing...',
    })
  })

  it('keeps timeline refresh retry available after failure', () => {
    expect(buildIngestionTimelineRefreshViewModel({
      activeJobCount: 0,
      errorMessage: 'PostgreSQL timeout.',
      pending: false,
      totalJobCount: 2,
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'PostgreSQL timeout. The current timeline remains visible while you retry.',
      feedbackLabel: 'Timeline refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try refresh again',
    })
  })

  it('summarizes the last successful timeline refresh', () => {
    expect(buildIngestionTimelineRefreshViewModel({
      activeJobCount: 0,
      lastRefreshLabel: '11:58:21',
      pending: false,
      totalJobCount: 3,
    })).toMatchObject({
      feedbackDetail: '11:58:21; refreshed 3 jobs with no active jobs.',
      feedbackLabel: 'Timeline refreshed',
      feedbackTone: 'ready',
      submitLabel: 'Refresh again',
    })
  })

  it('turns an empty failed filter into a clear recovery queue state', () => {
    const empty = buildIngestionJobsEmptyState('failed', 5)

    expect(empty).toMatchObject({
      action: 'view-all',
      actionLabel: 'View all jobs',
      eyebrow: 'Recovery queue',
      title: 'No failed jobs need recovery',
      tone: 'complete',
    })
    expect(empty.body).toContain('No failed ingestion attempts')
  })

  it('orients first-use empty timelines toward adding material', () => {
    const empty = buildIngestionJobsEmptyState('all', 0)

    expect(empty).toMatchObject({
      action: 'add-materials',
      actionLabel: 'Add materials',
      eyebrow: 'Durable timeline',
      title: 'No ingestion attempts yet',
      tone: 'stored',
    })
    expect(empty.body).toContain('stores the original first')
  })

  it('uses determinate stage progress for active and terminal jobs', () => {
    expect(getIngestionJobStageProgress(job({ stage: 'parsing', status: 'running' }))).toBeGreaterThan(70)
    expect(getIngestionJobStageProgress(job({ stage: 'parsing', status: 'failed' }))).toBeCloseTo(66.666, 2)
    expect(getIngestionJobStageProgress(job({ stage: 'published', status: 'completed' }))).toBe(100)
  })

  it('explains retry as a new attempt while preserving the failed record', () => {
    const confirmation = buildIngestionJobActionConfirmation(job({
      display_name: 'Board memo',
      error_code: 'PARSER_FAILED',
      status: 'failed',
    }), 'retry')

    expect(confirmation).toMatchObject({
      confirmLabel: 'Retry failed stage',
      title: 'Retry Board memo?',
      tone: 'neutral',
    })
    expect(confirmation.body).toContain('retained original')
    expect(confirmation.body).toContain('PARSER_FAILED')
    expect(confirmation.body).toContain('remains in the durable timeline')
  })

  it('explains reparse without implying current evidence disappears immediately', () => {
    const confirmation = buildIngestionJobActionConfirmation(job({
      display_name: 'Published original',
      stage: 'published',
      status: 'completed',
    }), 'reprocess')

    expect(confirmation).toMatchObject({
      confirmLabel: 'Reparse original',
      title: 'Reparse Published original?',
      tone: 'neutral',
    })
    expect(confirmation.body).toContain('Existing evidence remains available')
    expect(confirmation.body).toContain('retrieval projections are refreshed')
  })

  it('treats cancelling an active worker as a dangerous checkpoint', () => {
    const confirmation = buildIngestionJobActionConfirmation(job({
      display_name: 'Running import',
      stage: 'parsing',
      status: 'running',
    }), 'cancel')

    expect(confirmation).toMatchObject({
      confirmLabel: 'Cancel job',
      title: 'Cancel Running import?',
      tone: 'danger',
    })
    expect(confirmation.body).toContain('marked cancelled')
    expect(confirmation.body).toContain('retained original stays available')
  })

  it('keeps retry job actions quiet until the user confirms', () => {
    expect(buildIngestionJobActionViewModel({
      action: 'retry',
    })).toMatchObject({
      actionLabel: 'Retry from retained original',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Retry starts a new attempt from the retained original while the failed record stays auditable.',
      feedbackLabel: 'Retry ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending job actions with retained-original context', () => {
    expect(buildIngestionJobActionViewModel({
      action: 'retry',
      pendingAction: 'retry',
      targetName: 'Board memo',
    })).toMatchObject({
      actionLabel: 'Retrying...',
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Retry from retained original is locked while retrying ingestion for Board memo.',
      feedbackDetail: 'Retrying Board memo from the retained original. The failed attempt remains in the durable timeline.',
      feedbackLabel: 'Retrying ingestion',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed job actions retryable when the primary action is still available', () => {
    expect(buildIngestionJobActionViewModel({
      action: 'cancel',
      errorAction: 'cancel',
      errorMessage: 'Worker lease changed.',
      targetName: 'Running import',
    })).toMatchObject({
      actionLabel: 'Cancel job',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Worker lease changed. Running import remains unchanged and the action can be retried if it is still available.',
      feedbackLabel: 'Cancel job failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes completed reprocess actions', () => {
    expect(buildIngestionJobActionViewModel({
      action: 'reprocess',
      completedAction: 'reprocess',
      completedName: 'Published memo',
    })).toMatchObject({
      actionLabel: 'Reparse original',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Published memo is being reparsed from the stored original. Retrieval projections refresh after the new attempt publishes.',
      feedbackLabel: 'Reparse enqueued',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('turns evidence publish events into readable audit facts', () => {
    const narrative = buildIngestionJobEventNarrative(event({
      event_type: 'ingestion.evidence.published',
      payload: {
        capabilities: {
          image_pipeline: 'pending',
          parse_structure: 'ready',
          text_index: 'ready',
        },
        evidence_count: 59,
        source_version_id: 'source-version-123456',
      },
      sequence: 4,
    }))

    expect(narrative).toMatchObject({
      sequenceLabel: '#4',
      statusLabel: 'Published',
      title: 'Evidence published',
      tone: 'complete',
    })
    expect(narrative.detail).toContain('capability ledger')
    expect(narrative.facts).toContainEqual({ label: 'Evidence', value: '59' })
    expect(narrative.facts).toContainEqual({ label: 'image pipeline', value: 'pending' })
    expect(narrative.payloadPreview).toContain('evidence_count')
  })

  it('keeps failure events recoverable and specific', () => {
    const narrative = buildIngestionJobEventNarrative(event({
      event_type: 'ingestion.failed',
      payload: { code: 'PARSER_FAILED', message: 'Cannot parse archive' },
    }))

    expect(narrative).toMatchObject({
      statusLabel: 'Needs recovery',
      title: 'Ingestion failed',
      tone: 'failed',
    })
    expect(narrative.detail).toContain('original remains retained')
    expect(narrative.facts).toContainEqual({ label: 'Code', value: 'PARSER_FAILED' })
  })

  it('falls back to labeled facts for unknown durable events', () => {
    const narrative = buildIngestionJobEventNarrative(event({
      event_type: 'ingestion.custom.signal',
      payload: { custom_key: 'custom value', nested: { count: 2 } },
    }))

    expect(narrative).toMatchObject({
      statusLabel: 'Recorded',
      title: 'ingestion.custom.signal',
      tone: 'neutral',
    })
    expect(narrative.facts).toContainEqual({ label: 'custom key', value: 'custom value' })
    expect(narrative.payloadPreview).toContain('custom_key')
  })

  it('briefs published jobs as safe with optional reparse guidance', () => {
    const briefing = buildIngestionJobRecoveryBriefing(job({
      display_name: 'Published memo',
      event_count: 4,
      stage: 'published',
      status: 'completed',
    }))

    expect(briefing).toMatchObject({
      primaryAction: 'reprocess',
      primaryLabel: 'Reparse original',
      statusLabel: 'Published',
      title: 'Published memo is already published',
      tone: 'complete',
    })
    expect(briefing.detail).toContain('Reparse only')
    expect(briefing.steps).toContainEqual({
      detail: '4 persisted transitions',
      label: 'Evidence published',
      state: 'done',
    })
  })

  it('briefs failed jobs with the blocker and retained-original retry path', () => {
    const briefing = buildIngestionJobRecoveryBriefing(job({
      display_name: 'Failed import',
      error_code: 'PARSER_FAILED',
      error_message: 'Cannot parse archive',
      status: 'failed',
    }))

    expect(briefing).toMatchObject({
      primaryAction: 'retry',
      primaryLabel: 'Retry from retained original',
      statusLabel: 'Needs recovery',
      tone: 'failed',
    })
    expect(briefing.ariaLabel).toContain('PARSER_FAILED')
    expect(briefing.steps).toContainEqual({
      detail: 'PARSER_FAILED: Cannot parse archive',
      label: 'Current blocker',
      state: 'blocked',
    })
  })

  it('briefs active jobs with a dangerous cancel checkpoint', () => {
    const briefing = buildIngestionJobRecoveryBriefing(job({
      display_name: 'Running import',
      stage: 'claimed',
      status: 'running',
    }))

    expect(briefing).toMatchObject({
      primaryAction: 'cancel',
      primaryLabel: 'Cancel job',
      primaryTone: 'danger',
      statusLabel: 'Worker active',
      tone: 'active',
    })
    expect(briefing.detail).toContain('Let the worker continue')
    expect(briefing.steps).toContainEqual({
      detail: 'Current stage is claimed.',
      label: 'Worker progress',
      state: 'current',
    })
  })
})
