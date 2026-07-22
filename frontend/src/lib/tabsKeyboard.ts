export type TabsDirection = 'first' | 'last' | 'next' | 'previous'

export function resolveHorizontalTabsDirection(key: string): TabsDirection | null {
  if (key === 'ArrowRight') return 'next'
  if (key === 'ArrowLeft') return 'previous'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  return null
}

export function moveTabsValue<T>(
  options: ReadonlyArray<T>,
  value: T,
  direction: TabsDirection,
): T {
  if (!options.length) return value
  if (direction === 'first') return options[0]
  if (direction === 'last') return options[options.length - 1]

  const currentIndex = options.indexOf(value)
  if (currentIndex < 0) return options[0]

  if (direction === 'next') return options[(currentIndex + 1) % options.length]
  return options[(currentIndex - 1 + options.length) % options.length]
}
