import React from 'react'
import { ChevronLeft, ChevronRight, Film } from 'lucide-react'
import { translate as tr, useTranslation } from '@/i18n'
import { getCitationIdentityKey } from '@/lib/mediaIdentity'
import type { CitationReference } from '@/types/sse'

function timeLabel(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function videoSegmentLabel(citation: CitationReference): string {
  const start = citation.start_sec
  const end = citation.end_sec
  if (start != null && end != null) return `${timeLabel(start)} – ${timeLabel(end)}`
  if (start != null) return tr('从 {{v0}} 开始', { v0: timeLabel(start) })
  if (end != null) return tr('至 {{v0}} 结束', { v0: timeLabel(end) })
  return tr('完整视频')
}

/** Paused, silent previews. Only the centre card has an interactive player. */
function SegmentPreview({ citation, src }: { citation: CitationReference; src?: string }) {
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => { setReady(false); setFailed(false) }, [src])
  const start = Math.max(0, citation.start_sec || 0)
  const end = citation.end_sec
  // Use an actual frame inside this interval, avoiding title-card/black boundaries.
  const timestamp = start + (end != null && end > start ? Math.min(1, (end - start) / 2) : 0)
  return <span className="video-evidence-preview" aria-hidden="true">
    <Film className="video-evidence-preview-fallback" />
    {src && !failed && <video src={src} muted playsInline preload="metadata" tabIndex={-1}
      className={ready ? 'is-ready' : ''}
      onLoadedMetadata={event => {
        const video = event.currentTarget
        video.currentTime = Math.min(timestamp, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : timestamp)
      }}
      onLoadedData={() => { if (timestamp === 0) setReady(true) }}
      onSeeked={() => setReady(true)}
      onError={() => setFailed(true)}
    />}
  </span>
}

export function VideoEvidenceCarousel({ citations, displayIndexByRefId, getVideoUrl, renderCitation }: {
  citations: CitationReference[]
  displayIndexByRefId?: Map<number | string, number>
  getVideoUrl: (citation: CitationReference) => string | undefined
  renderCitation: (citation: CitationReference) => React.ReactNode
}) {
  useTranslation()
  const [selectedKey, setSelectedKey] = React.useState(() => getCitationIdentityKey(citations[0]))
  const playerId = React.useId()
  const previousRef = React.useRef<HTMLButtonElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)
  const activeIndex = Math.max(0, citations.findIndex(citation => getCitationIdentityKey(citation) === selectedKey))
  const active = citations[activeIndex]
  const count = citations.length
  const displayNumber = (citation: CitationReference) => displayIndexByRefId?.get(citation.id) ?? citation.id
  const select = (index: number, focusDirection = 0) => {
    const next = (index + count) % count
    setSelectedKey(getCitationIdentityKey(citations[next]))
    if (focusDirection) (focusDirection < 0 ? previousRef : nextRef).current?.focus({ preventScroll: true })
  }
  const handleArrowKey: React.KeyboardEventHandler<HTMLButtonElement> = event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const next = event.key === 'ArrowRight' ? activeIndex + 1 : event.key === 'ArrowLeft' ? activeIndex - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
    if (next == null) return
    event.preventDefault()
    select(next)
  }
  const previews = citations.flatMap((citation, index) => {
    let offset = (index - activeIndex + count) % count
    if (offset > count / 2) offset -= count
    return offset && Math.abs(offset) <= 2 ? [{ citation, index, offset }] : []
  })

  return <section className="video-evidence-carousel not-prose" aria-label={tr('视频依据')}
    aria-roledescription={tr('轮播')}>
    <div className="video-evidence-stage">
      {previews.map(({ citation, index, offset }) => <button type="button"
        key={getCitationIdentityKey(citation)} className="video-evidence-side" data-offset={offset}
        style={{ '--offset': offset, '--depth': Math.abs(offset), '--position': `${50 + Math.sign(offset) * (19 + Math.abs(offset) * 7)}%` } as React.CSSProperties}
        onClick={() => select(index, offset)} tabIndex={-1}
        aria-label={tr('切换到视频引用 {{number}}：{{range}}', { number: displayNumber(citation), range: videoSegmentLabel(citation) })}>
        <SegmentPreview citation={citation} src={getVideoUrl(citation)} />
        <span className="video-evidence-side-number">[{displayNumber(citation)}]</span>
        <span className="video-evidence-side-time">{videoSegmentLabel(citation)}</span>
      </button>)}
      <div className="video-evidence-active" id={playerId} role="group"
        aria-roledescription={tr('片段')}
        aria-label={tr('第 {{current}} 个，共 {{count}} 个片段', { current: activeIndex + 1, count })}
        key={getCitationIdentityKey(active)}>
        {renderCitation(active)}
      </div>
      <button ref={previousRef} type="button" className="video-evidence-arrow video-evidence-previous" aria-label={tr('上一个视频片段')}
        aria-controls={playerId} onKeyDown={handleArrowKey} onClick={() => select(activeIndex - 1)}><ChevronLeft size={22} aria-hidden="true" /></button>
      <button ref={nextRef} type="button" className="video-evidence-arrow video-evidence-next" aria-label={tr('下一个视频片段')}
        aria-controls={playerId} onKeyDown={handleArrowKey} onClick={() => select(activeIndex + 1)}><ChevronRight size={22} aria-hidden="true" /></button>
    </div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {tr('引用 [{{number}}] · {{range}}', { number: displayNumber(active), range: videoSegmentLabel(active) })}
    </p>
  </section>
}
