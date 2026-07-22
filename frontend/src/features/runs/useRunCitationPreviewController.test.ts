import { describe, expect, it } from 'vitest'
import { findCitationPreviewTrigger } from './useRunCitationPreviewController'

function trigger(key: string, isConnected = false): HTMLElement {
  return {
    dataset: { citationTriggerKey: key },
    isConnected,
  } as unknown as HTMLElement
}

function documentRoot(elements: HTMLElement[]): Pick<Document, 'querySelectorAll'> {
  return {
    querySelectorAll: () => elements,
  } as unknown as Pick<Document, 'querySelectorAll'>
}

describe('run citation preview controller decisions', () => {
  it('keeps focus restoration on the live trigger when it is still connected', () => {
    const liveTrigger = trigger('citation-a', true)
    const fallback = trigger('citation-b', true)

    expect(findCitationPreviewTrigger({
      documentRoot: documentRoot([fallback]),
      preview: {
        trigger: liveTrigger,
        triggerKey: 'citation-b',
      },
    })).toBe(liveTrigger)
  })

  it('falls back to the matching trigger key when the original trigger disconnected', () => {
    const disconnected = trigger('citation-a', false)
    const fallback = trigger('citation-b', true)

    expect(findCitationPreviewTrigger({
      documentRoot: documentRoot([trigger('citation-a', true), fallback]),
      preview: {
        trigger: disconnected,
        triggerKey: 'citation-b',
      },
    })).toBe(fallback)
  })

  it('returns null when no matching trigger remains in the document', () => {
    expect(findCitationPreviewTrigger({
      documentRoot: documentRoot([trigger('citation-a', true)]),
      preview: {
        trigger: null,
        triggerKey: 'citation-missing',
      },
    })).toBeNull()
  })
})
