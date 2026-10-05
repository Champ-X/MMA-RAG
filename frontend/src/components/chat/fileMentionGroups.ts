import type { KnowledgeBaseFileItem } from './useFileScopeOptions'

export interface FileMentionState {
  query: string
  start: number
  end: number
}

export function getFileMentionState(value: string, caret: number | null | undefined): FileMentionState | null {
  const safeCaret = Math.max(0, Math.min(caret ?? value.length, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  if (beforeCaret.endsWith('\n') || beforeCaret.endsWith('\r')) return null
  // Spaces are valid in knowledge-base and file names; a newline ends the mention.
  const match = beforeCaret.match(/(^|[^\w@])@([^\r\n@\ufffc]*)$/u)
  if (!match) return null
  return { query: match[2], start: safeCaret - match[2].length - 1, end: safeCaret }
}

/** Keep every eligible match reachable; visual height is bounded by the scroller. */
export function buildFileMentionGroups(
  knowledgeBases: Array<{ id: string; name: string }>,
  filesByKb: Record<string, KnowledgeBaseFileItem[]>,
  selectedKeys: ReadonlySet<string>,
  query: string,
) {
  const keyword = query.trim().toLowerCase()
  const separator = keyword.indexOf('/')
  const isScoped = separator >= 0
  const spacePrefix = isScoped ? keyword.slice(0, separator).trim() : ''
  const fileKeyword = isScoped ? keyword.slice(separator + 1).trim() : keyword
  const exactSpaces = isScoped ? knowledgeBases.filter(kb => kb.name.trim().toLowerCase() === spacePrefix) : []
  const matchedSpaces = !isScoped ? knowledgeBases : exactSpaces.length > 0
    ? exactSpaces
    : knowledgeBases.filter(kb => kb.name.trim().toLowerCase().startsWith(spacePrefix))

  return matchedSpaces.map(kb => {
    const matchesSpace = !isScoped && kb.name.toLowerCase().includes(keyword)
    const files = (filesByKb[kb.id] ?? []).filter(file =>
      !selectedKeys.has(`${kb.id}::${file.id}`)
      && (matchesSpace || `${file.name} ${file.type}`.toLowerCase().includes(fileKeyword))
    )
    return { kbId: kb.id, kbName: kb.name, files, totalMatches: files.length }
  })
}
