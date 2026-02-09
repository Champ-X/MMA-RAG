import React from 'react'
import { User, Bot } from 'lucide-react'
import { ThinkingCapsule } from './ThinkingCapsule'
import { InlineCitation } from './InlineCitation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
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
  originalIdToDisplayIndex?: Map<number | string, number>
): React.ReactNode {
  if (typeof children === 'string') {
    return splitTextWithCitations(children, onCiteClick, messageId, originalIdToDisplayIndex)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <span key={`cnode_${messageId ?? 'm'}_${idx}`}>
        {injectCitations(child, onCiteClick, messageId, originalIdToDisplayIndex)}
      </span>
    ))
  }
  if (!React.isValidElement(children)) return children
  if (children.props?.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: injectCitations(children.props.children, onCiteClick, messageId, originalIdToDisplayIndex)
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
        onClick={(rect) => onCiteClick?.(match.n, rect as any, messageId)}
      />
    )
    last = match.end
  })
  if (last < text.length) out.push(text.slice(last))
  return out
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

export function MessageBubble({
  message,
  isStreaming = false,
  liveThinking,
  citationMap,
  onCiteClick,
}: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const showThinking = !isUser && (message.thinking || (isStreaming && liveThinking))
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
  const uniqueRefs = orderedRefs.length > 0 ? orderedRefs : refs.filter((ref, idx, arr) => {
    const isObj = typeof ref === 'object' && ref != null && 'id' in ref
    const type = isObj && 'type' in ref ? (ref as any).type : undefined
    const fileName = isObj && 'file_name' in ref ? String((ref as any).file_name || '') : ''
    const key = type === 'image' && fileName ? `image:${fileName}` : (isObj ? String((ref as any).id) : '')
    if (!key) return true
    return arr.findIndex(r => {
      const rObj = typeof r === 'object' && r != null && 'id' in r
      const rType = rObj && 'type' in r ? (r as any).type : undefined
      const rFileName = rObj && 'file_name' in r ? String((r as any).file_name || '') : ''
      const rKey = rType === 'image' && rFileName ? `image:${rFileName}` : (rObj ? String((r as any).id) : '')
      return rKey === key
    }) === idx
  })
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

  const AvatarIcon = isUser ? User : Bot
  const avatarBg = isUser
    ? 'bg-gradient-to-br from-indigo-500 to-sky-500 text-white'
    : 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white border border-slate-200/50 dark:border-slate-700/50'

  const avatarEl = (
    <div
      className={cn(
        'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow-md ring-2 ring-white/20 dark:ring-slate-800/50',
        avatarBg
      )}
      aria-hidden
    >
      <AvatarIcon className="w-4 h-4" strokeWidth={2.5} />
    </div>
  )

  const bubbleEl = (
    <div
      className={cn(
        'max-w-[85%] rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-md transition-shadow',
        isUser
          ? 'rounded-tr-sm bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 text-white shadow-indigo-500/20 hover:shadow-indigo-500/30'
          : 'rounded-tl-sm border border-slate-200/70 bg-white/90 text-slate-900 shadow-slate-900/10 dark:border-slate-800/70 dark:bg-slate-950/70 dark:text-slate-100 hover:shadow-lg',
        !isUser && showThinking && 'min-w-[min(100%,24rem)]'
      )}
    >
        {showThinking && (
          <ThinkingCapsule
            thoughtData={thoughtData}
            stages={liveThinking?.stages}
            currentStage={liveThinking?.currentStage}
          />
        )}

        {isUser ? (
          <div>{message.content}</div>
        ) : (
          <div className="prose prose-slate max-w-none text-sm dark:prose-invert prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-200/70 prose-pre:bg-slate-900/5 prose-pre:shadow-sm dark:prose-pre:border-slate-800/70 dark:prose-pre:bg-white/5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
              components={{
                p: ({ children }) => (
                  <p>{injectCitations(children, (id, rect, msgId) => {
                    const mockEvent = {
                      currentTarget: { getBoundingClientRect: () => rect }
                    } as React.MouseEvent
                    onCiteClick?.(id, mockEvent, msgId ?? message.id)
                  }, message.id, originalIdToDisplayIndex)}</p>
                ),
                li: ({ children }) => (
                  <li>{injectCitations(children, (id, rect, msgId) => {
                    const mockEvent = {
                      currentTarget: { getBoundingClientRect: () => rect }
                    } as React.MouseEvent
                    onCiteClick?.(id, mockEvent, msgId ?? message.id)
                  }, message.id, originalIdToDisplayIndex)}</li>
                ),
              }}
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
    </div>
  )

  return (
    <div className={cn('flex gap-6 items-start', isUser ? 'justify-end' : 'justify-start')}>
      {isUser ? (
        <>
          {bubbleEl}
          {avatarEl}
        </>
      ) : (
        <>
          {avatarEl}
          {bubbleEl}
        </>
      )}
    </div>
  )
}
