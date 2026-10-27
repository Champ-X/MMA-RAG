import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'
import type { AudioPreviewPlayerProps } from '../src/components/ui/AudioPreviewPlayer'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLMediaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const pauses = new WeakMap<HTMLMediaElement, number>()
const loads = new WeakMap<HTMLMediaElement, number>()
Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return this.dataset.playing !== 'true' } })
HTMLMediaElement.prototype.play = async function () {
  this.dataset.playing = 'true'
  this.dispatchEvent(new Event('play'))
}
HTMLMediaElement.prototype.pause = function () {
  pauses.set(this, (pauses.get(this) || 0) + 1)
  this.dataset.playing = 'false'
  this.dispatchEvent(new Event('pause'))
}
HTMLMediaElement.prototype.load = function () { loads.set(this, (loads.get(this) || 0) + 1) }
let root: Root | undefined
let container: HTMLDivElement

async function setup(props: AudioPreviewPlayerProps = { src: '/first.mp3', title: '第一首.mp3' }) {
  const { AudioPreviewPlayer } = await import('../src/components/ui/AudioPreviewPlayer')
  const { setLanguage } = await import('../src/i18n')
  setLanguage('zh-CN')
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = async (next = props) => act(async () => root!.render(<AudioPreviewPlayer {...next} />))
  await render()
  return render
}

function button(label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)! }
function audio() { return container.querySelector('audio')! }
async function metadata(duration = 159) {
  Object.defineProperty(audio(), 'duration', { configurable: true, value: duration })
  await act(async () => audio().dispatchEvent(new Event('loadedmetadata')))
}
async function changeRange(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
}

afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); root = undefined })

test('audio controls reflect media time, seek directly, and handle play and pause', async () => {
  await setup()
  assert.equal(audio().getAttribute('preload'), 'metadata')
  assert.equal(audio().autoplay, false)
  assert.equal(container.querySelector<HTMLInputElement>('.audio-preview-player__seek')!.disabled, true)
  await metadata()
  assert.match(container.textContent!, /2:39/)
  await act(async () => button('播放音频').click())
  assert.ok(button('暂停音频'))
  await changeRange('.audio-preview-player__seek', '60')
  assert.equal(audio().currentTime, 60)
  assert.match(container.querySelector('.audio-preview-player__time')!.textContent!, /1:00/)
  await act(async () => button('暂停音频').click())
  assert.ok(button('播放音频'))
  assert.equal(audio().paused, true)
})

test('changing tracks stops old playback and clears its timing before the next metadata arrives', async () => {
  const render = await setup()
  await metadata()
  await act(async () => button('播放音频').click())
  const oldAudio = audio()
  await render({ src: '/second.mp3', title: '第二首.mp3' })
  assert.notEqual(audio(), oldAudio)
  assert.equal(oldAudio.paused, true)
  assert.ok((pauses.get(oldAudio) || 0) >= 1)
  assert.equal(audio().getAttribute('src'), '/second.mp3')
  assert.equal(audio().currentTime, 0)
  assert.doesNotMatch(container.textContent!, /2:39|第一首/)
  assert.equal(container.querySelector<HTMLInputElement>('.audio-preview-player__seek')!.disabled, true)
})

test('playback can be cancelled while buffering without surfacing an obsolete play error', async () => {
  await setup()
  let rejectPlay: (error: Error) => void = () => undefined
  audio().play = function () {
    this.dataset.playing = 'true'
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('waiting'))
    return new Promise<void>((_, reject) => { rejectPlay = reject })
  }
  await act(async () => button('播放音频').click())
  assert.equal(button('暂停音频').disabled, false)
  await act(async () => button('暂停音频').click())
  assert.equal(audio().paused, true)
  await act(async () => rejectPlay(new DOMException('Playback cancelled', 'AbortError')))
  assert.equal(button('播放音频').disabled, false)
  assert.equal(container.querySelector('[role="status"]'), null)
})

test('media failures reach the caller and a retry reloads without autoplay', async () => {
  let errors = 0
  await setup({ src: '/retry.mp3', onError: () => { errors += 1 } })
  await act(async () => audio().dispatchEvent(new Event('error')))
  assert.equal(errors, 1)
  assert.equal(button('播放音频').disabled, true)
  assert.match(container.querySelector('[role="status"]')!.textContent!, /音频暂时无法加载/)
  await act(async () => container.querySelector<HTMLButtonElement>('.audio-preview-player__notice button')!.click())
  assert.equal(loads.get(audio()), 1)
  assert.equal(audio().paused, true)
  assert.equal(button('播放音频').disabled, false)
  assert.equal(container.querySelector('[role="status"]'), null)
})

test('rejected play promises leave a recoverable control and mute is reflected in accessible state', async () => {
  await setup()
  audio().play = async () => { throw new Error('Autoplay is unavailable') }
  await act(async () => button('播放音频').click())
  assert.match(container.querySelector('[role="status"]')!.textContent!, /未能开始播放/)
  assert.equal(button('播放音频').disabled, false)
  await act(async () => button('静音').click())
  assert.equal(audio().muted, true)
  assert.equal(button('取消静音').getAttribute('aria-pressed'), 'true')
  await act(async () => button('取消静音').click())
  assert.equal(audio().muted, false)
  await changeRange('.audio-preview-player__volume-slider', '0.5')
  assert.equal(audio().volume, 0.5)
})
