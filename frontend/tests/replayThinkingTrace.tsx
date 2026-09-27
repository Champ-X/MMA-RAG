import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { advanceThinking } from '../src/lib/thinkingState'
import { ThinkingCapsule } from '../src/components/chat/ThinkingCapsule'
import type { ThinkingState } from '../src/store/useChatStore'

for (const path of process.argv.slice(2)) {
  let state: ThinkingState = { currentStage: 'intent', progress: 0, stages: {
    intent: 'processing', routing: 'idle', retrieval: 'idle', generation: 'idle',
  } }
  const checked: unknown[] = []
  for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
    const { event, elapsed } = JSON.parse(line)
    if (event.type === 'thought') {
      state = { ...state, ...advanceThinking(state, event.data.type, event.data.data) }
      const html = renderToStaticMarkup(<ThinkingCapsule {...state} />)
      const finalAgentEvent = event.data.data.agent_status === 'completed'
      assert.match(html, new RegExp(`aria-busy="${!finalAgentEvent}"`), `${elapsed}: ${event.data.type}`)
      if (!finalAgentEvent) assert.match(html, /thinking-spinner/)
      checked.push({ elapsed, phase: event.data.type, status: event.data.data.agent_status ?? event.data.data.stage_status ?? event.data.data.status, busy: !finalAgentEvent })
    }
    if (event.type === 'complete') {
      const html = renderToStaticMarkup(<ThinkingCapsule thoughtData={{ ...state.thoughtData, _generation_completed: true }} />)
      assert.doesNotMatch(html, /thinking-spinner|thinking-activity-rail|animate-shimmer/)
    }
  }
  writeFileSync(path.replace('.jsonl', '-ui-replay.json'), JSON.stringify(checked,null,2))
  console.log(`${path}: verified ${checked.length} actual SSE transitions against rendered component`)
}
