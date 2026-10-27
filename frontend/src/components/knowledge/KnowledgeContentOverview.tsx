import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { useId, useState, type ReactNode, type Ref } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { KnowledgeFileView } from './KnowledgeListHelpers'
import { getKnowledgeFileKind, KNOWLEDGE_FILE_FILTERS, type KnowledgeFileFilter, type KnowledgeFileKind } from './knowledgeFileKinds'
import './knowledgeContentOverview.css'

interface KnowledgeContentOverviewProps {
  files: readonly Pick<KnowledgeFileView, 'name' | 'type'>[]
  loading: boolean
  activeFilter: KnowledgeFileFilter
  onFilterChange: (filter: KnowledgeFileFilter) => void
  resultsId: string
  allFilterRef?: Ref<HTMLButtonElement>
  controls?: ReactNode
  index: {
    documents: number
    chunks: number
    images: number
    audio: number
    videoShots: number
    dimensions: { text: number; image: number; audio: number }
  }
}

export function KnowledgeContentOverview({ files, loading, index, activeFilter, onFilterChange, resultsId, allFilterRef, controls }: KnowledgeContentOverviewProps) {
  useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [showExplanation, setShowExplanation] = useState(false)
  const id = useId()
  const headingId = `${id}-heading`
  const detailsId = `${id}-index`
  // 文件清单与检索索引的统计口径不同，概览始终来自完整文件清单。
  const counts = files.reduce<Record<KnowledgeFileKind, number>>((result, file) => {
    result[getKnowledgeFileKind(file)] += 1
    return result
  }, { documents: 0, images: 0, audio: 0, video: 0 })
  const indexedContent = [
    { label: t("文本索引文件"), count: index.documents },
    { label: t("文本块"), count: index.chunks },
    { label: t("图片索引"), count: index.images },
    { label: t("音频索引"), count: index.audio },
    { label: t("视频片段"), count: index.videoShots },
  ]
  const dimensions = [
    { label: t("文本"), value: index.dimensions.text },
    { label: t("图片"), value: index.dimensions.image },
    { label: t("音频"), value: index.dimensions.audio },
  ]

  return (
    <section className="knowledge-overview" aria-labelledby={headingId}>
      <div className="knowledge-overview__bar">
        <div className="knowledge-overview__total" aria-busy={loading}>
          <h3 id={headingId}>{t("全部素材")}</h3>
          <span className="knowledge-overview__count">{loading ? '—' : files.length.toLocaleString(getLanguage())}</span>
        </div>
        <div className="knowledge-overview__filters" role="group" aria-label={t("按素材类型筛选")} aria-busy={loading}>
          {KNOWLEDGE_FILE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              ref={key === 'all' ? allFilterRef : undefined}
              type="button"
              className="knowledge-overview__filter"
              aria-pressed={activeFilter === key}
              aria-controls={resultsId}
              disabled={loading}
              onClick={() => onFilterChange(key)}
            >
              <img
                className="knowledge-overview__filter-art"
                src={key === 'all' ? '/knowledge/empty-collection.webp' : `/knowledge/material-${key}.webp`}
                width={36}
                height={36}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              <span>{t(label)}</span>
              <span className="knowledge-overview__filter-count">
                {loading ? '—' : (key === 'all' ? files.length : counts[key]).toLocaleString(getLanguage())}
              </span>
            </button>
          ))}
        </div>
        {controls && <div className="knowledge-overview__controls">{controls}</div>}
        <button
          type="button"
          className="knowledge-overview__toggle"
          aria-label={t("索引详情")}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            setExpanded((previous) => !previous)
            setShowExplanation(false)
          }}
        >
           <span className="knowledge-overview__toggle-label">{t("索引详情")}</span><span className="knowledge-overview__toggle-icon" aria-hidden="true"><ChevronDown size={12} strokeWidth={1.7} /></span>
        </button>
      </div>
      <div id={detailsId} className="knowledge-overview__details" hidden={!expanded}>
        <div className="knowledge-overview__panel knowledge-overview__panel--index">
          <div className="knowledge-overview__panel-heading">
            <h4>{t("检索内容")}</h4>
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root open={showExplanation} onOpenChange={setShowExplanation}>
                <Tooltip.Trigger asChild>
                  <button type="button" className="knowledge-overview__info" aria-label={t("文件与索引统计说明")} onClick={(event) => {
                    event.preventDefault()
                    setShowExplanation(true)
                  }}>
                    <Info size={13} strokeWidth={1.7} aria-hidden />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="knowledge-overview-tooltip" side="top" align="start" sideOffset={8} collisionPadding={12}>
                     {t("一个文件可对应多个内容片段，文件数与索引数按不同口径统计。")} <Tooltip.Arrow className="knowledge-overview-tooltip__arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
          <dl className="knowledge-overview__index-metrics">
            {indexedContent.map(({ label, count }) => (
              <div key={label} data-active={count > 0}><dt>{t(label)}</dt><dd>{count.toLocaleString(getLanguage())}</dd></div>
            ))}
          </dl>
        </div>
        <div className="knowledge-overview__panel knowledge-overview__panel--dimensions">
          <div className="knowledge-overview__panel-heading">
            <h4>{t("向量维度")}</h4>
          </div>
          <dl className="knowledge-overview__dimension-metrics" aria-label={t("向量维度详情")}>
            {dimensions.map(({ label, value }) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}<span>{t("维")}</span></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
