import { translate as t } from '@/i18n'
import type { UploadFailureFields } from '@/types/upload'

type Failure = UploadFailureFields & { id?: string; file_id?: string; error?: string; message?: string }
export const uploadFailureKeys = ['error_code', 'retry_supported', 'retryable', 'failed_stage', 'storage_persisted', 'recovery_hint',
  'provider_code', 'provider_request_id', 'model_used', 'failed_segment_start', 'failed_segment_end'] as const

export function uploadFailureFields(value: UploadFailureFields): UploadFailureFields {
  return Object.fromEntries(uploadFailureKeys.filter(key => key in value).map(key => [key, value[key]]))
}

/** Legacy errors may contain a provider response; keep diagnostics out of the UI. */
export function readableUploadError(value: string | undefined, fallback: string): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (/^processing lease expired$/i.test(text)) return t('后台处理已中断，任务未完成。')
  if (!text || text.length > 240 || /https?:\/\/|request[_ -]?id|traceback|\b(?:model|provider_code|api[_ -]?key|authorization)\s*[:=]|\bbearer\s|\w+(?:Error|Exception):|\b(?:qwen|gpt|gemini|claude|deepseek|llama)[-_]?\d[\w.-]*|[{}]/i.test(text)) return fallback
  return t(text)
}

export function uploadFailureCopy(failure: Failure) {
  const stored = isUploadSourceUnavailable(failure) ? false : failure.storage_persisted
  const reasons: Record<string, string> = {
    content_policy: '模型服务的内容审核未通过。',
    video_model_error: '视频解析服务未能完成处理。',
    video_invalid_json: '视频解析服务返回的结果不完整。',
    video_source_unavailable: '暂时无法读取原视频。',
    video_segment_extraction_failed: '视频片段准备失败。',
    processing_interrupted: '后台处理已中断，任务未完成。',
    dense_embedding_timeout: '文本索引生成超时。',
  }
  const rawMessage = failure.error || failure.message
  const containsDiagnostic = [failure.provider_code, failure.provider_request_id, failure.model_used]
    .some(value => value && rawMessage?.includes(value))
  const message = reasons[failure.error_code || '']
    ? t(reasons[failure.error_code!])
    : readableUploadError(containsDiagnostic ? undefined : rawMessage, t('文件处理未完成，暂未获得明确原因。'))
  const source = stored === true
    ? t('原文件已保存，无需重新上传。')
    : stored === false
      ? failure.error_code === 'content_policy' ? t('原文件尚未保存。') : t('原文件尚未保存，需要重新上传。')
      : t('原文件保存状态尚未确认，请先查看素材列表。')
  const recovery = failure.error_code === 'content_policy'
    ? t('直接重试通常无法解决，请联系模型服务商核实内容检查结果。')
    : failure.retryable === false || failure.retry_supported === false
      ? readableUploadError(failure.recovery_hint, t('请先解决上述问题，再确认是否可以重新解析。'))
      : stored === true && failure.retryable === true
        ? t('可直接重新解析已保存的原文件。')
        : stored === false ? '' : t('请先确认失败原因，避免重复上传。')
  return { message, source, recovery }
}

/** A processing placeholder identifies a task, not a stored file to preview. */
export function isUploadSourceUnavailable(file: { id?: string; file_id?: string; storage_persisted?: boolean }): boolean {
  return file.id?.startsWith('processing:') === true || file.file_id?.startsWith('processing:') === true || file.storage_persisted === false
}

export function canRetryStoredUpload(failure: Failure): boolean {
  return !isUploadSourceUnavailable(failure) && failure.storage_persisted === true && failure.retryable === true
    && failure.retry_supported !== false && failure.error_code !== 'content_policy'
}

/** Documents opt in through the server capability; legacy video behavior is separate. */
export function canRetryDocumentUpload(failure: Failure): boolean {
  return failure.retry_supported === true && canRetryStoredUpload(failure)
}

/** The existing preview action remains available for legacy, unclassified tasks. */
export function canRetryVideoFromPreview(failure: Failure): boolean {
  return !isUploadSourceUnavailable(failure) && failure.retryable !== false
    && failure.retry_supported !== false && failure.error_code !== 'content_policy'
}
