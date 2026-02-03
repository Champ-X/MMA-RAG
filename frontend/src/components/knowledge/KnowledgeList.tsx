import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Upload, Search, MoreVertical, Trash2, ArrowLeft, ChevronRight, Database, FileText, Image as ImageIcon, X, Pencil } from 'lucide-react'
import { PortraitGraph } from './PortraitGraph'
import { UploadPipeline, type UploadPipelineProgress } from './UploadPipeline'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { knowledgeApi } from '@/services/api_client'
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

  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(String(file?.type || '').toLowerCase())
  const isPdf = String(file?.type || '').toLowerCase() === 'pdf'
  const isMd = String(file?.type || '').toLowerCase() === 'md'
  const isTxt = String(file?.type || '').toLowerCase() === 'txt'
  const isTextFile = isMd || isTxt
  const isDoc = ['pdf', 'docx', 'doc', 'txt', 'md'].includes(String(file?.type || '').toLowerCase())
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
          ) : isPdf && file.previewUrl ? (
            <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <iframe
                title={file.name}
                src={file.previewUrl}
                className="w-full h-[60vh] min-h-[400px] max-h-[600px]"
              />
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

const KnowledgeList: React.FC = () => {
  const [viewState, setViewState] = useState<'list' | 'detail'>('list')
  const [activeKbId, setActiveKbId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileView, setFileView] = useState<'grid' | 'table'>('grid')
  const [previewFile, setPreviewFile] = useState<any>(null)
  const [dragOverlay, setDragOverlay] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadPipelineProgress | undefined>()
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

  // 处理文件上传
  const handleFileUpload = async (fileList: File[]) => {
    if (!activeKbId || fileList.length === 0) return
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

    try {
      await knowledgeApi.uploadFiles(activeKbId, fileList, (pct) => {
        setUploadProgress((prev) => ({
          ...prev!,
          stage: pct >= 100 ? 'portrait' : pct >= 66 ? 'vectorizing' : pct >= 33 ? 'parsing' : 'minio',
          stageProgress: pct,
          completed: pct >= 100 ? fileList.length : 0,
        }))
      })
      setUploadProgress((prev) => ({
        ...prev!,
        stage: 'done',
        stageProgress: 100,
        completed: fileList.length,
      }))
      await fetchKnowledgeBases()
      await fetchFiles()
    } catch (e) {
      console.error('上传失败', e)
      setUploadProgress((prev) => (prev ? { ...prev, failed: prev.failed + 1 } : undefined))
    } finally {
      setUploading(false)
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
        <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">知识库</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">管理数据集、上传文件并查看索引状态。</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white px-4 py-2 rounded-lg hover:from-indigo-500 hover:to-fuchsia-500 transition-colors shadow-sm shadow-fuchsia-600/10 font-medium text-sm"
          >
            <Plus size={18} /> 新建知识库
          </button>
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
                        <div className="flex-shrink-0 pt-6">
                          <h3 className="font-bold text-white mb-0.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.7)]">
                            {kb.name}
                          </h3>
                          <p className="text-white text-sm h-10 overflow-hidden text-ellipsis leading-relaxed line-clamp-2 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_6px_rgba(0,0,0,0.6)]">
                            {kb.description || '暂无描述'}
                          </p>
                          <div className="mt-3 pt-3 pr-11 border-t border-white/30 flex items-center justify-between text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
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
            {/* 统一上传入口（带进度） */}
            <UploadPipeline
              onFileSelect={handleFileUpload}
              isUploading={uploading}
              uploadProgress={uploadProgress}
            />

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
