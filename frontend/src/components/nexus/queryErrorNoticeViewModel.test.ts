import { describe, expect, it } from 'vitest'
import { buildQueryErrorNoticeViewModel } from './queryErrorNoticeViewModel'

describe('buildQueryErrorNoticeViewModel', () => {
  it('hides when every query is healthy', () => {
    expect(buildQueryErrorNoticeViewModel([
      { error: null, hasData: true, label: 'Spaces' },
    ])).toMatchObject({
      visible: false,
    })
  })

  it('blocks the page when no queried data is available', () => {
    expect(buildQueryErrorNoticeViewModel([
      { error: new Error('Network offline'), hasData: false, label: 'Spaces' },
      { error: new Error('Timeout'), hasData: false, label: 'Runs' },
    ])).toMatchObject({
      actionLabel: 'Retry control plane',
      detail: 'Spaces: Network offline',
      label: 'Nexus could not load Spaces, Runs.',
      role: 'alert',
      tone: 'blocking',
      visible: true,
    })
  })

  it('keeps cached data visible when a background refresh fails', () => {
    expect(buildQueryErrorNoticeViewModel([
      { error: new Error('Gateway timeout'), hasData: true, label: 'Runs' },
      { error: null, hasData: true, label: 'Spaces' },
    ])).toMatchObject({
      actionLabel: 'Retry refresh',
      detail: 'Runs: Gateway timeout',
      label: 'The latest workspace refresh failed, but cached data is still visible.',
      role: 'status',
      tone: 'inline',
      visible: true,
    })
  })

  it('blocks when a required query fails even if other cached data exists', () => {
    expect(buildQueryErrorNoticeViewModel([
      { error: null, hasData: true, label: 'Spaces', required: true },
      { error: new Error('Model catalog unavailable'), hasData: false, label: 'Models', required: true },
    ])).toMatchObject({
      actionLabel: 'Retry control plane',
      detail: 'Models: Model catalog unavailable',
      label: 'Nexus could not load Models.',
      role: 'alert',
      tone: 'blocking',
      visible: true,
    })
  })

  it('keeps required cached data visible when its refresh fails', () => {
    expect(buildQueryErrorNoticeViewModel([
      { error: new Error('Claim ledger timeout'), hasData: true, label: 'Claim ledger', required: true },
      { error: null, hasData: true, label: 'Space', required: true },
    ])).toMatchObject({
      actionLabel: 'Retry refresh',
      detail: 'Claim ledger: Claim ledger timeout',
      label: 'The latest workspace refresh failed, but cached data is still visible.',
      role: 'status',
      tone: 'inline',
      visible: true,
    })
  })
})
