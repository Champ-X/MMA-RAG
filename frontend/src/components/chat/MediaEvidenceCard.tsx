import React from 'react'
import { ArrowUpRight, ChevronDown, Music, Pause, Play, Video, Volume2, VolumeX } from 'lucide-react'
import { translate as tr, useTranslation } from '@/i18n'
import { parseMediaDescription } from '@/lib/mediaDescription'
import { useAudioWaveform } from './useAudioWaveform'

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`
}

/** The source remains one keyboard-accessible target; playback has its own controls. */
export function MediaEvidenceHeader({ kind, fileName, displayNumber, segmentLabel, onOpen }: {
  kind: 'audio' | 'video'
  fileName?: string | null
  displayNumber: number | string
  segmentLabel?: string | null
  onOpen: React.MouseEventHandler<HTMLButtonElement>
}) {
  useTranslation()
  const Icon = kind === 'audio' ? Music : Video
  const title = fileName
    ?.replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}_/i, '')
    .replace(/\.[a-z0-9]{1,6}$/i, '') || tr(kind === 'audio' ? '音频' : '视频')
  return <button type="button" className="media-card-heading" onClick={onOpen}
    aria-label={tr(kind === 'audio' ? '打开音频引用 {{v0}}{{v1}}' : '打开视频引用 {{v0}}{{v1}}', {
      v0: displayNumber, v1: fileName ? `：${fileName}` : '',
    })}>
    <span className="media-card-kind"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
    <span className="media-card-heading-text">
      <span className="media-card-title" title={fileName || title}>{title}</span>
      {fileName && <span className="media-card-filename" title={fileName}>{fileName}{kind === 'audio' ? ` · ${tr('音频')}` : ''}</span>}
      {segmentLabel && <span className="media-card-meta">{segmentLabel}</span>}
    </span>
    <span className="media-card-reference">[{displayNumber}] <span>{tr('来源')}</span><ArrowUpRight size={16} aria-hidden="true" /></span>
  </button>
}

/** Source descriptions stay secondary to the media and expand without covering it. */
export function MediaEvidenceDescription({ content, accent }: { content: string; accent: 'audio' | 'video' }) {
  useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const [selectedSection, setSelectedSection] = React.useState<string | null>(null)
  const textRef = React.useRef<HTMLSpanElement>(null)
  const textId = React.useId()
  const sections = parseMediaDescription(content, accent)
  const active = sections.find(section => section.id === selectedSection) || sections[0]
  const activeContent = active?.content || ''
  const selectSection = (id: string) => { setSelectedSection(id); setExpanded(false) }

  React.useEffect(() => {
    const text = textRef.current
    if (!text || expanded) return
    const measureOverflow = () => setCanExpand(text.scrollHeight > text.clientHeight + 1)
    measureOverflow()
    const observer = new ResizeObserver(measureOverflow)
    observer.observe(text)
    return () => observer.disconnect()
  }, [activeContent, expanded])

  return <figcaption className="media-card-description" data-media-kind={accent}>
    {sections.length > 1 ? <div className="media-card-description-tabs" role="tablist" aria-label={tr('媒体内容')}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const current = sections.findIndex(section => section.id === active.id)
        const next = event.key === 'ArrowRight' ? (current + 1) % sections.length
          : event.key === 'ArrowLeft' ? (current + sections.length - 1) % sections.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null
        if (next == null) return
        event.preventDefault()
        selectSection(sections[next].id)
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true })
      }}>
      {sections.map(section => <button key={section.id} type="button" role="tab"
        id={`${textId}-${section.id}`} aria-selected={active.id === section.id} aria-controls={`${textId}-panel`}
        tabIndex={active.id === section.id ? 0 : -1} onClick={() => selectSection(section.id)}>{tr(section.label)}</button>)}
    </div> : active && <div className="media-card-description-label">{tr(active.label)}
      {active.detail && <span>{active.detail}</span>}
    </div>}
    <p className="media-card-description-row" id={`${textId}-panel`}
      role={sections.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={sections.length > 1 ? `${textId}-${active.id}` : undefined}>
      <span ref={textRef} id={textId} className={`media-card-description-text${expanded ? '' : ' is-collapsed'}`}>
        {activeContent}
      </span>
      {canExpand && <button type="button" className="media-card-disclosure"
        aria-expanded={expanded} aria-controls={textId}
        onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}>
        {expanded ? tr('收起') : tr('展开')}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>}
    </p>
  </figcaption>
}

/** Native audio/range behavior with a shared visual transport and real progress. */
export function InlineAudioPlayer({ src, label, onError, header }: {
  src: string
  label: string
  onError?: React.ReactEventHandler<HTMLAudioElement>
  header?: React.ReactNode
}) {
  useTranslation()
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const transportRef = React.useRef<HTMLDivElement>(null)
  const waveId = React.useId()
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [waveformEnabled, setWaveformEnabled] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const waveform = useAudioWaveform(src, waveformEnabled)

  React.useEffect(() => {
    const element = transportRef.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setWaveformEnabled(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setWaveformEnabled(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const audio = audioRef.current
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    return () => audio?.pause()
  }, [src])

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try { await audio.play() } catch { setIsPlaying(false) }
    } else {
      audio.pause()
    }
  }
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const progress = safeDuration ? Math.max(0, Math.min(100, currentTime / safeDuration * 100)) : 0

  return <div ref={transportRef} className="media-card-audio-transport" data-playing={isPlaying}
    onClick={event => event.stopPropagation()}>
    <audio ref={audioRef} src={src} preload="metadata" aria-label={label}
      onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
      onDurationChange={event => setDuration(event.currentTarget.duration)}
      onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
      onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)}
      onVolumeChange={event => setIsMuted(event.currentTarget.muted)}
      onError={onError} />
    <button type="button" className="media-card-play" onClick={() => void togglePlayback()}
      aria-label={tr(isPlaying ? '暂停{{v0}}' : '播放{{v0}}', { v0: label })}>
      {isPlaying ? <Pause size={18} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
        : <Play size={18} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />}
    </button>
    <div className="media-card-audio-body">
    {header}
    <div className="media-card-audio-seek">
    <div className="media-card-audio-timeline">
      <div className="media-card-waveform" data-waveform={!!waveform}>
      {waveform && <svg className="media-card-wave" viewBox="0 0 960 64" preserveAspectRatio="none" aria-hidden="true">
        <defs><clipPath id={waveId}><rect x={0} y={0} width={progress * 9.6} height={64} /></clipPath></defs>
        <g fill="var(--media-track)">{waveform.map((peak, index) => {
          const height = Math.max(3, peak * 58)
          return <rect key={index} x={index * 10 + 2} y={(64 - height) / 2} width={5} height={height} rx={2} />
        })}</g>
        <g fill="var(--media-accent)" clipPath={`url(#${waveId})`}>{waveform.map((peak, index) => {
          const height = Math.max(3, peak * 58)
          return <rect key={index} x={index * 10 + 2} y={(64 - height) / 2} width={5} height={height} rx={2} />
        })}</g>
      </svg>}
      <input type="range" min={0} max={safeDuration} step={0.1}
        value={safeDuration ? Math.min(currentTime, safeDuration) : 0} disabled={!safeDuration}
        onChange={event => {
          const nextTime = Number(event.currentTarget.value)
          if (!audioRef.current || !Number.isFinite(nextTime)) return
          audioRef.current.currentTime = nextTime
          setCurrentTime(nextTime)
        }}
        aria-label={tr('{{v0}}播放进度', { v0: label })}
        aria-valuetext={`${formatMediaTime(currentTime)} / ${formatMediaTime(safeDuration)}`}
        className="media-audio-range" style={{ '--media-progress': `${progress}%` } as React.CSSProperties} />
      </div>
      <div className="media-card-audio-times">
        <span className="media-audio-current">{formatMediaTime(currentTime)}</span>
        <span>{safeDuration ? formatMediaTime(safeDuration) : '--:--'}</span>
      </div>
    </div>
    <button type="button" className="media-card-mute" aria-label={tr(isMuted ? '取消静音' : '静音')}
      aria-pressed={isMuted} onClick={() => {
        const audio = audioRef.current
        if (audio) { audio.muted = !audio.muted; setIsMuted(audio.muted) }
      }}>{isMuted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}</button>
    </div>
    </div>
  </div>
}
