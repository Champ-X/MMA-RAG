import { useEffect, useRef, useState, type CSSProperties, type ReactEventHandler } from 'react'
import { AlertCircle, Loader2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { translate as t, useTranslation } from '@/i18n'
import './audioPreviewPlayer.css'

export interface AudioPreviewPlayerProps {
  src: string
  title?: string
  ariaLabel?: string
  compact?: boolean
  onError?: ReactEventHandler<HTMLAudioElement>
}

function timeLabel(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = String(seconds % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** A source change remounts the transport, so an old track cannot keep playing. */
export function AudioPreviewPlayer(props: AudioPreviewPlayerProps) {
  return <AudioTransport key={props.src} {...props} />
}

function AudioTransport({ src, title, ariaLabel, compact = false, onError }: AudioPreviewPlayerProps) {
  useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)
  const mounted = useRef(true)
  const playRequest = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playRejected, setPlayRejected] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const label = ariaLabel || title || t('音频预览')
  const progress = duration > 0 ? Math.min(100, currentTime / duration * 100) : 0

  useEffect(() => {
    mounted.current = true
    const audio = audioRef.current
    return () => {
      mounted.current = false
      playRequest.current += 1
      audio?.pause()
    }
  }, [])

  const syncTime = () => {
    const audio = audioRef.current
    if (!audio) return
    setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0)
    setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
  }

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio || !src) return
    if (!audio.paused) {
      playRequest.current += 1
      audio.pause()
      setStarting(false)
      return
    }
    if (starting) return
    const request = ++playRequest.current
    setStarting(true)
    setPlayRejected(false)
    try {
      await audio.play()
    } catch {
      if (mounted.current && request === playRequest.current) {
        setPlaying(false)
        setWaiting(false)
        setPlayRejected(true)
      }
    } finally {
      if (mounted.current && request === playRequest.current) setStarting(false)
    }
  }

  const reload = () => {
    playRequest.current += 1
    setStarting(false)
    setFailed(false)
    setPlayRejected(false)
    setWaiting(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    audioRef.current?.load()
  }

  return (
    <div className="audio-preview-player" data-compact={compact} data-playing={playing} data-error={failed || !src}
      role="group" aria-label={label}>
      <audio ref={audioRef} src={src || undefined} preload="metadata" aria-label={label}
        onLoadedMetadata={syncTime} onDurationChange={syncTime} onTimeUpdate={syncTime}
        onPlay={() => { setPlaying(true); setPlayRejected(false) }}
        onPlaying={() => { setWaiting(false); setPlaying(true) }}
        onPause={() => { setPlaying(false); setWaiting(false) }}
        onEnded={() => { setPlaying(false); setWaiting(false); syncTime() }}
        onWaiting={() => setWaiting(true)} onCanPlay={() => { setWaiting(false); setFailed(false) }}
        onVolumeChange={() => {
          const audio = audioRef.current
          if (audio) { setVolume(audio.volume); setMuted(audio.muted) }
        }}
        onError={event => { setFailed(true); setWaiting(false); setPlaying(false); onError?.(event) }} />
      <button type="button" className="audio-preview-player__play" disabled={!src || failed || (starting && !playing)}
        onClick={() => { void togglePlayback() }} aria-label={playing ? t('暂停音频') : t('播放音频')}>
        {waiting || starting ? <Loader2 size={21} aria-hidden className="audio-preview-player__spinner" />
          : playing ? <Pause size={20} fill="currentColor" strokeWidth={1.5} aria-hidden />
            : <Play size={20} fill="currentColor" strokeWidth={1.5} aria-hidden />}
      </button>
      <div className="audio-preview-player__body">
        {title && <div className="audio-preview-player__title" title={title}>{title}</div>}
        <input type="range" className="audio-preview-player__seek" min={0} max={duration || 1} step={0.1}
          value={Math.min(currentTime, duration || 1)} disabled={!duration || failed}
          aria-label={t('音频播放进度')} aria-valuetext={t('{{current}}，共 {{duration}}', { current: timeLabel(currentTime), duration: timeLabel(duration) })}
          style={{ '--audio-progress': `${progress}%` } as CSSProperties}
          onChange={event => {
            const next = Number(event.currentTarget.value)
            if (!audioRef.current || !Number.isFinite(next)) return
            audioRef.current.currentTime = next
            setCurrentTime(next)
          }} />
        <div className="audio-preview-player__time" aria-hidden>
          <span>{timeLabel(currentTime)}</span>
          {waiting && <span className="audio-preview-player__buffering">{t('正在缓冲…')}</span>}
          <span>{duration ? timeLabel(duration) : '—:—'}</span>
        </div>
      </div>
      <div className="audio-preview-player__volume">
        <button type="button" aria-label={muted || volume === 0 ? t('取消静音') : t('静音')}
          className="audio-preview-player__mute" aria-pressed={muted || volume === 0}
          onClick={() => {
            const audio = audioRef.current
            if (!audio) return
            if (audio.volume === 0) audio.volume = 1
            audio.muted = !(muted || volume === 0)
          }}>
          {muted || volume === 0 ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
          className="audio-preview-player__volume-slider" aria-label={t('音量')}
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onChange={event => {
            const audio = audioRef.current
            if (!audio) return
            audio.volume = Number(event.currentTarget.value)
            audio.muted = false
          }} />
      </div>
      {(failed || !src || playRejected) && <div className="audio-preview-player__notice" role="status">
        <AlertCircle size={14} aria-hidden />
        <span>{!src ? t('暂无可播放的音频') : failed ? t('音频暂时无法加载') : t('未能开始播放，请再试一次。')}</span>
        {src && failed && <button type="button" onClick={reload}><RotateCcw size={13} aria-hidden />{t('重新加载')}</button>}
      </div>}
    </div>
  )
}
