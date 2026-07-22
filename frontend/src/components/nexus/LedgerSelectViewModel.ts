export type LedgerSelectNavigationOption = {
  description?: string
  disabled?: boolean
  disabledReason?: string
  label: string
  value: string
}

export type LedgerSelectOptionGateViewModel = {
  ariaDisabled: boolean
  ariaSelected: boolean
  canChoose: boolean
  disabledDetail?: string
}

export function ledgerOptionIndexes(options: LedgerSelectNavigationOption[]) {
  return options.map((_option, index) => index)
}

export function resolveLedgerSelectActiveIndex(options: LedgerSelectNavigationOption[], value: string) {
  const selectedIndex = options.findIndex((option) => option.value === value)
  if (selectedIndex >= 0) return selectedIndex
  return ledgerOptionIndexes(options)[0] ?? -1
}

export function moveLedgerSelectActiveIndex(
  options: LedgerSelectNavigationOption[],
  currentIndex: number,
  direction: 'first' | 'last' | 'next' | 'previous',
) {
  const indexes = ledgerOptionIndexes(options)
  if (!indexes.length) return -1
  if (direction === 'first') return indexes[0]
  if (direction === 'last') return indexes[indexes.length - 1]

  const position = indexes.indexOf(currentIndex)
  if (position < 0) return direction === 'next' ? indexes[0] : indexes[indexes.length - 1]

  if (direction === 'next') return indexes[(position + 1) % indexes.length]
  return indexes[(position - 1 + indexes.length) % indexes.length]
}

export function findLedgerSelectMatchIndex(
  options: LedgerSelectNavigationOption[],
  currentIndex: number,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase()
  const indexes = ledgerOptionIndexes(options)
  if (!normalized || !indexes.length) return currentIndex

  const position = indexes.indexOf(currentIndex)
  const orderedIndexes = [
    ...indexes.slice(position >= 0 ? position + 1 : 0),
    ...indexes.slice(0, position >= 0 ? position + 1 : 0),
  ]
  const textFor = (index: number) => `${options[index].label} ${options[index].description ?? ''}`.toLocaleLowerCase()
  return orderedIndexes.find((index) => textFor(index).startsWith(normalized))
    ?? orderedIndexes.find((index) => textFor(index).includes(normalized))
    ?? currentIndex
}

export function buildLedgerSelectOptionGateViewModel(
  option: LedgerSelectNavigationOption,
  selected = false,
): LedgerSelectOptionGateViewModel {
  if (!option.disabled) {
    return {
      ariaDisabled: false,
      ariaSelected: selected,
      canChoose: true,
    }
  }

  return {
    ariaDisabled: true,
    ariaSelected: false,
    canChoose: false,
    disabledDetail: option.disabledReason
      ?? `${option.label} is visible for context but unavailable in this selector.`,
  }
}
