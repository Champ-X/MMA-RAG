import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { englishMessages, getLanguage, normalizeLanguage, setLanguage, translate } from '../src/i18n'
import { useConfigStore } from '../src/store/useConfigStore'
import { chatApi, apiClient } from '../src/services/api_client'
import { createChatStream } from '../src/services/sse_stream'
import { piApi } from '../src/services/piAgent'

afterEach(() => setLanguage('zh-CN'))

test('all localized messages preserve interpolation parameters', () => {
  const vars = (text: string) => [...text.matchAll(/{{\s*([^}, ]+)[^}]*}}/g)].map(match => match[1]).sort()
  for (const [key, value] of Object.entries(englishMessages)) assert.deepEqual(vars(value), vars(key), key)
})

test('explicit UI translation keys have English catalog entries', () => {
  const missing = new Set<string>()
  function scan(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) { if (item.name !== 'i18n') scan(path); continue }
      if (!/\.tsx?$/.test(path)) continue
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ['tr', 't', 'translate'].includes(node.expression.getText(source))) {
          const key = node.arguments[0]
          if (key && ts.isStringLiteral(key) && /\p{Script=Han}/u.test(key.text) && !(key.text in englishMessages)) missing.add(key.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  scan('src')
  assert.deepEqual([...missing], [])
})

test('language preference keeps model drafts and unsaved-change status intact', () => {
  const initial = useConfigStore.getState()
  useConfigStore.setState({ hasUnsavedChanges: true })
  const before = useConfigStore.getState().config
  useConfigStore.getState().setLanguage('en-US')
  assert.equal(getLanguage(), 'en-US')
  assert.equal(useConfigStore.getState().config.language, 'en-US')
  assert.strictEqual(useConfigStore.getState().config.models, before.models)
  assert.equal(useConfigStore.getState().hasUnsavedChanges, true)
  assert.equal(translate('设置'), 'Settings')
  assert.equal(normalizeLanguage('unsupported'), 'zh-CN')
  useConfigStore.setState(initial)
})

test('JSON chat freezes language at submission and preserves user content', async context => {
  let body: any
  context.mock.method(apiClient, 'post', async (_path: string, data: unknown) => { body = data; return {} })
  setLanguage('en-US')
  const pending = chatApi.sendMessage({ message: '中文原文', selectedFiles: [{ kbId: 'kb', fileId: 'file', name: '资料.pdf' }] })
  setLanguage('zh-CN')
  await pending
  assert.equal(body.language, 'en-US')
  assert.equal(body.message, '中文原文')
  assert.equal(body.selectedFiles[0].name, '资料.pdf')
})

test('GET and multipart streams carry independent language snapshots', async context => {
  let url = '', body: FormData | undefined
  class Source { static CLOSED = 2; readyState = 0; constructor(value: string) { url = value } close() {} }
  const previous = globalThis.EventSource
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: Source })
  context.after(() => Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: previous }))
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    body = init.body as FormData
    return new Response('data: {"type":"complete"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
  })
  setLanguage('en-US')
  const get = createChatStream('中文查询', {})
  setLanguage('zh-CN')
  assert.equal(new URL(url, 'http://localhost').searchParams.get('language'), 'en-US')
  assert.equal(new URL(url, 'http://localhost').searchParams.get('message'), '中文查询')
  get.close()
  const post = createChatStream('保留原文', {}, { language: 'en-US', selectedFiles: [{ kbId: 'kb', fileId: 'file', name: '资料.pdf' }] })
  assert.equal(body?.get('language'), 'en-US')
  assert.equal(body?.get('messageJson'), JSON.stringify('保留原文'))
  post.close()
})

test('Pi JSON and multipart retries keep the original language and source content', async context => {
  const bodies: BodyInit[] = []
  let attempts = 0
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    bodies.push(init.body!)
    if (++attempts % 2) { setLanguage('zh-CN'); throw new TypeError('temporary disconnect') }
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  })
  for (const files of [undefined, [new File(['source'], '原图.png', { type: 'image/png' })]]) {
    setLanguage('en-US')
    await piApi.create({ requestId: 'request', sessionId: 'session', message: '用户原句', history: [{ role: 'user', content: '历史原文' }], files })
    const pair = bodies.slice(-2)
    assert.strictEqual(pair[0], pair[1])
    const spec = JSON.parse(typeof pair[0] === 'string' ? pair[0] : String((pair[0] as FormData).get('request')))
    assert.equal(spec.language, 'en-US')
    assert.equal(spec.message, '用户原句')
    assert.equal(spec.history[0].content, '历史原文')
  }
})
