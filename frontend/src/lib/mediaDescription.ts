export interface MediaDescriptionSection {
  id: string
  /** Source-language UI key. Callers translate the label, never the source content. */
  label: string
  content: string
  detail?: string
}

const videoLabels = '索引画面描述|画面描述|画面摘要|语音转写|音频转写|Indexed visual description|Visual description|Visual summary|Speech transcript|Audio transcript|Transcript'

/** Split explicit source headings only; ordinary prose remains a single verbatim section. */
export function parseMediaDescription(content: string, kind: 'audio' | 'video'): MediaDescriptionSection[] {
  if (!content.trim()) return []
  const fallback = (): MediaDescriptionSection[] => [{
    id: 'description', label: kind === 'audio' ? '声音描述' : '内容描述', content,
  }]

  if (kind === 'audio') {
    const observation = /^\s*(原文件\s*\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s*秒)\s*的?\s*声音观察\s*[：:]\s*/u.exec(content)
      ?? /^\s*Audio observation of (original file\s+\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s+seconds)\s*:\s*/iu.exec(content)
    if (observation) return [{
      id: 'observation', label: '声音观察', detail: observation[1], content: content.slice(observation[0].length),
    }]
    const indexed = /^\s*(?:索引描述|Indexed description)\s*[：:]\s*/iu.exec(content)
    if (indexed) return [{ id: 'description', label: '声音描述', content: content.slice(indexed[0].length) }]
    return fallback()
  }

  // A heading must begin the source. Later headings must begin a line or follow
  // a sentence boundary, so a prose mention of “语音转写：” does not create a tab.
  const firstHeading = new RegExp(`^\\s*(?:\\*\\*)?(?:${videoLabels})(?:\\*\\*)?[ \\t]*[：:]`, 'iu')
  if (!firstHeading.test(content)) return fallback()
  const heading = new RegExp(`(^\\s*|[\\r\\n]+|[。！？.!?][ \\t]+)(?:\\*\\*)?(${videoLabels})(?:\\*\\*)?[ \\t]*[：:](?:\\*\\*)?[ \\t]*`, 'giu')
  const matches = [...content.matchAll(heading)]
  const sections: MediaDescriptionSection[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const next = matches[index + 1]
    const id = /转写|transcript/iu.test(match[2]) ? 'transcript' : 'visual'
    // Repeated headings are ambiguous source structure; retaining the original
    // is safer than merging, reordering, or dropping any of those passages.
    if (sections.some(section => section.id === id)) return fallback()
    const start = match.index! + match[0].length
    const end = next ? next.index! + next[1].length : content.length
    sections.push({
      id, label: id === 'visual' ? '画面摘要' : '语音转写', content: content.slice(start, end).trim(),
    })
  }
  return sections.length ? sections : fallback()
}
