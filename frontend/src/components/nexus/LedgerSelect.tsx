import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  buildLedgerSelectOptionGateViewModel,
  findLedgerSelectMatchIndex,
  moveLedgerSelectActiveIndex,
  resolveLedgerSelectActiveIndex,
} from './LedgerSelectViewModel'
import './LedgerSelect.css'

export type LedgerSelectOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
  disabledReason?: string
}

type LedgerSelectProps = {
  ariaLabel?: string
  className?: string
  options: LedgerSelectOption[]
  value: string
  onChange: (value: string) => void
}

export function LedgerSelect({ ariaLabel, className = '', options, value, onChange }: LedgerSelectProps) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listbox = useRef<HTMLDivElement>(null)
  const typeaheadTimer = useRef<number | null>(null)
  const typeaheadQuery = useRef('')
  const selectId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => resolveLedgerSelectActiveIndex(options, value))
  const selected = useMemo(() => options.find((option) => option.value === value) ?? options[0], [options, value])
  const listboxId = `${selectId}-listbox`
  const optionId = (index: number) => `${selectId}-option-${index}`
  const optionGateId = (index: number) => `${selectId}-option-${index}-gate`
  const activeOptionId = open && activeIndex >= 0 ? optionId(activeIndex) : undefined

  const closeMenu = ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }

  const openMenu = (nextIndex = resolveLedgerSelectActiveIndex(options, value)) => {
    setActiveIndex(nextIndex)
    setOpen(true)
  }

  const commitOption = (index: number) => {
    const option = options[index]
    if (!option || !buildLedgerSelectOptionGateViewModel(option).canChoose) return
    onChange(option.value)
    closeMenu()
  }

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  useEffect(() => {
    setActiveIndex(resolveLedgerSelectActiveIndex(options, value))
  }, [options, value])
  useEffect(() => {
    if (!open) return
    window.requestAnimationFrame(() => listbox.current?.focus({ preventScroll: true }))
  }, [open])
  useEffect(() => {
    if (!open || !activeOptionId) return
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId, open])
  useEffect(() => () => {
    if (typeaheadTimer.current) window.clearTimeout(typeaheadTimer.current)
  }, [])

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu(moveLedgerSelectActiveIndex(options, resolveLedgerSelectActiveIndex(options, value), 'next'))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(moveLedgerSelectActiveIndex(options, resolveLedgerSelectActiveIndex(options, value), 'previous'))
    } else if (event.key === 'Home') {
      event.preventDefault()
      openMenu(moveLedgerSelectActiveIndex(options, activeIndex, 'first'))
    } else if (event.key === 'End') {
      event.preventDefault()
      openMenu(moveLedgerSelectActiveIndex(options, activeIndex, 'last'))
    }
  }

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => moveLedgerSelectActiveIndex(options, current, 'next'))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => moveLedgerSelectActiveIndex(options, current, 'previous'))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex((current) => moveLedgerSelectActiveIndex(options, current, 'first'))
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex((current) => moveLedgerSelectActiveIndex(options, current, 'last'))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commitOption(activeIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'Tab') {
      closeMenu({ restoreFocus: false })
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeaheadQuery.current += event.key
      setActiveIndex((current) => findLedgerSelectMatchIndex(options, current, typeaheadQuery.current))
      if (typeaheadTimer.current) window.clearTimeout(typeaheadTimer.current)
      typeaheadTimer.current = window.setTimeout(() => {
        typeaheadQuery.current = ''
      }, 650)
    }
  }

  return <div className={`ledger-select ${open ? 'open' : ''} ${className}`.trim()} ref={root}>
    <button
      type="button"
      className="ledger-select-trigger"
      ref={trigger}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={() => open ? closeMenu({ restoreFocus: false }) : openMenu()}
      onKeyDown={handleTriggerKeyDown}
    >
      <span><strong>{selected?.label ?? 'Choose option'}</strong>{selected?.description && <small>{selected.description}</small>}</span>
      <ChevronDown />
    </button>
    {open && <div
      className="ledger-select-menu"
      ref={listbox}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-activedescendant={activeOptionId}
      aria-label={ariaLabel}
      onKeyDown={handleListboxKeyDown}
    >
      {options.map((option, index) => {
        const gate = buildLedgerSelectOptionGateViewModel(option, option.value === value)
        return <button
          type="button"
          role="option"
          id={optionId(index)}
          aria-selected={gate.ariaSelected}
          aria-disabled={gate.ariaDisabled || undefined}
          aria-describedby={gate.ariaDisabled ? optionGateId(index) : undefined}
          className={`${gate.ariaSelected ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`.trim()}
          key={option.value}
          tabIndex={-1}
          onClick={() => commitOption(index)}
          onPointerMove={() => setActiveIndex(index)}
        >
          <span>
            <strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}
            {gate.disabledDetail && <small className="sr-only" id={optionGateId(index)}>{gate.disabledDetail}</small>}
          </span>
          {gate.ariaSelected && <Check />}
        </button>
      })}
    </div>}
  </div>
}
