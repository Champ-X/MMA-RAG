import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { nexusApi, type Model, type Provider } from '@/api/nexus'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import {
  buildCatalogModelPickerBusyViewModel,
  buildCatalogModelPickerOptionGateViewModel,
  catalogModelPickerOptionId,
  clampCatalogModelPickerIndex,
  moveCatalogModelPickerIndex,
  resolveCatalogModelPickerActiveIndex,
} from './CatalogModelPickerViewModel'
import { modelBrand, providerBrand } from './modelBranding'
import './CatalogModelPicker.css'

type CatalogModelPickerProps = {
  models: Model[]
  providers: Provider[]
  capability: string
  value: string
  onChange: (modelId: string) => void
  allowFallback?: boolean
  describedBy?: string
  label?: string
  locked?: boolean
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function CatalogModelPicker({
  models,
  providers,
  capability,
  value,
  onChange,
  allowFallback = true,
  describedBy,
  label = 'Choose model',
  locked = false,
}: CatalogModelPickerProps) {
  const queryClient = useQueryClient()
  const root = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const optionBaseId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [preparing, setPreparing] = useState('')
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
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
  const optionRows = useMemo(() => [
    ...(allowFallback ? [''] : []),
    ...visible.map((model) => model.id),
  ], [allowFallback, visible])
  const listboxId = `${optionBaseId}-listbox`
  const busyFeedbackId = `${optionBaseId}-busy`
  const activeOptionId = optionRows.length ? catalogModelPickerOptionId(optionBaseId, activeIndex) : undefined
  const preparingModel = preparing ? models.find((model) => model.id === preparing) : undefined
  const busyFeedback = buildCatalogModelPickerBusyViewModel({
    capability,
    preparingModelName: preparingModel?.upstream_model_id,
  })

  const openPicker = () => {
    setOpen(true)
    setError('')
  }
  const closePicker = ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }
  const chooseFallback = () => {
    onChange('')
    closePicker()
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) closePicker({ restoreFocus: false }) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePicker() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    window.setTimeout(() => searchInput.current?.focus(), 0)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => {
    if (!open) return
    setActiveIndex(resolveCatalogModelPickerActiveIndex(optionRows, value))
  }, [open, optionRows, value])
  useEffect(() => {
    setActiveIndex(0)
  }, [query])
  useEffect(() => {
    setActiveIndex((current) => clampCatalogModelPickerIndex(current, optionRows.length))
  }, [optionRows.length])
  useEffect(() => {
    if (!open || !activeOptionId) return
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId, open])

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
      closePicker()
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
  const commitActiveOption = () => {
    const activeId = optionRows[activeIndex]
    if (activeId === undefined || preparing) return
    if (activeId === '') {
      chooseFallback()
      return
    }
    const model = visible.find((item) => item.id === activeId)
    if (model) void choose(model)
  }
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (locked) return
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    if (!open) openPicker()
  }
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => moveCatalogModelPickerIndex(current, optionRows.length, 'next'))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => moveCatalogModelPickerIndex(current, optionRows.length, 'previous'))
    } else if (event.key === 'Home' && !query) {
      event.preventDefault()
      setActiveIndex((current) => moveCatalogModelPickerIndex(current, optionRows.length, 'first'))
    } else if (event.key === 'End' && !query) {
      event.preventDefault()
      setActiveIndex((current) => moveCatalogModelPickerIndex(current, optionRows.length, 'last'))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commitActiveOption()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()
    }
  }
  const fallbackGate = buildCatalogModelPickerOptionGateViewModel({
    optionModelName: 'Task route / configured fallback',
    preparingModelName: preparingModel?.upstream_model_id,
    selected: !value,
  })
  return <div className={`catalog-model-picker${open ? ' open' : ''}`} ref={root}>
    <button type="button" className="model-picker-trigger" ref={trigger} aria-controls={listboxId} aria-describedby={describedBy} aria-haspopup="listbox" aria-expanded={open} aria-disabled={locked || undefined} onClick={() => { if (!locked) { open ? closePicker({ restoreFocus: false }) : openPicker() } }} onKeyDown={onTriggerKeyDown}>
      {selected && selectedBrand ? <><img src={selectedBrand.logo} alt="" /><span><strong>{selected.upstream_model_id}</strong><small>{selectedProvider?.name ?? selected.protocol_family} · verified {capability.replaceAll('_', ' ')}</small></span></> : <span><strong>{allowFallback ? 'Task route / configured fallback' : label}</strong><small>{candidates.length} catalog deployment{candidates.length === 1 ? '' : 's'} declare {capability.replaceAll('_', ' ')}</small></span>}
      <ChevronDown />
    </button>
    {open && <div className="model-picker-popover">
      <header><div><p className="eyebrow">Complete model catalog</p><strong>{candidates.length} compatible deployments</strong></div><button type="button" className="icon-button" aria-label="Close model catalog" onClick={() => closePicker()}><X /></button></header>
      <label className="model-picker-search"><Search /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="Search model, provider or protocol…" role="combobox" aria-activedescendant={activeOptionId} aria-autocomplete="list" aria-controls={listboxId} aria-expanded={open} aria-haspopup="listbox" aria-label={label} /></label>
      <p className="model-picker-guidance"><ShieldCheck />Enabled models are immediate. Choosing another catalog model runs a live capability probe, then enables it only if verified.</p>
      <div className="model-picker-list" id={listboxId} role="listbox" aria-label={label}>
        {allowFallback && <button type="button" role="option" id={catalogModelPickerOptionId(optionBaseId, 0)} aria-disabled={fallbackGate.ariaDisabled || undefined} aria-describedby={fallbackGate.ariaDisabled ? busyFeedbackId : undefined} aria-selected={fallbackGate.ariaSelected} className={`${fallbackGate.ariaSelected ? 'selected' : ''} ${activeIndex === 0 ? 'active' : ''}`.trim()} tabIndex={-1} onPointerMove={() => setActiveIndex(0)} onClick={() => { if (fallbackGate.canChoose) chooseFallback() }}><span className="model-fallback-mark"><Sparkles /></span><span><strong>Task route / configured fallback</strong><small>Let the active task-specific policy resolve the deployment.</small></span>{fallbackGate.ariaSelected && <Check />}</button>}
        {visible.map((model, index) => {
          const optionIndex = index + (allowFallback ? 1 : 0)
          const provider = providerById.get(model.provider_connection_id)
          const brand = modelBrand(model.upstream_model_id, providerBrand(provider?.name ?? '', provider?.endpoint))
          const ready = model.lifecycle === 'enabled' && model.verified_capabilities.includes(capability)
          const gate = buildCatalogModelPickerOptionGateViewModel({
            optionModelName: model.upstream_model_id,
            preparingModelName: preparingModel?.upstream_model_id,
            selected: value === model.id,
          })
          return <button type="button" role="option" id={catalogModelPickerOptionId(optionBaseId, optionIndex)} aria-disabled={gate.ariaDisabled || undefined} aria-describedby={gate.ariaDisabled ? busyFeedbackId : undefined} aria-selected={gate.ariaSelected} key={model.id} className={`${gate.ariaSelected ? 'selected' : ''} ${activeIndex === optionIndex ? 'active' : ''}`.trim()} tabIndex={-1} title={gate.title} onPointerMove={() => setActiveIndex(optionIndex)} onClick={() => { if (gate.canChoose) void choose(model) }}>
            <span className="model-picker-logo" style={{ '--brand': brand.color } as React.CSSProperties}><img src={brand.logo} alt="" /></span>
            <span><strong>{model.upstream_model_id}</strong><small>{provider?.name ?? model.protocol_family} · {ready ? 'ready now' : model.lifecycle === 'verified' ? 'verified · enable on select' : 'probe on select'}</small></span>
            {preparing === model.id ? <Loader2 className="spin" /> : gate.ariaSelected ? <Check /> : ready ? <ShieldCheck className="ready" /> : null}
          </button>
        })}
        {!visible.length && <div className="model-picker-empty">No deployment matches this search and capability.</div>}
      </div>
      <SubmitReadinessCard className="model-picker-busy-feedback" id={busyFeedbackId} model={busyFeedback} />
      {!query && candidates.length > visible.length && <footer>Showing the first {visible.length}. Search to reach all {candidates.length} compatible deployments.</footer>}
      {error && <p className="model-picker-error">{error}</p>}
    </div>}
  </div>
}
