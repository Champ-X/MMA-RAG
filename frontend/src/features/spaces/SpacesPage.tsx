import { FormEvent, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRight,
  Clock3,
  FileText,
  Film,
  FolderKanban,
  Headphones,
  Image as ImageIcon,
  Layers3,
  Microscope,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi, type Space } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { spaceCoverUrl } from '@/components/nexus/spaceCoverUrl'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import {
  getSpacePolicyTemplate,
  spacePolicyTemplates,
  type SpaceProfile,
} from './spacePolicies'
import { buildSpaceArchiveViewModel } from './spaceArchiveViewModel'
import { buildSpaceCreateViewModel } from './spaceCreateViewModel'
import './SpacesPage.css'

const policyIcons = {
  searchable: Search,
  multimodal: ImageIcon,
  research: Microscope,
  archive: Archive,
}
const spaceCreateFeedbackId = 'space-create-feedback'
const spaceCreateGateId = 'space-create-gate'
const spaceCreateNameHelpId = 'space-create-name-help'
const spaceArchiveFeedbackId = 'space-archive-feedback'
const spaceArchiveGateId = 'space-archive-gate'

export default function SpacesPage() {
  const client = useQueryClient()
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: nexusApi.listSpaces })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [profile, setProfile] = useState<SpaceProfile>('searchable')
  const policyRefs = useRef<Partial<Record<SpaceProfile, HTMLButtonElement | null>>>({})
  const [archiveTarget, setArchiveTarget] = useState<Space | null>(null)
  const [archiveReceipt, setArchiveReceipt] = useState('')
  const selectedPolicy = getSpacePolicyTemplate(profile)
  const create = useMutation({
    mutationFn: nexusApi.createSpace,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['spaces'] })
      setCreating(false)
      setName('')
      setDescription('')
      setProfile('searchable')
    },
  })
  const createModel = buildSpaceCreateViewModel({
    errorMessage: create.error?.message,
    name,
    pending: create.isPending,
    policyLabel: selectedPolicy.label,
  })
  const archive = useMutation({
    mutationFn: (space: Space) => nexusApi.deleteSpace(space.id),
    onMutate: () => setArchiveReceipt(''),
    onSuccess: async (_result, space) => {
      setArchiveReceipt(space.name)
      await client.invalidateQueries({ queryKey: ['spaces'] })
    },
  })
  const archiveModel = buildSpaceArchiveViewModel({
    archivedName: archiveReceipt,
    errorMessage: archive.error?.message,
    pending: archive.isPending,
    targetName: archive.variables?.name ?? archiveTarget?.name,
  })
  if (spaces.isLoading) return <LoadingState />
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: spaces.error, hasData: Boolean(spaces.data), label: 'Spaces' },
  ])
  const retrySpaces = () => {
    void spaces.refetch()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!createModel.canSubmit) return
    create.mutate({
      name,
      description,
      knowledge_profile: profile,
      default_quality: selectedPolicy.defaultQuality,
    })
  }
  const selectProfile = (nextProfile: SpaceProfile) => {
    setProfile(nextProfile)
  }
  const handlePolicyKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextProfile = moveRadioGroupValue(spacePolicyTemplates.map((policy) => policy.profile), profile, direction)
    selectProfile(nextProfile)
    window.requestAnimationFrame(() => policyRefs.current[nextProfile]?.focus({ preventScroll: true }))
  }
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Knowledge organization" title="Spaces" description="Each Space fixes a research scope and knowledge profile. Sources remain globally addressable and are never duplicated." actions={<button type="button" className="button primary" onClick={() => setCreating(true)}><Plus size={16} />Create Space</button>} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retrySpaces} />
      {creating && (
        <form className="space-create-sheet" onSubmit={submit}>
          <header>
            <div>
              <p className="eyebrow">Usage strategy · applied at runtime</p>
              <h2>How should Nexus use this Space?</h2>
              <p>Choose a behavior contract for routing and Run defaults. Sources stay global and Evidence stays immutable.</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setCreating(false)} aria-label="Close"><X size={17} /></button>
          </header>
          <div className="space-create-fields">
            <div><label htmlFor="space-name">Space name</label><p className="sr-only" id={spaceCreateNameHelpId}>The Space name is required before Nexus can create the routing scope.</p><input id="space-name" autoFocus aria-required="true" aria-describedby={`${spaceCreateNameHelpId} ${spaceCreateFeedbackId}`} aria-invalid={createModel.nameRequired} value={name} onChange={(event) => setName(event.target.value)} placeholder="Product launch research" /></div>
            <div><label htmlFor="space-description">Purpose</label><input id="space-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should this knowledge help you decide?" /></div>
          </div>
          <div className="policy-picker" role="radiogroup" aria-label="Space usage strategy">
            {spacePolicyTemplates.map((policy, index) => {
              const Icon = policyIcons[policy.profile]
              return <button type="button" ref={(node) => { policyRefs.current[policy.profile] = node }} role="radio" aria-checked={profile === policy.profile} tabIndex={profile === policy.profile ? 0 : -1} className={`policy-option accent-${policy.accent}${profile === policy.profile ? ' selected' : ''}`} key={policy.profile} onKeyDown={handlePolicyKeyDown} onClick={() => selectProfile(policy.profile)}>
                <span className="policy-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon />
                <span className="policy-option-copy"><strong>{policy.label}</strong><small>{policy.summary}</small></span>
                <span className="policy-contract"><em>{policy.defaultQuality} retrieval</em><em>{policy.recommendedKind === 'research' ? 'deep research' : 'quick answer'}</em><em>{policy.routing}</em></span>
              </button>
            })}
          </div>
          <footer>
            <p><strong>{selectedPolicy.label}</strong> will become the visible routing and execution contract for this Space.</p>
            <div><button className="button" type="button" onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="button primary" aria-describedby={`${spaceCreateFeedbackId}${createModel.disabledDetail ? ` ${spaceCreateGateId}` : ''}`} aria-disabled={createModel.ariaDisabled || undefined}>{createModel.submitLabel}<ArrowRight size={15} /></button>{createModel.disabledDetail && <span className="sr-only" id={spaceCreateGateId}>{createModel.disabledDetail}</span>}</div>
          </footer>
          <SubmitReadinessCard className="space-create-feedback" id={spaceCreateFeedbackId} model={createModel} liveMode={createModel.feedbackTone === 'error' ? 'assertive' : 'polite'} role={createModel.feedbackTone === 'error' ? 'alert' : 'status'} />
        </form>
      )}
      {queryErrorNotice.tone === 'blocking' ? (
        <EmptyState title="Spaces could not be loaded" body="Nexus could not verify the current knowledge scopes. Retry before creating a replacement Space so existing scopes are not mistaken for an empty workspace." />
      ) : <>
      {spaces.data?.items.length ? (
        <div className="space-grid">
          {spaces.data.items.map((space) => {
            const coverUrl = spaceCoverUrl(space)
            const evidenceCounts = space.evidence_modality_counts ?? space.modality_counts
            return (
            <article className="space-card" key={space.id}>
              <div className={`space-card-cover${coverUrl ? ' has-image' : ''}`} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
                <span className="space-cover-wordmark">{space.name.slice(0, 1).toUpperCase()}</span>
                <span className="space-card-actions"><StatusMark status={space.archived ? 'archived' : 'ready'} /><button type="button" className="icon-button danger-quiet" aria-label={`Archive ${space.name}`} aria-describedby={`${spaceArchiveFeedbackId}${archiveModel.disabledDetail ? ` ${spaceArchiveGateId}` : ''}`} title="Archive Space" aria-disabled={archiveModel.ariaDisabled || undefined} onClick={() => { if (archiveModel.canArchive) setArchiveTarget(space) }}><Trash2 size={15} /></button>{archiveModel.disabledDetail && <span className="sr-only" id={spaceArchiveGateId}>{archiveModel.disabledDetail}</span>}</span>
                <span className="space-card-cover-copy"><small>{space.cover_source_name ? `Cover · ${space.cover_source_name}` : 'Knowledge Space'}</small><strong>{space.name}</strong><p>{space.description || 'No purpose statement yet.'}</p></span>
              </div>
              <div className="space-card-body">
                <div className="space-modality-row"><span><FileText />{evidenceCounts?.text ?? 0}</span><span><ImageIcon />{evidenceCounts?.image ?? 0}</span><span><Headphones />{evidenceCounts?.audio ?? 0}</span><span><Film />{evidenceCounts?.video ?? 0}</span></div>
                <dl><div><dt><Layers3 />Sources</dt><dd>{space.source_count}</dd></div><div><dt>Strategy</dt><dd>{space.policy.label}</dd></div><div><dt><Clock3 />Updated</dt><dd>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(space.updated_at))}</dd></div></dl>
              </div>
              <Link to={`/spaces/${space.id}`} className="card-link">Open Space <ArrowRight size={15} /></Link>
            </article>
          )})}
        </div>
      ) : <EmptyState title="Create a bounded knowledge scope" body="Start with one goal-oriented Space, then add the Sources you want research to see." action={<button type="button" className="button" onClick={() => setCreating(true)}><FolderKanban size={16} />Create Space</button>} />}
      </>}
      <SubmitReadinessCard className="space-archive-feedback" id={spaceArchiveFeedbackId} model={archiveModel} />
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget ? `Archive ${archiveTarget.name}?` : 'Archive Space?'}
        body="Sources remain stored globally, but this Space will be removed from routing and navigation. Existing Run snapshots remain readable."
        confirmLabel="Archive Space"
        busy={archive.isPending}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => { if (archiveTarget) archive.mutate(archiveTarget); setArchiveTarget(null) }}
      />
    </div>
  )
}
