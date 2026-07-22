import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Clock3,
  ExternalLink,
  FileCheck2,
  Loader2,
  Microscope,
  ShieldCheck,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { SegmentedControl } from '@/components/nexus/SegmentedControl'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { SourceTypePill } from '@/components/nexus/SourceTypePill'
import { StatusMark } from '@/components/nexus/StatusMark'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import {
  knowledgeFilterOptions,
  parseKnowledgeFilter,
  presentClaim,
  summarizeVerifiedKnowledge,
} from './verifiedKnowledgeViewModel'
import './VerifiedKnowledgePage.css'

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value))

export default function VerifiedKnowledgePage() {
  const { spaceId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const filter = parseKnowledgeFilter(params.get('status'))
  const setFilter = (nextFilter: typeof filter) => {
    const next = new URLSearchParams(params)
    if (nextFilter === 'all') next.delete('status')
    else next.set('status', nextFilter)
    setParams(next, { replace: true })
  }
  const space = useQuery({
    queryKey: ['space', spaceId],
    queryFn: () => nexusApi.getSpace(spaceId),
    enabled: Boolean(spaceId),
  })
  const knowledge = useInfiniteQuery({
    queryKey: ['space-knowledge', spaceId, filter],
    queryFn: ({ pageParam }) => nexusApi.listSpaceKnowledge(spaceId, {
      status: filter,
      cursor: pageParam,
      limit: 30,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.next_cursor ?? undefined,
    enabled: Boolean(spaceId),
  })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: space.error, hasData: Boolean(space.data), label: 'Space', required: true },
    { error: knowledge.error, hasData: Boolean(knowledge.data), label: 'Claim ledger', required: true },
  ])
  const retryVerifiedKnowledge = () => {
    void space.refetch()
    void knowledge.refetch()
  }

  if (space.isLoading || knowledge.isLoading) return <LoadingState label="Compiling verified knowledge" />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell verified-knowledge-page"><PageHeader eyebrow="Claim-gated knowledge" title="Verified knowledge could not be loaded" description="Nexus could not read this Space or its claim-gated knowledge ledger." actions={<Link className="button" to={`/spaces/${spaceId}`}><ArrowLeft size={16} />Space overview</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retryVerifiedKnowledge} /><EmptyState title="Claim ledger is temporarily unavailable" body="Retry before treating this Space as having no verified knowledge. T2/T3 Claims depend on the authoritative Evidence and verification index." /></div>
  const claims = knowledge.data?.pages.flatMap((page) => page.items) ?? []
  const summary = summarizeVerifiedKnowledge(claims, Boolean(knowledge.hasNextPage))

  return (
    <div className="page-shell verified-knowledge-page">
      <PageHeader
        eyebrow={`Claim-gated knowledge · ${space.data?.name ?? 'Space'}`}
        title="Verified knowledge"
        description="Browse conclusions that reached T2 or T3 verification, with their evidence and unresolved disagreement kept in view."
        actions={<><Link className="button" to={`/spaces/${spaceId}`}><ArrowLeft size={16} />Space overview</Link><Link className="button primary" to={`/research/new?space=${spaceId}`}><Microscope size={16} />Research here</Link></>}
      />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryVerifiedKnowledge} />

      <section className="knowledge-governance" aria-label="Knowledge eligibility rules">
        <span><ShieldCheck /></span>
        <div>
          <p className="eyebrow">Claim Gate · provenance preserved</p>
          <h2>A compiled claim ledger, not an auto-generated Wiki</h2>
          <p>Only T2/T3 Claims enter this view. Unsupported T1 hypotheses stay out; partial, conflicting and stale Claims stay visible until evidence resolves them.</p>
        </div>
        <dl>
          <div><dt>Eligible</dt><dd>T2 · T3</dd></div>
          <div><dt>Excluded</dt><dd>T0 · T1</dd></div>
          <div><dt>Evidence</dt><dd>Exact revisions</dd></div>
        </dl>
      </section>

      <section className="knowledge-summary" aria-label="Loaded knowledge summary">
        <div><BookOpenCheck /><span><strong>{summary.claimsLoadedLabel}</strong><small>Claims loaded</small></span></div>
        <div><BadgeCheck /><span><strong>{summary.supported}</strong><small>Supported</small></span></div>
        <div><AlertTriangle /><span><strong>{summary.attention}</strong><small>Need review</small></span></div>
        <div><FileCheck2 /><span><strong>{summary.sourceCount}</strong><small>Sources cited</small></span></div>
      </section>

      <div className="knowledge-toolbar">
        <SegmentedControl ariaLabel="Claim status filter" options={knowledgeFilterOptions} value={filter} onChange={setFilter} />
        <span>{knowledge.isFetching && !knowledge.isFetchingNextPage && <Loader2 className="spin" size={13} />}Newest verified Claims first</span>
      </div>

      {claims.length ? (
        <>
          <div className="verified-claim-list">
            {claims.map((claim) => {
              const presentation = presentClaim(claim)
              return <article className={`verified-claim-card claim-${claim.status} tone-${presentation.tone}`} key={claim.id}>
                <header>
                  <div className="claim-index"><span>{claim.verification_level}</span><small>{claim.claim_type.replaceAll('_', ' ')}</small></div>
                  <div><StatusMark status={claim.status} label={presentation.label} /><time><Clock3 size={12} />{formatDate(claim.created_at)}</time></div>
                </header>
                <div className="claim-risk-ribbon">
                  <span>{presentation.riskLabel}</span>
                  <strong>{presentation.highestSupport}% top support</strong>
                  <small>{presentation.evidenceCountLabel}</small>
                </div>
                <blockquote className="claim-text">{claim.text}</blockquote>
                {claim.explanation && <p className="claim-explanation">{claim.explanation}</p>}
                <details className="claim-evidence-strip">
                  <summary><span>Bound evidence</span><strong>{claim.evidence.length}</strong></summary>
                  <div>{claim.evidence.map((evidence) => <Link key={`${claim.id}-${evidence.evidence_revision_id}`} to={buildEvidenceDetailPath(evidence.evidence_revision_id, claim.run_id)}>
                    <SourceTypePill modality={evidence.modality} />
                    <span><strong>{evidence.source_name}</strong><small>{evidence.evidence_type.replaceAll('_', ' ')} · {evidence.locator_type.replaceAll('_', ' ')} · {Math.round(evidence.support_score * 100)}% support</small></span>
                    <ExternalLink size={13} />
                  </Link>)}</div>
                </details>
                <footer><span>Claim {claim.id.slice(0, 8)}</span><Link to={`/runs/${claim.run_id}`}>Open originating Run <ArrowRight size={13} /></Link></footer>
              </article>
            })}
          </div>
          {knowledge.hasNextPage && <div className="knowledge-load-more"><button type="button" className="button" aria-disabled={knowledge.isFetchingNextPage || undefined} onClick={() => { if (!knowledge.isFetchingNextPage) knowledge.fetchNextPage() }}>{knowledge.isFetchingNextPage && <Loader2 className="spin" size={14} />}Load more Claims</button></div>}
        </>
      ) : (
        <EmptyState
          title={filter === 'all' ? 'No verified knowledge yet' : 'No Claims in this view'}
          body={filter === 'all' ? 'Run research in this Space. Claims appear only after they reach T2/T3 verification and retain direct Evidence bindings.' : 'Try another status view, or run research to develop the evidence ledger.'}
          action={filter === 'all' ? <Link className="button primary" to={`/research/new?space=${spaceId}`}>Start research</Link> : <button type="button" className="button" onClick={() => setFilter('all')}>Show all Claims</button>}
        />
      )}
    </div>
  )
}
