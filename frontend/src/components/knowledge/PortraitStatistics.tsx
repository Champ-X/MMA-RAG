import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { useId, useState } from 'react'
import { FileText, Film, Image as ImageIcon, Music2 } from 'lucide-react'
import {
  buildPortraitSourceStats,
  formatPortraitPercentage,
  normalizePortraitCount,
  type PortraitSourceCounts,
  type PortraitSourceKind,
} from './portraitSourceStats'
import './portraitStatistics.css'

interface PortraitStatisticsProps extends PortraitSourceCounts {
  topicCount?: number
  documentCount: number
}

const countLabel = (count: number) => count.toLocaleString(getLanguage())
const sourceIcons = { text: FileText, image: ImageIcon, audio: Music2, video: Film }

export function PortraitStatistics({ topicCount, documentCount, ...counts }: PortraitStatisticsProps) {
  useTranslation()
  const compactCount = new Intl.NumberFormat(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 })
  const id = useId().replace(/:/g, '')
  const [selected, setSelected] = useState<PortraitSourceKind | null>(null)
  const [preview, setPreview] = useState<PortraitSourceKind | null>(null)
  const { total, segments } = buildPortraitSourceStats(counts)
  const activeKind = preview ?? selected
  const activeSource = segments.find(source => source.kind === activeKind && source.count > 0)
  const displayedCount = activeSource?.count ?? total
  const displayedCountLabel = countLabel(displayedCount)
  const chartDescription = total > 0
    ? t("共 {{value1}} 个内容样本。{{value2}}。", { value1: countLabel(total), value2: segments.map(source => t("{{value1}} {{value2}}，占比 {{value3}}", { value1: source.label, value2: countLabel(source.count), value3: formatPortraitPercentage(source.percentage) })).join('；') })
    : t("暂无已解析内容样本，环形图为空。")

  return (
    <section className="portrait-statistics">
      <header className="portrait-statistics__header">
        <h3 className="portrait-statistics__title">{t("主题统计")}</h3>
        <dl className="portrait-statistics__summary">
          <div>
            <dt>{t("主题")}</dt>
            <dd>{topicCount === undefined ? '—' : countLabel(normalizePortraitCount(topicCount))}</dd>
          </div>
          <div>
            <dt>{t("文档")}</dt>
            <dd>{countLabel(normalizePortraitCount(documentCount))}</dd>
          </div>
        </dl>
      </header>

      <div className="portrait-statistics__body">
        <figure className="portrait-statistics__chart">
          <svg viewBox="0 0 200 200" role="img" aria-labelledby={`${id}-chart-title`}>
            <title id={`${id}-chart-title`}>{chartDescription}</title>
            <circle className="portrait-statistics__track" cx="100" cy="100" r="82" fill="none" strokeWidth="14" />
            <g transform="rotate(-90 100 100)">
              {segments.filter(source => source.count > 0).map(source => (
                <circle
                  key={source.kind}
                  className="portrait-statistics__segment"
                  data-source={source.kind}
                  cx="100" cy="100" r="82" fill="none" strokeWidth="14"
                  pathLength="100"
                  stroke={source.color}
                  strokeDasharray={`${source.percentage} ${100 - source.percentage}`}
                  strokeDashoffset={-source.offset}
                  opacity={activeSource && activeSource.kind !== source.kind ? 0.25 : 1}
                />
              ))}
            </g>
          </svg>
          <div className="portrait-statistics__center" aria-hidden="true">
            <strong
              className={displayedCountLabel.length > 5 ? 'portrait-statistics__count portrait-statistics__count--compact' : 'portrait-statistics__count'}
              title={displayedCountLabel}
            >{displayedCount >= 1000000 ? compactCount.format(displayedCount) : displayedCountLabel}</strong>
            <span className="portrait-statistics__center-label">{activeSource?.label ?? (total > 0 ? t("内容样本") : t("暂无样本"))}</span>
            <span className="portrait-statistics__center-detail">
              {activeSource ? t("占比 {{value1}}", { value1: formatPortraitPercentage(activeSource.percentage) }) : total > 0 ? t("已解析内容") : t("等待内容解析")}
            </span>
          </div>
        </figure>

        <ul className="portrait-statistics__legend" role="list">
          {segments.map(source => {
            const Icon = sourceIcons[source.kind]
            return (
              <li key={source.kind}>
                <button
                  type="button"
                  className="portrait-statistics__source"
                  data-source={source.kind}
                  disabled={source.count === 0}
                  aria-pressed={source.count > 0 && selected === source.kind}
                  aria-label={t("{{value1}}：{{value2}}，占比 {{value3}}", { value1: source.count === 0 ? t("{{value1}}暂无已解析样本", { value1: source.label }) : t("查看{{value1}}样本", { value1: source.label }), value2: countLabel(source.count), value3: formatPortraitPercentage(source.percentage) })}
                  onMouseEnter={() => setPreview(source.kind)}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => setPreview(source.kind)}
                  onBlur={() => setPreview(null)}
                  onClick={() => setSelected(previous => previous === source.kind ? null : source.kind)}
                >
                  <span className="portrait-statistics__source-heading">
                    <span className="portrait-statistics__source-icon" aria-hidden="true"><Icon size={13} strokeWidth={1.8} /></span>
                    <span className="portrait-statistics__source-label">{source.label}</span>
                  </span>
                  <span className="portrait-statistics__source-values">
                    <strong className="portrait-statistics__source-count">{countLabel(source.count)}</strong>
                    <span className="portrait-statistics__source-percentage">{formatPortraitPercentage(source.percentage)}</span>
                  </span>
                  <span className="portrait-statistics__source-bar" aria-hidden="true">
                    <span style={{ width: `${source.percentage}%` }} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
