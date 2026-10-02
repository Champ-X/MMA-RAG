import { FileText, Image, Music, Plus, Video } from 'lucide-react'
import type { KnowledgeBase } from '@/store/useKnowledgeStore'
import './knowledgeLibraryHeader.css'

const modalities = [
  { key: 'documents', label: '文档', Icon: FileText },
  { key: 'images', label: '图片', Icon: Image },
  { key: 'audio', label: '音频', Icon: Music },
  { key: 'video', label: '视频', Icon: Video },
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
  const counts = { documents: 0, images: 0, audio: 0, video: 0 }
  for (const space of knowledgeBases) {
    for (const { key } of modalities) counts[key] += space.stats?.[key] ?? 0
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const pending = loading || unavailable
  const formatCount = (value: number) => pending ? '—' : value.toLocaleString('zh-CN')

  return (
    <header className="knowledge-library-header" aria-busy={loading}>
      <div className="knowledge-library-header__main">
        <div className="knowledge-library-header__intro">
          <span className="knowledge-library-header__icon" aria-hidden="true">
            <img src="/knowledge-library-icon.png" alt="" draggable={false} width={52} height={52} />
          </span>
          <div className="knowledge-library-header__copy">
            <h1>素材空间</h1>
            <p className="knowledge-library-header__description">整理文档、图片与影音，随时检索和引用。</p>
          </div>
          <div className="knowledge-library-header__inventory">
            <p className="knowledge-library-header__total">
              <span>已收录</span><strong>{formatCount(total)}</strong><span>份素材</span>
              {(loading || unavailable) && <span className="sr-only">{unavailable ? '素材统计暂不可用' : '正在载入素材'}</span>}
            </p>
            <dl className="knowledge-library-header__modalities" aria-label="素材类型统计">
              {modalities.map(({ key, label, Icon }) => (
                <div key={key} className={`knowledge-library-header__modality knowledge-library-header__modality--${key}`}>
                  <dt><span className="knowledge-library-header__modality-icon" aria-hidden="true"><Icon size={12} strokeWidth={1.7} /></span><span>{label}</span></dt>
                  <dd>{formatCount(counts[key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <button className="knowledge-library-header__create" type="button" onClick={onCreate}>
          <svg className="knowledge-library-header__create-art" viewBox="0 0 184 62" fill="none" aria-hidden="true" focusable="false">
            <path className="knowledge-library-header__create-back" d="M10 27V14a8 8 0 0 1 8-8h35c4 0 6 1 8 4l5 6h100a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H21a11 11 0 0 1-11-11Z" />
            <g className="knowledge-library-header__create-paper">
              <rect x="24" y="17" width="142" height="33" rx="5" />
              <path d="M35 22h43m7 0h17" />
            </g>
            <path className="knowledge-library-header__create-front" d="M13 25h157c6 0 9 4 8 10l-3 14c-1 5-4 8-10 8H24c-6 0-9-3-10-8l-5-15c-2-5 0-9 4-9Z" />
            <path className="knowledge-library-header__create-edge" d="M15 26h152" />
          </svg>
          <span className="knowledge-library-header__create-label">新建素材空间</span>
          <span className="knowledge-library-header__create-symbol" aria-hidden="true"><Plus size={15} strokeWidth={1.7} /></span>
        </button>
      </div>
    </header>
  )
}
