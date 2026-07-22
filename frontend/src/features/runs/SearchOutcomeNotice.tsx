import { AlertTriangle, FileSearch, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Run, SearchExplanation } from '@/api/nexus'
import { readSearchExplanation, searchOutcomeCopy } from './searchOutcome'
import './SearchOutcomeNotice.css'

const actionLabels: Record<string, string> = {
  add_sources: 'Add material',
  inspect_ingestion: 'Check ingestion',
  inspect_system_status: 'Open system status',
  retry_search: 'Retry this question',
  inspect_scope_snapshot: 'Inspect frozen scope',
  rebuild_search_projection: 'Review search projection',
  broaden_query: 'Try different wording',
  review_scope: 'Review selected scope',
  inspect_retrieval_details: 'View execution details',
}

function actionTarget(action: string, run: Run) {
  const spaceId = run.scope.space_ids?.[0]
  const retry = `/research/new?question=${encodeURIComponent(run.goal)}${spaceId ? `&space=${encodeURIComponent(spaceId)}` : ''}`
  if (action === 'add_sources') return spaceId ? `/spaces/${spaceId}/sources` : '/spaces'
  if (action === 'inspect_ingestion') return spaceId ? `/spaces/${spaceId}/jobs` : '/system/jobs'
  if (action === 'inspect_system_status' || action === 'rebuild_search_projection') return '/system/status'
  if (action === 'inspect_retrieval_details' || action === 'inspect_scope_snapshot') return `/runs/${run.id}#execution-details`
  return retry
}

function OutcomeIcon({ explanation }: { explanation: SearchExplanation }) {
  if (explanation.outcome === 'evidence_found_degraded') return <ShieldCheck />
  if (explanation.severity === 'error' || explanation.severity === 'warning') return <AlertTriangle />
  return <FileSearch />
}

export function SearchOutcomeNotice({ run, result }: { run: Run; result: Record<string, unknown> | null }) {
  const explanation = readSearchExplanation(result)
  if (!explanation || explanation.outcome === 'evidence_found') return null
  const copy = searchOutcomeCopy[explanation.outcome]
  if (!copy) return null
  const channelTotal = explanation.completed_channels + explanation.failed_channels + explanation.unavailable_channels
  return (
    <section className={`search-outcome-notice ${explanation.severity}`} aria-label="Search result explanation">
      <span className="outcome-icon"><OutcomeIcon explanation={explanation} /></span>
      <div className="outcome-copy"><strong>{copy.title}</strong><p>{copy.body}</p></div>
      <dl>
        <div><dt>Visible evidence</dt><dd>{explanation.scope_evidence_count}</dd></div>
        <div><dt>Channels completed</dt><dd>{explanation.completed_channels}/{channelTotal}</dd></div>
      </dl>
      {explanation.suggested_actions.length > 0 && <nav aria-label="Suggested next actions">{explanation.suggested_actions.map((action) => <Link key={action} to={actionTarget(action, run)}>{actionLabels[action] ?? action.replaceAll('_', ' ')}</Link>)}</nav>}
    </section>
  )
}
