import React, { Suspense } from 'react'
import { ChevronDown, FileText, Music, Pause, Play, Video } from 'lucide-react'
import { InlineCitation } from './InlineCitation'
import type { Components, ExtraProps } from 'react-markdown'
import { cn } from '@/lib/utils'
import { chatApi } from '@/services/api_client'
import type { CitationReference } from '@/types/sse'
import {
  useChatStore,
  type ChatMessageAttachment,
  type ChatScopeFile,
  type Message,
  type ThoughtData,
  type ThinkingState,
} from '@/store/useChatStore'
import { useConfigStore } from '@/store/useConfigStore'
import { UserMessageAttachmentStrip } from './ChatAttachmentPreview'

type CitationStub = { id: number | string }
type CitationLike = CitationReference | CitationStub
type ReactNodeChildrenProps = { children?: React.ReactNode }

let katexCssLoadPromise: Promise<unknown> | null = null

const ThinkingCapsule = React.lazy(() =>
  import('./ThinkingCapsule').then((module) => ({ default: module.ThinkingCapsule }))
)

const MarkdownRenderer = React.lazy(() =>
  import('./MarkdownRenderer').then((module) => ({ default: module.MarkdownRenderer }))
)

function ensureKatexCssLoaded() {
  if (!katexCssLoadPromise) {
    katexCssLoadPromise = import('katex/dist/katex.min.css')
  }
  return katexCssLoadPromise
}

/** 流式时从 ChatInterface 传入的实时思考数据，保证思考框在气泡顶部展示 */
export interface LiveThinkingProps {
  thoughtData?: ThoughtData | null
  stages?: ThinkingState['stages']
  currentStage?: string
}

function ThinkingCapsuleFallback() {
  return (
    <div className="w-full rounded-xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-400">
      正在载入思考过程…
    </div>
  )
}

function MarkdownRendererFallback({ streaming }: { streaming?: boolean }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      {streaming ? '正在准备渲染回答…' : '正在载入 Markdown 渲染器…'}
    </div>
  )
}

export interface MessageBubbleMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: string
  citations?: CitationLike[]
  metadata?: {
    chunks_count?: number
    images_count?: number
    references_used?: (number | string)[]
    intent_type?: string
    processing_time?: number
  }
  thinking?: Message['thinking'] | null
  error?: string
  attachments?: ChatMessageAttachment[]
  scopeFiles?: ChatScopeFile[]
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
  if (!React.isValidElement<ReactNodeChildrenProps>(children)) return children
  if (children.props.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: injectCitations(children.props.children, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)
    })
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

/**
 * 生成稳定的媒体资源标识。
 *
 * 引用编号只代表本次回答里的证据编号：同一图片/音频/视频可能因检索到不同 chunk 或
 * 不同段落而对应多个编号。因此展示层不能用 id 判重，应优先使用知识库 + 原始文件路径。
 * 预签名 URL 的 query 会变化，仅在没有文件路径时才把去掉 query 的 URL 作为回退。
 */
function getMediaSourceKey(citation: CitationReference): string {
  const kbId = citation.debug_info?.kb_id?.trim() || 'unknown-kb'
  const filePath = citation.file_path?.trim()
  if (filePath) return `kb:${kbId}:path:${filePath.replace(/\\+/g, '/')}`

  const mediaUrl = citation.img_url || citation.audio_url || citation.video_url
  if (mediaUrl) {
    try {
      const parsed = new URL(mediaUrl)
      return `kb:${kbId}:url:${parsed.origin}${parsed.pathname}`
    } catch {
      return `kb:${kbId}:url:${mediaUrl.split(/[?#]/, 1)[0]}`
    }
  }

  const fileName = citation.file_name?.trim()
  if (fileName) return `kb:${kbId}:name:${fileName}`
  return `kb:${kbId}:ref:${String(citation.id)}`
}

function getVideoSegmentKey(citation: CitationReference): string {
  // 后端时间戳可能因序列化有极小差异；0.1 秒精度足以识别同一 Shot，
  // 又不会把同一视频的不同片段合并成一张卡片。
  const formatTime = (value: number | undefined) => {
    const time = Number(value)
    return Number.isFinite(time) ? (Math.round(time * 10) / 10).toFixed(1) : 'whole'
  }
  return `${formatTime(citation.start_sec)}-${formatTime(citation.end_sec)}`
}

function getCitationIdentityKey(citation: CitationReference): string {
  const sourceKey = getMediaSourceKey(citation)
  // 视频的同一文件可以有多个有效 Shot；只有文件和时间片段都相同才视为重复。
  if (citation.type === 'video') {
    return `video:${sourceKey}:segment:${getVideoSegmentKey(citation)}`
  }
  return `${citation.type}:${sourceKey}`
}

/**
 * 新回答不再下发视频关键帧；这里保留路径与标记双重识别，确保已经持久化的旧会话
 * 也不会把关键帧伪装成普通图片插入回答正文。
 */
function isVideoKeyframeCitation(citation: CitationReference | null | undefined): boolean {
  if (!citation) return false
  if (citation.debug_info?.from_video_keyframe) return true
  const path = `${citation.file_path || ''}/${citation.file_name || ''}`.replace(/\\+/g, '/')
  return /(?:^|\/)videos\/[^/]+\/keyframes(?:\/|$)/i.test(path)
}

