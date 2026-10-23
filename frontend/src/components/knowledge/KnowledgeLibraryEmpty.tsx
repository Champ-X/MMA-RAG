import { useId } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { useTranslation } from '@/i18n'
import './knowledgeLibraryEmpty.css'

const materials = [
  { key: 'documents', label: '文档' },
  { key: 'images', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
] as const

export function KnowledgeLibraryEmpty({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <section className="knowledge-library-empty" aria-labelledby={titleId}>
      <div className="knowledge-library-empty__main">
        <figure className="knowledge-library-empty__art" aria-hidden="true">
          <img src="/knowledge/empty-collection.webp" width="1536" height="1024" alt="" decoding="async" loading="eager" />
        </figure>
        <div className="knowledge-library-empty__intro">
          <h2 id={titleId}>{t('创建第一个素材空间')}</h2>
          <button type="button" className="knowledge-library-empty__create" onClick={onCreate}>
            <span className="knowledge-library-empty__button-back" aria-hidden="true" />
            <span className="knowledge-library-empty__button-paper" aria-hidden="true"><i /><i /></span>
            <span className="knowledge-library-empty__button-front">
              <span className="knowledge-library-empty__button-plus"><Plus size={19} strokeWidth={1.7} aria-hidden="true" /></span>
              <span>{t('新建素材空间')}</span>
              <ArrowRight className="knowledge-library-empty__button-arrow" size={17} strokeWidth={1.7} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
      <ul className="knowledge-library-empty__materials" aria-label={t('可收纳的素材')}>
        {materials.map(({ key, label }) => (
          <li key={key} className="knowledge-library-empty__material">
            <img src={`/knowledge/material-${key}.webp`} width="1254" height="1254" alt={t(label)} loading="lazy" decoding="async" />
          </li>
        ))}
      </ul>
    </section>
  )
}
