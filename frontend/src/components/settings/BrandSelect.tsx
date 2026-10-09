import { useId } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandIcon } from './BrandIcon'
import './brandSelect.css'

export { BrandIcon } from './BrandIcon'

export interface BrandSelectOption {
  value: string
  label: string
  description?: string
  provider?: string
  modelId?: string
  disabled?: boolean
}

interface BrandSelectProps {
  id?: string
  name?: string
  label?: string
  ariaLabel?: string
  value: string
  options: BrandSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

/** Small branded choice lists; large model catalogs keep their searchable model picker. */
export function BrandSelect({ id, name, label, ariaLabel, value, options, onChange, disabled, className }: BrandSelectProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const selected = options.find(option => option.value === value)
  const accessibleLabel = ariaLabel ?? label ?? '选择配置'

  return (
    <div className={cn('brand-select', className)}>
      {label && <label className="brand-select-label" htmlFor={controlId}>{label}</label>}
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            id={controlId}
            className="brand-select-trigger"
            aria-label={`${accessibleLabel}，当前：${selected?.label ?? (value || '未选择')}`}
            disabled={disabled || options.length === 0}
            title={selected?.label ?? value}
          >
            {selected && <BrandIcon provider={selected.provider} modelId={selected.modelId} size={22} />}
            <span className="brand-select-value">{selected?.label ?? (value || '暂无可用选项')}</span>
            <ChevronDown className="brand-select-chevron" size={14} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="brand-select-menu" sideOffset={7} collisionPadding={12} align="start" loop aria-label={accessibleLabel}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map(option => (
                <DropdownMenu.RadioItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="brand-select-option"
                  textValue={option.label}
                >
                  <span className="brand-select-option-icon"><BrandIcon provider={option.provider} modelId={option.modelId} size={23} /></span>
                  <span className="brand-select-option-copy">
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  <span className="brand-select-indicator"><DropdownMenu.ItemIndicator><Check size={16} aria-hidden="true" /></DropdownMenu.ItemIndicator></span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
