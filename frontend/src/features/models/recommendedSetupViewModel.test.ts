import { describe, expect, it } from 'vitest'
import { buildRecommendedSetupViewModel } from './recommendedSetupViewModel'

const baseInput = {
  busy: false,
  configurable_role_count: 0,
  discovered_model_count: 8,
  enabled_model_count: 8,
  provider_count: 2,
  ready_role_count: 14,
  status: 'ready' as const,
  total_role_count: 14,
}

describe('buildRecommendedSetupViewModel', () => {
  it('summarizes completed setup', () => {
    expect(buildRecommendedSetupViewModel(baseInput)).toMatchObject({
      feedbackDetail: 'All 14 governed task roles have explicit verified routes.',
      feedbackLabel: 'Recommended setup complete',
      feedbackTone: 'ready',
      setupComplete: true,
    })
  })

  it('treats extra unverified deployments as optional when routes are complete', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      discovered_model_count: 8,
      enabled_model_count: 3,
      status: 'ready',
    })).toMatchObject({
      feedbackDetail: '14/14 governed task roles are explicit. You can optionally verify 5 additional discovered deployments for future routing choices.',
      feedbackLabel: 'Recommended routes are complete',
      feedbackTone: 'ready',
      setupComplete: true,
      verifyAction: {
        visible: true,
      },
    })
  })

  it('blocks setup until a provider is connected', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      provider_count: 0,
      status: 'credentials_required',
    })).toMatchObject({
      connectAction: {
        ariaDisabled: false,
        canSubmit: true,
        label: 'Connect Provider',
        visible: true,
      },
      feedbackDetail: 'Connect a credential-backed Provider before Nexus can verify models or assign task routes.',
      feedbackLabel: 'Provider required',
      feedbackTone: 'blocked',
    })
  })

  it('shows capability verification as the next action', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      discovered_model_count: 8,
      enabled_model_count: 3,
      status: 'verification_required',
    })).toMatchObject({
      feedbackDetail: '5 discovered deployments still need capability probes.',
      feedbackLabel: 'Capability verification required',
      verifyAction: {
        ariaDisabled: false,
        canSubmit: true,
        label: 'Verify configured defaults',
        visible: true,
      },
    })
  })

  it('shows route completion as the next action', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      configurable_role_count: 4,
      ready_role_count: 10,
      status: 'action_available',
    })).toMatchObject({
      applyAction: {
        ariaDisabled: false,
        canSubmit: true,
        label: 'Complete 4 missing routes',
        visible: true,
      },
      feedbackDetail: '4 missing task routes can be completed without replacing active custom routes.',
      feedbackLabel: 'Task routes can be completed',
    })
  })

  it('surfaces pending operation copy and disables actions', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      busy: true,
      configurable_role_count: 1,
    })).toMatchObject({
      applyAction: {
        ariaDisabled: true,
        canSubmit: false,
        disabledDetail: 'Route completion is locked while the current model gateway operation preserves existing active routes.',
        label: 'Completing routes...',
        visible: true,
      },
      feedbackLabel: 'Model setup is working',
      feedbackTone: 'pending',
    })
  })

  it('keeps retry action visible after a failed setup operation', () => {
    expect(buildRecommendedSetupViewModel({
      ...baseInput,
      configurable_role_count: 1,
      errorMessage: 'Capability probe timed out.',
      status: 'action_available',
    })).toMatchObject({
      applyAction: {
        ariaDisabled: false,
        canSubmit: true,
        visible: true,
      },
      feedbackDetail: 'Capability probe timed out.',
      feedbackLabel: 'Recommended setup could not finish',
      feedbackTone: 'error',
    })
  })
})
