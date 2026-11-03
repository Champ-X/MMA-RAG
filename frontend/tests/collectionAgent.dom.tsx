/** Interaction and ownership checks; providers and ingestion are covered by backend tests. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { CollectionCandidate, CollectionRequest, CollectionRun } from '../src/services/collection'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
let root: Root | undefined
let container: HTMLDivElement
let restore: (() => void) | undefined
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
const settleFocus = () => new Promise(resolve => setTimeout(resolve, 20))
const dialog = () => document.querySelector<HTMLElement>('.collection-agent--dialog[role="dialog"]')
const options = () => document.querySelector<HTMLElement>('.collection-agent--options[role="dialog"]')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const candidate = (id: string, overrides: Partial<CollectionCandidate> = {}): CollectionCandidate => ({
  id, title: `Material ${id}`, url: `https://example.org/${id}`, source: 'tavily', kind: 'webpage',
  description: 'A useful original source', status: 'candidate', ...overrides,
})
const runFixture = (overrides: Partial<CollectionRun> = {}): CollectionRun => ({
  id: 'run-a', kb_id: 'a', prompt: 'Find original technical sources', mode: 'auto', max_items: 2,
  status: 'planning', candidates: [], counts: { found: 0, ready: 0, failed: 0, duplicate: 0, selected: 0 },
  warnings: [], created_at: '2026-10-29T01:00:00Z', updated_at: '2026-10-29T01:00:00Z', ...overrides,
})

async function setup(initial: CollectionRun[] = []) {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { act } = requireFrontend('react') as typeof import('react')
  const { CollectionAgent } = await import('../src/components/knowledge/CollectionAgent')
  const { collectionApi } = await import('../src/services/collection')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  const originals = { ...collectionApi }
  const requests: CollectionRequest[] = []
  const collected: Array<{ id: string; candidateIds: string[] }> = []
  const cancelled: string[] = []
  const retried: string[] = []
  const refreshed: string[] = []
  const activated: string[] = []
  const viewed: string[] = []
  collectionApi.capabilities = async () => ({ channels: { tavily: { configured: true, available: true, kinds: ['webpage', 'news'] } }, limits: { max_items: 20, max_search_calls: 4, max_total_bytes: 52428800 } })
  collectionApi.list = async kbId => ({ runs: initial.filter(run => run.kb_id === kbId) })
  collectionApi.get = async id => initial.find(run => run.id === id)!
  collectionApi.create = async body => { requests.push(body); return runFixture({ kb_id: body.kb_id, prompt: body.prompt, mode: body.mode, max_items: body.max_items }) }
  collectionApi.collect = async (id, candidateIds) => { collected.push({ id, candidateIds }); return runFixture({ status: 'collecting', updated_at: '2026-10-29T01:01:00Z' }) }
  collectionApi.cancel = async id => { cancelled.push(id); return runFixture({ status: 'cancelled', updated_at: '2026-10-29T01:01:00Z' }) }
  collectionApi.retry = async id => { retried.push(id); return runFixture({ status: 'collecting', updated_at: '2026-10-29T01:01:00Z' }) }
  restore = () => Object.assign(collectionApi, originals)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async (kbId = 'a') => act(async () => {
    root!.render(<CollectionAgent kbId={kbId} onImported={() => { refreshed.push(kbId) }} onActive={() => { activated.push(kbId) }} onViewCollected={() => { viewed.push(kbId) }} />)
    await settle()
    await settleFocus()
  })
  const setInput = async (selector: string, value: string) => act(async () => {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
    assert.ok(element, `input ${selector} exists`)
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const click = async (text: string) => {
    await act(async () => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
      assert.ok(button, `button ${text} exists`)
      button.focus()
      button.click()
      await settle()
    })
    // Radix schedules focus restoration after the closing render commits.
    await act(async () => { await settleFocus() })
  }
  const submit = async () => act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  })
  const openOptions = async () => act(async () => {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-expanded') !== null)!
    assert.ok(button, 'find options trigger exists')
    button.focus()
    if (button.getAttribute('aria-expanded') !== 'true') button.click()
    await settle()
    await settleFocus()
  })
  await render()
  return { act, render, setInput, click, submit, openOptions, collectionApi, setLanguage, requests, collected, cancelled, retried, refreshed, activated, viewed }
}

afterEach(async () => {
  const { act } = requireFrontend('react') as typeof import('react')
  await act(async () => { root?.unmount(); await settleFocus() })
  root = undefined
  container?.remove()
  restore?.()
  localStorage.clear()
})

test('one form submits the visible request and mode, with a stable key after an uncertain transport failure', async () => {
  const { act, click, setInput, submit, collectionApi, requests, openOptions } = await setup()
  await click('找参考图片')
  assert.ok(document.activeElement === container.querySelector('textarea'), `textarea should receive focus; found ${document.activeElement?.tagName}`)
  await openOptions()
  await setInput('input[name="max_items"]', '3')
  await act(async () => document.querySelector<HTMLInputElement>('input[value="review"]')!.click())
  let attempts = 0
  collectionApi.create = async body => {
    requests.push(body)
    if (attempts++ === 0) throw new Error('Temporary connection loss')
    return runFixture({ status: 'review', prompt: body.prompt, mode: body.mode, max_items: body.max_items })
  }
  await submit()
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Temporary connection loss/)
  await click('关闭任务弹窗')
  await submit()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].client_request_id, requests[1].client_request_id)
  assert.equal(requests[0].kb_id, 'a')
  assert.equal(requests[0].mode, 'review')
  assert.equal(requests[0].max_items, 3)
  assert.match(requests[0].prompt, /植物叶片/)
})

test('review exposes native checkboxes, respects the item limit, and collects only selected identities', async () => {
  const run = runFixture({ status: 'review', mode: 'review', candidates: [candidate('one'), candidate('two'), candidate('three')],
    counts: { found: 3, ready: 0, failed: 0, duplicate: 0, selected: 0 } })
  const { act, click, collected } = await setup([run])
  await click('查看任务')
  const checks = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  assert.equal(checks.length, 3)
  assert.deepEqual(checks.map(input => input.checked), [true, true, false])
  assert.equal(checks[2].disabled, true)
  await act(async () => checks[0].click())
  assert.equal(checks[2].disabled, false)
  await act(async () => checks[2].click())
  await click('收录所选素材')
  assert.deepEqual(collected, [{ id: run.id, candidateIds: ['two', 'three'] }])
  assert.match(dialog()!.textContent!, /正在收录与解析/)
})

test('search options use a separate popover, preserve settings, and restore focus on Escape', async () => {
  const { act, click, setInput, openOptions } = await setup()
  const trigger = container.querySelector<HTMLButtonElement>('.collection-agent__options-toggle')!
  assert.equal(options(), null)
  assert.ok(container.querySelector('.collection-agent__examples button'), 'examples remain directly available')
  await openOptions()
  assert.ok(options())
  assert.equal(container.contains(options()), false, 'settings must not expand the entry layout')
  assert.equal(options()!.getAttribute('aria-label'), '查找选项')
  await setInput('input[name="max_items"]', '3')
  await act(async () => document.querySelector<HTMLInputElement>('input[value="review"]')!.click())
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settleFocus()
  })
  await act(async () => { await settleFocus() })
  assert.equal(options(), null)
  assert.ok(document.activeElement === trigger, 'Escape returns focus to settings trigger')
  await openOptions()
  assert.equal(options()!.querySelector<HTMLInputElement>('input[name="max_items"]')!.value, '3')
  assert.equal(options()!.querySelector<HTMLInputElement>('input[value="review"]')!.checked, true)
  await click('找参考图片')
  assert.equal(options(), null)
  assert.ok(document.activeElement === container.querySelector('textarea'), 'choosing an example keeps focus in the input')
})

test('a limit edited in the popover remains validated after settings close', async () => {
  const { act, setInput, click, submit, openOptions, requests } = await setup()
  await setInput('textarea[name="prompt"]', 'Find original technical sources')
  await openOptions()
  await setInput('input[name="max_items"]', '21')
  await click('关闭查找选项')
  await submit()
  await act(async () => { await settleFocus() })
  assert.equal(requests.length, 0)
  assert.equal(dialog(), null)
  assert.ok(options(), 'invalid settings reopen for correction')
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /最多可收录 20 项素材/)
  assert.ok(document.activeElement === options()!.querySelector('input[name="max_items"]'))
  await setInput('input[name="max_items"]', '3')
  await click('关闭查找选项')
  await submit()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].max_items, 3)
  assert.equal(options(), null)
  assert.ok(dialog())
})

test('restored work polls to a real ready result, refreshes material, and can reveal the collected list', async () => {
  const run = runFixture({ status: 'collecting', candidates: [candidate('one', { status: 'processing' })] })
  const { act, collectionApi, refreshed, activated, click, viewed, cancelled } = await setup([run])
  assert.deepEqual(activated, ['a'])
  assert.equal(dialog(), null, 'restoring background work never interrupts the page')
  assert.equal(container.querySelector('.collection-agent__run'), null)
  await click('查看任务')
  assert.match(dialog()!.textContent!, /正在收录与解析/)
  await click('关闭任务弹窗')
  assert.equal(dialog(), null)
  assert.deepEqual(cancelled, [])
  collectionApi.get = async () => ({ ...run, status: 'completed', updated_at: '2026-10-29T01:01:00Z',
    candidates: [candidate('one', { status: 'ready', file_id: 'stored-one' })], counts: { found: 1, ready: 1, failed: 0, duplicate: 0, selected: 1 } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)); await settle() })
  assert.match(container.textContent!, /收录完成/)
  assert.equal(dialog(), null, 'background completion must not reopen the dialog')
  await click('查看任务')
  assert.match(dialog()!.textContent!, /已可检索/)
  assert.deepEqual(refreshed, ['a'])
  await click('查看已收录')
  assert.deepEqual(viewed, ['a'])
  assert.equal(dialog(), null, 'viewing collected material leaves the task dialog')
})

test('switching spaces aborts a pending submission and ignores its late receipt', async () => {
  const { click, submit, render, collectionApi, act, refreshed, openOptions } = await setup()
  await openOptions()
  const pending = deferred<CollectionRun>()
  let submissionSignal: AbortSignal | undefined
  collectionApi.create = async (_body, signal) => { submissionSignal = signal; return pending.promise }
  await click('搜集专题资料')
  await submit()
  assert.ok(dialog())
  await render('b')
  assert.equal(dialog(), null, 'the previous space cannot leave its task dialog open')
  assert.equal(submissionSignal?.aborted, true)
  await act(async () => {
    pending.resolve(runFixture({ status: 'completed', counts: { found: 1, ready: 1, failed: 0, duplicate: 0, selected: 1 } }))
    await settle()
  })
  assert.equal(container.querySelector('textarea')?.value, '')
  assert.equal(document.querySelector('.collection-agent__run'), null)
  assert.deepEqual(refreshed, [])
})

test('a restored partial result separates ready, duplicate, and failed items and retries the same task', async () => {
  const run = runFixture({ status: 'partial', candidates: [candidate('one', { status: 'ready' }), candidate('two', { status: 'duplicate' }), candidate('three', { status: 'failed', error: 'Source unavailable' })],
    counts: { found: 3, ready: 1, failed: 1, duplicate: 1, selected: 3 } })
  const { click, retried } = await setup([run])
  await click('查看任务')
  assert.equal(document.querySelectorAll('.collection-agent__candidate[data-status="ready"]').length, 1)
  assert.equal(document.querySelectorAll('.collection-agent__candidate[data-status="duplicate"]').length, 1)
  assert.match(dialog()!.textContent!, /Source unavailable/)
  await click('重试未完成项')
  assert.deepEqual(retried, ['run-a'])
})

test('a shortfall with no failed items refills the request instead of retrying a completed collection', async () => {
  const run = runFixture({ status: 'partial', candidates: [candidate('one', { status: 'ready' })],
    counts: { found: 1, ready: 1, failed: 0, duplicate: 0, selected: 1 } })
  const { click, retried, requests } = await setup([run])
  await click('查看任务')
  assert.doesNotMatch(dialog()!.textContent!, /重试未完成项/)
  await click('调整需求再查找')
  assert.equal(dialog(), null)
  assert.equal(container.querySelector('textarea')?.value, run.prompt)
  assert.ok(document.activeElement === container.querySelector('textarea'), `textarea should receive focus; found ${document.activeElement?.tagName}`)
  assert.deepEqual(retried, [])
  assert.deepEqual(requests, [], 'refining the draft does not launch another paid search')
})

test('review respects the interpreted target and keeps candidate-specific caveats inspectable', async () => {
  const run = runFixture({ status: 'review', mode: 'review', max_items: 5, plan: { target_count: 2 },
    candidates: [candidate('one', { warnings: ['Resolution has not been visually checked'] }), candidate('two'), candidate('three')],
    counts: { found: 3, ready: 0, failed: 0, duplicate: 0, selected: 0 } })
  const { act, click } = await setup([run])
  await click('查看任务')
  const checks = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  assert.equal(checks.filter(input => input.checked).length, 2)
  assert.equal(checks[2].disabled, true)
  assert.match(document.querySelector('.collection-agent__result-actions')!.textContent!, /已选 2 \/ 2 项/)
  const notes = document.querySelector<HTMLDetailsElement>('.collection-agent__candidate-notes')!
  assert.match(notes.textContent!, /Resolution has not been visually checked/)
  await act(async () => notes.querySelector('summary')!.click())
  assert.equal(notes.open, true)
})

test('stop is an explicit mutation and unsafe provider URLs cannot become executable links or image sources', async () => {
  const run = runFixture({ status: 'searching', candidates: [candidate('unsafe', { url: 'javascript:alert(1)', thumbnail_url: 'data:text/html,bad' })] })
  const { click, cancelled } = await setup([run])
  await click('查看任务')
  assert.equal(document.querySelector('a[href^="javascript:"]'), null)
  assert.equal(dialog()!.querySelector('img'), null)
  await click('停止任务')
  assert.deepEqual(cancelled, ['run-a'])
  assert.match(dialog()!.textContent!, /已停止查找/)
})

test('the same interaction has English labels and channel absence leaves link import available', async () => {
  const { setLanguage, act, collectionApi, render, openOptions } = await setup()
  collectionApi.capabilities = async () => ({ channels: {}, limits: { max_items: 20, max_search_calls: 4, max_total_bytes: 52428800 } })
  await act(async () => setLanguage('en-US'))
  await render('b')
  await openOptions()
  assert.match(container.textContent!, /Let Agent find it for you/)
  assert.match(options()!.textContent!, /Collect automatically/)
  assert.match(options()!.textContent!, /Review first/)
  assert.match(container.textContent!, /public webpage or file link/)
  assert.equal(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false)
})

test('unconnected web search stays explicit while open-web link import remains available', async () => {
  const { collectionApi, render, setLanguage, act } = await setup()
  collectionApi.capabilities = async () => ({
    channels: { open_web: { configured: true, available: true, kinds: ['webpage', 'news', 'document', 'image', 'audio', 'video'] } },
    limits: { max_items: 20, max_search_calls: 4, max_total_bytes: 52428800 },
  })
  await render('b')
  assert.match(container.textContent!, /全网搜索尚未连接/)
  assert.doesNotMatch(container.textContent!, /open_web|Tavily|SerpAPI/)
  assert.equal(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false)
  await act(async () => setLanguage('en-US'))
  assert.match(container.textContent!, /public webpage link with instructions/)
})

test('an arbitrary public URL plus instructions is submitted intact for discovery, without a site picker', async () => {
  const { setInput, submit, requests } = await setup()
  const prompt = '从 https://museum.example.org/exhibits 找介绍植物的 PDF 和音视频，请先让我选择'
  await setInput('textarea[name="prompt"]', prompt)
  await submit()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].prompt, prompt)
  assert.equal(container.querySelector('select[name="source"]'), null)
})

test('submitting opens a named dialog immediately and closing it does not abort the pending task', async () => {
  const { act, setInput, submit, click, collectionApi, cancelled } = await setup()
  const pending = deferred<CollectionRun>()
  let submissionSignal: AbortSignal | undefined
  collectionApi.create = async (_body, signal) => { submissionSignal = signal; return pending.promise }
  await setInput('textarea[name="prompt"]', 'Find original technical sources')
  assert.equal(dialog(), null)
  await submit()
  const opened = dialog()
  assert.ok(opened, 'the pending request is visible before the server returns')
  assert.equal(container.contains(opened), false, 'task details use a portal outside the inline input')
  assert.equal(opened.getAttribute('aria-modal'), 'true')
  assert.equal(document.getElementById(opened.getAttribute('aria-labelledby')!)?.textContent, '素材查找任务')
  assert.ok(document.getElementById(opened.getAttribute('aria-describedby')!)?.textContent)
  assert.match(opened.textContent!, /正在提交/)
  await click('关闭任务弹窗')
  assert.equal(dialog(), null)
  assert.equal(submissionSignal?.aborted, false)
  assert.deepEqual(cancelled, [])
  await act(async () => {
    pending.resolve(runFixture({ status: 'review', candidates: [candidate('one')] }))
    await settle()
  })
  assert.equal(dialog(), null, 'a late receipt must not reopen a dismissed dialog')
  assert.equal(container.querySelector('.collection-agent__candidates'), null)
  await click('查看任务')
  assert.match(dialog()!.textContent!, /Material one/)
})

test('Escape returns focus to the task entry and reopening preserves the candidate selection', async () => {
  const run = runFixture({ status: 'review', mode: 'review', candidates: [candidate('one'), candidate('two'), candidate('three')] })
  const { act, click, cancelled } = await setup([run])
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查看任务')!
  await click('查看任务')
  const checks = [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  await act(async () => { checks[0].click(); await settle() })
  await act(async () => { checks[2].click(); await settle() })
  assert.deepEqual(checks.map(input => input.checked), [false, true, true])
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settleFocus()
  })
  await settleFocus()
  assert.equal(dialog(), null)
  assert.ok(document.activeElement === entry, 'Escape should return focus to the task entry')
  assert.deepEqual(cancelled, [])
  await click('查看任务')
  assert.deepEqual([...dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input => input.checked), [false, true, true])
})

test('restored history stays compact until requested and selecting history updates only the dialog', async () => {
  const run = runFixture({ status: 'completed', candidates: [candidate('one', { status: 'ready' })] })
  const older = runFixture({ id: 'run-old', status: 'failed', prompt: 'An earlier search', created_at: '2026-10-28T01:00:00Z', candidates: [candidate('old', { status: 'failed' })] })
  const { act, click } = await setup([run, older])
  assert.equal(dialog(), null)
  assert.equal(document.querySelector('select[name="collection_run"]'), null)
  assert.equal(document.querySelector('.collection-agent__candidates'), null)
  assert.doesNotMatch(container.textContent!, /Material one|Material old|An earlier search/)
  await click('查看任务')
  const history = dialog()!.querySelector<HTMLSelectElement>('select[name="collection_run"]')!
  assert.ok(history)
  await act(async () => {
    history.value = older.id
    history.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  })
  assert.match(dialog()!.textContent!, /Material old/)
  assert.doesNotMatch(container.textContent!, /Material old/)
})

test('open-site document, audio, and video candidates retain page provenance and original-file access', async () => {
  const pageUrl = 'https://museum.example.org/exhibits'
  const run = runFixture({ status: 'review', mode: 'review', max_items: 3,
    plan: { summary: '从公开页面找到的素材', review_required_reason: '请先检查素材是否符合用途' },
    candidates: ['document', 'audio', 'video'].map((kind, index) => candidate(kind, {
      source: 'open_web', kind, url: pageUrl, download_url: `https://cdn.example.org/files/${index}.${['pdf', 'mp3', 'mp4'][index]}`,
    })), counts: { found: 3, ready: 0, failed: 0, duplicate: 0, selected: 0 },
  })
  const { click } = await setup([run])
  await click('查看任务')
  assert.equal(document.querySelectorAll(`a[href="${pageUrl}"]`).length, 3)
  assert.equal(document.querySelectorAll('.collection-agent__original-file').length, 3)
  assert.match(dialog()!.textContent!, /PDF 候选 · museum.example.org/)
  assert.match(dialog()!.textContent!, /音频 · museum.example.org/)
  assert.match(dialog()!.textContent!, /视频 · museum.example.org/)
  assert.match(dialog()!.textContent!, /请先检查素材是否符合用途/)
  assert.doesNotMatch(dialog()!.textContent!, /open_web/)
})

test('paper candidates distinguish found PDF links from verified collection and unresolved webpages', async () => {
  const pageUrl = 'https://arxiv.org/abs/2609.26457'
  const pdfUrl = 'https://arxiv.org/pdf/2609.26457'
  const run = runFixture({ status: 'partial', candidates: [
    candidate('pending', { kind: 'document', required_format: 'pdf', material_intent: 'paper', url: pageUrl, download_url: pdfUrl }),
    candidate('ready', { kind: 'document', required_format: 'pdf', material_intent: 'paper', url: pageUrl, download_url: pdfUrl, status: 'ready' }),
    candidate('unresolved', { kind: 'webpage', required_format: 'pdf', material_intent: 'paper', status: 'failed', error: '未找到论文 PDF' }),
    candidate('unsafe', { kind: 'document', required_format: 'pdf', download_url: 'javascript:alert(1)' }),
    candidate('legacy', { kind: 'document', status: 'ready', download_url: 'https://example.org/paper.pdf' }),
  ] })
  const { click } = await setup([run])
  await click('查看任务')
  const rows = [...document.querySelectorAll('.collection-agent__candidate')]
  assert.match(rows[0].querySelector('.collection-agent__candidate-meta')!.textContent!, /^PDF 候选 ·/)
  assert.match(rows[1].querySelector('.collection-agent__candidate-meta')!.textContent!, /^PDF ·/)
  assert.match(rows[2].querySelector('.collection-agent__candidate-meta')!.textContent!, /^网页 ·/)
  assert.match(rows[3].querySelector('.collection-agent__candidate-meta')!.textContent!, /^文档 ·/)
  assert.match(rows[4].querySelector('.collection-agent__candidate-meta')!.textContent!, /^文档 ·/)
  for (const row of rows.slice(0, 2)) {
    assert.equal(row.querySelector<HTMLAnchorElement>('.collection-agent__candidate-title a')!.href, pageUrl)
    const pdfLink = row.querySelector<HTMLAnchorElement>('.collection-agent__original-file')!
    assert.equal(pdfLink.href, pdfUrl)
    assert.equal(pdfLink.textContent, '打开 PDF 原文')
    assert.match(pdfLink.getAttribute('aria-label')!, /^打开 PDF 原文：Material /)
    assert.equal(pdfLink.rel, 'noopener noreferrer')
  }
  assert.equal(rows[2].querySelector('.collection-agent__original-file'), null)
  assert.equal(rows[3].querySelector('.collection-agent__original-file'), null)
  assert.equal(rows[4].querySelector('.collection-agent__original-file')!.textContent, '查看原始文件')
})
