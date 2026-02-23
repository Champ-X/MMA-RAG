import React from 'react'
import { User, Bot, Music, Play, Video } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { ThinkingCapsule } from './ThinkingCapsule'
import { InlineCitation } from './InlineCitation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import { chatApi } from '@/services/api_client'
import type { CitationReference } from '@/types/sse'
import type { ThoughtData, ThinkingState } from '@/store/useChatStore'

/** 流式时从 ChatInterface 传入的实时思考数据，保证思考框在气泡顶部展示 */
export interface LiveThinkingProps {
  thoughtData?: ThoughtData | null
  stages?: ThinkingState['stages']
  currentStage?: string
}

export interface MessageBubbleMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: string
  citations?: Array<CitationReference | { id: number | string }>
  metadata?: {
    chunks_count?: number
    images_count?: number
    references_used?: (number | string)[]
    intent_type?: string
    processing_time?: number
  }
  thinking?: {
    intent?: any
    routing?: any
    retrieval?: any
  } | ThoughtData | null
  error?: string
}

interface MessageBubbleProps {
  message: MessageBubbleMessage
  /** 是否正在流式输出该条（显示光标） */
  isStreaming?: boolean
  /** 流式时的实时思考数据，传入后思考框会在本气泡顶部展示，避免结束后跳到上方 */
  liveThinking?: LiveThinkingProps
  /** 预加载的引用 id -> 完整对象 */
  citationMap?: Map<number | string, CitationReference>
  /** 点击引用时的回调；messageId 用于只从当前消息取引用，避免多条回答共用 [1][2] 时错用上一条的引用 */
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string) => void
}

/** 正文中引用按首次出现顺序去重得到的 id 列表，用于连续编号 1,2,3... */
function getOrderedRefIdsFromContent(content: string): (number | string)[] {
  const matches = findAllCitationMatches(content)
  const seen = new Set<number | string>()
  const ordered: (number | string)[] = []
  for (const m of matches) {
    if (!seen.has(m.n)) {
      seen.add(m.n)
      ordered.push(m.n)
    }
  }
  return ordered
}

// 从文本中提取引用标记并转换为可点击按钮；originalIdToDisplayIndex 用于连续编号展示
function injectCitations(
  children: React.ReactNode,
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void,
  messageId?: string,
  originalIdToDisplayIndex?: Map<number | string, number>,
  citationMap?: Map<number | string, CitationReference>
): React.ReactNode {
  if (typeof children === 'string') {
    return splitTextWithCitations(children, onCiteClick, messageId, originalIdToDisplayIndex)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <span key={`cnode_${messageId ?? 'm'}_${idx}`}>
        {injectCitations(child, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)}
      </span>
    ))
  }
  if (!React.isValidElement(children)) return children
  if (children.props?.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: injectCitations(children.props.children, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)
    } as any)
  }
  return children
}

type CitationMatch = { start: number; end: number; n: number; leadingSpace?: boolean }

