import type { ModelRouteSelection, ModelRouteTestResponse, ModelRouteTestSnapshot } from '../types/modelRouteTest'

export const modelRouteTestKey = (route: ModelRouteSelection) => JSON.stringify([route.provider, route.model, route.capability])
type Probe = (route: ModelRouteSelection) => Promise<ModelRouteTestResponse>
type Job = { key: string; route: ModelRouteSelection; status: 'queued' | 'running' | 'done' | 'cancelled'; result?: ModelRouteTestResponse }

/** A screen-local queue: exact routes share a result, but removed drafts lose it. */
export function createModelRouteTests(probe: Probe) {
  const listeners = new Set<() => void>()
  const routes = new Map<string, ModelRouteSelection>()
  const jobs = new Map<string, Job>()
  const queue: Job[] = []
  let running = 0
  let batch: { jobs: Job[]; stopped: boolean } | null = null
  let lastResult: ModelRouteTestResponse | null = null
  let snapshot: ModelRouteTestSnapshot = { routes: {}, lastResult: null, batch: null }

  function publish() {
    snapshot = {
      lastResult: lastResult && routes.has(modelRouteTestKey(lastResult)) ? lastResult : null,
      routes: Object.fromEntries([...jobs].filter(([, job]) => job.status !== 'cancelled')
        .map(([key, job]) => [key, { status: job.status as 'queued' | 'running' | 'done', result: job.result }])),
      batch: batch ? {
        total: batch.jobs.length,
        completed: batch.jobs.filter(job => job.status === 'done').length,
        succeeded: batch.jobs.filter(job => job.status === 'done' && job.result?.success).length,
        failed: batch.jobs.filter(job => job.status === 'done' && !job.result?.success).length,
        cancelled: batch.jobs.filter(job => job.status === 'cancelled').length,
        running: batch.jobs.filter(job => job.status === 'running').length,
        queued: batch.jobs.filter(job => job.status === 'queued').length,
        stopped: batch.stopped,
      } : null,
    }
    listeners.forEach(listener => listener())
  }

  function drain() {
    while (running < 2 && queue.length > 0) {
      const job = queue.shift()!
      if (job.status !== 'queued' || jobs.get(job.key) !== job || !routes.has(job.key)) continue
      job.status = 'running'
      running += 1
      publish()
      void Promise.resolve().then(() => probe({ ...job.route })).then(result => {
        if (jobs.get(job.key) !== job || job.status === 'cancelled') return
        // A response for another route must never make the current draft green.
        job.result = modelRouteTestKey(result) === job.key ? result : {
          ...job.route, success: false, duration_ms: result.duration_ms,
          error_code: 'route_mismatch', message: '服务返回的路由与当前选择不一致，请重新测试。',
        }
        job.status = 'done'
        lastResult = job.result
      }, () => {
        if (jobs.get(job.key) !== job || job.status === 'cancelled') return
        job.result = { ...job.route, success: false, duration_ms: 0, error_code: 'network_error', message: '无法完成连接测试，请检查后端连接后重试。' }
        job.status = 'done'
        lastResult = job.result
      }).finally(() => {
        running -= 1
        publish()
        drain()
      })
    }
  }

  function enqueue(route: ModelRouteSelection): Job | undefined {
    const key = modelRouteTestKey(route)
    if (!route.provider || !route.model || !routes.has(key)) return
    const existing = jobs.get(key)
    if (existing?.status === 'queued' || existing?.status === 'running') return existing
    const job: Job = { key, route: { ...route }, status: 'queued' }
    jobs.set(key, job)
    if (batch) batch.jobs = batch.jobs.map(previous => previous.key === key ? job : previous)
    queue.push(job)
    return job
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    setSelections(selections: ModelRouteSelection[]) {
      const next = new Map(selections.filter(route => route.provider && route.model).map(route => [modelRouteTestKey(route), { ...route }]))
      let changed = false
      for (const [key, job] of jobs) {
        if (!next.has(key)) { job.status = 'cancelled'; jobs.delete(key); changed = true }
      }
      routes.clear()
      next.forEach((route, key) => routes.set(key, route))
      if (changed) publish()
    },
    test(route: ModelRouteSelection) { enqueue(route); publish(); drain() },
    testAll() {
      batch = { jobs: [...routes.values()].map(enqueue).filter((job): job is Job => !!job), stopped: false }
      publish()
      drain()
    },
    stopQueued() {
      if (batch) batch.stopped = true
      for (const [key, job] of jobs) {
        if (job.status === 'queued') { job.status = 'cancelled'; jobs.delete(key) }
      }
      publish()
    },
    clear() {
      jobs.forEach(job => { job.status = 'cancelled' })
      jobs.clear()
      queue.length = 0
      routes.clear()
      batch = null
      lastResult = null
      publish()
    },
  }
}
