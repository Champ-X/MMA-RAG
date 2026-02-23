import { useState } from 'react'
import React from 'react'
import type { CitationReference } from '@/types/sse'
import { FileText, Image, Music, Video, ExternalLink, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface InlineCitationProps {
  /** 引用列表：完整对象或 id。若为 id，需同时提供 citationMap */
  references: Array<CitationReference | { id: number | string }>
  variant?: 'inline' | 'sidebar' | 'tooltip'
  /** 是否在段落下方展示图片缩略图条 */
  showImageThumbnails?: boolean
  /** id -> 完整引用，用于预加载的 citation 事件 */
  citationMap?: Map<number | string, CitationReference>
  /** 点击引用时打开悬浮框（与正文内 [1] 按钮行为一致）；messageId 用于只从当前消息取引用 */
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string) => void
  /** 当前消息 id，点击引用时传给 onCiteClick，避免取到上一条消息的引用 */
  messageId?: string
  /** 引用 id -> 显示编号（连续 1,2,3...），用于底部引用按钮显示 */
  displayIndexByRefId?: Map<number | string, number>
  /** 额外在回答末尾展示的图片引用缩略图（与 references 去重后展示） */
  imageThumbnailRefs?: Array<CitationReference | { id: number | string }>
  className?: string
}

function normalizeRef(
  r: CitationReference | { id: number | string },
  map?: Map<number | string, CitationReference>
): CitationReference | null {
  // 如果引用对象已经有完整的字段，直接返回
  if ('type' in r && 'file_name' in r) return r as CitationReference
  // 尝试从 citationMap 中获取完整的引用对象
  const full = map?.get(r.id)
  if (full) return full
  // 如果 citationMap 中没有，但引用对象有 id，尝试使用原始对象（可能后端已经发送了完整数据）
  if ('id' in r && typeof r === 'object' && r != null) {
    // 检查是否有必要的字段，即使没有 type 和 file_name，也尝试返回（可能是部分数据）
    return r as CitationReference
  }
  return null
}

function getReferenceIcon(type: 'doc' | 'image' | 'audio' | 'video') {
  if (type === 'doc') return FileText
  if (type === 'image') return Image
  if (type === 'audio') return Music
  if (type === 'video') return Video
  return FileText
}

// 图片 Lightbox 内容组件，带错误处理
function ImageLightboxContent({ imgUrl, fileName }: { imgUrl: string; fileName?: string }) {
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
  
  if (imageError) {
    return (
      <div className="w-full h-[70vh] bg-slate-100 dark:bg-slate-800 rounded-lg flex flex-col items-center justify-center gap-3">
        <Image className="h-12 w-12 text-slate-400 dark:text-slate-500" />
        <p className="text-sm text-slate-500 dark:text-slate-400">图片加载失败</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{fileName || '未知文件'}</p>
      </div>
    )
  }
  
  return (
    <div className="relative w-full">
      {!imageLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-lg z-10">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      )}
      <img
        ref={imgRef}
        src={imgUrl}
        alt={fileName}
        className="max-w-full max-h-[70vh] object-contain rounded-lg"
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
    </div>
  )
}

// 图片缩略图按钮组件，带错误处理
function ImageThumbnailButton({
  citation,
  onLightboxClick,
  onCiteClick,
}: {
  citation: CitationReference
  onLightboxClick: () => void
  onCiteClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const imgRef = React.useRef<HTMLImageElement>(null)

  // 检查图片是否已经加载完成（从缓存中）
  React.useEffect(() => {
    const img = imgRef.current
    if (img) {
      if (img.complete && img.naturalHeight !== 0) {
        setImageLoaded(true)
      } else {
        // 如果图片未加载，先隐藏防止显示破损图标
        img.style.visibility = 'hidden'
        img.style.opacity = '0'
      }
    }
  }, [])

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.preventDefault()
    e.stopPropagation()
    setImageError(true)
    setImageLoaded(false)
    // 立即隐藏图片元素和父容器，防止显示破损图标
    const img = e.currentTarget
    img.setAttribute('data-error', 'true')
    img.style.display = 'none'
    img.style.visibility = 'hidden'
    img.style.opacity = '0'
    img.style.width = '0'
    img.style.height = '0'
    // 隐藏父容器（button）
    const button = img.closest('button')
    if (button) {
      button.style.display = 'none'
    }
  }

  const handleImageLoad = () => {
    setImageLoaded(true)
    const img = imgRef.current
    if (img) {
      img.style.visibility = 'visible'
    }
  }

  if (imageError) return null

  return (
    <button
      type="button"
      onClick={(e) => {
        if (!imageError) {
          onLightboxClick()
          onCiteClick?.(e)
        }
      }}
      className="rounded-lg border overflow-hidden hover:ring-2 ring-primary/40 transition-all p-0 relative"
    >
      {citation.img_url ? (
        <>
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 z-10">
              <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
            </div>
          )}
          <img
            ref={imgRef}
            src={citation.img_url}
            alt={citation.file_name}
            className="h-40 w-auto max-w-[320px] object-cover block"
            style={{ 
              opacity: imageLoaded ? 1 : 0, 
              transition: imageLoaded ? 'opacity 0.2s' : 'none',
              visibility: imageLoaded ? 'visible' : 'hidden'
            }}
            onError={handleImageError}
            onLoad={handleImageLoad}
            onAbort={handleImageError}
            onLoadStart={() => {
              const img = imgRef.current
              if (img && !imageLoaded) {
                // 加载开始时隐藏，防止显示破损图标
                img.style.visibility = 'hidden'
                img.style.opacity = '0'
              }
            }}
          />
        </>
      ) : (
        <div className="h-40 w-64 bg-muted flex items-center justify-center">
          <Image className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
    </button>
  )
}

function normalizeContextWindow(raw: unknown): { prev: string; next: string } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return normalizeContextWindow(JSON.parse(raw))
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const prev = typeof obj.prev === 'string' ? obj.prev : ''
    const next = typeof obj.next === 'string' ? obj.next : ''
    if (prev || next) return { prev, next }
  }
  return null
}

