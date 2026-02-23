import { X, Eye, Image } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useRef, useEffect } from 'react'
import React from 'react'
import type { CitationReference } from '@/types/sse'

function formatTimeLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function shortenFileName(fileName: string, maxLen = 24): string {
  if (!fileName || fileName.length <= maxLen) return fileName
  const lastPart = fileName.includes('_') ? fileName.split('_').pop() ?? fileName : fileName
  if (lastPart.length <= maxLen) return lastPart
  const ext = lastPart.includes('.') ? lastPart.slice(lastPart.lastIndexOf('.')) : ''
  const base = lastPart.slice(0, lastPart.length - ext.length)
  if (base.length + ext.length <= maxLen) return lastPart
  return base.slice(0, Math.max(0, maxLen - ext.length - 1)) + '…' + ext
}

function VideoWithSeek({ src, startSec, endSec }: { src: string; startSec?: number | null; endSec?: number | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  const hasSeeked = useRef(false)
  useEffect(() => {
    hasSeeked.current = false
  }, [src])
  useEffect(() => {
    const el = ref.current
    if (!el || startSec == null || !Number.isFinite(startSec)) return
    const onCanPlay = () => {
      if (hasSeeked.current) return
      el.currentTime = startSec
      hasSeeked.current = true
    }
    el.addEventListener('canplay', onCanPlay)
    if (el.readyState >= 2) {
      el.currentTime = startSec
      hasSeeked.current = true
    }
    return () => el.removeEventListener('canplay', onCanPlay)
  }, [src, startSec])
  useEffect(() => {
    if (endSec == null || !Number.isFinite(endSec)) return
    const el = ref.current
    if (!el) return
    const onTimeUpdate = () => { if (el.currentTime >= endSec) el.pause() }
    el.addEventListener('timeupdate', onTimeUpdate)
    return () => el.removeEventListener('timeupdate', onTimeUpdate)
  }, [endSec])
  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      className="w-full rounded-lg min-h-[220px] max-h-[380px] object-contain [&::-webkit-media-controls-panel]:bg-slate-100/90 dark:[&::-webkit-media-controls-panel]:bg-slate-800/90"
    />
  )
}

interface CitationPopoverProps {
  open: boolean
  rect: DOMRect | null
  item: CitationReference | null
  onClose: () => void
  onOpenInspector: () => void
}

