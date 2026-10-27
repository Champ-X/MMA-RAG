import { translate as t, useTranslation } from '@/i18n'
import { Plus, RotateCcw } from 'lucide-react'
import type { KnowledgeFileFilter } from './knowledgeFileKinds'
import './knowledgeFileEmptyState.css'

const TYPE_LABELS = {
  all: '全部',
  documents: '文档',
  images: '图片',
  audio: '音频',
  video: '视频',
} as const

interface KnowledgeFileEmptyStateProps {
  emptyLibrary: boolean
  filter: KnowledgeFileFilter
  query?: string
  onAdd: () => void
  addDisabled?: boolean
  onShowAll: () => void
  onClearSearch: () => void
}

/** A quiet continuation of the collection's illustrated material language. */
export function KnowledgeFileEmptyState({
  emptyLibrary,
  filter,
  query = '',
  onAdd,
  addDisabled = false,
  onShowAll,
  onClearSearch,
}: KnowledgeFileEmptyStateProps) {
  useTranslation()
  const isSearch = !emptyLibrary && Boolean(query.trim())
  const state = emptyLibrary ? 'collection' : isSearch ? 'search' : 'kind'
  const materialKind = filter === 'all' ? 'documents' : filter
  const illustration = emptyLibrary ? '/knowledge/empty-collection.webp' : `/knowledge/material-${materialKind}.webp`
  const shortQuery = query.length > 72 ? `${query.slice(0, 72)}…` : query
  const title = emptyLibrary
    ? t('上传第一份素材')
    : isSearch
      ? t('没有匹配的文件')
      : t('暂无{{fileFilterLabel}}素材', { fileFilterLabel: t(TYPE_LABELS[filter]) })
  const description = emptyLibrary
    ? t('上传文档、图片或影音，把零散资料收在一起。')
    : isSearch
      ? t('没有找到与“{{query}}”匹配的素材，试试更短的关键词。', { query: shortQuery })
      : t('这个空间还没有此类素材。添加一份，或先浏览其他内容。')

  return (
    <div className="knowledge-file-empty" data-state={state} data-kind={materialKind}>
      <div className="knowledge-file-empty__scene">
        <div className="knowledge-file-empty__illustration" aria-hidden="true">
          <span className="knowledge-file-empty__paper knowledge-file-empty__paper--back" />
          <span className="knowledge-file-empty__paper knowledge-file-empty__paper--front" />
          <img src={illustration} alt="" width={210} height={160} draggable={false} />
          {isSearch && <span className="knowledge-file-empty__lens" />}
          <span className="knowledge-file-empty__ground" />
        </div>
        <div className="knowledge-file-empty__copy">
          <h3>{title}</h3>
          <p>{description}</p>
          <div className="knowledge-file-empty__actions">
            {isSearch ? (
              <button type="button" className="knowledge-file-empty__primary" onClick={onClearSearch}>
                <RotateCcw size={15} strokeWidth={1.7} aria-hidden />{t('清空搜索')}
              </button>
            ) : (
              <button type="button" className="knowledge-file-empty__primary" onClick={onAdd} disabled={addDisabled}>
                <Plus size={16} strokeWidth={1.7} aria-hidden />{t('添加素材')}
              </button>
            )}
            {!emptyLibrary && filter !== 'all' && (
              <button type="button" className="knowledge-file-empty__secondary" onClick={onShowAll}>
                {t('查看全部素材')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
