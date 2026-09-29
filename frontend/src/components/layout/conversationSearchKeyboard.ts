interface SearchKeyEvent {
  key: string
  isComposing?: boolean
  keyCode?: number
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** Leave text editing and IME confirmation alone; only handle palette navigation. */
export function getConversationSearchAction(
  event: SearchKeyEvent,
  resultIds: string[],
  activeId: string | null,
): { type: 'move' | 'activate'; id: string } | null {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !resultIds.length) return null
  const index = activeId == null ? -1 : resultIds.indexOf(activeId)
  if (event.key === 'ArrowDown') return { type: 'move', id: resultIds[(index + 1) % resultIds.length] }
  if (event.key === 'ArrowUp') return { type: 'move', id: resultIds[index <= 0 ? resultIds.length - 1 : index - 1] }
  if (event.key === 'Enter') return { type: 'activate', id: resultIds[Math.max(0, index)] }
  return null
}
