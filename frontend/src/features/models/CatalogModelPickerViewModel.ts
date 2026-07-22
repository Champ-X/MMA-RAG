export function catalogModelPickerOptionId(baseId: string, index: number) {
  return `${baseId}-option-${index}`
}

export function clampCatalogModelPickerIndex(index: number, itemCount: number) {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(index, 0), itemCount - 1)
}

export function moveCatalogModelPickerIndex(
  currentIndex: number,
  itemCount: number,
  direction: 'first' | 'last' | 'next' | 'previous',
) {
  if (itemCount <= 0) return 0
  if (direction === 'first') return 0
  if (direction === 'last') return itemCount - 1
  return clampCatalogModelPickerIndex(
    currentIndex + (direction === 'next' ? 1 : -1),
    itemCount,
  )
}

export function resolveCatalogModelPickerActiveIndex(optionIds: string[], selectedId: string) {
  const selectedIndex = selectedId ? optionIds.indexOf(selectedId) : 0
  return selectedIndex >= 0 ? selectedIndex : 0
}

export type CatalogModelPickerBusyViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  liveMode: 'polite'
  role: 'status'
  visible: boolean
}

export type CatalogModelPickerOptionGateViewModel = {
  ariaDisabled: boolean
  ariaSelected: boolean
  canChoose: boolean
  title?: string
}

const capabilityLabel = (capability: string) => capability.replaceAll('_', ' ')

export function buildCatalogModelPickerBusyViewModel({
  capability,
  preparingModelName,
}: {
  capability: string
  preparingModelName?: string
}): CatalogModelPickerBusyViewModel {
  if (!preparingModelName) {
    return {
      feedbackDetail: 'Model choices remain available. Selecting an unenabled deployment may run a live probe before it becomes active.',
      feedbackLabel: 'Model picker ready',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  return {
    feedbackDetail: `Running a live ${capabilityLabel(capability)} probe for ${preparingModelName}. Other choices stay visible but are locked until this preparation finishes.`,
    feedbackLabel: 'Preparing selected deployment',
    liveMode: 'polite',
    role: 'status',
    visible: true,
  }
}

export function buildCatalogModelPickerOptionGateViewModel({
  optionModelName,
  preparingModelName,
  selected = false,
}: {
  optionModelName: string
  preparingModelName?: string
  selected?: boolean
}): CatalogModelPickerOptionGateViewModel {
  if (!preparingModelName) {
    return {
      ariaDisabled: false,
      ariaSelected: selected,
      canChoose: true,
    }
  }

  const currentOption = optionModelName === preparingModelName
  return {
    ariaDisabled: true,
    ariaSelected: false,
    canChoose: false,
    title: currentOption
      ? `${optionModelName} is being prepared now.`
      : `Wait for ${preparingModelName} to finish preparing before choosing ${optionModelName}.`,
  }
}
