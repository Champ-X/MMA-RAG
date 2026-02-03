import { useState, useEffect } from 'react'
import { X, CheckCircle, Loader2, Image as ImageIcon, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

// 状态徽章
export function StatusBadge({ status }: { status: string }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800">
        <CheckCircle size={10} /> 就绪
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800">
        <Loader2 size={10} className="animate-spin" /> 处理中
      </span>
    )
  }
  return <span className="text-slate-400 text-xs">Unknown</span>
}

// 文件图标
function FileIcon({ type }: { type: string }) {
  const lowerType = String(type || '').toLowerCase()
  if (['jpg', 'png', 'jpeg', 'gif', 'webp'].includes(lowerType)) {
    return <ImageIcon size={16} className="text-purple-500" />
  }
  if (lowerType === 'pdf') {
    return <FileText size={16} className="text-red-500" />
  }
  return <FileText size={16} className="text-blue-500" />
}

function isImageType(type: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(String(type || '').toLowerCase())
}

// 文件缩略图（表格视图）
export function FileThumb({ file }: { file: any }) {
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
    <span className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-500">
      <FileIcon type={file?.type} />
    </span>
  )
}

// 文件主图（画廊视图）
export function FileHero({ file }: { file: any }) {
  const isImg = isImageType(file?.type)
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
    <div className="flex flex-col items-center justify-center text-slate-400">
      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <FileIcon type={file?.type} />
      </div>
      <div className="mt-2 text-xs">
        {String(file?.type || 'file').toUpperCase()}
      </div>
    </div>
  )
}

// 创建知识库模态框
export function CreateKbModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, desc: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-950 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">新建知识库</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              placeholder="例如：产品文档库"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">描述</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 h-24 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
              placeholder="这个知识库会包含哪些数据？"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-sm font-medium"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (name.trim()) onCreate(name.trim(), desc.trim())
            }}
            className={cn(
              'px-4 py-2 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white rounded-lg text-sm font-medium shadow-sm hover:from-indigo-500 hover:to-fuchsia-500 transition-colors',
              !name.trim() && 'opacity-50 cursor-not-allowed'
            )}
          >
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
  useEffect(() => {
    setName(kb.name)
    setDesc(kb.description ?? '')
  }, [kb.id, kb.name, kb.description])

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-950 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">编辑知识库</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              placeholder="例如：产品文档库"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">描述</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 h-24 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
              placeholder="这个知识库会包含哪些数据？"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-sm font-medium"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (name.trim()) onSave(kb.id, name.trim(), desc.trim())
            }}
            className={cn(
              'px-4 py-2 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 text-white rounded-lg text-sm font-medium shadow-sm hover:from-indigo-500 hover:to-fuchsia-500 transition-colors',
              !name.trim() && 'opacity-50 cursor-not-allowed'
            )}
          >
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
