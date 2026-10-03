import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, ChevronDown, FileText, Image as ImageIcon, Music, RefreshCw, Video, X } from 'lucide-react'
import type { CitationReference } from '@/types/sse'
import { citationScoreDetails, citationScoreSummary } from '@/lib/citationScores'
import { getFreshReferenceMediaUrl, isReferenceMediaUrlFresh, type ReferenceMediaType } from '@/services/reference_media_url'
import './inspectorDrawer.css'

interface InspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** 当前检查的引用项 */
  citations?: CitationReference[]
  /** 引用预览会在打开检查器时卸载；由调用侧保留原引用按钮。 */
  returnFocusTarget?: HTMLElement | null
}

const sourceTypes = {
  doc: { label: '文档', contentLabel: '引用原文', icon: FileText },
  image: { label: '图片', contentLabel: '图片描述', icon: ImageIcon },
  audio: { label: '音频', contentLabel: '转写与描述', icon: Music },
  video: { label: '视频', contentLabel: '片段内容', icon: Video },
}

function displayFileName(fileName?: string) {
  const name = fileName?.split(/[\\/]/).pop() || '未命名来源'
  // 仅清理展示名；原始文件名和路径在来源详情中完整保留。
  return name.replace(/^(?:[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})[_\s-]+/i, '') || name
}

