import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, FileCheck2, LayoutTemplate, ShieldCheck, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { type Artifact, nexusApi } from '@/api/nexus'
import { LedgerSelect } from '@/components/nexus/LedgerSelect'
import { PanelNote } from '@/components/nexus/PanelNote'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import { buildArtifactTemplateComposerViewModel } from './artifactTemplateComposerViewModel'
import './ArtifactTemplateComposer.css'

const artifactTemplateFeedbackId = 'artifact-template-feedback'
const artifactTemplateGateId = 'artifact-template-gate'
const artifactTemplateReviewHelpId = 'artifact-template-review-help'
const artifactTemplateTitleHelpId = 'artifact-template-title-help'

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
  const templateRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
  const [title, setTitle] = useState(eligible[0] ? `${eligible[0].title} · Evidence brief` : '')
  const [reviewText, setReviewText] = useState('')
  const selectedTemplate = templates.data?.items.find((item) => item.id === templateId)
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: templates.error, hasData: Boolean(templates.data), label: 'Artifact templates', required: true },
  ])
  const retryArtifactTemplates = () => {
    void templates.refetch()
  }
  const sourceOptions = eligible.map((item) => ({
    value: item.id,
    label: item.title,
    description: `${item.coverage.coverage_percent}% covered · ${item.evidence_revision_ids.length} evidence bindings`,
  }))
  const create = useMutation({
    mutationFn: () => nexusApi.createArtifactFromTemplate({
      source_artifact_id: sourceId,
      template_id: templateId,
      title: title.trim(),
      review_text: reviewText.trim() || undefined,
    }),
    onSuccess: onCreated,
  })
  const composer = buildArtifactTemplateComposerViewModel({
    eligibleCount: eligible.length,
    errorMessage: create.error?.message,
    pending: create.isPending,
    reviewRequired: Boolean(selectedTemplate?.review_prompt),
    reviewText,
    sourceId,
    templateId: selectedTemplate ? templateId : '',
    templatesLoading: templates.isLoading,
    templateName: selectedTemplate?.name,
    title,
  })
  const submit = () => {
    if (!composer.canSubmit) return
    create.mutate()
  }
  const selectTemplate = (id: string, name: string) => {
    setTemplateId(id)
    setReviewText('')
    const source = eligible.find((item) => item.id === sourceId)
    if (source) setTitle(`${source.title} · ${name}`)
  }
  const handleTemplateKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    const templateItems = templates.data?.items ?? []
    const nextTemplateId = moveRadioGroupValue(templateItems.map((template) => template.id), templateId, direction)
    const nextTemplate = templateItems.find((template) => template.id === nextTemplateId)
    if (!nextTemplate) return
    event.preventDefault()
    selectTemplate(nextTemplate.id, nextTemplate.name)
    window.requestAnimationFrame(() => templateRefs.current[nextTemplate.id]?.focus({ preventScroll: true }))
  }
  const selectSource = (id: string) => {
    setSourceId(id)
    const source = eligible.find((item) => item.id === id)
    const template = templates.data?.items.find((item) => item.id === templateId)
    if (source && template) setTitle(`${source.title} · ${template.name}`)
  }
  return <section className="artifact-template-composer" aria-label="Create Artifact from template">
    <header><span><LayoutTemplate /><span><p className="eyebrow">Reusable layouts</p><h2>Create from an evidence-backed Artifact</h2><p>Templates reframe existing content and preserve its immutable Evidence IDs. They never generate or silently rebind claims.</p></span></span><button type="button" className="icon-button" onClick={onClose} aria-label="Close template composer"><X size={16} /></button></header>
    {queryErrorNotice.tone === 'blocking' && <><QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactTemplates} /><div className="artifact-template-empty"><ShieldCheck /><div><h3>Template registry is temporarily unavailable</h3><p>Retry before creating a derived Artifact. Governed layouts and required review rules must come from the authoritative template registry.</p></div></div></>}
    {queryErrorNotice.tone !== 'blocking' && (eligible.length ? <>
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactTemplates} /><div className="artifact-template-grid" role="radiogroup" aria-label="Artifact template">{templates.isLoading && <PanelNote align="start">Loading governed layouts...</PanelNote>}{templates.data?.items.map((template) => <button type="button" key={template.id} ref={(node) => { templateRefs.current[template.id] = node }} role="radio" aria-checked={templateId === template.id} tabIndex={templateId === template.id ? 0 : -1} className={templateId === template.id ? 'selected' : ''} onKeyDown={handleTemplateKeyDown} onClick={() => selectTemplate(template.id, template.name)}>
        <span><FileCheck2 /><strong>{template.name}</strong></span><p>{template.description}</p><small>{template.audience}</small>{template.review_prompt && <em><ShieldCheck />Adds an explicit human review block</em>}
      </button>)}</div>
      <div className="artifact-template-fields">
        <label><span>Source Artifact</span><LedgerSelect ariaLabel="Source Artifact" value={sourceId} options={sourceOptions} onChange={selectSource} /><small>Only original, evidence-supported Artifacts without pending refreshes are eligible.</small></label>
        <label><span>New title</span><p className="sr-only" id={artifactTemplateTitleHelpId}>The derived candidate Artifact requires a title.</p><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={512} aria-describedby={`${artifactTemplateTitleHelpId} ${artifactTemplateFeedbackId}`} aria-invalid={composer.titleRequired} /><small>The derived Artifact starts as a candidate revision.</small></label>
        {selectedTemplate?.review_prompt && <label className="artifact-template-review"><span>Human review block</span><p className="sr-only" id={artifactTemplateReviewHelpId}>This template requires human review text before creating a candidate.</p><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder={selectedTemplate.review_prompt} maxLength={4000} rows={3} aria-describedby={`${artifactTemplateReviewHelpId} ${artifactTemplateFeedbackId}`} aria-invalid={composer.reviewRequiredMissing} /><small>This text is recorded as user-authored and remains distinct from generated findings.</small></label>}
      </div>
      <SubmitReadinessCard className="artifact-template-feedback" id={artifactTemplateFeedbackId} model={composer} />
      <footer><span>Source content remains unchanged.</span><button type="button" className="button primary" aria-describedby={`${artifactTemplateFeedbackId}${composer.disabledDetail ? ` ${artifactTemplateGateId}` : ''}`} aria-disabled={composer.ariaDisabled || undefined} onClick={submit}>{composer.submitLabel}<ArrowRight size={14} /></button>{composer.disabledDetail && <span className="sr-only" id={artifactTemplateGateId}>{composer.disabledDetail}</span>}</footer>
    </> : <div className="artifact-template-empty"><ShieldCheck /><div><h3>An evidence-backed source Artifact is required</h3><p>Complete a Research Run or add Evidence bindings to an existing candidate before applying a layout.</p><Link className="button" to="/research/new">Start Deep Research</Link></div></div>)}
  </section>
}
