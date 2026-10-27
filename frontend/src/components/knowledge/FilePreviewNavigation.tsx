import type { KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { translate as t, useTranslation } from '@/i18n'
import './filePreviewNavigation.css'

export interface FilePreviewNavigationProps {
  position: number
  total: number
  onPrevious?: () => void
  onNext?: () => void
}

/** Native media, sliders and tablists own their arrow keys. */
export function handleFilePreviewArrow(event: KeyboardEvent<HTMLElement>, onPrevious?: () => void, onNext?: () => void) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, select, audio, video, iframe, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="tablist"]')) return
  const navigate = event.key === 'ArrowLeft' ? onPrevious : onNext
  if (!navigate) return
  event.preventDefault()
  navigate()
}

export function FilePreviewNavigation({ position, total, onPrevious, onNext }: FilePreviewNavigationProps) {
  useTranslation()
  return <div className="file-preview-navigation" role="group" aria-label={t('切换素材')}>
    <span className="file-preview-navigation__label">{t('素材预览')}</span>
    <div className="file-preview-navigation__controls">
      <button type="button" onClick={onPrevious} disabled={!onPrevious} aria-label={t('上一个素材')} title={t('上一个素材')}>
        <ChevronLeft size={17} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="file-preview-navigation__position" role="status" aria-live="polite" aria-atomic="true"
        aria-label={t('第 {{position}} 个素材，共 {{total}} 个', { position, total })}>
        <strong>{position}</strong><span aria-hidden>/</span><span>{total}</span>
      </span>
      <button type="button" onClick={onNext} disabled={!onNext} aria-label={t('下一个素材')} title={t('下一个素材')}>
        <ChevronRight size={17} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  </div>
}