function buildFirstMediaOccurrenceMap(
  matches: CitationMatch[],
  mediaType: CitationReference['type'],
  citationMap?: Map<number | string, CitationReference>,
  refs?: CitationLike[]
): Map<string, number> {
  const firstOccurrenceByKey = new Map<string, number>()

  for (const match of matches) {
    const citation = findCitationById(match.n, citationMap, refs)
    if (!citation || citation.type !== mediaType) continue
    if (mediaType === 'image' && isVideoKeyframeCitation(citation)) continue
    const key = getCitationIdentityKey(citation)
    if (!firstOccurrenceByKey.has(key)) {
      firstOccurrenceByKey.set(key, match.start)
    }
  }

  return firstOccurrenceByKey
}

function collectFirstMediaRefsForBlock(
  blockMatches: CitationMatch[],
  mediaType: 'image' | 'audio' | 'video',
  firstOccurrenceByKey: Map<string, number>,
  citationMap?: Map<number | string, CitationReference>,
  refs?: CitationLike[]
): CitationReference[] {
  const mediaRefs: CitationReference[] = []
  const seenInBlock = new Set<string>()

  for (const match of blockMatches) {
    const citation = findCitationById(match.n, citationMap, refs)
    if (!citation || citation.type !== mediaType) continue
    if (mediaType === 'image' && isVideoKeyframeCitation(citation)) continue

    const key = getCitationIdentityKey(citation)
    if (seenInBlock.has(key)) continue
    if (firstOccurrenceByKey.get(key) !== match.start) continue

    seenInBlock.add(key)
    mediaRefs.push(citation)
  }

  return mediaRefs
}

