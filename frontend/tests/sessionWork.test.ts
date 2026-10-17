import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerSessionWork, cancelSessionWork } from '../src/lib/sessionWork'

test('explicit deletion cancels pending local work only in its own session', () => {
  const cancelled: string[] = []
  const releaseA = registerSessionWork('a', () => cancelled.push('a'))
  const releaseB = registerSessionWork('b', () => cancelled.push('b'))
  const releasePending = registerSessionWork('a', () => cancelled.push('pending upload'))
  cancelSessionWork('a')
  assert.deepEqual(cancelled, ['a', 'pending upload'])
  releaseA(); releasePending()
  cancelSessionWork('a')
  assert.equal(cancelled.length, 2)
  releaseB()
  cancelSessionWork('b')
  assert.equal(cancelled.length, 2)
})
