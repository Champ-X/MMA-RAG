import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLanguage } from '../src/i18n'
import { uploadBatchPercent, uploadProgressMessage, uploadStageLabel } from '../src/components/knowledge/uploadProgress'

test('a single long video reports stage progress before its completed count changes', () => {
  assert.equal(uploadBatchPercent({ stage: 'parsing', total: 1, completed: 0, failed: 0, submitted: true,
    files: [{ id: 'long', name: 'long.mp4', status: 'processing', progress: 38 }] }), 38)
})

test('mixed batches average known stage progress and count terminal failures as resolved', () => {
  assert.equal(uploadBatchPercent({ stage: 'parsing', total: 4, completed: 1, failed: 1, submitted: true, files: [
    { id: 'a', name: 'a', status: 'queued', progress: 25 },
    { id: 'b', name: 'b', status: 'processing', progress: 50 },
    { id: 'c', name: 'c', status: 'completed', progress: 70 },
    { id: 'd', name: 'd', status: 'failed', progress: 10 },
  ] }), 69)
  assert.equal(uploadBatchPercent({ stage: 'parsing', total: 1, completed: 0, failed: 0, submitted: true,
    files: [{ id: 'a', name: 'a', status: 'processing', progress: 100 }] }), 99, '100% requires a terminal batch')
  assert.equal(uploadBatchPercent({ stage: 'done', total: 1, completed: 0, failed: 1 }), 100)
  assert.equal(uploadBatchPercent({ stage: 'minio', total: 1, completed: 0, failed: 0, transferProgress: 73 }), 73)
})

test('new segment stages and actual segment ranges remain readable in English', () => {
  setLanguage('en-US')
  try {
    assert.equal(uploadStageLabel('processing', 'preparing_video'), 'Preparing video')
    assert.equal(uploadStageLabel('processing', 'preparing_segment'), 'Preparing video segment')
    assert.equal(uploadStageLabel('processing', 'parsing_segment'), 'Parsing video segment')
    assert.equal(uploadProgressMessage('正在准备视频第 2/89 段（105–225 秒）…'), 'Preparing video segment 2/89 (105–225 s)…')
    assert.equal(uploadProgressMessage('Qwen Omni 正在解析第 8/89 段（735–855 秒）…'), 'Qwen Omni is parsing segment 8/89 (735–855 s)…')
    assert.equal(uploadProgressMessage('Qwen Omni 正在解析第 2 段（105–225 秒）…'), 'Qwen Omni is parsing segment 2 (105–225 s)…')
    assert.equal(uploadProgressMessage('Provider request 123 timed out'), 'Provider request 123 timed out')
  } finally { setLanguage('zh-CN') }
})
