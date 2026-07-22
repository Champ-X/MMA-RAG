export type ModelGatewayFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type ModelGatewayAction =
  | 'activate-route'
  | 'apply-recommended'
  | 'create-provider'
  | 'create-route'
  | 'discover-provider'
  | 'enable-model'
  | 'probe-model'
  | 'sync-catalog'
  | 'verify-configured'

export type ModelGatewayActionViewModelInput = {
  completedAction?: ModelGatewayAction
  completedDetail?: string
  completedTargetName?: string
  errorAction?: ModelGatewayAction
  errorMessage?: string
  errorTargetName?: string
  pending: boolean
  pendingAction?: ModelGatewayAction
  pendingTargetName?: string
}

export type ModelGatewayActionViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: Exclude<ModelGatewayFeedbackTone, 'blocked'>
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export type ModelGatewayActionGateViewModelInput = {
  action: ModelGatewayAction
  pending: boolean
  pendingAction?: ModelGatewayAction
  pendingTargetName?: string
  targetName?: string
}

export type ModelGatewayActionGateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
}

export type ProviderCreateViewModelInput = {
  endpoint: string
  errorMessage?: string
  name: string
  pending: boolean
  protocolLabel: string
}

export type ProviderCreateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  endpointInvalid: boolean
  endpointRequired: boolean
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ModelGatewayFeedbackTone
  nameRequired: boolean
  submitLabel: string
}

export type RouteCreateViewModelInput = {
  compatibleCount: number
  deploymentId: string
  errorMessage?: string
  pending: boolean
  requiredCapability: string
  roleLabel: string
}

export type RouteCreateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  deploymentRequired: boolean
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ModelGatewayFeedbackTone
  submitLabel: string
}

const modelGatewayActionCopy: Record<ModelGatewayAction, {
  completedDetail: (targetName: string) => string
  errorLabel: string
  idleDetail: (targetName: string) => string
  idleLabel: string
  pendingDetail: (targetName: string) => string
  pendingLabel: string
  successLabel: string
}> = {
  'activate-route': {
    completedDetail: (targetName) => `${targetName} is now the active task route. Older revisions stay auditable and can be superseded by another draft.`,
    errorLabel: 'Route activation failed',
    idleDetail: (targetName) => `Activate the draft ${targetName} route only after its deployment policy is ready to receive live tasks.`,
    idleLabel: 'Route activation ready',
    pendingDetail: (targetName) => `Activating the draft ${targetName} route. Existing revision history remains retained while the active policy moves forward.`,
    pendingLabel: 'Activating route',
    successLabel: 'Route activated',
  },
  'apply-recommended': {
    completedDetail: () => 'Missing task routes were completed from deterministic recommendations. Active custom routes were preserved.',
    errorLabel: 'Recommended setup failed',
    idleDetail: () => 'Complete missing task routes from verified recommendations without replacing active custom routes.',
    idleLabel: 'Recommended setup ready',
    pendingDetail: () => 'Completing missing task routes from verified recommendations. Active custom routes stay preserved.',
    pendingLabel: 'Completing recommended routes',
    successLabel: 'Recommended routes completed',
  },
  'create-provider': {
    completedDetail: (targetName) => `${targetName} was added to Provider inventory. Discovery and capability verification remain explicit follow-up steps.`,
    errorLabel: 'Provider creation failed',
    idleDetail: (targetName) => `Create ${targetName} as a credential-backed Provider reference. Secret values remain outside Nexus.`,
    idleLabel: 'Provider creation ready',
    pendingDetail: (targetName) => `Creating ${targetName} as a Provider reference. Secret values remain outside Nexus.`,
    pendingLabel: 'Creating Provider',
    successLabel: 'Provider created',
  },
  'create-route': {
    completedDetail: (targetName) => `${targetName} received a draft route revision. It will not serve live tasks until activated.`,
    errorLabel: 'Route revision failed',
    idleDetail: (targetName) => `Create a draft route revision for ${targetName}. Live task routing changes only after activation.`,
    idleLabel: 'Route revision ready',
    pendingDetail: (targetName) => `Creating a draft route revision for ${targetName}. Live task routing remains unchanged until activation.`,
    pendingLabel: 'Creating route revision',
    successLabel: 'Route revision created',
  },
  'discover-provider': {
    completedDetail: (targetName) => `${targetName} inventory was refreshed. Discovery alone never enables a model or changes task routes.`,
    errorLabel: 'Provider discovery failed',
    idleDetail: (targetName) => `Refresh ${targetName} remote model inventory. Discovery records candidates but does not enable or route them.`,
    idleLabel: 'Provider discovery ready',
    pendingDetail: (targetName) => `Refreshing ${targetName} remote model inventory. New records remain candidates until verified.`,
    pendingLabel: 'Discovering Provider models',
    successLabel: 'Provider inventory refreshed',
  },
  'enable-model': {
    completedDetail: (targetName) => `${targetName} is eligible for task routes. No active route changed unless a policy points at it.`,
    errorLabel: 'Model enablement failed',
    idleDetail: (targetName) => `Enable ${targetName} for routing eligibility after verification. Task route assignment remains explicit.`,
    idleLabel: 'Model enablement ready',
    pendingDetail: (targetName) => `Enabling ${targetName} for routing eligibility. Active task routes are unchanged.`,
    pendingLabel: 'Enabling model',
    successLabel: 'Model enabled',
  },
  'probe-model': {
    completedDetail: (targetName) => `${targetName} capability probe finished. Verified capabilities can now be used for explicit task routing.`,
    errorLabel: 'Capability probe failed',
    idleDetail: (targetName) => `Run a live probe for ${targetName}. Only verified capabilities can be used by task routes.`,
    idleLabel: 'Capability probe ready',
    pendingDetail: (targetName) => `Running a live capability probe for ${targetName}. The model remains out of routes until verification completes.`,
    pendingLabel: 'Probing model capability',
    successLabel: 'Capability probe complete',
  },
  'sync-catalog': {
    completedDetail: () => 'The model catalog was refreshed. Discovery does not enable deployments or change task routes by itself.',
    errorLabel: 'Catalog sync failed',
    idleDetail: () => 'Refresh Provider and model catalog records while keeping enablement and task routing explicit.',
    idleLabel: 'Catalog sync ready',
    pendingDetail: () => 'Refreshing Provider and model catalog records. Enablement and task routes remain explicit.',
    pendingLabel: 'Syncing catalog',
    successLabel: 'Catalog synced',
  },
  'verify-configured': {
    completedDetail: () => 'Configured models were verified. Eligible deployments and recommended routes are refreshed without hiding failures.',
    errorLabel: 'Model verification failed',
    idleDetail: () => 'Verify configured model defaults, enable passing deployments, and refresh governed task-route readiness.',
    idleLabel: 'Model verification ready',
    pendingDetail: () => 'Verifying configured model defaults and refreshing task-route readiness. Failures will stay visible for repair.',
    pendingLabel: 'Verifying configured models',
    successLabel: 'Model verification complete',
  },
}

