import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, FileCheck2, LayoutTemplate, ShieldCheck, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { type Artifact, nexusApi } from '@/api/nexus'

export function ArtifactTemplateComposer({
  artifacts,
  onClose,
  onCreated,
}: {
  artifacts: Artifact[]
  onClose: () => void
  onCreated: (artifact: Artifact) => void
}) {
  const eligible = artifacts.filter((item) => item.coverage.supported_block_count > 0
    && item.pending_refresh_count === 0
    && !item.canonical_document.template)
  const templates = useQuery({ queryKey: ['artifact-templates'], queryFn: nexusApi.listArtifactTemplates })
  const [sourceId, setSourceId] = useState(eligible[0]?.id ?? '')
  const [templateId, setTemplateId] = useState('evidence_brief')
  const [title, setTitle] = useState(eligible[0] ? `${eligible[0].title} · Evidence brief` : '')
  const [reviewText, setReviewText] = useState('')
  const selectedTemplate = templates.data?.items.find((item) => item.id === templateId)
  const create = useMutation({
    mutationFn: () => nexusApi.createArtifactFromTemplate({
      source_artifact_id: sourceId,
      template_id: templateId,
      title: title.trim(),
      review_text: reviewText.trim() || undefined,
    }),
    onSuccess: onCreated,
  })
  const selectTemplate = (id: string, name: string) => {
    setTemplateId(id)
    setReviewText('')
    const source = eligible.find((item) => item.id === sourceId)
    if (source) setTitle(`${source.title} · ${name}`)
  }
  const selectSource = (id: string) => {
    setSourceId(id)
    const source = eligible.find((item) => item.id === id)
    const template = templates.data?.items.find((item) => item.id === templateId)
    if (source && template) setTitle(`${source.title} · ${template.name}`)
  }
  return <section className="artifact-template-composer" aria-label="Create Artifact from template">
    <header><span><LayoutTemplate /><span><p className="eyebrow">Reusable layouts</p><h2>Create from an evidence-backed Artifact</h2><p>Templates reframe existing content and preserve its immutable Evidence IDs. They never generate or silently rebind claims.</p></span></span><button className="icon-button" onClick={onClose} aria-label="Close template composer"><X size={16} /></button></header>
    {eligible.length ? <>
      <div className="artifact-template-grid">{templates.isLoading && <p className="panel-note">Loading governed layouts…</p>}{templates.data?.items.map((template) => <button type="button" key={template.id} className={templateId === template.id ? 'selected' : ''} onClick={() => selectTemplate(template.id, template.name)}>
        <span><FileCheck2 /><strong>{template.name}</strong></span><p>{template.description}</p><small>{template.audience}</small>{template.review_prompt && <em><ShieldCheck />Adds an explicit human review block</em>}
      </button>)}{templates.error && <p className="form-error">{templates.error.message}</p>}</div>
      <div className="artifact-template-fields">
        <label><span>Source Artifact</span><select value={sourceId} onChange={(event) => selectSource(event.target.value)}>{eligible.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.coverage.coverage_percent}% covered</option>)}</select><small>Only original, evidence-supported Artifacts without pending refreshes are eligible.</small></label>
        <label><span>New title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={512} /><small>The derived Artifact starts as a candidate revision.</small></label>
        {selectedTemplate?.review_prompt && <label className="artifact-template-review"><span>Human review block</span><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder={selectedTemplate.review_prompt} maxLength={4000} rows={3} /><small>This text is recorded as user-authored and remains distinct from generated findings.</small></label>}
      </div>
      {create.error && <div className="notice negative" role="alert"><strong>Template was not applied.</strong><span>{create.error.message}</span></div>}
      <footer><span>Source content remains unchanged.</span><button className="button primary" onClick={() => create.mutate()} disabled={create.isPending || !sourceId || !title.trim() || Boolean(selectedTemplate?.review_prompt && !reviewText.trim())}>{create.isPending ? 'Creating candidate…' : 'Create candidate'}<ArrowRight size={14} /></button></footer>
    </> : <div className="artifact-template-empty"><ShieldCheck /><div><h3>An evidence-backed source Artifact is required</h3><p>Complete a Research Run or add Evidence bindings to an existing candidate before applying a layout.</p><Link className="button" to="/research/new">Start Deep Research</Link></div></div>}
  </section>
}
