import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const pauses = new WeakMap<HTMLMediaElement, number>()
const playing = new WeakSet<HTMLMediaElement>()
Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !playing.has(this) } })
dom.window.HTMLMediaElement.prototype.play = async function() {
  playing.add(this)
  this.dispatchEvent(new Event('play'))
}
dom.window.HTMLMediaElement.prototype.pause = function() {
  pauses.set(this, (pauses.get(this) || 0) + 1)
  playing.delete(this)
  this.dispatchEvent(new Event('pause'))
}

const observers = new Set<MockResizeObserver>()
class MockResizeObserver {
  target?: Element
  constructor(readonly callback: () => void) { observers.add(this) }
  observe(target: Element) { this.target = target }
  disconnect() { observers.delete(this) }
}
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver })

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement

async function setup() {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  const components = await import('../src/components/chat/MediaEvidenceCard')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = async (node: React.ReactNode) => act(async () => root!.render(node))
  return { ...components, render }
}

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
  assert.ok(result, `Missing button: ${label}`)
  return result
}
async function event(element: Element, name: string) {
  await act(async () => { element.dispatchEvent(new Event(name, { bubbles: true })) })
}
async function click(element: HTMLButtonElement) { await act(async () => element.click()) }

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  assert.equal(observers.size, 0, 'Resize observers must disconnect on unmount')
})

test('audio metadata, playback and seeking stay synchronized with accessible controls', async () => {
  const { InlineAudioPlayer, render } = await setup()
  await render(<InlineAudioPlayer src="/music.mp3" label="音频引用 9" />)
  const audio = container.querySelector('audio')!
  const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
  assert.equal(audio.autoplay, false)
  assert.equal(range.disabled, true)
  Object.defineProperty(audio, 'duration', { configurable: true, value: 370 })
  await event(audio, 'loadedmetadata')
  assert.equal(range.disabled, false)
  assert.equal(range.max, '370')
  assert.equal(range.getAttribute('aria-valuetext'), '0:00 / 6:10')

  await click(button('播放音频引用 9'))
  assert.equal(audio.paused, false)
  assert.ok(button('暂停音频引用 9'))
  audio.currentTime = 65
  await event(audio, 'timeupdate')
  assert.equal(range.value, '65')
  assert.equal(range.getAttribute('aria-valuetext'), '1:05 / 6:10')

  // Bypass React's value tracker, as a native user input event would.
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
  setValue.call(range, '92.5')
  await event(range, 'input')
  assert.equal(audio.currentTime, 92.5)
  assert.equal(range.getAttribute('aria-valuetext'), '1:32 / 6:10')
  await click(button('暂停音频引用 9'))
  assert.equal(audio.paused, true)
  assert.ok(button('播放音频引用 9'))

  Object.defineProperty(audio, 'duration', { configurable: true, value: 400 })
  await event(audio, 'durationchange')
  assert.equal(range.max, '400')
  assert.equal(range.getAttribute('aria-valuetext'), '1:32 / 6:40')
})

test('changing an audio source resets its transport and both replacement and unmount pause it', async () => {
  const { InlineAudioPlayer, render } = await setup()
  await render(<InlineAudioPlayer src="/one.mp3" label="音频引用 1" />)
  const audio = container.querySelector('audio')!
  Object.defineProperty(audio, 'duration', { configurable: true, value: 120 })
  await event(audio, 'loadedmetadata')
  await click(button('播放音频引用 1'))
  audio.currentTime = 35
  await event(audio, 'timeupdate')
  await render(<InlineAudioPlayer src="/two.mp3" label="音频引用 2" />)
  assert.equal(audio.getAttribute('src'), '/two.mp3')
  assert.equal(audio.paused, true)
  assert.ok(pauses.get(audio))
  assert.ok(button('播放音频引用 2'))
  const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
  assert.equal(range.disabled, true)
  assert.equal(range.value, '0')

  const beforeUnmount = pauses.get(audio)!
  await act(async () => { root!.unmount(); root = undefined })
  assert.equal(pauses.get(audio), beforeUnmount + 1)
})

test('audio mute control and native volume changes keep pressed state and labels accurate', async () => {
  const { InlineAudioPlayer, render } = await setup()
  await render(<InlineAudioPlayer src="/music.mp3" label="音频引用 9" />)
  const audio = container.querySelector('audio')!
  const mute = button('静音')
  assert.equal(audio.muted, false)
  assert.equal(mute.getAttribute('aria-pressed'), 'false')
  await click(mute)
  assert.equal(audio.muted, true)
  assert.equal(button('取消静音'), mute)
  assert.equal(mute.getAttribute('aria-pressed'), 'true')
  await click(mute)
  assert.equal(audio.muted, false)
  assert.equal(button('静音'), mute)
  assert.equal(mute.getAttribute('aria-pressed'), 'false')

  await act(async () => {
    audio.muted = true
    audio.dispatchEvent(new Event('volumechange'))
  })
  assert.ok(button('取消静音'))
  assert.equal(mute.getAttribute('aria-pressed'), 'true')
})

