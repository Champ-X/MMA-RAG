export type SourceTimelineAuditJobSnapshot = {
  id: string
  status?: string | null
}

export type SourceTimelineAuditLinkViewModel = {
  ariaLabel: string
  detail: string
  href: string
  jobLabel: string
  label: string
  statusLabel: string
}

const timelineStatusFilters = new Set(['pending', 'running', 'completed', 'failed', 'cancelled'])

function normalizeTimelineStatus(status?: string | null) {
  if (!status) return 'all'
  return timelineStatusFilters.has(status) ? status : 'all'
}

export function buildSourceTimelineAuditLinkViewModel({
  job,
  sourceName,
  spaceId,
}: {
  job?: SourceTimelineAuditJobSnapshot | null
  sourceName?: string
  spaceId: string
}): SourceTimelineAuditLinkViewModel {
  const params = new URLSearchParams()
  if (job?.id) params.set('job', job.id)
  const status = normalizeTimelineStatus(job?.status)
  if (status !== 'all') params.set('status', status)
  const query = params.toString()
  const href = `/spaces/${encodeURIComponent(spaceId)}/jobs${query ? `?${query}` : ''}`
  const jobLabel = job?.id ? job.id.slice(0, 8) : 'not pinned'
  const statusLabel = status === 'all' ? 'all jobs' : status
  const target = sourceName?.trim() || 'material'

  if (status === 'failed' || status === 'cancelled') {
    return {
      ariaLabel: `Review audit link for ${target}. Opens job ${jobLabel} in the ${statusLabel} recovery filter.`,
      detail: 'Opens the durable timeline with this recovery state pinned.',
      href,
      jobLabel,
      label: 'Review audit link',
      statusLabel,
    }
  }

  if (status === 'pending' || status === 'running') {
    return {
      ariaLabel: `Track audit link for ${target}. Opens job ${jobLabel} in the ${statusLabel} worker filter.`,
      detail: 'Opens the live worker queue with this job pinned.',
      href,
      jobLabel,
      label: 'Track audit link',
      statusLabel,
    }
  }

  if (status === 'completed') {
    return {
      ariaLabel: `Open audit link for ${target}. Opens job ${jobLabel} in the completed evidence filter.`,
      detail: 'Opens the published evidence ledger with this job pinned.',
      href,
      jobLabel,
      label: 'Open audit link',
      statusLabel,
    }
  }

  return {
    ariaLabel: `Open ingestion timeline for ${target}.`,
    detail: 'Opens the durable ingestion ledger for this Space.',
    href,
    jobLabel,
    label: 'Open timeline',
    statusLabel,
  }
}
