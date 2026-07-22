import type { IngestionJob } from '@/api/nexus'

export type IngestionJobEvent = NonNullable<IngestionJob['events']>[number]

export const ingestionStages = ['raw_stored', 'claimed', 'parsing', 'published'] as const

export const terminalIngestionStatuses = new Set(['completed', 'failed', 'cancelled'])

export type IngestionJobArrivalTone = 'active' | 'complete' | 'failed' | 'stored'

export type IngestionJobArrivalMetric = {
  label: string
  value: string
}

export type IngestionJobArrivalViewModel = {
  ariaLabel: string
  detail: string
  metrics: IngestionJobArrivalMetric[]
  statusLabel: string
  title: string
  tone: IngestionJobArrivalTone
}

export type IngestionJobAction = 'cancel' | 'reprocess' | 'retry'

export type IngestionJobActionConfirmation = {
  body: string
  confirmLabel: string
  title: string
  tone: 'danger' | 'neutral'
}

export type IngestionJobActionFeedbackTone = 'error' | 'pending' | 'ready'

export type IngestionJobActionViewModelInput = {
  action?: IngestionJobAction
  completedAction?: IngestionJobAction
  completedName?: string
  errorAction?: IngestionJobAction
  errorMessage?: string
  pendingAction?: IngestionJobAction
  targetName?: string
}

export type IngestionJobActionViewModel = {
  actionLabel: string
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: IngestionJobActionFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export type IngestionJobEventNarrativeTone = 'active' | 'complete' | 'failed' | 'neutral' | 'stored'

export type IngestionJobEventFact = {
  label: string
  value: string
}

export type IngestionJobEventNarrative = {
  ariaLabel: string
  detail: string
  facts: IngestionJobEventFact[]
  payloadPreview: string
  sequenceLabel: string
  statusLabel: string
  title: string
  tone: IngestionJobEventNarrativeTone
}

export type IngestionJobRecoveryStepState = 'blocked' | 'current' | 'done' | 'pending'

export type IngestionJobRecoveryStep = {
  detail: string
  label: string
  state: IngestionJobRecoveryStepState
}

export type IngestionJobRecoveryBriefing = {
  ariaLabel: string
  detail: string
  primaryAction?: IngestionJobAction
  primaryLabel?: string
  primaryTone?: 'danger' | 'neutral'
  statusLabel: string
  steps: IngestionJobRecoveryStep[]
  title: string
  tone: IngestionJobArrivalTone
}

export type IngestionJobStatusFilter = 'all' | 'cancelled' | 'completed' | 'failed' | 'pending' | 'running'

export type IngestionJobStatusFilterViewModel = {
  active: boolean
  ariaLabel: string
  count: number
  key: IngestionJobStatusFilter
  label: string
  tone: IngestionJobArrivalTone
}

export type IngestionJobsEmptyStateViewModel = {
  action: 'add-materials' | 'view-all'
  actionLabel: string
  body: string
  eyebrow: string
  title: string
  tone: IngestionJobArrivalTone
}

export type IngestionJobAuditLinkFacet = {
  label: string
  value: string
}

export type IngestionJobAuditLinkViewModel = {
  ariaLabel: string
  copiedLabel: string
  copyLabel: string
  detail: string
  failedLabel: string
  facets: IngestionJobAuditLinkFacet[]
  href: string
  shortLabel: string
  title: string
}

export type IngestionJobAuditLinkCopyState = 'copied' | 'copying' | 'failed' | 'idle'

export type IngestionJobAuditLinkCopyViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
  visible: boolean
}

export type IngestionTimelineRefreshFeedbackTone = 'error' | 'pending' | 'ready'

export type IngestionTimelineRefreshViewModelInput = {
  activeJobCount: number
  errorMessage?: string
  lastRefreshLabel?: string
  pending: boolean
  selectedJobId?: string
  totalJobCount: number
}

export type IngestionTimelineRefreshViewModel = {
  ariaDisabled: boolean
  canRefresh: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: IngestionTimelineRefreshFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
}

