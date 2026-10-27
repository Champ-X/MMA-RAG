import { translate as tr, useTranslation } from '@/i18n'
import React, { Suspense } from 'react'
import { Play } from 'lucide-react'
import { InlineCitation } from './InlineCitation'
import { ReferenceImage } from './ReferenceImage'
import { VideoPlayerWithSeek } from './VideoPlayerWithSeek'
import { VideoEvidenceCarousel } from './VideoEvidenceCarousel'
import { formatMediaTime, InlineAudioPlayer, MediaEvidenceDescription, MediaEvidenceHeader } from './MediaEvidenceCard'
import type { Components, ExtraProps } from 'react-markdown'
import { cn } from '@/lib/utils'
import { findAllCitationMatches, getOrderedRefIdsFromContent, type CitationMatch } from '@/lib/citations'
import { getCitationIdentityKey } from '@/lib/mediaIdentity'
import { chatApi } from '@/services/api_client'
import { getFreshReferenceVideoUrl, isReferenceMediaUrlFresh } from '@/services/reference_media_url'
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
import { UserMessageActions } from './UserMessageActions'
import { AttachmentEvidence } from './AttachmentEvidence'
import { DecisionRecord } from './DecisionRecord'
const UserMentionText = React.lazy(() => import('./UserMentionText').then(module => ({ default: module.UserMentionText })))

type CitationStub = { id: number | string }
type CitationLike = CitationReference | CitationStub
type ReactNodeChildrenProps = { children?: React.ReactNode }
type MarkdownBlockTag = 'p' | 'li' | 'table' | 'th' | 'td' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
type MarkdownBlockProps = React.HTMLAttributes<HTMLElement> & ExtraProps
type MarkdownBlockRenderers = Record<MarkdownBlockTag, (props: MarkdownBlockProps) => React.ReactNode>

// Stable component types preserve image loading/retry state while streaming changes the text.
const MarkdownBlockContext = React.createContext<MarkdownBlockRenderers | null>(null)
const citationBlockTags: MarkdownBlockTag[] = ['p', 'li', 'table', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
const citationBlockComponents = Object.fromEntries(citationBlockTags.map(tag => {
  function CitationBlock(props: MarkdownBlockProps) {
  useTranslation()
    return React.useContext(MarkdownBlockContext)?.[tag](props)
  }
  return [tag, CitationBlock]
})) as Record<MarkdownBlockTag, (props: MarkdownBlockProps) => React.ReactNode>

let katexCssLoadPromise: Promise<unknown> | null = null

const ThinkingCapsule = React.memo(React.lazy(() =>
  import('./ThinkingCapsule').then((module) => ({ default: module.ThinkingCapsule }))
))
const PiProcess = React.lazy(() => import('./PiProcess').then(module => ({ default: module.PiProcess })))
const PiAnswerNotes = React.lazy(() => import('./PiProcess').then(module => ({ default: module.PiAnswerNotes })))

let markdownLoad: Promise<typeof import('./MarkdownRenderer')> | undefined
const loadMarkdownRenderer = () => markdownLoad ??= import('./MarkdownRenderer')
const MarkdownRenderer = React.memo(React.lazy(() =>
  loadMarkdownRenderer().then((module) => ({ default: module.MarkdownRenderer }))
))

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
  useTranslation()
  return (
    <div className="w-full rounded-xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-400">
      {tr("正在载入思考过程…")}</div>
  )
}

function MarkdownRendererFallback({ content }: { content: string }) {
  useTranslation()
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      {content}
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
  diagnostics?: Message['diagnostics']
  pi?: Message['pi']
  error?: string
  attachments?: ChatMessageAttachment[]
  scopeFiles?: ChatScopeFile[]
  mentions?: Message['mentions']
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
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string, triggerElement?: HTMLElement) => void
  onRegenerate?: () => void
  onEditRetry?: () => void
  onEdit?: () => void
  regenerationDisabled?: boolean
}

