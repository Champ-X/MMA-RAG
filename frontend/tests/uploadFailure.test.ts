import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { setLanguage } from '../src/i18n'
import {
  canRetryDocumentUpload, canRetryStoredUpload, canRetryVideoFromPreview, isUploadSourceUnavailable, readableUploadError,
  uploadFailureCopy, uploadFailureFields,
} from '../src/components/knowledge/uploadFailure'

beforeEach(() => setLanguage('zh-CN'))

test('an explicit content rejection explains saved originals and never offers a retry', () => {
  const failure = { error_code: 'content_policy', retryable: true, storage_persisted: true }
  const copy = uploadFailureCopy(failure)
  assert.match(copy.message, /内容审核未通过/)
  assert.match(copy.source, /原文件已保存，无需重新上传/)
  assert.match(copy.recovery, /联系模型服务商/)
  assert.equal(canRetryStoredUpload(failure), false, 'content rejection takes precedence over a conflicting retryable flag')
  assert.equal(canRetryVideoFromPreview(failure), false)
})

test('stored retryable failures explain recovery without another upload', () => {
  const failure = { error_code: 'video_model_error', retryable: true, storage_persisted: true }
  const copy = uploadFailureCopy(failure)
  assert.match(copy.message, /解析服务未能完成/)
  assert.match(copy.source, /无需重新上传/)
  assert.match(copy.recovery, /重新解析已保存的原文件/)
  assert.equal(canRetryStoredUpload(failure), true)
})

test('legacy snapshots remain neutral when cause and storage state are unknown', () => {
  const copy = uploadFailureCopy({})
  assert.match(copy.message, /暂未获得明确原因/)
  assert.match(copy.source, /保存状态尚未确认/)
  assert.doesNotMatch(Object.values(copy).join(' '), /内容审核|需要重新上传|请重新上传|可直接重新解析/)
  assert.equal(canRetryStoredUpload({}), false)
  assert.equal(canRetryVideoFromPreview({}), true, 'the existing legacy preview recovery action stays available')
})

test('known missing originals are distinguished from saved and unknown originals', () => {
  const failure = { storage_persisted: false, retryable: true }
  const copy = uploadFailureCopy(failure)
  assert.match(copy.source, /原文件尚未保存，需要重新上传/)
  assert.equal(copy.recovery, '')
  assert.equal(canRetryStoredUpload(failure), false)
  assert.equal(canRetryVideoFromPreview(failure), false)
})

test('raw provider diagnostics never become user-facing fallback errors', () => {
  const fallback = '文件处理未完成，暂未获得明确原因。'
  for (const raw of [
    '{"request_id":"private-request","model":"private-model","error":"provider payload"}',
    'request_id=private-request model=private-model',
    'aliyun_bailian:qwen3.5-omni-plus: ProviderAPIError: request_error (HTTP 400)',
    'provider_code=DataInspectionFailed',
  ]) {
    assert.equal(readableUploadError(raw, fallback), fallback, raw)
    const copy = uploadFailureCopy({ error: raw })
    assert.equal(copy.message, fallback)
    assert.doesNotMatch(Object.values(copy).join(' '), /private-request|private-model|aliyun_bailian|ProviderAPIError|DataInspectionFailed/)
  }
  assert.equal(readableUploadError('文件格式不受支持。', fallback), '文件格式不受支持。')
})

test('diagnostic recovery hints use readable neutral advice for nonretryable failures', () => {
  const copy = uploadFailureCopy({
    error_code: 'video_model_error', retryable: false, storage_persisted: true,
    recovery_hint: 'request_id=private-request model=private-model',
  })
  assert.doesNotMatch(copy.recovery, /private-request|private-model/)
  assert.match(copy.recovery, /先解决上述问题/)
})

test('status field selection preserves false and zero without carrying an arbitrary response body', () => {
  const fields = { error_code: 'video_model_error', retryable: false, storage_persisted: false,
    failed_segment_start: 0, failed_segment_end: 120.5, provider_request_id: 'request-1',
    model_used: 'model-1', provider_code: 'code-1', recovery_hint: '处理建议' }
  assert.deepEqual(uploadFailureFields({ ...fields, raw_response: { private: true }, lease_id: 'private' } as typeof fields), fields)
})

test('expired task leases describe an interruption without claiming a restart or missing storage', () => {
  const copy = uploadFailureCopy({ error: 'processing lease expired', storage_persisted: true })
  assert.equal(copy.message, '后台处理已中断，任务未完成。')
  assert.match(copy.source, /原文件已保存/)
  assert.doesNotMatch(Object.values(copy).join(' '), /已重启|尚未保存|lease/)
  assert.equal(uploadFailureCopy({ error_code: 'processing_interrupted' }).message, copy.message)
  setLanguage('en-US')
  assert.equal(readableUploadError('processing lease expired', 'fallback'), 'Background processing was interrupted; the task did not finish.')
})

test('task placeholders and explicitly unsaved originals cannot be previewed, while legacy files remain available', () => {
  assert.equal(isUploadSourceUnavailable({ id: 'processing:task-id' }), true)
  assert.equal(isUploadSourceUnavailable({ id: 'real-file', storage_persisted: false }), true)
  assert.equal(isUploadSourceUnavailable({ id: 'real-file', storage_persisted: true }), false)
  assert.equal(isUploadSourceUnavailable({ id: 'real-file' }), false)
  assert.equal(isUploadSourceUnavailable({ id: 'documents/processing:example.pdf' }), false)
})


test('saved document retries require explicit capability and reject placeholders and policy refusals', () => {
  const failure = { retry_supported: true, retryable: true, storage_persisted: true,
    error_code: 'dense_embedding_timeout', failed_stage: 'dense_embedding' }
  assert.equal(canRetryDocumentUpload(failure), true)
  for (const overrides of [{ retry_supported: undefined }, { retry_supported: false }, { retryable: false },
    { storage_persisted: false }, { storage_persisted: undefined }, { error_code: 'content_policy' },
    { id: 'processing:task' }, { file_id: 'processing:task' }]) {
    assert.equal(canRetryDocumentUpload({ ...failure, ...overrides }), false, JSON.stringify(overrides))
  }
  assert.equal(canRetryVideoFromPreview({ retry_supported: false }), false)
  assert.equal(canRetryStoredUpload({ ...failure, file_id: 'processing:task' }), false)
  assert.deepEqual(uploadFailureFields(failure), failure)
  const copy = uploadFailureCopy(failure)
  assert.equal(copy.message, '文本索引生成超时。')
  assert.match(copy.source, /原文件已保存，无需重新上传/)
  setLanguage('en-US')
  assert.equal(uploadFailureCopy(failure).message, 'Text indexing timed out.')
})
