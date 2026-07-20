import { FormEvent, useState } from 'react'
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
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { spaceCoverUrl } from '@/components/nexus/spaceCoverUrl'
import {
  getSpacePolicyTemplate,
  spacePolicyTemplates,
  type SpaceProfile,
} from './spacePolicies'

const policyIcons = {
  searchable: Search,
  multimodal: ImageIcon,
  research: Microscope,
  archive: Archive,
}

export default function SpacesPage() {
  const client = useQueryClient()
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: nexusApi.listSpaces })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [profile, setProfile] = useState<SpaceProfile>('searchable')
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
  const archive = useMutation({
    mutationFn: nexusApi.deleteSpace,
    onSuccess: () => client.invalidateQueries({ queryKey: ['spaces'] }),
  })
  if (spaces.isLoading) return <LoadingState />
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) {
      create.mutate({
        name,
        description,
        knowledge_profile: profile,
        default_quality: selectedPolicy.defaultQuality,
      })
    }
  }
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Knowledge organization" title="Spaces" description="Each Space fixes a research scope and knowledge profile. Sources remain globally addressable and are never duplicated." actions={<button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />Create Space</button>} />
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
            <div><label htmlFor="space-name">Space name</label><input id="space-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Product launch research" /></div>
            <div><label htmlFor="space-description">Purpose</label><input id="space-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should this knowledge help you decide?" /></div>
          </div>
          <div className="policy-picker" role="radiogroup" aria-label="Space usage strategy">
            {spacePolicyTemplates.map((policy, index) => {
              const Icon = policyIcons[policy.profile]
              return <button type="button" role="radio" aria-checked={profile === policy.profile} className={`policy-option accent-${policy.accent}${profile === policy.profile ? ' selected' : ''}`} key={policy.profile} onClick={() => setProfile(policy.profile)}>
                <span className="policy-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon />
                <span className="policy-option-copy"><strong>{policy.label}</strong><small>{policy.summary}</small></span>
                <span className="policy-contract"><em>{policy.defaultQuality} retrieval</em><em>{policy.recommendedKind === 'research' ? 'deep research' : 'quick answer'}</em><em>{policy.routing}</em></span>
              </button>
            })}
          </div>
          <footer>
            <p><strong>{selectedPolicy.label}</strong> will become the visible routing and execution contract for this Space.</p>
            <div><button className="button" type="button" onClick={() => setCreating(false)}>Cancel</button><button className="button primary" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Creating…' : 'Create Space'}<ArrowRight size={15} /></button></div>
          </footer>
          {create.error && <p className="form-error">{create.error.message}</p>}
        </form>
      )}
      {spaces.data?.items.length ? (
        <div className="space-grid">
          {spaces.data.items.map((space) => {
            const coverUrl = spaceCoverUrl(space)
            const evidenceCounts = space.evidence_modality_counts ?? space.modality_counts
            return (
            <article className="space-card" key={space.id}>
              <div className={`space-card-cover${coverUrl ? ' has-image' : ''}`} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
                <span className="space-cover-wordmark">{space.name.slice(0, 1).toUpperCase()}</span>
                <span className="space-card-actions"><StatusMark status={space.archived ? 'archived' : 'ready'} /><button className="icon-button danger-quiet" aria-label={`Archive ${space.name}`} title="Archive Space" disabled={archive.isPending} onClick={() => { if (window.confirm(`Archive “${space.name}”? Its Sources remain stored globally, but this Space will be removed from routing and navigation.`)) archive.mutate(space.id) }}><Trash2 size={15} /></button></span>
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
      ) : <EmptyState title="Create a bounded knowledge scope" body="Start with one goal-oriented Space, then add the Sources you want research to see." action={<button className="button" onClick={() => setCreating(true)}><FolderKanban size={16} />Create Space</button>} />}
    </div>
  )
}