// 图片显示组件，带错误处理
function ImageDisplayWithErrorHandler({ imgUrl, fileName }: { imgUrl: string; fileName?: string }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const imgRef = React.useRef<HTMLImageElement>(null)

  // 检查图片是否已经加载完成（从缓存中）
  React.useEffect(() => {
    const img = imgRef.current
    if (img) {
      if (img.complete && img.naturalHeight !== 0) {
        setImageLoaded(true)
        img.style.visibility = 'visible'
      } else {
        img.style.visibility = 'hidden'
      }
    }
  }, [])
  
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.preventDefault()
    e.stopPropagation()
    setImageError(true)
    setImageLoaded(false)
    // 立即隐藏图片元素，防止显示破损图标
    const img = e.currentTarget
    img.setAttribute('data-error', 'true')
    img.style.display = 'none'
    img.style.visibility = 'hidden'
    img.style.opacity = '0'
    img.style.width = '0'
    img.style.height = '0'
  }
  
  const handleImageLoad = () => {
    setImageLoaded(true)
    const img = imgRef.current
    if (img) {
      img.style.visibility = 'visible'
    }
  }
  
  return (
    <div className="mb-3">
      <div
        className="rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center relative"
        style={{ minHeight: '220px', overflow: 'hidden' }}
      >
        {imageError ? (
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <Image className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            <p className="text-xs text-slate-500 dark:text-slate-400">图片加载失败</p>
            {fileName && (
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-full">{fileName}</p>
            )}
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
              </div>
            )}
            <img
              ref={imgRef}
              src={imgUrl}
              alt={fileName}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              style={{ 
                opacity: imageLoaded ? 1 : 0, 
                transition: imageLoaded ? 'opacity 0.2s' : 'none',
                visibility: imageLoaded ? 'visible' : 'hidden'
              }}
              onLoadStart={() => {
                const img = imgRef.current
                if (img && !imageLoaded) {
                  // 加载开始时隐藏，防止显示破损图标
                  img.style.visibility = 'hidden'
                  img.style.opacity = '0'
                }
              }}
              onError={handleImageError}
              onLoad={handleImageLoad}
              onAbort={handleImageError}
            />
          </>
        )}
      </div>
    </div>
  )
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
  const videoMinHeight = item.type === 'video' ? 220 : 0
  const estimatedHeight = item.type === 'image'
    ? headerHeight + imageMinHeight + captionHeight + footerHeight
    : item.type === 'video'
      ? headerHeight + videoMinHeight + (item.content ? 80 : 0) + footerHeight
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
    const minRequiredHeight = headerHeight + (item.type === 'image' ? 200 : item.type === 'video' ? 200 : 100) + footerHeight
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

          {/* 内容区域可滚动：图片与文字一起滚动 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 scrollbar-hide">
            {item.type === 'image' && item.img_url && (
              <ImageDisplayWithErrorHandler imgUrl={item.img_url} fileName={item.file_name} />
            )}

            {item.type === 'audio' && (
              <>
                {item.audio_url && (
                  <div className="mb-3 rounded-xl border border-amber-200/70 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/30 p-3">
                    <audio src={item.audio_url} controls className="w-full h-9 rounded-lg" preload="metadata" />
                  </div>
                )}
                {(item.content || !item.audio_url) && (
                  <div className="rounded-xl bg-amber-50/50 dark:bg-amber-900/20 p-3 text-xs text-slate-700 dark:text-slate-200 border border-amber-100 dark:border-amber-800/40">
                    <div className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {item.content || '无内容'}
                    </div>
                  </div>
                )}
              </>
            )}

            {item.type === 'video' && (
              <>
                {item.video_url && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-sky-200/70 dark:border-sky-800/50 bg-slate-100/80 dark:bg-slate-800/80 p-3 ring-1 ring-slate-200/50 dark:ring-slate-600/30">
                    {(item.start_sec != null || item.end_sec != null) && (
                      <div className="mb-2 flex items-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border border-sky-200/70 dark:border-sky-700/50">
                          {item.start_sec != null && item.end_sec != null
                            ? `片段 ${formatTimeLabel(item.start_sec)} - ${formatTimeLabel(item.end_sec)}`
                            : item.start_sec != null
                              ? `从 ${formatTimeLabel(item.start_sec)} 开始`
                              : `至 ${formatTimeLabel(item.end_sec!)} 结束`}
                        </span>
                      </div>
                    )}
                    <VideoWithSeek src={item.video_url} startSec={item.start_sec} endSec={item.end_sec} />
                  </div>
                )}
                {(item.content || !item.video_url) && (
                  <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/50 p-3 text-xs text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-600/50">
                    <div className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {item.content || '无内容'}
                    </div>
                  </div>
                )}
                {item.key_frames && item.key_frames.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-sky-600 dark:text-sky-400 font-medium mb-2">关键帧</p>
                    <div className="flex flex-wrap gap-2">
                      {item.key_frames
                        .filter((f: { img_url?: string }) => f.img_url)
                        .map((frame: { img_url?: string; timestamp?: number; description?: string }, idx: number) => (
                          <div
                            key={idx}
                            className="rounded-lg overflow-hidden border border-sky-200/70 dark:border-sky-800/50 bg-white/80 dark:bg-slate-800/60"
                          >
                            <img
                              src={frame.img_url}
                              alt={frame.description || `关键帧 ${idx + 1}`}
                              className="w-28 h-[63px] object-cover block"
                            />
                            {(frame.timestamp != null || frame.description) && (
                              <div className="px-2 py-1 bg-sky-50/50 dark:bg-sky-900/20">
                                {frame.timestamp != null && (
                                  <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono mr-1">
                                    {formatTimeLabel(frame.timestamp)}
                                  </span>
                                )}
                                {frame.description && (
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2" title={frame.description}>
                                    {frame.description}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}

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
            ) : item.type !== 'audio' && item.type !== 'video' ? (
              <div className="rounded-xl bg-slate-900/5 p-3 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200 whitespace-pre-wrap">
                {item.content || '无内容'}
              </div>
            ) : null}
          </div>

          <div className="flex-shrink-0 flex items-center justify-between px-4 pb-3 border-t border-slate-200/70 dark:border-slate-800/70">
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1 mr-2" title={item.file_name || undefined}>
              {item.file_name ? shortenFileName(item.file_name) : '未知路径'}
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
