import { useId, useState } from 'react'
import { ChevronDown, FileText, Image, Info, Layers, Music, Video } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { isAudioType, isVideoType, type KnowledgeFileView } from './KnowledgeListHelpers'
import './knowledgeContentOverview.css'

type FileKind = 'documents' | 'images' | 'audio' | 'video'

const CONTENT_KINDS = [
  { key: 'documents', label: '文档', icon: FileText },
  { key: 'images', label: '图片', icon: Image },
  { key: 'audio', label: '音频', icon: Music },
  { key: 'video', label: '视频', icon: Video },
] as const

const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'tif', 'heic', 'heif'])

function getFileKind(file: Pick<KnowledgeFileView, 'name' | 'type'>): FileKind {
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (isAudioType(type) || isAudioType(extension)) return 'audio'
  if (type.startsWith('video/') || isVideoType(type) || isVideoType(extension)) return 'video'
  if (type.startsWith('image/') || IMAGE_TYPES.has(type) || IMAGE_TYPES.has(extension)) return 'images'
  return 'documents'
}

interface KnowledgeContentOverviewProps {
  files: readonly Pick<KnowledgeFileView, 'name' | 'type'>[]
  loading: boolean
  index: {
    documents: number
    chunks: number
    images: number
    audio: number
    videoShots: number
    dimensions: { text: number; image: number; audio: number }
  }
}

export function KnowledgeContentOverview({ files, loading, index }: KnowledgeContentOverviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [showExplanation, setShowExplanation] = useState(false)
  const id = useId()
  const headingId = `${id}-heading`
  const detailsId = `${id}-index`
  // 文件清单与检索索引的统计口径不同，概览始终来自完整文件清单。
  const counts = files.reduce<Record<FileKind, number>>((result, file) => {
    result[getFileKind(file)] += 1
    return result
  }, { documents: 0, images: 0, audio: 0, video: 0 })
  const populatedKinds = CONTENT_KINDS.filter(({ key }) => counts[key] > 0)
  const summaryKind = !loading && populatedKinds.length === 1 ? populatedKinds[0] : null
  const SummaryIcon = summaryKind?.icon ?? Layers

  const indexedContent = [
    { label: '文本索引文件', count: index.documents },
    { label: '文本块', count: index.chunks },
    { label: '图片索引', count: index.images },
    { label: '音频索引', count: index.audio },
    { label: '视频片段', count: index.videoShots },
  ]
  const dimensions = [
    { label: '文本', value: index.dimensions.text },
    { label: '图片', value: index.dimensions.image },
    { label: '音频', value: index.dimensions.audio },
  ]

  return (
    <section className="knowledge-overview" aria-labelledby={headingId} aria-busy={loading}>
      <div className="knowledge-overview__bar">
        <div className="knowledge-overview__total">
          <span className="knowledge-overview__mark" data-kind={summaryKind?.key} aria-hidden="true">
            <SummaryIcon size={19} strokeWidth={1.65} />
          </span>
          <div className="knowledge-overview__summary">
            <h3 id={headingId}>内容概览</h3>
            <p><strong>{loading ? '—' : files.length.toLocaleString('zh-CN')}</strong><span>个文件</span></p>
          </div>
        </div>
        <dl className="knowledge-overview__kinds" aria-label="文件分类统计">
          {CONTENT_KINDS.map(({ key, label, icon: Icon }) => (
            <div key={key} data-kind={key} data-active={!loading && counts[key] > 0}>
              <dt><Icon size={15} strokeWidth={1.6} aria-hidden />{label}</dt>
              <dd>{loading ? '—' : counts[key].toLocaleString('zh-CN')}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="knowledge-overview__toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            setExpanded((previous) => !previous)
            setShowExplanation(false)
          }}
        >
          索引详情<span className="knowledge-overview__toggle-icon" aria-hidden="true"><ChevronDown size={12} strokeWidth={1.7} /></span>
        </button>
      </div>
      <div id={detailsId} className="knowledge-overview__details" hidden={!expanded}>
        <div className="knowledge-overview__panel knowledge-overview__panel--index">
          <div className="knowledge-overview__panel-heading">
            <h4>检索内容</h4>
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root open={showExplanation} onOpenChange={setShowExplanation}>
                <Tooltip.Trigger asChild>
                  <button type="button" className="knowledge-overview__info" aria-label="文件与索引统计说明" onClick={(event) => {
                    event.preventDefault()
                    setShowExplanation(true)
                  }}>
                    <Info size={13} strokeWidth={1.7} aria-hidden />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="knowledge-overview-tooltip" side="top" align="start" sideOffset={8} collisionPadding={12}>
                    一个文件可对应多个内容片段，文件数与索引数按不同口径统计。
                    <Tooltip.Arrow className="knowledge-overview-tooltip__arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
          <dl className="knowledge-overview__index-metrics">
            {indexedContent.map(({ label, count }) => (
              <div key={label} data-active={count > 0}><dt>{label}</dt><dd>{count.toLocaleString('zh-CN')}</dd></div>
            ))}
          </dl>
        </div>
        <div className="knowledge-overview__panel knowledge-overview__panel--dimensions">
          <div className="knowledge-overview__panel-heading">
            <h4>向量维度</h4>
          </div>
          <dl className="knowledge-overview__dimension-metrics" aria-label="向量维度详情">
            {dimensions.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}<span>维</span></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
