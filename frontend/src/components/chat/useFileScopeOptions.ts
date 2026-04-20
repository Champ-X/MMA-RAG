import { useCallback, useEffect, useMemo, useState } from 'react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'

export interface KnowledgeBaseFileItem {
  id: string
  name: string
  size: number
  date: string
  type: string
}

export function fileScopeKey(kbId: string, fileId: string) {
  return `${kbId}::${fileId}`
}

export function formatScopedFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value >= 10 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`
}

function isSelectableFile(file: KnowledgeBaseFileItem) {
  return !file.id.includes('/keyframes/')
}

function sortFiles(files: KnowledgeBaseFileItem[]) {
  return [...files].sort((a, b) => {
    const dateDelta = new Date(b.date).getTime() - new Date(a.date).getTime()
    if (Number.isFinite(dateDelta) && dateDelta !== 0) return dateDelta
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

export function useFileScopeOptions(active = true) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const [filesByKb, setFilesByKb] = useState<Record<string, KnowledgeBaseFileItem[]>>({})
  const [loadingKbIds, setLoadingKbIds] = useState<string[]>([])

  useEffect(() => {
    if (!active) return
    void fetchKnowledgeBases()
  }, [active, fetchKnowledgeBases])

  const loadKbFiles = useCallback(async (kbId: string) => {
    if (!kbId) return
    if (filesByKb[kbId]) return
    setLoadingKbIds(prev => (prev.includes(kbId) ? prev : [...prev, kbId]))
    try {
      const res = await knowledgeApi.getKnowledgeBaseFiles(kbId)
      const list = Array.isArray(res?.files) ? res.files : []
      const normalized = sortFiles(
        list
          .map((file): KnowledgeBaseFileItem => ({
            id: String(file.id ?? ''),
            name: String(file.name ?? ''),
            size: Number(file.size ?? 0),
            date: String(file.date ?? ''),
            type: String(file.type ?? ''),
          }))
          .filter(file => file.id && file.name)
          .filter(isSelectableFile)
      )
      setFilesByKb(prev => ({ ...prev, [kbId]: normalized }))
    } finally {
      setLoadingKbIds(prev => prev.filter(id => id !== kbId))
    }
  }, [filesByKb])

  const ensureAllKbFiles = useCallback(async () => {
    const targets = knowledgeBases
      .map(kb => kb.id)
      .filter(kbId => !filesByKb[kbId] && !loadingKbIds.includes(kbId))
    if (targets.length === 0) return
    await Promise.all(targets.map(kbId => loadKbFiles(kbId)))
  }, [knowledgeBases, filesByKb, loadingKbIds, loadKbFiles])

  const allFiles = useMemo(() => {
    return knowledgeBases.flatMap(kb =>
      (filesByKb[kb.id] ?? []).map(file => ({
        kbId: kb.id,
        kbName: kb.name,
        file,
      }))
    )
  }, [knowledgeBases, filesByKb])

  const hasLoadedFilesForKb = useCallback(
    (kbId: string) => Object.prototype.hasOwnProperty.call(filesByKb, kbId),
    [filesByKb]
  )

  return {
    knowledgeBases,
    filesByKb,
    loadingKbIds,
    allFiles,
    loadKbFiles,
    ensureAllKbFiles,
    hasLoadedFilesForKb,
  }
}

