/** Deferred upload receipts exercise real component ownership, without real uploads. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLVideoElement', 'Element', 'Node', 'NodeFilter',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'DocumentFragment', 'localStorage', 'sessionStorage', 'getComputedStyle', 'File']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) })
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
let root: Root | undefined
let container: HTMLDivElement
let restore: (() => void) | undefined
const settle = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

async function setup() {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { act } = requireFrontend('react') as typeof import('react')
  const { knowledgeApi, importApi } = await import('../src/services/api_client')
  const { useKnowledgeStore } = await import('../src/store/useKnowledgeStore')
  const { setLanguage } = await import('../src/i18n')
  const { default: KnowledgeList } = await import('../src/components/knowledge/KnowledgeList')
  setLanguage('zh-CN')
  const originals = { ...knowledgeApi }
  const originalImports = { ...importApi }
  const originalConfirm = window.confirm
  window.confirm = () => true
  const kbs = ['a', 'b'].map(id => ({ id, name: `Space ${id}`, description: '', stats: { documents: 0, chunks: 0, images: 0 } }))
  const statuses = new Map<string, Awaited<ReturnType<typeof knowledgeApi.getUploadProgressBatch>>['statuses'][number]>()
  const files: Record<string, Awaited<ReturnType<typeof knowledgeApi.getKnowledgeBaseFiles>>['files']> = { a: [], b: [] }
  const submissions: Array<{ kbId: string; files: File[]; onProgress?: (value: number) => void; response: ReturnType<typeof deferred<Awaited<ReturnType<typeof knowledgeApi.startBatchUpload>>>> }> = []
  const polls: string[][] = []
  knowledgeApi.getKnowledgeBases = async () => ({ knowledge_bases: kbs })
  knowledgeApi.getKnowledgeBaseMetadata = async id => kbs.find(kb => kb.id === id)!
  knowledgeApi.getKnowledgeBaseStats = async () => ({ documents: 0, chunks: 0, images: 0 })
  knowledgeApi.getKnowledgeBaseFiles = async id => ({ files: files[id] ?? [] })
  knowledgeApi.getKnowledgeBasePortrait = async () => ({ portraits: [] })
  knowledgeApi.getFilePreviewDetails = async () => ({})
  knowledgeApi.getFileStream = async () => new Blob(['fixture'], { type: 'video/mp4' })
  knowledgeApi.deleteKnowledgeBaseFile = async () => ({ message: 'deleted' })
  knowledgeApi.startBatchUpload = (kbId, selected, options) => {
    const response = deferred<Awaited<ReturnType<typeof knowledgeApi.startBatchUpload>>>()
    submissions.push({ kbId, files: selected, onProgress: options?.onProgress, response })
    return response.promise
  }
  knowledgeApi.getUploadProgressBatch = async ids => { polls.push([...ids]); return { statuses: ids.map(id => statuses.get(id) ?? { processing_id: id, status: 'queued', progress: 25 }) } }
  useKnowledgeStore.setState({ knowledgeBases: kbs, loading: false, error: null })
  restore = () => { Object.assign(knowledgeApi, originals); Object.assign(importApi, originalImports); window.confirm = originalConfirm }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async (kb = 'a') => act(async () => { root!.render(<KnowledgeList routeKnowledgeBaseId={kb} />); await settle() })
  const select = async (name: string, twice = false) => act(async () => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    assert.ok(input, 'upload file input exists')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['test'], name, { type: 'video/mp4' })] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    if (twice) input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  })
  const accepted = (index: number, id: string) => {
    const request = submissions[index]
    return { kb_id: request.kbId, total_files: 1, accepted_count: 1, failed_count: 0, results: [{ filename: request.files[0].name, status: 'queued' as const, processing_id: id }] }
  }
  const panel = () => container.querySelector('.upload-panel') as HTMLElement
  return { act, render, select, statuses, submissions, accepted, polls, panel, files, knowledgeApi, importApi }
}

afterEach(async () => {
  const { act } = requireFrontend('react') as typeof import('react')
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  restore?.()
  sessionStorage.clear()
})

test('two spaces transfer concurrently; reverse receipts and late progress retain their owners', async () => {
  const { act, render, select, statuses, submissions, accepted, polls, panel } = await setup()
  await render('a')
  await select('animal-a.mp4', true)
  assert.equal(submissions.length, 1, 'rapid duplicate selection is blocked in the same space')
  await act(async () => { submissions[0].onProgress?.(35) })
  assert.match(panel().textContent!, /35%/)
  await render('b')
  assert.equal(panel().dataset.busy, 'false')
  assert.doesNotMatch(panel().textContent!, /animal-a/)
  await select('biology-b.mp4')
  assert.deepEqual(submissions.map(item => item.kbId), ['a', 'b'])
  statuses.set('task-b', { processing_id: 'task-b', status: 'processing', stage: 'parsing_segment', progress: 52, message: 'Qwen Omni 正在解析第 4/8 段（315–435 秒）…' })
  await act(async () => { submissions[1].response.resolve(accepted(1, 'task-b')); await settle() })
  assert.match(panel().textContent!, /biology-b/)
  assert.match(panel().textContent!, /52%/)
  await act(async () => { submissions[0].onProgress?.(90) })
  assert.doesNotMatch(panel().textContent!, /90%|animal-a/)
  await render('a')
  assert.match(panel().textContent!, /90%/)
  assert.equal(panel().dataset.busy, 'true', 'B receipt does not release A transfer lock')
  statuses.set('task-a', { processing_id: 'task-a', status: 'processing', stage: 'parsing_segment', progress: 38, message: 'Qwen Omni 正在解析第 2/6 段（105–225 秒）…' })
  await act(async () => { submissions[0].response.resolve(accepted(0, 'task-a')); await settle() })
  assert.match(panel().textContent!, /animal-a/)
  assert.match(panel().textContent!, /38%/)
  assert.match(panel().textContent!, /2\/6/)
  assert.doesNotMatch(panel().textContent!, /biology-b/)
  assert.ok(polls.some(ids => ids.includes('task-a') && ids.includes('task-b')), 'one poll covers both spaces')
  await render('b')
  assert.equal(panel().dataset.busy, 'true')
  assert.match(panel().textContent!, /biology-b/)
  assert.doesNotMatch(panel().textContent!, /animal-a/)
  const a = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  const b = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:b')!)
  assert.equal(a.tasks[0].processingId, 'task-a')
  assert.equal(b.tasks[0].processingId, 'task-b')
})

test('refresh polls hidden spaces and keeps their failures separate from the visible batch', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  for (const kbId of ['a', 'b']) saveUploadBatch(sessionStorage, kbId, [{ kbId, processingId: `task-${kbId}`, filename: `${kbId}.mp4`, isImage: false }], {
    stage: 'parsing', total: kbId === 'b' ? 2 : 1, completed: 0, failed: kbId === 'b' ? 1 : 0, submitted: true,
    files: [{ id: `task-${kbId}`, name: `${kbId}.mp4`, status: 'processing', progress: 25 }, ...(kbId === 'b' ? [{ id: 'rejected:1', name: 'bad.xyz', status: 'failed', error: 'unsupported format' }] : [])],
  })
  const { render, statuses, panel, polls } = await setup()
  statuses.set('task-a', { processing_id: 'task-a', status: 'processing', progress: 38, stage: 'parsing_segment' })
  statuses.set('task-b', { processing_id: 'task-b', status: 'failed', error: 'provider timeout', stage: 'error' })
  await render('a')
  assert.ok(polls.some(ids => ids.includes('task-a') && ids.includes('task-b')))
  assert.equal(panel().dataset.busy, 'true')
  assert.doesNotMatch(panel().textContent!, /provider timeout|unsupported format/)
  const savedB = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:b')!)
  assert.equal(savedB.progress.stage, 'done')
  assert.equal(savedB.progress.failed, 2)
  assert.equal(savedB.progress.files[0].id, 'task-b')
  assert.equal(savedB.progress.files[0].error, 'provider timeout')
  await render('b')
  assert.equal(panel().dataset.busy, 'false')
  assert.match(panel().textContent!, /provider timeout/)
  assert.match(panel().textContent!, /unsupported format/)
  await render('a')
  assert.equal(panel().dataset.busy, 'true')
  assert.match(panel().textContent!, /38%/)
})

test('a rejected transfer releases only its own space and preserves its feedback', async () => {
  const { act, render, select, submissions, panel } = await setup()
  await render('a'); await select('a.mp4')
  await render('b'); await select('b.mp4')
  const warn = console.error
  console.error = () => {}
  try { await act(async () => { submissions[0].response.reject(new Error('A transfer interrupted')); await settle() }) }
  finally { console.error = warn }
  assert.equal(panel().dataset.busy, 'true')
  assert.doesNotMatch(panel().textContent!, /A transfer interrupted/)
  await render('a')
  assert.equal(panel().dataset.busy, 'false')
  assert.match(panel().textContent!, /A transfer interrupted/)
  await render('b')
  assert.equal(panel().dataset.busy, 'true')
})

test('retry keeps the failed task identity when its receipt arrives after switching spaces', async () => {
  const { act, render, select, files, knowledgeApi, statuses, panel } = await setup()
  files.a = [{ id: 'original-video', name: 'retry-a.mp4', type: 'mp4', size: 100, date: '', status: 'failed', processing_id: 'retry-task', error: 'provider timeout' }]
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.retryVideoUpload>>>()
  const retries: string[] = []
  knowledgeApi.retryVideoUpload = id => { retries.push(id); return response.promise }
  await render('a')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  await act(async () => { (document.querySelector('[aria-label="重新解析视频：retry-a.mp4"]') as HTMLButtonElement).click(); await settle() })
  assert.deepEqual(retries, ['retry-task'])
  await render('b')
  await select('b.mp4')
  statuses.set('retry-task', { processing_id: 'retry-task', status: 'processing', progress: 31, stage: 'parsing_segment' })
  await act(async () => { response.resolve({ processing_id: 'retry-task', status: 'queued', file_id: 'original-video', retry_count: 1, message: 'retry queued' }); await settle() })
  assert.match(panel().textContent!, /b.mp4/)
  assert.doesNotMatch(panel().textContent!, /retry-a/)
  assert.equal(panel().dataset.busy, 'true')
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.tasks[0].processingId, 'retry-task')
  assert.equal(saved.tasks[0].kbId, 'a')
  assert.equal(saved.progress.failed, 0)
  await render('a')
  assert.match(panel().textContent!, /retry-a/)
  assert.match(panel().textContent!, /31%/)
  assert.doesNotMatch(panel().textContent!, /provider timeout/)
})

test('an import receipt from A cannot close B’s dialog or release B’s pending submission', async () => {
  const { act, render, importApi, panel } = await setup()
  const requests: Array<{ kbId: string; response: ReturnType<typeof deferred<Awaited<ReturnType<typeof importApi.importHotTopicsStart>>>> }> = []
  importApi.importHotTopicsStart = body => {
    const response = deferred<Awaited<ReturnType<typeof importApi.importHotTopicsStart>>>()
    requests.push({ kbId: body.kb_id, response })
    return response.promise
  }
  const submit = async () => {
    await act(async () => {
      (container.querySelector('button[data-source="news"]') as HTMLButtonElement).click()
      await settle()
    })
    await act(async () => {
      document.querySelector('.import-dialog--news form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await settle()
    })
  }
  await render('a'); await submit()
  await render('b'); await submit()
  assert.deepEqual(requests.map(request => request.kbId), ['a', 'b'])
  await act(async () => { requests[0].response.resolve({ processing_id: 'import-a', filename: 'a-news.md', status: 'queued' }); await settle() })
  assert.ok(document.querySelector('.import-dialog--news'), 'B dialog remains open')
  assert.equal(panel().dataset.busy, 'true', 'B keeps its submission lock')
  assert.doesNotMatch(panel().textContent!, /a-news/)
  assert.equal(JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!).tasks[0].processingId, 'import-a')
  await act(async () => { requests[1].response.resolve({ processing_id: 'import-b', filename: 'b-news.md', status: 'queued' }); await settle() })
  assert.equal(document.querySelector('.import-dialog--news'), null)
  assert.match(panel().textContent!, /b-news/)
  assert.doesNotMatch(panel().textContent!, /a-news/)
})

test('server reports a new retry for an already-terminal task', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'same-task', filename: 'retry.mp4', isImage: false }], {
    stage: 'done', total: 1, completed: 0, failed: 1, submitted: true,
    files: [{ id: 'same-task', name: 'retry.mp4', status: 'failed', error: 'old provider failure', updated_at: '2026-10-24T00:00:00Z' }],
  })
  const { render, files, statuses, polls, panel } = await setup()
  files.a = [{ id: 'original-file', processing_id: 'same-task', name: 'retry.mp4', type: 'mp4', size: 100, date: '', status: 'processing', stage: 'parsing_segment', progress: 32, updated_at: '2026-10-24T01:00:00' }]
  statuses.set('same-task', { processing_id: 'same-task', status: 'processing', progress: 32, stage: 'parsing_segment' })
  await render('a')
  assert.ok(polls.some(ids => ids.includes('same-task')), 'server-confirmed newer retry must rejoin progress polling')
  assert.equal(panel().dataset.busy, 'true')
})

test('an older pending file list cannot revive a newer terminal task', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'same-task', filename: 'retry.mp4', isImage: false }], {
    stage: 'done', total: 1, completed: 0, failed: 1, submitted: true,
    files: [{ id: 'same-task', name: 'retry.mp4', status: 'failed', error: 'provider timeout', updated_at: '2026-10-24T01:00:00' }],
  })
  const { render, files, polls, panel } = await setup()
  files.a = [{ id: 'original-file', processing_id: 'same-task', name: 'retry.mp4', type: 'mp4', size: 100, date: '', status: 'processing', stage: 'parsing_segment', progress: 32, updated_at: '2026-10-24T00:59:59Z' }]
  await render('a')
  assert.equal(polls.filter(ids => ids.includes('same-task')).length, 1, 'terminal reconciliation does not restart progress polling')
  assert.equal(panel().dataset.busy, 'false')
  assert.match(panel().textContent!, /provider timeout/)
})

test('cross-space polling respects the server maximum', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  for (const kbId of ['a', 'b']) {
    const tasks = Array.from({ length: 501 }, (_, i) => ({ kbId, processingId: `${kbId}-${i}`, filename: `${i}.mp4`, isImage: false }))
    saveUploadBatch(sessionStorage, kbId, tasks, { stage: 'parsing', total: tasks.length, completed: 0, failed: 0, submitted: true,
      files: tasks.map(task => ({ id: task.processingId, name: task.filename, status: 'queued', progress: 25 })) })
  }
  const { render, polls, knowledgeApi } = await setup()
  const original = knowledgeApi.getUploadProgressBatch
  knowledgeApi.getUploadProgressBatch = async ids => {
    if (ids.length > 1000) { polls.push([...ids]); throw Object.assign(new Error('422 processing_ids max_length 1000'), { status: 422 }) }
    return original(ids)
  }
  await render('a')
  assert.ok(polls.length > 0)
  assert.ok(polls.every(ids => ids.length <= 1000), `observed sizes ${polls.map(ids => ids.length)}`)
  assert.equal(new Set(polls.flat()).size, 1002, 'every space remains covered')
})

test('submission failure carrying a real processing ID survives restoration', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'queued-task', filename: 'ok.mp4', isImage: false }], {
    stage: 'parsing', total: 2, completed: 0, failed: 1, submitted: true,
    files: [{ id: 'queued-task', name: 'ok.mp4', status: 'queued' }, { id: 'launch-failed-task', name: 'bad.mp4', status: 'failed', error: 'launch failed' }],
  })
  const { render, statuses, panel } = await setup()
  statuses.set('queued-task', { processing_id: 'queued-task', status: 'completed', progress: 100 })
  await render('a')
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.progress.failed, 1, 'backend launch failure must remain counted')
  assert.match(panel().textContent!, /bad.mp4/)
})

async function saveFailedBatch(kbId: string, ids: string[]) {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, kbId, ids.map(id => ({ kbId, processingId: id, filename: `${id}.mp4`, isImage: false })), {
    stage: 'done', total: ids.length, completed: 0, failed: ids.length, submitted: true,
    files: ids.map(id => ({ id, name: `${id}.mp4`, status: 'failed', error_code: 'video_model_error', retryable: true, storage_persisted: true })),
  })
}

test('inline retry preserves other batch results, blocks duplicate clicks, and follows its space after navigation', async () => {
  await saveFailedBatch('a', ['retry-one', 'keep-two'])
  const { act, render, panel, knowledgeApi, statuses, select } = await setup()
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.retryVideoUpload>>>()
  const retries: string[] = []
  knowledgeApi.retryVideoUpload = id => { retries.push(id); return response.promise }
  await render('a')
  await act(async () => {
    const button = panel().querySelector('[aria-label="重新解析视频：retry-one.mp4"]') as HTMLButtonElement
    button.click(); button.click(); await settle()
  })
  assert.deepEqual(retries, ['retry-one'])
  assert.match(panel().textContent!, /重新入队中/)
  assert.match(panel().textContent!, /keep-two/)
  assert.ok(Array.from(panel().querySelectorAll<HTMLButtonElement>('.upload-file__retry')).every(button => button.disabled))
  await render('b'); await select('independent-b.mp4')
  statuses.set('retry-one', { processing_id: 'retry-one', status: 'processing', progress: 42, stage: 'parsing_segment' })
  await act(async () => {
    response.resolve({ processing_id: 'retry-one', status: 'queued', file_id: 'same-original', retry_count: 1, message: 'queued' })
    await settle()
  })
  assert.match(panel().textContent!, /independent-b/)
  assert.doesNotMatch(panel().textContent!, /retry-one|keep-two/)
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.tasks.length, 2)
  assert.equal(saved.progress.total, 2)
  assert.equal(saved.progress.failed, 1)
  assert.equal(saved.progress.files.find((entry: { id: string }) => entry.id === 'keep-two').status, 'failed')
  await render('a')
  assert.match(panel().textContent!, /42%/)
  assert.match(panel().textContent!, /keep-two/)
  assert.equal(saved.progress.files.find((entry: { id: string }) => entry.id === 'retry-one').error_code, undefined)
})

test('late inline retry errors are scoped to their task and space and accept detail.message', async () => {
  await saveFailedBatch('a', ['failure-a', 'other-a'])
  await saveFailedBatch('b', ['failure-b'])
  const { act, render, panel, knowledgeApi } = await setup()
  const responses = new Map(['failure-a', 'failure-b'].map(id => [id, deferred<Awaited<ReturnType<typeof knowledgeApi.retryVideoUpload>>>()]))
  knowledgeApi.retryVideoUpload = id => responses.get(id)!.promise
  await render('a')
  await act(async () => { (panel().querySelector('[aria-label="重新解析视频：failure-a.mp4"]') as HTMLButtonElement).click(); await settle() })
  await render('b')
  await act(async () => { (panel().querySelector('.upload-file__retry') as HTMLButtonElement).click(); await settle() })
  await act(async () => { responses.get('failure-a')!.reject({ response: { data: { detail: { message: '任务状态已变化，请刷新确认。' } } } }); await settle() })
  assert.equal(panel().dataset.busy, 'true')
  assert.doesNotMatch(panel().textContent!, /任务状态已变化/)
  await render('a')
  assert.equal(panel().dataset.busy, 'false')
  const rows = Array.from(panel().querySelectorAll('.upload-file'))
  assert.match(rows.find(row => row.textContent!.includes('failure-a.mp4'))!.textContent!, /任务状态已变化/)
  assert.doesNotMatch(rows.find(row => row.textContent!.includes('other-a.mp4'))!.textContent!, /任务状态已变化/)
  await render('b')
  assert.equal(panel().dataset.busy, 'true')
})

test('file-list classification refreshes a terminal legacy snapshot and blocks policy retry in the preview', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'policy-task', filename: 'policy.mp4', isImage: false }], {
    stage: 'done', total: 1, completed: 0, failed: 1, submitted: true,
    files: [{ id: 'policy-task', name: 'policy.mp4', status: 'failed', error: 'old generic failure' }],
  })
  const { act, render, panel, files, polls } = await setup()
  files.a = [{ id: 'policy-original', name: 'policy.mp4', type: 'mp4', size: 100, date: '', status: 'failed', processing_id: 'policy-task',
    error_code: 'content_policy', retryable: false, storage_persisted: true, provider_request_id: 'secret-request', model_used: 'secret-model' }]
  await render('a')
  assert.match(panel().textContent!, /内容审核未通过/)
  assert.match(panel().textContent!, /原文件已保存/)
  assert.equal(panel().querySelector('.upload-file__retry'), null)
  assert.equal(polls.filter(ids => ids.includes('policy-task')).length, 1, 'terminal reconciliation does not restart work')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  assert.match(document.body.textContent!, /内容审核未通过/)
  assert.equal(document.querySelector('[aria-label="重新解析视频：policy.mp4"]'), null)
  assert.doesNotMatch(document.body.textContent!, /secret-request|secret-model/)
})

for (const receipt of ['resolve', 'reject'] as const) test(`server progress observed before a delayed retry ${receipt} preserves the whole batch`, async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  const oldTime = '2026-10-24T00:00:00Z'
  const newTime = '2026-10-24T01:00:00Z'
  const ids = ['retry-delayed', 'keep-failed', 'keep-completed']
  saveUploadBatch(sessionStorage, 'a', ids.map(id => ({ kbId: 'a', processingId: id, filename: `${id}.mp4`, isImage: false })), {
    stage: 'done', total: 3, completed: 1, failed: 2, submitted: true,
    files: ids.map(id => ({ id, name: `${id}.mp4`, status: id === 'keep-completed' ? 'completed' : 'failed',
      error_code: id === 'keep-completed' ? undefined : 'video_model_error', retryable: true, storage_persisted: true, updated_at: oldTime })),
  })
  const { act, render, panel, knowledgeApi, statuses, files, polls } = await setup()
  files.a = [{ id: 'original-file', processing_id: 'retry-delayed', name: 'retry-delayed.mp4', type: 'mp4', size: 100, date: '', status: 'failed',
    error_code: 'video_model_error', retryable: true, storage_persisted: true, updated_at: oldTime }]
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.retryVideoUpload>>>()
  const retries: string[] = []
  knowledgeApi.retryVideoUpload = id => { retries.push(id); return response.promise }
  await render('a')
  await act(async () => { (panel().querySelector('[aria-label="重新解析视频：retry-delayed.mp4"]') as HTMLButtonElement).click(); await settle() })
  await render('b')
  files.a = [{ ...files.a[0], status: 'processing', stage: 'parsing_segment', progress: 42, updated_at: newTime }]
  statuses.set('retry-delayed', { processing_id: 'retry-delayed', status: 'processing', stage: 'parsing_segment', progress: 42, updated_at: newTime })
  await render('a')
  const assertPreserved = () => {
    const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
    assert.equal(saved.tasks.length, 3)
    assert.equal(saved.progress.total, 3)
    assert.equal(saved.progress.failed, 1)
    assert.equal(saved.progress.completed, 1)
    assert.equal(saved.progress.files.find((entry: { id: string }) => entry.id === 'keep-failed').status, 'failed')
    assert.equal(saved.progress.files.find((entry: { id: string }) => entry.id === 'keep-completed').status, 'completed')
    assert.equal(panel().dataset.busy, 'true')
    assert.deepEqual(retries, ['retry-delayed'])
  }
  assertPreserved()
  assert.match(panel().textContent!, /42%/)
  assert.ok(polls.some(ids => ids.includes('retry-delayed')))
  await act(async () => {
    if (receipt === 'resolve') response.resolve({ processing_id: 'retry-delayed', status: 'queued', file_id: 'original-file', retry_count: 1, message: 'queued' })
    else response.reject(new Error('retry receipt connection interrupted'))
    await settle()
  })
  assertPreserved()
  assert.match(panel().textContent!, /42%/, 'a delayed receipt must not roll back confirmed server progress')
})

test('authoritative failures clear omitted old classifications, advance time, and reject older snapshots', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'same-task', filename: 'retry.mp4', isImage: false }], {
    stage: 'done', total: 1, completed: 0, failed: 1, submitted: true,
    files: [{ id: 'same-task', name: 'retry.mp4', status: 'failed', error: 'old policy refusal', error_code: 'content_policy', retryable: false,
      provider_request_id: 'old-request', storage_persisted: true, updated_at: '2026-10-24T00:00:00Z' }],
  })
  const { render, files, panel } = await setup()
  files.a = [{ id: 'original-file', processing_id: 'same-task', name: 'retry.mp4', type: 'mp4', size: 100, date: '', status: 'failed',
    error: 'new source read error', storage_persisted: true, updated_at: '2026-10-24T02:00:00Z' }]
  await render('a')
  let saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.progress.files[0].error_code, undefined)
  assert.equal(saved.progress.files[0].retryable, undefined)
  assert.equal(saved.progress.files[0].provider_request_id, undefined)
  assert.equal(saved.progress.files[0].updated_at, '2026-10-24T02:00:00Z')
  assert.doesNotMatch(panel().textContent!, /内容审核未通过/)
  await render('b')
  files.a = [{ ...files.a[0], error_code: 'content_policy', retryable: false, provider_request_id: 'older-request', updated_at: '2026-10-24T01:00:00Z' }]
  await render('a')
  saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.progress.files[0].error_code, undefined)
  assert.equal(saved.progress.files[0].updated_at, '2026-10-24T02:00:00Z')
  assert.doesNotMatch(panel().textContent!, /内容审核未通过/)
})

test('a delayed successful deletion cleans only its space and exact original, preserving a same-name reupload', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  const ids = ['old-attempt', 'new-attempt', 'sibling']
  saveUploadBatch(sessionStorage, 'a', ids.map(id => ({ kbId: 'a', processingId: id, fileId: `${id}-file`, filename: 'same.mp4', isImage: false })), {
    stage: 'done', total: 3, completed: 1, failed: 2, submitted: true,
    files: ids.map(id => ({ id, file_id: `${id}-file`, name: 'same.mp4', status: id === 'sibling' ? 'completed' : 'failed' })),
  })
  const { act, render, panel, files, knowledgeApi, select } = await setup()
  files.a = ids.slice(0, 2).map(id => ({ id: `${id}-file`, processing_id: id, name: 'same.mp4', type: 'mp4', size: 100, date: '', status: 'failed' }))
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.deleteKnowledgeBaseFile>>>()
  const deletions: string[][] = []
  knowledgeApi.deleteKnowledgeBaseFile = (kbId, fileId) => { deletions.push([kbId, fileId]); return response.promise }
  await render('a')
  await act(async () => { (container.querySelector('[aria-label^="切换到列表视图"]') as HTMLButtonElement).click(); await settle() })
  await act(async () => { (container.querySelector('[aria-label="删除文件：same.mp4"]') as HTMLButtonElement).click(); await settle() })
  await render('b'); await select('same.mp4')
  await act(async () => { response.resolve({ message: 'deleted' }); await settle() })
  assert.deepEqual(deletions, [['a', 'old-attempt-file']])
  assert.equal(panel().dataset.busy, 'true', 'A deletion cannot release B transfer')
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.deepEqual(saved.tasks.map((task: { processingId: string }) => task.processingId), ['new-attempt', 'sibling'])
  assert.equal(saved.progress.total, 2)
  assert.equal(saved.progress.completed, 1)
  assert.equal(saved.progress.failed, 1)
  await render('a') // The deliberately stale list response still includes the deleted original.
  assert.equal(container.querySelectorAll('[aria-label="删除文件：same.mp4"]').length, 1)
  assert.equal(panel().querySelectorAll('.upload-file').length, 1, 'completed siblings are collapsed behind the default attention filter')
  const showAll = [...panel().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查看全部')!
  await act(async () => showAll.click())
  assert.equal(panel().querySelectorAll('.upload-file').length, 2, 'the completed sibling remains available in all files')
})

test('deleting the final upload removes its session snapshot and closes its preview only after success', async () => {
  await saveFailedBatch('a', ['last-task'])
  const { act, render, panel, files, knowledgeApi } = await setup()
  files.a = [{ id: 'last-file', processing_id: 'last-task', name: 'last-task.mp4', type: 'mp4', size: 100, date: '', status: 'failed' }]
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.deleteKnowledgeBaseFile>>>()
  knowledgeApi.deleteKnowledgeBaseFile = () => response.promise
  await render('a')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  await act(async () => { (document.querySelector('[aria-label="删除文件：last-task.mp4"]') as HTMLButtonElement).click(); await settle() })
  assert.ok(document.querySelector('[role="dialog"]'))
  await act(async () => { response.resolve({ message: 'deleted' }); await settle() })
  assert.equal(sessionStorage.getItem('tessmora:upload-batch:a'), null)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(panel().querySelector('.upload-batch'), null)
})

test('an active-task delete conflict preserves the file and task and shows the server explanation', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  saveUploadBatch(sessionStorage, 'a', [{ kbId: 'a', processingId: 'active-task', filename: 'active.mp4', isImage: false }], {
    stage: 'parsing', total: 1, completed: 0, failed: 0, submitted: true, files: [{ id: 'active-task', name: 'active.mp4', status: 'processing', progress: 40 }],
  })
  const { act, render, files, statuses, knowledgeApi, panel } = await setup()
  files.a = [{ id: 'active-file', processing_id: 'active-task', name: 'active.mp4', type: 'mp4', size: 100, date: '', status: 'processing' }]
  statuses.set('active-task', { processing_id: 'active-task', status: 'processing', progress: 40 })
  knowledgeApi.deleteKnowledgeBaseFile = async () => { throw { response: { status: 409, data: { detail: { message: '文件仍在处理中，请完成后再删除。' } } } } }
  await render('a')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  await act(async () => { (document.querySelector('[aria-label="删除文件：active.mp4"]') as HTMLButtonElement).click(); await settle() })
  assert.ok(document.querySelector('[role="dialog"]'))
  assert.match(document.querySelector('[role="dialog"]')!.textContent!, /文件仍在处理中，请完成后再删除/)
  assert.equal(panel().dataset.busy, 'true')
  assert.equal(JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!).tasks[0].processingId, 'active-task')
})

test('deleted polling statuses remove both old attempts without turning them into failures or touching another space', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  for (const kbId of ['a', 'b']) {
    const ids = kbId === 'a' ? ['old-ghost', 'new-ghost', 'keep-active'] : ['other-space']
    saveUploadBatch(sessionStorage, kbId, ids.map(id => ({ kbId, processingId: id, filename: `${id}.mp4`, isImage: false })), {
      stage: 'parsing', total: ids.length, completed: 0, failed: 0, submitted: true,
      files: ids.map(id => ({ id, name: `${id}.mp4`, status: 'processing', progress: 40 })),
    })
  }
  const { render, panel, files, statuses } = await setup()
  statuses.set('old-ghost', { processing_id: 'old-ghost', status: 'deleted' })
  statuses.set('new-ghost', { processing_id: 'new-ghost', file_id: 'new-ghost-file', status: 'deleted' })
  statuses.set('keep-active', { processing_id: 'keep-active', status: 'processing', progress: 50 })
  statuses.set('other-space', { processing_id: 'other-space', status: 'processing', progress: 60 })
  files.a = ['old-ghost', 'new-ghost', 'keep-active'].map(id => ({ id: `${id}-file`, processing_id: id, name: `${id}.mp4`, type: 'mp4', size: 100, date: '', status: 'processing' }))
  await render('b')
  assert.match(panel().textContent!, /other-space/)
  assert.doesNotMatch(panel().textContent!, /ghost/)
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.deepEqual(saved.tasks.map((task: { processingId: string }) => task.processingId), ['keep-active'])
  assert.equal(saved.progress.total, 1)
  assert.equal(saved.progress.failed, 0)
  await render('a')
  assert.doesNotMatch(container.textContent!, /old-ghost|new-ghost/)
  assert.match(panel().textContent!, /keep-active/)
})

test('returning focus reconciles deletion of terminal session tasks from another tab', async () => {
  await saveFailedBatch('a', ['deleted-elsewhere', 'keep-failed'])
  const { act, render, panel, statuses } = await setup()
  await render('a')
  assert.equal(panel().querySelectorAll('.upload-file').length, 2)
  statuses.set('deleted-elsewhere', { processing_id: 'deleted-elsewhere', status: 'deleted' })
  await act(async () => { window.dispatchEvent(new Event('focus')); await settle() })
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.deepEqual(saved.tasks.map((task: { processingId: string }) => task.processingId), ['keep-failed'])
  assert.equal(saved.progress.failed, 1)
  assert.doesNotMatch(panel().textContent!, /deleted-elsewhere/)
})

for (const view of ['gallery', 'table']) test(`unsaved PDF task records block preview but remain deletable in ${view} view`, async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  const ids = ['interrupted-one', 'interrupted-two']
  saveUploadBatch(sessionStorage, 'a', ids.map(id => ({ kbId: 'a', processingId: id, filename: `${id}.pdf`, isImage: false })), {
    stage: 'done', total: 2, completed: 0, failed: 2, submitted: true,
    files: ids.map(id => ({ id, name: `${id}.pdf`, status: 'failed', error: 'processing lease expired' })),
  })
  const { act, render, panel, files, knowledgeApi } = await setup()
  // Legacy records may omit both processing_id and storage_persisted. The literal
  // processing: identity still tells us that no stored file can be previewed.
  files.a = ids.map(id => ({ id: `processing:${id}`, name: `${id}.pdf`, type: 'pdf', size: 100,
    date: '', status: 'failed', error: 'processing lease expired' }))
  let previewRequests = 0
  knowledgeApi.getFilePreviewDetails = async () => { previewRequests += 1; return {} }
  knowledgeApi.getFileStream = async () => { previewRequests += 1; return new Blob() }
  knowledgeApi.getFileTextContent = async () => { previewRequests += 1; return { content: '' } }
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.deleteKnowledgeBaseFile>>>()
  const deletions: string[][] = []
  knowledgeApi.deleteKnowledgeBaseFile = (kbId, fileId) => { deletions.push([kbId, fileId]); return response.promise }
  await render('a')
  if (view === 'table') await act(async () => {
    (container.querySelector('[aria-label^="切换到列表视图"]') as HTMLButtonElement).click(); await settle()
  })
  const preview = container.querySelector('[aria-label="预览文件：interrupted-one.pdf"]') as HTMLButtonElement
  assert.equal(preview.disabled, true)
  const hint = document.getElementById(preview.getAttribute('aria-describedby')!)!
  assert.match(hint.textContent!, /原文件尚未保存，暂时无法预览/)
  await act(async () => { preview.click(); await settle() })
  assert.equal(previewRequests, 0)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.match(container.textContent!, /后台处理已中断，任务未完成/)
  assert.doesNotMatch(container.textContent!, /processing lease expired/)
  const removeFirst = container.querySelector('[aria-label="删除文件：interrupted-one.pdf"]') as HTMLButtonElement
  assert.equal(removeFirst.disabled, false)
  assert.equal(removeFirst.closest('button button'), null, 'delete must be a separate native control')
  await act(async () => { removeFirst.click(); await settle() })
  assert.deepEqual(deletions, [['a', 'processing:interrupted-one']])
  assert.equal(JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!).tasks.length, 2, 'retain feedback until server confirms deletion')
  await act(async () => { response.resolve({ message: 'deleted' }); await settle() })
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.deepEqual(saved.tasks.map((task: { processingId: string }) => task.processingId), ['interrupted-two'])
  assert.equal(saved.progress.total, 1)
  assert.equal(saved.progress.failed, 1)
  await act(async () => {
    (container.querySelector('[aria-label="删除文件：interrupted-two.pdf"]') as HTMLButtonElement).click(); await settle()
  })
  assert.deepEqual(deletions[1], ['a', 'processing:interrupted-two'])
  assert.equal(sessionStorage.getItem('tessmora:upload-batch:a'), null)
  assert.equal(panel().querySelector('.upload-batch'), null)
  await render('b'); await render('a') // Stale list responses must not restore deleted placeholders.
  assert.equal(container.querySelector('[aria-label="删除文件：interrupted-one.pdf"]'), null)
  assert.equal(container.querySelector('[aria-label="删除文件：interrupted-two.pdf"]'), null)
  assert.equal(previewRequests, 0)
})


test('saved PDF retry preserves one original, fences older failures, and resumes its restored batch', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  const failedAt = '2026-10-25T00:00:00Z'
  const queuedAt = '2026-10-25T01:00:00Z'
  const failure = { id: 'pdf-task', file_id: 'pdf-original', name: '论文.pdf', status: 'failed',
    error_code: 'dense_embedding_timeout', failed_stage: 'dense_embedding', retry_supported: true,
    retryable: true, storage_persisted: true, updated_at: failedAt }
  saveUploadBatch(sessionStorage, 'a', [{ processingId: failure.id, fileId: failure.file_id, filename: failure.name, isImage: false, kbId: 'a' }],
    { stage: 'done', total: 1, completed: 0, failed: 1, submitted: true, files: [failure] })
  const { act, render, panel, files, knowledgeApi, statuses, submissions } = await setup()
  files.a = [{ ...failure, id: failure.file_id, processing_id: failure.id, type: 'pdf', size: 1234, date: '' }]
  statuses.set(failure.id, { ...failure, processing_id: failure.id })
  const retries: string[] = []
  knowledgeApi.retryUpload = async id => {
    retries.push(id)
    return { processing_id: id, file_id: failure.file_id, status: 'queued', retry_count: 1,
      updated_at: queuedAt, storage_persisted: true, retry_supported: true, message: '等待恢复处理' }
  }
  knowledgeApi.retryVideoUpload = async () => { throw new Error('Documents must use the generic endpoint method') }
  await render('a')
  assert.match(panel().textContent!, /文本索引生成超时/)
  assert.match(panel().textContent!, /无需重新上传/)
  await act(async () => {
    const button = panel().querySelector('[aria-label="重新处理文件：论文.pdf"]') as HTMLButtonElement
    button.click(); button.click(); await settle()
  })
  assert.deepEqual(retries, ['pdf-task'])
  assert.equal(submissions.length, 0)
  const saved = () => JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved().progress.files.length, 1)
  assert.equal(saved().tasks[0].fileId, 'pdf-original')
  assert.equal(saved().progress.files[0].file_id, 'pdf-original')
  assert.equal(saved().progress.files[0].status, 'queued', 'old failed poll cannot terminate the new attempt')
  assert.equal(saved().progress.files[0].failed_stage, undefined)
  assert.equal(saved().progress.files[0].error_code, undefined)
  assert.equal(saved().progress.failed, 0)
  assert.equal(panel().dataset.busy, 'true')
  await render('b'); await render('a')
  assert.equal(saved().progress.files[0].status, 'queued', 'old failed file-list snapshot cannot revive failure')
  assert.equal(container.querySelectorAll('.resource-files__gallery > *').length, 1)
  assert.doesNotMatch(container.textContent!, /文本索引生成超时/)
  statuses.set(failure.id, { processing_id: failure.id, file_id: failure.file_id, status: 'processing',
    stage: 'dense_embedding', progress: 65, message: '正在生成文本索引：12/30 块', updated_at: '2026-10-25T02:00:00Z', storage_persisted: true })
  await render('b'); await render('a')
  assert.match(panel().textContent!, /生成文本索引/)
  assert.match(panel().textContent!, /12\/30 块/)
  assert.match(panel().textContent!, /65%/)
  assert.equal(saved().progress.files.length, 1)
  assert.deepEqual(retries, ['pdf-task'], 'navigation never triggers another retry')
})

test('saved PDF preview exposes generic retry and disables repeated activation', async () => {
  const { act, render, files, knowledgeApi } = await setup()
  files.a = [{ id: 'pdf-original', processing_id: 'pdf-task', name: '可恢复.pdf', type: 'pdf', size: 100, date: '', status: 'failed',
    storage_persisted: true, retry_supported: true, retryable: true, error_code: 'dense_embedding_timeout', failed_stage: 'dense_embedding' }]
  const retries: string[] = []
  const receipt = deferred<Awaited<ReturnType<typeof knowledgeApi.retryUpload>>>()
  knowledgeApi.retryUpload = id => { retries.push(id); return receipt.promise }
  await render('a')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  const button = document.querySelector('[aria-label="重新处理文件：可恢复.pdf"]') as HTMLButtonElement
  assert.ok(button)
  await act(async () => { button.click(); button.click(); await settle() })
  assert.deepEqual(retries, ['pdf-task'])
  assert.equal(button.disabled, true)
})


test('a delayed PDF queued receipt cannot reopen an already completed recovery', async () => {
  const { saveUploadBatch } = await import('../src/components/knowledge/uploadBatchSession')
  const failure = { id: 'pdf-task', file_id: 'pdf-original', name: '论文.pdf', status: 'failed',
    error_code: 'dense_embedding_timeout', failed_stage: 'dense_embedding', retry_supported: true,
    retryable: true, storage_persisted: true, updated_at: '2026-10-25T00:00:00Z' }
  saveUploadBatch(sessionStorage, 'a', [{ processingId: failure.id, fileId: failure.file_id, filename: failure.name, isImage: false, kbId: 'a' }],
    { stage: 'done', total: 1, completed: 0, failed: 1, submitted: true, files: [failure] })
  const { act, render, panel, files, knowledgeApi, statuses } = await setup()
  files.a = [{ ...failure, id: failure.file_id, processing_id: failure.id, type: 'pdf', size: 1234, date: '' }]
  const response = deferred<Awaited<ReturnType<typeof knowledgeApi.retryUpload>>>()
  knowledgeApi.retryUpload = () => response.promise
  await render('a')
  await act(async () => { (panel().querySelector('.upload-file__retry') as HTMLButtonElement).click(); await settle() })
  await render('b')
  files.a = [{ ...files.a[0], status: 'processing', progress: 65, stage: 'dense_embedding', updated_at: '2026-10-25T02:00:00Z' }]
  statuses.set(failure.id, { processing_id: failure.id, file_id: failure.file_id, status: 'completed', progress: 100,
    updated_at: '2026-10-25T03:00:00Z', storage_persisted: true })
  await render('a')
  assert.equal(panel().dataset.busy, 'false')
  await act(async () => {
    response.resolve({ processing_id: failure.id, file_id: failure.file_id, status: 'queued', retry_count: 1,
      updated_at: '2026-10-25T01:00:00Z', message: 'waiting' })
    await settle()
  })
  const saved = JSON.parse(sessionStorage.getItem('tessmora:upload-batch:a')!)
  assert.equal(saved.progress.files.length, 1)
  assert.equal(saved.progress.files[0].status, 'completed')
  assert.equal(saved.progress.files[0].updated_at, '2026-10-25T03:00:00Z')
  assert.equal(saved.progress.files[0].failed_stage, undefined)
  assert.equal(saved.progress.completed, 1)
  assert.equal(saved.progress.failed, 0)
  assert.equal(panel().dataset.busy, 'false')
  assert.doesNotMatch(panel().textContent!, /waiting|文本索引生成超时/)
})

test('existing materials own the first screen; add routes disclose without replacing the upload input', async () => {
  const { act, render, files } = await setup()
  files.a = [{ id: 'photo', name: '庭院.jpg', type: 'jpg', size: 100, date: '', status: 'completed' }]
  await render('a')
  const input = container.querySelector('input[type="file"]')!
  const disclosure = container.querySelector('.knowledge-detail-navigation__add') as HTMLButtonElement
  assert.equal(disclosure.getAttribute('aria-expanded'), 'false')
  assert.ok(input.closest('[hidden]'))
  assert.equal(container.querySelector('.knowledge-detail-materials')?.hasAttribute('hidden'), false)
  assert.equal(container.querySelector('[aria-label="知识库画像概览"]'), null, 'topic requests stay off the material first screen')
  await act(async () => disclosure.click())
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true')
  assert.equal(container.querySelector('input[type="file"]'), input, 'expanding keeps input and upload ownership')
  assert.equal(input.closest('[hidden]'), null)
  assert.equal(container.querySelectorAll('.upload-source').length, 5, 'all six ingestion routes remain: upload plus five sources')
  await act(async () => disclosure.click())
  assert.equal(input.closest('[hidden]') != null, true)
  await render('b')
  assert.equal(container.querySelector('.knowledge-detail-navigation__add'), null, 'empty spaces retain a fully visible upload entrance')
  assert.equal(container.querySelector('input[type="file"]')?.closest('[hidden]'), null)
})

test('material and topic navigation provides keyboard selection, panels and retained material filters', async () => {
  const { act, render, files } = await setup()
  files.a = [{ id: 'photo', name: '庭院.jpg', type: 'jpg', size: 100, date: '', status: 'completed' }]
  await render('a')
  const imageFilter = [...container.querySelectorAll<HTMLButtonElement>('.knowledge-overview__filter')].find(button => button.textContent?.includes('图片'))!
  await act(async () => imageFilter.click())
  const [materials, topics] = [...container.querySelectorAll<HTMLButtonElement>('.knowledge-detail-navigation [role="tab"]')]
  await act(async () => { materials.focus(); materials.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await settle() })
  assert.equal(document.activeElement, topics)
  assert.equal(topics.getAttribute('aria-selected'), 'true')
  assert.equal(container.querySelector('.knowledge-detail-materials')?.hasAttribute('hidden'), true)
  assert.equal(container.querySelector('.knowledge-detail-topics')?.hasAttribute('hidden'), false)
  assert.equal(document.getElementById(topics.getAttribute('aria-controls')!)?.getAttribute('aria-labelledby'), topics.id)
  await act(async () => { topics.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle() })
  assert.equal(document.activeElement, materials)
  assert.equal(materials.getAttribute('aria-selected'), 'true')
  assert.equal(container.querySelector('.knowledge-detail-materials')?.hasAttribute('hidden'), false)
  assert.equal(imageFilter.getAttribute('aria-pressed'), 'true', 'returning to materials retains the chosen filter')
})

test('preview traverses the current filtered available materials with bounded arrows and one close control', async () => {
  const { act, render, files } = await setup()
  files.a = [
    { id: 'garden-a', name: '庭院-a.jpg', type: 'jpg', size: 100, date: '', status: 'completed' },
    { id: 'processing:unsaved', name: '庭院-未保存.jpg', type: 'jpg', size: 100, date: '', status: 'failed', storage_persisted: false },
    { id: 'garden-b', name: '庭院-b.jpg', type: 'jpg', size: 100, date: '', status: 'completed' },
    { id: 'recording', name: '访谈.mp3', type: 'mp3', size: 100, date: '', status: 'completed' },
  ]
  await render('a')
  const images = [...container.querySelectorAll<HTMLButtonElement>('.knowledge-overview__filter')].find(button => button.textContent?.includes('图片'))!
  await act(async () => images.click())
  const first = container.querySelector('[aria-label="预览文件：庭院-a.jpg"]') as HTMLButtonElement
  await act(async () => { first.focus(); first.click(); await settle() })
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement
  assert.ok(dialog)
  const previous = () => dialog.querySelector('[aria-label="上一个素材"]') as HTMLButtonElement
  const next = () => dialog.querySelector('[aria-label="下一个素材"]') as HTMLButtonElement
  assert.equal(previous().disabled, true)
  assert.equal(next().disabled, false)
  assert.equal(dialog.querySelectorAll('[aria-label^="关闭文件预览"]').length, 1)
  assert.equal(dialog.querySelector('.file-preview-navigation__position')?.getAttribute('aria-label'), '第 1 个素材，共 2 个')
  await act(async () => { next().click(); await settle() })
  assert.match(dialog.querySelector('[id$="file-preview-title"]')?.textContent ?? '', /庭院-b/)
  assert.equal(next().disabled, true)
  const boundary = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  await act(async () => dialog.dispatchEvent(boundary))
  assert.equal(boundary.defaultPrevented, false)
  await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await settle() })
  assert.match(dialog.querySelector('[id$="file-preview-title"]')?.textContent ?? '', /庭院-a/)
  await act(async () => { (dialog.querySelector('[aria-label^="关闭文件预览"]') as HTMLButtonElement).click(); await settle() })
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('preview arrow navigation leaves media, editable controls and tab navigation to their own handlers', async () => {
  const { act, render, files } = await setup()
  files.a = ['a', 'b'].map(id => ({ id, name: `${id}.jpg`, type: 'jpg', size: 100, date: '', status: 'completed' }))
  await render('a')
  await act(async () => { (container.querySelector('.resource-files__gallery button') as HTMLButtonElement).click(); await settle() })
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement
  for (const markup of ['<input type="range">', '<textarea></textarea>', '<video controls></video>', '<audio controls></audio>', '<div contenteditable="true"></div>', '<div role="slider"></div>', '<div role="tablist"><button>tab</button></div>']) {
    const fixture = document.createElement('div')
    fixture.innerHTML = markup
    dialog.append(fixture)
    const target = fixture.querySelector('button') ?? fixture.firstElementChild!
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    await act(async () => { target.dispatchEvent(key); await settle() })
    assert.equal(key.defaultPrevented, false, markup)
    assert.match(dialog.querySelector('[id$="file-preview-title"]')?.textContent ?? '', /a.jpg/, markup)
    fixture.remove()
  }
})

test('rapid document and image switching preserves the reader and rejects late descriptions', async () => {
  const { act, render, files, knowledgeApi } = await setup()
  files.a = [
    { id: 'notes', name: 'notes.txt', type: 'txt', size: 100, date: '', status: 'completed' },
    { id: 'image-one', name: 'image-one.jpg', type: 'jpg', size: 100, date: '', status: 'completed', preview_url: '/one.jpg' },
    { id: 'image-two', name: 'image-two.jpg', type: 'jpg', size: 100, date: '', status: 'completed', preview_url: '/two.jpg' },
  ]
  const imageOne = deferred<Awaited<ReturnType<typeof knowledgeApi.getFilePreviewDetails>>>()
  const imageTwo = deferred<Awaited<ReturnType<typeof knowledgeApi.getFilePreviewDetails>>>()
  knowledgeApi.getFileTextContent = async () => ({ content: 'Document-only text from the first material.' })
  knowledgeApi.getFilePreviewDetails = async (_kb, id) => id === 'notes'
    ? { chunks: [{ index: 0, text: 'First document chunk' }] }
    : id === 'image-one' ? imageOne.promise : imageTwo.promise
  await render('a')
  await act(async () => { (container.querySelector('[aria-label="预览文件：notes.txt"]') as HTMLButtonElement).click(); await settle() })
  const dialog = document.querySelector('.file-preview-dialog') as HTMLElement
  const next = dialog.querySelector('[aria-label="下一个素材"]') as HTMLButtonElement
  const body = dialog.querySelector('.file-preview-dialog__body') as HTMLElement
  assert.match(body.textContent!, /Document-only/)
  body.scrollTop = 200
  await act(async () => { next.focus(); next.click(); await settle() })
  assert.equal(document.querySelector('.file-preview-dialog'), dialog, 'the dialog is never remounted during navigation')
  assert.equal(dialog.querySelector('[aria-label="下一个素材"]'), next)
  assert.equal(document.activeElement, next, 'navigation focus survives the cross-type switch')
  assert.equal(body.scrollTop, 0)
  assert.doesNotMatch(body.textContent!, /Document-only|First document chunk/)
  assert.equal(dialog.querySelector('[aria-label="预览方式"]'), null, 'document controls do not leak into the image preview')
  const firstStage = body.querySelector('.file-preview-media-stage')!
  const firstThumbnail = [...dialog.querySelectorAll('img')].find(image => !body.contains(image))!
  assert.equal(firstStage.getAttribute('data-state'), 'loading', 'the media stage exists before image decode')
  await act(async () => { next.click(); await settle() })
  const currentStage = body.querySelector('.file-preview-media-stage')!
  const currentThumbnail = [...dialog.querySelectorAll('img')].find(image => !body.contains(image))!
  assert.notEqual(currentStage, firstStage)
  assert.notEqual(currentThumbnail, firstThumbnail, 'the header cannot retain a decoded thumbnail from the previous image')
  assert.equal(currentThumbnail.getAttribute('src'), '/two.jpg')
  await act(async () => { imageOne.resolve({ description: 'Stale caption for image one' }); await settle() })
  assert.doesNotMatch(body.textContent!, /Stale caption/)
  assert.equal(body.querySelector('.file-preview-media-stage'), currentStage)
  await act(async () => { imageTwo.resolve({ description: 'Correct caption for image two', chunks: [{ index: 0, text: 'image OCR' }] }); await settle() })
  assert.match(body.textContent!, /Correct caption/)
  assert.equal(dialog.querySelector('[aria-label="预览方式"]'), null, 'an image response never inserts a redundant tab strip')
  assert.equal(body.querySelector('.file-preview-media-stage'), currentStage, 'description completion does not replace the media stage')
  await act(async () => { currentStage.querySelector('img')!.dispatchEvent(new Event('load')); await settle() })
  assert.equal(currentStage.getAttribute('data-state'), 'ready')
  assert.equal(document.querySelector('.file-preview-dialog'), dialog)
  assert.equal(dialog.querySelector('[aria-label="下一个素材"]'), next)
  assert.equal(dialog.querySelectorAll('[aria-label^="关闭文件预览"]').length, 1)
})

test('switching prefilled text previews resets their nested scroll without remounting navigation', async () => {
  const { act, render, files, knowledgeApi } = await setup()
  files.a = ['a', 'b'].map(id => ({ id, name: `${id}.txt`, type: 'txt', size: 100, date: '', status: 'completed',
    text_preview: `${id}\n${'Long preview text line\n'.repeat(150)}` }))
  knowledgeApi.getFileTextContent = () => new Promise(() => {})
  await render('a')
  await act(async () => { (container.querySelector('[aria-label="预览文件：a.txt"]') as HTMLButtonElement).click(); await settle() })
  const dialog = document.querySelector('.file-preview-dialog')!
  const previousScroll = dialog.querySelector('pre')!.parentElement!
  const next = dialog.querySelector('[aria-label="下一个素材"]') as HTMLButtonElement
  previousScroll.scrollTop = 157
  await act(async () => { next.click(); await settle() })
  const currentScroll = dialog.querySelector('pre')!.parentElement!
  assert.notEqual(currentScroll, previousScroll, 'a new material owns a new internal text scroller')
  assert.equal(currentScroll.scrollTop, 0)
  assert.match(currentScroll.textContent!, /^b\n/)
  assert.equal(document.querySelector('.file-preview-dialog'), dialog)
  assert.equal(dialog.querySelector('[aria-label="下一个素材"]'), next)
})
