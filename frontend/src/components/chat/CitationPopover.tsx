import { X, Eye } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { CitationReference } from '@/types/sse'

interface CitationPopoverProps {
  open: boolean
  rect: DOMRect | null
  item: CitationReference | null
  onClose: () => void
  onOpenInspector: () => void
}

export function CitationPopover({
  open,
  rect,
  item,
  onClose,
  onOpenInspector,
}: CitationPopoverProps) {
  if (!open || !item || !rect) return null

  const width = 400
  const headerHeight = 60
  const footerHeight = 50
  const imageMinHeight = item.type === 'image' ? 250 : 0
  const captionHeight = item.type === 'image' && item.content ? 100 : 0
  const estimatedHeight = item.type === 'image'
    ? headerHeight + imageMinHeight + captionHeight + footerHeight
    : headerHeight + 150 + footerHeight

  const pad = 16
  const gap = 12

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800

  // 计算水平位置（居中）
  const left = Math.min(
    Math.max(pad, rect.left - width / 2 + rect.width / 2),
    viewportW - width - pad
  )

  // 计算可用空间
  const spaceBelow = viewportH - rect.bottom - gap - pad
  const spaceAbove = rect.top - gap - pad

  const canFitBelow = spaceBelow >= estimatedHeight
  const canFitAbove = spaceAbove >= estimatedHeight

  let top: number
  let maxHeight: number
  let placement: 'above' | 'below'

  if (!canFitBelow && canFitAbove) {
    top = Math.max(pad, rect.top - estimatedHeight - gap)
    maxHeight = Math.min(estimatedHeight, spaceAbove)
    placement = 'above'
  } else if (canFitBelow && !canFitAbove) {
    top = rect.bottom + gap
    maxHeight = Math.min(estimatedHeight, spaceBelow)
    placement = 'below'
  } else if (canFitBelow && canFitAbove) {
    if (spaceBelow >= spaceAbove) {
      top = rect.bottom + gap
      maxHeight = estimatedHeight
      placement = 'below'
    } else {
      top = Math.max(pad, rect.top - estimatedHeight - gap)
      maxHeight = estimatedHeight
      placement = 'above'
    }
  } else {
    const minRequiredHeight = headerHeight + (item.type === 'image' ? 200 : 100) + footerHeight
    if (spaceBelow >= spaceAbove) {
      top = rect.bottom + gap
      maxHeight = Math.max(minRequiredHeight, Math.min(estimatedHeight, spaceBelow))
      placement = 'below'
    } else {
      top = pad
      maxHeight = Math.max(minRequiredHeight, Math.min(estimatedHeight, spaceAbove))
      placement = 'above'
    }
  }

  top = Math.max(pad, Math.min(top, viewportH - maxHeight - pad))

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: placement === 'above' ? -8 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: placement === 'above' ? -8 : 8 }}
          transition={{ duration: 0.16 }}
          style={{
            position: 'fixed',
            left,
            top,
            width,
            maxHeight: `${maxHeight}px`,
          }}
          className="z-40 flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/85 shadow-2xl shadow-slate-900/15 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/70"
        >
          <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {item.file_name || '未知文件'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Score: {item.scores?.rerank?.toFixed(2) || item.scores?.dense?.toFixed(2) || '0.00'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 grid h-8 w-8 place-items-center rounded-xl text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 图片区域 */}
          {item.type === 'image' && item.img_url && (
            <div className="flex-shrink-0 px-4 pt-3">
              <div
                className="rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center"
                style={{
                  minHeight: '220px',
                  maxHeight: `${Math.max(280, maxHeight - headerHeight - footerHeight - (item.content ? 130 : 50))}px`,
                  overflow: 'hidden',
                }}
              >
                <img
                  src={item.img_url}
                  alt={item.file_name}
                  className="max-w-full max-h-full w-auto h-auto object-contain"
                />
              </div>
            </div>
          )}

          {/* 内容区域可滚动 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 scrollbar-hide">
            {item.type === 'image' ? (
              item.content && (
                <div className="rounded-xl bg-purple-50 dark:bg-purple-900/20 p-3 text-xs text-slate-700 dark:text-slate-200 border border-purple-100 dark:border-purple-800/40">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Eye size={12} className="text-purple-600 dark:text-purple-400" />
                    <span className="font-semibold text-purple-700 dark:text-purple-300">VLM Caption</span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {item.content}
                  </div>
                </div>
              )
            ) : (
              <div className="rounded-xl bg-slate-900/5 p-3 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200 whitespace-pre-wrap">
                {item.content || '无内容'}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex items-center justify-between px-4 pb-3 border-t border-slate-200/70 dark:border-slate-800/70">
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1 mr-2">
              {item.file_name || '未知路径'}
            </div>
            <button
              type="button"
              onClick={onOpenInspector}
              className="flex-shrink-0 rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-fuchsia-500/10 transition-all duration-200 hover:brightness-110 active:scale-95"
            >
              打开检查器
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