export const ingestionJobStatusFilterOrder: IngestionJobStatusFilter[] = [
  'all',
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]

const ingestionJobStatusFilterSet = new Set<IngestionJobStatusFilter>(ingestionJobStatusFilterOrder)

export function labelIngestionValue(value: string) {
  return value.replaceAll('_', ' ')
}

function jobCountLabel(count: number) {
  return `${count} job${count === 1 ? '' : 's'}`
}

export function buildIngestionTimelineRefreshViewModel({
  activeJobCount,
  errorMessage,
  lastRefreshLabel,
  pending,
  selectedJobId,
  totalJobCount,
}: IngestionTimelineRefreshViewModelInput): IngestionTimelineRefreshViewModel {
  const selectionDetail = selectedJobId
    ? `selected job ${selectedJobId.slice(0, 8)}`
    : 'the selected-job inspector'
  const activeFragment = activeJobCount
    ? `${jobCountLabel(activeJobCount)} still active`
    : 'no active jobs'
  const activeSentence = activeJobCount
    ? `${jobCountLabel(activeJobCount)} still active.`
    : 'No active jobs.'

  if (pending) {
    return {
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: 'Timeline refresh is locked while the durable job ledger and material projections are updating.',
      feedbackDetail: `Refreshing the durable job ledger, ${selectionDetail}, and material projections.`,
      feedbackLabel: 'Refreshing timeline',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Refreshing...',
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${errorMessage} The current timeline remains visible while you retry.`,
      feedbackLabel: 'Timeline refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try refresh again',
    }
  }

  if (lastRefreshLabel) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${lastRefreshLabel}; refreshed ${jobCountLabel(totalJobCount)} with ${activeFragment}.`,
      feedbackLabel: 'Timeline refreshed',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Refresh again',
    }
  }

  return {
    ariaDisabled: false,
    canRefresh: true,
    feedbackDetail: `Refresh ${jobCountLabel(totalJobCount)}, ${selectionDetail}, and the material ledger. ${activeSentence}`,
    feedbackLabel: 'Timeline refresh ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: 'Refresh',
  }
}

export function parseIngestionJobStatusFilter(value: string | null): IngestionJobStatusFilter {
  if (!value) return 'all'
  return ingestionJobStatusFilterSet.has(value as IngestionJobStatusFilter)
    ? value as IngestionJobStatusFilter
    : 'all'
}

export function buildIngestionJobStatusSearchParams(
  current: URLSearchParams,
  filter: IngestionJobStatusFilter,
) {
  const next = new URLSearchParams(current)
  if (filter === 'all') next.delete('status')
  else next.set('status', filter)
  return next
}

export function buildIngestionJobAuditLinkViewModel({
  filter,
  origin,
  pathname,
  searchParams,
  selectedJobId,
}: {
  filter: IngestionJobStatusFilter
  origin: string
  pathname: string
  searchParams: URLSearchParams
  selectedJobId?: string
}): IngestionJobAuditLinkViewModel {
  const params = buildIngestionJobStatusSearchParams(searchParams, filter)
  if (selectedJobId) params.set('job', selectedJobId)
  const query = params.toString()
  const href = `${origin}${pathname}${query ? `?${query}` : ''}`
  const jobLabel = selectedJobId ? selectedJobId.slice(0, 8) : 'not pinned'
  const statusLabel = filter === 'all' ? 'all jobs' : filter
  const shortPath = `${pathname}${query ? `?${query}` : ''}`

  return {
    ariaLabel: `Copy audit link for ${statusLabel}${selectedJobId ? ` and job ${jobLabel}` : ''}.`,
    copiedLabel: 'Audit link copied',
    copyLabel: 'Copy audit link',
    detail: 'Share this URL to preserve the current job, recovery filter, and event context.',
    failedLabel: 'Copy failed',
    facets: [
      { label: 'Status', value: statusLabel },
      { label: 'Job', value: jobLabel },
    ],
    href,
    shortLabel: shortPath.length > 78 ? `${shortPath.slice(0, 77)}…` : shortPath,
    title: 'Audit link',
  }
}

