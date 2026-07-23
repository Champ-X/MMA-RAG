import { useId, useState, useEffect } from 'react'
import { X, CheckCircle, Loader2, AlertCircle, Image as ImageIcon, FileText, FileCode, Presentation, FileSpreadsheet, Database, Sparkles, Type, Pencil, Check, Music, Video } from 'lucide-react'
import { cn } from '@/lib/utils'

// 状态徽章
export function StatusBadge({ status }: { status: string }) {
  if (status === 'ready') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800"
        aria-label="文件状态：就绪"
      >
        <CheckCircle size={10} aria-hidden /> 就绪
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
        role="status"
        aria-label="文件状态：处理中"
      >
        <Loader2 size={10} className="animate-spin" aria-hidden /> 处理中
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800"
        aria-label="文件状态：解析失败"
      >
        <AlertCircle size={10} aria-hidden /> 解析失败
      </span>
    )
  }
  if (status === 'unindexed') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
        aria-label="文件状态：未完成解析"
      >
        <AlertCircle size={10} aria-hidden /> 未完成解析
      </span>
    )
  }
  return <span className="text-slate-400 text-xs" aria-label="文件状态：未知">Unknown</span>
}

// 文件类型图标配置：不同文档类型使用不同图标与配色，便于一眼区分
const FILE_ICON_SIZE_DEFAULT = 16
/** 与文件列表 FileThumb / FileHero 一致的类型图标（扩展名或 MIME 映射后的短类型） */
export function FileIcon({ type, size = FILE_ICON_SIZE_DEFAULT }: { type: string; size?: number }) {
  const lowerType = String(type || '').toLowerCase()
  const s = size

  // 图片
  if (['jpg', 'png', 'jpeg', 'gif', 'webp', 'tiff', 'tif'].includes(lowerType)) {
    return <ImageIcon size={s} className="text-purple-500" aria-hidden />
  }
  // PDF
  if (lowerType === 'pdf') {
    return <FileText size={s} className="text-red-500" aria-hidden />
  }
  // Markdown / 代码类
  if (['md', 'markdown', 'txt', 'json', 'xml', 'html', 'htm', 'yml', 'yaml'].includes(lowerType)) {
    return <FileCode size={s} className="text-amber-600 dark:text-amber-400" aria-hidden />
  }
  // PowerPoint
  if (['pptx', 'ppt'].includes(lowerType)) {
    return <Presentation size={s} className="text-orange-600 dark:text-orange-400" aria-hidden />
  }
  // Word
  if (['docx', 'doc'].includes(lowerType)) {
    return <FileText size={s} className="text-blue-600 dark:text-blue-400" aria-hidden />
  }
  // Excel / 表格
  if (['xlsx', 'xls', 'csv'].includes(lowerType)) {
    return <FileSpreadsheet size={s} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
  }
  // 音频
  if (lowerType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'].includes(lowerType)) {
    return <Music size={s} className="text-violet-600 dark:text-violet-400" aria-hidden />
  }
  // 视频
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(lowerType)) {
    return <Video size={s} className="text-sky-600 dark:text-sky-400" aria-hidden />
  }
  // 默认文档
  return <FileText size={s} className="text-slate-500 dark:text-slate-400" aria-hidden />
}

function isImageType(type: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif'].includes(String(type || '').toLowerCase())
}

export function isAudioType(type: string): boolean {
  const lower = String(type || '').toLowerCase()
  return lower.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'].includes(lower)
}

export function isVideoType(type: string): boolean {
  const lower = String(type || '').toLowerCase()
  return ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(lower)
}

// 文件缩略图（表格视图）
export interface KnowledgeFileView {
  id: string
  name: string
  size: string
  date: string
  type: string
  status: string
  previewUrl?: string
  textPreview?: string
}

export function FileThumb({ file }: { file: KnowledgeFileView }) {
  const isImg = isImageType(file?.type)
  if (isImg && file?.previewUrl) {
    return (
      <img
        src={file.previewUrl}
        alt={file.name}
        className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        loading="lazy"
      />
    )
  }
  return (
    <span
      className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-500"
      aria-label={`文件类型：${String(file?.type || 'file').toUpperCase()}`}
    >
      <FileIcon type={file?.type} />
    </span>
  )
}

// 画廊卡片用图标尺寸，更大更易辨认
const FILE_HERO_ICON_SIZE = 40

