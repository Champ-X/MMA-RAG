import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DurableRunEvent } from '@/api/nexus'

import { DurableEventClient } from './DurableEventClient'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  emit(type: string, event: DurableRunEvent) {
    const message = { data: JSON.stringify(event) } as MessageEvent
    this.listeners.get(type)?.forEach((listener) => listener(message))
  }
}

const event = (sequence: number, eventType: string): DurableRunEvent => ({
  event_id: `event-${sequence}`,
  stream_id: 'run-1',
  sequence,
  event_type: eventType,
  occurred_at: '2026-07-19T00:00:00Z',
  producer: 'test',
  trace_id: 'trace-1',
  schema_version: 1,
  public_payload: {},
  artifact_refs: [],
  supersedes: null,
})

describe('DurableEventClient', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deduplicates durable events and closes permanently at a terminal event', () => {
    const client = new DurableEventClient('run-1')
    const received: DurableRunEvent[] = []
    client.subscribe((item) => received.push(item))

    client.connect()
    const source = FakeEventSource.instances[0]
    source.emit('run.created', event(1, 'run.created'))
    source.emit('run.created', event(1, 'run.created'))
    source.emit('run.completed', event(2, 'run.completed'))

    expect(received.map((item) => item.sequence)).toEqual([1, 2])
    expect(client.getCursor()).toBe(2)
    expect(source.closed).toBe(true)

    client.connect()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('fills a cursor gap without reconnecting after a terminal history event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            event(1, 'run.created'),
            event(2, 'retrieval.completed'),
            event(3, 'run.completed'),
          ],
        }),
      }),
    )
    const client = new DurableEventClient('run-1')
    const received: DurableRunEvent[] = []
    client.subscribe((item) => received.push(item))

    client.connect()
    FakeEventSource.instances[0].emit('run.completed', event(3, 'run.completed'))

    await vi.waitFor(() => expect(client.getCursor()).toBe(3))
    expect(received.map((item) => item.sequence)).toEqual([1, 2, 3])
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })
})
