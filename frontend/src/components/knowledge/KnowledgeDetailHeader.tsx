import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { useState } from 'react'
import { CalendarDays, ChevronLeft, Files } from 'lucide-react'
import './knowledgeDetailHeader.css'

interface KnowledgeDetailHeaderProps {
  name: string
  description?: string
  coverUrl?: string | null
  fileCount?: number
  updatedAt?: string | null
  onBack: () => void
}

export function KnowledgeDetailHeader({ name, description, coverUrl, fileCount, updatedAt, onBack }: KnowledgeDetailHeaderProps) {
  useTranslation()
  const subtitle = description?.trim()
  const cover = coverUrl?.trim()
  const [coverState, setCoverState] = useState<{ url: string; status: 'ready' | 'failed' } | null>(null)
  const coverReady = Boolean(cover && coverState?.url === cover && coverState.status === 'ready')
  const coverFailed = coverState?.url === cover && coverState?.status === 'failed'
  const updatedDate = updatedAt ? new Date(updatedAt) : null
  const validUpdatedDate = updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate : null
  const visibleFileCount = fileCount != null && Number.isFinite(fileCount) && fileCount >= 0 ? fileCount : null
  const formattedDate = validUpdatedDate?.toLocaleDateString(getLanguage(), { year: 'numeric', month: '2-digit', day: '2-digit' })

  return (
    <header className="knowledge-detail-header">
      <div className="knowledge-detail-header__inner">
        <nav className="knowledge-detail-header__breadcrumb" aria-label={t("知识库导航")}>
          <ol>
            <li>
              <button type="button" onClick={onBack} aria-label={t("返回知识库列表")} title={t("返回知识库列表")}>
                <ChevronLeft className="knowledge-detail-header__back-icon" size={18} strokeWidth={1.75} aria-hidden />
                <span className="knowledge-detail-header__back-label">{t("素材空间")}</span>
              </button>
            </li>
            <li className="knowledge-detail-header__current" aria-current="page">
              <span className="knowledge-detail-header__separator" aria-hidden="true">/</span>
              <span title={name}>{name}</span>
            </li>
          </ol>
        </nav>

        <div className="knowledge-detail-header__identity">
          <span className="knowledge-detail-header__cover-stack" aria-hidden="true">
            <span className="knowledge-detail-header__preview" data-cover={coverReady}>
              <img className="knowledge-detail-header__fallback" src="/knowledge/empty-collection.webp" alt="" width={112} height={82} draggable={false} />
              {cover && !coverFailed && <img key={cover} className="knowledge-detail-header__cover" src={cover} alt="" width={112} height={82} draggable={false}
                onLoad={event => setCoverState({ url: cover, status: event.currentTarget.naturalWidth > 0 ? 'ready' : 'failed' })}
                onError={() => setCoverState({ url: cover, status: 'failed' })} />}
            </span>
          </span>
          <div className="knowledge-detail-header__title-line">
            <div className="knowledge-detail-header__heading-row">
              <h1 title={name}>{name}</h1>
              {subtitle ? <p className="knowledge-detail-header__description" title={subtitle}>{subtitle}</p> : null}
            </div>
            {(visibleFileCount != null || formattedDate) && (
              <p className="knowledge-detail-header__metadata">
                {visibleFileCount != null && <span><Files size={13} strokeWidth={1.6} aria-hidden />{t("{{v0}} 个文件", { v0: visibleFileCount.toLocaleString(getLanguage()) })}</span>}
                {visibleFileCount != null && formattedDate && <span className="knowledge-detail-header__metadata-dot" aria-hidden="true">·</span>}
                {formattedDate && validUpdatedDate && <time dateTime={validUpdatedDate.toISOString()}><CalendarDays size={13} strokeWidth={1.6} aria-hidden />{t("更新于 {{date}}", { date: formattedDate })}</time>}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="knowledge-detail-header__art" data-cover={coverReady} aria-hidden="true">
        <img src={coverReady ? cover : '/knowledge/empty-collection.webp'} alt="" draggable={false} />
      </div>
    </header>
  )
}
