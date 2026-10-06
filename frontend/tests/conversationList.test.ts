import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getConversationTitle, sortConversationSessions } from '../src/lib/conversationList'
import type { ChatSession } from '../src/store/useChatStore'

const session = (id: string, extra: Partial<ChatSession> = {}): ChatSession => ({
  id, title: '新对话', messages: [], knowledgeBaseIds: [], createdAt: 1, updatedAt: 1,
  isActive: false, ...extra,
})

test('renamed titles take priority over the first question, while old sessions keep their display name', () => {
  const original = session('old', { messages: [{ id: 'question', role: 'user', content: '咖啡\n  历史', timestamp: 1 }] })
  assert.equal(getConversationTitle(original), '咖啡 历史')
  assert.equal(getConversationTitle({ ...original, title: '  我的研究  ', titleEdited: true }), '我的研究')
  assert.equal(getConversationTitle(session('empty', { title: '  ' })), '未命名会话')
})

test('pinned conversations precede ordinary ones without changing either group order or stored activity', () => {
  const sessions = [session('a'), session('b', { isPinned: true }), session('c'), session('d', { isPinned: true })]
  const snapshot = structuredClone(sessions)
  assert.deepEqual(sortConversationSessions(sessions).map(item => item.id), ['b', 'd', 'a', 'c'])
  assert.deepEqual(sessions, snapshot)
  assert.deepEqual(sortConversationSessions(sessions.map(item => ({ ...item, isPinned: false }))).map(item => item.id), ['a', 'b', 'c', 'd'])
})
