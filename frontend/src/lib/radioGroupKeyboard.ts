export type RadioGroupDirection = 'first' | 'last' | 'next' | 'previous'

export function resolveRadioGroupDirection(key: string): RadioGroupDirection | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 'next'
  if (key === 'ArrowLeft' || key === 'ArrowUp') return 'previous'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  return null
}

export function moveRadioGroupValue<T extends string>(
  options: ReadonlyArray<T>,
  value: T,
  direction: RadioGroupDirection,
): T {
  if (!options.length) return value
  if (direction === 'first') return options[0]
  if (direction === 'last') return options[options.length - 1]

  const currentIndex = options.indexOf(value)
  if (currentIndex < 0) return options[0]

  if (direction === 'next') return options[(currentIndex + 1) % options.length]
  return options[(currentIndex - 1 + options.length) % options.length]
}
