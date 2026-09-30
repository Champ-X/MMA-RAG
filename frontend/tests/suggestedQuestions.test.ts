import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSuggestedQuestionsCache, getSuggestionScope,
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

test('selected files strictly override KB scope without broadening to other materials', () => {
  const scope = getSuggestionScope({ kbMode: 'manual', knowledgeBaseIds: ['other'] }, [
    { kbId: 'a', fileId: 'tea', name: '茶叶驯化史.mp4' },
  ])
  assert.deepEqual(scope.knowledge_base_ids, ['a'])
  assert.deepEqual(scope.selected_files, [{ kb_id: 'a', file_id: 'tea', name: '茶叶驯化史.mp4' }])
  assert.equal(scope.kb_mode, 'manual')
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
  assert.deepEqual(await cache.load('scope', scope), { questions: [], pending: false })
  assert.deepEqual(await cache.load('scope', scope), { questions: [], pending: false })
  assert.equal(calls, 2)
})


test('warming and legacy template fallbacks are never cached or displayed as questions', async () => {
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    if (calls === 1) return { questions: [], source: 'warming', retry_after_ms: 2000 }
    if (calls === 2) return { ...payload('请梳理「资料」中的重要概念和结论？'), source: 'scope_fallback' }
    return { ...payload('茶树是怎么从野生变成栽培作物的？'), source: 'precomputed' }
  })
  const scope = getSuggestionScope(null)
  assert.deepEqual(await cache.load('scope', scope), { questions: [], pending: true, retryAfterMs: 2000 })
  assert.equal(cache.peek('scope'), undefined)
  assert.deepEqual((await cache.load('scope', scope)).questions, [])
  assert.equal(cache.peek('scope'), undefined)
  assert.equal((await cache.load('scope', scope)).pending, false)
  assert.equal(cache.peek('scope')?.[0].text, '茶树是怎么从野生变成栽培作物的？')
})

test('background polling replaces a warming response with ready content', async () => {
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => ++calls < 3
    ? { questions: [], source: 'warming' }
    : payload('这段视频里，茶叶是怎样加工的？'))
  const result = await cache.loadUntilReady('scope', getSuggestionScope(null), {
    firstRetryMs: 1, retryMs: 1,
  })
  assert.equal(calls, 3)
  assert.equal(result.pending, false)
  assert.equal(result.questions[0].text, '这段视频里，茶叶是怎样加工的？')
})

test('warming polling stops at its limit and remains retryable', async () => {
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    return { questions: [], source: 'warming' }
  })
  const result = await cache.loadUntilReady('scope', getSuggestionScope(null), {
    firstRetryMs: 1, retryMs: 1, maxAttempts: 3,
  })
  assert.equal(calls, 3)
  assert.equal(result.pending, true)
  assert.equal(cache.peek('scope'), undefined)
  await cache.load('scope', getSuggestionScope(null))
  assert.equal(calls, 4)
})

test('changing scope or unmounting cancels pending retries without another request', async () => {
  let calls = 0
  const controller = new AbortController()
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    return { questions: [], source: 'warming' }
  })
  const pending = cache.loadUntilReady('scope', getSuggestionScope(null), {
    signal: controller.signal, firstRetryMs: 20,
  })
  setTimeout(() => controller.abort(), 2)
  await assert.rejects(pending, { name: 'AbortError' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(calls, 1)
})

test('settled empty and unavailable responses do not keep polling', async () => {
  for (const source of ['empty', 'unavailable']) {
    let calls = 0
    const cache = createSuggestedQuestionsCache(async () => {
      calls += 1
      return { questions: [], source }
    })
    const result = await cache.loadUntilReady(source, getSuggestionScope(null), {
      firstRetryMs: 1, retryMs: 1,
    })
    assert.deepEqual(result, { questions: [], pending: false })
    assert.equal(calls, 1)
  }
})

test('cancelling one observer preserves a shared in-flight result for another mount', async () => {
  let calls = 0
  const response = deferred<SuggestedQuestionsResponse>()
  const controller = new AbortController()
  const scope = getSuggestionScope(null)
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    return response.promise
  })
  const oldMount = cache.loadUntilReady('scope', scope, { signal: controller.signal })
  const currentMount = cache.loadUntilReady('scope', scope)
  controller.abort()
  response.resolve(payload('声音里的鸟叫有什么特点？'))
  await assert.rejects(oldMount, { name: 'AbortError' })
  const result = await currentMount
  assert.equal(calls, 1)
  assert.equal(result.questions[0].text, '声音里的鸟叫有什么特点？')
  assert.equal(cache.peek('scope')?.[0].text, result.questions[0].text)
})

test('elapsed polling deadline stops slow pending responses before the attempt limit', async () => {
  let time = 0
  let calls = 0
  const cache = createSuggestedQuestionsCache(async () => {
    calls += 1
    time += 100
    return { questions: [], source: 'warming' }
  }, { now: () => time })
  const result = await cache.loadUntilReady('scope', getSuggestionScope(null), {
    maxWaitMs: 50, maxAttempts: 16,
  })
  assert.equal(result.pending, true)
  assert.equal(calls, 1)
})