const fallbackActionCopy = modelGatewayActionCopy['sync-catalog']

function actionCopy(action?: ModelGatewayAction) {
  return action ? modelGatewayActionCopy[action] : fallbackActionCopy
}

function targetLabel(value: string | undefined) {
  return value?.trim() || 'this gateway action'
}

function isValidEndpoint(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function buildModelGatewayActionViewModel({
  completedAction,
  completedDetail,
  completedTargetName,
  errorAction,
  errorMessage,
  errorTargetName,
  pending,
  pendingAction,
  pendingTargetName,
}: ModelGatewayActionViewModelInput): ModelGatewayActionViewModel {
  if (pending && pendingAction) {
    const copy = actionCopy(pendingAction)
    const targetName = targetLabel(pendingTargetName)
    return {
      feedbackDetail: copy.pendingDetail(targetName),
      feedbackLabel: copy.pendingLabel,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    const copy = actionCopy(errorAction)
    const targetName = targetLabel(errorTargetName)
    return {
      feedbackDetail: `${errorMessage} ${copy.idleDetail(targetName)}`,
      feedbackLabel: copy.errorLabel,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (completedAction) {
    const copy = actionCopy(completedAction)
    const targetName = targetLabel(completedTargetName)
    return {
      feedbackDetail: completedDetail || copy.completedDetail(targetName),
      feedbackLabel: copy.successLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    feedbackDetail: 'Model gateway operations verify capability, refresh inventory, and route tasks only through explicit policy steps.',
    feedbackLabel: 'Model gateway ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}

export function buildModelGatewayActionGateViewModel({
  action,
  pending,
  pendingAction,
  pendingTargetName,
  targetName,
}: ModelGatewayActionGateViewModelInput): ModelGatewayActionGateViewModel {
  if (pending) {
    const copy = actionCopy(action)
    const pendingCopy = actionCopy(pendingAction)
    const target = targetName ? ` for ${targetLabel(targetName)}` : ''
    const pendingTarget = pendingTargetName ? ` for ${targetLabel(pendingTargetName)}` : ''
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `This ${copy.idleLabel.toLowerCase()}${target} is locked while ${pendingCopy.pendingLabel.toLowerCase()}${pendingTarget}. Providers, capability evidence and active task routes remain preserved.`,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
  }
}

export function buildProviderCreateViewModel({
  endpoint,
  errorMessage,
  name,
  pending,
  protocolLabel,
}: ProviderCreateViewModelInput): ProviderCreateViewModel {
  const hasName = Boolean(name.trim())
  const hasEndpoint = Boolean(endpoint.trim())
  const endpointInvalid = hasEndpoint && !isValidEndpoint(endpoint.trim())

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Provider creation is locked while the current model gateway operation preserves Providers, capability evidence and task routes.',
      endpointInvalid,
      endpointRequired: !hasEndpoint,
      feedbackDetail: 'Wait for the current model gateway operation to finish before changing provider inventory.',
      feedbackLabel: 'Model gateway is working',
      feedbackTone: 'pending',
      nameRequired: !hasName,
      submitLabel: 'Working...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasName && hasEndpoint && !endpointInvalid
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Fix the provider name and endpoint before retrying this Provider connection.',
      endpointInvalid,
      endpointRequired: !hasEndpoint,
      feedbackDetail: errorMessage,
      feedbackLabel: 'Provider was not created',
      feedbackTone: 'error',
      nameRequired: !hasName,
      submitLabel: 'Try again',
    }
  }

  if (!hasName) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name the Provider connection before creating it.',
      endpointInvalid,
      endpointRequired: !hasEndpoint,
      feedbackDetail: 'Name the provider connection so routing, discovery and audit logs remain readable.',
      feedbackLabel: 'Provider name required',
      feedbackTone: 'blocked',
      nameRequired: true,
      submitLabel: 'Create',
    }
  }

  if (!hasEndpoint) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter a Provider endpoint before creating this connection.',
      endpointInvalid: false,
      endpointRequired: true,
      feedbackDetail: 'Enter the HTTP endpoint that Nexus should use for catalog discovery and model calls.',
      feedbackLabel: 'Endpoint required',
      feedbackTone: 'blocked',
      nameRequired: false,
      submitLabel: 'Create',
    }
  }

  if (endpointInvalid) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Use a full http:// or https:// Provider endpoint before creating this connection.',
      endpointInvalid: true,
      endpointRequired: false,
      feedbackDetail: 'Use a full http:// or https:// endpoint URL for this provider connection.',
      feedbackLabel: 'Endpoint must be a URL',
      feedbackTone: 'blocked',
      nameRequired: false,
      submitLabel: 'Create',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    endpointInvalid: false,
    endpointRequired: false,
    feedbackDetail: `${protocolLabel} will be registered. Secret values stay outside Nexus; only the reference name is stored.`,
    feedbackLabel: 'Ready to create provider',
    feedbackTone: 'ready',
    nameRequired: false,
    submitLabel: 'Create',
  }
}

