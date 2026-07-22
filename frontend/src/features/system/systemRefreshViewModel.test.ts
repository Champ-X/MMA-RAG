import { describe, expect, it } from 'vitest'
import { buildSystemRefreshViewModel } from './systemRefreshViewModel'

describe('buildSystemRefreshViewModel', () => {
  it('explains the status refresh scope before a manual refresh', () => {
    expect(buildSystemRefreshViewModel({
      healthStatus: 'ready',
      pending: false,
      tab: 'status',
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'Refresh control readiness and index projection without leaving this operating view. Control status is ready.',
      feedbackLabel: 'Refresh ready',
      feedbackTone: 'ready',
      scopeLabel: 'control readiness and index projection',
      submitLabel: 'Refresh',
    })
  })

  it('blocks duplicate clicks while backup manifests are refreshing', () => {
    expect(buildSystemRefreshViewModel({
      pending: true,
      tab: 'backups',
    })).toMatchObject({
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: 'Refresh is locked while control readiness and backup manifests diagnostics are updating. Existing values remain available on screen.',
      feedbackDetail: 'Refreshing control readiness and backup manifests; existing diagnostics remain visible until the request settles.',
      feedbackLabel: 'Refreshing diagnostics',
      feedbackTone: 'pending',
      submitLabel: 'Refreshing...',
    })
  })

  it('keeps retry available after a queue refresh fails', () => {
    expect(buildSystemRefreshViewModel({
      errorMessage: 'Workers unavailable.',
      pending: false,
      tab: 'jobs',
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'Workers unavailable. Existing control readiness and durable queue records values remain on screen.',
      feedbackLabel: 'Refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try refresh again',
    })
  })

  it('summarizes the last successful settings refresh', () => {
    expect(buildSystemRefreshViewModel({
      healthStatus: 'degraded',
      lastRefreshLabel: '11:42:09',
      pending: false,
      tab: 'settings',
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: '11:42:09; refreshed control readiness and safe runtime policy. Control status is degraded.',
      feedbackLabel: 'Diagnostics refreshed',
      feedbackTone: 'ready',
      submitLabel: 'Refresh again',
    })
  })

  it('uses a safe fallback for unknown diagnostic tabs', () => {
    expect(buildSystemRefreshViewModel({
      pending: false,
      tab: 'unknown',
    })).toMatchObject({
      feedbackDetail: 'Refresh control readiness and this diagnostic view without leaving this operating view. Control status is not loaded yet.',
      scopeLabel: 'control readiness and this diagnostic view',
    })
  })
})
