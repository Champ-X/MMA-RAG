export function clampCommandPaletteIndex(index: number, itemCount: number) {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(index, 0), itemCount - 1)
}

export function moveCommandPaletteIndex(
  currentIndex: number,
  itemCount: number,
  direction: 'first' | 'last' | 'next' | 'previous',
) {
  if (itemCount <= 0) return 0
  if (direction === 'first') return 0
  if (direction === 'last') return itemCount - 1
  return clampCommandPaletteIndex(
    currentIndex + (direction === 'next' ? 1 : -1),
    itemCount,
  )
}

export function commandPaletteOptionId(baseId: string, index: number) {
  return `${baseId}-option-${index}`
}

export type CommandPaletteSearchSource = {
  enabled: boolean
  error: unknown
  label: string
}

export type CommandPaletteSearchStatus = {
  detail: string
  label: string
  liveMode: 'polite'
  role: 'status'
  visible: boolean
}

export type CommandPaletteEmptyState = {
  detail: string
  label: string
  liveMode: 'polite'
  role: 'status'
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The request failed before Nexus received a usable response.'
}

export function buildCommandPaletteSearchStatus(
  sources: CommandPaletteSearchSource[],
): CommandPaletteSearchStatus {
  const failed = sources.filter((source) => source.enabled && source.error)
  if (!failed.length) {
    return {
      detail: '',
      label: '',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  const labels = failed.map((source) => source.label)
  return {
    detail: `${failed[0].label}: ${errorMessage(failed[0].error)} Static navigation remains available while you retry.`,
    label: `Some command search sources could not load: ${labels.join(', ')}.`,
    liveMode: 'polite',
    role: 'status',
    visible: true,
  }
}

export function buildCommandPaletteEmptyState(query: string): CommandPaletteEmptyState {
  const trimmed = query.trim()
  return {
    detail: trimmed
      ? 'Try a source name, quoted phrase, earlier question or action.'
      : 'Start typing to search Spaces, conversations, Evidence and actions.',
    label: trimmed
      ? `No matching place, conversation or Evidence for "${trimmed}".`
      : 'No command palette results yet.',
    liveMode: 'polite',
    role: 'status',
  }
}