export function buildRouteCreateViewModel({
  compatibleCount,
  deploymentId,
  errorMessage,
  pending,
  requiredCapability,
  roleLabel,
}: RouteCreateViewModelInput): RouteCreateViewModel {
  const hasDeployment = Boolean(deploymentId)
  const capabilityLabel = requiredCapability.replaceAll('_', ' ')

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Route creation is locked while the current model gateway operation preserves active routing policy.',
      deploymentRequired: !hasDeployment,
      feedbackDetail: 'Wait for the current model gateway operation to finish before creating another route revision.',
      feedbackLabel: 'Model gateway is working',
      feedbackTone: 'pending',
      submitLabel: 'Working...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasDeployment && compatibleCount > 0
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Choose a compatible deployment before retrying this route revision.',
      deploymentRequired: !hasDeployment,
      feedbackDetail: errorMessage,
      feedbackLabel: 'Route revision was not created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    }
  }

  if (!compatibleCount) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `Add or sync a deployment that declares ${capabilityLabel} before creating this route revision.`,
      deploymentRequired: true,
      feedbackDetail: `Sync the catalog or add a Provider deployment that declares ${capabilityLabel}.`,
      feedbackLabel: 'Compatible deployment required',
      feedbackTone: 'blocked',
      submitLabel: 'Create route revision',
    }
  }

  if (!hasDeployment) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `Choose a verified ${capabilityLabel} deployment before creating the ${roleLabel} route revision.`,
      deploymentRequired: true,
      feedbackDetail: `Choose a deployment verified for ${capabilityLabel} before creating the ${roleLabel} route revision.`,
      feedbackLabel: 'Deployment required',
      feedbackTone: 'blocked',
      submitLabel: 'Create route revision',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    deploymentRequired: false,
    feedbackDetail: `${roleLabel} will get a draft route revision using the selected ${capabilityLabel} deployment.`,
    feedbackLabel: 'Ready to create route',
    feedbackTone: 'ready',
    submitLabel: 'Create route revision',
  }
}
