import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { Plus } from 'lucide-react'
import type { KnowledgeBase } from '@/store/useKnowledgeStore'
import './knowledgeLibraryHeader.css'

const modalities = [
  { key: 'documents', label: '文档' },
  { key: 'images', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
] as const

interface KnowledgeLibraryHeaderProps {
  knowledgeBases: KnowledgeBase[]
  loading: boolean
  unavailable: boolean
  onCreate: () => void
}

export function KnowledgeLibraryHeader({
  knowledgeBases,
  loading,
  unavailable,
  onCreate,
}: KnowledgeLibraryHeaderProps) {
  useTranslation()
  const counts = { documents: 0, images: 0, audio: 0, video: 0 }
  for (const space of knowledgeBases) {
    for (const { key } of modalities) counts[key] += space.stats?.[key] ?? 0
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const pending = loading || unavailable
  const empty = !pending && knowledgeBases.length === 0
  const formatCount = (value: number) => pending ? '—' : value.toLocaleString(getLanguage())

  return (
    <header className="knowledge-library-header" aria-busy={loading}>
      <div className="knowledge-library-header__main">
        <div className="knowledge-library-header__intro">
          <span className="knowledge-library-header__icon" aria-hidden="true">
            <img src="/knowledge/empty-collection.webp" alt="" draggable={false} width={78} height={52} />
          </span>
          <div className="knowledge-library-header__copy">
            <h1>{t("素材空间")}</h1>
            <p className="knowledge-library-header__description">{t("整理文档、图片与影音，随时检索和引用。")}</p>
          </div>
          {!empty && <div className="knowledge-library-header__inventory">
            <p className="knowledge-library-header__total">
              <span>{t("已收录")}</span><strong>{formatCount(total)}</strong><span>{t("份素材")}</span>
              {(loading || unavailable) && <span className="sr-only">{unavailable ? t("素材统计暂不可用") : t("正在载入素材")}</span>}
            </p>
            <dl className="knowledge-library-header__modalities" aria-label={t("素材类型统计")}>
              {modalities.map(({ key, label }) => (
                <div key={key} className={`knowledge-library-header__modality knowledge-library-header__modality--${key}`}>
                  <dt><span className="knowledge-library-header__modality-icon" aria-hidden="true"><img src={`/knowledge/material-${key}.webp`} width={32} height={32} alt="" decoding="async" /></span><span>{t(label)}</span></dt>
                  <dd>{formatCount(counts[key])}</dd>
                </div>
              ))}
            </dl>
          </div>}
        </div>
        {!empty && <button className="knowledge-library-header__create" type="button" onClick={onCreate}>
          <svg className="knowledge-library-header__create-art" viewBox="0 0 48 44" fill="none" aria-hidden="true" focusable="false">
            <path className="knowledge-library-header__create-back" d="M6 34V13a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v17H6Z" />
            <g className="knowledge-library-header__create-paper">
              <rect x="9" y="5" width="24" height="30" rx="3" />
              <path d="M14 11h13m-13 4h13m-13 4h8" />
            </g>
            <g className="knowledge-library-header__create-photo">
              <rect className="knowledge-library-header__create-photo-frame" x="23" y="10" width="20" height="25" rx="2.5" />
              <rect className="knowledge-library-header__create-photo-sky" x="25.5" y="12.5" width="15" height="15" rx="1" />
              <circle className="knowledge-library-header__create-photo-sun" cx="36.5" cy="16.5" r="2" />
              <path className="knowledge-library-header__create-photo-hill" d="m25.5 24 5-5 4 4 3-2 3 3v3.5h-15Z" />
            </g>
            <path className="knowledge-library-header__create-front" d="M6 25h36a3 3 0 0 1 3 3.5l-1.5 8A4 4 0 0 1 39.5 40h-29a4 4 0 0 1-4-3.5L3 28.5A3 3 0 0 1 6 25Z" />
            <path className="knowledge-library-header__create-edge" d="M9 28h30" />
          </svg>
          <span className="knowledge-library-header__create-label">{t("新建素材空间")}</span>
          <span className="knowledge-library-header__create-symbol" aria-hidden="true"><Plus size={17} strokeWidth={1.8} /></span>
        </button>}
      </div>
    </header>
  )
}
