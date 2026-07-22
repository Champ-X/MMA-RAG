import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import type { SegmentedControlOption } from './SegmentedControlViewModel'
import { moveSegmentedControlValue } from './SegmentedControlViewModel'
import './SegmentedControl.css'

export type { SegmentedControlOption } from './SegmentedControlViewModel'

export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: {
  ariaLabel: string
  options: ReadonlyArray<SegmentedControlOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const optionRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})

  const moveSelection = (direction: 'first' | 'last' | 'next' | 'previous') => {
    const nextValue = moveSegmentedControlValue(options, value, direction)
    onChange(nextValue)
    window.requestAnimationFrame(() => optionRefs.current[nextValue]?.focus({ preventScroll: true }))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    moveSelection(direction)
  }

  return (
    <div className={['segmented', className].filter(Boolean).join(' ')} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          className={value === option.value ? 'active' : undefined}
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          ref={(node) => { optionRefs.current[option.value] = node }}
          title={option.detail}
          onKeyDown={handleKeyDown}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