// 从文本中提取引用标记并转换为可点击按钮；originalIdToDisplayIndex 用于连续编号展示
function injectCitations(
  children: React.ReactNode,
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string, triggerElement?: HTMLElement) => void,
  messageId?: string,
  originalIdToDisplayIndex?: Map<number | string, number>,
  citationMap?: Map<number | string, CitationReference>
): React.ReactNode {
  if (typeof children === 'string') {
    return splitTextWithCitations(children, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <React.Fragment key={`cnode_${messageId ?? 'm'}_${idx}`}>
        {injectCitations(child, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)}
      </React.Fragment>
    ))
  }
  if (!React.isValidElement<ReactNodeChildrenProps & ExtraProps>(children)) return children
  // Code/links are not citations; nested blocks process their own text exactly once.
  if (['code', 'pre', 'a'].includes(children.props.node?.tagName || String(children.type))
    || Object.values(citationBlockComponents).includes(children.type as typeof citationBlockComponents.p)) return children
  if (children.props.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: injectCitations(children.props.children, onCiteClick, messageId, originalIdToDisplayIndex, citationMap)
    })
  }
  return children
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

/** Nested paragraphs/lists/headings own their media; table cells defer to the table. */
function childBlockOwnsCitation(node: unknown, match: CitationMatch): boolean {
  if (!node || typeof node !== 'object') return false
  const children = (node as { children?: unknown }).children
  if (!Array.isArray(children)) return false

  return children.some((child) => {
    if (!child || typeof child !== 'object') return false
    const item = child as { tagName?: MarkdownBlockTag; position?: { start: { offset?: number }; end: { offset?: number } } }
    const start = item.position?.start.offset, end = item.position?.end.offset
    if (item.tagName && citationBlockTags.includes(item.tagName) && !['th', 'td'].includes(item.tagName)
      && typeof start === 'number' && typeof end === 'number' && match.start >= start && match.end <= end) return true
    return childBlockOwnsCitation(child, match)
  })
}

