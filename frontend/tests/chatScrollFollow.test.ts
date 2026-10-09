import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachChatScrollFollow } from '../src/lib/chatScrollFollow'

class ScrollViewport extends EventTarget {
  scrollTop = 0
  scrollHeight = 1000
  clientHeight = 400
  ownerDocument = { defaultView: new EventTarget() }
}

function frames() {
  let nextId = 0
  const pending = new Map<number, FrameRequestCallback>()
  return {
    pending,
    requestFrame(callback: FrameRequestCallback) { const id = nextId++; pending.set(id, callback); return id },
    cancelFrame(id: number) { pending.delete(id) },
    flush() {
      const current = [...pending.values()]
      pending.clear()
      current.forEach(callback => callback(0))
    },
  }
}

function setup() {
  const viewport = new ScrollViewport()
  const content = new EventTarget()
  const scheduler = frames()
  let changed = () => {}
  let disconnected = false
  const follower = attachChatScrollFollow(viewport as unknown as HTMLElement, content as HTMLElement, {
    ...scheduler,
    observeSizes(observedViewport, observedContent, callback) {
      assert.equal(observedViewport, viewport)
      assert.equal(observedContent, content)
      changed = callback
      return () => { disconnected = true }
    },
  })
  return { viewport, content, scheduler, follower, changed: () => changed(), disconnected: () => disconnected }
}

function dispatch(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type)
  Object.assign(event, properties)
  target.dispatchEvent(event)
}

test('initial positioning and streamed size changes share one frame without per-token writes', () => {
  const chat = setup()
  assert.equal(chat.scheduler.pending.size, 1)
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 600)
  chat.viewport.scrollHeight = 1400
  for (let index = 0; index < 100; index++) chat.changed()
  assert.equal(chat.scheduler.pending.size, 1)
  assert.equal(chat.viewport.scrollTop, 600)
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 1000)
  dispatch(chat.viewport, 'scroll')
  assert.equal(chat.scheduler.pending.size, 0, 'our own scroll does not start another frame')
  chat.follower.destroy()
})

test('upward user intent cancels a pending follow and later completion/media changes respect it', () => {
  const chat = setup()
  chat.scheduler.flush()
  chat.viewport.scrollHeight = 1300
  chat.changed()
  dispatch(chat.viewport, 'wheel', { deltaY: -25 })
  chat.viewport.scrollTop = 500
  dispatch(chat.viewport, 'scroll')
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 500)
  chat.viewport.scrollHeight = 1900
  chat.changed() // Final markdown/media layout, after streaming has finished.
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 500)
  assert.equal(chat.scheduler.pending.size, 0)
  chat.follower.destroy()
})

test('scrollbar movement pauses following and returning to the bottom resumes it', () => {
  const chat = setup()
  chat.scheduler.flush()
  chat.viewport.scrollTop = 300
  dispatch(chat.viewport, 'scroll')
  chat.viewport.scrollHeight = 1200
  chat.changed()
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 300)
  chat.viewport.scrollTop = 790
  dispatch(chat.viewport, 'scroll')
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 800)
  chat.viewport.scrollHeight = 1500
  chat.changed()
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 1100)
  chat.follower.destroy()
})

test('a new submission resets paused following, while cleanup removes listeners and queued work', () => {
  const chat = setup()
  chat.scheduler.flush()
  dispatch(chat.viewport, 'keydown', { key: 'PageUp' })
  chat.viewport.scrollHeight = 1200
  chat.changed()
  assert.equal(chat.scheduler.pending.size, 0)
  chat.follower.reset()
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 800)
  chat.viewport.scrollHeight = 1600
  chat.changed()
  assert.equal(chat.scheduler.pending.size, 1)
  chat.follower.destroy()
  assert.ok(chat.disconnected())
  assert.equal(chat.scheduler.pending.size, 0)
  chat.viewport.scrollTop = 900
  dispatch(chat.viewport, 'scroll')
  chat.changed()
  assert.equal(chat.scheduler.pending.size, 0)
})

test('layout shrink does not mistake browser scroll clamping for an upward user scroll', () => {
  const chat = setup()
  chat.scheduler.flush()
  chat.viewport.scrollHeight = 800
  chat.viewport.scrollTop = 400
  dispatch(chat.viewport, 'scroll')
  chat.changed()
  chat.scheduler.flush()
  chat.viewport.scrollHeight = 1100
  chat.changed()
  chat.scheduler.flush()
  assert.equal(chat.viewport.scrollTop, 700)
  chat.follower.destroy()
})

test('touch scrolling upward pauses before the browser emits its scroll event', () => {
  const chat = setup()
  chat.scheduler.flush()
  dispatch(chat.viewport, 'touchstart', { touches: [{ clientY: 100 }] })
  dispatch(chat.viewport, 'touchmove', { touches: [{ clientY: 125 }] })
  chat.viewport.scrollHeight = 1300
  chat.changed()
  assert.equal(chat.scheduler.pending.size, 0)
  chat.follower.destroy()
})

test('without ResizeObserver, text mutations, media loads and window resizing still follow', (context) => {
  let mutationCallback = () => {}
  let disconnected = false
  class Observer {
    constructor(callback: () => void) { mutationCallback = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  for (const [key, value] of [['ResizeObserver', undefined], ['MutationObserver', Observer]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  const viewport = new ScrollViewport()
  const content = new EventTarget()
  const scheduler = frames()
  const follower = attachChatScrollFollow(viewport as unknown as HTMLElement, content as HTMLElement, scheduler)
  scheduler.flush()
  for (const notify of [mutationCallback, () => dispatch(content, 'load'), () => dispatch(content, 'loadedmetadata'),
    () => dispatch(viewport.ownerDocument.defaultView, 'resize')]) {
    viewport.scrollHeight += 100
    notify()
    scheduler.flush()
    assert.equal(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight)
  }
  follower.destroy()
  assert.ok(disconnected)
  dispatch(content, 'load')
  dispatch(viewport.ownerDocument.defaultView, 'resize')
  assert.equal(scheduler.pending.size, 0)
})
