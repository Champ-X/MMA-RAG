import type { ChatSession } from '../store/useChatStore'
import { piTerminal } from '../types/pi'

/** Background runs keep their subscriptions, but never own another composer's
 * busy state or stop button. Resolve the action target from the visible session. */
export function activePiRun(sessions: Pick<ChatSession, 'id' | 'messages'>[], sessionId: string | null) {
  const session = sessions.find(item => item.id === sessionId)
  const message = session?.messages.find(item => item.pi && (!piTerminal(item.pi.status)
    || item.pi.status === 'needs_input' && (item.pi.replayThrough || 0) > item.pi.seq))
  return session && message?.pi ? { sessionId: session.id, messageId: message.id, pi: message.pi } : undefined
}

export function waitingPiRun(sessions: Pick<ChatSession, 'id' | 'messages'>[], sessionId: string | null) {
  const session = sessions.find(item => item.id === sessionId)
  const message = [...(session?.messages || [])].reverse().find(item => item.pi)
  return session && message?.pi?.runtime === 'durable' && message.pi.status === 'needs_input'
    && (message.pi.replayThrough || 0) <= message.pi.seq
    ? { sessionId: session.id, messageId: message.id, pi: message.pi } : undefined
}