function splitTextWithCitations(
  text: string,
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string, triggerElement?: HTMLElement) => void,
  messageId?: string,
  originalIdToDisplayIndex?: Map<number | string, number>,
  citationMap?: Map<number | string, CitationReference>
) {
  const matches = findAllCitationMatches(text)
  if (matches.length === 0) return text

  const out: React.ReactNode[] = []
  let last = 0
  matches.forEach((match, idx) => {
    if (match.start > last) out.push(text.slice(last, match.start))
    const displayN = originalIdToDisplayIndex != null
      ? (originalIdToDisplayIndex.get(match.n) ?? match.n)
      : match.n

    out.push(
      <CitationInlineButton
        key={`c_${messageId}_${idx}_${match.n}`}
        n={typeof displayN === 'number' ? displayN : Number(displayN) || 0}
        available={!!citationMap?.get(match.n)?.type}
        local={citationMap?.get(match.n)?.source === 'attachment'}
        onClick={(rect, triggerElement) => onCiteClick?.(match.n, rect, messageId, triggerElement)}
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

function CitationInlineButton({ n, available, local, onClick }: { n: number; available: boolean; local?: boolean; onClick?: (rect: DOMRect, triggerElement: HTMLButtonElement) => void }) {
  useTranslation()
  return (
    <button
      type="button"
      disabled={!available}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        onClick?.(rect, e.currentTarget)
      }}
      className="inline-flex items-center justify-center mx-0.5 text-[9px] font-semibold rounded-[5px] transition-all border align-text-top min-w-[1rem] h-4 px-1 text-indigo-700 dark:text-indigo-200 bg-gradient-to-br from-indigo-50 via-purple-50 to-fuchsia-50 dark:from-indigo-600/30 dark:via-purple-600/20 dark:to-fuchsia-600/30 hover:from-indigo-100 hover:via-purple-100 hover:to-fuchsia-100 dark:hover:from-indigo-600/40 dark:hover:via-purple-600/30 dark:hover:to-fuchsia-600/40 border-indigo-300/60 dark:border-indigo-700/60 shadow-sm hover:shadow active:scale-95"
      data-source={local ? 'attachment' : 'knowledge'}
      style={local ? { borderStyle: 'dashed', color: 'var(--attachment-cite-text, #0f766e)', background: 'var(--attachment-cite-bg, #f0fdfa)' } : undefined}
      title={available ? local ? tr("点击查看本机附件引用 {{number}}", { number: n }) : tr("点击查看引用 {{number}}", { number: n }) : tr("引用 {{v0}} 的来源数据不可用", { v0: n })}
      aria-label={available ? tr("查看引用 {{v0}}", { v0: n }) : tr("引用 {{v0}} 的来源数据不可用", { v0: n })}
    >
      {n}
    </button>
  )
}

// 创建 onCiteClick 回调的辅助函数
function createCiteClickHandler(
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string, triggerElement?: HTMLElement) => void,
  messageId?: string
) {
  return (id: number | string, rect: DOMRect, msgId?: string, triggerElement?: HTMLElement) => {
    const mockEvent = {
      currentTarget: { getBoundingClientRect: () => rect }
    } as React.MouseEvent
    onCiteClick?.(id, mockEvent, msgId ?? messageId, triggerElement)
  }
}

// 段落下方居中显示的图片组件（展示 type===image 且有 img_url 或可刷新 file_path+kb_id 的引用）
function ParagraphImageDisplay({
  citations,
  onCiteClick,
  messageId,
  fallbackKbId,
  displayIndexByRefId,
}: {
  citations: CitationReference[]
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string, triggerElement?: HTMLElement) => void
  messageId?: string
  fallbackKbId?: string
  displayIndexByRefId?: Map<number | string, number>
}) {
  useTranslation()
  const images = deduplicateMediaCitations(
    citations.filter((citation) => citation.type === 'image' && !isVideoKeyframeCitation(citation))
  )
  if (!images.length) return null

  return (
    <div className="answer-media-group flex flex-wrap justify-center gap-3">
      {images.map((citation) => (
        citation.source === 'attachment' ? <AttachmentEvidence key={getCitationIdentityKey(citation)} reference={citation} displayNumber={displayIndexByRefId?.get(citation.id) ?? citation.id}
          onOpen={(rect, target) => onCiteClick?.(citation.id, rect, messageId, target)} /> :
        <ReferenceImage
          key={getCitationIdentityKey(citation)}
          url={citation.img_url}
          kbId={citation.debug_info?.kb_id || fallbackKbId}
          filePath={citation.file_path || citation.file_name}
          label={citation.file_name || tr("引用 {{v0}}", { v0: citation.id })}
          onOpen={(rect, triggerElement) => onCiteClick?.(citation.id, rect, messageId, triggerElement)}
        />
      ))}
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
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string, triggerElement?: HTMLElement) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
  fallbackKbId?: string
}) {
  useTranslation()
  const [fetchedAudioUrls, setFetchedAudioUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)
  const uniqueCitations = React.useMemo(() => deduplicateMediaCitations(citations), [citations])

  if (uniqueCitations.length === 0) return null

  return (
    <div className="answer-media-group mx-auto w-full min-w-0 max-w-[34rem] space-y-3">
      {uniqueCitations.map((citation) => {
        const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
        if (citation.source === 'attachment') return <AttachmentEvidence key={getCitationIdentityKey(citation)} reference={citation}
          displayNumber={displayNum} onOpen={(rect, target) => onCiteClick?.(citation.id, rect, messageId, target)} />
        const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
        const resolvedUrl = citation.type === 'audio' && (fetchedAudioUrls[key] || citation.audio_url)
        const hasAudioUrl = !!resolvedUrl

        const handleOpenPopover = (e: React.MouseEvent) => {
          if (onCiteClick) {
            const rect = e.currentTarget.closest('.paragraph-audio-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCiteClick(citation.id, rect, messageId, e.currentTarget as HTMLElement)
          }
        }

        const handleClickPlay = async (event: React.MouseEvent<HTMLButtonElement>) => {
          const triggerElement = event.currentTarget
          if (hasAudioUrl) return
          const filePath = citation.file_path || citation.file_name
          const kbId = citation.debug_info?.kb_id || fallbackKbId
          if (!filePath && onCiteClick) {
            onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId, triggerElement)
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
              onCiteClick(citation.id, rect, messageId, triggerElement)
            }
          } finally {
            setLoadingRefId(null)
          }
        }

        return (
          <figure
            key={citation.id}
            data-audio-key={key}
            className="media-evidence-card paragraph-audio-card"
          >
              {hasAudioUrl ? (
                <InlineAudioPlayer
                  header={<MediaEvidenceHeader kind="audio" fileName={citation.file_name} displayNumber={displayNum}
                    onOpen={handleOpenPopover} />}
                  src={resolvedUrl!}
                  label={tr("音频引用 {{v0}}{{v1}}", { v0: displayNum, v1: citation.file_name ? `：${citation.file_name}` : '' })}
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
                <>
                <MediaEvidenceHeader kind="audio" fileName={citation.file_name} displayNumber={displayNum}
                  onOpen={handleOpenPopover} />
                <button
                  type="button"
                  onClick={handleClickPlay}
                  disabled={loadingRefId === citation.id}
                  aria-label={tr("{{v0}}音频播放器 {{v1}}", { v0: loadingRefId === citation.id ? tr("正在加载") : tr("加载"), v1: displayNum })}
                  className="media-card-load"
                >
                  {loadingRefId === citation.id ? (
                    <span>{tr("加载中…")}</span>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor" aria-hidden />
                      <span>{tr("加载音频播放器")}</span>
                    </>
                  )}
                </button>
                </>
              )}

              {citation.content ? (
                <MediaEvidenceDescription content={citation.content} accent="audio" />
              ) : null}
          </figure>
        )
      })}
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
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string, triggerElement?: HTMLElement) => void
  messageId?: string
  displayIndexByRefId?: Map<number | string, number>
  fallbackKbId?: string
}) {
  useTranslation()
  const [fetchedVideoUrls, setFetchedVideoUrls] = React.useState<Record<string, string>>({})
  const [loadingRefId, setLoadingRefId] = React.useState<string | number | null>(null)
  const uniqueCitations = React.useMemo(() => deduplicateMediaCitations(citations), [citations])

  React.useEffect(() => {
    let cancelled = false

    for (const citation of uniqueCitations) {
      if (citation.source === 'attachment') continue
      if (citation.type !== 'video' || isReferenceMediaUrlFresh(citation.video_url)) continue
      const filePath = citation.file_path || citation.file_name
      const kbId = citation.debug_info?.kb_id || fallbackKbId
      if (!filePath || !kbId) continue

      const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
      void getFreshReferenceVideoUrl({
        kbId,
        filePath,
        currentUrl: citation.video_url,
      }).then((videoUrl) => {
        if (!cancelled) {
          setFetchedVideoUrls((prev) => (prev[key] === videoUrl ? prev : { ...prev, [key]: videoUrl }))
        }
      }).catch(() => {
        // 卡片仍保留原始引用信息，用户可以打开引用详情重试。
      })
    }

    return () => {
      cancelled = true
    }
  }, [fallbackKbId, messageId, uniqueCitations])

  if (uniqueCitations.length === 0) return null

  const renderCitation = (citation: CitationReference) => {
    const displayNum = displayIndexByRefId?.get(citation.id) ?? citation.id
    const key = messageId ? `${messageId}-${citation.id}` : String(citation.id)
    const resolvedUrl = citation.type === 'video' && (fetchedVideoUrls[key] || citation.video_url)
    const hasVideoUrl = !!resolvedUrl
    if (citation.source === 'attachment') return <AttachmentEvidence key={getCitationIdentityKey(citation)} reference={citation}
      displayNumber={displayNum} onOpen={(rect, target) => onCiteClick?.(citation.id, rect, messageId, target)} />
    const startSec = citation.start_sec != null ? Number(citation.start_sec) : null
    const endSec = citation.end_sec != null ? Number(citation.end_sec) : null
    const segmentLabel =
      startSec != null && endSec != null
        ? tr("片段 {{v0}} - {{v1}}", { v0: formatMediaTime(startSec), v1: formatMediaTime(endSec) })
        : startSec != null
          ? tr("从 {{v0}} 开始", { v0: formatMediaTime(startSec) })
          : endSec != null
            ? tr("至 {{v0}} 结束", { v0: formatMediaTime(endSec) })
            : null
    const content = citation.content?.trim() ?? ''

    const handleOpenPopover = (e: React.MouseEvent) => {
      if (onCiteClick) {
        const rect = e.currentTarget.closest('.paragraph-video-card')?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect()
        onCiteClick(citation.id, rect, messageId, e.currentTarget as HTMLElement)
      }
    }

    const handleClickPlay = async (event: React.MouseEvent<HTMLButtonElement>) => {
      const triggerElement = event.currentTarget
      if (hasVideoUrl) return
      const filePath = citation.file_path || citation.file_name
      const kbId = citation.debug_info?.kb_id || fallbackKbId
      if (!filePath || !kbId) {
        if (onCiteClick) onCiteClick(citation.id, new DOMRect(0, 0, 0, 0), messageId, triggerElement)
        return
      }
      setLoadingRefId(citation.id)
      try {
        const videoUrl = await getFreshReferenceVideoUrl({
          kbId,
          filePath,
          currentUrl: citation.video_url,
        })
        setFetchedVideoUrls((prev) => ({ ...prev, [key]: videoUrl }))
      } catch {
        if (onCiteClick) {
          const el = document.querySelector(`.paragraph-video-card[data-video-key="${key}"]`) as HTMLElement
          const rect = el?.getBoundingClientRect?.() ?? new DOMRect(0, 0, 0, 0)
          onCiteClick(citation.id, rect, messageId, triggerElement)
        }
      } finally {
        setLoadingRefId(null)
      }
    }

    return (
      <figure
        key={citation.id}
        data-video-key={key}
        className="media-evidence-card paragraph-video-card"
      >
          {hasVideoUrl ? (
            <div className="media-card-video">
              <span className="media-card-video-reference" aria-hidden="true">[{displayNum}]</span>
              {segmentLabel && <span className="media-card-video-segment">{segmentLabel}</span>}
              <VideoPlayerWithSeek
                src={resolvedUrl!}
                startSec={startSec}
                endSec={endSec}
                className="media-card-video-player"
                onClick={(e) => e.stopPropagation()}
                onError={async () => {
                  const filePath = citation.file_path || citation.file_name
                  const kbId = citation.debug_info?.kb_id || fallbackKbId
                  if (!filePath || !kbId) return
                  try {
                    const videoUrl = await getFreshReferenceVideoUrl({
                      kbId,
                      filePath,
                      currentUrl: resolvedUrl,
                      force: true,
                    })
                    setFetchedVideoUrls((prev) => ({ ...prev, [key]: videoUrl }))
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
              aria-label={tr("{{v0}}视频播放器 {{v1}}", { v0: loadingRefId === citation.id ? tr("正在加载") : tr("加载"), v1: displayNum })}
              className="media-card-load media-card-load-video"
            >
              {loadingRefId === citation.id ? (
                <span>{tr("加载中…")}</span>
              ) : (
                <>
                  <Play className="h-4 w-4 flex-shrink-0" fill="currentColor" aria-hidden />
                  <span>{tr("加载视频播放器")}</span>
                </>
              )}
            </button>
          )}
          <MediaEvidenceHeader kind="video" fileName={citation.file_name} displayNumber={displayNum}
            onOpen={handleOpenPopover} />
          {content ? <MediaEvidenceDescription content={content} accent="video" /> : null}
          {/* 关键帧仅用于后端的视觉检索与生成证据；回答区只保留视频片段本身，
              避免一个 Shot 的多张帧图把正文撑满。 */}
      </figure>
    )
  }

  if (uniqueCitations.length > 2) {
    return <VideoEvidenceCarousel citations={uniqueCitations} displayIndexByRefId={displayIndexByRefId}
      getVideoUrl={citation => fetchedVideoUrls[messageId ? `${messageId}-${citation.id}` : String(citation.id)] || citation.video_url || undefined}
      renderCitation={renderCitation} />
  }
  return <div className="answer-media-group mx-auto w-full min-w-0 max-w-[42rem] space-y-4">
    {uniqueCitations.map(renderCitation)}
  </div>
}

// 自定义 img 组件，防止显示破损图片图标
const MarkdownImage = React.memo(({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
  useTranslation()
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
    setImageError(false)
    setImageLoaded(false)
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
MarkdownImage.displayName = 'MarkdownImage'

export function MessageBubble({
  message,
  isStreaming = false,
  liveThinking,
  citationMap: preloadedCitationMap,
  onCiteClick,
  onRegenerate,
  onEditRetry,
  onEdit,
  regenerationDisabled = false,
}: MessageBubbleProps) {
  useTranslation()
  const fallbackKbId = useChatStore((s) => s.getActiveSession()?.knowledgeBaseIds?.[0])
  const uiConfig = useConfigStore((s) => s.config)
  const isUser = message.type === 'user'
  // Load the renderer during retrieval, while keeping received text visible if it is still loading.
  React.useEffect(() => {
    if (!isUser) void loadMarkdownRenderer().catch(() => { /* React.lazy owns the load error. */ })
  }, [isUser])
  const showCitations = uiConfig.enableCitations
  const isStoppedHint = !isUser && message.error === 'stopped_hint' // 终止提示消息
  const thoughtData = isStreaming && liveThinking
    ? liveThinking.thoughtData
    : Array.isArray(message.thinking)
      ? (message.thinking[0]?.data as ThoughtData) ?? null
      : (message.thinking as ThoughtData) ?? null
  const showThinking = uiConfig.enableThinking && !isUser && !thoughtData?.failure_stage
    && (message.thinking || (isStreaming && liveThinking))
  const refs = React.useMemo(() => message.citations ?? [], [message.citations])
  const citationMap = React.useMemo(() => {
    const map = new Map<number | string, CitationReference>()
    for (const ref of [...(preloadedCitationMap?.values() ?? []), ...refs]) {
      if (!('type' in ref)) continue
      map.set(ref.id, ref)
      map.set(String(ref.id), ref)
      if (/^\d+$/.test(String(ref.id))) map.set(Number(ref.id), ref)
    }
    return map
  }, [preloadedCitationMap, refs])

  const orderedRefIds = React.useMemo(
    () => (!isUser ? getOrderedRefIdsFromContent(message.content) : []),
    [isUser, message.content]
  )
  const originalIdToDisplayIndex = React.useMemo(() => {
    const m = new Map<number | string, number>()
    orderedRefIds.forEach((id, i) => { m.set(id, i + 1); m.set(String(id), i + 1) })
    return m
  }, [orderedRefIds])
  const hasMissingReferences = !isUser && !isStreaming && orderedRefIds.some((id) => !citationMap.has(id))
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

  // 兼容历史消息：旧服务会把关键帧伪装成 image 引用；默认回答引用栏也不应再显示它们。
  const visibleRefs = React.useMemo(() => {
    // 预加载的检索候选只用于解析正文引用，不能自动成为回答来源。
    return orderedRefs.filter((ref) => {
      const full = 'type' in ref
        ? ref as CitationReference
        : citationMap?.get(getCitationRefId(ref))
      return !!full?.type && !isVideoKeyframeCitation(full)
    })
  }, [orderedRefs, citationMap])
  // 正文已在首次引用处展示完整媒体；底部仅保留轻量的来源按钮，避免图片在回答末尾再出现一次。
  const hasRefs = showCitations && visibleRefs.length > 0

  React.useEffect(() => {
    if (isUser) return
    void ensureKatexCssLoaded()
  }, [isUser])

  // 创建 markdown 组件的工厂函数
  const markdownRendering = React.useMemo(() => {
    const handleCiteClick = createCiteClickHandler(onCiteClick, message.id)

    const createComponent = (tag: MarkdownBlockTag, className: string) => {
      return (props: MarkdownBlockProps) => {
        const { children, node, ...elementProps } = props
        if (!children) return null
        const Tag = tag

        if (!showCitations) {
          return <Tag {...elementProps} className={className}>{children}</Tag>
        }

        // Cells render inline citations. Media belongs below the complete table.
        if (tag === 'th' || tag === 'td') {
          return (
            <Tag {...elementProps} scope={tag === 'th' ? 'col' : undefined} className={className}>
              {injectCitations(children, handleCiteClick, message.id, originalIdToDisplayIndex, citationMap)}
            </Tag>
          )
        }

        const textContent = extractTextFromNode(children)
        const blockStart = node?.position?.start?.offset
        const blockEnd = node?.position?.end?.offset
        const blockMatches = (
          typeof blockStart === 'number' && typeof blockEnd === 'number'
            ? allCitationMatches.filter((match) => match.start >= blockStart && match.end <= blockEnd)
            : findAllCitationMatches(textContent)
        ).filter(match => !childBlockOwnsCitation(node, match))

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

        const media = <>
            {newImageRefs.length > 0 && (
              <ParagraphImageDisplay
                citations={newImageRefs}
                displayIndexByRefId={originalIdToDisplayIndex}
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
        const content = tag === 'table' ? children
          : injectCitations(children, handleCiteClick, message.id, originalIdToDisplayIndex, citationMap)
        if (tag === 'li') return <li {...elementProps} className={className}>{content}{media}</li>
        return <><Tag {...elementProps} className={className}>{content}</Tag>{media}</>
      }
    }

    return {
      blocks: Object.fromEntries(citationBlockTags.map(tag => [tag,
        createComponent(tag, tag === 'p' ? 'mb-2 leading-relaxed' : tag === 'li' ? 'mb-0' : ''),
      ])) as MarkdownBlockRenderers,
      components: {
        ...citationBlockComponents,
        img: MarkdownImage,
      } satisfies Components,
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
            : 'answer-sheet'
      )}
    >
      {isStoppedHint ? (
        // 终止提示消息 - 类似 Gemini 的显示方式：居中、浅灰色背景
        <div className="rounded-md bg-slate-100 dark:bg-slate-800/60 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
          {tr("你已让系统停止这条回答")}</div>
      ) : (
        <>


          {message.pi && <div className="relative z-[1] mb-5"><Suspense fallback={<ThinkingCapsuleFallback />}><PiProcess trace={message.pi} /></Suspense></div>}
          {showThinking && !message.pi && (
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
            <Suspense fallback={<div className="whitespace-pre-wrap break-words">{message.content}</div>}>
              <UserMentionText text={message.content} mentions={message.mentions} attachments={message.attachments} />
            </Suspense>
          ) : (
            <div
              className={cn(
                'rag-markdown relative z-[1] max-w-none [&>p:has(+div)]:!mb-0',
                showThinking && 'mt-5 border-t border-slate-200/80 pt-5 dark:border-slate-700/70'
              )}
            >
              {message.content && <Suspense fallback={<MarkdownRendererFallback content={message.content} />}>
                <MarkdownBlockContext.Provider value={markdownRendering.blocks}>
                  <MarkdownRenderer content={message.content} components={markdownRendering.components} />
                </MarkdownBlockContext.Provider>
              </Suspense>}

              {message.error && (!showThinking || !thoughtData?._generation_failed) && message.error !== 'stopped' && message.error !== 'stopped_hint' && (
                <div
                  className="mt-3 rounded-lg border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-xs leading-relaxed text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/35 dark:text-rose-200"
                  role="alert"
                >
                  {thoughtData?.failure_stage && <p className="mb-1 font-semibold">
                    {thoughtData.failure_stage === 'validation' ? tr("引用校验未通过") : tr("附件解析未完成")}
                  </p>}
                  {message.error}
                </div>
              )}
              {onEditRetry && message.error && message.error !== 'stopped' && message.error !== 'stopped_hint' && (
                <button type="button" onClick={onEditRetry} disabled={regenerationDisabled}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50">
                  {tr("编辑后重试")}</button>
              )}

              {isStreaming && message.content && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle dark:bg-slate-500" />
              )}
            </div>
          )}

          {showCitations && hasMissingReferences && (
            <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <p>{tr("这条回答的部分引用缺少来源数据，对应图片和来源详情无法显示。请重新生成回答。")}</p>
              {onRegenerate && (
                <button type="button" disabled={regenerationDisabled} onClick={onRegenerate} className="mt-1 min-h-11 font-medium underline underline-offset-4 disabled:opacity-50">
                  {tr("重新生成回答")}</button>
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
          {!isUser && !!message.pi?.limitations?.length && <Suspense fallback={null}>
            <PiAnswerNotes limitations={message.pi.limitations} />
          </Suspense>}
          {!isUser && !message.pi && !isStreaming && <DecisionRecord diagnostics={message.diagnostics} answer={message.content} />}
        </>
      )}
    </div>
  )

  return (
    <div className="w-full">
      {isUser ? (
        <div className="group/user-message flex min-w-0 flex-1 flex-col items-end gap-1.5">
          {(message.attachments?.length ?? 0) > 0 && (
            <UserMessageAttachmentStrip
              attachments={message.attachments!}
              className="w-full"
            />
          )}
          <div id={`user-message-${message.id}`} className="flex w-full items-start justify-end">
            {bubbleEl}
          </div>
          <UserMessageActions content={message.content} contentId={`user-message-${message.id}`}
            onEdit={onEdit} disabled={regenerationDisabled} />
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
