/** Component-only failure/retry coverage; no uploads, backend calls, or visual claims. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { UploadFileProgress } from '../src/components/knowledge/UploadPipeline'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
let root: Root | undefined
let container: HTMLDivElement

type Options = { isUploading?: boolean; retryStates?: Record<string, { pending?: boolean; error?: string }> }
const failure = (overrides: Partial<UploadFileProgress> = {}): UploadFileProgress => ({
  id: 'processing-video-1', name: '动物科普.mp4', status: 'failed', stage: 'error',
  error_code: 'video_model_error', retryable: true, storage_persisted: true, ...overrides,
})

async function setup(files: UploadFileProgress[], options: Options = {}) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { act } = requireFrontend('react') as typeof import('react')
  const { UploadPipeline } = await import('../src/components/knowledge/UploadPipeline')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const retries: UploadFileProgress[] = []
  const render = async (nextFiles = files, nextOptions = options) => {
    files = nextFiles
    options = nextOptions
    await act(async () => root!.render(<UploadPipeline
      onFileSelect={() => { throw new Error('This test must never select or upload a file') }}
      onRetryFile={async file => { retries.push(file) }}
      uploadProgress={{ stage: 'done', total: files.length, completed: 0,
        failed: files.filter(file => file.status === 'failed').length, submitted: true, files }}
      {...options}
    />))
  }
  await render()
  const retryButtons = () => [...container.querySelectorAll<HTMLButtonElement>('.upload-file button')]
  return { act, render, retries, retryButtons }
}

afterEach(async () => {
  const { act } = requireFrontend('react') as typeof import('react')
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  localStorage.clear()
})

test('content-policy failures show saved originals without a retry or internal diagnostics', async () => {
  const { retryButtons } = await setup([failure({
    error_code: 'content_policy', retryable: true,
    error: '{"request_id":"private-request","model":"private-model","response":"raw-provider-response"}',
    provider_request_id: 'private-request', model_used: 'private-model', provider_code: 'private-provider-code',
    recovery_hint: 'raw-provider-response',
  })])
  const text = container.textContent!
  assert.match(text, /内容审核未通过/)
  assert.match(text, /原文件已保存，无需重新上传/)
  assert.equal(retryButtons().length, 0)
  assert.doesNotMatch(container.innerHTML, /private-request|private-model|private-provider-code|raw-provider-response|request_id/)
})

test('the native retry button names its video and passes the correct file identity', async () => {
  const first = failure()
  const second = failure({ id: 'processing-video-2', name: '第二段科普.mp4' })
  const { act, retryButtons, retries } = await setup([first, second])
  const button = retryButtons()[1]
  assert.ok(button instanceof HTMLButtonElement)
  assert.equal(button.type, 'button')
  assert.equal(button.textContent, '重新解析')
  assert.equal(button.getAttribute('aria-label'), '重新解析视频：第二段科普.mp4')
  assert.equal(button.disabled, false)
  button.focus()
  assert.equal(document.activeElement, button)
  await act(async () => { button.click() })
  assert.deepEqual(retries.map(file => file.id), ['processing-video-2'])
  assert.equal(retries[0], second)
})

for (const extension of ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'm4v']) {
  test(`a stored retryable .${extension} video can be reprocessed`, async () => {
    const { retryButtons } = await setup([failure({ name: `素材.${extension}` })])
    assert.equal(retryButtons().length, 1)
  })
}

test('uploading and pending retry states disable native activation and retry errors are announced', async () => {
  const file = failure()
  const { act, render, retries, retryButtons } = await setup([file], { isUploading: true })
  assert.equal(retryButtons()[0].disabled, true)
  await act(async () => { retryButtons()[0].click() })
  assert.equal(retries.length, 0)
  await render([file], { retryStates: { [file.id]: { pending: true } } })
  assert.equal(retryButtons()[0].disabled, true)
  assert.equal(retryButtons()[0].textContent, '重新入队中…')
  await act(async () => { retryButtons()[0].click() })
  assert.equal(retries.length, 0)
  await render([file], { retryStates: { [file.id]: { error: '未能重新入队，请稍后再试。' } } })
  assert.equal(retryButtons()[0].disabled, false)
  assert.equal(container.querySelector('.upload-file [role="status"]')?.textContent, '未能重新入队，请稍后再试。')
})

test('an old unclassified failure remains neutral about cause and original storage', async () => {
  const { retryButtons } = await setup([{ id: 'legacy', name: '历史视频.mp4', status: 'failed' }])
  assert.match(container.textContent!, /暂未获得明确原因/)
  assert.match(container.textContent!, /保存状态尚未确认/)
  assert.doesNotMatch(container.textContent!, /内容审核|需要重新上传|请重新上传|可直接重新解析/)
  assert.equal(retryButtons().length, 0)
})

test('legacy provider-response text is replaced by a neutral reason', async () => {
  await setup([{ id: 'legacy', name: '历史视频.mp4', status: 'failed',
    error: 'aliyun_bailian:qwen3.5-omni-plus: ProviderAPIError: request_error (HTTP 400)' }])
  assert.match(container.textContent!, /暂未获得明确原因/)
  assert.doesNotMatch(container.innerHTML, /aliyun_bailian|qwen3\.5|ProviderAPIError|request_error/)
})

test('a known unsaved source has distinct advice and no retry action', async () => {
  const { retryButtons } = await setup([failure({ storage_persisted: false })])
  assert.match(container.textContent!, /原文件尚未保存，需要重新上传/)
  assert.doesNotMatch(container.textContent!, /原文件已保存|重新解析已保存的原文件/)
  assert.equal(retryButtons().length, 0)
})

test('documents and nonfailed videos do not receive a video recovery button', async () => {
  const { retryButtons } = await setup([
    failure({ id: 'document', name: '笔记.md' }),
    failure({ id: 'complete', status: 'completed' }),
    failure({ id: 'processing', status: 'processing' }),
    failure({ id: 'nonretryable', retryable: false }),
  ])
  assert.equal(retryButtons().length, 0)
})
