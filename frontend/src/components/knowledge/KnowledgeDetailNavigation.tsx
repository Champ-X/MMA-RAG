import { useRef, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { translate as t, useTranslation } from '@/i18n'
import './knowledgeDetailNavigation.css'

export type KnowledgeDetailSection = 'materials' | 'topics'

function DetailSectionGlyph({ section }: { section: KnowledgeDetailSection }) {
  return <svg className="knowledge-detail-navigation__section-glyph" data-section={section}
    width="19" height="19" viewBox="0 0 24 24" fill="none" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {section === 'materials' ? <>
      <rect className="detail-section-glyph__lilac" x="3" y="3" width="7" height="8" rx="2" />
      <rect className="detail-section-glyph__mint" x="14" y="3" width="7" height="6" rx="2" />
      <rect className="detail-section-glyph__amber" x="3" y="15" width="7" height="6" rx="2" />
      <rect className="detail-section-glyph__lilac" x="14" y="13" width="7" height="8" rx="2" />
    </> : <>
      <path className="detail-section-glyph__connections" d="m7 6 3.2 3.4m3.6 0L17 6m-3.1 8.5 3.6 4" />
      <circle className="detail-section-glyph__mint" cx="12" cy="12" r="3.5" />
      <circle className="detail-section-glyph__lilac" cx="5.5" cy="4.5" r="2.5" />
      <circle className="detail-section-glyph__amber" cx="18.5" cy="4.5" r="2.5" />
      <circle className="detail-section-glyph__lilac" cx="19" cy="20" r="2.5" />
    </>}
  </svg>
}

export function KnowledgeDetailNavigation({ section, onSectionChange, id, uploadExpanded, onToggleUpload, collapsibleUpload }: {
  section: KnowledgeDetailSection
  onSectionChange: (section: KnowledgeDetailSection) => void
  id: string
  uploadExpanded: boolean
  onToggleUpload: () => void
  collapsibleUpload: boolean
}) {
  useTranslation()
  const refs = useRef<Partial<Record<KnowledgeDetailSection, HTMLButtonElement | null>>>({})
  const tabs = [
    { key: 'materials', label: t('素材') },
    { key: 'topics', label: t('主题') },
  ] as const
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'materials' : event.key === 'End' ? 'topics' : section === 'materials' ? 'topics' : 'materials'
    onSectionChange(next)
    refs.current[next]?.focus()
  }
  return <div className="knowledge-detail-navigation">
    <div className="knowledge-detail-navigation__tabs" role="tablist" aria-label={t('素材空间内容')}>
      {tabs.map(({ key, label }) => <button key={key} type="button" role="tab"
        ref={node => { refs.current[key] = node }} id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`}
        aria-selected={section === key} tabIndex={section === key ? 0 : -1}
        onClick={() => onSectionChange(key)} onKeyDown={handleKeyDown}>
        <DetailSectionGlyph section={key} />{label}
      </button>)}
    </div>
    {collapsibleUpload && <button type="button" className="knowledge-detail-navigation__add"
      aria-expanded={uploadExpanded} aria-controls={`${id}-upload`} onClick={onToggleUpload}>
      <span className="knowledge-detail-navigation__add-icon" aria-hidden="true">
        <svg viewBox="0 0 40 36" fill="none" focusable="false" aria-hidden="true">
          <path className="knowledge-detail-navigation__folder-back" d="M4 29V12a3 3 0 0 1 3-3h8l3 4h15a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" />
          <g className="knowledge-detail-navigation__add-paper">
            <rect x="9" y="5" width="16" height="24" rx="2.5" />
            <path d="M13 10h8m-8 4h8m-8 4h5" />
          </g>
          <g className="knowledge-detail-navigation__add-photo">
            <rect x="18" y="9" width="15" height="18" rx="2.5" />
            <circle cx="28.5" cy="14" r="1.5" />
            <path d="m20.5 23 4-5 2.5 3 2-2 2 4" />
          </g>
          <g className="knowledge-detail-navigation__folder-front">
            <path d="M5.5 19h29a2.5 2.5 0 0 1 2.4 3.2l-2.2 8a3 3 0 0 1-2.9 2.2H8.2a3 3 0 0 1-2.9-2.2l-2.2-8A2.5 2.5 0 0 1 5.5 19Z" />
            <path className="knowledge-detail-navigation__folder-seam" d="M8 22h8" />
            <circle className="knowledge-detail-navigation__add-badge" cx="29.5" cy="26" r="5.5" />
            <path className="knowledge-detail-navigation__add-plus" d="M26.5 26h6m-3-3v6" />
          </g>
        </svg>
      </span><span>{t('添加素材')}</span>
      <ChevronDown size={14} aria-hidden className="knowledge-detail-navigation__chevron" />
    </button>}
  </div>
}
