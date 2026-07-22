import { describe, expect, it } from 'vitest'
import {
  buildCatalogModelPickerBusyViewModel,
  buildCatalogModelPickerOptionGateViewModel,
  catalogModelPickerOptionId,
  clampCatalogModelPickerIndex,
  moveCatalogModelPickerIndex,
  resolveCatalogModelPickerActiveIndex,
} from './CatalogModelPickerViewModel'

describe('CatalogModelPickerViewModel', () => {
  it('clamps active option indexes to available rows', () => {
    expect(clampCatalogModelPickerIndex(-2, 4)).toBe(0)
    expect(clampCatalogModelPickerIndex(2, 4)).toBe(2)
    expect(clampCatalogModelPickerIndex(9, 4)).toBe(3)
    expect(clampCatalogModelPickerIndex(2, 0)).toBe(0)
  })

  it('moves through model options without escaping list bounds', () => {
    expect(moveCatalogModelPickerIndex(0, 3, 'previous')).toBe(0)
    expect(moveCatalogModelPickerIndex(0, 3, 'next')).toBe(1)
    expect(moveCatalogModelPickerIndex(2, 3, 'next')).toBe(2)
    expect(moveCatalogModelPickerIndex(2, 3, 'first')).toBe(0)
    expect(moveCatalogModelPickerIndex(0, 3, 'last')).toBe(2)
  })

  it('resolves selected model or fallback to the first row', () => {
    expect(resolveCatalogModelPickerActiveIndex(['fallback', 'model-a', 'model-b'], '')).toBe(0)
    expect(resolveCatalogModelPickerActiveIndex(['fallback', 'model-a', 'model-b'], 'model-b')).toBe(2)
    expect(resolveCatalogModelPickerActiveIndex(['fallback', 'model-a'], 'missing')).toBe(0)
  })

  it('builds stable option ids', () => {
    expect(catalogModelPickerOptionId('model-picker', 4)).toBe('model-picker-option-4')
  })

  it('keeps model options selectable while the picker is idle', () => {
    expect(buildCatalogModelPickerBusyViewModel({
      capability: 'text',
    })).toMatchObject({
      feedbackDetail: 'Model choices remain available. Selecting an unenabled deployment may run a live probe before it becomes active.',
      feedbackLabel: 'Model picker ready',
      role: 'status',
      visible: false,
    })
    expect(buildCatalogModelPickerOptionGateViewModel({
      optionModelName: 'gpt-4.1',
      selected: true,
    })).toEqual({
      ariaDisabled: false,
      ariaSelected: true,
      canChoose: true,
    })
  })

  it('explains the currently preparing model without removing options from the listbox', () => {
    expect(buildCatalogModelPickerBusyViewModel({
      capability: 'image_generation',
      preparingModelName: 'seedream',
    })).toMatchObject({
      feedbackDetail: 'Running a live image generation probe for seedream. Other choices stay visible but are locked until this preparation finishes.',
      feedbackLabel: 'Preparing selected deployment',
      role: 'status',
      visible: true,
    })
    expect(buildCatalogModelPickerOptionGateViewModel({
      optionModelName: 'seedream',
      preparingModelName: 'seedream',
      selected: true,
    })).toEqual({
      ariaDisabled: true,
      ariaSelected: false,
      canChoose: false,
      title: 'seedream is being prepared now.',
    })
  })

  it('keeps alternate options visible but aria-disabled while another model is preparing', () => {
    expect(buildCatalogModelPickerOptionGateViewModel({
      optionModelName: 'claude-sonnet',
      preparingModelName: 'gpt-4.1',
      selected: true,
    })).toEqual({
      ariaDisabled: true,
      ariaSelected: false,
      canChoose: false,
      title: 'Wait for gpt-4.1 to finish preparing before choosing claude-sonnet.',
    })
  })
})
