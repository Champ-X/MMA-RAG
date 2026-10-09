export type DecisionProvider = 'typesafe' | 'openrouter' | 'bailian'

export interface DecisionConfig {
  provider: DecisionProvider
  model: string
  intent_mode: 'off' | 'adaptive' | 'force'
  rerank_mode: 'off' | 'assist' | 'shadow' | 'replace' | 'force'
  citation_mode: 'off' | 'shadow'
  citation_strategy: 'per_unit' | 'batch_choice'
}

export interface DecisionSettingsResponse {
  config: DecisionConfig
  api_key_configured: boolean
  model: string
  intent_diagnostic_available?: boolean
  providers: Array<{ id: DecisionProvider; name: string; api_key_configured: boolean; endpoint_kind?: 'trial' | 'workspace'; region?: string }>
  models: Array<{ id: string; name: string; provider: DecisionProvider;
    source_actions?: Record<'require' | 'forbid', { execution: 'verify' | 'skip'; reason: string }> }>
}

export interface DecisionTestResponse {
  success: boolean
  requested_model: string
  model: string
  provider: DecisionProvider
  duration_s: number
  error?: string
}

export interface DecisionIntentTestResponse extends DecisionTestResponse {
  diagnostic_only: true
  decision?: DecisionIntentRecord & {
    thresholds?: { positive: number; negative: number; selected_probability: number }
  }
}

export interface DecisionIntentBlocker {
  field: 'intent_type' | 'planning' | DecisionModality
  reason: string
  signal?: number
  threshold?: number
}

export interface DecisionModelRecord {
  model?: string
  requested_model?: string
  provider?: string | null
  route?: string
  duration_s?: number
}

export interface DecisionIntentRecord extends DecisionModelRecord {
  mode?: DecisionConfig['intent_mode']
  status?: string
  accepted?: boolean
  eligible?: boolean
  forced?: boolean
  reason?: string
  policy_version?: string
  partially_applied?: boolean
  applied_modalities?: DecisionModality[]
  requirements?: DecisionRequirements
  strategy?: 'plan_first'
  plan?: DecisionPlanRecord
  blockers?: DecisionIntentBlocker[]
}

export interface DecisionPlanAction {
  id?: string
  index?: number
  target?: { modality?: DecisionModality; scope?: 'global' | 'object'; description?: string }
  action?: 'require' | 'forbid'
  source_span?: string
  provenance?: string
  status?: string
  decision?: 'verified' | 'contradicted' | 'unresolved'
  verified_signal?: number
  meets_profile_threshold?: boolean
  profile?: {
    id?: string
    purpose?: 'source_require' | 'source_forbid'
    provider?: string
    requested_model?: string
    actual_model?: string
    threshold?: number | null
    execution?: 'apply' | 'observe_only'
    status?: 'admitted' | 'holdout_pending' | 'rejected' | 'unavailable'
    reason?: string
  }
  applied?: boolean
  changed?: boolean
  before?: string
  after?: string
  reason?: string
}

export interface DecisionPlanRecord {
  baseline_plan_preserved?: boolean
  threshold?: number | null
  threshold_policy?: 'model_and_purpose_profile'
  request_count?: number
  proposed_count?: number
  scheduled_count?: number
  actions?: DecisionPlanAction[]
  applied_ids?: string[]
  status?: string
  reason?: string
}

export type DecisionModality = 'image' | 'audio' | 'video'
export type DecisionRequirementStatus = 'required' | 'helpful' | 'forbidden' | 'not_needed' | 'uncertain' | 'conflict'
export interface DecisionModalityRequirement {
  status?: DecisionRequirementStatus
  action?: 'adopted' | 'abstained' | 'added_required' | 'retained_baseline' | 'conflict_retained_baseline' | 'source_binding' | 'source_grounding'
  effective_intent?: string | null
  signals?: Record<string, number>
  signal_states?: Record<string, string>
}
export interface DecisionRequirements {
  policy_version?: string
  task?: { choice?: string; selected_probability?: number; confidence?: number; eligible?: boolean; accepted?: boolean; action?: string }
  planning?: { status?: string; grounding_state?: string; complex_signal?: number; context_signal?: number; grounding_signal?: number }
  modalities?: Partial<Record<DecisionModality, DecisionModalityRequirement>>
}

