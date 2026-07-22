import { describe, expect, it } from 'vitest'
import { isEditableShortcutTarget } from './keyboardShortcuts'

describe('isEditableShortcutTarget', () => {
  const target = (value: { isContentEditable?: boolean; tagName?: string }) => value as unknown as EventTarget

  it('recognizes form fields and editable regions as local shortcut owners', () => {
    expect(isEditableShortcutTarget(target({ tagName: 'INPUT' }))).toBe(true)
    expect(isEditableShortcutTarget(target({ tagName: 'textarea' }))).toBe(true)
    expect(isEditableShortcutTarget(target({ tagName: 'SELECT' }))).toBe(true)
    expect(isEditableShortcutTarget(target({ isContentEditable: true, tagName: 'DIV' }))).toBe(true)
  })

  it('leaves normal controls eligible for global shortcuts', () => {
    expect(isEditableShortcutTarget(target({ tagName: 'BUTTON' }))).toBe(false)
    expect(isEditableShortcutTarget(null)).toBe(false)
  })
})