function normalizeContextWindow(raw: unknown): { prev: string; next: string } | null {
  if (typeof raw === 'string') {
    try {
      return normalizeContextWindow(JSON.parse(raw))
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const prev = typeof obj.prev === 'string' ? obj.prev.trim() : ''
    const next = typeof obj.next === 'string' ? obj.next.trim() : ''
    if (prev || next) return { prev, next }
  }
  return null
}

function formatTime(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${String(minutes).padStart(2, '0')}:${remainder}`
}

function InspectorMedia({ item, type, name }: { item: CitationReference; type: ReferenceMediaType; name: string }) {
  const originalUrl = (type === 'image' ? item.img_url : type === 'audio' ? item.audio_url : item.video_url) || ''
  const kbId = item.debug_info?.kb_id?.trim() || ''
  const filePath = item.file_path || item.file_name
  const canRefresh = Boolean(kbId && filePath)
  const needsRefresh = canRefresh && !isReferenceMediaUrlFresh(originalUrl)
  const [mediaUrl, setMediaUrl] = useState(needsRefresh ? '' : originalUrl)
  const [refreshing, setRefreshing] = useState(needsRefresh)
  const [failed, setFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const requestIdRef = useRef(0)
  const automaticRetryRef = useRef(false)
  const { icon: Icon, label } = sourceTypes[type]
  const start = typeof item.start_sec === 'number' && Number.isFinite(item.start_sec) && item.start_sec >= 0 ? item.start_sec : null
  const end = typeof item.end_sec === 'number' && Number.isFinite(item.end_sec) && item.end_sec >= (start ?? 0) ? item.end_sec : null
  const segment = type === 'video' && start != null ? `${formatTime(start)}${end != null ? ` — ${formatTime(end)}` : ''}` : null

  const refreshUrl = useCallback(async (force: boolean) => {
    const requestId = ++requestIdRef.current
    setRefreshing(true)
    setFailed(false)
    setImageLoaded(false)
    try {
      const url = await getFreshReferenceMediaUrl({ type, kbId, filePath, currentUrl: originalUrl, force })
      if (requestId !== requestIdRef.current) return
      setMediaUrl(url)
      setAttempt(value => value + 1)
    } catch {
      if (requestId === requestIdRef.current) setFailed(true)
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false)
    }
  }, [type, kbId, filePath, originalUrl])

  useEffect(() => {
    if (needsRefresh) void refreshUrl(false)
    return () => { requestIdRef.current += 1 }
  }, [needsRefresh, refreshUrl])

  function handleMediaError() {
    if (canRefresh && !automaticRetryRef.current) {
      automaticRetryRef.current = true
      void refreshUrl(true)
    } else {
      setFailed(true)
    }
  }

  function retryMedia() {
    automaticRetryRef.current = true
    if (canRefresh) {
      void refreshUrl(true)
    } else {
      setFailed(false)
      setImageLoaded(false)
      setAttempt(value => value + 1)
    }
  }

  return (
    <figure className="source-inspector-media">
      <figcaption className="source-inspector-media-heading">
        <span><Icon size={14} aria-hidden />{label}预览</span>
        {segment && <span className="source-inspector-segment">引用片段 {segment}</span>}
      </figcaption>
      {refreshing ? (
        <div className="source-inspector-media-fallback" role="status">
          <span className="source-inspector-spinner" aria-hidden />
          <p>正在加载{label}…</p>
        </div>
      ) : failed || !mediaUrl ? (
        <div className="source-inspector-media-fallback">
          <Icon size={25} strokeWidth={1.4} aria-hidden />
          <p role="status">{failed ? `${label}暂时无法加载` : `该来源暂未提供可用的${label}预览`}</p>
          {(mediaUrl || canRefresh) && <button type="button" onClick={retryMedia}><RefreshCw size={12} aria-hidden />重新加载</button>}
        </div>
      ) : type === 'image' ? (
        <div className="source-inspector-image-stage">
          {!imageLoaded && <div className="source-inspector-loading" role="status"><span className="source-inspector-spinner" aria-hidden />正在加载图片…</div>}
          <img
            key={attempt}
            src={mediaUrl}
            alt={name}
            className="source-inspector-image"
            data-loaded={imageLoaded}
            onLoad={() => setImageLoaded(true)}
            onError={handleMediaError}
          />
        </div>
      ) : type === 'audio' ? (
        <audio key={attempt} src={mediaUrl} controls preload="metadata" aria-label={`${name}，音频预览`} onError={handleMediaError} />
      ) : (
        <video
          key={attempt}
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={`${name}，视频预览`}
          onError={handleMediaError}
          onLoadedMetadata={event => {
            if (start == null) return
            const video = event.currentTarget
            const position = Number.isFinite(video.duration) ? Math.min(start, Math.max(0, video.duration - .05)) : start
            try { video.currentTime = position } catch { /* 不支持跳转的媒体仍可正常播放。 */ }
          }}
        />
      )}
    </figure>
  )
}

function SourceMetadata({ item }: { item: CitationReference }) {
  const scoreDetails = citationScoreDetails(item)
  const entries: Array<{ label: string; value: string | number | null | undefined; identifier?: boolean }> = [
    { label: '原始文件名', value: item.file_name },
    { label: '来源路径', value: item.file_path },
    { label: '素材类型', value: sourceTypes[item.type]?.label || item.type },
    { label: '引用编号', value: item.id },
    { label: '片段标识', value: item.debug_info?.chunk_id, identifier: true },
    { label: '知识库标识', value: item.debug_info?.kb_id, identifier: true },
    ...scoreDetails.entries,
  ]

  return (
    <details className="source-inspector-disclosure">
      <summary><span><FileText size={13} aria-hidden />来源详情</span><ChevronDown size={14} aria-hidden /></summary>
      <dl className="source-inspector-metadata">
        {entries.filter(entry => entry.value != null && entry.value !== '').map(entry => (
          <div key={entry.label} style={{ display: 'contents' }}>
            <dt>{entry.label}</dt><dd data-identifier={entry.identifier || undefined}>{entry.value}</dd>
          </div>
        ))}
      </dl>
      <p className="source-inspector-score-note">{scoreDetails.note}</p>
    </details>
  )
}

export function InspectorDrawer({ isOpen, onClose, citations = [], returnFocusTarget }: InspectorDrawerProps) {
  const item = citations[0] || null
  const source = sourceTypes[item?.type || 'doc'] || sourceTypes.doc
  const Icon = source.icon
  const name = displayFileName(item?.file_name)
  const returnFocusRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const score = citationScoreSummary(item ?? undefined)
  const context = item?.type === 'doc' && item.debug_info?.chunk_id ? normalizeContextWindow(item.debug_info.context_window) : null
  const normalizedContent = (item?.content || '').replace(/\s+/g, ' ').trim()
  const previous = context?.prev && context.prev.replace(/\s+/g, ' ').trim() !== normalizedContent ? context.prev : ''
  const next = context?.next && context.next.replace(/\s+/g, ' ').trim() !== normalizedContent && context.next.replace(/\s+/g, ' ').trim() !== previous.replace(/\s+/g, ' ').trim() ? context.next : ''

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="source-inspector-overlay" />
        <Dialog.Content
          className="source-inspector"
          onCloseAutoFocus={event => {
            const target = returnFocusTarget?.isConnected ? returnFocusTarget : returnFocusRef.current
            if (target?.isConnected) {
              event.preventDefault()
              target.focus({ preventScroll: true })
            }
          }}
        >
          <header className="source-inspector-header">
            <div className="source-inspector-heading">
              <span className="source-inspector-icon"><Icon size={19} strokeWidth={1.65} aria-hidden /></span>
              <div className="source-inspector-title-group">
                <p className="source-inspector-kicker">来源检查器</p>
                <Dialog.Title className="source-inspector-title" title={item?.file_name}>{item ? name : '查看引用来源'}</Dialog.Title>
              </div>
              <Dialog.Close className="source-inspector-close" aria-label="关闭检查器"><X size={18} aria-hidden /></Dialog.Close>
            </div>
            <Dialog.Description className="source-inspector-description">
              {item ? <><span className="source-inspector-type">{source.label}</span><span>引用 {item.id}</span><span className="source-inspector-score" title="排序得分不表示概率；各项含义见来源详情">{score.label} <b>{score.value}</b></span></> : '点击回答中的引用编号，阅读对应来源。'}
            </Dialog.Description>
          </header>
          <div className="source-inspector-scroll">
            {!item ? (
              <div className="source-inspector-empty"><FileText size={28} strokeWidth={1.3} aria-hidden /><p>选择一个引用，查看原始内容。</p></div>
            ) : (
              <div key={`${item.id}:${item.type}:${item.debug_info?.chunk_id || item.file_path || item.file_name}`}>
                {(item.type === 'image' || item.type === 'audio' || item.type === 'video') && <InspectorMedia key={`${item.type}:${item.debug_info?.kb_id}:${item.file_path}:${item.img_url}:${item.audio_url}:${item.video_url}`} item={item} type={item.type} name={name} />}
                <section className="source-inspector-content">
                  <div className="source-inspector-section-heading"><h3>{source.contentLabel}</h3>{item.type === 'doc' && <span>检索命中的片段</span>}</div>
                  {item.content?.trim() ? <div className="source-inspector-prose">{item.content}</div> : <p className="source-inspector-no-content">该来源暂未提供文字内容。</p>}
                </section>
                {(previous || next) && (
                  <details className="source-inspector-disclosure">
                    <summary><span>相邻原文</span><ChevronDown size={14} aria-hidden /></summary>
                    <div className="source-inspector-context">
                      {previous && <div><p className="source-inspector-context-label"><ArrowUp size={12} aria-hidden />上一段</p><div className="source-inspector-prose">{previous}</div></div>}
                      {next && <div><p className="source-inspector-context-label"><ArrowDown size={12} aria-hidden />下一段</p><div className="source-inspector-prose">{next}</div></div>}
                    </div>
                  </details>
                )}
                <SourceMetadata item={item} />
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default InspectorDrawer
