import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { knowledgeApi } from '@/services/api_client'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'

export interface KnowledgeBaseFileItem {
  id: string
  name: string
  size: number
  date: string
  type: string
  status?: string
  previewUrl?: string
  coverUrl?: string
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
  // MinIO 中存在原始视频并不代表 Scene–Shot 已入库；未完成解析的文件不应进入
  // 文件范围检索器，否则用户会选中一个永远召回不到内容的文件。
  return !file.id.includes('/keyframes/') && (!file.status || file.status === 'ready')
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
  const [failedKbIds, setFailedKbIds] = useState<string[]>([])
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    if (!active) return
    void fetchKnowledgeBases({ silent: true })
  }, [active, fetchKnowledgeBases])

  const loadKbFiles = useCallback(async (kbId: string) => {
    if (!kbId) return
    if (filesByKb[kbId] || inFlight.current.has(kbId)) return
    inFlight.current.add(kbId)
    setFailedKbIds(prev => prev.filter(id => id !== kbId))
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
            status: String(file.status ?? 'ready'),
            previewUrl: file.preview_url || undefined,
            coverUrl: file.cover_url || undefined,
          }))
          .filter(file => file.id && file.name)
          .filter(isSelectableFile)
      )
      setFilesByKb(prev => ({ ...prev, [kbId]: normalized }))
    } catch (error) {
      setFailedKbIds(prev => prev.includes(kbId) ? prev : [...prev, kbId])
      throw error
    } finally {
      inFlight.current.delete(kbId)
      setLoadingKbIds(prev => prev.filter(id => id !== kbId))
    }
  }, [filesByKb])

  const ensureAllKbFiles = useCallback(async (retryFailed = false) => {
    const targets = knowledgeBases
      .map(kb => kb.id)
      .filter(kbId => !filesByKb[kbId] && !loadingKbIds.includes(kbId) && (retryFailed || !failedKbIds.includes(kbId)))
    if (targets.length === 0) return
    await Promise.allSettled(targets.map(kbId => loadKbFiles(kbId)))
  }, [knowledgeBases, filesByKb, loadingKbIds, failedKbIds, loadKbFiles])

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
    failedKbIds,
    allFiles,
    loadKbFiles,
    ensureAllKbFiles,
    hasLoadedFilesForKb,
  }
}
