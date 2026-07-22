import { describe, expect, it } from 'vitest'
import {
  buildLedgerSelectOptionGateViewModel,
  findLedgerSelectMatchIndex,
  ledgerOptionIndexes,
  moveLedgerSelectActiveIndex,
  resolveLedgerSelectActiveIndex,
} from './LedgerSelectViewModel'

const options = [
  { label: 'All evidence', value: 'all' },
  { disabled: true, label: 'Archived only', value: 'archived' },
  { description: 'Ready to inspect', label: 'Published', value: 'published' },
  { label: 'Needs review', value: 'review' },
]

describe('LedgerSelectViewModel', () => {
  it('resolves the selected option or falls back to the first visible option', () => {
    expect(resolveLedgerSelectActiveIndex(options, 'published')).toBe(2)
    expect(resolveLedgerSelectActiveIndex(options, 'archived')).toBe(1)
    expect(resolveLedgerSelectActiveIndex(options, 'missing')).toBe(0)
    expect(resolveLedgerSelectActiveIndex([{ disabled: true, label: 'None', value: 'none' }], 'none')).toBe(0)
  })

  it('moves through every visible option so disabled rows remain explainable', () => {
    expect(ledgerOptionIndexes(options)).toEqual([0, 1, 2, 3])
    expect(moveLedgerSelectActiveIndex(options, 0, 'next')).toBe(1)
    expect(moveLedgerSelectActiveIndex(options, 2, 'previous')).toBe(1)
    expect(moveLedgerSelectActiveIndex(options, 3, 'next')).toBe(0)
    expect(moveLedgerSelectActiveIndex(options, 0, 'previous')).toBe(3)
    expect(moveLedgerSelectActiveIndex(options, 2, 'first')).toBe(0)
    expect(moveLedgerSelectActiveIndex(options, 2, 'last')).toBe(3)
  })

  it('supports typeahead against labels and descriptions including disabled context rows', () => {
    expect(findLedgerSelectMatchIndex(options, 0, 'pub')).toBe(2)
    expect(findLedgerSelectMatchIndex(options, 2, 'all')).toBe(0)
    expect(findLedgerSelectMatchIndex(options, 0, 'ready')).toBe(2)
    expect(findLedgerSelectMatchIndex(options, 0, 'archived')).toBe(1)
  })

  it('builds aria-disabled gates without removing disabled rows from navigation', () => {
    expect(buildLedgerSelectOptionGateViewModel({
      label: 'Published',
      value: 'published',
    }, true)).toEqual({
      ariaDisabled: false,
      ariaSelected: true,
      canChoose: true,
    })
    expect(buildLedgerSelectOptionGateViewModel({
      disabled: true,
      disabledReason: 'Archived filters are not available for this saved view.',
      label: 'Archived only',
      value: 'archived',
    }, true)).toEqual({
      ariaDisabled: true,
      ariaSelected: false,
      canChoose: false,
      disabledDetail: 'Archived filters are not available for this saved view.',
    })
    expect(buildLedgerSelectOptionGateViewModel({
      disabled: true,
      label: 'Archived only',
      value: 'archived',
    }).disabledDetail).toBe('Archived only is visible for context but unavailable in this selector.')
    expect(buildLedgerSelectOptionGateViewModel({
      disabled: true,
      label: 'Archived only',
      value: 'archived',
    }, true).ariaSelected).toBe(false)
  })
})
