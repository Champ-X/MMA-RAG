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
import { Link, useParams } from 'react-router-dom'
import { nexusApi, type SpaceKnowledgeClaim } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { useState } from 'react'

type KnowledgeFilter = 'all' | 'supported' | 'attention'

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value))

const claimLabel = (claim: SpaceKnowledgeClaim) => {
  if (claim.status === 'supported') return 'Supported'
  if (claim.status === 'partially_supported') return 'Partially supported'
  if (claim.status === 'conflicted') return 'Conflicting evidence'
  if (claim.status === 'stale') return 'Stale evidence'
  return claim.status.replaceAll('_', ' ')
}

export default function VerifiedKnowledgePage() {
  const { spaceId = '' } = useParams()
  const [filter, setFilter] = useState<KnowledgeFilter>('all')
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

  if (space.isLoading || knowledge.isLoading) return <LoadingState label="Compiling verified knowledge" />
  const claims = knowledge.data?.pages.flatMap((page) => page.items) ?? []
  const supported = claims.filter((claim) => claim.status === 'supported').length
  const sourceNames = new Set(claims.flatMap((claim) => claim.evidence.map((item) => item.source_name)))

  return (
    <div className="page-shell verified-knowledge-page">
      <PageHeader
        eyebrow={`Claim-gated knowledge · ${space.data?.name ?? 'Space'}`}
        title="Verified knowledge"
        description="Browse conclusions that reached T2 or T3 verification, with their evidence and unresolved disagreement kept in view."
        actions={<><Link className="button" to={`/spaces/${spaceId}`}><ArrowLeft size={16} />Space overview</Link><Link className="button primary" to={`/research/new?space=${spaceId}`}><Microscope size={16} />Research here</Link></>}
      />

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
        <div><BookOpenCheck /><span><strong>{claims.length}{knowledge.hasNextPage ? '+' : ''}</strong><small>Claims loaded</small></span></div>
        <div><BadgeCheck /><span><strong>{supported}</strong><small>Supported</small></span></div>
        <div><AlertTriangle /><span><strong>{claims.length - supported}</strong><small>Need review</small></span></div>
        <div><FileCheck2 /><span><strong>{sourceNames.size}</strong><small>Sources cited</small></span></div>
      </section>

      <div className="knowledge-toolbar">
        <div className="segmented" role="group" aria-label="Claim status filter">
          <button className={filter === 'all' ? 'active' : undefined} onClick={() => setFilter('all')}>All claims</button>
          <button className={filter === 'supported' ? 'active' : undefined} onClick={() => setFilter('supported')}>Supported</button>
          <button className={filter === 'attention' ? 'active' : undefined} onClick={() => setFilter('attention')}>Needs review</button>
        </div>
        <span>{knowledge.isFetching && !knowledge.isFetchingNextPage && <Loader2 className="spin" size={13} />}Newest verified Claims first</span>
      </div>

      {knowledge.error && <div className="notice negative">Verified knowledge could not be loaded. {knowledge.error.message}</div>}
      {claims.length ? (
        <>
          <div className="verified-claim-list">
            {claims.map((claim) => <article className={`verified-claim-card claim-${claim.status}`} key={claim.id}>
              <header>
                <div className="claim-index"><span>{claim.verification_level}</span><small>{claim.claim_type.replaceAll('_', ' ')}</small></div>
                <div><StatusMark status={claim.status} label={claimLabel(claim)} /><time><Clock3 size={12} />{formatDate(claim.created_at)}</time></div>
              </header>
              <blockquote>{claim.text}</blockquote>
              {claim.explanation && <p className="claim-explanation">{claim.explanation}</p>}
              <section className="claim-evidence-strip">
                <p className="eyebrow">Bound evidence · {claim.evidence.length}</p>
                <div>{claim.evidence.map((evidence) => <Link key={`${claim.id}-${evidence.evidence_revision_id}`} to={`/runs/${claim.run_id}/evidence/${evidence.evidence_revision_id}`}>
                  <span className={`source-type modality-${evidence.modality}`}>{evidence.modality}</span>
                  <span><strong>{evidence.source_name}</strong><small>{evidence.evidence_type.replaceAll('_', ' ')} · {evidence.locator_type.replaceAll('_', ' ')} · {Math.round(evidence.support_score * 100)}% support</small></span>
                  <ExternalLink size={13} />
                </Link>)}</div>
              </section>
              <footer><span>Claim {claim.id.slice(0, 8)}</span><Link to={`/runs/${claim.run_id}`}>Open originating Run <ArrowRight size={13} /></Link></footer>
            </article>)}
          </div>
          {knowledge.hasNextPage && <div className="knowledge-load-more"><button className="button" onClick={() => knowledge.fetchNextPage()} disabled={knowledge.isFetchingNextPage}>{knowledge.isFetchingNextPage && <Loader2 className="spin" size={14} />}Load more Claims</button></div>}
        </>
      ) : (
        <EmptyState
          title={filter === 'all' ? 'No verified knowledge yet' : 'No Claims in this view'}
          body={filter === 'all' ? 'Run research in this Space. Claims appear only after they reach T2/T3 verification and retain direct Evidence bindings.' : 'Try another status view, or run research to develop the evidence ledger.'}
          action={filter === 'all' ? <Link className="button primary" to={`/research/new?space=${spaceId}`}>Start research</Link> : <button className="button" onClick={() => setFilter('all')}>Show all Claims</button>}
        />
      )}
    </div>
  )
}
