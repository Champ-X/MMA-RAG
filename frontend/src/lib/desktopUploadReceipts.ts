/** Persist client-assigned operation IDs until the server acknowledges each submission.
 * The knowledge-base list already reloads accepted tasks from the server after a restart.
 */
export function prepareUploadReceipts(
  storage: Storage, workspaceId: string, kbId: string, files: File[], sourceType = '',
) {
  const occurrences = new Map<string, number>()
  const entries = files.map(file => {
    const identity = JSON.stringify([workspaceId, kbId, sourceType, file.name, file.size, file.lastModified])
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    const key = 'tessmora.upload.pending.' + identity + '.' + occurrence
    const id = storage.getItem(key) || crypto.randomUUID()
    storage.setItem(key, id)
    return { key, id }
  })
  return {
    ids: entries.map(entry => entry.id),
    acknowledge() {
      for (const { key, id } of entries) {
        if (storage.getItem(key) === id) storage.removeItem(key)
      }
    },
  }
}
