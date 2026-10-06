import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRoutinePiModel } from '../src/lib/piTraceView'
import type { PiStep } from '../src/types/pi'

const model: PiStep = { id: 'model-1', kind: 'model', label: 'deepseek-flash', status: 'completed', startedAt: 1, durationMs: 1000 }

test('research view retains active, failed and cancelled model calls in their original order', () => {
  const steps: PiStep[] = [model,
    { ...model, id: 'active', status: 'running' },
    { ...model, id: 'failed', status: 'failed', text: '模型请求超时' },
    { ...model, id: 'cancelled', status: 'cancelled' },
    { ...model, id: 'tool', kind: 'tool', label: 'search', evidenceIds: [1] },
  ]
  const snapshot = structuredClone(steps)
  assert.deepEqual(steps.filter(step => !isRoutinePiModel(step)).map(step => step.id), ['active', 'failed', 'cancelled', 'tool'])
  assert.deepEqual(steps, snapshot, 'changing presentation must not rewrite recorded events')
})

test('successful model calls with feedback or inspection data remain in the research view', () => {
  for (const extra of [{ text: '供应商返回的诊断' }, { args: { purpose: 'embedding' } }, { artifactId: 'record-1' }, { evidenceIds: [1] }]) {
    assert.equal(isRoutinePiModel({ ...model, ...extra }), false)
  }
})
