import React from 'react'
import { translate as tr, useTranslation } from '@/i18n'

/** One original video, constrained to the cited interval. Native controls stay native. */
export function VideoPlayerWithSeek({ src, startSec, endSec, className, onClick, onError }: {
  src: string
  startSec?: number | null
  endSec?: number | null
  className?: string
  onClick?: React.MouseEventHandler<HTMLVideoElement>
  onError?: React.ReactEventHandler<HTMLVideoElement>
}) {
  useTranslation()
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const start = Number.isFinite(startSec) ? Math.max(0, startSec!) : 0
  const end = Number.isFinite(endSec) && endSec! > start ? endSec! : null

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // metadata is sufficient to seek; waiting for canplay can leave a preview
    // on the first frame when the browser only preloads metadata.
    const seek = () => { video.currentTime = Math.min(start, Number.isFinite(video.duration) ? video.duration : start) }
    video.addEventListener('loadedmetadata', seek)
    if (video.readyState >= 1) seek()
    return () => {
      video.removeEventListener('loadedmetadata', seek)
      video.pause()
    }
  }, [src, start])

  return <video ref={videoRef} src={src} controls playsInline preload="metadata"
    aria-label={tr('视频引用播放器')} className={className} onClick={onClick} onError={onError}
    onPlay={event => {
      const video = event.currentTarget
      if (video.currentTime < start || (end != null && video.currentTime >= end)) video.currentTime = start
    }}
    onTimeUpdate={event => {
      const video = event.currentTarget
      if (end != null && video.currentTime >= end && !video.paused) {
        video.pause()
        video.currentTime = end
      }
    }}
  />
}
