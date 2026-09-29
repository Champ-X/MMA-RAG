import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getConversationSearchAction } from '../src/components/layout/conversationSearchKeyboard'

const results = ['page:knowledge', 'page:settings', 'chat:one', 'chat:two']

test('arrow navigation crosses result groups and wraps at either end', () => {
  assert.deepEqual(getConversationSearchAction({ key: 'ArrowDown' }, results, 'page:settings'), { type: 'move', id: 'chat:one' })
  assert.deepEqual(getConversationSearchAction({ key: 'ArrowDown' }, results, 'chat:two'), { type: 'move', id: 'page:knowledge' })
  assert.deepEqual(getConversationSearchAction({ key: 'ArrowUp' }, results, 'page:knowledge'), { type: 'move', id: 'chat:two' })
})

test('Enter activates the selected result; a removed result cannot be opened after filtering', () => {
  assert.deepEqual(getConversationSearchAction({ key: 'Enter' }, results, 'chat:one'), { type: 'activate', id: 'chat:one' })
  assert.deepEqual(getConversationSearchAction({ key: 'Enter' }, ['chat:two'], 'chat:one'), { type: 'activate', id: 'chat:two' })
  assert.equal(getConversationSearchAction({ key: 'Enter' }, [], 'chat:one'), null)
})

test('IME confirmation and modified editing keys never navigate or submit a search result', () => {
  for (const event of [
    { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 },
    { key: 'ArrowDown', shiftKey: true }, { key: 'ArrowUp', altKey: true },
    { key: 'Enter', ctrlKey: true }, { key: 'Enter', metaKey: true },
    { key: 'Home' }, { key: 'End' }, { key: 'Escape' }, { key: 'Tab' },
  ]) assert.equal(getConversationSearchAction(event, results, 'page:knowledge'), null)
})

test('no current selection and empty lists are handled without stale indices', () => {
  assert.deepEqual(getConversationSearchAction({ key: 'ArrowDown' }, results, null), { type: 'move', id: 'page:knowledge' })
  assert.deepEqual(getConversationSearchAction({ key: 'ArrowUp' }, results, null), { type: 'move', id: 'chat:two' })
  assert.equal(getConversationSearchAction({ key: 'ArrowDown' }, [], null), null)
})
