import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { advanceThinking } from '../src/lib/thinkingState'
import { ThinkingCapsule } from '../src/components/chat/ThinkingCapsule'
import { formatStageDuration } from '../src/lib/stageTiming'
import type { ThinkingState } from '../src/store/useChatStore'

const path = process.argv[2]
let state: ThinkingState = { currentStage: 'intent', progress: 0, stages: {
  intent: 'processing', routing: 'idle', retrieval: 'idle', generation: 'idle',
} }
let count = 0
for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
  const { event } = JSON.parse(line)
  if (event.type === 'thought') {
    state = { ...state, ...advanceThinking(state, event.data.type, event.data.data) }
    const html = renderToStaticMarkup(<ThinkingCapsule {...state} />)
    const completed = event.data.type === 'generation' && event.data.data.stage_status === 'completed'
    assert.match(html, new RegExp(`aria-busy="${!completed}"`), JSON.stringify(event.data))
    if (!completed) assert.match(html, /thinking-spinner/)
    if (event.data.data.stage_timing) assert.match(html, /耗时/)
    count++
  }
  if (event.type === 'complete') {
    const html = renderToStaticMarkup(<ThinkingCapsule thoughtData={event.thinking} />)
    assert.doesNotMatch(html, /thinking-spinner|thinking-activity-rail|已用 /)
    for (const stage of Object.values(event.stage_timings) as Array<{duration_ms: number}>) {
      assert.ok(html.includes(formatStageDuration(stage.duration_ms)))
    }
    writeFileSync(path.replace('.jsonl', '-history-render.html'), html)
  }
}
console.log(`${count} actual SSE transitions replayed: active durations, server completion and historical rendering verified`)
