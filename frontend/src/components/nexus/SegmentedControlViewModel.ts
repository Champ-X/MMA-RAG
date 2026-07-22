import { moveRadioGroupValue } from '@/lib/radioGroupKeyboard'
import type { RadioGroupDirection } from '@/lib/radioGroupKeyboard'

export type SegmentedControlOption<T extends string> = {
  value: T
  label: string
  detail?: string
}

export type SegmentedControlKeyboardDirection = RadioGroupDirection

export function moveSegmentedControlValue<T extends string>(
  options: ReadonlyArray<SegmentedControlOption<T>>,
  value: T,
  direction: SegmentedControlKeyboardDirection,
): T {
  return moveRadioGroupValue(options.map((option) => option.value), value, direction)
}
