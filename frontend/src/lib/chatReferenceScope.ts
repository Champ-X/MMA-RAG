import type { ChatMention } from './chatReferences'
import type { ChatScopeFile, Message } from '@/store/useChatStore'

/** Inline sources are inputs to understand, never an implicit search restriction. */
export function referenceFilesFromMentions(mentions: ChatMention[] = []): ChatScopeFile[] {
  const files = new Map<string, ChatScopeFile>()
  for (const ref of mentions) {
    if (ref.source !== 'knowledge' || !ref.kbId || !ref.fileId) continue
    files.set(`${ref.kbId}/${ref.fileId}`, {
      kbId: ref.kbId, fileId: ref.fileId, name: ref.name, kbName: ref.kbName, type: ref.type,
    })
  }
  return [...files.values()]
}

/** Old histories mixed inline sources into scopeFiles. New histories retain explicit overlap. */
export function explicitScopeFiles(question: Pick<Message, 'scopeFiles' | 'mentions' | 'scopeVersion'>): ChatScopeFile[] {
  if (question.scopeVersion === 2) return question.scopeFiles ?? []
  const references = new Set(referenceFilesFromMentions(question.mentions).map(file => `${file.kbId}/${file.fileId}`))
  return (question.scopeFiles ?? []).filter(file => !references.has(`${file.kbId}/${file.fileId}`))
}