function findAllCitationMatches(text: string): CitationMatch[] {
  const list: CitationMatch[] = []
  let m: RegExpExecArray | null
  const re1 = /\[(\d+)\]/g
  while ((m = re1.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  const re2 = /【(\d+)】/g
  while ((m = re2.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  const re2b = /[（(](\d+)[）)]/g
  while ((m = re2b.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  const re2c = /〔(\d+)〕|〖(\d+)〗/g
  while ((m = re2c.exec(text)) !== null) {
    const n = Number(m[1] ?? m[2])
    list.push({ start: m.index, end: m.index + m[0].length, n })
  }
  const re3 = /[\s\u3000]+(\d+)(?=[。！？；;:：、）\)])/g
  while ((m = re3.exec(text)) !== null) {
    list.push({
      start: m.index,
      end: m.index + m[0].length,
      n: Number(m[1]),
      leadingSpace: true,
    })
  }
  const re4 = /[\s\u3000]+(\d+)(?=$)/g
  while ((m = re4.exec(text)) !== null) {
    list.push({
      start: m.index,
      end: m.index + m[0].length,
      n: Number(m[1]),
      leadingSpace: true,
    })
  }
  list.sort((a, b) => a.start - b.start)
  const merged: CitationMatch[] = []
  for (const x of list) {
    if (merged.length === 0 || x.start >= merged[merged.length - 1].end) {
      merged.push(x)
    }
  }
  return merged
}

function splitTextWithCitations(
  text: string,
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void,
  messageId?: string,
  originalIdToDisplayIndex?: Map<number | string, number>
) {
  const matches = findAllCitationMatches(text)
  if (matches.length === 0) return text

  const out: React.ReactNode[] = []
  let last = 0
  matches.forEach((match, idx) => {
    if (match.start > last) out.push(text.slice(last, match.start))
    if (match.leadingSpace) out.push(' ')
    const displayN = originalIdToDisplayIndex != null
      ? (originalIdToDisplayIndex.get(match.n) ?? match.n)
      : match.n
    
    out.push(
      <CitationInlineButton
        key={`c_${messageId}_${idx}_${match.n}`}
        n={typeof displayN === 'number' ? displayN : Number(displayN) || 0}
        onClick={(rect) => onCiteClick?.(match.n, rect, messageId)}
      />
    )
    last = match.end
  })
  if (last < text.length) out.push(text.slice(last))
  return out
}

// 从 React 节点中递归提取文本内容
function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).join('')
  }
  if (React.isValidElement(node) && node.props?.children) {
    return extractTextFromNode(node.props.children)
  }
  return ''
}

// 从 citationMap 或 refs 中查找 citation 的辅助函数
function findCitationById(
  refId: number | string,
  citationMap?: Map<number | string, CitationReference>,
  refs?: Array<CitationReference | { id: number | string }>
): CitationReference | null {
  // 优先从 citationMap 获取完整对象
  let citation = citationMap?.get(refId)
  
  // 如果 citationMap 中没有，从 refs 中查找
  if (!citation) {
    const refItem = refs?.find((r) => {
      if (typeof r !== 'object' || r == null || !('id' in r)) return false
      const rId = String((r as any).id)
      const matchId = String(refId)
      return rId === matchId
    })
    
    // 如果 refs 中的项有完整信息，直接使用；否则尝试从 citationMap 获取
    if (refItem && 'type' in refItem && 'img_url' in refItem) {
      citation = refItem as CitationReference
    } else if (refItem && 'id' in refItem) {
      // 如果只有 id，尝试从 citationMap 获取完整对象
      citation = citationMap?.get((refItem as any).id)
    }
  }
  
  return citation || null
}

// 从文本中提取图片引用ID列表（仅 type===image，避免音频被当图片展示）
function extractImageRefIdsFromText(
  text: string,
  citationMap?: Map<number | string, CitationReference>,
  refs?: Array<CitationReference | { id: number | string }>
): CitationReference[] {
  const matches = findAllCitationMatches(text)
  const imageRefs: CitationReference[] = []
  const seen = new Set<number | string>()
  
  for (const match of matches) {
    if (seen.has(match.n)) continue
    
    const citation = findCitationById(match.n, citationMap, refs)
    
    // 确保是图片类型且有 img_url
    if (citation && 'type' in citation && citation.type === 'image' && 'img_url' in citation && citation.img_url) {
      seen.add(match.n)
      imageRefs.push(citation)
    }
  }
  
  return imageRefs
}

// 从文本中提取音频引用ID列表（用于段落下方展示音频卡片）
function extractAudioRefIdsFromText(
  text: string,
  citationMap?: Map<number | string, CitationReference>,
  refs?: Array<CitationReference | { id: number | string }>
): CitationReference[] {
  const matches = findAllCitationMatches(text)
  const audioRefs: CitationReference[] = []
  const seen = new Set<number | string>()
  for (const match of matches) {
    if (seen.has(match.n)) continue
    const citation = findCitationById(match.n, citationMap, refs)
    if (citation && 'type' in citation && citation.type === 'audio') {
      seen.add(match.n)
      audioRefs.push(citation)
    }
  }
  return audioRefs
}

// 从文本中提取视频引用ID列表（用于段落下方展示视频卡片）
function extractVideoRefIdsFromText(
  text: string,
  citationMap?: Map<number | string, CitationReference>,
  refs?: Array<CitationReference | { id: number | string }>
): CitationReference[] {
  const matches = findAllCitationMatches(text)
  const videoRefs: CitationReference[] = []
  const seen = new Set<number | string>()
  for (const match of matches) {
    if (seen.has(match.n)) continue
    const citation = findCitationById(match.n, citationMap, refs)
    if (citation && 'type' in citation && citation.type === 'video') {
      seen.add(match.n)
      videoRefs.push(citation)
    }
  }
  return videoRefs
}

function CitationInlineButton({ n, onClick }: { n: number; onClick?: (rect: DOMRect) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onClick?.(rect)
      }}
      className="inline-flex items-center justify-center mx-0.5 text-[9px] font-semibold rounded-[5px] transition-all border align-text-top min-w-[1rem] h-4 px-1 text-indigo-700 dark:text-indigo-200 bg-gradient-to-br from-indigo-50 via-purple-50 to-fuchsia-50 dark:from-indigo-600/30 dark:via-purple-600/20 dark:to-fuchsia-600/30 hover:from-indigo-100 hover:via-purple-100 hover:to-fuchsia-100 dark:hover:from-indigo-600/40 dark:hover:via-purple-600/30 dark:hover:to-fuchsia-600/40 border-indigo-300/60 dark:border-indigo-700/60 shadow-sm hover:shadow active:scale-95"
      title={`点击查看引用 ${n}`}
    >
      {n}
    </button>
  )
}

// 创建 onCiteClick 回调的辅助函数
function createCiteClickHandler(
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string) => void,
  messageId?: string
) {
  return (id: number | string, rect: DOMRect, msgId?: string) => {
    const mockEvent = {
      currentTarget: { getBoundingClientRect: () => rect }
    } as React.MouseEvent
    onCiteClick?.(id, mockEvent, msgId ?? messageId)
  }
}