/** 作为展示层的最后一道保护：即使上游传入了同一素材的多个引用，也只保留一个媒体播放器/图片。 */
function deduplicateMediaCitations(citations: CitationReference[]): CitationReference[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = getCitationIdentityKey(citation)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** react-markdown 传给 components 的是 HAST：子段落为 element/tagName=p。
 * 同时兼容直接使用 remark AST 时的 paragraph，避免 li 和其内 p 各自插入一次媒体。 */
function listItemHasParagraphChild(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const children = (node as { children?: unknown }).children
  if (!Array.isArray(children)) return false

  return children.some((child) => {
    if (!child || typeof child !== 'object') return false
    const item = child as { type?: string; tagName?: string }
    return item.type === 'paragraph' || item.tagName === 'p'
  })
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

function isCitationLike(value: unknown): value is CitationLike {
  return typeof value === 'object' && value != null && 'id' in value
}

function getCitationRefId(ref: CitationLike) {
  return ref.id
}

function getCitationRefType(ref: CitationLike) {
  return 'type' in ref ? ref.type : undefined
}

function getCitationRefFileName(ref: CitationLike) {
  return 'file_name' in ref ? ref.file_name : undefined
}

// 从 refs / citationMap 中查找 citation：优先当前消息 refs，避免跨轮次共用 id 时误用其它消息的 map
function findCitationById(
  refId: number | string,
  citationMap?: Map<number | string, CitationReference>,
  refs?: CitationLike[]
): CitationReference | null {
  const refItem = refs?.find((r) => {
    if (!isCitationLike(r)) return false
    const rId = String(getCitationRefId(r))
    const matchId = String(refId)
    return rId === matchId
  })

  if (refItem && 'type' in refItem && 'img_url' in refItem) {
    return refItem as CitationReference
  }
  if (refItem && 'type' in refItem) {
    return refItem as CitationReference
  }

  const fromMap = citationMap?.get(refId)
  if (fromMap) return fromMap

  if (refItem && 'id' in refItem) {
    return (citationMap?.get(getCitationRefId(refItem)) ?? refItem) as CitationReference
  }

  return null
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
      aria-label={`查看引用 ${n}`}
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

// 段落下方居中显示的图片组件（展示 type===image 且有 img_url 或可刷新 file_path+kb_id 的引用）
function ParagraphImageDisplay({
  citations,
  onCiteClick,
  messageId,
  fallbackKbId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
  fallbackKbId?: string
}) {
  // 有 img_url 或具备 file_path + kb_id（可按需刷新）的图片引用均展示；按真实素材去重。
  const imageOnlyCitations = React.useMemo(() => {
    const raw = citations.filter(
      (c): c is CitationReference =>
        c?.type === 'image' &&
        !isVideoKeyframeCitation(c) &&
        (!!c?.img_url || (!!(c?.file_path || c?.file_name) && !!(c?.debug_info?.kb_id || fallbackKbId)))
    )
    return deduplicateMediaCitations(raw)
  }, [citations, fallbackKbId])
  const [failedImages, setFailedImages] = React.useState<Set<number | string>>(new Set())
  const [loadedImages, setLoadedImages] = React.useState<Set<number | string>>(new Set())
  /** 按需刷新后的图片 URL（用于历史消息中 presigned URL 过期后重新拉取） */
  const [refreshedImgUrls, setRefreshedImgUrls] = React.useState<Record<string, string>>({})
  const refreshAttemptedRef = React.useRef<Set<string>>(new Set())
  const loadTimeoutsRef = React.useRef<Map<string, number>>(new Map())
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

  React.useEffect(() => {
    const loadTimeouts = loadTimeoutsRef.current
    return () => {
      loadTimeouts.forEach((timer) => window.clearTimeout(timer))
      loadTimeouts.clear()
    }
  }, [])

  const buildImageKey = React.useCallback(
    (citationId: number | string) => (messageId ? `${messageId}-${citationId}` : String(citationId)),
    [messageId]
  )

  // 无有效 URL 但有 file_path + kb_id 时按需拉取图片预览（如从历史加载的引用）
  React.useEffect(() => {
    let cancelled = false
    imageOnlyCitations.forEach((citation) => {
      const key = buildImageKey(citation.id)
      const kbId = citation.debug_info?.kb_id || fallbackKbId
      const filePath = citation.file_path || citation.file_name
      if (citation.img_url || refreshedImgUrls[key] || !filePath || !kbId) return
      chatApi
        .getReferenceImageUrl({ kb_id: kbId, file_path: filePath })
        .then((res) => {
          if (!cancelled && res?.img_url) setRefreshedImgUrls((prev) => ({ ...prev, [key]: res.img_url }))
        })
        .catch(() => { })
    })
    return () => {
      cancelled = true
    }
  }, [buildImageKey, fallbackKbId, imageOnlyCitations, refreshedImgUrls])

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
  }, [citationIds, imageOnlyCitations])

  const handleImageError = React.useCallback(
    async (citationId: number | string, citation: CitationReference, e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      e.preventDefault()
      e.stopPropagation()
      const key = buildImageKey(citationId)
      const oldTimer = loadTimeoutsRef.current.get(key)
      if (oldTimer) {
        window.clearTimeout(oldTimer)
        loadTimeoutsRef.current.delete(key)
      }
      const kbId = citation.debug_info?.kb_id || fallbackKbId
      const filePath = citation.file_path || citation.file_name
      if (filePath && kbId) {
        try {
          const res = await chatApi.getReferenceImageUrl({ kb_id: kbId, file_path: filePath })
          if (res?.img_url) {
            setRefreshedImgUrls((prev) => ({ ...prev, [key]: res.img_url }))
            refreshAttemptedRef.current.add(key)
            setFailedImages((prev) => {
              const next = new Set(prev)
              next.delete(citationId)
              return next
            })
            return
          }
        } catch {
          // 刷新失败，下面会标记为失败
        }
      }
      setFailedImages((prev) => new Set(prev).add(citationId))
      setLoadedImages((prev) => {
        const next = new Set(prev)
        next.delete(citationId)
        return next
      })
      const img = e.currentTarget
      img.setAttribute('data-error', 'true')
      img.style.display = 'none'
      img.style.visibility = 'hidden'
      img.style.opacity = '0'
      img.style.width = '0'
      img.style.height = '0'
      const button = img.closest('button')
      if (button) {
        button.style.display = 'none'
      }
    },
    [buildImageKey, fallbackKbId]
  )

  const handleImageLoad = (citationId: number | string) => {
    setLoadedImages((prev) => new Set(prev).add(citationId))
  }

  // 仅过滤加载失败图片；“首次引用去重”在父组件渲染阶段完成
  const validCitations = React.useMemo(
    () => imageOnlyCitations.filter((citation) => !failedImages.has(citation.id)),
    [failedImages, imageOnlyCitations]
  )

  if (imageOnlyCitations.length === 0) return null
  if (validCitations.length === 0) return null

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3 mb-0">
      {validCitations.map((citation) => {
        const isFailed = failedImages.has(citation.id)
        const isLoaded = loadedImages.has(citation.id)
        const imageKey = buildImageKey(citation.id)

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
            aria-label={`查看图片引用：${citation.file_name || `引用 ${citation.id}`}`}
          >
            {!isLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800 z-10" role="status" aria-label="图片引用加载中">
                <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full" aria-hidden />
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
              src={refreshedImgUrls[imageKey] || citation.img_url || ''}
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
                handleImageError(citation.id, citation, e)
              }}
              onLoad={() => handleImageLoad(citation.id)}
              // 防止显示 broken image 图标
              onAbort={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleImageError(citation.id, citation, e as React.SyntheticEvent<HTMLImageElement, Event>)
              }}
              // 添加额外的错误处理
              onLoadStart={() => {
                // 确保加载开始时图片是隐藏的
                const img = imageRefs.current.get(citation.id)
                if (img) {
                  img.style.visibility = 'hidden'
                }
                const oldTimer = loadTimeoutsRef.current.get(imageKey)
                if (oldTimer) window.clearTimeout(oldTimer)
                const timer = window.setTimeout(async () => {
                  if (loadedImagesRef.current.has(citation.id) || failedImagesRef.current.has(citation.id)) return
                  if (refreshAttemptedRef.current.has(imageKey)) return
                  const kbId = citation.debug_info?.kb_id || fallbackKbId
                  const filePath = citation.file_path || citation.file_name
                  if (!kbId || !filePath) return
                  try {
                    const res = await chatApi.getReferenceImageUrl({ kb_id: kbId, file_path: filePath })
                    if (res?.img_url) {
                      refreshAttemptedRef.current.add(imageKey)
                      setRefreshedImgUrls((prev) => ({ ...prev, [imageKey]: res.img_url }))
                    }
                  } catch {
                    // ignore
                  }
                }, 8000)
                loadTimeoutsRef.current.set(imageKey, timer)
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

/** 媒体摘要：以轻量模态底色承接播放器，保持为回答中的次级信息。 */
function MediaEvidenceDescription({
  content,
  accent,
}: {
  content: string
  accent: 'audio' | 'video'
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const textRef = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const text = textRef.current
    if (!text || expanded) return

    const measureOverflow = () => {
      setCanExpand(text.scrollHeight > text.clientHeight + 1)
    }

    measureOverflow()
    const observer = new ResizeObserver(measureOverflow)
    observer.observe(text)
    return () => observer.disconnect()
  }, [content, expanded])

  return (
    <figcaption
      className={cn(
        'px-3 py-2.5',
        accent === 'audio'
          ? 'bg-[#F7F5FF] dark:bg-[#211B38]'
          : 'bg-[#F1FCFE] dark:bg-[#102C36]'
      )}
    >
      <p className="relative mb-0 text-[13px] leading-[1.55] text-slate-600 antialiased dark:text-slate-300">
        <span
          ref={textRef}
          className={cn(
            '[overflow-wrap:anywhere]',
            expanded ? 'inline' : 'block line-clamp-2',
            !expanded && canExpand && 'pr-[4.5rem]',
          )}
        >
          {content}
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((value) => !value)
            }}
            aria-expanded={expanded}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-[6px] px-1 text-xs font-semibold leading-[1.55] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900',
              !expanded && 'absolute bottom-0 right-0 pl-5',
              expanded && 'ml-1 align-baseline',
              accent === 'audio'
                ? cn(
                    'text-violet-700 hover:text-violet-800 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:text-violet-200',
                    !expanded && 'bg-[linear-gradient(90deg,transparent_0%,rgba(247,245,255,0.96)_28%,#F7F5FF_48%)] dark:bg-[linear-gradient(90deg,transparent_0%,rgba(33,27,56,0.96)_28%,#211B38_48%)]'
                  )
                : cn(
                    'text-cyan-700 hover:text-cyan-800 focus-visible:ring-cyan-500 dark:text-cyan-300 dark:hover:text-cyan-200',
                    !expanded && 'bg-[linear-gradient(90deg,transparent_0%,rgba(241,252,254,0.96)_28%,#F1FCFE_48%)] dark:bg-[linear-gradient(90deg,transparent_0%,rgba(16,44,54,0.96)_28%,#102C36_48%)]'
                  ),
            )}
          >
            {expanded ? '收起' : '展开'}
            <ChevronDown
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              strokeWidth={2}
              aria-hidden
            />
          </button>
        )}
      </p>
    </figcaption>
  )
}

