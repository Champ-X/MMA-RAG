import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareUploadReceipts } from '../src/lib/desktopUploadReceipts'

test('unacknowledged folder entries keep IDs across restarts and explicit new imports get new IDs', () => {
  const data = new Map<string, string>()
  const store = {
    getItem(key: string) { return data.get(key) ?? null },
    setItem(key: string, value: string) { data.set(key, value) },
    removeItem(key: string) { data.delete(key) },
  } as Storage
  const file = new File(['body'], 'part/doc.md', { lastModified: 12345 })
  const submit = (workspace = 'workspace') => prepareUploadReceipts(store, workspace, 'kb', [file, file])
  const first = submit()
  assert.notEqual(first.ids[0], first.ids[1])
  assert.deepEqual(submit().ids, first.ids)
  assert.notDeepEqual(submit('other-workspace').ids, first.ids)
  first.acknowledge()
  assert.notDeepEqual(submit().ids, first.ids)
})