export function buildIngestionJobAuditLinkCopyViewModel({
  auditLink,
  state,
}: {
  auditLink: IngestionJobAuditLinkViewModel
  state: IngestionJobAuditLinkCopyState
}): IngestionJobAuditLinkCopyViewModel {
  const statusFacet = auditLink.facets.find((facetItem) => facetItem.label === 'Status')?.value ?? 'current filter'
  const jobFacet = auditLink.facets.find((facetItem) => facetItem.label === 'Job')?.value ?? 'not pinned'
  const scope = `${statusFacet}, job ${jobFacet}`

  if (state === 'copying') {
    return {
      feedbackDetail: `Copying an audit URL for ${scope}. It preserves the current filter, selected job and event context without changing the ingestion ledger.`,
      feedbackLabel: 'Copying audit link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    }
  }

  if (state === 'copied') {
    return {
      feedbackDetail: `Audit URL copied for ${scope}. Teammates opening it will land on the same durable job ledger context.`,
      feedbackLabel: auditLink.copiedLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: auditLink.copiedLabel,
      visible: true,
    }
  }

  if (state === 'failed') {
    return {
      feedbackDetail: `Clipboard access failed. Copy the visible audit URL manually; ${scope} remains encoded in the current page URL.`,
      feedbackLabel: auditLink.failedLabel,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    }
  }

  return {
    feedbackDetail: `Copies an audit URL that preserves ${scope} for recovery handoff. It does not retry, cancel or mutate any ingestion job.`,
    feedbackLabel: 'Audit link ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: auditLink.copyLabel,
    visible: false,
  }
}

function stringifyPayloadValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'none'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function shortValue(value: unknown, maxLength = 42) {
  const text = stringifyPayloadValue(value)
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function fact(label: string, value: unknown, maxLength?: number): IngestionJobEventFact {
  return { label, value: shortValue(value, maxLength) }
}

function capabilityFacts(payload: Record<string, unknown>) {
  const capabilities = payload.capabilities
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return []
  return Object.entries(capabilities as Record<string, unknown>).map(([key, value]) => (
    fact(labelIngestionValue(key), value, 18)
  ))
}

function lastEvent(job: IngestionJob, eventType: string) {
  return [...(job.events ?? [])].reverse().find((event) => event.event_type === eventType)
}

function retainedOriginalDetail(job: IngestionJob) {
  return `Source version ${shortValue(job.source_version_id, 18)} remains available for replay.`
}

function jobIssueDetail(job: IngestionJob) {
  if (job.error_code || job.error_message) {
    return `${job.error_code ?? 'INGESTION_FAILED'}${job.error_message ? `: ${job.error_message}` : ''}`
  }
  const cancelled = lastEvent(job, 'ingestion.cancelled')
  const reason = cancelled?.payload?.reason
  if (reason) return `Cancelled because ${labelIngestionValue(String(reason))}.`
  return `${labelIngestionValue(job.status)} at ${labelIngestionValue(job.stage)}.`
}

function ingestionStageIndex(stage: string) {
  const index = ingestionStages.indexOf(stage as (typeof ingestionStages)[number])
  return index >= 0 ? index : 0
}

export function getIngestionJobStageProgress(job: IngestionJob) {
  const current = ingestionStageIndex(job.stage)
  if (job.status === 'completed') return 100
  if (job.status === 'failed' || job.status === 'cancelled') {
    return Math.max(12, (current / (ingestionStages.length - 1)) * 100)
  }
  return Math.max(8, ((current + 0.45) / (ingestionStages.length - 1)) * 100)
}

export function getIngestionJobStageStepState(job: IngestionJob, stage: string, index: number) {
  const current = ingestionStageIndex(job.stage)
  return {
    active: index === current && job.status !== 'completed',
    done: job.status === 'completed' || index < current,
    label: labelIngestionValue(stage),
  }
}

export function countIngestionJobsByStatus(jobs: IngestionJob[]) {
  const result: Record<string, number> = { all: jobs.length }
  jobs.forEach((job) => {
    result[job.status] = (result[job.status] ?? 0) + 1
  })
  return result
}

function statusTone(status: IngestionJobStatusFilter): IngestionJobArrivalTone {
  if (status === 'completed') return 'complete'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'pending' || status === 'running') return 'active'
  return 'stored'
}

function statusLabel(status: IngestionJobStatusFilter) {
  if (status === 'all') return 'all'
  return status
}

export function buildIngestionJobStatusFilters(
  counts: Record<string, number>,
  activeFilter: IngestionJobStatusFilter,
): IngestionJobStatusFilterViewModel[] {
  return ingestionJobStatusFilterOrder.map((key) => {
    const count = counts[key] ?? 0
    const label = statusLabel(key)
    return {
      active: activeFilter === key,
      ariaLabel: `${count} ${label} ingestion job${count === 1 ? '' : 's'}`,
      count,
      key,
      label,
      tone: statusTone(key),
    }
  })
}

export function buildIngestionJobsEmptyState(
  filter: IngestionJobStatusFilter,
  totalCount: number,
): IngestionJobsEmptyStateViewModel {
  if (filter === 'failed') {
    return {
      action: totalCount > 0 ? 'view-all' : 'add-materials',
      actionLabel: totalCount > 0 ? 'View all jobs' : 'Add materials',
      body: totalCount > 0
        ? 'No failed ingestion attempts are waiting for recovery. Review the full ledger to audit completed and active work.'
        : 'No ingestion attempts exist yet. Add material to create the first raw-first pipeline record.',
      eyebrow: 'Recovery queue',
      title: totalCount > 0 ? 'No failed jobs need recovery' : 'No recovery queue yet',
      tone: totalCount > 0 ? 'complete' : 'stored',
    }
  }

  if (filter === 'cancelled') {
    return {
      action: totalCount > 0 ? 'view-all' : 'add-materials',
      actionLabel: totalCount > 0 ? 'View all jobs' : 'Add materials',
      body: totalCount > 0
        ? 'No cancelled attempts are hidden in this Space. Active and completed jobs remain available in the full ledger.'
        : 'No ingestion attempts exist yet. Add material to create the first durable processing record.',
      eyebrow: 'Interrupted work',
      title: totalCount > 0 ? 'No cancelled jobs' : 'No interrupted jobs yet',
      tone: totalCount > 0 ? 'complete' : 'stored',
    }
  }

  if (filter === 'running' || filter === 'pending') {
    return {
      action: totalCount > 0 ? 'view-all' : 'add-materials',
      actionLabel: totalCount > 0 ? 'View all jobs' : 'Add materials',
      body: totalCount > 0
        ? 'There is no active worker work in this status right now. Completed and recoverable attempts stay visible in the full ledger.'
        : 'No ingestion attempts exist yet. Add material to start the raw-first pipeline.',
      eyebrow: 'Worker queue',
      title: filter === 'running' ? 'No running jobs' : 'No pending jobs',
      tone: 'active',
    }
  }

  if (filter === 'completed') {
    return {
      action: totalCount > 0 ? 'view-all' : 'add-materials',
      actionLabel: totalCount > 0 ? 'View all jobs' : 'Add materials',
      body: totalCount > 0
        ? 'No completed attempts match this filter yet. Inspect the full ledger to find queued, active, or recoverable work.'
        : 'No ingestion attempts exist yet. Add material to publish the first evidence projection.',
      eyebrow: 'Published ledger',
      title: 'No published jobs in this view',
      tone: 'stored',
    }
  }

  return {
    action: 'add-materials',
    actionLabel: 'Add materials',
    body: 'Add a file, URL, or manual note; Nexus stores the original first and then records every enrichment stage here.',
    eyebrow: 'Durable timeline',
    title: 'No ingestion attempts yet',
    tone: 'stored',
  }
}

export function resolveIngestionJobSelection({
  currentSelectedId,
  jobs,
  requestedJobId,
}: {
  currentSelectedId: string
  jobs: IngestionJob[]
  requestedJobId: string
}) {
  if (requestedJobId) return requestedJobId
  if (currentSelectedId && jobs.some((job) => job.id === currentSelectedId)) return currentSelectedId
  return jobs[0]?.id ?? ''
}

export function buildIngestionJobArrivalViewModel(
  job: IngestionJob,
): IngestionJobArrivalViewModel {
  const displayName = job.display_name ?? 'Ingestion attempt'
  const stageLabel = labelIngestionValue(job.stage)
  const shortId = job.id.slice(0, 8)
  const metrics = [
    { label: 'Stage', value: stageLabel },
    { label: 'Attempt', value: String(job.attempt_count) },
    { label: 'Events', value: String(job.event_count) },
    { label: 'Job', value: shortId },
  ]

  if (job.status === 'failed' || job.status === 'cancelled') {
    const statusLabel = job.status === 'cancelled' ? 'Cancelled' : 'Needs recovery'
    const issue = job.error_code ?? (job.status === 'cancelled' ? 'INGESTION_CANCELLED' : 'INGESTION_FAILED')
    return {
      ariaLabel: `Linked ingestion job ${shortId} ${job.status} at ${stageLabel}. Original material is retained and recovery actions are available.`,
      detail: `Original material is retained. Review ${issue}, inspect the persisted events, then retry the failed stage when the source issue is fixed.`,
      metrics,
      statusLabel,
      title: `${displayName} needs review`,
      tone: 'failed',
    }
  }

  if (job.status === 'completed') {
    return {
      ariaLabel: `Linked ingestion job ${shortId} completed. Evidence is published from ${displayName}.`,
      detail: 'The raw-first pipeline reached the published evidence ledger. Reparse only if the original has changed.',
      metrics,
      statusLabel: 'Published',
      title: `${displayName} reached published evidence`,
      tone: 'complete',
    }
  }

  if (terminalIngestionStatuses.has(job.status)) {
    return {
      ariaLabel: `Linked ingestion job ${shortId} is stored with status ${job.status}.`,
      detail: 'The original was stored before enrichment. Inspect the event record to decide whether another action is needed.',
      metrics,
      statusLabel: 'Stored',
      title: `${displayName} is stored`,
      tone: 'stored',
    }
  }

  return {
    ariaLabel: `Linked ingestion job ${shortId} is active at ${stageLabel}. This page refreshes while worker progress arrives.`,
    detail: 'This job was opened from an intake receipt. Worker progress is persisted below as it arrives.',
    metrics,
    statusLabel: 'Worker active',
    title: `${displayName} is at ${stageLabel}`,
    tone: 'active',
  }
}

export function buildIngestionJobActionConfirmation(
  job: IngestionJob,
  action: IngestionJobAction,
): IngestionJobActionConfirmation {
  const displayName = job.display_name ?? 'this ingestion job'
  const shortId = job.id.slice(0, 8)
  const stageLabel = labelIngestionValue(job.stage)

  if (action === 'retry') {
    const issue = job.error_code ?? (job.status === 'cancelled' ? 'INGESTION_CANCELLED' : 'INGESTION_FAILED')
    return {
      body: (
        `Nexus will enqueue a new attempt for ${displayName} from the retained original. `
        + `The current failed attempt ${shortId} remains in the durable timeline with ${issue}; `
        + 'new evidence is only published after the retry reaches the published stage.'
      ),
      confirmLabel: 'Retry failed stage',
      title: `Retry ${displayName}?`,
      tone: 'neutral',
    }
  }

  if (action === 'reprocess') {
    return {
      body: (
        `Nexus will parse ${displayName} again from the stored original and create a new ingestion attempt. `
        + 'Existing evidence remains available while the new attempt runs, then retrieval projections are refreshed when publishing completes.'
      ),
      confirmLabel: 'Reparse original',
      title: `Reparse ${displayName}?`,
      tone: 'neutral',
    }
  }

  return {
    body: (
      `This asks the worker to stop ${displayName} at ${stageLabel}. `
      + `Attempt ${shortId} will be marked cancelled in the durable timeline; the retained original stays available for a later retry.`
    ),
    confirmLabel: 'Cancel job',
    title: `Cancel ${displayName}?`,
    tone: 'danger',
  }
}

const ingestionJobActionCopy = {
  cancel: {
    idleDetail: 'Cancel asks the worker to stop future parsing work while retaining the original and all completed events.',
    idleLabel: 'Cancel ready',
    label: 'Cancel job',
    pendingDetail: (name: string) => `Asking the worker to stop ${name}. Completed events stay preserved and the retained original remains recoverable.`,
    pendingLabel: 'Cancelling job',
    pendingSubmitLabel: 'Cancelling...',
    successDetail: (name: string) => `${name} was marked cancelled. The retained original remains available for a later retry.`,
    successLabel: 'Job cancelled',
  },
  reprocess: {
    idleDetail: 'Reparse creates a new attempt from the stored original while existing evidence remains available until publishing completes.',
    idleLabel: 'Reparse ready',
    label: 'Reparse original',
    pendingDetail: (name: string) => `Creating a new parse attempt for ${name}. Existing evidence remains visible while the rebuild runs.`,
    pendingLabel: 'Reparsing original',
    pendingSubmitLabel: 'Reparsing...',
    successDetail: (name: string) => `${name} is being reparsed from the stored original. Retrieval projections refresh after the new attempt publishes.`,
    successLabel: 'Reparse enqueued',
  },
  retry: {
    idleDetail: 'Retry starts a new attempt from the retained original while the failed record stays auditable.',
    idleLabel: 'Retry ready',
    label: 'Retry from retained original',
    pendingDetail: (name: string) => `Retrying ${name} from the retained original. The failed attempt remains in the durable timeline.`,
    pendingLabel: 'Retrying ingestion',
    pendingSubmitLabel: 'Retrying...',
    successDetail: (name: string) => `${name} was queued for retry. The previous failed attempt remains available for audit.`,
    successLabel: 'Retry enqueued',
  },
} satisfies Record<IngestionJobAction, {
  idleDetail: string
  idleLabel: string
  label: string
  pendingDetail: (name: string) => string
  pendingLabel: string
  pendingSubmitLabel: string
  successDetail: (name: string) => string
  successLabel: string
}>

export function buildIngestionJobActionViewModel({
  action,
  completedAction,
  completedName,
  errorAction,
  errorMessage,
  pendingAction,
  targetName,
}: IngestionJobActionViewModelInput): IngestionJobActionViewModel {
  const buttonCopy = action ? ingestionJobActionCopy[action] : undefined
  const actionLabel = action && pendingAction === action
    ? ingestionJobActionCopy[action].pendingSubmitLabel
    : buttonCopy?.label ?? 'Run job action'
  const busy = Boolean(pendingAction)
  const targetLabel = targetName?.trim() || completedName?.trim() || 'this ingestion job'

  if (pendingAction) {
    const copy = ingestionJobActionCopy[pendingAction]
    return {
      actionLabel,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `${copy.label} is locked while ${copy.pendingLabel.toLowerCase()} for ${targetLabel}.`,
      feedbackDetail: copy.pendingDetail(targetLabel),
      feedbackLabel: copy.pendingLabel,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorAction && errorMessage) {
    const copy = ingestionJobActionCopy[errorAction]
    const canSubmit = Boolean(action)
    return {
      actionLabel,
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Select a recoverable ingestion job before retrying an action.',
      feedbackDetail: `${errorMessage} ${targetLabel} remains unchanged and the action can be retried if it is still available.`,
      feedbackLabel: `${copy.label} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (completedAction) {
    const copy = ingestionJobActionCopy[completedAction]
    const canSubmit = Boolean(action)
    return {
      actionLabel,
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Select a recoverable ingestion job before running another action.',
      feedbackDetail: copy.successDetail(completedName?.trim() || targetLabel),
      feedbackLabel: copy.successLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (action) {
    const copy = ingestionJobActionCopy[action]
    return {
      actionLabel,
      ariaDisabled: false,
      canSubmit: !busy,
      feedbackDetail: copy.idleDetail,
      feedbackLabel: copy.idleLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  return {
    actionLabel,
    ariaDisabled: true,
    canSubmit: false,
    disabledDetail: 'Select a recoverable ingestion job before running an action.',
    feedbackDetail: 'Select a recoverable ingestion job to inspect available actions.',
    feedbackLabel: 'Job action ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}

export function buildIngestionJobRecoveryBriefing(
  job: IngestionJob,
): IngestionJobRecoveryBriefing {
  const displayName = job.display_name ?? 'Ingestion attempt'
  const eventCountLabel = `${job.event_count} persisted transition${job.event_count === 1 ? '' : 's'}`

  if (job.status === 'failed' || job.status === 'cancelled') {
    const issue = jobIssueDetail(job)
    return {
      ariaLabel: `${displayName} needs recovery. Original is retained. Current blocker: ${issue}`,
      detail: 'The retained original makes this recoverable. Review the blocker, then enqueue a retry when the source or parser condition is understood.',
      primaryAction: 'retry',
      primaryLabel: 'Retry from retained original',
      primaryTone: 'neutral',
      statusLabel: job.status === 'cancelled' ? 'Cancelled' : 'Needs recovery',
      steps: [
        {
          detail: retainedOriginalDetail(job),
          label: 'Original retained',
          state: 'done',
        },
        {
          detail: issue,
          label: 'Current blocker',
          state: 'blocked',
        },
        {
          detail: 'Retry creates a new attempt while this failed record stays auditable.',
          label: 'Safe retry path',
          state: 'pending',
        },
      ],
      title: `${displayName} can be recovered`,
      tone: 'failed',
    }
  }

  if (job.status === 'completed') {
    return {
      ariaLabel: `${displayName} reached published evidence. Reparse is optional and should be used only when the original or parser rules changed.`,
      detail: 'Evidence is already published. Reparse only when you need to rebuild projections from the stored original.',
      primaryAction: job.source_id ? 'reprocess' : undefined,
      primaryLabel: job.source_id ? 'Reparse original' : undefined,
      primaryTone: 'neutral',
      statusLabel: 'Published',
      steps: [
        {
          detail: retainedOriginalDetail(job),
          label: 'Original retained',
          state: 'done',
        },
        {
          detail: eventCountLabel,
          label: 'Evidence published',
          state: 'done',
        },
        {
          detail: 'Optional rebuild keeps existing evidence available until the new attempt publishes.',
          label: 'Reparse guard',
          state: 'pending',
        },
      ],
      title: `${displayName} is already published`,
      tone: 'complete',
    }
  }

  if (!terminalIngestionStatuses.has(job.status)) {
    return {
      ariaLabel: `${displayName} is processing at ${labelIngestionValue(job.stage)}. Worker progress is persisted as events arrive.`,
      detail: 'Let the worker continue unless this is the wrong material or the job is clearly stuck.',
      primaryAction: 'cancel',
      primaryLabel: 'Cancel job',
      primaryTone: 'danger',
      statusLabel: 'Worker active',
      steps: [
        {
          detail: retainedOriginalDetail(job),
          label: 'Original retained',
          state: 'done',
        },
        {
          detail: `Current stage is ${labelIngestionValue(job.stage)}.`,
          label: 'Worker progress',
          state: 'current',
        },
        {
          detail: 'Publishing will update retrieval projections when enrichment completes.',
          label: 'Publish evidence',
          state: 'pending',
        },
      ],
      title: `${displayName} is still processing`,
      tone: 'active',
    }
  }

  return {
    ariaLabel: `${displayName} is stored with no active recovery action.`,
    detail: 'The original is retained and the durable event record can be inspected before taking another action.',
    statusLabel: 'Stored',
    steps: [
      {
        detail: retainedOriginalDetail(job),
        label: 'Original retained',
        state: 'done',
      },
      {
        detail: `Current status is ${labelIngestionValue(job.status)}.`,
        label: 'No active worker',
        state: 'current',
      },
    ],
    title: `${displayName} is stored`,
    tone: 'stored',
  }
}

export function buildIngestionJobEventNarrative(
  event: IngestionJobEvent,
): IngestionJobEventNarrative {
  const payload = event.payload ?? {}
  const payloadPreview = Object.keys(payload).length > 0 ? JSON.stringify(payload) : ''
  const sequenceLabel = `#${event.sequence}`
  const eventType = labelIngestionValue(event.event_type)
  let title = eventType
  let detail = 'The ingestion pipeline recorded this state transition in the durable job ledger.'
  let statusLabel = 'Recorded'
  let tone: IngestionJobEventNarrativeTone = 'neutral'
  let facts: IngestionJobEventFact[] = []

  switch (event.event_type) {
    case 'ingestion.raw.stored':
      title = 'Original retained'
      statusLabel = 'Stored'
      tone = 'stored'
      detail = 'The raw material and immutable Source Version were persisted before parsing began.'
      facts = [
        fact('Source', payload.source_id, 18),
        fact('Version', payload.source_version_id, 18),
      ]
      break
    case 'ingestion.retry.requested':
      title = 'Retry requested'
      statusLabel = 'Queued'
      tone = 'active'
      detail = 'A new worker attempt was requested from the retained original; the failed attempt remains in history.'
      facts = [fact('Previous attempts', payload.previous_attempts)]
      break
    case 'ingestion.reprocess.requested':
      title = 'Reparse requested'
      statusLabel = 'Queued'
      tone = 'active'
      detail = 'A fresh ingestion job was created for the stored original so projections can be rebuilt safely.'
      facts = [
        fact('Source', payload.source_id, 18),
        fact('Version', payload.source_version_id, 18),
      ]
      break
    case 'ingestion.lease.acquired':
    case 'ingestion.lease.recovered':
      title = event.event_type === 'ingestion.lease.recovered' ? 'Worker lease recovered' : 'Worker lease acquired'
      statusLabel = 'Claimed'
      tone = 'active'
      detail = 'A worker claimed the job with a fencing token so duplicate workers cannot publish over the active attempt.'
      facts = [
        fact('Attempt', payload.attempt),
        fact('Fence', payload.fencing_token),
        fact('Worker', payload.worker_id, 28),
      ]
      break
    case 'ingestion.parsing.started':
      title = 'Parser started'
      statusLabel = 'Parsing'
      tone = 'active'
      detail = 'The enrichment worker started extracting readable evidence from the retained original.'
      break
    case 'ingestion.evidence.published':
      title = 'Evidence published'
      statusLabel = 'Published'
      tone = 'complete'
      detail = 'Evidence records were written and the capability ledger captured which retrieval projections are ready.'
      facts = [
        fact('Evidence', payload.evidence_count),
        fact('Version', payload.source_version_id, 18),
        ...capabilityFacts(payload),
      ]
      break
    case 'ingestion.failed':
      title = 'Ingestion failed'
      statusLabel = 'Needs recovery'
      tone = 'failed'
      detail = 'The worker stopped before publishing. The original remains retained so the failed stage can be retried.'
      facts = [
        fact('Code', payload.code),
        fact('Message', payload.message, 42),
      ]
      break
    case 'ingestion.cancelled':
      title = 'Job cancelled'
      statusLabel = 'Cancelled'
      tone = 'failed'
      detail = 'The job was stopped before completion. The retained original can be retried when the interruption is resolved.'
      facts = [
        fact('Reason', payload.reason),
        fact('Source', payload.source_id, 18),
      ].filter((item) => item.value !== 'none')
      break
    default:
      facts = Object.entries(payload).slice(0, 3).map(([key, value]) => (
        fact(labelIngestionValue(key), value)
      ))
  }

  return {
    ariaLabel: `Event ${event.sequence}. ${title}. ${detail}`,
    detail,
    facts,
    payloadPreview,
    sequenceLabel,
    statusLabel,
    title,
    tone,
  }
}
