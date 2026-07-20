import type { DurableRunEvent } from '@/api/nexus'

type Listener = (event: DurableRunEvent) => void
type StateListener = (state: 'connecting' | 'open' | 'closed' | 'error') => void

export class DurableEventClient {
  private source: EventSource | null = null
  private cursor = 0
  private seen = new Set<string>()
  private terminalSeen = false
  private readonly listeners = new Set<Listener>()
  private readonly stateListeners = new Set<StateListener>()

  constructor(
    private readonly runId: string,
    initialCursor = 0,
  ) {
    this.cursor = initialCursor
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onState(listener: StateListener) {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  connect() {
    if (this.terminalSeen) {
      this.close()
      return
    }
    this.close()
    this.emitState('connecting')
    const source = new EventSource(`/api/v1/runs/${this.runId}/events?after=${this.cursor}`)
    this.source = source
    source.onopen = () => this.emitState('open')
    source.onmessage = (message) => this.accept(message)
    const eventTypes = [
      'run.created',
      'run.running',
      'run.planning',
      'run.completed',
      'run.partial',
      'run.failed',
      'run.cancelled',
      'run.paused',
      'retrieval.completed',
      'research.plan.created',
      'runtime.checkpoint.committed',
      'research.safety_fuse.triggered',
    ]
    eventTypes.forEach((type) => source.addEventListener(type, (message) => this.accept(message as MessageEvent)))
    source.onerror = () => {
      if (this.source !== source) return
      if (this.terminalSeen) {
        this.close()
        return
      }
      this.emitState('error')
      // Native EventSource reconnects using the URL cursor. Recreate it so the query cursor advances.
      source.close()
      window.setTimeout(() => this.connect(), 1200)
    }
  }

  close() {
    this.source?.close()
    this.source = null
    this.emitState('closed')
  }

  getCursor() {
    return this.cursor
  }

  private accept(message: MessageEvent) {
    let event: DurableRunEvent
    try {
      event = JSON.parse(message.data) as DurableRunEvent
    } catch {
      return
    }
    if (event.schema_version !== 1) {
      this.emitState('error')
      return
    }
    if (this.seen.has(event.event_id) || event.sequence <= this.cursor) return
    if (event.sequence > this.cursor + 1) {
      this.fillGap().catch(() => this.emitState('error'))
      return
    }
    this.deliver(event)
    if (this.isTerminal(event)) {
      this.terminalSeen = true
      this.close()
    }
  }

  private async fillGap() {
    const response = await fetch(`/api/v1/runs/${this.runId}/events?after=${this.cursor}&stream=false`)
    if (!response.ok) throw new Error(`Gap fill failed: ${response.status}`)
    const payload = (await response.json()) as { items: DurableRunEvent[] }
    payload.items.forEach((event) => {
      if (!this.seen.has(event.event_id) && event.sequence === this.cursor + 1) {
        this.deliver(event)
        if (this.isTerminal(event)) this.terminalSeen = true
      }
    })
    if (this.terminalSeen) this.close()
    else this.connect()
  }

  private deliver(event: DurableRunEvent) {
    this.cursor = event.sequence
    this.seen.add(event.event_id)
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000))
    this.listeners.forEach((listener) => listener(event))
  }

  private emitState(state: 'connecting' | 'open' | 'closed' | 'error') {
    this.stateListeners.forEach((listener) => listener(state))
  }

  private isTerminal(event: DurableRunEvent) {
    return ['run.completed', 'run.partial', 'run.failed', 'run.cancelled'].includes(event.event_type)
  }
}
