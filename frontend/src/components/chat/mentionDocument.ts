import type { JSONContent } from '@tiptap/core'
import { validMentions, type ChatMention, type ChatReference, type ComposerValue } from '@/lib/chatReferences'

export function toMentionDocument(value: ComposerValue): JSONContent {
  const content: JSONContent[] = []
  let paragraph: JSONContent = { type: 'paragraph', content: [] }
  const appendText = (text: string) => {
    text.split('\n').forEach((line, i) => {
      if (i) { content.push(paragraph); paragraph = { type: 'paragraph', content: [] } }
      if (line) paragraph.content!.push({ type: 'text', text: line })
    })
  }
  let cursor = 0
  for (const mention of validMentions(value)) {
    appendText(value.text.slice(cursor, mention.start))
    const { start: _start, end: _end, ...reference } = mention
    paragraph.content!.push({ type: 'fileMention', attrs: { reference } })
    cursor = mention.end
  }
  appendText(value.text.slice(cursor))
  content.push(paragraph)
  return { type: 'doc', content }
}

export function fromMentionDocument(doc: JSONContent): ComposerValue {
  let text = ''
  const mentions: ChatMention[] = []
  function visit(node: JSONContent) {
    if (node.type === 'text') text += node.text || ''
    else if (node.type === 'hardBreak') text += '\n'
    else if (node.type === 'fileMention') {
      const reference = node.attrs?.reference as ChatReference
      const start = text.length
      text += `@${reference.name}`
      mentions.push({ ...reference, start, end: text.length })
    } else node.content?.forEach(visit)
  }
  doc.content?.forEach((node, i) => { if (i) text += '\n'; visit(node) })
  return { text, mentions }
}