// 按文件类型返回卡片图标区域的背景样式（浅色强调）
function getFileHeroIconBg(type: string): string {
  const lower = String(type || '').toLowerCase()
  if (['jpg', 'png', 'jpeg', 'gif', 'webp', 'tiff', 'tif'].includes(lower)) return 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800'
  if (lower === 'pdf') return 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
  if (['md', 'markdown', 'txt', 'json', 'xml', 'html', 'htm', 'yml', 'yaml'].includes(lower)) return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
  if (['pptx', 'ppt'].includes(lower)) return 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800'
  if (['docx', 'doc'].includes(lower)) return 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'
  if (['xlsx', 'xls', 'csv'].includes(lower)) return 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
  if (lower.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'].includes(lower)) {
    return 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800'
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(lower)) {
    return 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800'
  }
  return 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
}

// 文件主图（画廊视图）
export function FileHero({ file }: { file: KnowledgeFileView }) {
  const isImg = isImageType(file?.type)
  const isAudio = isAudioType(file?.type)
  const isVideo = isVideoType(file?.type)
  if (isImg && file?.previewUrl) {
    return (
      <img
        src={file.previewUrl}
        alt={file.name}
        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
        loading="lazy"
      />
    )
  }
  return (
    <div className="flex flex-col items-center justify-center text-slate-400" role="img" aria-label={`文件类型：${isAudio ? '音频' : isVideo ? '视频' : String(file?.type || 'file').toUpperCase()}`}>
      <div className={cn('p-4 rounded-xl border', getFileHeroIconBg(file?.type))}>
        <FileIcon type={file?.type} size={FILE_HERO_ICON_SIZE} />
      </div>
      {(isAudio || isVideo) && (
        <div className="mt-2 flex items-end gap-0.5 h-3" aria-hidden>
          {[0.4, 0.7, 1, 0.6, 0.9].map((h, i) => (
            <span
              key={i}
              className={cn(
                'w-1 rounded-full min-h-[4px] group-hover:opacity-90 transition-opacity',
                isVideo ? 'bg-sky-400/70 dark:bg-sky-400/60' : 'bg-violet-400/70 dark:bg-violet-400/60'
              )}
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>
      )}
      <div className={cn('text-xs font-medium text-slate-500 dark:text-slate-400', (isAudio || isVideo) ? 'mt-1' : 'mt-2')}>
        {isAudio ? '音频' : isVideo ? '视频' : String(file?.type || 'file').toUpperCase()}
      </div>
    </div>
  )
}

// 创建知识库模态框
export function CreateKbModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, desc: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const dialogId = useId().replace(/:/g, '')
  const titleId = `${dialogId}-create-kb-title`
  const descriptionId = `${dialogId}-create-kb-description`
  const nameInputId = `${dialogId}-create-kb-name`
  const descInputId = `${dialogId}-create-kb-description-input`
  const nameHintId = `${dialogId}-create-kb-name-hint`
  const formStatusId = `${dialogId}-create-kb-status`
  const isNameValid = name.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" aria-hidden="false">
      <div
        className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200/80 dark:border-slate-800 animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {/* Header with gradient background */}
        <div className="relative px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50 via-white to-fuchsia-50 dark:from-indigo-950/30 dark:via-slate-950 dark:to-fuchsia-950/30 overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-indigo-200/30 blur-2xl dark:bg-indigo-500/20" />
          <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-fuchsia-200/30 blur-2xl dark:bg-fuchsia-500/20" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
                <Database size={20} strokeWidth={2.5} aria-hidden />
              </div>
              <div>
                <h3 id={titleId} className="text-lg font-bold text-slate-800 dark:text-slate-100">新建知识库</h3>
                <p id={descriptionId} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">创建新的知识库以开始管理数据</p>
              </div>
            </div>
            <button 
              type="button"
              onClick={onClose} 
              aria-label="关闭新建知识库弹窗"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 bg-white dark:bg-slate-950">
          <span id={formStatusId} className="sr-only" role="status" aria-live="polite">
            {isNameValid ? `将创建知识库：${name.trim()}` : '请输入知识库名称后再创建'}
          </span>
          <div className="space-y-2">
            <label htmlFor={nameInputId} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Type size={16} className="text-indigo-500" aria-hidden />
              名称 <span className="text-red-500" aria-hidden>*</span>
            </label>
            <div className="relative">
              <input
                id={nameInputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 dark:focus:border-indigo-500 outline-none transition-all shadow-sm hover:border-slate-300 dark:hover:border-slate-600"
                placeholder="例如：产品文档库"
                autoFocus
                required
                aria-required="true"
                aria-describedby={`${nameHintId} ${formStatusId}`}
              />
            </div>
            <p id={nameHintId} className="text-xs text-slate-500 dark:text-slate-400">
              必填，创建时会自动去除首尾空格。
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor={descInputId} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <FileText size={16} className="text-indigo-500" aria-hidden />
              描述
            </label>
            <div className="relative">
              <textarea
                id={descInputId}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 h-28 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 dark:focus:border-indigo-500 outline-none resize-none transition-all shadow-sm hover:border-slate-300 dark:hover:border-slate-600"
                placeholder="这个知识库会包含哪些数据？"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="取消新建知识库"
            className="px-5 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (name.trim()) onCreate(name.trim(), desc.trim())
            }}
            disabled={!isNameValid}
            aria-label={isNameValid ? `创建知识库：${name.trim()}` : '创建知识库：请先输入名称'}
            aria-describedby={formStatusId}
            className={cn(
              'px-5 py-2.5 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/30 hover:from-indigo-500 hover:to-fuchsia-500 hover:shadow-xl hover:shadow-indigo-500/40 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center gap-2',
            )}
          >
            <Sparkles size={16} aria-hidden />
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

// 编辑知识库模态框（标题、描述）
export function EditKbModal({
  kb,
  onClose,
  onSave,
}: {
  kb: { id: string; name: string; description: string }
  onClose: () => void
  onSave: (id: string, name: string, description: string) => void
}) {
  const [name, setName] = useState(kb.name)
  const [desc, setDesc] = useState(kb.description ?? '')
  const dialogId = useId().replace(/:/g, '')
  const titleId = `${dialogId}-edit-kb-title`
  const descriptionId = `${dialogId}-edit-kb-description`
  const nameInputId = `${dialogId}-edit-kb-name`
  const descInputId = `${dialogId}-edit-kb-description-input`
  const nameHintId = `${dialogId}-edit-kb-name-hint`
  const formStatusId = `${dialogId}-edit-kb-status`
  const isNameValid = name.trim().length > 0
  useEffect(() => {
    setName(kb.name)
    setDesc(kb.description ?? '')
  }, [kb.id, kb.name, kb.description])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" aria-hidden="false">
      <div
        className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200/80 dark:border-slate-800 animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {/* Header with gradient background */}
        <div className="relative px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50 via-white to-fuchsia-50 dark:from-indigo-950/30 dark:via-slate-950 dark:to-fuchsia-950/30 overflow-hidden">
          <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-indigo-200/30 blur-2xl dark:bg-indigo-500/20" />
          <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-fuchsia-200/30 blur-2xl dark:bg-fuchsia-500/20" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
                <Pencil size={20} strokeWidth={2.5} aria-hidden />
              </div>
              <div>
                <h3 id={titleId} className="text-lg font-bold text-slate-800 dark:text-slate-100">编辑知识库</h3>
                <p id={descriptionId} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">修改名称与描述</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭编辑知识库弹窗"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 bg-white dark:bg-slate-950">
          <span id={formStatusId} className="sr-only" role="status" aria-live="polite">
            {isNameValid ? `将保存知识库：${name.trim()}` : '请输入知识库名称后再保存'}
          </span>
          <div className="space-y-2">
            <label htmlFor={nameInputId} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Type size={16} className="text-indigo-500" aria-hidden />
              名称 <span className="text-red-500" aria-hidden>*</span>
            </label>
            <input
              id={nameInputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 dark:focus:border-indigo-500 outline-none transition-all shadow-sm hover:border-slate-300 dark:hover:border-slate-600"
              placeholder="例如：产品文档库"
              autoFocus
              required
              aria-required="true"
              aria-describedby={`${nameHintId} ${formStatusId}`}
            />
            <p id={nameHintId} className="text-xs text-slate-500 dark:text-slate-400">
              必填，保存时会自动去除首尾空格。
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor={descInputId} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <FileText size={16} className="text-indigo-500" aria-hidden />
              描述
            </label>
            <textarea
              id={descInputId}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 h-28 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 dark:focus:border-indigo-500 outline-none resize-none transition-all shadow-sm hover:border-slate-300 dark:hover:border-slate-600"
              placeholder="这个知识库会包含哪些数据？"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="取消编辑知识库"
            className="px-5 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (name.trim()) onSave(kb.id, name.trim(), desc.trim())
            }}
            disabled={!isNameValid}
            aria-label={isNameValid ? `保存知识库：${name.trim()}` : '保存知识库：请先输入名称'}
            aria-describedby={formStatusId}
            className={cn(
              'px-5 py-2.5 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/30 hover:from-indigo-500 hover:to-fuchsia-500 hover:shadow-xl hover:shadow-indigo-500/40 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center gap-2',
            )}
          >
            <Check size={16} aria-hidden />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// 统计项
export function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  )
}
