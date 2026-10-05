/** Offsets use JavaScript UTF-16 code units and refer to the exact submitted text. */
export interface ChatReference {
  source: 'knowledge' | 'attachment'
  name: string
  type: string
  kbId?: string
  kbName?: string
  fileId?: string
  attachmentId?: string
  previewUrl?: string
  coverUrl?: string
}

export interface ChatMention extends ChatReference {
  start: number
  end: number
}

export interface ComposerValue {
  text: string
  mentions: ChatMention[]
}

export const referenceKey = (ref: ChatReference) => ref.source === 'attachment'
  ? `attachment:${ref.attachmentId}` : `knowledge:${ref.kbId}:${ref.fileId}`

export function validMentions({ text, mentions }: ComposerValue): ChatMention[] {
  let end = 0
  return [...mentions].sort((a, b) => a.start - b.start).filter(ref => {
    if (ref.start < end || ref.end > text.length || ref.start < 0
      || ref.end <= ref.start || text.slice(ref.start, ref.end) !== `@${ref.name}`) return false
    end = ref.end
    return true
  })
}

export function trimComposerValue(value: ComposerValue): ComposerValue {
  const leading = value.text.length - value.text.trimStart().length
  return {
    text: value.text.trim(),
    mentions: validMentions(value).map(ref => ({ ...ref, start: ref.start - leading, end: ref.end - leading })),
  }
}

export function persistMentions(mentions: ChatMention[]): ChatMention[] {
  return mentions.map(({ previewUrl: _preview, coverUrl: _cover, ...ref }) => ref)
}

export function removeReferences(value: ComposerValue, predicate: (ref: ChatReference) => boolean): ComposerValue {
  let text = '', cursor = 0
  const mentions: ChatMention[] = []
  for (const ref of validMentions(value)) {
    text += value.text.slice(cursor, ref.start)
    if (!predicate(ref)) {
      const start = text.length
      text += value.text.slice(ref.start, ref.end)
      mentions.push({ ...ref, start, end: text.length })
    }
    cursor = ref.end
  }
  return { text: text + value.text.slice(cursor), mentions }
}
