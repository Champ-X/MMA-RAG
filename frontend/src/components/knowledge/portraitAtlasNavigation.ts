export interface TopicNavigationRect {
  id: string
  left: number
  top: number
  width: number
  height: number
}

/** Find a visible neighbour while preserving native scrolling at map boundaries. */
export function getSpatialTopicTarget(
  currentId: string,
  key: string,
  rects: TopicNavigationRect[]
): string | null {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(key)) return null
  const visible = rects.filter(rect =>
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
  )
  const current = visible.find(rect => rect.id === currentId)
  if (!current) return null

  const horizontal = key === 'ArrowRight' || key === 'ArrowLeft'
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
  const center = (rect: TopicNavigationRect) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  })
  const origin = center(current)
  const candidates = visible.filter(rect => rect.id !== currentId).map(rect => {
    const target = center(rect)
    const forward = direction * (horizontal ? target.x - origin.x : target.y - origin.y)
    const offset = Math.abs(horizontal ? target.y - origin.y : target.x - origin.x)
    const gap = horizontal
      ? direction > 0 ? rect.left - current.left - current.width : current.left - rect.left - rect.width
      : direction > 0 ? rect.top - current.top - current.height : current.top - rect.top - rect.height
    const overlaps = horizontal
      ? rect.top + rect.height > current.top && rect.top < current.top + current.height
      : rect.left + rect.width > current.left && rect.left < current.left + current.width
    return { id: rect.id, forward, offset, gap, overlaps }
  }).filter(candidate => candidate.forward > 0)
  const tie = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0

  // Prefer the edge neighbours users see directly across a gap. Circles can
  // have overlapping bounding boxes even when their outlines do not touch;
  // allow those diagonal neighbours only if this original path has no target.
  const edge = candidates.filter(candidate => candidate.gap >= -2).sort((a, b) =>
    Number(b.overlaps) - Number(a.overlaps)
    || (a.gap + 2 * a.offset) - (b.gap + 2 * b.offset)
    || tie(a, b)
  )
  if (edge.length) return edge[0].id

  const diagonal = candidates.sort((a, b) =>
    (a.forward + 2 * a.offset) - (b.forward + 2 * b.offset) || tie(a, b)
  )
  return diagonal[0]?.id ?? null
}
