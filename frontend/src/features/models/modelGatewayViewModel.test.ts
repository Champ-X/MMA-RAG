import { describe, expect, it } from 'vitest'
import {
  buildModelGatewayActionGateViewModel,
  buildModelGatewayActionViewModel,
  buildProviderCreateViewModel,
  buildRouteCreateViewModel,
} from './modelGatewayViewModel'

describe('buildModelGatewayActionViewModel', () => {
  it('stays hidden before a gateway action is chosen', () => {
    expect(buildModelGatewayActionViewModel({ pending: false })).toMatchObject({
      feedbackLabel: 'Model gateway ready',
      feedbackTone: 'ready',
      role: 'status',
      visible: false,
    })
  })

  it('explains catalog sync while it is pending', () => {
    expect(buildModelGatewayActionViewModel({
      pending: true,
      pendingAction: 'sync-catalog',
    })).toMatchObject({
      feedbackDetail: 'Refreshing Provider and model catalog records. Enablement and task routes remain explicit.',
      feedbackLabel: 'Syncing catalog',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    })
  })

  it('keeps provider discovery failure actionable', () => {
    expect(buildModelGatewayActionViewModel({
      errorAction: 'discover-provider',
      errorMessage: 'Endpoint returned 401.',
      errorTargetName: 'Acme Models',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Endpoint returned 401. Refresh Acme Models remote model inventory. Discovery records candidates but does not enable or route them.',
      feedbackLabel: 'Provider discovery failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('uses operation summary for configured verification success', () => {
    expect(buildModelGatewayActionViewModel({
      completedAction: 'verify-configured',
      completedDetail: '3 configured models ready; 2 task roles available.',
      pending: false,
    })).toMatchObject({
      feedbackDetail: '3 configured models ready; 2 task roles available.',
      feedbackLabel: 'Model verification complete',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('summarizes route activation without a custom receipt', () => {
    expect(buildModelGatewayActionViewModel({
      completedAction: 'activate-route',
      completedTargetName: 'Research synthesis',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Research synthesis is now the active task route. Older revisions stay auditable and can be superseded by another draft.',
      feedbackLabel: 'Route activated',
      visible: true,
    })
  })
})

describe('buildModelGatewayActionGateViewModel', () => {
  it('keeps gateway actions available when no operation is pending', () => {
    expect(buildModelGatewayActionGateViewModel({
      action: 'sync-catalog',
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
    })
  })

  it('locks alternate gateway actions with a target-aware explanation while busy', () => {
    expect(buildModelGatewayActionGateViewModel({
      action: 'discover-provider',
      pending: true,
      pendingAction: 'verify-configured',
      pendingTargetName: 'Configured defaults',
      targetName: 'Acme Models',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'This provider discovery ready for Acme Models is locked while verifying configured models for Configured defaults. Providers, capability evidence and active task routes remain preserved.',
    })
  })
})

describe('buildProviderCreateViewModel', () => {
  const baseInput = {
    endpoint: 'https://models.example/v1',
    errorMessage: undefined,
    name: 'Acme Models',
    pending: false,
    protocolLabel: 'OpenAI compatible',
  }

  it('blocks unnamed provider connections', () => {
    expect(buildProviderCreateViewModel({ ...baseInput, name: '  ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name the Provider connection before creating it.',
      feedbackLabel: 'Provider name required',
      feedbackTone: 'blocked',
      nameRequired: true,
    })
  })

  it('blocks missing endpoint', () => {
    expect(buildProviderCreateViewModel({ ...baseInput, endpoint: '' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter a Provider endpoint before creating this connection.',
      endpointRequired: true,
      feedbackDetail: 'Enter the HTTP endpoint that Nexus should use for catalog discovery and model calls.',
      feedbackLabel: 'Endpoint required',
    })
  })

  it('blocks malformed endpoint URLs', () => {
    expect(buildProviderCreateViewModel({ ...baseInput, endpoint: 'models.example/v1' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Use a full http:// or https:// Provider endpoint before creating this connection.',
      endpointInvalid: true,
      feedbackDetail: 'Use a full http:// or https:// endpoint URL for this provider connection.',
      feedbackLabel: 'Endpoint must be a URL',
    })
  })

  it('summarizes provider creation when ready', () => {
    expect(buildProviderCreateViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'OpenAI compatible will be registered. Secret values stay outside Nexus; only the reference name is stored.',
      feedbackLabel: 'Ready to create provider',
      feedbackTone: 'ready',
    })
  })

  it('keeps retry available after provider creation fails when fields remain valid', () => {
    expect(buildProviderCreateViewModel({
      ...baseInput,
      errorMessage: 'Provider endpoint is unavailable.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Provider endpoint is unavailable.',
      feedbackLabel: 'Provider was not created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})

describe('buildRouteCreateViewModel', () => {
  const baseInput = {
    compatibleCount: 3,
    deploymentId: 'model-1',
    errorMessage: undefined,
    pending: false,
    requiredCapability: 'text_generation',
    roleLabel: 'Research synthesis',
  }

  it('blocks route creation when no compatible deployment exists', () => {
    expect(buildRouteCreateViewModel({ ...baseInput, compatibleCount: 0, deploymentId: '' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add or sync a deployment that declares text generation before creating this route revision.',
      deploymentRequired: true,
      feedbackDetail: 'Sync the catalog or add a Provider deployment that declares text generation.',
      feedbackLabel: 'Compatible deployment required',
    })
  })

  it('blocks route creation until a deployment is selected', () => {
    expect(buildRouteCreateViewModel({ ...baseInput, deploymentId: '' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Choose a verified text generation deployment before creating the Research synthesis route revision.',
      deploymentRequired: true,
      feedbackDetail: 'Choose a deployment verified for text generation before creating the Research synthesis route revision.',
      feedbackLabel: 'Deployment required',
    })
  })

  it('summarizes the draft route when ready', () => {
    expect(buildRouteCreateViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Research synthesis will get a draft route revision using the selected text generation deployment.',
      feedbackLabel: 'Ready to create route',
      feedbackTone: 'ready',
    })
  })
})
