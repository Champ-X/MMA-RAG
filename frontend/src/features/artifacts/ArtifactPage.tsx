import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronDown, Clipboard, Code2, Download, FileJson, FileText, Pencil, RefreshCw, Save, Send, ShieldAlert, ShieldCheck, Undo2, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { ArtifactCoverageMeter } from './ArtifactCoverageMeter'
import { ArtifactDocument } from './ArtifactDocument'
import { getArtifactReadiness } from './artifactReadiness'

export default function ArtifactPage() {
  const { artifactId = '' } = useParams()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState('')
  const artifact = useQuery({ queryKey: ['artifact', artifactId], queryFn: () => nexusApi.getArtifact(artifactId), enabled: Boolean(artifactId) })
  const proposals = useQuery({ queryKey: ['artifact-refresh-proposals', artifactId], queryFn: () => nexusApi.listArtifactRefreshProposals(artifactId), enabled: Boolean(artifactId) })
  const revise = useMutation({
    mutationFn: (value: string) => {
      const canonical = JSON.parse(value) as Record<string, unknown>
      return nexusApi.reviseArtifact(artifactId, {
        expected_revision_no: artifact.data?.revision_no ?? 0,
        canonical_document: canonical,
      })
    },
    onSuccess: (value) => {
      queryClient.setQueryData(['artifact', artifactId], value)
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      setDraft(null)
    },
  })
  const changeStatus = useMutation({
    mutationFn: (status: 'candidate' | 'published') => nexusApi.setArtifactStatus(artifactId, {
      expected_revision_no: artifact.data?.revision_no ?? 0,
      status,
    }),
    onSuccess: (value) => {
      queryClient.setQueryData(['artifact', artifactId], value)
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    },
  })
  const resolveRefresh = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => nexusApi.resolveArtifactRefreshProposal(id, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artifact', artifactId] })
      queryClient.invalidateQueries({ queryKey: ['artifact-refresh-proposals', artifactId] })
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    },
  })
  const copyWorkspaceLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyFeedback('Workspace link copied')
    } catch {
      setCopyFeedback('Copy failed—use the browser address')
    }
    window.setTimeout(() => setCopyFeedback(''), 2400)
  }
  if (artifact.isLoading) return <LoadingState />
  if (!artifact.data) return <EmptyState title="Artifact unavailable" body="The requested Artifact or revision does not exist." />
  const readiness = getArtifactReadiness(artifact.data)
  const pendingRefresh = proposals.data?.items.find((item) => item.status === 'pending')
  const isPublished = artifact.data.status === 'published'
  const description = isPublished
    ? 'Published in this workspace with a stable URL. Revisions remain immutable and evidence traceable.'
    : 'Candidate draft awaiting an explicit publication decision. Review evidence coverage before sharing it as knowledge.'
  return (
    <div className="page-shell artifact-page">
      <Link className="artifact-back-link" to="/studio"><ArrowLeft size={14} />Back to Artifact Studio</Link>
      <PageHeader eyebrow={`${artifact.data.artifact_type.replaceAll('_', ' ')} · revision ${artifact.data.revision_no}`} title={artifact.data.title} description={description} actions={<div className="artifact-actions">
        {isPublished ? <>
          <button className="button primary" onClick={copyWorkspaceLink}><Clipboard size={15} />Copy workspace link</button>
          <button className="button" onClick={() => changeStatus.mutate('candidate')} disabled={changeStatus.isPending}><Undo2 size={15} />Return to draft</button>
        </> : <button className="button primary" onClick={() => changeStatus.mutate('published')} disabled={!readiness.publishable || changeStatus.isPending} title={!readiness.publishable ? readiness.detail : undefined}><Send size={15} />{changeStatus.isPending ? 'Publishing…' : 'Publish'}</button>}
        <button className="button" onClick={() => setDraft(JSON.stringify(artifact.data.canonical_document, null, 2))}><Pencil size={15} />Advanced edit</button>
        <details className="artifact-export-menu"><summary className="button">Export <ChevronDown size={14} /></summary><div>
          <a href={`/api/v1/artifacts/${artifactId}/render?format=markdown`}><FileText size={15} />Markdown</a>
          <a href={`/api/v1/artifacts/${artifactId}/render?format=json`}><FileJson size={15} />Canonical JSON</a>
          <a href={`/api/v1/artifacts/${artifactId}/render?format=html`} target="_blank" rel="noreferrer"><Code2 size={15} />Open HTML</a>
          <a href={`/api/v1/artifacts/${artifactId}/render?format=pdf`}><Download size={15} />PDF</a>
        </div></details>
      </div>} />
      {copyFeedback && <div className={`notice ${copyFeedback.startsWith('Workspace') ? 'positive' : 'warning'}`} role="status"><Clipboard size={16} /><strong>{copyFeedback}</strong></div>}
      {changeStatus.error && <div className="notice negative" role="alert"><ShieldAlert size={16} /><strong>Publication state was not changed.</strong><span>{changeStatus.error.message}</span></div>}
      <section className={`artifact-readiness ${readiness.tone}`}>
        <span>{readiness.tone === 'positive' ? <ShieldCheck /> : <ShieldAlert />}</span>
        <div><p className="eyebrow">Publication readiness</p><h2>{readiness.title}</h2><p>{readiness.detail}</p></div>
        <ArtifactCoverageMeter coverage={artifact.data.coverage} />
        <dl>
          <div><dt>Evidence</dt><dd>{artifact.data.coverage.bound_evidence_count}</dd></div>
          <div><dt>Supported</dt><dd>{artifact.data.coverage.supported_block_count}/{artifact.data.coverage.content_block_count}</dd></div>
          <div><dt>User blocks</dt><dd>{artifact.data.coverage.user_block_count}</dd></div>
          <div><dt>Pending refresh</dt><dd>{artifact.data.pending_refresh_count}</dd></div>
        </dl>
      </section>
      {pendingRefresh && <section className="refresh-proposal"><RefreshCw size={20} /><div><strong>Source change requires review</strong><p>{pendingRefresh.diff.removed_evidence_revision_ids instanceof Array ? pendingRefresh.diff.removed_evidence_revision_ids.length : 0} prior Evidence bindings are affected. Generated blocks have a proposed diff; user-authored blocks remain unchanged.</p></div><div className="button-group"><button className="button" onClick={() => resolveRefresh.mutate({ id: pendingRefresh.id, accept: false })} disabled={resolveRefresh.isPending}><X size={14} />Reject</button><button className="button primary" onClick={() => resolveRefresh.mutate({ id: pendingRefresh.id, accept: true })} disabled={resolveRefresh.isPending}><Check size={14} />Accept refresh</button></div></section>}
      {draft !== null && <section className="artifact-json-editor"><div><span><strong>Advanced · Canonical JSON</strong><small>Saving creates revision {artifact.data.revision_no + 1} and returns this Artifact to candidate status. Immutable Evidence cannot be silently rebound.</small></span><button className="icon-button" onClick={() => setDraft(null)} aria-label="Close editor"><X size={16} /></button></div><textarea aria-label="Canonical JSON" value={draft} onChange={(event) => setDraft(event.target.value)} rows={18} spellCheck={false} />{revise.error && <div className="notice negative">{revise.error.message}</div>}<button className="button primary" onClick={() => revise.mutate(draft)} disabled={revise.isPending}><Save size={15} />{revise.isPending ? 'Saving revision…' : 'Save new revision'}</button></section>}
      <div className="artifact-editor-frame">
        <aside><StatusMark status={artifact.data.status} /><dl><div><dt>Revision ID</dt><dd><code>{artifact.data.revision_id}</code></dd></div><div><dt>Originating Run</dt><dd>{artifact.data.run_id ? <Link to={`/runs/${artifact.data.run_id}`}>{artifact.data.run_id.slice(0, 8)} →</Link> : 'Independent'}</dd></div><div><dt>Schema</dt><dd>{String(artifact.data.canonical_document.schema ?? 'unknown')}</dd></div><div><dt>Last updated</dt><dd>{new Date(artifact.data.updated_at).toLocaleString()}</dd></div></dl><p>Publishing changes the lifecycle state, never the immutable revision. Editing always creates a new candidate revision.</p></aside>
        <ArtifactDocument document={artifact.data.canonical_document} runId={artifact.data.run_id} />
      </div>
    </div>
  )
}
