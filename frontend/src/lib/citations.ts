import type { CitationEvent, CitationReference } from '@/types/sse'

export type CitationMatch = { start: number; end: number; n: number }

/**
 * Only explicit citation brackets denote sources. Parenthesized numbers and bare
 * numbers are ordinary prose (years, quantities, list items), even when a source
 * with the same ID exists. Keep legacy Chinese citation brackets supported.
 * All consumers share this parser so warnings, numbering and media agree.
 */
export function findAllCitationMatches(text: string): CitationMatch[] {
  const matches: CitationMatch[] = []
  // Keep offsets into the original Markdown so media still attaches to its block.
  const mask = (value: string) => ' '.repeat(value.length)
  const prose = text
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, mask)
    .replace(/`+[^`]*`+|!?\[[^\]]*\]\([^)]*\)|\\\[\d+\]/g, mask)
  const pattern = /\[(\d+)\]|【(\d+)】|〔(\d+)〕|〖(\d+)〗/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(prose)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      n: Number(match[1] ?? match[2] ?? match[3] ?? match[4]),
    })
  }
  return matches
}

/** Original source IDs in first-appearance order, for continuous display labels. */
export function getOrderedRefIdsFromContent(content: string): number[] {
  return [...new Set(findAllCitationMatches(content).map((match) => match.n))]
}

/** Preloads extend the source map; final attribution replaces it, even if empty. */
export function mergeCitationReferences(previous: CitationReference[], event: CitationEvent): CitationReference[] {
  return event.replace ? event.references : [...previous, ...event.references]
}
