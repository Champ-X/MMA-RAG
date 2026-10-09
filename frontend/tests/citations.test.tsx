import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { findAllCitationMatches, getOrderedRefIdsFromContent, mergeCitationReferences } from '../src/lib/citations'
import { MessageBubble, type MessageBubbleMessage } from '../src/components/chat/MessageBubble'

const warning = /部分引用缺少来源数据/
const message: MessageBubbleMessage = {
  id: 'citation-regression', type: 'assistant', timestamp: '2026-09-27T00:00:00Z',
  content: '**近期进展（2026）：可观测性驱动的自动化演化**\n\n研究结论 [4][9]。',
  citations: [4, 9].map((id) => ({ id, type: 'doc', file_name: 'survey.pdf', content: 'Evidence' })),
}
const render = (value: MessageBubbleMessage, isStreaming = false) =>
  renderToStaticMarkup(<MessageBubble message={value} isStreaming={isStreaming} />)

test('first streamed text is visible while the lazy Markdown renderer loads', () => {
  const html = render({ ...message, content: '首批已收到的文字 🖼️', citations: [] }, true)
  assert.match(html, /首批已收到的文字 🖼️/)
  assert.doesNotMatch(html, /正在准备渲染回答|正在载入 Markdown/)
})

test('year in the reported answer is not a citation and does not trigger a warning', () => {
  assert.deepEqual(getOrderedRefIdsFromContent(message.content), [4, 9])
  assert.doesNotMatch(render(message), warning)
})

test('ordinary numbers stay prose even if they coincide with source IDs', () => {
  const content = '（1）步骤 (2) step，数量 3。数量 4；条目 5）\n剩余 6'
  assert.deepEqual(findAllCitationMatches(content), [])
  assert.doesNotMatch(render({ ...message, content }), warning)
})

test('explicit brackets keep occurrence offsets, deduplicate and preserve source order', () => {
  const content = '结论 [9][4]，补充【2】〔3〕〖5〗；再次 [9]。'
  assert.deepEqual(getOrderedRefIdsFromContent(content), [9, 4, 2, 3, 5])
  assert.deepEqual(findAllCitationMatches(content).map(({ start, end }) => content.slice(start, end)),
    ['[9]', '[4]', '【2】', '〔3〕', '〖5〗', '[9]'])
})

test('real missing sources still warn, including explicit year-sized source IDs', () => {
  assert.match(render({ ...message, citations: [] }), warning)
  assert.match(render({ ...message, content: '结论 [2026]。' }), warning)
  assert.doesNotMatch(render({ ...message, citations: [] }, true), warning)
})

test('restored messages and serialized string IDs retain valid citations', () => {
  const restored = JSON.parse(JSON.stringify(message)) as MessageBubbleMessage
  restored.citations = restored.citations?.map((ref) => ({ ...ref, id: String(ref.id) }))
  assert.doesNotMatch(render(restored), warning)
})

test('a refusal or uncited answer never displays preloaded retrieval candidates', () => {
  for (const content of ['知识库中未找到相关内容。', '没有足够资料回答这个问题。', '']) {
    const html = render({ ...message, content })
    assert.doesNotMatch(html, /text-amber-700/)
    assert.doesNotMatch(html, warning)
  }
})

test('partial answers retain only the sources actually cited, including during streaming', () => {
  for (const streaming of [false, true]) {
    const html = render({ ...message, content: '已知结论 [9]。其他方面未找到资料。' }, streaming)
    assert.equal((html.match(/text-amber-700/g) ?? []).length, 2)
    assert.doesNotMatch(html, warning)
  }
})

test('code, links and escaped brackets are not sources and prose offsets stay intact', () => {
  const content = '数组 `values[4]`；链接 [9](https://example.test)；\\[4]。\n```python\narray[4]\n```\n正文【9】。'
  assert.deepEqual(getOrderedRefIdsFromContent(content), [9])
  const [match] = findAllCitationMatches(content)
  assert.equal(content.slice(match.start, match.end), '【9】')
  assert.doesNotMatch(render({ ...message, content, citations: [] }), /\[4\].*缺少来源/)
})

test('final citation events replace candidates and an empty set clears old preloads', () => {
  const refs = message.citations as NonNullable<typeof message.citations>
  const preloaded = mergeCitationReferences([], { references: refs })
  assert.deepEqual(preloaded, refs)
  assert.deepEqual(mergeCitationReferences(preloaded, { references: [refs[1]], replace: true }), [refs[1]])
  assert.deepEqual(mergeCitationReferences(preloaded, { references: [], replace: true }), [])
})
