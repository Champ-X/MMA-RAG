import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'
import type { Root } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fetched: { src: string; signal: AbortSignal }[] = []
const decodes: { rate: number; finish: () => void }[] = []
class OfflineContextMock {
  constructor(_channels: number, _length: number, readonly sampleRate: number) {}
  decodeAudioData() {
    return new Promise(resolve => decodes.push({ rate: this.sampleRate, finish: () => resolve({
      length: 192, numberOfChannels: 1, getChannelData: () => new Float32Array(192).fill(0.5),
    }) }))
  }
}
Object.defineProperty(dom.window, 'OfflineAudioContext', { configurable: true, value: OfflineContextMock })
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (src: string, options: RequestInit) => {
  fetched.push({ src, signal: options.signal! })
  return new Response(new Uint8Array([1, 2, 3]))
} })

const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
let root: Root | undefined
let container: HTMLDivElement
let useAudioWaveform: typeof import('../src/components/chat/useAudioWaveform')['useAudioWaveform']

function Probe({ id, src, enabled = true }: { id: string; src: string; enabled?: boolean }) {
  const peaks = useAudioWaveform(src, enabled)
  return <output data-testid={id}>{peaks ? JSON.stringify(peaks) : 'fallback'}</output>
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
async function setup() {
  const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')
  ;({ useAudioWaveform } = await import('../src/components/chat/useAudioWaveform'))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return async (node: React.ReactNode) => act(async () => { root!.render(node); await flush() })
}

afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined })
  await act(async () => { for (const decode of decodes.splice(0)) decode.finish(); await flush() })
  container?.remove()
  fetched.length = 0
  Object.defineProperty(dom.window, 'OfflineAudioContext', { configurable: true, value: OfflineContextMock })
})

test('waveforms share same-source work, serialize decodes, cancel abandoned work and reuse cached peaks', async () => {
  const render = await setup()
  await render(<><Probe key="a1" id="a1" src="/shared.mp3" /><Probe key="a2" id="a2" src="/shared.mp3" /><Probe key="b" id="b" src="/queued.mp3" /></>)
  await act(flush)
  assert.equal(fetched.length, 1)
  assert.equal(decodes.length, 1)
  assert.equal(decodes[0].rate, 8000)
  await render(<><Probe key="a2" id="a2" src="/shared.mp3" /><Probe key="b" id="b" src="/queued.mp3" /></>)
  assert.equal(fetched[0].signal.aborted, false, 'A remaining subscriber keeps shared work alive')

  await act(async () => { decodes.shift()!.finish(); await flush() })
  assert.equal(fetched.length, 2, 'The queued source only starts after the first decode finishes')
  assert.equal(decodes.length, 1)
  const peaks = JSON.parse(container.querySelector('[data-testid="a2"]')!.textContent!) as number[]
  assert.equal(peaks.length, 96)
  assert.ok(peaks.every(peak => peak === 1))
  await render(null)
  assert.equal(fetched[1].signal.aborted, true, 'The last subscriber cancels its request')
  await act(async () => { decodes.shift()!.finish(); await flush() })

  await render(<Probe id="cached" src="/shared.mp3" />)
  assert.equal(fetched.length, 2)
  assert.deepEqual(JSON.parse(container.querySelector('output')!.textContent!), peaks)
})

test('disabled cards and unsupported offline decoding make no waveform request', async () => {
  const render = await setup()
  await render(<Probe id="hidden" src="/hidden.mp3" enabled={false} />)
  assert.equal(fetched.length, 0)
  assert.equal(container.textContent, 'fallback')
  Object.defineProperty(dom.window, 'OfflineAudioContext', { configurable: true, value: undefined })
  await render(<Probe id="unsupported" src="/unsupported.mp3" />)
  assert.equal(fetched.length, 0)
  assert.equal(container.textContent, 'fallback')
})
