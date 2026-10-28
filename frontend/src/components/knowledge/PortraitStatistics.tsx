import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { FileText, Film, Image as ImageIcon, Music2 } from 'lucide-react'
import {
  buildPortraitSourceStats,
  formatPortraitPercentage,
  normalizePortraitCount,
  type PortraitSourceCounts,
} from './portraitSourceStats'
import './portraitStatistics.css'

interface PortraitStatisticsProps extends PortraitSourceCounts {
  documentCount: number
}

const sourceIcons = { text: FileText, image: ImageIcon, audio: Music2, video: Film }

/** Parsed-content composition; independent of the atlas's sampled topic totals. */
export function PortraitStatistics({ documentCount, ...counts }: PortraitStatisticsProps) {
  useTranslation()
  const formatCount = (value: number) => value.toLocaleString(getLanguage())
  const { total, segments } = buildPortraitSourceStats(counts)
  const documents = normalizePortraitCount(documentCount)

  return <section className="portrait-statistics" aria-label={t('主题统计')}>
    <div className="portrait-statistics__total">
      <strong>{formatCount(total)}</strong>
      <span>{total > 0 ? t('已解析内容') : t('等待内容解析')}</span>
      {documents > 0 && <small>{t('文档')} <b>{formatCount(documents)}</b></small>}
    </div>
    <div className="portrait-statistics__composition">
      <dl className="portrait-statistics__legend">
        {segments.map(source => {
          const Icon = sourceIcons[source.kind]
          const share = t('占比 {{value1}}', { value1: formatPortraitPercentage(source.percentage) })
          return <div key={source.kind} className="portrait-statistics__source" data-source={source.kind} data-empty={source.count === 0}
            title={`${source.label} ${formatCount(source.count)} · ${share}`}>
            <dt><Icon size={13} strokeWidth={1.7} aria-hidden /><span>{source.label}</span></dt>
            <dd><strong>{formatCount(source.count)}</strong><span className="sr-only">{share}</span></dd>
          </div>
        })}
      </dl>
      <div className="portrait-statistics__bar" aria-hidden="true">
        {segments.filter(source => source.count > 0).map(source => <span key={source.kind} data-source={source.kind}
          style={{ width: `${source.percentage}%` }} />)}
      </div>
    </div>
  </section>
}
