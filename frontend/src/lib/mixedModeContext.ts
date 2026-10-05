import type { Message } from '../store/useChatStore'

/** Only mixed conversations need a client context bridge. Never resend a
 * provisional Pi draft, a failed answer, a tool result, or a system role. */
export function mixedModeContext(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: string }> | undefined {
  if (!messages.some(message => message.executionEngine === 'pi' || message.pi)) return undefined
  return messages.filter(message => !message.error && message.content.trim() &&
    (!message.pi || ['completed', 'partial', 'needs_input'].includes(message.pi.status)))
    .slice(-12).map(message => ({ role: message.role, content: message.content.slice(0, 2000) }))
}