export interface DecisionCoverage {
  version?: string
  scope?: { kb_ids?: string[]; file_ids?: string[] }
  modalities?: Partial<Record<DecisionModality, {
    requirement?: DecisionRequirementStatus
    effective_intent?: string | null
    searched?: boolean
    candidate_count?: number
    retained_count?: number
    context_count?: number | null
    status?: 'not_searched' | 'no_candidates' | 'filtered' | 'retained' | 'included' | 'not_in_context'
  }>>
  grounding?: { signal_state?: string }
  warnings?: string[]
}

export interface DecisionEvidence {
  id?: string | number
  file_name?: string
  snippet?: string
  rank?: number
}

export interface DecisionRerankRecord extends DecisionModelRecord {
  mode?: DecisionConfig['rerank_mode']
  status?: string
  reason?: string
  baseline_ids?: Array<string | number>
  added_ids?: Array<string | number>
  proposed_ids?: Array<string | number>
  evaluated_count?: number
  attempted_count?: number
  requests?: Array<{ status?: string; candidate_ids?: Array<string | number> }>
  skipped_count?: number
  skip_reasons?: Record<string, number>
  policy_version?: string
  prompt_version?: string
  thresholds?: { direct_usefulness?: number; incremental_information?: number }
  baseline_comparison?: string
  candidate_decisions?: Array<{ id?: string | number; file_name?: string; snippet?: string; signals?: { direct_usefulness?: number; incremental_information?: number }; accepted?: boolean }>
  comparison?: { baseline?: DecisionEvidence[]; proposed?: DecisionEvidence[]; added?: DecisionEvidence[] }
}

export interface DecisionRetrievalRun {
  jev_decision?: DecisionIntentRecord
  reranking_scorer?: DecisionRerankRecord
  fast_path?: string
  preplanned_query?: boolean
  decision_coverage?: DecisionCoverage
}

/** One final check after context selection/compression, separate from legacy reranking. */
export interface DecisionContextCheckpoint extends DecisionModelRecord {
  policy_version?: string
  prompt_version?: string
  mode?: 'assist' | 'shadow' | 'off'
  status?: string
  reason?: string
  threshold?: number
  candidate_count?: number
  attempted_count?: number
  evaluated_count?: number
  requests?: Array<DecisionModelRecord & { status?: string; candidate_count?: number }>
  accepted_ids?: Array<string | number>
  proposed_ids?: Array<string | number>
  added_ids?: Array<string | number>
  skip_reasons?: Record<string, number>
  selected_ids?: Array<string | number>
  reference_ids?: string[]
  applied_count?: number
  comparison_scope?: string
  global_novelty?: string
  candidate_decisions?: Array<{
    id?: string | number
    file_name?: string
    snippet?: string
    role?: 'answer' | 'qualification' | 'counterevidence' | 'inapplicable' | 'irrelevant' | 'uncertain'
    probability?: number
    accepted?: boolean
    span_start?: number
    span_end?: number
    source_chars?: number
    partial_source?: boolean
    selection?: string
  }>
}

export interface DecisionCitationUnit {
  start?: number
  end?: number
  statement?: string
  citation_ids?: string[]
  evidence_basis?: 'source_text' | 'derived_text'
  source_modalities?: Array<'doc' | DecisionModality>
  limitations?: string[]
  result?: {
    status?: string
    reason?: string
    answers?: { relation?: { choice?: string; probabilities?: Record<string, number> } }
    metadata?: DecisionModelRecord
    choice_support_signal?: boolean
    factorized_support_signal?: boolean
  }
}

export interface DecisionCitationAudit {
  mode?: string
  strategy?: string
  status?: string
  reason?: string
  units?: DecisionCitationUnit[]
  gaps?: Array<{ start: number; end: number; reason: string }>
  coverage?: { cited_units?: number; evaluated_units?: number; not_evaluated_units?: number; unattributed_spans?: number }
  batch_metadata?: DecisionModelRecord
}

/** Optional on historic turns; kept intact from terminal events through history. */
export interface DecisionDiagnostics {
  retrieval?: { jev_config?: Partial<DecisionConfig>; runs?: DecisionRetrievalRun[]; final_added_ids?: Array<string | number>; decision_coverage?: DecisionCoverage; context_checkpoint?: DecisionContextCheckpoint }
  jev_citation_audit?: DecisionCitationAudit
  code?: string
  stage?: string
  reason?: string
  fallback_used?: boolean
}
