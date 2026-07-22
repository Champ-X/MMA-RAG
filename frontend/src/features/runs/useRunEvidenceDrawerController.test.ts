import { describe, expect, it } from 'vitest'
import {
  shouldDismissEvidenceDrawer,
  shouldOpenEvidenceFromLocationState,
} from './useRunEvidenceDrawerController'

describe('run evidence drawer controller decisions', () => {
  it('opens the drawer only for an explicit route state request', () => {
    expect(shouldOpenEvidenceFromLocationState({ openEvidence: true })).toBe(true)
    expect(shouldOpenEvidenceFromLocationState({ openEvidence: false })).toBe(false)
    expect(shouldOpenEvidenceFromLocationState({})).toBe(false)
    expect(shouldOpenEvidenceFromLocationState(null)).toBe(false)
  })

  it('dismisses the drawer only for Escape', () => {
    expect(shouldDismissEvidenceDrawer({ key: 'Escape' })).toBe(true)
    expect(shouldDismissEvidenceDrawer({ key: 'Enter' })).toBe(false)
    expect(shouldDismissEvidenceDrawer({ key: 'Esc' })).toBe(false)
  })
})
