import { useState } from 'react'
import { FileText, Image, ExternalLink, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { CitationReference } from '@/types/sse'

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
  className?: string
}

function normalizeRef(
  r: CitationReference | { id: number | string },
  map?: Map<number | string, CitationReference>
): CitationReference | null {
  if ('type' in r && 'file_name' in r) return r as CitationReference
  const full = map?.get(r.id)
  return full ?? null
}

function getReferenceIcon(type: 'doc' | 'image') {
  return type === 'doc' ? FileText : Image
}

export function InlineCitation({
  references,
  variant = 'inline',
  showImageThumbnails = true,
  citationMap,
  onCiteClick,
  messageId,
  className,
}: InlineCitationProps) {
  const [selected, setSelected] = useState<CitationReference | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const refs = references
    .map((r) => normalizeRef(r, citationMap))
    .filter((r): r is CitationReference => r != null)

  if (refs.length === 0) return null

  const imageRefs = refs.filter((r) => r.type === 'image')

  const openLightbox = (ref: CitationReference) => {
    setSelected(ref)
    setLightboxOpen(true)
  }

  return (
    <>
      {variant === 'inline' && (
        <div className={cn('flex flex-wrap gap-1.5', className)}>
          {refs.map((ref) => {
            const Icon = getReferenceIcon(ref.type)
            const id = ref.id
            return (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2.5 text-xs font-mono rounded-xl border border-slate-200/70 bg-white/60 shadow-sm hover:bg-indigo-500/10 hover:border-indigo-300/50 dark:border-slate-700/70 dark:bg-slate-950/40 dark:hover:bg-indigo-500/15 dark:hover:border-indigo-500/30',
                  ref.type === 'image' && 'text-blue-600 dark:text-blue-400'
                )}
                onClick={(e) => {
                  setSelected(ref)
                  if (onCiteClick) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const mockEvent = { currentTarget: { getBoundingClientRect: () => rect } } as React.MouseEvent
                    onCiteClick(id, mockEvent, messageId)
                  }
                }}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                [{id}]
              </Button>
            )
          })}
        </div>
      )}

      {variant === 'inline' && showImageThumbnails && imageRefs.length > 0 && (
        <div className={cn('mt-3 flex flex-wrap gap-2', className)}>
          {imageRefs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              onClick={(e) => {
                openLightbox(ref)
                if (onCiteClick) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const mockEvent = { currentTarget: { getBoundingClientRect: () => rect } } as React.MouseEvent
                  onCiteClick(ref.id, mockEvent, messageId)
                }
              }}
              className="rounded-xl border border-slate-200/70 bg-white/60 overflow-hidden shadow-sm hover:ring-2 hover:ring-indigo-500/20 transition-all dark:border-slate-700/70 dark:bg-slate-950/40"
            >
              {ref.img_url ? (
                <img
                  src={ref.img_url}
                  alt={ref.file_name}
                  className="h-20 w-auto max-w-[160px] object-cover"
                />
              ) : (
                <div className="h-20 w-32 bg-muted flex items-center justify-center">
                  <Image className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="px-2 py-1.5 bg-slate-100/80 dark:bg-slate-800/60 text-xs truncate max-w-[160px] text-slate-700 dark:text-slate-200">
                [{ref.id}] {ref.file_name}
              </div>
            </button>
          ))}
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
            const Icon = getReferenceIcon(ref.type)
            return (
              <button
                key={ref.id}
                type="button"
                className="inline-flex items-center gap-1 text-xs underline decoration-dotted cursor-help hover:text-primary"
                onClick={(e) => {
                  setSelected(ref)
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

      {/* 引用详情弹层 */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = getReferenceIcon(selected.type)
                    return <Icon className="h-5 w-5" />
                  })()}
                  <span>【材料 {selected.id}】</span>
                  <Badge variant="outline">
                    {selected.type === 'doc' ? '文档' : '图片'}
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

      {/* 图片 Lightbox */}
      {selected?.type === 'image' && selected.img_url && (
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{selected.file_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-center">
                <img
                  src={selected.img_url}
                  alt={selected.file_name}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg"
                />
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
  const ctx = reference.debug_info?.context_window
  const Icon = getReferenceIcon(reference.type)

  return (
    <Card className="rounded-2xl border border-slate-200/70 bg-white/80 shadow-lg shadow-slate-900/5 dark:border-slate-800/70 dark:bg-slate-950/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>【材料 {reference.id}】</span>
            <Badge variant="outline" className="text-xs">
              {reference.type === 'doc' ? '文档' : '图片'}
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
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {reference.type === 'doc' ? '内容片段' : '视觉描述'}
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
          <Button variant="outline" size="sm" className="flex-1">
            <ExternalLink className="mr-2 h-3 w-3" />
            原始文件
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