/** 比浏览器原生控件更紧凑的音频播放条，与回答正文的排版尺度保持一致。 */
function InlineAudioPlayer({
  src,
  label,
  onError,
}: {
  src: string
  label: string
  onError?: (event: React.SyntheticEvent<HTMLAudioElement, Event>) => void
}) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)

  React.useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [src])

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setIsPlaying(false)
      }
    } else {
      audio.pause()
    }
  }

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const progress = safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0
  const rangeStyle = { '--media-progress': `${progress}%` } as React.CSSProperties

  return (
    <div
      className="flex min-h-14 items-center gap-3 border-x-0 border-y border-[#E9E3FF] bg-[#FCFBFF] px-3 py-2.5 dark:border-[#393057] dark:bg-[#191827]"
      onClick={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label={label}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={onError}
      />
      <button
        type="button"
        onClick={() => void togglePlayback()}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm shadow-violet-900/15 transition-[background-color,transform] hover:bg-violet-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:bg-violet-500 dark:hover:bg-violet-400 dark:focus-visible:ring-offset-slate-800"
        aria-label={isPlaying ? `暂停${label}` : `播放${label}`}
      >
        {isPlaying ? (
          <Pause className="size-3.5" fill="currentColor" strokeWidth={2.25} aria-hidden />
        ) : (
          <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={2.25} aria-hidden />
        )}
      </button>
      <span className="media-audio-current w-9 shrink-0 font-mono text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
        {formatTimeLabel(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={safeDuration || 0}
        step={0.1}
        value={safeDuration ? Math.min(currentTime, safeDuration) : 0}
        disabled={!safeDuration}
        onChange={(event) => {
          const nextTime = Number(event.currentTarget.value)
          if (!audioRef.current || !Number.isFinite(nextTime)) return
          audioRef.current.currentTime = nextTime
          setCurrentTime(nextTime)
        }}
        aria-label={`${label}播放进度`}
        aria-valuetext={`${formatTimeLabel(currentTime)} / ${formatTimeLabel(safeDuration)}`}
        className="media-audio-range min-w-0 flex-1 disabled:cursor-wait disabled:opacity-50"
        style={rangeStyle}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] font-medium tabular-nums text-slate-400 dark:text-slate-500">
        {safeDuration ? formatTimeLabel(safeDuration) : '--:--'}
      </span>
    </div>
  )
}

// 段落下方展示的音频引用卡片（图标 + 标签 + 可点击播放，不打开弹层）
function ParagraphAudioDisplay({
  citations,
  onCiteClick,
  messageId,
  displayIndexByRefId,
  fallbackKbId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
  fallbackKbId?: string
}) {
  const [fetchedAudioUrls, setFetchedAudioUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)
  const uniqueCitations = React.useMemo(() => deduplicateMediaCitations(citations), [citations])

  if (uniqueCitations.length === 0) return null

  return (
    <div className="mx-auto mt-3 w-full min-w-0 max-w-[42rem] space-y-3">
      {uniqueCitations.map((citation) => {
        const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
        const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
        const resolvedUrl = citation.type === 'audio' && (fetchedAudioUrls[key] || citation.audio_url)
        const hasAudioUrl = !!resolvedUrl

        const handleOpenPopover = (e: React.MouseEvent) => {
          if (onCiteClick) {
            const rect = e.currentTarget.closest('.paragraph-audio-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCiteClick(citation.id, rect, messageId)
          }
        }

        const handleClickPlay = async () => {
          if (hasAudioUrl) return
          const filePath = citation.file_path || citation.file_name
          const kbId = citation.debug_info?.kb_id || fallbackKbId
          if (!filePath && onCiteClick) {
            onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId)
            return
          }
          setLoadingRefId(citation.id)
          try {
            const res = await chatApi.getReferenceAudioUrl({
              kb_id: kbId ?? undefined,
              file_path: filePath!,
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
          <figure
            key={citation.id}
            data-audio-key={key}
            className="paragraph-audio-card relative min-w-0 overflow-hidden rounded-[16px] border border-[#E9E3FF] bg-[#F7F5FF] shadow-[0_12px_30px_-26px_rgba(76,29,149,0.32)] transition-[border-color,box-shadow] hover:border-[#DCD2FF] hover:shadow-[0_16px_34px_-26px_rgba(76,29,149,0.38)] dark:border-[#393057] dark:bg-[#211B38] dark:shadow-[0_14px_32px_-26px_rgba(0,0,0,0.8)] dark:hover:border-[#4A3C72]"
          >
            <div>
              <button
                type="button"
                onClick={handleOpenPopover}
                aria-label={`打开音频引用 ${displayNum}${citation.file_name ? `：${citation.file_name}` : ''}`}
                className="group flex w-full min-w-0 items-center gap-2.5 bg-[#F7F5FF] px-3 py-2.5 text-left transition-colors hover:bg-[#F2EFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:bg-[#211B38] dark:hover:bg-[#282046]"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-white/80 text-violet-700 ring-1 ring-violet-200/80 transition-colors group-hover:bg-white dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-800/70 dark:group-hover:bg-violet-900/70">
                  <Music className="size-3.5" strokeWidth={2.1} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
                    {citation.file_name ? (
                      <span
                        className="min-w-0 truncate text-xs text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-300"
                        title={citation.file_name}
                      >
                        {shortenFileName(citation.file_name)}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>

              {hasAudioUrl ? (
                <InlineAudioPlayer
                  src={resolvedUrl!}
                  label={`音频引用 ${displayNum}${citation.file_name ? `：${citation.file_name}` : ''}`}
                  onError={async () => {
                    const filePath = citation.file_path || citation.file_name
                    const kbId = citation.debug_info?.kb_id || fallbackKbId
                    if (!filePath || !kbId) return
                    try {
                      const res = await chatApi.getReferenceAudioUrl({
                        kb_id: kbId,
                        file_path: filePath,
                      })
                      if (res?.audio_url) setFetchedAudioUrls((prev) => ({ ...prev, [key]: res.audio_url }))
                    } catch {
                      // 刷新失败，用户可点击弹层查看
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleClickPlay}
                  disabled={loadingRefId === citation.id}
                  aria-label={`${loadingRefId === citation.id ? '正在加载' : '加载'}音频播放器 ${displayNum}`}
                  className="flex min-h-14 w-full items-center justify-center gap-2 border-x-0 border-y border-[#E9E3FF] bg-[#FCFBFF] px-3 py-2.5 text-[13px] font-semibold text-violet-700 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:border-[#393057] dark:bg-[#191827] dark:text-violet-300 dark:hover:bg-[#1E1D31]"
                >
                  {loadingRefId === citation.id ? (
                    <span>加载中…</span>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor" aria-hidden />
                      <span>加载音频播放器</span>
                    </>
                  )}
                </button>
              )}

              {citation.content ? (
                <MediaEvidenceDescription content={citation.content} accent="audio" />
              ) : null}
            </div>
          </figure>
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
  onError,
}: {
  src: string
  startSec?: number | null
  endSec?: number | null
  className?: string
  onClick?: (e: React.MouseEvent<HTMLVideoElement>) => void
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const hasSeeked = React.useRef(false)
  React.useEffect(() => {
    hasSeeked.current = false
  }, [src, startSec])
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
      aria-label="视频引用播放器"
      preload="metadata"
      className={className}
      onClick={onClick}
      onError={onError}
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

function UserScopedFileStrip({ files, className }: { files: ChatScopeFile[]; className?: string }) {
  if (!files.length) return null

  return (
    <div className={cn('flex flex-wrap justify-end gap-2', className)}>
      {files.map((file) => (
        <div
          key={`${file.kbId}::${file.fileId}`}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/90 px-3 py-1 text-xs text-emerald-800 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200"
          title={file.kbName ? `${file.kbName} / ${file.name}` : file.name}
        >
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate max-w-[22rem]">
            {file.kbName ? `${file.kbName} / ${file.name}` : file.name}
          </span>
        </div>
      ))}
    </div>
  )
}

// 段落下方展示的视频引用卡片（图标 + 标签 + 可点击播放，不打开弹层）
function ParagraphVideoDisplay({
  citations,
  onCiteClick,
  messageId,
  displayIndexByRefId,
  fallbackKbId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
  fallbackKbId?: string
}) {
  const [fetchedVideoUrls, setFetchedVideoUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)
  const uniqueCitations = React.useMemo(() => deduplicateMediaCitations(citations), [citations])

  if (uniqueCitations.length === 0) return null

  return (
    <div className="mx-auto mt-3 w-full min-w-0 max-w-[42rem] space-y-3">
      {uniqueCitations.map((citation) => {
        const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
        const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
        const resolvedUrl = citation.type === 'video' && (fetchedVideoUrls[key] || citation.video_url)
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
        const content = citation.content?.trim() ?? ''

        const handleOpenPopover = (e: React.MouseEvent) => {
          if (onCiteClick) {
            const rect = e.currentTarget.closest('.paragraph-video-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCiteClick(citation.id, rect, messageId)
          }
        }

        const handleClickPlay = async () => {
          if (hasVideoUrl) return
          const filePath = citation.file_path || citation.file_name
          const kbId = citation.debug_info?.kb_id || fallbackKbId
          if (!filePath && onCiteClick) {
            onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId)
            return
          }
          setLoadingRefId(citation.id)
          try {
            const res = await chatApi.getReferenceVideoUrl({
              kb_id: kbId ?? undefined,
              file_path: filePath!,
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
          <figure
            key={citation.id}
            data-video-key={key}
            className="paragraph-video-card relative min-w-0 overflow-hidden rounded-[16px] border border-[#D6F3F8] bg-[#F1FCFE] shadow-[0_12px_30px_-26px_rgba(8,145,178,0.32)] transition-[border-color,box-shadow] hover:border-[#BEEAF1] hover:shadow-[0_16px_34px_-26px_rgba(8,145,178,0.38)] dark:border-[#1B4855] dark:bg-[#102C36] dark:shadow-[0_14px_32px_-26px_rgba(0,0,0,0.8)] dark:hover:border-[#246071]"
          >
            <div>
              <button
                type="button"
                onClick={handleOpenPopover}
                aria-label={`打开视频引用 ${displayNum}${citation.file_name ? `：${citation.file_name}` : ''}`}
                className="group flex w-full min-w-0 items-center gap-2.5 bg-[#F1FCFE] px-3 py-2.5 text-left transition-colors hover:bg-[#EAF9FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500 dark:bg-[#102C36] dark:hover:bg-[#143844]"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-white/80 text-cyan-700 ring-1 ring-cyan-200/80 transition-colors group-hover:bg-white dark:bg-cyan-950/60 dark:text-cyan-300 dark:ring-cyan-800/70 dark:group-hover:bg-cyan-900/70">
                  <Video className="size-3.5" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] leading-5">
                  {citation.file_name ? (
                    <span
                      className="min-w-0 truncate text-xs font-normal text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-300"
                      title={citation.file_name}
                    >
                      {shortenFileName(citation.file_name, 34)}
                    </span>
                  ) : null}
                  {segmentLabel ? (
                    <span className="ml-auto hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 sm:inline-flex">
                      {segmentLabel}
                    </span>
                  ) : null}
                </span>
              </button>
              {hasVideoUrl ? (
                <div className="overflow-hidden border-x-0 border-y border-[#D6F3F8] bg-slate-950 dark:border-[#1B4855]">
                  {segmentLabel && (
                    <div className="flex items-center border-b border-white/10 bg-slate-900 px-3 py-1.5 sm:hidden">
                      <span className="font-mono text-[10px] font-semibold tabular-nums text-slate-300">
                        {segmentLabel}
                      </span>
                    </div>
                  )}
                  <VideoPlayerWithSeek
                    src={resolvedUrl!}
                    startSec={startSec}
                    endSec={endSec}
                    className="aspect-video h-auto w-full bg-black object-contain"
                    onClick={(e) => e.stopPropagation()}
                    onError={async () => {
                      const filePath = citation.file_path || citation.file_name
                      const kbId = citation.debug_info?.kb_id || fallbackKbId
                      if (!filePath || !kbId) return
                      try {
                        const res = await chatApi.getReferenceVideoUrl({
                          kb_id: kbId,
                          file_path: filePath,
                        })
                        if (res?.video_url) setFetchedVideoUrls((prev) => ({ ...prev, [key]: res.video_url }))
                      } catch {
                        // 刷新失败，用户可点击弹层查看
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleClickPlay}
                  disabled={loadingRefId === citation.id}
                  aria-label={`${loadingRefId === citation.id ? '正在加载' : '加载'}视频播放器 ${displayNum}`}
                  className="flex aspect-[16/5] min-h-20 w-full items-center justify-center gap-2.5 border-x-0 border-y border-[#D6F3F8] bg-[#F8FDFF] px-4 py-3 text-[13px] font-semibold text-cyan-700 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500 dark:border-[#1B4855] dark:bg-[#122630] dark:text-cyan-300 dark:hover:bg-[#152F3A]"
                >
                  {loadingRefId === citation.id ? (
                    <span>加载中…</span>
                  ) : (
                    <>
                      <Play className="h-4 w-4 flex-shrink-0" fill="currentColor" aria-hidden />
                      <span>加载视频播放器</span>
                    </>
                  )}
                </button>
              )}
              {content ? <MediaEvidenceDescription content={content} accent="video" /> : null}
              {/* 关键帧仅用于后端的视觉检索与生成证据；回答区只保留视频片段本身，
                  避免一个 Shot 的多张帧图把正文撑满。 */}
            </div>
          </figure>
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
  const activeSession = useChatStore((s) => s.getActiveSession())
  const uiConfig = useConfigStore((s) => s.config)
  const fallbackKbId = activeSession?.knowledgeBaseIds?.[0]
  const isUser = message.type === 'user'
  const showThinking = uiConfig.enableThinking && !isUser && (message.thinking || (isStreaming && liveThinking))
  const showCitations = uiConfig.enableCitations
  const isStoppedHint = !isUser && message.error === 'stopped_hint' // 终止提示消息
  const thoughtData = isStreaming && liveThinking
    ? liveThinking.thoughtData
    : Array.isArray(message.thinking)
      ? (message.thinking[0]?.data as ThoughtData) ?? null
      : (message.thinking as ThoughtData) ?? null
  const refs = React.useMemo(() => message.citations ?? [], [message.citations])

  const orderedRefIds = React.useMemo(
    () => (!isUser ? getOrderedRefIdsFromContent(message.content) : []),
    [isUser, message.content]
  )
  const originalIdToDisplayIndex = React.useMemo(() => {
    const m = new Map<number | string, number>()
    orderedRefIds.forEach((id, i) => m.set(id, i + 1))
    return m
  }, [orderedRefIds])
  const orderedRefs = React.useMemo(() => {
    return orderedRefIds
      .map((id) => citationMap?.get(id) ?? refs.find((r) => isCitationLike(r) && getCitationRefId(r) === id) ?? { id })
      .filter(isCitationLike)
  }, [orderedRefIds, citationMap, refs])

  const allCitationMatches = React.useMemo(
    () => (isUser ? [] : findAllCitationMatches(message.content)),
    [message.content, isUser]
  )

  // 记录每个媒体素材在整条消息里第一次被引用的位置，避免后续段落重复渲染同一素材
  const imageFirstOccurrenceByKey = React.useMemo(
    () => buildFirstMediaOccurrenceMap(allCitationMatches, 'image', citationMap, refs),
    [allCitationMatches, citationMap, refs]
  )

  const audioFirstOccurrenceByKey = React.useMemo(
    () => buildFirstMediaOccurrenceMap(allCitationMatches, 'audio', citationMap, refs),
    [allCitationMatches, citationMap, refs]
  )

  const videoFirstOccurrenceByKey = React.useMemo(
    () => buildFirstMediaOccurrenceMap(allCitationMatches, 'video', citationMap, refs),
    [allCitationMatches, citationMap, refs]
  )

  // 去重函数：用于过滤重复的引用
  const deduplicateRefs = React.useCallback((refsToDedup: CitationLike[]) => {
    return refsToDedup.filter((ref, idx, arr) => {
      if (!isCitationLike(ref)) return false
      const type = getCitationRefType(ref)
      const fileName = getCitationRefFileName(ref) || ''
      // 对于图片类型，使用 file_name 去重；对于文档类型，使用 id 去重
      const key = type === 'image' && fileName ? `image:${fileName}` : String(getCitationRefId(ref))
      return arr.findIndex(r => {
        if (!isCitationLike(r)) return false
        const rType = getCitationRefType(r)
        const rFileName = getCitationRefFileName(r) || ''
        const rKey = rType === 'image' && rFileName ? `image:${rFileName}` : String(getCitationRefId(r))
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
    return deduplicateRefs(refs.filter(isCitationLike))
  }, [orderedRefs, refs, deduplicateRefs])
  // 兼容历史消息：旧服务会把关键帧伪装成 image 引用；默认回答引用栏也不应再显示它们。
  const visibleRefs = React.useMemo(() => {
    return uniqueRefs.filter((ref) => {
      const full = 'type' in ref
        ? ref as CitationReference
        : citationMap?.get(getCitationRefId(ref))
      return !isVideoKeyframeCitation(full)
    })
  }, [uniqueRefs, citationMap])
  // 正文已在首次引用处展示完整媒体；底部仅保留轻量的来源按钮，避免图片在回答末尾再出现一次。
  const hasRefs = showCitations && visibleRefs.length > 0

  React.useEffect(() => {
    if (isUser) return
    void ensureKatexCssLoaded()
  }, [isUser])

  // 创建 markdown 组件的工厂函数
  const markdownComponents = React.useMemo<Components>(() => {
    const handleCiteClick = createCiteClickHandler(onCiteClick, message.id)

    const createComponent = (tag: 'p' | 'li', className: string) => {
      return (props: { children?: React.ReactNode } & ExtraProps) => {
        const { children, node } = props
        if (!children) return null
        const Tag = tag

        if (!showCitations) {
          return <Tag className={className}>{children}</Tag>
        }

        // 列表项在 GFM 中多为 li > p：媒体只能由内层 p 负责；否则 li 和 p 会各插一次。
        // react-markdown 此处传入 HAST（tagName=p），而不是 MDAST 的 type=paragraph。
        const liDefersMediaToChildParagraph = tag === 'li' && listItemHasParagraphChild(node)

        if (liDefersMediaToChildParagraph) {
          return (
            <Tag className={className}>
              {injectCitations(children, handleCiteClick, message.id, originalIdToDisplayIndex, citationMap)}
            </Tag>
          )
        }

        const textContent = extractTextFromNode(children)
        const blockStart = node?.position?.start?.offset
        const blockEnd = node?.position?.end?.offset
        const blockMatches =
          typeof blockStart === 'number' && typeof blockEnd === 'number'
            ? allCitationMatches.filter((match) => match.start >= blockStart && match.end <= blockEnd)
            : findAllCitationMatches(textContent)

        const newImageRefs = collectFirstMediaRefsForBlock(
          blockMatches,
          'image',
          imageFirstOccurrenceByKey,
          citationMap,
          refs
        )
        const newAudioRefs = collectFirstMediaRefsForBlock(
          blockMatches,
          'audio',
          audioFirstOccurrenceByKey,
          citationMap,
          refs
        )
        // 同一视频的不同 Shot 仍会保留；文件和时间片段都相同的引用只在整条消息的首次出现处展示。
        const newVideoRefs = collectFirstMediaRefsForBlock(
          blockMatches,
          'video',
          videoFirstOccurrenceByKey,
          citationMap,
          refs
        )

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
                fallbackKbId={fallbackKbId}
              />
            )}
            {newAudioRefs.length > 0 && (
              <ParagraphAudioDisplay
                citations={newAudioRefs}
                onCiteClick={handleCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
                fallbackKbId={fallbackKbId}
              />
            )}
            {newVideoRefs.length > 0 && (
              <ParagraphVideoDisplay
                citations={newVideoRefs}
                onCiteClick={handleCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
                fallbackKbId={fallbackKbId}
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
  }, [
    allCitationMatches,
    imageFirstOccurrenceByKey,
    audioFirstOccurrenceByKey,
    videoFirstOccurrenceByKey,
    citationMap,
    refs,
    originalIdToDisplayIndex,
    message.id,
    onCiteClick,
    showCitations,
    fallbackKbId,
  ])

  const bubbleEl = (
    <div
      className={cn(
        'text-sm leading-relaxed transition-[border-color,box-shadow] duration-200',
        isUser
          ? 'inline-block w-auto max-w-[85%] rounded-[18px] border border-slate-200/75 bg-slate-100/95 px-4 py-3 text-slate-800 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.42)] hover:border-slate-300/80 hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-800/90 dark:text-slate-100 dark:hover:border-slate-600/75 dark:hover:bg-slate-800 sm:max-w-[72%]'
          : isStoppedHint
            ? 'mx-auto w-auto border-0 bg-transparent shadow-none' // 终止提示：无边框、透明背景、居中
            : 'relative w-full overflow-hidden rounded-[6px_18px_18px_18px] border border-slate-200/80 border-l-[4px] border-l-indigo-500 bg-[linear-gradient(180deg,#fffefa_0%,#ffffff_100%)] px-4 pb-5 pt-5 text-slate-900 shadow-[0_22px_52px_-36px_rgba(30,41,59,0.48),0_1px_0_rgba(255,255,255,0.96)_inset] ring-1 ring-white/80 hover:border-slate-300/85 hover:border-l-indigo-500 hover:shadow-[0_26px_58px_-38px_rgba(30,41,59,0.56)] dark:border-slate-700/75 dark:border-l-indigo-400 dark:bg-[linear-gradient(180deg,#172033_0%,#0f172a_100%)] dark:text-slate-100 dark:ring-white/[0.04] dark:shadow-[0_24px_58px_-36px_rgba(0,0,0,0.88)] dark:hover:border-slate-600/80 dark:hover:border-l-indigo-400 sm:px-5 sm:pb-6 sm:pt-5'
      )}
    >
      {isStoppedHint ? (
        // 终止提示消息 - 类似 Gemini 的显示方式：居中、浅灰色背景
        <div className="rounded-md bg-slate-100 dark:bg-slate-800/60 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
          你已让系统停止这条回答
        </div>
      ) : (
        <>
          {!isUser && (
            <span
              className="pointer-events-none absolute left-5 right-5 top-2 h-px bg-[repeating-linear-gradient(90deg,rgba(99,102,241,0.4)_0_6px,transparent_6px_12px)] opacity-75 dark:bg-[repeating-linear-gradient(90deg,rgba(129,140,248,0.38)_0_6px,transparent_6px_12px)]"
              aria-hidden
            />
          )}

          {showThinking && (
            <div className="relative z-[1]">
              <Suspense fallback={<ThinkingCapsuleFallback />}>
                <ThinkingCapsule
                  thoughtData={thoughtData}
                  stages={liveThinking?.stages}
                  currentStage={liveThinking?.currentStage}
                />
              </Suspense>
            </div>
          )}

          {isUser ? (
            <div className="break-words">{message.content}</div>
          ) : (
            <div
              className={cn(
                'rag-markdown relative z-[1] max-w-none [&>p:has(+div)]:!mb-0',
                showThinking && 'mt-5 border-t border-slate-200/80 pt-5 dark:border-slate-700/70'
              )}
            >
              <Suspense fallback={<MarkdownRendererFallback streaming={isStreaming} />}>
                <MarkdownRenderer content={message.content} components={markdownComponents} />
              </Suspense>

              {message.error && !thoughtData?._generation_failed && message.error !== 'stopped' && message.error !== 'stopped_hint' && (
                <div
                  className="mt-3 rounded-lg border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-xs leading-relaxed text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/35 dark:text-rose-200"
                  role="alert"
                >
                  {message.error}
                </div>
              )}

              {isStreaming && message.content && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle dark:bg-slate-500" />
              )}
            </div>
          )}

          {hasRefs && !isUser && (
            <div className="mt-3 space-y-2">
              <InlineCitation
                references={visibleRefs}
                variant="inline"
                showImageThumbnails={false}
                citationMap={citationMap}
                onCiteClick={onCiteClick}
                messageId={message.id}
                displayIndexByRefId={originalIdToDisplayIndex}
              />
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="w-full">
      {isUser ? (
        <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
          {(message.attachments?.length ?? 0) > 0 && (
            <UserMessageAttachmentStrip
              attachments={message.attachments!}
              className="w-full"
            />
          )}
          {(message.scopeFiles?.length ?? 0) > 0 && (
            <UserScopedFileStrip files={message.scopeFiles!} className="w-full" />
          )}
          <div className="flex w-full items-start justify-end">
            {bubbleEl}
          </div>
        </div>
      ) : isStoppedHint ? (
        // 终止提示不显示头像，居中显示
        <div className="flex min-w-0 flex-1 justify-center">
          {bubbleEl}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          {bubbleEl}
        </div>
      )}
    </div>
  )
}
