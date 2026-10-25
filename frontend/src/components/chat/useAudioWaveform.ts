import { useEffect, useState } from 'react'
import { extractWaveformPeaks, readWaveformAudio } from '@/lib/audioWaveform'

type Listener = (peaks: number[] | null) => void
type Job = { src: string; listeners: Set<Listener>; controller: AbortController }

const cache = new Map<string, number[]>()
const jobs = new Map<string, Job>()
const queue: Job[] = []
let working = false

function offlineContextConstructor(): typeof OfflineAudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  return window.OfflineAudioContext
    || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
}

function remember(src: string, peaks: number[]): void {
  cache.delete(src)
  cache.set(src, peaks)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
}

/** One network/decode job at a time bounds decoded audio memory across a long chat. */
async function drainQueue(): Promise<void> {
  if (working) return
  working = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      if (job.controller.signal.aborted || !job.listeners.size) continue
      let peaks: number[] | null = null
      try {
        const OfflineContext = offlineContextConstructor()
        if (!OfflineContext) throw new Error('Audio decoding is unavailable')
        const response = await fetch(job.src, { signal: job.controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error('Audio waveform request failed')
        const bytes = await readWaveformAudio(response, job.controller.signal)
        if (job.controller.signal.aborted) continue
        // decodeAudioData resamples to 8 kHz. No realtime context or autoplay permission.
        const context = new OfflineContext(1, 1, 8000)
        const decoded = await context.decodeAudioData(bytes)
        // Native decoding cannot be aborted, so retain this queue slot until it finishes.
        if (job.controller.signal.aborted) continue
        peaks = extractWaveformPeaks(decoded)
        remember(job.src, peaks)
      } catch {
        // A waveform is optional; a blocked, unsupported or oversized source still plays.
      } finally {
        if (jobs.get(job.src) === job) jobs.delete(job.src)
        if (!job.controller.signal.aborted) {
          for (const listener of job.listeners) listener(peaks)
        }
      }
    }
  } finally {
    working = false
  }
}

function subscribe(src: string, listener: Listener): () => void {
  const cached = cache.get(src)
  if (cached) {
    remember(src, cached)
    listener(cached)
    return () => {}
  }
  let job = jobs.get(src)
  if (!job) {
    job = { src, listeners: new Set(), controller: new AbortController() }
    jobs.set(src, job)
    queue.push(job)
  }
  const subscription = job
  subscription.listeners.add(listener)
  void drainQueue()
  return () => {
    subscription.listeners.delete(listener)
    if (subscription.listeners.size) return
    subscription.controller.abort()
    if (jobs.get(src) === subscription) jobs.delete(src)
    const index = queue.indexOf(subscription)
    if (index >= 0) queue.splice(index, 1)
  }
}

/** Enable only while the card is visible; null means the normal seek bar is sufficient. */
export function useAudioWaveform(src: string, enabled = true): number[] | null {
  const [result, setResult] = useState<{ src: string; peaks: number[] | null }>({ src, peaks: null })
  useEffect(() => {
    if (!enabled || !src || !offlineContextConstructor()) return
    return subscribe(src, peaks => setResult({ src, peaks }))
  }, [src, enabled])
  return enabled && result.src === src ? result.peaks : null
}