test('overflowing source descriptions expose a linked disclosure and short text needs none', async () => {
  const { MediaEvidenceDescription, render } = await setup()
  const content = '画面描述与语音转写。'.repeat(20)
  await render(<figure><MediaEvidenceDescription content={content} accent="video" /></figure>)
  const text = container.querySelector<HTMLElement>('figcaption span')!
  Object.defineProperties(text, {
    clientHeight: { configurable: true, value: 44 },
    scrollHeight: { configurable: true, value: 180 },
  })
  await act(async () => { for (const observer of observers) observer.callback() })
  const toggle = button('展开')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(document.getElementById(toggle.getAttribute('aria-controls')!), text)
  await click(toggle)
  assert.equal(button('收起'), toggle)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(text.textContent, content)
  await click(toggle)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')

  Object.defineProperty(text, 'scrollHeight', { configurable: true, value: 44 })
  await render(<figure><MediaEvidenceDescription content="简短说明" accent="video" /></figure>)
  assert.equal(container.querySelector('button'), null)
  assert.match(container.textContent!, /简短说明/)
})

test('explicit video source sections keep distinct text and keyboard-accessible tab selection', async () => {
  const { MediaEvidenceDescription, render } = await setup()
  const visualText = '男子抬头看向门口，窗外的雨水清晰可见。'
  const transcriptText = 'Tommy... The past is not my concern.\n保留这一行中文原始转写。'
  await render(<figure><MediaEvidenceDescription
    content={`索引画面描述：${visualText}\n语音转写：${transcriptText}`} accent="video" /></figure>)
  const visual = button('画面摘要')
  const transcript = button('语音转写')
  const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!
  assert.equal(container.querySelectorAll('[role="tab"]').length, 2)
  assert.equal(visual.getAttribute('aria-selected'), 'true')
  assert.equal(transcript.getAttribute('aria-selected'), 'false')
  assert.equal(visual.tabIndex, 0)
  assert.equal(transcript.tabIndex, -1)
  assert.equal(visual.getAttribute('aria-controls'), panel.id)
  assert.equal(panel.getAttribute('aria-labelledby'), visual.id)
  assert.equal(panel.textContent, visualText)

  await click(transcript)
  assert.equal(panel.textContent, transcriptText)
  assert.equal(panel.getAttribute('aria-labelledby'), transcript.id)
  assert.equal(transcript.getAttribute('aria-selected'), 'true')
  await click(visual)
  assert.equal(panel.textContent, visualText)

  visual.focus()
  const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  await act(async () => { visual.dispatchEvent(right) })
  assert.equal(right.defaultPrevented, true)
  assert.equal(document.activeElement, transcript)
  assert.equal(visual.getAttribute('aria-selected'), 'false')
  assert.equal(transcript.getAttribute('aria-selected'), 'true')
  assert.equal(visual.tabIndex, -1)
  assert.equal(transcript.tabIndex, 0)
  assert.equal(panel.textContent, transcriptText)

  const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
  await act(async () => { transcript.dispatchEvent(home) })
  assert.equal(home.defaultPrevented, true)
  assert.equal(document.activeElement, visual)
  assert.equal(visual.getAttribute('aria-selected'), 'true')
  assert.equal(transcript.getAttribute('aria-selected'), 'false')
  assert.equal(panel.getAttribute('aria-labelledby'), visual.id)
  assert.equal(panel.textContent, visualText)
})

test('media source headers retain full names, reference identity and the source-opening target', async () => {
  const { MediaEvidenceHeader, render } = await setup()
  const fileName = '一段不会在数据中被截断的完整中文视频文件名称_浴血黑帮不朽传奇.mp4'
  let opened: HTMLElement | undefined
  await render(<MediaEvidenceHeader kind="video" fileName={fileName} displayNumber={5}
    segmentLabel="片段 1:22 - 1:34" onOpen={event => { opened = event.currentTarget }} />)
  const source = button(`打开视频引用 5：${fileName}`)
  assert.ok(source.textContent!.includes(fileName))
  assert.ok(source.textContent!.includes('[5]'))
  assert.ok(source.textContent!.includes('片段 1:22 - 1:34'))
  assert.equal(source.querySelector('[title]')!.getAttribute('title'), fileName)
  await click(source)
  assert.equal(opened, source)
  const storedName = '9d2a8a85-8377-4064-997d-3622ba6e7831_水墨兰亭.mp3'
  await render(<MediaEvidenceHeader kind="audio" fileName={storedName} displayNumber={1} onOpen={() => {}} />)
  assert.equal(container.querySelector('.media-card-title')!.textContent, '水墨兰亭')
  assert.ok(button(`打开音频引用 1：${storedName}`).textContent!.includes(storedName))
})
