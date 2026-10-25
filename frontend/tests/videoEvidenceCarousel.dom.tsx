import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { CitationReference } from '../src/types/sse'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const pauses = new WeakMap<HTMLMediaElement, number>()
dom.window.HTMLMediaElement.prototype.pause = function() { pauses.set(this, (pauses.get(this) || 0) + 1) }
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement
const citations: CitationReference[] = Array.from({ length: 6 }, (_, index) => ({
  id: `evidence-${index + 1}`, type: 'video', file_name: index < 3 ? 'one.mp4' : 'two.mp4',
  file_path: index < 3 ? 'videos/one.mp4' : 'videos/two.mp4', video_url: index < 3 ? '/one.mp4' : '/two.mp4',
  content: `片段描述 ${index + 1}`, start_sec: index * 10, end_sec: index * 10 + 5,
}))

async function setup() {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const { VideoEvidenceCarousel } = await import('../src/components/chat/VideoEvidenceCarousel')
  const { VideoPlayerWithSeek } = await import('../src/components/chat/VideoPlayerWithSeek')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = async (refs = citations) => act(async () => root!.render(<VideoEvidenceCarousel
    citations={refs} displayIndexByRefId={new Map(refs.map((ref, index) => [ref.id, index + 3]))}
    getVideoUrl={ref => ref.video_url || undefined}
    renderCitation={ref => <figure><button type="button">{ref.file_name}</button>
      <VideoPlayerWithSeek src={ref.video_url || ''} startSec={ref.start_sec} endSec={ref.end_sec} />
      <figcaption>{ref.content}</figcaption></figure>}
  />))
  await render()
  return { render, setLanguage }
}

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
  assert.ok(result, `Missing button: ${label}`)
  return result
}
async function click(element: HTMLButtonElement) { await act(async () => element.click()) }
function player() { return container.querySelector<HTMLVideoElement>('video[controls]')! }
function status() { return container.querySelector('[aria-live]')!.textContent }
async function event(element: Element, name: string) { await act(async () => { element.dispatchEvent(new Event(name, { bubbles: true })) }) }

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
})

test('switching and wrapping keep one interactive player, stop the previous one and update the reference', async () => {
  await setup()
  assert.equal(container.querySelector('.video-evidence-active')!.getAttribute('aria-label'), '第 1 个，共 6 个片段')
  assert.equal(container.querySelector('.video-evidence-heading'), null)
  assert.equal(container.querySelector('.video-evidence-all'), null)
  assert.equal(container.querySelector('.video-evidence-list'), null)
  assert.equal(container.querySelectorAll('video[controls]').length, 1)
  assert.equal(container.querySelectorAll('.video-evidence-side').length, 4)
  assert.equal(container.querySelector('.video-evidence-navigation'), null)
  assert.equal(container.querySelector('[data-segment-index]'), null)
  assert.equal(container.querySelectorAll('.video-evidence-stage > .video-evidence-arrow').length, 2)
  assert.ok(container.querySelector('[aria-live]')!.classList.contains('sr-only'))
  const first = player()
  await click(button('下一个视频片段'))
  assert.notEqual(player(), first)
  assert.ok(pauses.get(first))
  assert.match(status()!, /引用 \[4\].*00:10.*00:15/)
  await click(button('上一个视频片段'))
  await click(button('上一个视频片段'))
  assert.match(status()!, /引用 \[8\]/)
  assert.equal(player().getAttribute('src'), '/two.mp4')
  await click(button('下一个视频片段'))
  assert.match(status()!, /引用 \[3\]/)
})

test('metadata seeking works before canplay, pauses at the end and restarts the cited interval', async () => {
  await setup()
  await click(button('下一个视频片段'))
  const video = player()
  Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
  await event(video, 'loadedmetadata')
  assert.equal(video.currentTime, 10)
  Object.defineProperty(video, 'paused', { configurable: true, value: false })
  video.currentTime = 15.3
  await event(video, 'timeupdate')
  assert.equal(video.currentTime, 15)
  assert.ok(pauses.get(video))
  await event(video, 'play')
  assert.equal(video.currentTime, 10)
})

test('arrow and Home/End keys keep button focus and one player while native video keys remain untouched', async () => {
  await setup()
  const nextButton = button('下一个视频片段')
  nextButton.focus()
  await act(async () => { nextButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
  assert.equal(document.activeElement, nextButton)
  assert.match(status()!, /引用 \[4\]/)
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  player().dispatchEvent(key)
  assert.equal(key.defaultPrevented, false)
  assert.match(status()!, /引用 \[4\]/)
  await act(async () => { nextButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })) })
  assert.match(status()!, /引用 \[8\]/)
  assert.equal(document.activeElement, nextButton)
  assert.equal(container.querySelectorAll('video[controls]').length, 1)
  await act(async () => { nextButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })) })
  assert.match(status()!, /引用 \[3\]/)
  assert.equal(document.activeElement, nextButton)
  assert.equal(container.querySelectorAll('video[controls]').length, 1)
})

test('streamed updates preserve the current player and selection, and removal falls back safely', async () => {
  const { render, setLanguage } = await setup()
  await click(button('下一个视频片段'))
  const current = player()
  await render(citations.map(ref => ({ ...ref, content: `${ref.content}补充` })))
  assert.equal(player(), current)
  assert.match(status()!, /引用 \[4\]/)
  await act(async () => setLanguage('en-US'))
  assert.ok(button('Next video clip'))
  assert.match(status()!, /Reference \[4\]/)
  await render(citations.filter((_, index) => index !== 1))
  assert.notEqual(player(), current)
  assert.match(status()!, /Reference \[3\]/)
})

test('unavailable side previews retain labeled navigation and never autoplay', async () => {
  await setup()
  const preview = container.querySelector<HTMLVideoElement>('.video-evidence-side video')!
  assert.equal(preview.autoplay, false)
  assert.equal(preview.muted, true)
  const side = preview.closest('button')!
  await event(preview, 'error')
  assert.equal(side.querySelector('video'), null)
  assert.ok(side.getAttribute('aria-label'))
  await click(side)
  assert.equal(container.querySelectorAll('video[controls]').length, 1)
  assert.ok(document.activeElement?.classList.contains('video-evidence-arrow'))
})
