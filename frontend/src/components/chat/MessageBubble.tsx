import React from 'react'
import { ThinkingCapsule } from './ThinkingCapsule'
import { InlineCitation } from './InlineCitation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import type { CitationReference } from '@/types/sse'
import type { ThoughtData } from '@/store/useChatStore'

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
  /** 预加载的引用 id -> 完整对象 */
  citationMap?: Map<number | string, CitationReference>
  /** 点击引用时的回调；messageId 用于只从当前消息取引用，避免多条回答共用 [1][2] 时错用上一条的引用 */
  onCiteClick?: (refId: number | string, event: React.MouseEvent, messageId?: string) => void
}

// 从文本中提取引用标记并转换为可点击按钮
function injectCitations(
  children: React.ReactNode,
  onCiteClick?: (id: number | string, rect: DOMRect, messageId?: string) => void,
  messageId?: string
): React.ReactNode {
  if (typeof children === 'string') {
    return splitTextWithCitations(children, onCiteClick, messageId)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <span key={`cnode_${messageId ?? 'm'}_${idx}`}>
        {injectCitations(child, onCiteClick, messageId)}
      </span>
    ))
  }
  if (!React.isValidElement(children)) return children
  if (children.props?.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: injectCitations(children.props.children, onCiteClick, messageId)
    } as any)
  }
  return children
}

type CitationMatch = { start: number; end: number; n: number; leadingSpace?: boolean }

function findAllCitationMatches(text: string): CitationMatch[] {
  const list: CitationMatch[] = []
  let m: RegExpExecArray | null
  // [1], [2], [12]
  const re1 = /\[(\d+)\]/g
  while ((m = re1.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  // 【1】, 【2】 (全角方括号)
  const re2 = /【(\d+)】/g
  while ((m = re2.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  // （1）/(1) 等括号格式
  const re2b = /[（(](\d+)[）)]/g
  while ((m = re2b.exec(text)) !== null) {
    list.push({ start: m.index, end: m.index + m[0].length, n: Number(m[1]) })
  }
  // 〔1〕 / 〖1〗 等方括号格式
  const re2c = /〔(\d+)〕|〖(\d+)〗/g
  while ((m = re2c.exec(text)) !== null) {
    const n = Number(m[1] ?? m[2])
    list.push({ start: m.index, end: m.index + m[0].length, n })
  }
  // 句末 " 4。"、" 1。" 等（空格+数字+句末标点），避免误伤 "3个"、"第1节"
  const re3 = /[\s\u3000]+(\d+)(?=[。！？；;:：、）\)])/g
  while ((m = re3.exec(text)) !== null) {
    list.push({
      start: m.index,
      end: m.index + m[0].length,
      n: Number(m[1]),
      leadingSpace: true,
    })
  }
  // 行末/段末 " 4"（无标点）
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
  // 去重重叠：同一位置只保留第一个
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
  messageId?: string
) {
  const matches = findAllCitationMatches(text)
  if (matches.length === 0) return text

  const out: React.ReactNode[] = []
  let last = 0
  matches.forEach((match, idx) => {
    if (match.start > last) out.push(text.slice(last, match.start))
    if (match.leadingSpace) out.push(' ')
    out.push(
      <CitationInlineButton
        key={`c_${messageId}_${idx}_${match.n}`}
        n={match.n}
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
      className="inline-flex items-center justify-center mx-0.5 text-[10px] font-bold rounded transition-all border align-text-top w-5 h-5 text-indigo-700 dark:text-indigo-200 bg-gradient-to-tr from-indigo-50 to-fuchsia-50 dark:from-indigo-600/25 dark:to-fuchsia-600/15 hover:from-indigo-100 hover:to-fuchsia-100 dark:hover:from-indigo-600/35 dark:hover:to-fuchsia-600/25 border-indigo-200/80 dark:border-slate-700"
      title={`点击查看引用 ${n}`}
    >
      {n}
    </button>
  )
}

export function MessageBubble({
  message,
  isStreaming = false,
  citationMap,
  onCiteClick,
}: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const refs = message.citations ?? []
  const hasRefs = refs.length > 0

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'rounded-tr-sm bg-gradient-to-br from-indigo-600 to-sky-500 text-white shadow-indigo-500/10'
            : 'rounded-tl-sm border border-slate-200/70 bg-white/80 text-slate-900 shadow-slate-900/5 dark:border-slate-800/70 dark:bg-slate-950/60 dark:text-slate-100'
        )}
      >
        {!isUser && message.thinking && (
          <ThinkingCapsule
            thoughtData={
              Array.isArray(message.thinking)
                ? (message.thinking[0]?.data as ThoughtData) || null
                : (message.thinking as ThoughtData)
            }
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
                  }, message.id)}</p>
                ),
                li: ({ children }) => (
                  <li>{injectCitations(children, (id, rect, msgId) => {
                    const mockEvent = {
                      currentTarget: { getBoundingClientRect: () => rect }
                    } as React.MouseEvent
                    onCiteClick?.(id, mockEvent, msgId ?? message.id)
                  }, message.id)}</li>
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
              references={refs}
              variant="inline"
              showImageThumbnails
              citationMap={citationMap}
              onCiteClick={onCiteClick}
              messageId={message.id}
            />
          </div>
        )}
      </div>
    </div>
  )
}
