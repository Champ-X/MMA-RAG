import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { nexusApi, type Model, type Provider } from '@/api/nexus'
import { modelBrand, providerBrand } from './modelBranding'

type CatalogModelPickerProps = {
  models: Model[]
  providers: Provider[]
  capability: string
  value: string
  onChange: (modelId: string) => void
  allowFallback?: boolean
  disabled?: boolean
  label?: string
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function CatalogModelPicker({
  models,
  providers,
  capability,
  value,
  onChange,
  allowFallback = true,
  disabled = false,
  label = 'Choose model',
}: CatalogModelPickerProps) {
  const queryClient = useQueryClient()
  const root = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [preparing, setPreparing] = useState('')
  const [error, setError] = useState('')
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])
  const candidates = useMemo(() => models
    .filter((model) => model.declared_capabilities.includes(capability) || model.verified_capabilities.includes(capability))
    .sort((left, right) => {
      const score = (model: Model) => model.lifecycle === 'enabled' ? 0 : model.lifecycle === 'verified' ? 1 : 2
      return score(left) - score(right) || left.upstream_model_id.localeCompare(right.upstream_model_id)
    }), [capability, models])
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = normalized ? candidates.filter((model) => {
      const provider = providerById.get(model.provider_connection_id)
      return `${model.upstream_model_id} ${provider?.name ?? ''} ${model.protocol_family}`.toLowerCase().includes(normalized)
    }) : candidates
    return matches.slice(0, normalized ? 120 : 36)
  }, [candidates, providerById, query])
  const selected = models.find((model) => model.id === value)
  const selectedProvider = selected ? providerById.get(selected.provider_connection_id) : undefined

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    window.setTimeout(() => searchInput.current?.focus(), 0)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  const choose = async (model: Model) => {
    setPreparing(model.id)
    setError('')
    try {
      let prepared = model
      if (prepared.lifecycle !== 'enabled' || !prepared.verified_capabilities.includes(capability)) {
        prepared = await nexusApi.probeModel(prepared.id)
      }
      if (!prepared.verified_capabilities.includes(capability)) {
        throw new Error(`The live probe did not verify ${capability.replaceAll('_', ' ')} for this deployment.`)
      }
      if (prepared.lifecycle !== 'enabled') prepared = await nexusApi.enableModel(prepared.id)
      onChange(prepared.id)
      await queryClient.invalidateQueries({ queryKey: ['models'] })
      setOpen(false)
      setQuery('')
    } catch (caught) {
      setError(errorMessage(caught))
      await queryClient.invalidateQueries({ queryKey: ['models'] })
    } finally {
      setPreparing('')
    }
  }

  const selectedBrand = selected
    ? modelBrand(selected.upstream_model_id, providerBrand(selectedProvider?.name ?? '', selectedProvider?.endpoint))
    : null
  return <div className={`catalog-model-picker${open ? ' open' : ''}`} ref={root}>
    <button type="button" className="model-picker-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { setOpen((current) => !current); setError('') }}>
      {selected && selectedBrand ? <><img src={selectedBrand.logo} alt="" /><span><strong>{selected.upstream_model_id}</strong><small>{selectedProvider?.name ?? selected.protocol_family} · verified {capability.replaceAll('_', ' ')}</small></span></> : <span><strong>{allowFallback ? 'Task route / configured fallback' : label}</strong><small>{candidates.length} catalog deployment{candidates.length === 1 ? '' : 's'} declare {capability.replaceAll('_', ' ')}</small></span>}
      <ChevronDown />
    </button>
    {open && <div className="model-picker-popover">
      <header><div><p className="eyebrow">Complete model catalog</p><strong>{candidates.length} compatible deployments</strong></div><button type="button" className="icon-button" aria-label="Close model catalog" onClick={() => setOpen(false)}><X /></button></header>
      <label className="model-picker-search"><Search /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, provider or protocol…" /></label>
      <p className="model-picker-guidance"><ShieldCheck />Enabled models are immediate. Choosing another catalog model runs a live capability probe, then enables it only if verified.</p>
      <div className="model-picker-list" role="listbox" aria-label={label}>
        {allowFallback && <button type="button" role="option" aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => { onChange(''); setOpen(false) }}><span className="model-fallback-mark"><Sparkles /></span><span><strong>Task route / configured fallback</strong><small>Let the active task-specific policy resolve the deployment.</small></span>{!value && <Check />}</button>}
        {visible.map((model) => {
          const provider = providerById.get(model.provider_connection_id)
          const brand = modelBrand(model.upstream_model_id, providerBrand(provider?.name ?? '', provider?.endpoint))
          const ready = model.lifecycle === 'enabled' && model.verified_capabilities.includes(capability)
          return <button type="button" role="option" aria-selected={value === model.id} key={model.id} className={value === model.id ? 'selected' : ''} disabled={Boolean(preparing)} onClick={() => choose(model)}>
            <span className="model-picker-logo" style={{ '--brand': brand.color } as React.CSSProperties}><img src={brand.logo} alt="" /></span>
            <span><strong>{model.upstream_model_id}</strong><small>{provider?.name ?? model.protocol_family} · {ready ? 'ready now' : model.lifecycle === 'verified' ? 'verified · enable on select' : 'probe on select'}</small></span>
            {preparing === model.id ? <Loader2 className="spin" /> : value === model.id ? <Check /> : ready ? <ShieldCheck className="ready" /> : null}
          </button>
        })}
        {!visible.length && <div className="model-picker-empty">No deployment matches this search and capability.</div>}
      </div>
      {!query && candidates.length > visible.length && <footer>Showing the first {visible.length}. Search to reach all {candidates.length} compatible deployments.</footer>}
      {error && <p className="model-picker-error">{error}</p>}
    </div>}
  </div>
}