// 段落下方居中显示的图片组件（仅展示 type===image 且有 img_url 的引用，避免音频被当图片展示）
function ParagraphImageDisplay({
  citations,
  onCiteClick,
  messageId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
}) {
  const imageOnlyCitations = React.useMemo(
    () => citations.filter((c): c is CitationReference => c?.type === 'image' && !!c?.img_url),
    [citations]
  )
  const [failedImages, setFailedImages] = React.useState<Set<number | string>>(new Set())
  const [loadedImages, setLoadedImages] = React.useState<Set<number | string>>(new Set())
  const imageRefs = React.useRef<Map<number | string, HTMLImageElement>>(new Map())
  const failedImagesRef = React.useRef<Set<number | string>>(new Set())
  const loadedImagesRef = React.useRef<Set<number | string>>(new Set())

  // 同步 state 到 ref（避免在 useEffect 中依赖 Set）
  React.useEffect(() => {
    failedImagesRef.current = failedImages
  }, [failedImages])
  
  React.useEffect(() => {
    loadedImagesRef.current = loadedImages
  }, [loadedImages])

  if (imageOnlyCitations.length === 0) return null

  // 当 citations 变化时，检查图片是否已经加载完成（从缓存中）
  // 使用稳定的字符串作为依赖，避免数组引用变化导致的重新计算
  const citationIds = React.useMemo(() => {
    try {
      const ids = imageOnlyCitations.map(c => String(c?.id ?? '')).filter(Boolean).sort().join(',')
      return ids
    } catch {
      return ''
    }
  }, [imageOnlyCitations])
  
  React.useEffect(() => {
    if (!citationIds) return
    
    imageOnlyCitations.forEach((citation) => {
      if (!citation?.id) return
      
      // 使用 ref 检查状态，避免依赖 Set 对象
      if (failedImagesRef.current.has(citation.id)) return
      if (loadedImagesRef.current.has(citation.id)) return
      
      const img = imageRefs.current.get(citation.id)
      if (img && img.complete && img.naturalHeight !== 0) {
        // 图片已经加载完成（可能是从缓存中）
        setLoadedImages((prevLoaded) => {
          if (prevLoaded.has(citation.id)) return prevLoaded
          return new Set(prevLoaded).add(citation.id)
        })
      }
    })
    // 只依赖 citationIds 字符串，避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citationIds])

  const handleImageError = (citationId: number | string, e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.preventDefault()
    e.stopPropagation()
    setFailedImages((prev) => new Set(prev).add(citationId))
    setLoadedImages((prev) => {
      const next = new Set(prev)
      next.delete(citationId)
      return next
    })
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

  const handleImageLoad = (citationId: number | string) => {
    setLoadedImages((prev) => new Set(prev).add(citationId))
  }

  // 仅过滤加载失败图片；“首次引用去重”在父组件渲染阶段完成
  // 使用稳定的字符串作为依赖，避免 Set 对象引用变化导致的重新计算
  const failedIdsStr = React.useMemo(() => {
    return Array.from(failedImages).sort().join(',')
  }, [failedImages])
  
  const validCitations = React.useMemo(
    () => imageOnlyCitations.filter((citation) => !failedImages.has(citation.id)),
    [imageOnlyCitations, failedIdsStr]
  )

  if (validCitations.length === 0) return null

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3 mb-0">
      {validCitations.map((citation) => {
        const isFailed = failedImages.has(citation.id)
        const isLoaded = loadedImages.has(citation.id)
        
        if (isFailed) return null
        
        return (
          <button
            key={citation.id}
            type="button"
            onClick={(e) => {
              if (onCiteClick) {
                const rect = e.currentTarget.getBoundingClientRect()
                onCiteClick(citation.id, rect, messageId)
              }
            }}
            className="rounded-lg border-0 overflow-hidden hover:ring-2 ring-primary/40 transition-all p-0 m-0 relative"
          >
            {!isLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 z-10">
                <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
              </div>
            )}
            <img
              ref={(el) => {
                if (el) {
                  imageRefs.current.set(citation.id, el)
                  
                  // 立即检查是否已加载（从缓存）
                  if (el.complete && el.naturalHeight !== 0 && !loadedImagesRef.current.has(citation.id)) {
                    // 图片已从缓存加载，立即显示
                    setLoadedImages((prev) => {
                      if (prev.has(citation.id)) return prev
                      return new Set(prev).add(citation.id)
                    })
                  } else if (!el.complete) {
                    // 图片未加载，先隐藏防止显示破损图标
                    el.style.visibility = 'hidden'
                    el.style.opacity = '0'
                  }
                } else {
                  imageRefs.current.delete(citation.id)
                }
              }}
              src={citation.img_url}
              alt={citation.file_name || ''}
              className="max-h-64 max-w-full object-contain block m-0 p-0"
              style={{ 
                opacity: isLoaded ? 1 : 0, 
                transition: isLoaded ? 'opacity 0.2s' : 'none',
                visibility: isLoaded ? 'visible' : 'hidden'
              }}
              onError={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleImageError(citation.id, e)
              }}
              onLoad={() => handleImageLoad(citation.id)}
              // 防止显示 broken image 图标
              onAbort={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleImageError(citation.id, e as any)
              }}
              // 添加额外的错误处理
              onLoadStart={() => {
                // 确保加载开始时图片是隐藏的
                const img = imageRefs.current.get(citation.id)
                if (img) {
                  img.style.visibility = 'hidden'
                }
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

// 段落下方展示的音频引用卡片（图标 + 标签 + 可点击播放，不打开弹层）
function ParagraphAudioDisplay({
  citations,
  onCiteClick,
  messageId,
  displayIndexByRefId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
}) {
  const [fetchedAudioUrls, setFetchedAudioUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)

  if (citations.length === 0) return null

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3 mb-0">
      {citations.map((citation) => {
        const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
        const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
        const resolvedUrl = citation.type === 'audio' && (citation.audio_url || fetchedAudioUrls[key])
        const hasAudioUrl = !!resolvedUrl

        const handleOpenPopover = (e: React.MouseEvent) => {
          if (onCiteClick) {
            const rect = e.currentTarget.closest('.paragraph-audio-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCiteClick(citation.id, rect, messageId)
          }
        }

        const handleClickPlay = async () => {
          if (hasAudioUrl) return
          if (!citation.file_path && onCiteClick) {
            onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId)
            return
          }
          setLoadingRefId(citation.id)
          try {
            const res = await chatApi.getReferenceAudioUrl({
              kb_id: citation.debug_info?.kb_id ?? undefined,
              file_path: citation.file_path!,
            })
            if (res?.audio_url) setFetchedAudioUrls((prev) => ({ ...prev, [key]: res.audio_url }))
          } catch {
            // 失败时打开弹层，用户可在弹层/检查器中查看
            if (onCiteClick) {
              const el = document.querySelector(`.paragraph-audio-card[data-audio-key="${key}"]`) as HTMLElement
              const rect = el?.getBoundingClientRect?.() ?? new DOMRect(0, 0, 0, 0)
              onCiteClick(citation.id, rect, messageId)
            }
          } finally {
            setLoadingRefId(null)
          }
        }

        return (
          <div
            key={citation.id}
            data-audio-key={key}
            className="paragraph-audio-card relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-600/70 bg-gradient-to-br from-slate-50 via-violet-50/30 to-slate-100/90 dark:from-slate-900/80 dark:via-violet-950/20 dark:to-slate-900/80 w-full min-w-[374px] max-w-[500px] p-0 shadow-lg shadow-slate-500/5 dark:shadow-slate-500/10 hover:shadow-xl hover:shadow-violet-500/5 dark:hover:shadow-violet-500/10 hover:border-violet-200/80 dark:hover:border-violet-700/50 transition-all duration-300"
          >
            {/* 左侧装饰条 */}
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-violet-400 via-indigo-400 to-violet-500 dark:from-violet-500 dark:via-indigo-500 dark:to-violet-600 rounded-l-2xl" />
            <div className="pl-4 pr-4 pt-2.5 pb-2.5">
              {/* 标题行 */}
              <button
                type="button"
                onClick={handleOpenPopover}
                className="flex items-center gap-2.5 w-full text-left mb-2 group rounded-lg -mx-1 px-1 py-0.5 hover:bg-violet-100/40 dark:hover:bg-violet-900/20 transition-colors"
              >
                <span className="flex items-center justify-center shrink-0 w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-violet-600 dark:text-violet-400 group-hover:bg-violet-100 dark:group-hover:bg-violet-900/40 border border-slate-200/80 dark:border-slate-600/60 shadow-sm transition-all">
                  <Music className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate flex items-baseline gap-1.5">
                  <span className="font-mono text-violet-600 dark:text-violet-400 font-bold tabular-nums">[{displayNum}]</span>
                  <span className="text-slate-600 dark:text-slate-300">音频引用</span>
                </span>
              </button>
              {/* 播放器区域 */}
              {hasAudioUrl ? (
                <div className="rounded-xl bg-white/95 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-600/80 p-2 mb-2 shadow-inner ring-1 ring-black/5 dark:ring-white/5">
                  <audio
                    src={resolvedUrl!}
                    controls
                    className="w-full h-8 rounded-lg [&::-webkit-media-controls-panel]:bg-slate-50/80 dark:[&::-webkit-media-controls-panel]:bg-slate-800/80"
                    preload="metadata"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleClickPlay}
                  disabled={loadingRefId === citation.id}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white/80 dark:bg-slate-800/70 text-violet-700 dark:text-violet-300 hover:bg-violet-50/80 dark:hover:bg-slate-800/90 border border-slate-200/80 dark:border-slate-600/60 transition-all mb-2 disabled:opacity-60 shadow-sm text-sm font-medium ring-1 ring-violet-500/10 dark:ring-violet-500/20"
                >
                  {loadingRefId === citation.id ? (
                    <span className="font-medium">加载中…</span>
                  ) : (
                    <>
                      <Play className="h-4 w-4 flex-shrink-0" fill="currentColor" />
                      <span className="font-medium">点击播放</span>
                    </>
                  )}
                </button>
              )}
              {/* 文件名 */}
              {citation.file_name && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mb-1.5 font-mono pl-0.5" title={citation.file_name}>
                  {citation.file_name}
                </p>
              )}
              {/* 转写/描述内容（不区分歌词或语音，不显示标签） */}
              {citation.content && (
                <div className="rounded-xl bg-white/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-600/60 px-3 py-1.5 ring-1 ring-black/5 dark:ring-white/5">
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">{citation.content}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// 带时间点跳转的视频播放器：加载后跳到 start_sec，可选在 end_sec 暂停
function VideoPlayerWithSeek({
  src,
  startSec,
  endSec,
  className,
  onClick,
}: {
  src: string
  startSec?: number | null
  endSec?: number | null
  className?: string
  onClick?: (e: React.MouseEvent<HTMLVideoElement>) => void
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const hasSeeked = React.useRef(false)
  React.useEffect(() => {
    hasSeeked.current = false
  }, [src])
  React.useEffect(() => {
    const el = videoRef.current
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
    return () => {
      el.removeEventListener('canplay', onCanPlay)
    }
  }, [src, startSec])
  React.useEffect(() => {
    if (endSec == null || !Number.isFinite(endSec)) return
    const el = videoRef.current
    if (!el) return
    const onTimeUpdate = () => {
      if (el.currentTime >= endSec) el.pause()
    }
    el.addEventListener('timeupdate', onTimeUpdate)
    return () => el.removeEventListener('timeupdate', onTimeUpdate)
  }, [endSec])
  return (
    <video
      ref={videoRef}
      src={src}
      controls
      preload="metadata"
      className={className}
      onClick={onClick}
    />
  )
}

// 将秒数格式化为 MM:SS 或 HH:MM:SS
function formatTimeLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// 短文件名展示：优先取最后一段 _ 后的名称（如 UUID_Peaky.mp4 → Peaky.mp4），否则截断
function shortenFileName(fileName: string, maxLen = 24): string {
  if (!fileName || fileName.length <= maxLen) return fileName
  const lastPart = fileName.includes('_') ? fileName.split('_').pop() ?? fileName : fileName
  if (lastPart.length <= maxLen) return lastPart
  const ext = lastPart.includes('.') ? lastPart.slice(lastPart.lastIndexOf('.')) : ''
  const base = lastPart.slice(0, lastPart.length - ext.length)
  if (base.length + ext.length <= maxLen) return lastPart
  return base.slice(0, Math.max(0, maxLen - ext.length - 1)) + '…' + ext
}

// 段落下方展示的视频引用卡片（图标 + 标签 + 可点击播放，不打开弹层）
function ParagraphVideoDisplay({
  citations,
  onCiteClick,
  messageId,
  displayIndexByRefId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
}) {
  const [fetchedVideoUrls, setFetchedVideoUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)
  const [expandedDesc, setExpandedDesc] = React.useState<Set<string>>(new Set())

  if (citations.length === 0) return null

  const toggleDesc = (k: string) => {
    setExpandedDesc((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3 mb-0">
      {citations.map((citation) => {
        const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
        const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
        const resolvedUrl = citation.type === 'video' && (citation.video_url || fetchedVideoUrls[key])
        const hasVideoUrl = !!resolvedUrl
        const startSec = citation.start_sec != null ? Number(citation.start_sec) : null
        const endSec = citation.end_sec != null ? Number(citation.end_sec) : null
        const segmentLabel =
          startSec != null && endSec != null
            ? `片段 ${formatTimeLabel(startSec)} - ${formatTimeLabel(endSec)}`
            : startSec != null
              ? `从 ${formatTimeLabel(startSec)} 开始`
              : endSec != null
                ? `至 ${formatTimeLabel(endSec)} 结束`
                : null
        const descExpanded = expandedDesc.has(key)
        const content = citation.content?.trim() ?? ''
        const canExpand = content.length > 120

        const handleOpenPopover = (e: React.MouseEvent) => {
          if (onCiteClick) {
            const rect = e.currentTarget.closest('.paragraph-video-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCiteClick(citation.id, rect, messageId)
          }
        }

        const handleClickPlay = async () => {
          if (hasVideoUrl) return
          if (!citation.file_path && onCiteClick) {
            onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId)
            return
          }
          setLoadingRefId(citation.id)
          try {
            const res = await chatApi.getReferenceVideoUrl({
              kb_id: citation.debug_info?.kb_id ?? undefined,
              file_path: citation.file_path!,
            })
            if (res?.video_url) setFetchedVideoUrls((prev) => ({ ...prev, [key]: res.video_url }))
          } catch {
            if (onCiteClick) {
              const el = document.querySelector(`.paragraph-video-card[data-video-key="${key}"]`) as HTMLElement
              const rect = el?.getBoundingClientRect?.() ?? new DOMRect(0, 0, 0, 0)
              onCiteClick(citation.id, rect, messageId)
            }
          } finally {
            setLoadingRefId(null)
          }
        }

        return (
          <div
            key={citation.id}
            data-video-key={key}
            className="paragraph-video-card relative overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-600/50 bg-white dark:bg-slate-900/80 w-full min-w-[400px] max-w-[560px] p-0 shadow-sm shadow-slate-300/10 dark:shadow-slate-950/40 ring-1 ring-slate-200/40 dark:ring-slate-700/40 hover:shadow-md hover:ring-sky-200/50 dark:hover:ring-sky-800/40 hover:border-sky-200/80 dark:hover:border-sky-600/50 transition-all duration-200"
          >
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-sky-400 via-sky-500 to-cyan-500 dark:from-sky-500 dark:via-cyan-500 dark:to-sky-600 rounded-l-2xl shadow-[2px_0_8px_-2px_rgba(14,165,233,0.25)] dark:shadow-[2px_0_8px_-2px_rgba(14,165,233,0.2)]" aria-hidden />
            <div className="pl-[18px] pr-4 pt-2.5 pb-2.5">
              <button
                type="button"
                onClick={handleOpenPopover}
                className="flex items-center gap-3 w-full text-left mb-1.5 group rounded-xl -mx-0.5 px-1.5 py-0.5 hover:bg-sky-50/70 dark:hover:bg-sky-900/30 transition-colors duration-150"
              >
                <span className="flex items-center justify-center shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-sky-50 to-cyan-50/80 dark:from-sky-900/50 dark:to-cyan-900/30 text-sky-600 dark:text-sky-400 group-hover:from-sky-100 group-hover:to-cyan-100/80 dark:group-hover:from-sky-800/60 dark:group-hover:to-cyan-800/40 border border-sky-200/50 dark:border-sky-700/40 shadow-sm transition-all duration-150">
                  <Video className="h-4.5 w-4.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-baseline gap-2 tracking-tight">
                  <span className="font-mono text-sky-600 dark:text-sky-400 font-bold tabular-nums">[{displayNum}]</span>
                  <span className="text-slate-600 dark:text-slate-300">视频引用</span>
                </span>
              </button>
              {hasVideoUrl ? (
                <div className="rounded-xl overflow-hidden bg-slate-50/90 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-600/50 p-0 mb-0.5 shadow-inner shadow-slate-200/30 dark:shadow-slate-900/50">
                  {segmentLabel && (
                    <div className="mb-0.5 mt-0.5 flex items-center px-0.5">
                      <span className="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-medium bg-sky-100/90 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-700/50 shadow-sm shadow-sky-500/5">
                        {segmentLabel}
                      </span>
                    </div>
                  )}
                  <VideoPlayerWithSeek
                    src={resolvedUrl!}
                    startSec={startSec}
                    endSec={endSec}
                    className="w-full h-auto aspect-video rounded-lg object-contain bg-black shadow-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleClickPlay}
                  disabled={loadingRefId === citation.id}
                  className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-gradient-to-b from-sky-50/90 to-cyan-50/50 dark:from-sky-950/50 dark:to-cyan-950/30 text-sky-700 dark:text-sky-300 hover:from-sky-100 hover:to-cyan-100/60 dark:hover:from-sky-900/60 dark:hover:to-cyan-900/40 border border-sky-200/60 dark:border-sky-700/50 transition-all duration-150 mb-2 disabled:opacity-60 text-sm font-medium shadow-sm"
                >
                  {loadingRefId === citation.id ? (
                    <span>加载中…</span>
                  ) : (
                    <>
                      <Play className="h-4 w-4 flex-shrink-0" fill="currentColor" />
                      <span>点击播放</span>
                    </>
                  )}
                </button>
              )}
              {citation.file_name && (
                <p
                  className="text-[10px] text-slate-400 dark:text-slate-500 truncate mb-0.5 font-mono pl-0.5 tracking-tight"
                  title={citation.file_name}
                >
                  {shortenFileName(citation.file_name)}
                </p>
              )}
              {content && (
                <div className="rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-600/40 px-2.5 py-1 shadow-inner shadow-slate-200/20 dark:shadow-slate-900/30">
                  <p
                    className={cn(
                      'text-[11px] text-slate-600 dark:text-slate-300 leading-snug',
                      !descExpanded && canExpand && 'line-clamp-2'
                    )}
                  >
                    {content}
                  </p>
                  {canExpand && (
                    <button
                      type="button"
                      onClick={() => toggleDesc(key)}
                      className="mt-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 hover:underline underline-offset-1 transition-colors"
                    >
                      {descExpanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
              )}
              {citation.key_frames && citation.key_frames.length > 0 && (
                <div className="mt-2.5">
                  <p className="text-[11px] text-sky-600 dark:text-sky-400 font-medium mb-1.5 tracking-tight">关键帧</p>
                  <div className="flex flex-wrap gap-2">
                    {citation.key_frames
                      .filter((f) => f.img_url)
                      .map((frame, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg overflow-hidden border border-slate-200/60 dark:border-slate-600/50 bg-white dark:bg-slate-800/80 shadow-sm hover:shadow-md hover:border-slate-300/50 dark:hover:border-slate-500/50 transition-all duration-150"
                        >
                          <img
                            src={frame.img_url}
                            alt={frame.description || `关键帧 ${idx + 1}`}
                            className="w-24 h-[54px] object-cover block"
                          />
                          {(frame.timestamp != null || frame.description) && (
                            <div className="px-1.5 py-0.5 bg-slate-100/80 dark:bg-slate-800/80">
                              {frame.timestamp != null && (
                                <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono mr-1">
                                  {formatTimeLabel(frame.timestamp)}
                                </span>
                              )}
                              {frame.description && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1" title={frame.description}>
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
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function MessageBubble({
  message,
  isStreaming = false,
  liveThinking,
  citationMap,
  onCiteClick,
}: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const showThinking = !isUser && (message.thinking || (isStreaming && liveThinking))
  const isStoppedHint = !isUser && message.error === 'stopped_hint' // 终止提示消息
  const thoughtData = isStreaming && liveThinking
    ? liveThinking.thoughtData
    : Array.isArray(message.thinking)
      ? (message.thinking[0]?.data as ThoughtData) ?? null
      : (message.thinking as ThoughtData) ?? null
  const refs = message.citations ?? []
  const orderedRefIds = !isUser ? getOrderedRefIdsFromContent(message.content) : []
  const originalIdToDisplayIndex = React.useMemo(() => {
    const m = new Map<number | string, number>()
    orderedRefIds.forEach((id, i) => m.set(id, i + 1))
    return m
  }, [orderedRefIds.join(',')])
  const orderedRefs = React.useMemo(() => {
    return orderedRefIds
      .map((id) => citationMap?.get(id) ?? refs.find((r) => typeof r === 'object' && r != null && (r as any).id === id) ?? { id })
      .filter((r): r is CitationReference | { id: number | string } => r != null && typeof r === 'object' && 'id' in r)
  }, [orderedRefIds.join(','), citationMap, refs])
  
  // 预先扫描整个内容，找出每个图片第一次出现的引用ID
  // 使用 useMemo 确保只在内容变化时重新计算
  const imageFirstRefIdMap = React.useMemo(() => {
    if (isUser) return new Map<string, number | string>()
    
    const map = new Map<string, number | string>()
    const seenImages = new Set<string>()
    
    // 按照文本顺序扫描所有引用
    const matches = findAllCitationMatches(message.content)
    
    for (const match of matches) {
      const citation = findCitationById(match.n, citationMap, refs)
      
      // 如果是图片类型，记录第一次出现的引用ID
      if (citation && 'type' in citation && citation.type === 'image' && 'img_url' in citation && citation.img_url) {
        const imageKey = citation.img_url || citation.file_name || String(citation.id)
        if (!seenImages.has(imageKey)) {
          seenImages.add(imageKey)
          map.set(imageKey, match.n)
        }
      }
    }
    
    return map
  }, [message.content, citationMap, refs, isUser])

  // 每个音频引用第一次出现的引用ID（用于段落内只展示首次出现的音频）
  const audioFirstRefIdMap = React.useMemo(() => {
    if (isUser) return new Map<string, number | string>()
    const map = new Map<string, number | string>()
    const seen = new Set<string>()
    const matches = findAllCitationMatches(message.content)
    for (const match of matches) {
      const citation = findCitationById(match.n, citationMap, refs)
      if (citation && 'type' in citation && citation.type === 'audio') {
        const key = citation.file_name || String(citation.id)
        if (!seen.has(key)) {
          seen.add(key)
          map.set(key, match.n)
        }
      }
    }
    return map
  }, [message.content, citationMap, refs, isUser])

  // 去重函数：用于过滤重复的引用
  const deduplicateRefs = React.useCallback((refsToDedup: Array<CitationReference | { id: number | string }>) => {
    return refsToDedup.filter((ref, idx, arr) => {
      const isObj = typeof ref === 'object' && ref != null && 'id' in ref
      if (!isObj) return false
      const type = 'type' in ref ? (ref as any).type : undefined
      const fileName = 'file_name' in ref ? String((ref as any).file_name || '') : ''
      // 对于图片类型，使用 file_name 去重；对于文档类型，使用 id 去重
      const key = type === 'image' && fileName ? `image:${fileName}` : String((ref as any).id)
      return arr.findIndex(r => {
        const rObj = typeof r === 'object' && r != null && 'id' in r
        if (!rObj) return false
        const rType = 'type' in r ? (r as any).type : undefined
        const rFileName = 'file_name' in r ? String((r as any).file_name || '') : ''
        const rKey = rType === 'image' && rFileName ? `image:${rFileName}` : String((r as any).id)
        return rKey === key
      }) === idx
    })
  }, [])
  
  const uniqueRefs = React.useMemo(() => {
    // 如果文本中有引用标记，使用 orderedRefs；否则使用所有 refs（去重后）
    if (orderedRefs.length > 0) {
      return orderedRefs
    }
    // 当文本中没有引用标记时，仍然显示所有可用的引用
    return deduplicateRefs(refs.filter((ref): ref is CitationReference | { id: number | string } => 
      typeof ref === 'object' && ref != null && 'id' in ref
    ))
  }, [orderedRefs, refs, deduplicateRefs])
  const allImageRefsForThumbnails = React.useMemo(() => {
    if (isUser) return []
    const seen = new Set<string | number>()
    const out: (CitationReference | { id: number | string })[] = []
    for (const r of refs) {
      const full = typeof r === 'object' && r != null && 'id' in r
        ? (citationMap?.get((r as any).id) ?? r)
        : null
      if (full && (full as CitationReference).type === 'image') {
        const key = (full as CitationReference).file_name ?? (full as any).id
        if (!seen.has(key)) {
          seen.add(key)
          out.push(full as CitationReference)
        }
      }
    }
    return out
  }, [refs, citationMap, isUser])
  const hasRefs = uniqueRefs.length > 0 || allImageRefsForThumbnails.length > 0

  // 创建 markdown 组件的工厂函数
  const markdownComponents = React.useMemo(() => {
    const handleCiteClick = createCiteClickHandler(onCiteClick, message.id)
    
    const createComponent = (tag: 'p' | 'li', className: string) => {
      return (props: { children?: React.ReactNode }) => {
        const { children } = props
        if (!children) return null
        
        const textContent = extractTextFromNode(children)
        const allImageRefs = extractImageRefIdsFromText(textContent, citationMap, refs)
        const allAudioRefs = extractAudioRefIdsFromText(textContent, citationMap, refs)
        const allVideoRefs = extractVideoRefIdsFromText(textContent, citationMap, refs)
        
        const newImageRefs = allImageRefs.filter((citation) => {
          const imageKey = citation.img_url || citation.file_name || String(citation.id)
          const firstRefId = imageFirstRefIdMap.get(imageKey)
          if (firstRefId === undefined) return false
          const matches = findAllCitationMatches(textContent)
          return matches.some(m => String(m.n) === String(firstRefId))
        })
        const newAudioRefs = allAudioRefs.filter((citation) => {
          const audioKey = citation.file_name || String(citation.id)
          const firstRefId = audioFirstRefIdMap.get(audioKey)
          if (firstRefId === undefined) return false
          const matches = findAllCitationMatches(textContent)
          return matches.some(m => String(m.n) === String(firstRefId))
        })
        // 视频引用：段落内出现的每个引用编号都展示一张卡片（[1][2][3][4] 可能对应不同片段），不做按 file_name 去重
        const newVideoRefs = allVideoRefs
        
        const Tag = tag
        
        return (
          <>
            <Tag className={className}>
              {injectCitations(children, handleCiteClick, message.id, originalIdToDisplayIndex, citationMap)}
            </Tag>
            {newImageRefs.length > 0 && (
              <ParagraphImageDisplay
                citations={newImageRefs}
                onCiteClick={handleCiteClick}
                messageId={message.id}
              />
            )}
            {newAudioRefs.length > 0 && (
              <ParagraphAudioDisplay
                citations={newAudioRefs}
                onCiteClick={handleCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
              />
            )}
            {newVideoRefs.length > 0 && (
              <ParagraphVideoDisplay
                citations={newVideoRefs}
                onCiteClick={handleCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
              />
            )}
          </>
        )
      }
    }
    
    // 自定义 img 组件，防止显示破损图片图标
    const ImageComponent = React.memo(({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const [imageError, setImageError] = React.useState(false)
      const [imageLoaded, setImageLoaded] = React.useState(false)
      const imgRef = React.useRef<HTMLImageElement>(null)
      
      const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
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
      }
      
      const handleLoad = () => {
        setImageLoaded(true)
        setImageError(false)
      }
      
      React.useEffect(() => {
        const img = imgRef.current
        if (img) {
          // 加载开始时隐藏，防止显示破损图标
          if (!img.complete) {
            img.style.visibility = 'hidden'
            img.style.opacity = '0'
          } else if (img.naturalHeight !== 0) {
            // 图片已从缓存加载
            setImageLoaded(true)
          }
        }
      }, [src])
      
      if (imageError) {
        return null
      }
      
      return (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          {...props}
          style={{
            ...props.style,
            opacity: imageLoaded ? 1 : 0,
            transition: imageLoaded ? 'opacity 0.2s' : 'none',
            visibility: imageLoaded ? 'visible' : 'hidden',
          }}
          onError={handleError}
          onLoad={handleLoad}
          onAbort={handleError}
          onLoadStart={() => {
            const img = imgRef.current
            if (img && !imageLoaded) {
              img.style.visibility = 'hidden'
              img.style.opacity = '0'
            }
          }}
          className={cn('max-w-full h-auto rounded border border-slate-200 dark:border-slate-700', props.className)}
        />
      )
    })
    ImageComponent.displayName = 'MarkdownImage'
    
    return {
      p: createComponent('p', 'mb-2 leading-relaxed'),
      li: createComponent('li', 'mb-0'),
      img: ImageComponent,
    }
  }, [imageFirstRefIdMap, citationMap, refs, originalIdToDisplayIndex, message.id, onCiteClick])

  const AvatarIcon = isUser ? User : Bot
  const avatarBg = isUser
    ? 'bg-gradient-to-br from-indigo-500 to-sky-500 text-white'
    : 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white'

  const avatarEl = (
    <Avatar
      size="md"
      fallback={<AvatarIcon className="w-4 h-4" strokeWidth={2.5} />}
      rootClassName="shadow-md ring-2 ring-white/20 dark:ring-slate-800/50"
      fallbackClassName={avatarBg}
    />
  )

  const bubbleEl = (
    <div
      className={cn(
        'rounded-2xl px-4 py-3.5 text-sm leading-relaxed transition-all',
        isUser
          ? 'inline-block w-auto max-w-[calc(100%-2.5rem)] rounded-tr-sm bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30'
          : isStoppedHint
            ? 'w-auto mx-auto border-0 bg-transparent shadow-none' // 终止提示：无边框、透明背景、居中
            : 'w-full max-w-[calc(100%-2.5rem)] rounded-tl-sm border border-slate-200/60 bg-white text-slate-900 shadow-sm dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-100 hover:shadow-md',
        !isUser && showThinking && !isStoppedHint && 'min-w-[min(100%,28rem)]'
      )}
    >
      {isStoppedHint ? (
        // 终止提示消息 - 类似 Gemini 的显示方式：居中、浅灰色背景
        <div className="rounded-md bg-slate-100 dark:bg-slate-800/60 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
          你已让系统停止这条回答
        </div>
      ) : (
        <>
          {showThinking && (
            <ThinkingCapsule
              thoughtData={thoughtData}
              stages={liveThinking?.stages}
              currentStage={liveThinking?.currentStage}
            />
          )}

          {isUser ? (
            <div className="break-words">{message.content}</div>
          ) : (
            <div className="prose prose-slate max-w-none text-sm dark:prose-invert prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-200/70 prose-pre:bg-slate-900/5 prose-pre:shadow-sm dark:prose-pre:border-slate-800/70 dark:prose-pre:bg-white/5 [&>p:has(+div)]:!mb-0 [&>p]:mb-2 [&>p:last-child]:mb-0 [&>li]:mb-1">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={markdownComponents as any}
              >
                {message.content}
              </ReactMarkdown>

              {isStreaming && message.content && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle dark:bg-slate-500" />
              )}
            </div>
          )}

          {hasRefs && !isUser && (
            <div className="mt-3 space-y-2">
              <InlineCitation
                references={uniqueRefs}
                variant="inline"
                showImageThumbnails
                citationMap={citationMap}
                onCiteClick={onCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
                imageThumbnailRefs={allImageRefsForThumbnails.length > 0 ? allImageRefsForThumbnails : undefined}
              />
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="flex items-start gap-2">
      {isUser ? (
        <>
          <div className="flex-1 flex justify-end min-w-0">
            {bubbleEl}
          </div>
          {avatarEl}
        </>
      ) : isStoppedHint ? (
        // 终止提示不显示头像，居中显示
        <div className="flex-1 flex justify-center min-w-0">
          {bubbleEl}
        </div>
      ) : (
        <>
          {avatarEl}
          <div className="flex-1 min-w-0">
            {bubbleEl}
          </div>
        </>
      )}
    </div>
  )
}
