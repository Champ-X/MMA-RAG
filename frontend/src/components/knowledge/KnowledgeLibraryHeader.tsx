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
          <svg className="knowledge-library-header__create-art" viewBox="0 0 52 44" fill="none" aria-hidden="true" focusable="false">
            <path className="knowledge-library-header__create-back" d="M5 34V12a4 4 0 0 1 4-4h10l5 5h19a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" />
            <rect className="knowledge-library-header__create-insert" x="14" y="8" width="26" height="27" rx="3" />
            <g className="knowledge-library-header__create-paper">
              <rect x="10" y="11" width="28" height="26" rx="3" />
              <path d="M15 16h12m-12 4h17" />
            </g>
            <path className="knowledge-library-header__create-front" d="M6 22h39c3 0 4 2 3 5l-3 10c-.5 2-2 3-4 3H12c-3 0-4-1-5-4L3 27c-1-3 0-5 3-5Z" />
            <path className="knowledge-library-header__create-edge" d="M8 24h33" />
          </svg>
          <span className="knowledge-library-header__create-label">{t("新建素材空间")}</span>
          <span className="knowledge-library-header__create-symbol" aria-hidden="true"><Plus size={17} strokeWidth={1.8} /></span>
        </button>}
      </div>
    </header>
  )
}
