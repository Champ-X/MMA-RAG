import { useRef, type KeyboardEvent } from 'react'
import { ChevronDown, LayoutGrid, Network, Plus } from 'lucide-react'
import { translate as t, useTranslation } from '@/i18n'
import './knowledgeDetailNavigation.css'

export type KnowledgeDetailSection = 'materials' | 'topics'

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
    { key: 'materials', label: t('素材'), Icon: LayoutGrid },
    { key: 'topics', label: t('主题'), Icon: Network },
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
      {tabs.map(({ key, label, Icon }) => <button key={key} type="button" role="tab"
        ref={node => { refs.current[key] = node }} id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`}
        aria-selected={section === key} tabIndex={section === key ? 0 : -1}
        onClick={() => onSectionChange(key)} onKeyDown={handleKeyDown}>
        <Icon size={16} strokeWidth={1.7} aria-hidden />{label}
      </button>)}
    </div>
    {collapsibleUpload && <button type="button" className="knowledge-detail-navigation__add"
      aria-expanded={uploadExpanded} aria-controls={`${id}-upload`} onClick={onToggleUpload}>
      <span className="knowledge-detail-navigation__add-icon" aria-hidden="true">
        <svg viewBox="0 0 34 30" fill="none" focusable="false">
          <path className="knowledge-detail-navigation__folder-back" d="M3 23V8a3 3 0 0 1 3-3h7l3 4h12a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" />
          <g className="knowledge-detail-navigation__add-paper"><rect x="8" y="5" width="18" height="19" rx="2" /><path d="M12 9h9m-9 4h6" /></g>
          <path className="knowledge-detail-navigation__folder-front" d="M5 14h24c2 0 3 1 2 3l-2 9c0 1-2 2-3 2H8c-2 0-3-1-3-2L2 18c-1-2 0-4 3-4Z" />
        </svg>
        <Plus size={12} strokeWidth={2} className="knowledge-detail-navigation__add-plus" />
      </span><span>{t('添加素材')}</span>
      <ChevronDown size={14} aria-hidden className="knowledge-detail-navigation__chevron" />
    </button>}
  </div>
}
