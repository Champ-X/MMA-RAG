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

const countLabel = (count: number) => count.toLocaleString('zh-CN')
const compactCount = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const sourceIcons = { text: FileText, image: ImageIcon, audio: Music2, video: Film }

export function PortraitStatistics({ topicCount, documentCount, ...counts }: PortraitStatisticsProps) {
  const id = useId().replace(/:/g, '')
  const [selected, setSelected] = useState<PortraitSourceKind | null>(null)
  const [preview, setPreview] = useState<PortraitSourceKind | null>(null)
  const { total, segments } = buildPortraitSourceStats(counts)
  const activeKind = preview ?? selected
  const activeSource = segments.find(source => source.kind === activeKind && source.count > 0)
  const displayedCount = activeSource?.count ?? total
  const displayedCountLabel = countLabel(displayedCount)
  const chartDescription = total > 0
    ? `共 ${countLabel(total)} 个内容样本。${segments.map(source => `${source.label} ${countLabel(source.count)}，占比 ${formatPortraitPercentage(source.percentage)}`).join('；')}。`
    : '暂无已解析内容样本，环形图为空。'

  return (
    <section className="portrait-statistics">
      <header className="portrait-statistics__header">
        <h3 className="portrait-statistics__title">主题统计</h3>
        <dl className="portrait-statistics__summary">
          <div>
            <dt>主题</dt>
            <dd>{topicCount === undefined ? '—' : countLabel(normalizePortraitCount(topicCount))}</dd>
          </div>
          <div>
            <dt>文档</dt>
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
            <span className="portrait-statistics__center-label">{activeSource?.label ?? (total > 0 ? '内容样本' : '暂无样本')}</span>
            <span className="portrait-statistics__center-detail">
              {activeSource ? `占比 ${formatPortraitPercentage(activeSource.percentage)}` : total > 0 ? '已解析内容' : '等待内容解析'}
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
                  aria-label={`${source.count === 0 ? `${source.label}暂无已解析样本` : `查看${source.label}样本`}：${countLabel(source.count)}，占比 ${formatPortraitPercentage(source.percentage)}`}
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
