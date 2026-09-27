import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSuggestedQuestionsCache, getSuggestionScope, localSuggestedQuestions,
  suggestionCacheKey, type SuggestedQuestionsResponse,
} from '../src/lib/suggestedQuestions'
import type { KnowledgeBase } from '../src/store/useKnowledgeStore'

const kb = (id: string): KnowledgeBase => ({
  id, name: `资料${id}`, description: '', updated_at: '2026-09-27',
  stats: { documents: 1, chunks: 2, images: 0 },
})
const payload = (text: string): SuggestedQuestionsResponse => ({ questions: [{ text, kb_name: '资料' }] })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('equivalent scope arrays and KB ordering share a cache key; content updates invalidate it', () => {
  const a = getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['b', 'a', 'a'] })
  const b = getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['a', 'b'] })
  const first = suggestionCacheKey(a, [kb('b'), kb('a')])
  assert.equal(first, suggestionCacheKey(b, [kb('a'), kb('b')]))
  assert.notEqual(first, suggestionCacheKey(b, [{ ...kb('a'), updated_at: '2026-09-28' }, kb('b')]))
  assert.notEqual(first, suggestionCacheKey(b, [{ ...kb('a'), stats: { documents: 2, chunks: 4, images: 0 } }, kb('b')]))
})

test('selected files strictly override KB scope, with local fallback limited to selected metadata', () => {
  const scope = getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['other'] }, [
    { kbId: 'a', fileId: 'tea', name: '茶叶驯化史.mp4' },
  ])
  assert.deepEqual(scope.knowledge_base_ids, ['a'])
  const questions = localSuggestedQuestions(scope, [kb('a'), kb('other')])
  assert.equal(questions.length, 1)
  assert.match(questions[0].text, /茶叶驯化史/)
  assert.equal(questions[0].kbName, '资料a')
  const empty = getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: [] })
  assert.deepEqual(localSuggestedQuestions(empty, [kb('a')]), [])
  assert.deepEqual(localSuggestedQuestions(getSuggestionScope(null), [{ ...kb('a'), stats: {
    documents: 0, chunks: 0, images: 0, text_vector_dim: 2048,
  } }]), [])
})

test('simultaneous mounts share one request and another conversation reuses its result', async () => {
  const scope = getSuggestionScope(null)
  const response = deferred<SuggestedQuestionsResponse>()
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => { calls += 1; return response.promise })
  const first = cache.load('same-scope', scope)
  const second = cache.load('same-scope', scope)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  response.resolve(payload('茶叶如何驯化？'))
  assert.deepEqual(await second, await first)
  assert.deepEqual(await cache.load('same-scope', scope), await first)
  assert.equal(calls, 1)
})

test('changing scope isolates an older slow response and never overwrites the new scope', async () => {
  const oldResponse = deferred<SuggestedQuestionsResponse>()
  const cache = createSuggestedQuestionsCache((scope) => scope.knowledge_base_ids.includes('a')
    ? oldResponse.promise : Promise.resolve(payload('计算机问题？')))
  const old = cache.load('a', getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['a'] }))
  await cache.load('b', getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['b'] }))
  oldResponse.resolve(payload('茶史问题？'))
  await old
  assert.equal(cache.peek('a')?.[0].text, '茶史问题？')
  assert.equal(cache.peek('b')?.[0].text, '计算机问题？')
})

test('换一批 bypasses a fresh cache and expiration reloads automatically', async () => {
  let time = 0
  let calls = 0
  const scope = getSuggestionScope(null)
  const cache = createSuggestedQuestionsCache(async () => payload(`第${++calls}批问题？`), {
    ttlMs: 100, now: () => time,
  })
  await cache.load('scope', scope)
  await cache.load('scope', scope, true)
  assert.equal(cache.peek('scope')?.[0].text, '第2批问题？')
  time = 101
  assert.equal(cache.peek('scope'), undefined)
  await cache.load('scope', scope)
  assert.equal(calls, 3)
})

test('a hung request has a deadline, is aborted, and can be retried without a poisoned cache', async () => {
  const late = deferred<SuggestedQuestionsResponse>()
  let signal: AbortSignal | undefined
  let calls = 0
  const cache = createSuggestedQuestionsCache(async (_, currentSignal) => {
    signal = currentSignal
    calls += 1
    return calls === 1 ? late.promise : payload('重试成功？')
  }, { timeoutMs: 15 })
  const scope = getSuggestionScope(null)
  await assert.rejects(cache.load('scope', scope), /超时/)
  assert.equal(signal?.aborted, true)
  assert.equal(cache.peek('scope'), undefined)
  await cache.load('scope', scope)
  late.resolve(payload('不应覆盖的新结果？'))
  await Promise.resolve()
  assert.equal(cache.peek('scope')?.[0].text, '重试成功？')
})

test('empty results are terminal and cached, while network failures remain retryable', async () => {
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    if (calls === 1) throw new Error('offline')
    return { questions: [] }
  })
  const scope = getSuggestionScope(null)
  await assert.rejects(cache.load('scope', scope), /offline/)
  assert.deepEqual(await cache.load('scope', scope), [])
  assert.deepEqual(await cache.load('scope', scope), [])
  assert.equal(calls, 2)
})
