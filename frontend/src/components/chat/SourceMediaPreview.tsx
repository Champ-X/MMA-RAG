import { translate as tr, useTranslation } from '@/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CitationReference } from '@/types/sse'
import { getFreshReferenceMediaUrl, isReferenceMediaUrlFresh, type ReferenceMediaType } from '@/services/reference_media_url'
import { AudioPreviewPlayer } from '@/components/ui/AudioPreviewPlayer'
import { sourceTypes } from './sourceIdentity'
import '../debug/inspectorDrawer.css'

function formatTime(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${String(minutes).padStart(2, '0')}:${remainder}`
}

export function SourceMediaPreview({ item, type, name }: { item: CitationReference; type: ReferenceMediaType; name: string }) {
  useTranslation()
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
        <span><Icon size={14} aria-hidden />{tr("{{kind}}预览", { kind: tr(label) })}</span>
        {segment && <span className="source-inspector-segment">{tr("引用片段：{{segment}}", { segment })}</span>}
      </figcaption>
      {refreshing ? (
        <div className="source-inspector-media-fallback" role="status">
          <span className="source-inspector-spinner" aria-hidden />
          <p>{tr("正在加载{{kind}}…", { kind: tr(label) })}</p>
        </div>
      ) : failed || !mediaUrl ? (
        <div className="source-inspector-media-fallback">
          <Icon size={25} strokeWidth={1.4} aria-hidden />
          <p role="status">{failed ? tr("{{v0}}暂时无法加载", { v0: tr(label) }) : tr("该来源暂未提供可用的{{v0}}预览", { v0: tr(label) })}</p>
          {(mediaUrl || canRefresh) && <button type="button" onClick={retryMedia}><RefreshCw size={12} aria-hidden />{tr("重新加载")}</button>}
        </div>
      ) : type === 'image' ? (
        <div className="source-inspector-image-stage">
          {!imageLoaded && <div className="source-inspector-loading" role="status"><span className="source-inspector-spinner" aria-hidden />{tr("正在加载图片…")}</div>}
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
        <AudioPreviewPlayer key={attempt} src={mediaUrl} compact title={name} ariaLabel={tr("{{v0}}，音频预览", { v0: name })} onError={handleMediaError} />
      ) : (
        <video
          key={attempt}
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          aria-label={tr("{{v0}}，视频预览", { v0: name })}
          onError={handleMediaError}
          onTimeUpdate={event => { if (end != null && event.currentTarget.currentTime >= end) event.currentTarget.pause() }}
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
