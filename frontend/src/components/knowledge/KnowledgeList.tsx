import React, { useState, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { Plus, Upload, Search, MoreVertical, Trash2, ArrowLeft, ChevronRight, Database, FileText, Image as ImageIcon, X, Pencil, Link2, ImagePlus, Loader2, FolderOpen } from 'lucide-react'
import { PortraitGraph } from './PortraitGraph'
import { UploadPipeline, type UploadPipelineProgress } from './UploadPipeline'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { knowledgeApi, importApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import { StatusBadge, FileThumb, FileHero, CreateKbModal, EditKbModal, StatItem } from './KnowledgeListHelpers'

// 文件预览模态框（支持图片描述、文档分块、MD 预览）
function FilePreviewModal({
  file,
  kbId,
  onClose,
  onDelete,
}: {
  file: any
  kbId: string | null
  onClose: () => void
  onDelete: () => void
}) {
  const [tab, setTab] = React.useState<'preview' | 'chunks'>('preview')
  const [details, setDetails] = React.useState<{
    caption?: string
    chunks?: Array<{ index: number; text: string }>
    text_preview?: string
  } | null>(null)
  const [rawContent, setRawContent] = React.useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = React.useState(false)
  const [pdfObjectUrl, setPdfObjectUrl] = React.useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = React.useState(false)

  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(String(file?.type || '').toLowerCase())
  /** PDF、PPTX、DOCX 均可通过 stream 接口以 PDF 形式在页内预览（后端对 PPTX/DOCX 会先转为 PDF） */
  const isPdfOrOfficeViewable = ['pdf', 'pptx', 'docx'].includes(String(file?.type || '').toLowerCase())
  const isMd = String(file?.type || '').toLowerCase() === 'md'
  const isTxt = String(file?.type || '').toLowerCase() === 'txt'
  const isTextFile = isMd || isTxt
  const isDoc = ['pdf', 'docx', 'doc', 'pptx', 'txt', 'md'].includes(String(file?.type || '').toLowerCase())
  const hasChunks = (details?.chunks?.length ?? 0) > 0

  React.useEffect(() => {
    if (!file?.id || !kbId) return
    setLoadingDetails(true)
    setDetails(null)
    setRawContent(null)
    Promise.all([
      knowledgeApi.getFilePreviewDetails(kbId, file.id),
      isTextFile ? knowledgeApi.getFileTextContent(kbId, file.id).then((r) => r?.content ?? null).catch(() => null) : Promise.resolve(null),
    ]).then(([d, content]) => {
      setDetails(d ?? null)
      setRawContent(content ?? null)
    }).catch(() => setDetails(null)).finally(() => setLoadingDetails(false))
  }, [file?.id, kbId, isTextFile])

  // PDF / PPTX / DOCX 使用 stream 接口获取 Blob（PPTX/DOCX 后端会转为 PDF）并生成 object URL，在 iframe 内展示
  const pdfObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!isPdfOrOfficeViewable || !kbId || !file?.id) {
      pdfObjectUrlRef.current = null
      setPdfObjectUrl(null)
      return
    }
    setPdfLoading(true)
    setPdfObjectUrl(null)
    pdfObjectUrlRef.current = null
    knowledgeApi.getFileStream(kbId, file.id)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        pdfObjectUrlRef.current = url
        setPdfObjectUrl(url)
      })
      .catch(() => setPdfObjectUrl(null))
      .finally(() => setPdfLoading(false))
    return () => {
      const url = pdfObjectUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        pdfObjectUrlRef.current = null
      }
      setPdfObjectUrl(null)
    }
  }, [isPdfOrOfficeViewable, kbId, file?.id])

  const textPreview = file?.textPreview ?? details?.text_preview ?? rawContent

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900 flex-shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{file.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
              <span>{String(file.type || '').toUpperCase() || 'FILE'}</span>
              <span className="text-slate-300">·</span>
              <span>{file.size}</span>
              <span className="text-slate-300">·</span>
              <span>{file.date}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 flex-shrink-0"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {(hasChunks || isDoc) && (
          <div className="px-6 pt-4 flex-shrink-0">
            <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setTab('preview')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  tab === 'preview'
                    ? 'bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                )}
                type="button"
              >
                预览
              </button>
              {hasChunks && (
                <button
                  onClick={() => setTab('chunks')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    tab === 'chunks'
                      ? 'bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  )}
                  type="button"
                >
                  分块（{details?.chunks?.length ?? 0}）
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {tab === 'chunks' && hasChunks ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100">
                文档分块
              </div>
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {details!.chunks!.map((c) => (
                  <div key={c.index} className="p-4">
                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">chunk #{c.index}</div>
                    <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {c.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : isImg && file.previewUrl ? (
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                <img src={file.previewUrl} alt={file.name} className="w-full h-auto max-h-[50vh] object-contain" />
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">图片描述</div>
                {loadingDetails ? (
                  <p className="text-sm text-slate-400">加载描述中…</p>
                ) : details?.caption ? (
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{details.caption}</p>
                ) : (
                  <p className="text-sm text-slate-400 italic">暂无描述（若为刚上传的图片，描述生成后刷新预览即可）</p>
                )}
              </div>
            </div>
          ) : isPdfOrOfficeViewable && pdfObjectUrl ? (
            <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <iframe
                title={file.name}
                src={pdfObjectUrl}
                className="w-full h-[60vh] min-h-[400px] max-h-[600px]"
              />
            </div>
          ) : isPdfOrOfficeViewable && pdfLoading ? (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-transparent" />
              <div className="mt-3 text-sm">文档加载中…</div>
            </div>
          ) : textPreview ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">文本预览</div>
              <div className="max-h-[60vh] overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200 leading-relaxed font-sans">
                  {textPreview}
                </pre>
              </div>
            </div>
          ) : loadingDetails && (isTextFile || isImg || isDoc) ? (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
              <div className="mt-3 text-sm">加载预览中…</div>
            </div>
          ) : (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <FileText size={24} />
              </div>
              <div className="mt-3 text-sm">该文件类型暂无预览</div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-white dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-sm font-medium"
            type="button"
          >
            关闭
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
            type="button"
          >
            删除文件
          </button>
        </div>
      </div>
    </div>
  )
}

// 从 URL 导入弹窗
function ImportUrlModal({
  kbId,
  onClose,
  onSuccess,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      setError('请输入 URL')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await importApi.importFromUrl({
        url: url.trim(),
        kb_id: kbId,
        ...(filename.trim() ? { filename: filename.trim() } : {}),
      })
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? '导入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Link2 size={20} /> 从 URL 导入
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/file.pdf"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">文件名（可选）</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="留空则使用 URL 中的文件名"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              导入
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 从文件夹导入弹窗（支持选择本地文件夹 + 输入服务端路径，共用一个导入按钮；本地导入走父组件上传流水线以显示进度）
function ImportFolderModal({
  kbId,
  onClose,
  onSuccess,
  onImportLocalFiles,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
  /** 本地已选文件列表：关闭弹窗并由父组件按「上传流水线」逐个上传，显示每文件进度 */
  onImportLocalFiles: (files: File[]) => void
}) {
  const [folderPath, setFolderPath] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [extensionsStr, setExtensionsStr] = useState('')
  const [excludeStr, setExcludeStr] = useState('')
  const [maxFiles, setMaxFiles] = useState(500)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success_count: number; failed_count: number; total: number } | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[] | null>(null)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [folderProgress, setFolderProgress] = useState<{
    stage: string
    current?: number
    total?: number
    message?: string
    success_count?: number
    failed_count?: number
  } | null>(null)

  const supportsFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  const extensionsList = extensionsStr.trim()
    ? extensionsStr.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null
  const excludeList = excludeStr.trim()
    ? excludeStr.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : null

  function matchesExclude(name: string, patterns: string[] | null): boolean {
    if (!patterns || patterns.length === 0) return false
    for (const p of patterns) {
      if (p.startsWith('*')) {
        if (name.toLowerCase().endsWith(p.slice(1).toLowerCase())) return true
      } else if (p.endsWith('*')) {
        if (name.toLowerCase().startsWith(p.slice(0, -1).toLowerCase())) return true
      } else if (name.includes(p)) return true
    }
    return false
  }

  function matchesExtension(fileName: string, exts: string[] | null): boolean {
    if (!exts || exts.length === 0) return true
    const lower = fileName.toLowerCase()
    return exts.some((e) => (e.startsWith('.') ? lower.endsWith(e) : lower.endsWith('.' + e)))
  }

  const SKIP_SYSTEM_FILES = ['.ds_store', 'thumbs.db', 'desktop.ini']
  function isSystemOrHiddenFile(name: string): boolean {
    const lower = name.toLowerCase()
    if (lower.startsWith('._')) return true
    return SKIP_SYSTEM_FILES.includes(lower)
  }

  async function collectFilesFromHandle(
    handle: FileSystemDirectoryHandle,
    recursive: boolean,
    pathPrefix: string,
    extensions: string[] | null,
    exclude: string[] | null,
    maxFiles: number,
    collected: File[]
  ): Promise<void> {
    if (collected.length >= maxFiles) return
    for await (const entry of (handle as any).values()) {
      if (collected.length >= maxFiles) break
      const name = entry.name
      const relPath = pathPrefix ? `${pathPrefix}/${name}` : name
      if (entry.kind === 'file') {
        if (isSystemOrHiddenFile(name)) continue
        if (matchesExclude(name, exclude)) continue
        if (!matchesExtension(name, extensions)) continue
        try {
          const file = await entry.getFile()
          const fileWithPath = new File([file], relPath, { type: file.type })
          collected.push(fileWithPath)
        } catch (_) {}
        continue
      }
      if (entry.kind === 'directory' && recursive) {
        if (matchesExclude(name, exclude)) continue
        await collectFilesFromHandle(entry, true, relPath, extensions, exclude, maxFiles, collected)
      }
    }
  }

  const handleSelectLocalFolder = async () => {
    if (!supportsFolderPicker) {
      setError('当前浏览器不支持选择文件夹，请使用 Chrome/Edge 或下方输入服务端路径')
      return
    }
    setError(null)
    setResult(null)
    setSelectedFiles(null)
    setPickingFolder(true)
    try {
      const dirHandle = await (window as any).showDirectoryPicker()
      const files: File[] = []
      await collectFilesFromHandle(
        dirHandle,
        recursive,
        '',
        extensionsList,
        excludeList,
        maxFiles,
        files
      )
      setSelectedFiles(files)
      if (files.length === 0) setError('该文件夹下没有符合条件的文件')
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message ?? '选择文件夹失败')
    } finally {
      setPickingFolder(false)
    }
  }

  const handleImport = async () => {
    if (selectedFiles != null && selectedFiles.length > 0) {
      onImportLocalFiles(selectedFiles)
      onClose()
      return
    }
    if (folderPath.trim()) {
      setError(null)
      setResult(null)
      setFolderProgress(null)
      setLoading(true)
      try {
        await importApi.importFromFolderStream(
          {
            folder_path: folderPath.trim(),
            kb_id: kbId,
            recursive,
            extensions: extensionsList && extensionsList.length > 0 ? extensionsList : undefined,
            exclude_patterns: excludeList && excludeList.length > 0 ? excludeList : undefined,
            max_files: maxFiles,
          },
          (event) => {
            if (event.stage === 'scan_complete') {
              setFolderProgress({ stage: 'importing', current: 0, total: event.total ?? 0, message: '开始导入…' })
            } else {
              setFolderProgress(event)
            }
            if (event.stage === 'done') {
              setResult({
                success_count: event.success_count ?? 0,
                failed_count: event.failed_count ?? 0,
                total: event.total ?? 0,
              })
              if ((event.success_count ?? 0) > 0) onSuccess()
            }
          }
        )
      } catch (err: any) {
        setError(err?.response?.data?.detail ?? err?.message ?? '导入失败')
      } finally {
        setLoading(false)
        setFolderProgress(null)
      }
      return
    }
    setError('请先选择本地文件夹或输入服务端路径')
  }

  const canImport = (selectedFiles != null && selectedFiles.length > 0) || folderPath.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-950 z-10">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FolderOpen size={20} /> 从文件夹导入
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {/* 筛选条件：对「选择本地文件夹」和「输入服务端路径」均生效 */}
          <div className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">筛选条件（对下方两种方式均生效）</p>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="folder-recursive"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600"
              />
              <label htmlFor="folder-recursive" className="text-sm text-slate-700 dark:text-slate-200">递归子目录</label>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">文件类型（可选，逗号分隔，如 .pdf,.txt,.md）</label>
              <input
                type="text"
                value={extensionsStr}
                onChange={(e) => setExtensionsStr(e.target.value)}
                placeholder=".pdf, .txt, .md"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">排除模式（可选，逗号分隔）</label>
              <input
                type="text"
                value={excludeStr}
                onChange={(e) => setExcludeStr(e.target.value)}
                placeholder="__pycache__, .git, *.tmp"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">最大文件数</label>
              <input
                type="number"
                min={1}
                max={2000}
                value={maxFiles}
                onChange={(e) => setMaxFiles(Number(e.target.value) || 500)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {/* 选择本地文件夹 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">选择本机文件夹</label>
            <button
              type="button"
              onClick={handleSelectLocalFolder}
              disabled={pickingFolder || loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 transition-colors disabled:opacity-50"
            >
              {pickingFolder ? <Loader2 size={18} className="animate-spin" /> : <FolderOpen size={18} />}
              {pickingFolder ? '正在打开…' : '选择本地文件夹'}
            </button>
            {!supportsFolderPicker && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">需使用 Chrome、Edge 等支持 File System Access 的浏览器</p>
            )}
            {selectedFiles != null && selectedFiles.length > 0 && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">已选择 {selectedFiles.length} 个文件（已按上方筛选条件过滤），点击下方「导入」将关闭弹窗并在本页显示每文件处理进度。</p>
            )}
          </div>

          {/* 或输入服务端路径 */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">或输入服务端路径</label>
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="/data/docs 或白名单内的路径"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          {/* 服务端路径导入进度 */}
          {loading && folderProgress && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                  {folderProgress.stage === 'scanning'
                    ? '正在扫描文件夹…'
                    : folderProgress.stage === 'importing'
                      ? `正在导入 ${folderProgress.current ?? 0}/${folderProgress.total ?? 0}`
                      : '处理中…'}
                </span>
                {folderProgress.total != null && folderProgress.total > 0 && (
                  <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
                    {folderProgress.current ?? 0} / {folderProgress.total}
                  </span>
                )}
              </div>
              {folderProgress.total != null && folderProgress.total > 0 && (
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 dark:bg-indigo-500 transition-all duration-300"
                    style={{
                      width: `${Math.min(100, ((folderProgress.current ?? 0) / folderProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {folderProgress.message && folderProgress.stage === 'importing' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={folderProgress.message}>
                  {folderProgress.message}
                </p>
              )}
            </div>
          )}

          {/* 共用导入按钮 */}
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium">
              取消
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              导入
            </button>
          </div>

          {result != null && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              成功 {result.success_count}，失败 {result.failed_count}，共 {result.total} 个文件。
            </p>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// 按关键词搜索图片导入弹窗（含 Pixabay 筛选、随机性、进度展示）
function ImportSearchModal({
  kbId,
  onClose,
  onSuccess,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'google_images' | 'pixabay' | 'internet_archive'>('pixabay')
  const [quantity, setQuantity] = useState(5)
  const [pixabayImageType, setPixabayImageType] = useState('photo')
  const [pixabayOrder, setPixabayOrder] = useState('popular')
  const [archiveSort, setArchiveSort] = useState('relevance')
  const [randomize, setRandomize] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success_count: number; failed_count: number; total: number; message: string } | null>(null)
  const [progress, setProgress] = useState<{
    stage: string
    current: number
    total: number
    message: string
  } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) {
      setError('请输入搜索关键词')
      return
    }
    setError(null)
    setResult(null)
    setProgress(null)
    setLoading(true)
    try {
      await importApi.importFromSearchStream(
        {
          kb_id: kbId,
          query: query.trim(),
          source,
          quantity: Math.min(20, Math.max(1, quantity)),
          pixabay_image_type: source === 'pixabay' ? pixabayImageType : undefined,
          pixabay_order: source === 'pixabay' ? pixabayOrder : undefined,
          archive_sort: source === 'internet_archive' ? archiveSort : undefined,
          randomize,
        },
        (event) => {
          if (event.stage === 'done') {
            setResult({
              success_count: event.success_count ?? 0,
              failed_count: event.failed_count ?? 0,
              total: event.total ?? 0,
              message: event.message ?? '',
            })
            if ((event.success_count ?? 0) > 0) onSuccess()
            setProgress(null)
          } else if (event.stage === 'error') {
            setError(event.message ?? '导入失败')
            setProgress(null)
          } else {
            setProgress({
              stage: event.stage,
              current: event.current ?? 0,
              total: event.total ?? 0,
              message: event.message ?? '',
            })
          }
        }
      )
    } catch (err: any) {
      setError(err?.message ?? '导入失败')
    } finally {
      setLoading(false)
    }
  }

  const stageLabel =
    progress?.stage === 'searching'
      ? '搜索中…'
      : progress?.stage === 'downloading'
        ? `下载 ${progress.current}/${progress.total}`
        : progress?.stage === 'importing'
          ? `导入 ${progress.current}/${progress.total}`
          : progress?.stage
            ? progress.stage
            : ''

  // 按阶段区分样式：搜索 / 下载 / 导入
  const progressStageStyle =
    progress?.stage === 'searching'
      ? { border: 'border-l-4 border-l-slate-400', bg: 'bg-slate-50 dark:bg-slate-900', bar: 'bg-slate-500 dark:bg-slate-400', tag: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', tagLabel: '搜索' }
      : progress?.stage === 'downloading'
        ? { border: 'border-l-4 border-l-blue-500', bg: 'bg-blue-50/50 dark:bg-blue-950/30', bar: 'bg-blue-500 dark:bg-blue-500', tag: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300', tagLabel: '下载' }
        : progress?.stage === 'importing'
          ? { border: 'border-l-4 border-l-emerald-500', bg: 'bg-emerald-50/50 dark:bg-emerald-950/30', bar: 'bg-emerald-500 dark:bg-emerald-500', tag: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300', tagLabel: '导入' }
          : { border: '', bg: 'bg-slate-50 dark:bg-slate-900', bar: 'bg-indigo-500 dark:bg-indigo-600', tag: '', tagLabel: '' }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ImagePlus size={20} /> 搜索图片导入
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">搜索关键词 *</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：猫、风景"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">渠道</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            >
              <option value="google_images">Google 图片 (SerpAPI)</option>
              <option value="pixabay">Pixabay</option>
              <option value="internet_archive">Internet Archive</option>
            </select>
          </div>
          {source === 'pixabay' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Pixabay 图片类型</label>
                <select
                  value={pixabayImageType}
                  onChange={(e) => setPixabayImageType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  <option value="all">全部</option>
                  <option value="photo">照片</option>
                  <option value="illustration">插画</option>
                  <option value="vector">矢量</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Pixabay 排序</label>
                <select
                  value={pixabayOrder}
                  onChange={(e) => setPixabayOrder(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  <option value="popular">最受欢迎</option>
                  <option value="latest">最新</option>
                </select>
              </div>
            </>
          )}
          {source === 'internet_archive' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Archive 排序</label>
              <select
                value={archiveSort}
                onChange={(e) => setArchiveSort(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
              >
                <option value="relevance">相关度</option>
                <option value="popular">最受欢迎</option>
                <option value="newest">最新</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">数量 (1–20)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 5)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={randomize}
              onChange={(e) => setRandomize(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            增加随机性（同关键词多次搜索得到不同图片）
          </label>
          {progress && (
            <div className={cn('rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2', progressStageStyle.border, progressStageStyle.bg)}>
              <div className="flex items-center justify-between gap-2">
                {progressStageStyle.tagLabel && (
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', progressStageStyle.tag)}>
                    {progressStageStyle.tagLabel}
                  </span>
                )}
                <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 truncate">{stageLabel}</span>
                {progress.total > 0 && (
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400 tabular-nums">{progress.current} / {progress.total}</span>
                )}
              </div>
              {progress.total > 0 && (
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={cn('h-full transition-all duration-300', progressStageStyle.bar)}
                    style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              )}
              {progress.message && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={progress.message}>{progress.message}</p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          {result && (
            <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg">
              {result.message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium">
              {result ? '关闭' : '取消'}
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? (progress ? '处理中…' : '连接中…') : '开始导入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const KnowledgeList: React.FC = () => {
  const [viewState, setViewState] = useState<'list' | 'detail'>('list')
  const [activeKbId, setActiveKbId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileView, setFileView] = useState<'grid' | 'table'>('grid')
  const [previewFile, setPreviewFile] = useState<any>(null)
  const [dragOverlay, setDragOverlay] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadPipelineProgress | undefined>()
  const [currentUploadFiles, setCurrentUploadFiles] = useState<File[] | null>(null)
  const [showImportUrlModal, setShowImportUrlModal] = useState(false)
  const [showImportSearchModal, setShowImportSearchModal] = useState(false)
  const [showImportFolderModal, setShowImportFolderModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState<any[]>([])
  const [kbStats, setKbStats] = useState<{
    documents: number
    chunks: number
    images: number
    text_vector_dim?: number
    image_vector_dim?: number
  } | null>(null)

  const {
    knowledgeBases,
    loading,
    fetchKnowledgeBases,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
  } = useKnowledgeStore()

  const [menuOpenKbId, setMenuOpenKbId] = useState<string | null>(null)
  const [editKb, setEditKb] = useState<{ id: string; name: string; description: string } | null>(null)

  useEffect(() => {
    fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  useEffect(() => {
    if (menuOpenKbId == null) return
    const close = () => setMenuOpenKbId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenKbId])

  const fetchFiles = useCallback(async () => {
    if (!activeKbId) return
    try {
      const res = await knowledgeApi.getKnowledgeBaseFiles(activeKbId)
      const list = (res?.files || []).map((f: { id: string; name: string; size: number; date: string; type: string; preview_url?: string; text_preview?: string }) => ({
        id: f.id,
        name: f.name,
        size: f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`,
        date: f.date ? new Date(f.date).toLocaleDateString() : '-',
        type: f.type,
        status: 'ready',
        previewUrl: f.preview_url,
        textPreview: f.text_preview,
      }))
      setFiles(list)
    } catch {
      setFiles([])
    }
  }, [activeKbId])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) fetchFiles()
  }, [viewState, activeKbId, fetchFiles])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) {
      setKbStats(null)
      knowledgeApi.getKnowledgeBaseStats(activeKbId).then(setKbStats).catch(() => setKbStats(null))
    }
  }, [viewState, activeKbId])

  // 获取当前选中的 KB 对象
  const activeKb = knowledgeBases.find((k) => k.id === activeKbId)

  // 全局拖拽上传遮罩（仅 detail 页可用）
  useEffect(() => {
    let counter = 0
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      counter += 1
      setDragOverlay(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      counter -= 1
      if (counter <= 0) {
        counter = 0
        setDragOverlay(false)
      }
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      counter = 0
      setDragOverlay(false)
      const fileList = e.dataTransfer?.files
      if (!fileList || fileList.length === 0) return
      if (viewState !== 'detail' || !activeKbId) return
      const fileArray = Array.from(fileList).slice(0, 10)
      handleFileUpload(fileArray)
    }

    if (viewState === 'detail') {
      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)
    }

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [viewState, activeKbId])

  // 处理创建 KB
  const handleCreateKb = async (name: string, desc: string) => {
    try {
      await createKnowledgeBase({ name, description: desc })
      setShowCreateModal(false)
    } catch (error) {
      console.error('创建知识库失败:', error)
    }
  }

  const getFileType = (file: File) => {
    const name = file.name.toLowerCase()
    const ext = name.includes('.') ? name.split('.').pop() || '' : ''
    if (ext) return ext
    if (file.type.startsWith('image/')) return 'jpg'
    return 'txt'
  }

  // 处理文件上传（逐个上传，保证进度正确）
  const handleFileUpload = async (fileList: File[]) => {
    if (!activeKbId || fileList.length === 0) return
    setCurrentUploadFiles(fileList)
    setUploading(true)
    setUploadProgress({
      stage: 'minio',
      stageProgress: 0,
      total: fileList.length,
      completed: 0,
      failed: 0,
      currentFile: fileList[0]?.name,
      currentFileIsImage: fileList[0]?.type.startsWith('image/'),
    })

    let completed = 0
    let failed = 0

    try {
      for (const file of fileList) {
        const isImage = file.type.startsWith('image/')
        const fileType = getFileType(file)

        flushSync(() => {
          setUploadProgress((prev) => ({
            ...(prev || {
              total: fileList.length,
              completed: 0,
              failed: 0,
              stageProgress: 0,
              stage: 'minio',
            }),
            currentFile: file.name,
            currentFileIsImage: isImage,
            stage: 'minio',
            stageProgress: 0,
          }))
        })
        await new Promise((r) => setTimeout(r, 0))

        try {
          await knowledgeApi.uploadSingleFileStream(activeKbId, file, fileType, (status) => {
            // 流式进度：后端 stage 映射到前端，且只前进不后退，与真实流程一致
            const stage = status.stage
            const progress = status.progress ?? 0
            const frontStage: UploadPipelineProgress['stage'] | null =
              stage === 'initializing' || stage === 'uploading'
                ? 'minio'
                : stage === 'parsing' || stage === 'processing'
                  ? 'parsing'
                  : stage === 'vectorizing'
                    ? 'vectorizing'
                    : stage === 'completed'
                      ? 'portrait'
                      : null
            if (frontStage === null) return
            const stageOrder: Record<UploadPipelineProgress['stage'], number> = {
              idle: -1,
              minio: 0,
              parsing: 1,
              vectorizing: 2,
              portrait: 3,
              done: 4,
            }
            flushSync(() => {
              setUploadProgress((prev) => {
                if (!prev) return prev
                const currentIndex = stageOrder[prev.stage] ?? -1
                const newIndex = stageOrder[frontStage]
                if (newIndex < currentIndex) return prev
                return {
                  ...prev,
                  stage: frontStage,
                  stageProgress: progress,
                  currentFile: file.name,
                  currentFileIsImage: isImage,
                }
              })
            })
          })
          completed += 1
          flushSync(() => {
            setUploadProgress((prev) => ({
              ...(prev || {
                total: fileList.length,
                completed,
                failed,
              }),
              completed,
              failed,
              stage: 'portrait',
              stageProgress: 100,
            }))
          })
          await new Promise((r) => setTimeout(r, 0))
        } catch (e) {
          console.error('上传失败', e)
          failed += 1
          flushSync(() => {
            setUploadProgress((prev) => (prev ? { ...prev, failed } : prev))
          })
        }
      }

      setUploadProgress((prev) => ({
        ...(prev || {
          total: fileList.length,
          completed,
          failed,
        }),
        stage: 'done',
        stageProgress: 100,
        completed,
        failed,
      }))
      await fetchKnowledgeBases()
      await fetchFiles()
    } finally {
      setUploading(false)
      setCurrentUploadFiles(null)
      setTimeout(() => setUploadProgress(undefined), 2000)
    }
  }

  const handleDeleteKb = async (kbId: string) => {
    setMenuOpenKbId(null)
    const kb = knowledgeBases.find((k) => k.id === kbId)
    const ok = window.confirm(`确定删除知识库「${kb?.name || kbId}」？此操作不可撤销。`)
    if (!ok) return
    try {
      await deleteKnowledgeBase(kbId)
      if (activeKbId === kbId) {
        setActiveKbId(null)
        setViewState('list')
      }
    } catch (error) {
      console.error('删除知识库失败:', error)
    }
  }

  const handleSaveEdit = async (id: string, name: string, description: string) => {
    try {
      await updateKnowledgeBase(id, { name, description })
      setEditKb(null)
    } catch (error) {
      console.error('更新知识库失败:', error)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!activeKbId) return
    const ok = window.confirm('确定删除该文件？')
    if (!ok) return
    try {
      await knowledgeApi.deleteKnowledgeBaseFile(activeKbId, fileId)
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      await fetchKnowledgeBases()
    } catch (e) {
      console.error('删除文件失败', e)
    }
  }

  // --- KB 列表视图 ---
  if (viewState === 'list') {
    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative">
        {/* Header */}
        <div className="relative px-8 py-7 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/70 via-white to-fuchsia-50/70 dark:from-indigo-950/30 dark:via-slate-950 dark:to-fuchsia-950/30" />
          <div className="absolute -top-14 -left-10 h-40 w-40 rounded-full bg-indigo-200/40 blur-3xl dark:bg-indigo-500/20" />
          <div className="absolute -bottom-16 right-6 h-44 w-44 rounded-full bg-fuchsia-200/40 blur-3xl dark:bg-fuchsia-500/20" />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">知识库</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">管理数据集、上传文件并查看索引状态。</p>
            </div>
            <div className="pt-1">
              <button
                onClick={() => setShowCreateModal(true)}
                className="group inline-flex items-center gap-2 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white px-4 py-2.5 rounded-xl hover:from-indigo-500 hover:to-fuchsia-500 transition-all shadow-md shadow-fuchsia-600/20 font-medium text-sm hover:-translate-y-0.5"
              >
                <Plus size={18} className="transition-transform group-hover:rotate-90" /> 新建知识库
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded mb-2"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                </div>
              ))}
            </div>
          ) : knowledgeBases.length === 0 ? (
            <div className="col-span-full text-center py-20 text-slate-400">
              <Database size={48} className="mx-auto mb-4 opacity-20" />
              <p>暂无知识库，先新建一个开始。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {knowledgeBases.map((kb) => (
                <div
                  key={kb.id}
                  onClick={() => {
                    setActiveKbId(kb.id)
                    setViewState('detail')
                  }}
                  className={cn(
                    'relative rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-fuchsia-300 dark:hover:border-fuchsia-500 transition-all cursor-pointer group overflow-hidden min-h-[180px]',
                    kb.cover_url ? 'p-0' : 'bg-white dark:bg-slate-900 p-5'
                  )}
                >
                  {/* 有封面时：图片铺满整卡作为背景 */}
                  {kb.cover_url ? (
                    <>
                      <div className="absolute inset-0">
                        <img
                          src={kb.cover_url}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent rounded-xl" />
                      <div className="relative z-10 flex flex-col min-h-[180px] p-5">
                        {/* 设置按钮放在右下角，不遮挡封面图节点与左侧文件数 */}
                        <div className="absolute bottom-3 right-3 pointer-events-none">
                          <div className="pointer-events-auto relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuOpenKbId((id) => (id === kb.id ? null : kb.id))
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white/90 shadow-md backdrop-blur-sm transition-all hover:bg-white/25 hover:text-white hover:border-white/40 active:scale-95"
                              title="更多操作"
                            >
                              <MoreVertical size={16} strokeWidth={2} />
                            </button>
                            {menuOpenKbId === kb.id && (
                              <div
                                className="absolute right-0 bottom-full mb-1.5 py-1 min-w-[120px] rounded-xl bg-white/95 dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 shadow-xl backdrop-blur-sm z-50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditKb({ id: kb.id, name: kb.name, description: kb.description ?? '' })
                                    setMenuOpenKbId(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 rounded-t-xl first:pt-2.5"
                                >
                                  <Pencil size={14} /> 编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteKb(kb.id)}
                                  className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 rounded-b-xl last:pb-2.5"
                                >
                                  <Trash2 size={14} /> 删除
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* 顶部弹性空间，把标题/描述整体压到下方 */}
                        <div className="min-h-0 flex-1" />
                        <div className="flex-shrink-0 pt-8">
                          <h3 className="font-bold text-white mb-1 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.7)]">
                            {kb.name}
                          </h3>
                          <p className="text-white text-sm h-9 overflow-hidden text-ellipsis leading-relaxed line-clamp-2 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_6px_rgba(0,0,0,0.6)]">
                            {kb.description || '暂无描述'}
                          </p>
                          <div className="mt-1.5 pt-2 pr-11 border-t border-white/30 flex items-center justify-between text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
                            <div className="flex items-center gap-2 min-h-[1rem]">
                              <span className="inline-flex items-center gap-1.5">
                                <FileText size={12} className="shrink-0" />
                                {kb.stats?.documents ?? 0} 个文件
                              </span>
                              <span className="opacity-80">·</span>
                              <span className="inline-flex items-center gap-1.5">
                                <ImageIcon size={12} className="shrink-0" />
                                {kb.stats?.images ?? 0} 张图片
                              </span>
                            </div>
                            <span>{kb.updated_at ? new Date(kb.updated_at).toLocaleDateString() : '未知'}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 rounded-lg group-hover:bg-gradient-to-tr group-hover:from-indigo-600 group-hover:to-fuchsia-600 group-hover:text-white transition-colors">
                          <Database size={24} />
                        </div>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpenKbId((id) => (id === kb.id ? null : kb.id))
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 shadow-sm transition-all hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-500 active:scale-95"
                            title="更多操作"
                          >
                            <MoreVertical size={16} strokeWidth={2} />
                          </button>
                          {menuOpenKbId === kb.id && (
                            <div
                              className="absolute right-0 top-full mt-1.5 py-1 min-w-[120px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl z-50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditKb({ id: kb.id, name: kb.name, description: kb.description ?? '' })
                                  setMenuOpenKbId(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 rounded-t-xl first:pt-2.5"
                              >
                                <Pencil size={14} /> 编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteKb(kb.id)}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 rounded-b-xl last:pb-2.5"
                              >
                                <Trash2 size={14} /> 删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1">{kb.name}</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-sm h-10 overflow-hidden text-ellipsis leading-relaxed line-clamp-2">
                        {kb.description || '暂无描述'}
                      </p>
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-2 min-h-[1rem]">
                          <span className="inline-flex items-center gap-1.5">
                            <FileText size={12} className="shrink-0" />
                            {kb.stats?.documents ?? 0} 个文件
                          </span>
                          <span className="opacity-70">·</span>
                          <span className="inline-flex items-center gap-1.5">
                            <ImageIcon size={12} className="shrink-0" />
                            {kb.stats?.images ?? 0} 张图片
                          </span>
                        </div>
                        <span>{kb.updated_at ? new Date(kb.updated_at).toLocaleDateString() : '未知'}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Modal */}
        {showCreateModal && (
          <CreateKbModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateKb}
          />
        )}

        {/* Edit Modal */}
        {editKb && (
          <EditKbModal
            kb={editKb}
            onClose={() => setEditKb(null)}
            onSave={handleSaveEdit}
          />
        )}

        {dragOverlay && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">拖拽上传</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                进入某个知识库详情页后松手即可上传
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- KB 详情视图 ---
  if (viewState === 'detail' && activeKb) {
    const filteredFiles = files.filter((f) => {
      if (!fileQuery.trim()) return true
      return f.name.toLowerCase().includes(fileQuery.trim().toLowerCase())
    })

    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative">
        {/* Header with Breadcrumb */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-4">
          <button
            onClick={() => setViewState('list')}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-full text-slate-500 dark:text-slate-300 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span className="cursor-pointer hover:text-blue-600" onClick={() => setViewState('list')}>
                知识库
              </span>
              <ChevronRight size={12} />
              <span>详情</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
              {activeKb.name}
              <span className="text-xs font-normal px-2 py-0.5 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-full border border-green-200 dark:border-green-800">
                可用
              </span>
            </h2>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 上传与导入 */}
            <div className="space-y-4">
              <UploadPipeline
                onFileSelect={handleFileUpload}
                isUploading={uploading}
                uploadProgress={uploadProgress}
                externalFiles={currentUploadFiles}
              />
              {/* 自动导入：卡片式入口 */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  自动导入
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setShowImportUrlModal(true)}
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/80 dark:hover:bg-blue-950/40 hover:shadow hover:-translate-y-0.5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                      <Link2 size={18} />
                    </span>
                    从 URL 导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImportSearchModal(true)}
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50/80 dark:hover:bg-violet-950/40 hover:shadow hover:-translate-y-0.5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">
                      <ImagePlus size={18} />
                    </span>
                    搜索图片导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImportFolderModal(true)}
                    className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all hover:border-amber-300 dark:hover:border-amber-600 hover:bg-amber-50/80 dark:hover:bg-amber-950/40 hover:shadow hover:-translate-y-0.5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                      <FolderOpen size={18} />
                    </span>
                    从文件夹导入
                  </button>
                </div>
              </div>
            </div>

            {/* File List */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">文件列表（{files.length}）</h3>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                      onClick={() => setFileView('grid')}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        fileView === 'grid'
                          ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      )}
                      type="button"
                      title="画廊视图"
                    >
                      画廊
                    </button>
                    <button
                      onClick={() => setFileView('table')}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        fileView === 'table'
                          ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      )}
                      type="button"
                      title="列表视图"
                    >
                      列表
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
                    <Search size={14} />
                    <input
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      type="text"
                      placeholder="搜索文件..."
                      className="bg-transparent outline-none w-36 text-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {fileView === 'table' ? (
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-6 py-3 font-medium">文件名</th>
                      <th className="px-6 py-3 font-medium">大小</th>
                      <th className="px-6 py-3 font-medium">状态</th>
                      <th className="px-6 py-3 font-medium">日期</th>
                      <th className="px-6 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredFiles.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                          {files.length === 0 ? '暂无文件，先上传一个。' : '没有匹配的搜索结果。'}
                        </td>
                      </tr>
                    ) : (
                      filteredFiles.map((file) => (
                        <tr key={file.id} className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-200">
                            <button
                              onClick={() => setPreviewFile(file)}
                              className="flex items-center gap-3 hover:underline text-left"
                              type="button"
                              title="预览"
                            >
                              <FileThumb file={file} />
                              <span className="truncate max-w-[420px]">{file.name}</span>
                            </button>
                          </td>
                          <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{file.size}</td>
                          <td className="px-6 py-4">
                            <StatusBadge status={file.status} />
                          </td>
                          <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{file.date}</td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleDeleteFile(file.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                              title="删除文件"
                              type="button"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <div className="p-6">
                  {filteredFiles.length === 0 ? (
                    <div className="py-10 text-center text-slate-400">
                      {files.length === 0 ? '暂无文件，先上传一个。' : '没有匹配的搜索结果。'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredFiles.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => setPreviewFile(file)}
                          className="text-left bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-fuchsia-300 dark:hover:border-fuchsia-500 hover:shadow-sm transition-all overflow-hidden group"
                          type="button"
                          title="点击预览"
                        >
                          <div className="relative">
                            <div className="h-36 bg-slate-50 dark:bg-slate-900 overflow-hidden flex items-center justify-center">
                              <FileHero file={file} />
                            </div>
                            <div className="absolute top-3 left-3">
                              <StatusBadge status={file.status} />
                            </div>
                          </div>
                          <div className="p-4">
                            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">{file.name}</div>
                            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                              <span>{file.size}</span>
                              <span>{file.date}</span>
                            </div>
                            <div className="mt-3 flex justify-end">
                              <span className="text-xs text-slate-400 group-hover:text-fuchsia-600 transition-colors">
                                点击查看详情
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Portrait Graph（使用从向量库获取的统计） */}
            <PortraitGraph
              knowledgeBaseId={activeKb.id}
              documentCount={kbStats?.documents ?? activeKb.stats?.documents ?? 0}
              textCount={kbStats?.chunks ?? activeKb.stats?.chunks ?? 0}
              imageCount={kbStats?.images ?? activeKb.stats?.images ?? 0}
              onClusterSelect={() => {}}
            />
          </div>

          {/* Detail Sidebar (Stats，结合向量库数据) */}
          <div className="w-72 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 hidden xl:block">
            <h4 className="font-semibold text-slate-800 dark:text-slate-100 mb-4">知识库统计</h4>
            <div className="space-y-4">
              <StatItem label="Documents" value={kbStats?.documents ?? activeKb.stats?.documents ?? 0} />
              <StatItem label="Total Chunks" value={kbStats?.chunks ?? activeKb.stats?.chunks ?? 0} />
              <StatItem label="Total Images" value={kbStats?.images ?? activeKb.stats?.images ?? 0} />
              <StatItem
                label="Vector Dim"
                value={
                  kbStats?.text_vector_dim != null && kbStats?.image_vector_dim != null
                    ? `文本 ${kbStats.text_vector_dim} / 图片 ${kbStats.image_vector_dim}`
                    : '文本 4096 / 图片 768'
                }
              />
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => handleDeleteKb(activeKbId!)}
                className="w-full py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
              >
                删除知识库
              </button>
            </div>
          </div>
        </div>

        {/* 预览弹窗 */}
        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            kbId={activeKbId}
            onClose={() => setPreviewFile(null)}
            onDelete={() => {
              handleDeleteFile(previewFile.id)
              setPreviewFile(null)
            }}
          />
        )}

        {/* 从 URL 导入弹窗 */}
        {showImportUrlModal && activeKbId && (
          <ImportUrlModal
            kbId={activeKbId}
            onClose={() => setShowImportUrlModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
          />
        )}

        {/* 搜索图片导入弹窗 */}
        {showImportSearchModal && activeKbId && (
          <ImportSearchModal
            kbId={activeKbId}
            onClose={() => setShowImportSearchModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
          />
        )}

        {/* 从文件夹导入弹窗 */}
        {showImportFolderModal && activeKbId && (
          <ImportFolderModal
            kbId={activeKbId}
            onClose={() => setShowImportFolderModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onImportLocalFiles={(files) => {
              setShowImportFolderModal(false)
              handleFileUpload(files)
            }}
          />
        )}

        {dragOverlay && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">松手上传到当前知识库</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">最多一次 10 个文件</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-950">
      未找到该知识库，可能已被删除。
    </div>
  )
}

export default KnowledgeList