export function InlineCitation({
  references,
  variant = 'inline',
  showImageThumbnails = true,
  citationMap,
  onCiteClick,
  messageId,
  displayIndexByRefId,
  imageThumbnailRefs,
  className,
}: InlineCitationProps) {
  const [selected, setSelected] = useState<CitationReference | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const useInternalPreview = !onCiteClick

  const refs = references
    .map((r) => normalizeRef(r, citationMap))
    .filter((r): r is CitationReference => r != null)

  const imageRefsForThumbnails = (() => {
    const fromRefs = refs.filter((r) => r.type === 'image')
    const extra = (imageThumbnailRefs ?? [])
      .map((r) => normalizeRef(r, citationMap))
      .filter((r): r is CitationReference => r != null && r.type === 'image')
    const seen = new Set<string | number>()
    const out: CitationReference[] = []
    for (const r of [...fromRefs, ...extra]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
    return out
  })()

  if (refs.length === 0 && imageRefsForThumbnails.length === 0) return null

  const imageRefs = imageRefsForThumbnails.length > 0 ? imageRefsForThumbnails : refs.filter((r) => r.type === 'image')

  const openLightbox = (ref: CitationReference) => {
    if (!useInternalPreview) return
    setSelected(ref)
    setLightboxOpen(true)
  }

  return (
    <>
      {variant === 'inline' && refs.length > 0 && (
        <div className={cn('flex flex-wrap gap-1', className)}>
          {refs.map((ref) => {
            // 确保 type 字段存在，默认为 'doc'
            const refType = (ref.type === 'doc' || ref.type === 'image' || ref.type === 'audio' || ref.type === 'video') ? ref.type : 'doc'
            const Icon = getReferenceIcon(refType)
            const id = ref.id
            const displayNum = displayIndexByRefId?.get(id) ?? id
            return (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 px-2 text-xs font-mono hover:bg-primary/10',
                  refType === 'image' && 'text-blue-600'
                )}
                onClick={(e) => {
                  if (useInternalPreview) setSelected(ref)
                  if (onCiteClick) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const mockEvent = { currentTarget: { getBoundingClientRect: () => rect } } as React.MouseEvent
                    onCiteClick(id, mockEvent, messageId)
                  }
                }}
              >
                <Icon className="mr-1 h-3 w-3" />
                [{displayNum}]
              </Button>
            )
          })}
        </div>
      )}

      {variant === 'inline' && showImageThumbnails && imageRefs.length > 0 && (
        <div className={cn('flex flex-wrap gap-2 mt-2 mb-0', className)}>
          {imageRefs.map((ref) => {
            return <ImageThumbnailButton
              key={ref.id}
              citation={ref}
              onLightboxClick={() => openLightbox(ref)}
              onCiteClick={onCiteClick ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const mockEvent = { currentTarget: { getBoundingClientRect: () => rect } } as React.MouseEvent
                onCiteClick(ref.id, mockEvent, messageId)
              } : undefined}
            />
          })}
        </div>
      )}

      {variant === 'sidebar' && (
        <div className={cn('space-y-4', className)}>
          <h4 className="font-semibold">引用来源</h4>
          {refs.map((r) => (
            <ReferenceDetailCard
              key={r.id}
              reference={r}
              onViewImage={r.type === 'image' ? () => openLightbox(r) : undefined}
            />
          ))}
        </div>
      )}

      {variant === 'tooltip' && (
        <div className={cn('inline-flex flex-wrap gap-1', className)}>
          {refs.map((ref) => {
            // 确保 type 字段存在，默认为 'doc'
            const refType = (ref.type === 'doc' || ref.type === 'image' || ref.type === 'audio' || ref.type === 'video') ? ref.type : 'doc'
            const Icon = getReferenceIcon(refType)
            return (
              <button
                key={ref.id}
                type="button"
                className="inline-flex items-center gap-1 text-xs underline decoration-dotted cursor-help hover:text-primary"
                onClick={(e) => {
                  if (useInternalPreview) setSelected(ref)
                  if (onCiteClick) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const mockEvent = { currentTarget: { getBoundingClientRect: () => rect } } as React.MouseEvent
                    onCiteClick(ref.id, mockEvent, messageId)
                  }
                }}
              >
                <Icon className="h-3 w-3" />
                [{ref.id}]
              </button>
            )
          })}
        </div>
      )}

      {/* 引用详情弹层（仅在内部预览模式启用） */}
      {useInternalPreview && (
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {selected && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {(() => {
                      const refType = (selected.type === 'doc' || selected.type === 'image' || selected.type === 'audio' || selected.type === 'video') ? selected.type : 'doc'
                      const Icon = getReferenceIcon(refType)
                      return <Icon className="h-5 w-5" />
                    })()}
                    <span>【材料 {selected.id}】</span>
                    <Badge variant="outline">
                      {selected.type === 'doc' ? '文档' : selected.type === 'image' ? '图片' : selected.type === 'audio' ? '音频' : '视频'}
                    </Badge>
                  </DialogTitle>
                </DialogHeader>
                <ReferenceDetailCard
                  reference={selected}
                  onViewImage={
                    selected.type === 'image' ? () => openLightbox(selected) : undefined
                  }
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* 图片 Lightbox（仅在内部预览模式启用） */}
      {useInternalPreview && selected?.type === 'image' && selected.img_url && (
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{selected.file_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-center relative">
                <ImageLightboxContent imgUrl={selected.img_url} fileName={selected.file_name} />
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">视觉描述</h4>
                <p className="text-sm">{selected.content || '暂无描述'}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function ReferenceDetailCard({
  reference,
  onViewImage,
}: {
  reference: CitationReference
  onViewImage?: () => void
}) {
  const [contextLens, setContextLens] = useState<'prev' | 'curr' | 'next'>('curr')
  const ctx = normalizeContextWindow(reference.debug_info?.context_window)
  const refType = (reference.type === 'doc' || reference.type === 'image' || reference.type === 'audio' || reference.type === 'video') ? reference.type : 'doc'
  const Icon = getReferenceIcon(refType)
  const typeLabel = reference.type === 'doc' ? '文档' : reference.type === 'image' ? '图片' : reference.type === 'audio' ? '音频' : '视频'

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>【材料 {reference.id}】</span>
            <Badge variant="outline" className="text-xs">
              {typeLabel}
            </Badge>
          </CardTitle>
          {reference.type === 'image' && reference.img_url && (
            <Button variant="ghost" size="sm" onClick={onViewImage}>
              <Eye className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">文件名</p>
          <p className="text-sm font-medium">{reference.file_name}</p>
        </div>
        {reference.type === 'audio' && reference.audio_url && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">播放</p>
            <audio src={reference.audio_url} controls className="w-full h-9 rounded-lg" preload="metadata" />
          </div>
        )}
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {reference.type === 'doc' ? '内容片段' : reference.type === 'image' ? '视觉描述' : reference.type === 'audio' ? '转写/描述' : '描述'}
          </p>
          <p className="text-sm bg-muted/50 p-2 rounded text-xs">{reference.content}</p>
        </div>

        {/* 溯源计分板 */}
        {reference.scores && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">检索分数</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['dense', 'sparse', 'rerank'] as const).map((k) => {
                const v = reference.scores![k]
                if (v == null) return null
                return (
                  <div key={k} className="text-center p-2 rounded bg-muted/50">
                    <div className="text-xs text-muted-foreground capitalize">{k}</div>
                    <div className="text-sm font-mono">{(Number(v) * 100).toFixed(1)}%</div>
                  </div>
                )
              })}
              {reference.scores.visual != null && (
                <div className="text-center p-2 rounded bg-muted/50">
                  <div className="text-xs text-muted-foreground">Visual</div>
                  <div className="text-sm font-mono">
                    {(Number(reference.scores.visual) * 100).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 上下文窗口透镜 */}
        {ctx && (ctx.prev || ctx.next) && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">上下文窗口</p>
            <div className="flex gap-1 mb-2">
              <Button
                variant={contextLens === 'prev' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setContextLens('prev')}
              >
                <ChevronLeft className="h-3 w-3 mr-1" />
                Show Previous
              </Button>
              <Button
                variant={contextLens === 'curr' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setContextLens('curr')}
              >
                当前
              </Button>
              <Button
                variant={contextLens === 'next' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setContextLens('next')}
              >
                Show Next
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
            <div className="text-xs bg-muted/50 p-2 rounded max-h-24 overflow-y-auto">
              {contextLens === 'prev' && ctx.prev}
              {contextLens === 'curr' && reference.content}
              {contextLens === 'next' && ctx.next}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {reference.type === 'image' && reference.img_url && (
            <Button variant="outline" size="sm" onClick={onViewImage} className="flex-1">
              <Eye className="mr-2 h-3 w-3" />
              查看大图
            </Button>
          )}
          {reference.type === 'audio' && reference.audio_url && (
            <a href={reference.audio_url} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                <Music className="mr-2 h-3 w-3" />
                播放/下载
              </Button>
            </a>
          )}
          <Button variant="outline" size="sm" className="flex-1">
            <ExternalLink className="mr-2 h-3 w-3" />
            原始文件
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
