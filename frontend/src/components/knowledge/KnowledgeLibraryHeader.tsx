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
  background: string
  loading: boolean
  unavailable: boolean
  onCreate: () => void
}

export function KnowledgeLibraryHeader({
  knowledgeBases,
  background,
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
    <header className="knowledge-library-header">
      <div className="knowledge-library-header__art" aria-hidden="true">
        <img src={background} alt="" draggable={false} />
      </div>
      <div className="knowledge-library-header__main">
        <div className="knowledge-library-header__intro">
          <span className="knowledge-library-header__icon" aria-hidden="true">
            <img src="/knowledge-library-icon.png" alt="" draggable={false} />
          </span>
          <div>
            <div className="knowledge-library-header__title-row">
              <h1>素材空间</h1>
              <span className="knowledge-library-header__space-count">{formatCount(knowledgeBases.length)} 个空间</span>
            </div>
            <p>集中整理素材，随时检索与引用。</p>
          </div>
        </div>
        <button className="knowledge-library-header__create" type="button" onClick={onCreate}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
          新建素材空间
        </button>
      </div>
      <div className="knowledge-library-header__inventory">
        <p className="knowledge-library-header__total">
          {unavailable ? '素材统计暂不可用' : loading ? '正在载入素材' : <><strong>{formatCount(total)}</strong><span>份素材已收录</span></>}
        </p>
        <dl className="knowledge-library-header__modalities">
          {modalities.map(({ key, label, Icon }) => (
            <div key={key} className={`knowledge-library-header__modality knowledge-library-header__modality--${key}`}>
              <dt><Icon size={15} aria-hidden="true" /><span>{label}</span></dt>
              <dd>{formatCount(counts[key])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  )
}
