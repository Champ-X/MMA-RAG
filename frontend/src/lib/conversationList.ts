import type { ChatSession } from '../store/useChatStore'

export function getConversationTitle(session: ChatSession) {
  const firstQuestion = session.messages.find(message => message.role === 'user')?.content
  const title = session.titleEdited ? session.title : firstQuestion || session.title
  return (title || '').replace(/\s+/g, ' ').trim() || '未命名会话'
}

/** Pinning changes presentation order without rewriting conversation activity. */
export function sortConversationSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned))
}
