export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as { isContentEditable?: boolean; tagName?: string }
  if (element.isContentEditable) return true
  return typeof element.tagName === 'string' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName.toUpperCase())
}
