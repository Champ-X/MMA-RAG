/** Optional for tasks and session snapshots created before failure classification. */
export interface UploadFailureFields {
  error_code?: string
  retry_supported?: boolean
  retryable?: boolean
  failed_stage?: string
  storage_persisted?: boolean
  recovery_hint?: string
  provider_code?: string
  provider_request_id?: string
  model_used?: string
  failed_segment_start?: number
  failed_segment_end?: number
}
