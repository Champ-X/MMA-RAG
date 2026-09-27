import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { findAllCitationMatches, getOrderedRefIdsFromContent } from '../src/lib/citations'
import { MessageBubble, type MessageBubbleMessage } from '../src/components/chat/MessageBubble'

const warning = /部分引用缺少来源数据/
const message: MessageBubbleMessage = {
  id: 'citation-regression', type: 'assistant', timestamp: '2026-09-27T00:00:00Z',
  content: '**近期进展（2026）：可观测性驱动的自动化演化**\n\n研究结论 [4][9]。',
  citations: [4, 9].map((id) => ({ id, type: 'doc', file_name: 'survey.pdf', content: 'Evidence' })),
}
const render = (value: MessageBubbleMessage, isStreaming = false) =>
  renderToStaticMarkup(<MessageBubble message={value} isStreaming={isStreaming} />)

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
